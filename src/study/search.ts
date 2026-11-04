/**
 * 书内检索（search_book，docs/design/lecture-retrieval-20261104.md §3）：以前是整句 LIKE、按书序取前 8 个，
 * 「动量」只命中前言和第 1 章，「动量 崩溃」一个也搜不到，英文书用中文搜也是 0。现在：
 * - 查询拆成几个概念（空格、|、顿号分开；词表里的英文短语保持完整），每个概念按中英词表扩展成几种写法；
 * - 候选块用 SQL 粗筛（任一写法出现，包括已保存的中文译文），再按 BM25 打分：概念全命中优先，小节标题命中加分；
 * - 目录、前言、参考文献、索引这类小节和像参考文献条目的块降权；当前小节已经在上下文里，也降一点并标出来；
 * - 每个小节最多 2 处，另给「最相关的小节」，模型可以直接 load_section。
 */
import type { BookBlock, BookSection } from '../book/types';
import { blocksBySeq, toBlock, type BlockRow } from '../data/bookRepo';
import type { Db } from '../data/db';
import { expandTerm } from './glossary';

export const SEARCH_LIMIT = 8;
const PER_SECTION = 2;
const CANDIDATES = 600;
const K1 = 1.2;
const B = 0.5;

/** 一个概念的几种写法。 */
export type Concept = string[];

const ascii = (w: string) => /^[\x20-\x7e]+$/.test(w);
const words = (w: string) => w.split(/\s+/).filter(Boolean);

