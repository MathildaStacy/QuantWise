/**
 * 图、表、代码、公式的编号标题（PM 走查第 2 项）：段落菜单和讲解按钮写「表 3.19」「图 3.22」「Snippet 3.6」，没有编号时返回 null（调用方写页码）。
 */
import { blockNumber, blockTitle, numberedLine } from '../../src/book/blockTitle';
import type { BookBlock } from '../../src/book/types';

let seq = 0;
const blk = (o: Partial<BookBlock>): BookBlock => ({ seq: seq++, sectionId: '3.5.3', no: seq, type: 'p', text: '', page: 169, mark: null, image: null, html: null, ...o });

test('图注里的编号和标题；Panel A 没有图注时用后面同一张图的编号', () => {
  const a = blk({ type: 'img', text: 'Panel A：等权', image: 'a.jpg' });
  const b = blk({ type: 'img', text: 'Panel B：市值加权\n图3.21 双重排序构建的动量因子累计收益率', image: 'b.jpg' });
  const c = blk({ type: 'img', text: '图 3.22 动量因子的覆盖率', image: 'c.jpg' });
  const blocks = [a, b, c];
  expect(blockNumber(a, blocks)).toEqual({ kind: 'figure', label: '图 3.21 · Panel A', caption: '双重排序构建的动量因子累计收益率' });
  expect(blockTitle(b, blocks)).toBe('图 3.21 · Panel B');
  expect(blockTitle(c, blocks)).toBe('图 3.22');
  // 后面不是图时不往后找
  const lone = blk({ type: 'img', text: '', image: 'x.jpg' });
  expect(blockTitle(lone, [lone, blk({ text: '图3.23 不相干的段落' })])).toBeNull();
});

test('表题在表格自己的标题里，或在前面单独一段', () => {
  const caption = blk({ text: '表3.19 动量分组的描述性统计' });
  const table = blk({ type: 'table', text: '| 组 | 动量 |\n|---|---|\n| 1 | -0.2 |' });
  expect(blockNumber(table, [caption, table])).toEqual({ kind: 'table', label: '表 3.19', caption: '动量分组的描述性统计' });
  const html = blk({ type: 'table', text: 'Table 4.1: Summary statistics\nA B\n1 2', html: '<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>' });
  expect(blockNumber(html, [html])).toEqual({ kind: 'table', label: 'Table 4.1', caption: 'Summary statistics' });
  const bare = blk({ type: 'table', text: '| A | B |\n| 1 | 2 |' });
  expect(blockTitle(bare, [blk({ text: '下表列出了结果。' }), bare])).toBeNull();
});

test('代码片段标题、公式编号；正文段落不当成图表', () => {
  const head = blk({ text: 'SNIPPET 3.6 Expanding getBins to incorporate meta-labeling' });
  const code = blk({ type: 'code', text: 'def getBins(events, close):\n    ...' });
  expect(blockNumber(code, [head, code])).toEqual({ kind: 'snippet', label: 'Snippet 3.6', caption: 'Expanding getBins to incorporate meta-labeling' });
  expect(blockTitle(blk({ type: 'code', text: '# Snippet 2.1 tick bars\nimport pandas' }), [])).toBe('Snippet 2.1');
  expect(blockTitle(blk({ type: 'eq', text: 'MOM = P_t / P_{t-n} - 1 \\tag{3.2}' }), [])).toBe('式（3.2）');
  expect(blockTitle(blk({ type: 'eq', text: 'r = a + b' }), [])).toBeNull();
  expect(blockTitle(blk({ text: '如图3.22所示，覆盖率逐年上升。' }), [])).toBeNull();
  expect(numberedLine('**Figure 3.1** Triple-barrier method')).toEqual({ kind: 'figure', label: 'Figure 3.1', caption: 'Triple-barrier method' });
  // 「Panels」不是分图标题
  expect(blockTitle(blk({ type: 'img', text: 'Panels show cumulative returns\nFigure 2.3 Wealth', image: 'w.jpg' }), [])).toBe('Figure 2.3');
});
