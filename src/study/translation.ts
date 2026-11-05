/** 本地切句是对齐依据；模型只能填写译文，不能提供或改写原文。 */
import type { BookBlock } from '../book/types';

export interface TranslationPair { source: string; translation: string }
export interface TranslationUnit { id: string; source: string }

// 数学、代码、URL 中的句号不构成句界；公式同时用于返回值核验。
const protectedPattern = /\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$])*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|`[^`]*`|https?:\/\/\S+/g;
const mathPattern = /\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$])*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g;

/** 译文可以调整语序，但不能悄悄改写数字；数学部分另按原始 LaTeX 校验。 */
const numbersOf = (text: string) => (text.replace(protectedPattern, '').match(/(?<![\d.])(?:[-+−]\s*)?(?:\d+(?:[.,]\d+)*|\.\d+)(?:[eE][-+]?\d+)?(?:\s*[%％‰])?/g) ?? [])
  .map(n => n.replace(/\s/g, '').replace(/−/g, '-').replace(/％/g, '%').toLowerCase()).sort();

export function canTranslate(b: BookBlock): boolean {
  if (!['p', 'li', 'img'].includes(b.type) || b.image?.startsWith('source-pages/')) return false;
  const prose = b.text.replace(protectedPattern, '').replace(/<[^>]*>/g, '');
  const outside = prose.replace(/[（(][^()（）]*[）)]/g, '');
  const language = /\p{Script=Han}/u.test(outside) ? outside : prose;
  const foreign = language.match(/[A-Za-z\u00c0-\u02af\u0370-\u052f\u0600-\u06ff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0;
  const chinese = language.match(/\p{Script=Han}/gu)?.length ?? 0;
  // A Chinese paragraph with English terms already reads in the target language.
  // Kana/Hangul distinguish Japanese/Korean prose that also contains Han characters.
  return foreign > 0 && (/[\u3040-\u30ff\uac00-\ud7af]/.test(language) || chinese * 2 < foreign);
}

// 脚注开头：[3]、［3］、【3】、^3、$^{3}$、${ }^{3}$、上标数字、圈码、「注：」
const NOTE_MARK = /^\s*(?:[[［【]\d{1,3}[\]］】]|\^\d{1,3}\b|\$[^$]{0,8}\^\s*\{?\s*\d{1,3}\s*\}?\s*\$|[¹²³⁴⁵⁶⁷⁸⁹⁰]+|[①-⑳]|注\s*[:：]|Notes?\s*:)/;
const REF_TITLE = /^(?:参考文献|参考资料|注释|尾注|references|bibliography|notes|endnotes|works cited)$/i;

/** 脚注（「[3]见 Liu and Lee（2001）……」）：短注里作者名的字母多，按字母数会被当成外文段。 */
export const isNote = (b: Pick<BookBlock, 'text'>) => NOTE_MARK.test(b.text);

/** 这一节以中文为主：中文书里零星的英文脚注、引文、人名不算外文段（日文、韩文不算中文）。 */
export function chineseSection(blocks: BookBlock[]): boolean {
  let han = 0, kana = 0, foreign = 0;
  for (const b of blocks) {
    if (!['p', 'li', 'img'].includes(b.type)) continue;
    const prose = b.text.replace(protectedPattern, '').replace(/<[^>]*>/g, '');
    han += prose.match(/\p{Script=Han}/gu)?.length ?? 0;
    kana += prose.match(/[\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0;
    foreign += prose.match(/[A-Za-z\u00c0-\u02af\u0370-\u052f\u0600-\u06ff]/g)?.length ?? 0;
  }
  return han > 0 && kana * 10 < han && han * 3 > foreign;
}

/**
 * 一节里要译的段（PM 走查第 4 项）：能译的正文、列表和图注，去掉脚注；参考文献一节和以中文为主的一节一段也不要。
 * 「AI 译文 x/y」「还剩 n 段待译」「翻译本节」都按它算；脚注要看时可以在段落菜单里单独翻译。
 */
export function sectionTargets(section: { title: string }, blocks: BookBlock[]): BookBlock[] {
  if (REF_TITLE.test(section.title.replace(/^[\d.\s]+/, '').trim()) || chineseSection(blocks)) return [];
  return blocks.filter(b => canTranslate(b) && !isNote(b));
}

/** 保留全部字符（含空白），缩写和小数不拆；异常长句在安全空白处分行。 */
export function splitTranslationSource(text: string): string[] {
  const spans = [...text.matchAll(protectedPattern)].map(m => ({ start: m.index!, end: m.index! + m[0].length }));
  const out: string[] = [];
  let start = 0, span = 0;
  for (let i = 0; i < text.length; i++) {
    if (spans[span]?.start === i) { i = spans[span++].end - 1; continue; }
    const c = text[i];
    const prefix = text.slice(start, i + 1);
    const period = c === '.' && !/\d\.\d/.test(text.slice(i - 1, i + 2)) &&
      !/\b(?:Mr|Mrs|Ms|Dr|Prof|Fig|Figs|Eq|Eqs|No|vs|al|e\.g|i\.e)\.$/i.test(prefix) &&
      !/\b[A-Z]\.$/.test(prefix);
    const boundary = /[。！？]/.test(c) || ((period || /[!?]/.test(c)) && /^(?:["'”’)]*)?(?:\s|$)/.test(text.slice(i + 1))) ||
      c === '\n' || (i - start >= 600 && /\s/.test(c));
    if (!boundary) continue;
    let end = i + 1;
    while (end < text.length && /["'”’）)]/.test(text[end])) end++;
    while (end < text.length && /\s/.test(text[end])) end++;
    if (text.slice(start, end).trim()) { out.push(text.slice(start, end)); start = end; }
    i = end - 1;
  }
  if (start < text.length) {
    const tail = text.slice(start);
    if (!tail.trim() && out.length) out[out.length - 1] += tail;
    else out.push(tail);
  }
  return out;
}

export const translationUnits = (b: BookBlock): TranslationUnit[] =>
  splitTranslationSource(b.text).map((source, i) => ({ id: b.seq + ':' + i, source }));

export function translationBatches(units: TranslationUnit[]): TranslationUnit[][] {
  const batches: TranslationUnit[][] = [];
  let batch: TranslationUnit[] = [], size = 0;
  for (const unit of units) {
    if (batch.length && (size + unit.source.length > 2400 || batch.length >= 12)) {
      batches.push(batch); batch = []; size = 0;
    }
    batch.push(unit); size += unit.source.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function parseTranslations(text: string, units: TranslationUnit[]): TranslationPair[] {
  const fail = () => new Error('译文不完整或与原句不匹配，请重试这一段');
  let data: unknown;
  try { data = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw fail(); }
  const rows = (data as { translations?: unknown } | null)?.translations;
  if (!Array.isArray(rows) || rows.length !== units.length) throw fail();
  const byId = new Map<string, string>();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || typeof row.text !== 'string' || !row.text.trim() || byId.has(row.id)) throw fail();
    byId.set(row.id, row.text.trim());
  }
  return units.map(unit => {
    const translation = byId.get(unit.id);
    if (!translation) throw fail();
    if (JSON.stringify(unit.source.match(mathPattern) ?? []) !== JSON.stringify(translation.match(mathPattern) ?? [])) {
      throw new Error('译文中的公式与原文不一致，请重试这一段');
    }
    if (JSON.stringify(numbersOf(unit.source)) !== JSON.stringify(numbersOf(translation))) {
      throw new Error('译文中的数字与原文不一致，请重试这一段');
    }
    return { source: unit.source, translation };
  });
}
