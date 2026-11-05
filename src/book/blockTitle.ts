/**
 * 图、表、代码、公式的编号标题（PM 走查第 2 项）：段落菜单的标题、讲解里的按钮写「表 3.19」「图 3.22」「Snippet 3.6」，
 * 没有编号时调用方再写页码。图 3.21 的 Panel A 没有图注（「图3.21 …」挂在后面 Panel B 那张上），就往后找同一张图的图注；
 * 表题、代码标题单独成段时看前面那一段。
 */
import { bookTableNotes } from './table';
import type { BookBlock } from './types';

export type NumberedKind = 'figure' | 'table' | 'snippet' | 'equation';

export interface Numbered {
  kind: NumberedKind;
  /** 「图 3.22」「Table 4.1」「Snippet 3.6」「式（2.3）」。 */
  label: string;
  /** 编号后面的图注、表题（「双重排序构建的动量因子累计收益率」），没有是空串。 */
  caption: string;
}

const NUM = '(\\d+(?:\\s*[.\\-–]\\s*\\d+)*)';
const LINE: [Exclude<NumberedKind, 'equation'>, RegExp][] = [
  ['figure', new RegExp('^(图|Figure|FIGURE|Fig\\.|Exhibit|EXHIBIT)\\s*' + NUM + '(?![\\d.])[\\s:：.、]*(.*)$')],
  ['table', new RegExp('^(表|Table|TABLE)\\s*' + NUM + '(?![\\d.])[\\s:：.、]*(.*)$')],
  ['snippet', new RegExp('^(Snippet|SNIPPET|Listing|LISTING|代码清单|代码片段)\\s*' + NUM + '(?![\\d.])[\\s:：.、]*(.*)$')],
];
const WORD: Record<string, string> = { FIGURE: 'Figure', 'Fig.': 'Figure', EXHIBIT: 'Exhibit', TABLE: 'Table', SNIPPET: 'Snippet', LISTING: 'Listing' };

const plainLine = (s: string) => s.replace(/\*\*|`/g, '').replace(/^#+\s*/, '').trim();

/** 一行文字开头的编号：「图3.22 双重排序…」→ { kind: 'figure', label: '图 3.22', caption: '双重排序…' }。 */
export function numberedLine(line: string): Numbered | null {
  const text = plainLine(line);
  for (const [kind, re] of LINE) {
    const m = re.exec(text);
    if (m) return { kind, label: (WORD[m[1]] ?? m[1]) + ' ' + m[2].replace(/\s+/g, ''), caption: m[3].trim() };
  }
  return null;
}

const lines = (text: string) => text.split('\n').map(x => x.trim()).filter(Boolean);

/** 块自己带的编号：图注、表题、代码第一行的标题、公式的 \tag 或末尾编号；单独成段的表题、图注也算。 */
export function ownNumber(b: Pick<BookBlock, 'type' | 'text' | 'html'>): Numbered | null {
  if (b.type === 'eq') {
    const m = /\\tag\{\s*([^}]+?)\s*\}/.exec(b.text) ?? /[（(]\s*(\d+(?:\.\d+)*)\s*[）)]\s*$/.exec(b.text);
    return m ? { kind: 'equation', label: '式（' + m[1] + '）', caption: '' } : null;
  }
  const scan = (text: string, kind: NumberedKind, max: number) => {
    for (const line of lines(text).slice(0, max)) {
      const n = numberedLine(line);
      if (n && n.kind === kind) return n;
    }
    return null;
  };
  if (b.type === 'img') return scan(b.text, 'figure', 6);
  if (b.type === 'table') return scan(bookTableNotes(b.text, b.html ?? null).caption || b.text, 'table', 2);
  if (b.type === 'code') return scan(lines(b.text)[0]?.replace(/^(?:#|\/\/|--)\s*/, '') ?? '', 'snippet', 1);
  if (b.type === 'p' && b.text.length < 200) return numberedLine(lines(b.text)[0] ?? '');
  return null;
}

/** 分图的小标题：「Panel A」「(a)」。 */
function panelOf(b: Pick<BookBlock, 'text'>): string {
  const m = /(?:^|\n)\s*((?:Panel|PANEL)\s*[A-Z](?![A-Za-z])|[（(][a-h][)）])/.exec(b.text);
  return m ? m[1].replace(/^panel\s*/i, 'Panel ') : '';
}

/**
 * 菜单和按钮上的编号，以及编号后面的图注、表题。只看图、表、代码、公式；图没有图注时往后看一两块同一张图的图注，
 * 表、代码没有时看前面那一段是不是单独的表题、代码标题。都没有返回 null（调用方写页码）。
 */
export function blockNumber(b: BookBlock, blocks: BookBlock[]): Numbered | null {
  if (b.type !== 'img' && b.type !== 'table' && b.type !== 'code' && b.type !== 'eq') return null;
  const own = ownNumber(b);
  const panel = b.type === 'img' ? panelOf(b) : '';
  if (own) return panel ? { ...own, label: own.label + ' · ' + panel } : own;
  const i = blocks.findIndex(x => x.seq === b.seq);
  if (i < 0) return null;
  if (b.type === 'img') {
    for (const next of blocks.slice(i + 1, i + 3)) {
      if (next.type !== 'img') break;
      const n = ownNumber(next);
      if (n) return panel ? { ...n, label: n.label + ' · ' + panel } : n;
    }
    return null;
  }
  const prev = blocks[i - 1];
  const n = prev?.type === 'p' ? ownNumber(prev) : null;
  return n && n.kind === (b.type === 'table' ? 'table' : 'snippet') ? n : null;
}

/** 「表 3.19」；没有编号时 null。 */
export const blockTitle = (b: BookBlock, blocks: BookBlock[]) => blockNumber(b, blocks)?.label ?? null;
