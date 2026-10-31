/**
 * 书的通用小工具：引用和小节的显示名、叶子小节的顺序、内置示例教材。
 */
import { assemble } from './assemble';
import { parseMarkdownBook } from './markdown';
import { SAMPLE_BOOK_MD } from './sample';
import type { AssembledBook, BookBlock, BookSection } from './types';

/** 「3.1 动量因子」「第 3 章 动量与反转」「前言」。 */
export const secLabel = (s: Pick<BookSection, 'no' | 'title'>) =>
  (s.no ? s.no + ' ' : '') + s.title;

/** 引用的显示名：PDF 的块有页码时「p.86」，否则「3.1 ¶2」（没编号的小节用标题开头）。 */
export function citeLabel(
  s: Pick<BookSection, 'id' | 'no' | 'title'>,
  b: Pick<BookBlock, 'no' | 'page'>,
): string {
  if (b.page != null) {
    return 'p.' + b.page;
  }
  const head = /^\d/.test(s.id) ? s.id : s.title.slice(0, 6);
  return head + ' ¶' + b.no;
}

export const leavesOf = (sections: BookSection[]) =>
  sections.filter(s => s.leaf).sort((a, b) => a.ord - b.ord);

export function nextLeaf(
  sections: BookSection[],
  id: string,
): BookSection | null {
  const ls = leavesOf(sections);
  const i = ls.findIndex(s => s.id === id);
  return i >= 0 ? ls[i + 1] ?? null : null;
}

export function sampleBook(): AssembledBook {
  return assemble(parseMarkdownBook(SAMPLE_BOOK_MD));
}
