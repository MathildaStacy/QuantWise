/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { bookTableNotes, firstRows, freezableFirstColumn, headerRowCount, parseBookTable, spansRow, tableRowHeights } from '../../src/book/table';
import { bookListItem, unescapeBookText } from '../../src/book/presentation';

test('合并表头和跨行标签保留在原列，实体和上下标不丢失', () => {
  const table = parseBookTable('', '<table><tr><td colspan="2">Model</td><td>p</td></tr><tr><td rowspan="2">A</td><td>x<sub>1</sub></td><td>&lt; 0.05</td></tr><tr><td>x<sup>2</sup></td><td>0.12</td></tr></table>')!;
  expect(table.columns).toBe(3);
  expect(table.cells.map(c => [c.row, c.col, c.rowSpan, c.colSpan, c.text])).toEqual([
    [0, 0, 1, 2, 'Model'], [0, 2, 1, 1, 'p'],
    [1, 0, 2, 1, 'A'], [1, 1, 1, 1, 'x<sub>1</sub>'], [1, 2, 1, 1, '< 0.05'],
    [2, 1, 1, 1, 'x<sup>2</sup>'], [2, 2, 1, 1, '0.12'],
  ]);
  const heights = tableRowHeights(table, { 2: 150, 3: 60 }, 30);
  expect(heights[1]).toBeGreaterThanOrEqual(60);
  expect(heights[1] + heights[2]).toBeGreaterThanOrEqual(150);
});

test('Markdown 分隔行不会成为正文，空单元格保留', () => {
  const table = parseBookTable('| A | B |\n| :--- | ---: |\n| | -0.2 |')!;
  expect(table.rows).toBe(2);
  expect(table.cells.map(c => c.text)).toEqual(['A', 'B', '', '-0.2']);
  expect(parseBookTable('普通段落')).toBeNull();
});

test('已有解析结果里的表题、来源和表注保留，网格正文不重复', () => {
  expect(bookTableNotes('表 1 风险\nA | B\n1 | 2\n来源：原书', '<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>'))
    .toEqual({ caption: '表 1 风险', footnote: '来源：原书' });
});

test('旧书段落中的转义列表和变量恢复书籍排版，负数和代码不当成列表', () => {
  expect(bookListItem({ type: 'p', mark: null, text: '\\- First point.' })).toEqual({ marker: '•', text: 'First point.' });
  expect(bookListItem({ type: 'p', mark: null, text: '-0.05 is the return.' })).toBeNull();
  expect(bookListItem({ type: 'code', mark: null, text: '- value' })).toBeNull();
  expect(bookListItem({ type: 'p', mark: null, text: '1. Compute the return.' })).toEqual({ marker: '1.', text: 'Compute the return.' });
  expect(unescapeBookText('x\\_reshape[0,0]')).toBe('x_reshape[0,0]');
});

test('宽表冻结行名列：第一列不跨到第二列，占满整行的小标题单独铺开；表头行数不切断跨行格（PM 走查第 1 项）', () => {
  const panel = parseBookTable('', '<table><tr><th>组</th><th>1</th><th>2</th><th>多空</th></tr><tr><td colspan="4">Panel A：等权</td></tr><tr><td>动量</td><td>0.1</td><td>0.2</td><td>0.1</td></tr></table>')!;
  expect(freezableFirstColumn(panel)).toBe(true);
  expect(panel.cells.filter(c => spansRow(panel, c)).map(c => c.text)).toEqual(['Panel A：等权']);
  expect(headerRowCount(panel)).toBe(1);
  // 第一列的格子跨到第二列（不是整行）：不冻结
  expect(freezableFirstColumn(parseBookTable('', '<table><tr><td colspan="2">A</td><td>B</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>')!)).toBe(false);
  expect(freezableFirstColumn(parseBookTable('| A | B |\n| 1 | 2 |')!)).toBe(false);
  // 跨两行的表头：两行一起冻结
  const tall = parseBookTable('', '<table><tr><th rowspan="2">市值</th><th colspan="2">动量</th></tr><tr><th>低</th><th>高</th></tr><tr><td>小</td><td>1</td><td>2</td></tr><tr><td>大</td><td>3</td><td>4</td></tr><tr><td>多空</td><td>5</td><td>6</td></tr></table>')!;
  expect(headerRowCount(tall)).toBe(2);
  // 表头占了一半以上：不冻结
  expect(headerRowCount(parseBookTable('', '<table><tr><th rowspan="2">A</th><th>B</th></tr><tr><th>C</th></tr><tr><td>1</td><td>2</td></tr></table>')!)).toBe(0);
});

test('菜单里的小表只留前几行，跨过截断处的格子截短', () => {
  const rows = ['<tr><th>组</th><th>收益</th></tr>', '<tr><td rowspan="3">A</td><td>1</td></tr>', ...Array.from({ length: 8 }, (_, i) => '<tr><td>' + i + '</td></tr>')];
  const table = parseBookTable('', '<table>' + rows.join('') + '</table>')!;
  const head = firstRows(table, 3);
  expect(head.rows).toBe(3);
  expect(head.cells.every(c => c.row < 3 && c.row + c.rowSpan <= 3)).toBe(true);
  expect(head.cells.find(c => c.text === 'A')?.rowSpan).toBe(2);
  expect(firstRows(table, 20)).toBe(table);
});

const fixture = process.env.QUANTWISE_READING_BLOCKS;
(fixture ? test : test.skip)('六本真实书的全部表格：单元格无遗漏、网格无重叠', () => {
  const blocks = JSON.parse(readFileSync(fixture!, 'utf8')).value.blocks as { type: string; text: string; html: string }[];
  const tables = blocks.filter(b => b.type === 'table' && b.html);
  expect(tables.length).toBeGreaterThan(100);
  for (const b of tables) {
    const table = parseBookTable(b.text, b.html)!;
    expect(table.cells).toHaveLength([...b.html.matchAll(/<t[dh]\b/gi)].length);
    const occupied = new Set<string>();
    for (const cell of table.cells) {
      for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
        for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
          expect(occupied.has(r + ':' + c)).toBe(false);
          occupied.add(r + ':' + c);
        }
      }
    }
  }
});