/** 查询 → 概念：先按分隔符切，英文按空格再切，但词表里有的多词短语（ridge regression）保持完整。 */
export function conceptsOf(query: string): Concept[] {
  const pieces = query.split(/[|,，、;；/]+|\s{2,}/).map(x => x.trim()).filter(Boolean);
  const out: Concept[] = [];
  const push = (term: string) => {
    if (!term) return;
    const variants = expandTerm(term);
    if (!out.some(c => c.some(v => v.toLowerCase() === term.toLowerCase()))) out.push(variants);
  };
  for (const piece of pieces) {
    if (expandTerm(piece).length > 1) {
      push(piece);
      continue;
    }
    const tokens = words(piece);
    for (let i = 0; i < tokens.length; ) {
      // 最长匹配词表里的短语，最多 4 个词
      let took = 1;
      for (let n = Math.min(4, tokens.length - i); n > 1; n--) {
        const phrase = tokens.slice(i, i + n).join(' ');
        if (expandTerm(phrase).length > 1) {
          took = n;
          break;
        }
      }
      push(tokens.slice(i, i + took).join(' '));
      i += took;
    }
  }
  return out.slice(0, 6);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 一种写法在文字里的正则：英文按词边界（ridge 不命中 bridge），短的全大写缩写区分大小写（IC 不命中 price）。 */
export function variantPattern(v: string): RegExp {
  const body = escape(v).replace(/\\?\s+/g, '[\\s\\-–]+');
  if (!ascii(v)) return new RegExp(body, 'g');
  const caseSensitive = v.length <= 3 && v === v.toUpperCase() && /[A-Z]/.test(v);
  return new RegExp('(?<![A-Za-z0-9])' + body + '(?![A-Za-z])', caseSensitive ? 'g' : 'gi');
}

const countIn = (text: string, re: RegExp) => (text.match(re) ?? []).length;

/** 目录、前言、参考文献、索引、版权页这类小节：检索时降权。 */
export const backMatter = (title: string) =>
  /^\s*(目录|contents|table of contents|前\s*言|序\s*言?|preface|foreword|致\s*谢|acknowledg|参考文献|references|bibliography|索\s*引|index|作者简介|about the authors?|版权|copyright|后\s*记|上架建议)/i.test(title);

/** 像参考文献条目的块：带年份、作者缩写或 et al.，又不长。 */
export const citationLike = (text: string) =>
  text.length < 500 && /(\(\d{4}[a-z]?\)|[,，]\s*\d{4}[a-z]?[.,，]|et al\.|Journal of|Review of|Vol\.\s*\d|pp\.\s*\d)/.test(text) && !/[。！？]$/.test(text.trim());

export interface SearchHit {
  block: BookBlock;
  score: number;
  /** 命中的写法（取片段、给模型看用）。 */
  matched: string[];
  /** 命中的是已保存的中文译文。 */
  viaTranslation?: boolean;
}

export interface SearchResult {
  concepts: Concept[];
  hits: SearchHit[];
  /** 按小节汇总：命中块数、小节得分（取最高的 3 块之和）。 */
  sections: { id: string; count: number; score: number }[];
  /** 书里哪儿都没出现的概念（第一种写法）：告诉模型换说法。 */
  missing: string[];
}

/**
 * 给候选块打分（纯函数，测试直接用）。total 是全书块数，算 idf；translations 是已保存的中文译文（按 seq）。
 */
export function rankBlocks(o: {
  concepts: Concept[];
  candidates: BookBlock[];
  sections: BookSection[];
  total: number;
  currentSection?: string;
  translations?: Map<number, string>;
}): SearchResult {
  const { concepts, candidates } = o;
  const titleOf = new Map(o.sections.map(s => [s.id, s.title]));
  const patterns = concepts.map(c => c.map(v => variantPattern(v)));
  const avgLen = candidates.reduce((n, b) => n + b.text.length, 0) / Math.max(1, candidates.length) || 1;
  const rows = candidates.map(b => {
    const tr = o.translations?.get(b.seq) ?? '';
    const title = titleOf.get(b.sectionId) ?? '';
    const per = patterns.map((ps, j) => {
      let inText = 0;
      let inTr = 0;
      let inTitle = false;
      const matched: string[] = [];
      ps.forEach((re, k) => {
        const n = countIn(b.text, re);
        const t = tr ? countIn(tr, re) : 0;
        if (n || t) matched.push(concepts[j][k]);
        inText += n;
        inTr += t;
        if (countIn(title, re)) inTitle = true;
      });
      return { tf: inText + inTr, inText, inTitle, matched };
    });
    return { b, per };
  });
  const df = concepts.map((_, j) => rows.filter(r => r.per[j].tf > 0).length);
  const idf = df.map(d => Math.log(1 + (o.total - d + 0.5) / (d + 0.5)));
  const scored: SearchHit[] = [];
  for (const { b, per } of rows) {
    if (!per.some(p => p.tf)) continue;
    let s = 0;
    let covered = 0;
    const norm = 1 - B + (B * b.text.length) / avgLen;
    per.forEach((p, j) => {
      if (p.tf) s += idf[j] * ((p.tf * (K1 + 1)) / (p.tf + K1 * norm));
      if (p.inTitle) s += idf[j] * 1.2;
      if (p.tf || p.inTitle) covered++;
    });
    s *= Math.pow(covered / concepts.length, 2);
    if (backMatter(titleOf.get(b.sectionId) ?? '')) s *= 0.25;
    if (citationLike(b.text)) s *= 0.4;
    if (b.sectionId === o.currentSection) s *= 0.7;
    const viaTranslation = !per.some(p => p.inText);
    scored.push({ block: b, score: s, matched: [...new Set(per.flatMap(p => p.matched))], ...(viaTranslation ? { viaTranslation } : {}) });
  }
  scored.sort((a, b) => b.score - a.score || a.block.seq - b.block.seq);
  const bySection = new Map<string, SearchHit[]>();
  for (const h of scored) bySection.set(h.block.sectionId, [...(bySection.get(h.block.sectionId) ?? []), h]);
  const sections = [...bySection.entries()]
    .map(([id, hs]) => ({ id, count: hs.length, score: hs.slice(0, 3).reduce((n, h) => n + h.score, 0) }))
    .sort((a, b) => b.score - a.score);
  const used = new Map<string, number>();
  const hits: SearchHit[] = [];
  for (const h of scored) {
    const n = used.get(h.block.sectionId) ?? 0;
    if (n >= PER_SECTION) continue;
    used.set(h.block.sectionId, n + 1);
    hits.push(h);
    if (hits.length >= SEARCH_LIMIT) break;
  }
  const missing = concepts.filter((_, j) => !df[j] && !rows.some(r => r.per[j].inTitle)).map(c => c[0]);
  return { concepts, hits, sections, missing };
}

/** 从库里取候选并打分。 */
export async function searchBook(
  db: Db,
  bookId: string,
  query: string,
  sections: BookSection[],
  currentSection?: string,
): Promise<SearchResult> {
  const concepts = conceptsOf(query.replace(/[%_]/g, ' '));
  if (!concepts.length) return { concepts, hits: [], sections: [], missing: [] };
  const variants = [...new Set(concepts.flat())];
  const like = variants.map(() => 'text LIKE ?').join(' OR ');
  const rows = await db.all<BlockRow>(
    'SELECT * FROM book_block WHERE book_id = ? AND (' + like + ') ORDER BY seq LIMIT ' + CANDIDATES,
    [bookId, ...variants.map(v => '%' + v + '%')],
  );
  const candidates = rows.map(toBlock);
  // 已保存的中文译文：英文书用中文搜时靠它
  const translations = new Map<number, string>();
  const tr = await db.all<{ block_seq: number; pairs: string }>(
    "SELECT block_seq, pairs FROM book_translation WHERE book_id = ? AND target = 'zh-CN' AND (" + variants.map(() => 'pairs LIKE ?').join(' OR ') + ') LIMIT 200',
    [bookId, ...variants.map(v => '%' + v + '%')],
  ).catch(() => []);
  for (const t of tr) {
    try {
      translations.set(Number(t.block_seq), (JSON.parse(t.pairs) as { translation: string }[]).map(p => p.translation).join(''));
    } catch {
      // 译文损坏时跳过
    }
  }
  const have = new Set(candidates.map(b => b.seq));
  const extra = [...translations.keys()].filter(seq => !have.has(seq));
  if (extra.length) candidates.push(...(await blocksBySeq(db, bookId, extra)));
  // 标题命中但正文没提到这个词的小节：带上它的前两块，模型能知道这一节存在
  const titled = sections.filter(s => s.leaf && concepts.some(c => c.some(v => variantPattern(v).test(s.title)))).slice(0, 6);
  for (const s of titled) {
    if (s.blockFrom == null || candidates.some(b => b.sectionId === s.id)) continue;
    const first = await db.all<BlockRow>('SELECT * FROM book_block WHERE book_id = ? AND section_id = ? ORDER BY seq LIMIT 2', [bookId, s.id]);
    candidates.push(...first.map(toBlock));
  }
  const total = (await db.get<{ n: number }>('SELECT count(*) n FROM book_block WHERE book_id = ?', [bookId]))?.n ?? candidates.length;
  return rankBlocks({ concepts, candidates, sections, total: Number(total), currentSection, translations });
}

/** 书的正文主要是什么语言：拉丁字母占多数时是英文书（中文书里夹着英文术语不算）。 */
export function bookLanguage(blocks: { text: string }[]): 'en' | 'zh' {
  let han = 0;
  let latin = 0;
  for (const b of blocks.slice(0, 60)) {
    han += (b.text.match(/\p{Script=Han}/gu) ?? []).length;
    latin += (b.text.match(/[A-Za-z]/g) ?? []).length;
  }
  return latin > han * 3 ? 'en' : 'zh';
}
