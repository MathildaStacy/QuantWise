/**
 * 书里的分组收益表（pm-reader-lecture-20261105.md 第 11 项）：从 MinerU / EPUB 的表格 HTML 或 Markdown 表格里
 * 取一行每组的数，按 Panel、行名选；合并到本次的组数；两边的秩相关由 App 算。
 */
import { bookRowOf, fitGroups, type BookRow } from '../../src/study/bookTable';

/**
 * 仿《因子投资》表 3.20：两个 Panel，每个 Panel 一行表头、一行「均值(t 值)」，最后一列是多空。Panel A 前 4 组是书里的数，
 * 后 6 组是编的：倒 U 形，秩相关和书里写的一样是 −0.333。
 */
const T320 = [
  '<table>',
  '<tr><td colspan="11">Panel A: 等权重</td></tr>',
  '<tr><td>Low</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td><td>9</td><td>High</td><td>High-Low</td></tr>',
  '<tr><td>1.19(1.60)</td><td>1.32(1.78)</td><td>1.47(1.97)</td><td>1.50(2.00)</td><td>1.38(1.85)</td><td>1.44(1.93)</td><td>1.36(1.82)</td><td>1.40(1.88)</td><td>1.17(1.50)</td><td>1.15(1.42)</td><td>-0.04(-0.14)</td></tr>',
  '<tr><td colspan="11">Panel B: 市值加权</td></tr>',
  '<tr><td>Low</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td><td>9</td><td>High</td><td>High-Low</td></tr>',
  '<tr><td>0.80(1.10)</td><td>0.95(1.30)</td><td>0.70(1.00)</td><td>0.90(1.20)</td><td>1.00(1.35)</td><td>0.85(1.15)</td><td>0.75(1.02)</td><td>0.98(1.33)</td><td>0.82(1.12)</td><td>0.88(1.05)</td><td>0.08(0.20)</td></tr>',
  '</table>',
].join('');
const TEXT = '表3.20 动量变量单变量排序月均收益率（%）\nPanel A: 等权重\n…';

test('表 3.20：按 Panel 取一行，月均、百分数，多空列单独记；秩相关按原书 10 组算', () => {
  const a = bookRowOf({ text: TEXT, html: T320 }, { cite: '3.5.3#14', panel: 'A' }) as BookRow;
  expect(a).toMatchObject({ label: '表3.20 Panel A: 等权重', cite: '3.5.3#14', unit: 'monthly', spread: { mean: -0.04, t: -0.14 } });
  expect(a.raw).toEqual([1.19, 1.32, 1.47, 1.5, 1.38, 1.44, 1.36, 1.4, 1.17, 1.15]);
  expect(a.rho).toBeCloseTo(-1 / 3, 6);
  // Panel 可以写字母、「Panel B」或标题里的字
  for (const panel of ['B', 'Panel B', '市值']) {
    expect((bookRowOf({ text: TEXT, html: T320 }, { cite: 'x', panel }) as BookRow).spread).toEqual({ mean: 0.08, t: 0.2 });
  }
  expect(bookRowOf({ text: TEXT, html: T320 }, { cite: 'x' })).toBe('这张表有几个 Panel（Panel A: 等权重、Panel B: 市值加权），用 book_panel 写要对照哪一个');
  expect(bookRowOf({ text: TEXT, html: T320 }, { cite: 'x', panel: 'C' })).toBe('没有「C」这个 Panel；这张表有：Panel A: 等权重、Panel B: 市值加权');
});

