/// <reference types="node" />
/**
 * 因子检验的图（pm-reader-lecture-20261105.md 第 8、12、13 项）：一次检验一张结果卡，只换加权方式的合成一张；
 * IC 图的噪声带、累计 IC 的右侧刻度和线尾的数、按走势写的「怎么看」；读对照文字时钉的结果条。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { runFactorTest } from '../../src/quant/backtest';
import { chartTitle, factorCharts, priceChart, type ChartData, type FactorChart, type IcChart } from '../../src/quant/charts';
import { buildPanel, type Panel } from '../../src/quant/factors';
import { isAStock } from '../../src/quant/universe';
import type { KBar } from '../../src/market/tencent';
import { chartFoot, legendOf } from '../../src/ui/charts/ChartCard';
import { factorRows, relevance, type PinSpot } from '../../src/ui/charts/ChartPin';
import { chartItems, FactorResult, runLine, type ChartItem } from '../../src/ui/charts/FactorResult';
import { QuantChart } from '../../src/ui/charts/QuantChart';
import { howComputed, howToRead, icTrend } from '../../src/ui/charts/quantDraw';

const snap = JSON.parse(readFileSync(join(__dirname, '../../docs/design/prototype/snapshot-2026-10-26.json'), 'utf8')) as {
  kline: Record<string, [string, number, number, number, number, number][]>;
  quotes: Record<string, { name: string }>;
};
const barsOf = (code: string): KBar[] =>
  snap.kline[code].map(([date, o, c, h, l, v]) => ({ date, open: Math.round(o * 1000), close: Math.round(c * 1000), high: Math.round(h * 1000), low: Math.round(l * 1000), volume: v * 100 }));

/** 快照里的个股，市值各不相同（市值加权和等权才不一样）。 */
function panel(): Panel {
  const codes = Object.keys(snap.kline).filter(c => isAStock(c) && snap.kline[c].length >= 240);
  const bars = new Map(codes.map(c => [c, barsOf(c)]));
  const meta = new Map(codes.map((c, k) => [c, { name: snap.quotes[c].name, totalCap: 1000 * (k + 1) ** 2, floatCap: 800 * (k + 1) ** 2 }]));
  return buildPanel(bars, meta);
}

const p = panel();
const equal = factorCharts(runFactorTest(p, { factor: 'mom20', hold: 20, groups: 5, costBp: 0 }), 'sample', '示例池（25 只大盘股）');
const cap = factorCharts(runFactorTest(p, { factor: 'mom20', hold: 20, groups: 5, costBp: 0, weight: 'cap' }), 'sample', '示例池（25 只大盘股）');
const Stack = createNativeStackNavigator();

const textOf = (n: ReactTestRenderer.ReactTestInstance): string =>
  n.children.map(x => (typeof x === 'string' ? x : textOf(x))).join('');

async function mount(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="T">{() => node}</Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>,
    );
  });
  /** 量出宽度后才画 SVG：手动触发每张图的 onLayout。 */
  const layout = async () => {
    for (const v of tree.root.findAll(n => n.props.accessibilityRole === 'image' && typeof n.props.onLayout === 'function')) {
      await act(async () => v.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 300 } } }));
    }
  };
  await layout();
  const press = async (label: string) => {
    const hit = tree.root.findAll(n => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || textOf(n) === label))[0];
    if (!hit) throw new Error('没有「' + label + '」');
    await act(async () => hit.props.onPress());
    await layout();
  };
  const text = () => textOf(tree.root);
  const chart = () => tree.root.findAll(n => n.type === QuantChart)[0].props.data as ChartData;
  return { tree, press, text, chart };
}

