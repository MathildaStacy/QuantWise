import type { BookBlock } from './types';

/** MinerU's older cached paragraphs can carry an escaped Markdown bullet. Keep storage and citation offsets intact. */
export function bookListItem(b: Pick<BookBlock, 'type' | 'text' | 'mark'>): { marker: string; text: string } | null {
  if (b.type === 'li') return { marker: b.mark ?? '•', text: b.text };
  if (b.type !== 'p') return null;
  const match = /^\s*(?:\\?-|•)\s+(\S[\s\S]*)$/.exec(b.text);
  if (match) return { marker: '•', text: match[1] };
  const numbered = /^\s*(\d{1,3}[.)])\s+(\S[\s\S]*)$/.exec(b.text);
  return numbered ? { marker: numbered[1], text: numbered[2] } : null;
}

/** Applied only to prose tokens after math parsing; never to code or raw TeX. */
export const unescapeBookText = (text: string): string => text.replace(/\\([_*#`[\]-])/g, '$1');
