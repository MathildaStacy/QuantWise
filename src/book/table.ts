import { DomUtils, parseDocument } from 'htmlparser2';
import type { AnyNode } from 'domhandler';
import { tableText } from '../study/import/mineruAdapter';

export interface BookCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  header: boolean;
}
export interface BookTableData { cells: BookCell[]; rows: number; columns: number }

/** Older imports store caption + searchable grid + footnotes together. Recover only the exact grid span. */
export function bookTableNotes(text: string, html?: string | null): { caption: string; footnote: string } {
  if (!html) return { caption: '', footnote: '' };
  const grid = tableText(html);
  const at = grid ? text.indexOf(grid) : -1;
  return at >= 0 ? { caption: text.slice(0, at).trim(), footnote: text.slice(at + grid.length).trim() }
    : { caption: text.trim(), footnote: '' };
}

function cellText(node: AnyNode): string {
  if (node.type === 'text') return node.data;
  if (!DomUtils.isTag(node)) return '';
  const text = node.children.map(cellText).join('');
  if (node.name === 'br') return '\n';
  if (node.name === 'sup' || node.name === 'sub') return '<' + node.name + '>' + text + '</' + node.name + '>';
  if (node.name === 'b' || node.name === 'strong') return '**' + text + '**';
  return text;
}

/** Preserve the original grid, including cells occupied by earlier rowspans. No book content is executed. */
export function parseBookTable(text: string, html?: string | null): BookTableData | null {
  const source = html ? DomUtils.findAll(n => n.name === 'tr', parseDocument(html).children).map(tr =>
    tr.children.filter(n => DomUtils.isTag(n) && /^(td|th)$/.test(n.name)).map(n => {
      if (!DomUtils.isTag(n)) throw new Error('Expected table cell');
      const span = (key: string) => Math.max(1, Math.min(100, parseInt(n.attribs[key], 10) || 1));
      return { text: n.children.map(cellText).join('').trim(), rowSpan: span('rowspan'), colSpan: span('colspan'), header: n.name === 'th' };
    }),
  ) : text.trim().split('\n').filter(line => /^\s*\|/.test(line) && !/^\s*\|?[\s:|-]+\|\s*$/.test(line)).map(line =>
    line.trim().replace(/^\||\|$/g, '').split('|').map(value => ({ text: value.trim(), rowSpan: 1, colSpan: 1, header: false })),
  );
  if (!source.length) return null;
  const occupied = new Set<string>();
  const cells: BookCell[] = [];
  let columns = 0;
  source.forEach((row, r) => {
    let col = 0;
    for (const cell of row) {
      while (Array.from({ length: cell.colSpan }, (_, c) => occupied.has(r + ':' + (col + c))).some(Boolean)) col++;
      const rowSpan = Math.min(cell.rowSpan, source.length - r);
      cells.push({ ...cell, row: r, col, rowSpan, header: cell.header || r === 0 });
      for (let y = r; y < r + rowSpan; y++) {
        for (let x = col; x < col + cell.colSpan; x++) occupied.add(y + ':' + x);
      }
      col += cell.colSpan;
      columns = Math.max(columns, col);
    }
  });
  return cells.length ? { cells, rows: source.length, columns } : null;
}

/** A spanning cell can grow its rows, but never steal space from a neighbouring cell. */
export function tableRowHeights(table: BookTableData, measured: Record<number, number>, minimum: number): number[] {
  const heights = Array<number>(table.rows).fill(minimum);
  table.cells.forEach((cell, i) => {
    if (cell.rowSpan === 1) heights[cell.row] = Math.max(heights[cell.row], measured[i] ?? 0);
  });
  table.cells.forEach((cell, i) => {
    const available = heights.slice(cell.row, cell.row + cell.rowSpan).reduce((a, b) => a + b, 0);
    const extra = Math.max(0, (measured[i] ?? 0) - available);
    if (extra) heights[cell.row + cell.rowSpan - 1] += extra;
  });
  return heights;
}

/**
 * 行名列能不能冻结（PM 走查第 1 项：宽表横滑后行名跟着滑走）：至少两列数据，第一列的格子都不跨到第二列；
 * 占满整行的格子（「Panel A：等权」这类小标题）除外，冻结时单独铺满可见宽度。
 */
export function freezableFirstColumn(table: BookTableData): boolean {
  return table.columns >= 3 && table.cells.every(c => c.col > 0 || c.colSpan === 1 || c.colSpan === table.columns);
}

/** 第一列里占满整行的小标题格：冻结第一列时不放进行名列。 */
export const spansRow = (table: BookTableData, c: BookCell) => c.col === 0 && c.colSpan === table.columns && table.columns > 1;

/**
 * 表头占几行（全屏看表时上下滑动也冻结）：从第 0 行起，全是表头格、或被上面的格子跨行占着的那几行。
 * 占到一半以上时不冻结，返回 0。
 */
export function headerRowCount(table: BookTableData): number {
  const crosses = (n: number) => table.cells.some(c => c.row < n && c.row + c.rowSpan > n);
  const header = (r: number) => table.cells.filter(c => c.row === r).every(c => c.header);
  let n = 1;
  while (n < table.rows && (crosses(n) || header(n))) n++;
  return n * 2 > table.rows ? 0 : n;
}

/** 只留前 n 行（段落菜单里的小表预览）；跨过第 n 行的格子截短。 */
export function firstRows(table: BookTableData, n: number): BookTableData {
  if (table.rows <= n) return table;
  return { rows: n, columns: table.columns, cells: table.cells.filter(c => c.row < n).map(c => ({ ...c, rowSpan: Math.min(c.rowSpan, n - c.row) })) };
}