test('三张图带同一份口径和统计：标题写加权方式、IC 图有噪声带，页脚写 t 值和为正期数', () => {
  const [nav, ic, groups] = equal;
  expect(nav.kind === 'factor' && nav.stats).toMatchObject({ weight: 'equal', groups: 5, hold: 20, avgStocks: expect.any(Number), icPositive: expect.any(Number) });
  expect(ic.kind === 'ic' && ic.stats).toEqual(nav.kind === 'factor' && nav.stats);
  const n = (nav as FactorChart).stats!.avgStocks!;
  expect((ic as IcChart).noise).toBeCloseTo(2 / Math.sqrt(n - 1), 2);
  expect(chartTitle(nav)).toBe('分组净值 · 20 日动量 · 等权');
  expect(chartTitle(cap[0])).toBe('分组净值 · 20 日动量 · 市值加权');
  expect(chartTitle(ic)).toBe('Rank IC · 每期 · 20 日动量');
  expect(chartTitle(groups)).toBe('各组每期平均收益 · 20 日动量 · 等权');
  expect(chartFoot(nav)).toMatch(/^示例池 · 等权 · 5 组 · 每 20 日调仓 · \d+ 期 · 当前成分$/);
  const st = (ic as IcChart).stats!;
  expect(chartFoot(ic)).toBe((ic as IcChart).ic.length + ' 期 · 均值 ' + (st.icMean > 0 ? '+' : '') + st.icMean.toFixed(3) + '（t ' + st.icT.toFixed(2) + '）· 为正 ' + st.icPositive + '/' + (ic as IcChart).ic.length);
  // 图例：默认只列最高、最低两组；噪声带写每期几只
  expect(legendOf(nav, true).map(l => l.label)).toEqual(['Q1 因子最低', 'Q5 因子最高', '全池等权基准', '多空（最高 − 最低）']);
  expect(legendOf(nav).map(l => l.label)).toContain('Q3');
  expect(legendOf(ic).pop()).toEqual({ color: expect.any(String), label: '没有预测力时约 95% 在这里（每期 ' + n + ' 只）', kind: 'band' });
  // 市值加权的口径说明不再写「等权持有」，基准写明仍是等权
  expect(howComputed(cap[0]).join('\n')).toContain('每组按调仓日总市值加权持有');
  expect(howToRead(cap[0]).join('\n')).toContain('这次各组是市值加权，基准仍是等权');
});

test('「怎么看」按 IC 的实际走势写：一路向上、来回摆动；大部分柱子在噪声带里时提醒看均值和 t 值', () => {
  const base = equal[1] as IcChart;
  const rising: IcChart = { ...base, ic: Array.from({ length: 24 }, (_, i) => 0.12 + (i % 3) * 0.02), stats: undefined, noise: 0.41 };
  expect(icTrend(rising)[0]).toMatch(/^这次累计 IC 一路向上（到 \+3\.36）/);
  expect(icTrend(rising)[1]).toBe('24 期里 24 期的柱子在灰色噪声带里：单期 IC 多半是噪声，看均值和 t 值，不看某一期');
  const swing: IcChart = { ...rising, ic: [0.3, 0.3, -0.5, -0.5, 0.4, 0.3, -0.4, 0.1] };
  // 累加后最后是 -1e-16 这样的浮点误差：写 0.00，不写 -0.00
  expect(icTrend(swing)[0]).toBe('这次累计 IC 来回摆动（最高 +0.60、最低 -0.40，最后 0.00）：方向不稳定');
  expect(icTrend({ ...swing, noise: 0.2 })).toHaveLength(1);
  expect(howToRead(rising).join('\n')).not.toContain('一路向上，说明因子的方向长期稳定');
});

test('IC 图：灰色噪声带、累计 IC 的刻度写在右侧，线尾写「累计 …」；各组收益图叠书里的数（空心点）', async () => {
  const ic = equal[1] as IcChart;
  const cum = ic.ic.reduce((a, b) => a + b, 0);
  const r = await mount(<QuantChart data={ic} />);
  const json = JSON.stringify(r.tree.toJSON());
  expect(json).toContain('"fillOpacity":0.07');
  expect(json).toContain('累计 ' + (cum > 0 ? '+' : '') + cum.toFixed(2));
  await act(async () => r.tree.unmount());
  const groups = equal[2];
  const withBook = { ...groups, book: { label: '表3.20 Panel A: 等权重', cite: '3.5.3#14', raw: [1.19, 1.32, 1.47, 1.5, 1.38, 1.44, 1.36, 1.4, 1.17, 1.15], values: [1.255, 1.485, 1.41, 1.38, 1.16], merged: '原书 10 组，每相邻 2 组取平均', unit: 'monthly' as const, rho: -1 / 3 } };
  expect(chartTitle(withBook)).toBe('各组月均收益（折算）· 20 日动量 · 等权');
  const g = await mount(<QuantChart data={withBook} />);
  expect(g.tree.root.findAll(n => n.props.stroke === '#9A6400' && n.props.r === 4)).toHaveLength(5);
  await act(async () => g.tree.unmount());
});

