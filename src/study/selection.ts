/**
 * 选段讲解的上下文（docs/design/lecture-retrieval-20261104.md §2）：从原文某一段（或其中一句）发起提问时，
 * 告诉模型选的是哪一块、前后是哪两块，并把段里提到的图、表、公式、代码片段和小节找出来：
 * 本节的写块号（原文已在 <current_section>），别的小节的把原文附上并登记成可引用，小节只给标题。
 */
import { secLabel } from '../book/book';
import type { BookBlock, BookSection } from '../book/types';
import { toBlock, type BlockRow } from '../data/bookRepo';
import type { Db } from '../data/db';
import { blockText } from './prompt';

export type RefKind = 'figure' | 'table' | 'equation' | 'snippet' | 'section';

export interface BlockRef {
  kind: RefKind;
  /** 编号：「3.20」「2.2.4」。 */
  key: string;
  /** 段里的原话：「图3.20」「Table 4.1」。 */
  said: string;
}

const NUM = '(\\d+(?:\\s*[.\\-–]\\s*\\d+)+)';
const PATTERNS: [RefKind, RegExp][] = [
  ['figure', new RegExp('(?:图|Figure|FIGURE|Fig\\.|Exhibit|EXHIBIT)\\s*' + NUM, 'g')],
  ['table', new RegExp('(?:表|Table|TABLE)\\s*' + NUM, 'g')],
  ['snippet', new RegExp('(?:Snippet|SNIPPET|代码片段|代码清单|Listing)\\s*' + NUM, 'g')],
  ['equation', new RegExp('(?:式|公式|方程|Equation|equation|Eq\\.|eq\\.)\\s*[（(]?\\s*' + NUM + '\\s*[)）]?', 'g')],
  ['section', /(?:第\s*(\d+(?:\.\d+)*)\s*[节章]|(?:Section|section|Sect\.|§)\s*(\d+(?:\.\d+)*)|(?:Chapter|chapter)\s+(\d+))/g],
];

const normKey = (k: string) => k.replace(/\s+/g, '').replace(/[-–]/g, '.');

/** 段里提到的图、表、公式、代码片段、小节（去重，按出现顺序，最多 6 个）。 */
export function refsIn(text: string): BlockRef[] {
  const out: (BlockRef & { at: number })[] = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const key = normKey(m[1] ?? m[2] ?? m[3] ?? '');
      if (!key || out.some(r => r.kind === kind && r.key === key)) continue;
      out.push({ kind, key, said: m[0].trim(), at: m.index ?? 0 });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 6).map(({ at: _at, ...r }) => r);
}

const CAPTION_WORDS: Record<Exclude<RefKind, 'section' | 'equation'>, string[]> = {
  figure: ['图', 'Figure', 'FIGURE', 'Fig.', 'Exhibit', 'EXHIBIT'],
  table: ['表', 'Table', 'TABLE'],
  snippet: ['Snippet', 'SNIPPET', '代码片段', '代码清单', 'Listing'],
};

const CAPTION: Record<Exclude<RefKind, 'section' | 'equation'>, string> = {
  figure: '(?:图|Figure|FIGURE|Fig\\.|Exhibit|EXHIBIT)',
  table: '(?:表|Table|TABLE)',
  snippet: '(?:Snippet|SNIPPET|代码片段|代码清单|Listing)',
};

/** 图注 / 表题 / 代码片段标题所在的块：块的开头（或某一行的开头）就是「图3.20」。 */
export function isCaptionOf(b: Pick<BookBlock, 'text' | 'type'>, kind: Exclude<RefKind, 'section' | 'equation'>, key: string): boolean {
  const num = key.split('.').join('\\s*[.\\-–]\\s*');
  const re = new RegExp('(?:^|\\n)\\s*' + CAPTION[kind] + '\\s*' + num + '(?!\\d)');
  return re.test(b.text) && (b.type !== 'p' || b.text.length < 300);
}

/** 带编号的独立公式：\tag{2.3} 或末尾写着 (2.3)。 */
export const isEquationOf = (b: Pick<BookBlock, 'text' | 'type'>, key: string) =>
  b.type === 'eq' && new RegExp('\\\\tag\\{\\s*' + key.replace(/\./g, '\\.') + '\\s*\\}|[（(]\\s*' + key.replace(/\./g, '\\.') + '\\s*[）)]\\s*$').test(b.text);

export interface ResolvedRef {
  ref: BlockRef;
  /** 找到的块（图表连同紧跟的表格、公式块）；小节没有块。 */
  blocks: BookBlock[];
  section?: BookSection;
}