test('10 组合到 5 组：每相邻 2 组取平均；5 组拆到 10 组；组数一样不合并', () => {
  const a = bookRowOf({ text: TEXT, html: T320 }, { cite: '3.5.3#14', panel: 'A' }) as BookRow;
  const five = fitGroups(a, 5);
  expect(five.values).toEqual([1.255, 1.485, 1.41, 1.38, 1.16]);
  expect(five.merged).toBe('原书 10 组，每相邻 2 组取平均');
  // 书中的秩相关按原书 10 组算（合并后不重算）
  expect(five.rho).toBeCloseTo(-1 / 3, 6);
  const back = fitGroups({ ...a, raw: five.values }, 10);
  expect(back.values.slice(0, 4)).toEqual([1.255, 1.255, 1.485, 1.485]);
  expect(back.merged).toBe('原书 5 组，每组对应本次 2 组');
  expect(fitGroups(a, 10).merged).toBeUndefined();
  // 10 → 3：按分位重叠加权，第一组 = 前 3⅓ 组
  const three = fitGroups(a, 3);
  expect(three.values[0]).toBeCloseTo((1.19 + 1.32 + 1.47 + 1.5 / 3) / (10 / 3), 4);
  expect(three.merged).toBe('原书 10 组，按分位重叠加权合成 3 组');
});

test('双重排序表：左边合并的「市值组」、行名 Small / 2 / Big，按 book_row 选；t 值另起一行也认', () => {
  const html = [
    '<table>',
    '<tr><td>市值组</td><td></td><td>Low</td><td>2</td><td>3</td><td>High</td><td>High-Low</td></tr>',
    '<tr><td rowspan="3">市值组</td><td>Small</td><td>1.10</td><td>1.30</td><td>1.20</td><td>1.00</td><td>-0.10</td></tr>',
    '<tr><td>2</td><td>0.90</td><td>1.00</td><td>1.10</td><td>1.20</td><td>0.30</td></tr>',
    '<tr><td>Big</td><td>0.50</td><td>0.60</td><td>0.70</td><td>0.80</td><td>0.30</td></tr>',
    '<tr><td></td><td></td><td>(2.10)</td><td>(2.20)</td><td>(2.30)</td><td>(2.40)</td><td>(1.05)</td></tr>',
    '</table>',
  ].join('');
  const text = '表3.21 动量与市值双重排序月均收益率（%）';
  expect(bookRowOf({ text, html }, { cite: 'x' })).toBe('这个 Panel 有几行（Small、2、Big），用 book_row 写要对照哪一行');
  expect(bookRowOf({ text, html }, { cite: 'x', row: 'Mid' })).toBe('没有「Mid」这一行（Small、2、Big），用 book_row 写要对照哪一行');
  const small = bookRowOf({ text, html }, { cite: 'x', row: 'small' }) as BookRow;
  expect(small).toMatchObject({ label: '表3.21 Small', raw: [1.1, 1.3, 1.2, 1], spread: { mean: -0.1, t: null } });
  // 「2」精确匹配这一行，不会匹配到别的行
  expect((bookRowOf({ text, html }, { cite: 'x', row: '2' }) as BookRow).raw).toEqual([0.9, 1, 1.1, 1.2]);
  // t 值另起一行：接到上一行（Big）每一格
  expect((bookRowOf({ text, html }, { cite: 'x', row: 'Big' }) as BookRow).spread).toEqual({ mean: 0.3, t: 1.05 });
});

test('表头从高到低（High … Low）时倒过来，多空换号；Markdown 表格、没写单位、小数写法也认', () => {
  const md = ['表 5 Momentum deciles', '| | High | 2 | 3 | Low | H-L |', '|---|---|---|---|---|---|', '| Mean | 0.012 | 0.010 | 0.009 | 0.006 | 0.006 |'].join('\n');
  const r = bookRowOf({ text: md, html: null }, { cite: '5.1#3' }) as BookRow;
  expect(r.raw.map(v => Number(v.toFixed(4)))).toEqual([0.6, 0.9, 1, 1.2]);
  expect(r.spread?.mean).toBeCloseTo(-0.6, 6);
  expect(r).toMatchObject({ unit: 'unknown', label: '表5 Mean' });
  expect(r.rho).toBeCloseTo(1, 6);
  expect(bookRowOf({ text: '| a | b |\n|---|---|\n| 1 | 2 |', html: null }, { cite: 'x' })).toBe('这张表里没找到「Low、2、…、High」这样的分组表头和每组的数');
  expect(bookRowOf({ text: '没有表格', html: null }, { cite: 'x' })).toBe('这一块不是能读出单元格的表格');
});