test('一问里的图排成卡片：等权、市值加权两次检验合成一张卡（第二次的位置上不再出现），别的图照常一张张', () => {
  const price = priceChart({ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750') }).chart;
  const items = chartItems([[...equal], [price], [...cap]]);
  expect(items.map(list => list.map(x => x.kind))).toEqual([['factor'], ['chart'], []]);
  const card = items[0][0] as Extract<ChartItem, { kind: 'factor' }>;
  expect(card.runs.map(x => x.nav.stats?.weight)).toEqual(['equal', 'cap']);
  expect(card.runs[1].ic).toBe(cap[1]);
  expect(card.runs[1].groups).toBe(cap[2]);
  // 别的因子、旧图（没有 stats）、同一加权跑两次：不合并
  const other = factorCharts(runFactorTest(p, { factor: 'mom60', hold: 20, groups: 5, costBp: 0 }), 'sample');
  const old = equal.map(c => ({ ...c, stats: undefined })) as ChartData[];
  expect(chartItems([[...equal], [...other], old, [...equal]]).map(list => list.length)).toEqual([1, 1, 1, 1]);
  expect(runLine(card.runs[0])).toMatch(/^20 日动量 · 示例池 \d+ 期 · 等权 多空 [-+]\d+\.\d{2}%（t -?\d+\.\d{2}）· IC [-+]?\d\.\d{3}（t -?\d+\.\d{2}）$/);
});

test('结果卡：统计一行、「历史回测」，净值 / IC / 各组切换，等权 / 市值加权切换；默认只画最高最低两组', async () => {
  const card = chartItems([[...equal, ...cap]])[0][0] as Extract<ChartItem, { kind: 'factor' }>;
  const saved: FactorChart[] = [];
  const r = await mount(<FactorResult runs={card.runs} onSave={c => saved.push(c)} hint />);
  expect(r.text()).toContain('因子检验 · 20 日动量');
  expect(r.text()).toContain('历史回测');
  expect(r.text()).not.toContain('真实行情');
  expect(r.text()).toContain('点一下或按住拖动，看每一天的数');
  const eq = (equal[0] as FactorChart).stats!;
  expect(r.text()).toContain('t ' + eq.longShortT.toFixed(2));
  expect(r.chart()).toBe(equal[0]);
  expect(r.text()).not.toContain('Q3');
  await r.press('看全部分组');
  expect(r.text()).toContain('Q3');
  await r.press('把这次检验存进研究手记');
  expect(saved).toEqual([equal[0]]);
  await r.press('市值加权');
  expect(r.chart()).toBe(cap[0]);
  expect(r.text()).toContain('t ' + (cap[0] as FactorChart).stats!.longShortT.toFixed(2));
  await r.press('IC：每期 Rank IC');
  expect(r.chart()).toBe(cap[1]);
  expect(r.text()).toContain('IC 只看排名，等权和市值加权两次一样');
  expect(r.text()).toContain('点一下或按住拖动，看每一期的数');
  await r.press('各组：各组收益');
  expect(r.chart()).toBe(cap[2]);
  await act(async () => r.tree.unmount());
  // 一问只写一次操作提示
  const quiet = await mount(<FactorResult runs={[card.runs[0]]} hint={false} />);
  expect(quiet.text()).not.toContain('点一下或按住拖动');
  await act(async () => quiet.tree.unmount());
});

test('读对照文字时钉的结果条：同一问里滚过的结果卡每次检验一行；讲解提到因子名或多空、IC 时算相关', () => {
  const card = chartItems([[...equal, ...cap]])[0][0] as Extract<ChartItem, { kind: 'factor' }>;
  const other = chartItems([factorCharts(runFactorTest(p, { factor: 'mom60', hold: 20, groups: 5, costBp: 0 }), 'sample')])[0][0] as Extract<ChartItem, { kind: 'factor' }>;
  const spots = new Map<string, PinSpot>([
    ['a', { turn: 1, y: 100, h: 500, data: card.runs[0].nav, runs: card.runs }],
    ['b', { turn: 1, y: 700, h: 500, data: other.runs[0].nav, runs: other.runs }],
    ['c', { turn: 2, y: 50, h: 500, data: other.runs[0].nav, runs: other.runs }],
  ]);
  expect(factorRows(spots, 'b').map(x => x.key + ':' + x.run.nav.stats?.weight)).toEqual(['a:equal', 'a:cap', 'b:equal']);
  expect(factorRows(spots, 'a')).toHaveLength(2);
  expect(relevance(equal[0], '对照书里的数：本次 20 日动量多空为负')).toBe(1.5);
  expect(relevance(equal[0], '下一节讲波动率')).toBe(0);
});