/** 在全书里找这些引用指向的块；找不到的略过（不猜）。 */
export async function resolveRefs(db: Db, bookId: string, sections: BookSection[], refs: BlockRef[]): Promise<ResolvedRef[]> {
  const out: ResolvedRef[] = [];
  for (const ref of refs) {
    if (ref.kind === 'section') {
      const s = sections.find(x => x.id === ref.key);
      if (s) out.push({ ref, blocks: [], section: s });
      continue;
    }
    const words = ref.kind === 'equation' ? [''] : CAPTION_WORDS[ref.kind];
    const likes = [...new Set(words.flatMap(w => [w + ref.key, w + ' ' + ref.key]))];
    const rows = (await db.all<BlockRow>(
      'SELECT * FROM book_block WHERE book_id = ? AND ' + (ref.kind === 'equation' ? "type = 'eq' AND " : '') + '(' + likes.map(() => 'text LIKE ?').join(' OR ') + ') ORDER BY seq LIMIT 40',
      [bookId, ...likes.map(l => '%' + l + '%')],
    )).map(toBlock);
    const hit = rows.find(b => (ref.kind === 'equation' ? isEquationOf(b, ref.key) : isCaptionOf(b, ref.kind as 'figure', ref.key)));
    if (!hit) continue;
    const blocks = [hit];
    // 表题单独一段时，表格在下一块
    if (ref.kind === 'table' && hit.type === 'p') {
      const next = (await db.all<BlockRow>('SELECT * FROM book_block WHERE book_id = ? AND seq = ?', [bookId, hit.seq + 1])).map(toBlock)[0];
      if (next && next.sectionId === hit.sectionId && next.type === 'table') blocks.push(next);
    }
    out.push({ ref, blocks });
  }
  return out;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…（后面省略，需要时 load_section）' : s);

/**
 * 发给模型的 <selected_block>：选的是哪一块、前后两块、用户点选的一句、段里提到的内容、对照译文。
 * 返回文字和新登记可引用的块（别的小节附了原文的）。
 */
export function selectedContext(o: {
  section: BookSection;
  blocks: BookBlock[];
  block: BookBlock;
  sentence?: string;
  resolved: ResolvedRef[];
  sections: BookSection[];
  translation?: string;
}): { text: string; cites: string[] } {
  const { section, blocks, block } = o;
  const id = (b: Pick<BookBlock, 'no' | 'sectionId'>) => '[' + b.sectionId + '#' + b.no + ']';
  const i = blocks.findIndex(b => b.seq === block.seq);
  const prev = i > 0 ? blocks[i - 1] : null;
  const next = i >= 0 && i < blocks.length - 1 ? blocks[i + 1] : null;
  const lines = [
    '<selected_block>',
    '用户在原文里选的是 ' + id(block) + (block.page != null ? '（p.' + block.page + '）' : '') + '，' + secLabel(section) + ' 第 ' + block.no + ' 段；' +
      '前一块 ' + (prev ? id(prev) : '无') + '，后一块 ' + (next ? id(next) : '无') + '。整段原文在 <current_section> 里，讲的时候结合前后文，引用写块号。',
  ];
  if (o.sentence) lines.push('用户点选的是其中这一句：「' + o.sentence.trim() + '」。只讲这一句，整段作背景。');
  const cites: string[] = [];
  const mention: string[] = [];
  for (const r of o.resolved) {
    if (r.section) {
      if (r.section.id !== section.id) mention.push('「' + r.ref.said + '」是 ' + secLabel(r.section) + '（需要细节时 load_section）');
      continue;
    }
    const here = r.blocks.every(b => b.sectionId === section.id);
    if (here) {
      mention.push('「' + r.ref.said + '」在本节 ' + r.blocks.map(id).join('、'));
      continue;
    }
    const s = o.sections.find(x => x.id === r.blocks[0].sectionId);
    mention.push('「' + r.ref.said + '」在 ' + (s ? secLabel(s) : r.blocks[0].sectionId) + '，原文：\n' + r.blocks.map(b => clip(blockText(b.sectionId, b), b.type === 'table' ? 1500 : 800)).join('\n'));
    cites.push(...r.blocks.map(b => b.sectionId + '#' + b.no));
  }
  if (mention.length) lines.push('段里提到的内容：', ...mention.map(m => '- ' + m));
  if (o.translation) lines.push('用户正在看中文对照，这一段的译文是：「' + clip(o.translation, 400) + '」。讲解里的术语和译文保持一致；译文有错时直接指出。');
  lines.push('</selected_block>');
  return { text: lines.join('\n'), cites };
}
