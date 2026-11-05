/**
 * 元标签图（pm-reader-lecture-20261105.md 第 10 项）：每次信号一个三角，默认框出最近一次的三道屏障；
 * 点图时框离手指最近的一次；卡片下面是「全部跟主信号 / 只做放行的」对比和结论；全屏数据表每次信号一行。
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Path } from 'react-native-svg';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { md } from '../../src/quant/charts';
import { eventLine, LABEL_DEFAULTS, labelsChart, type LabelsChart } from '../../src/quant/labels';
import type { KBar } from '../../src/market/tencent';
import { ChartCard, legendOf } from '../../src/ui/charts/ChartCard';
import { QuantChart } from '../../src/ui/charts/QuantChart';
import { howToRead, readout, tableRows } from '../../src/ui/charts/quantDraw';

/** 固定的锯齿行情：10 天一个来回，均线隔几天交叉一次，约 5 年。 */
function bars(n: number): KBar[] {
  const out: KBar[] = [];
  const d = new Date(Date.UTC(2020, 0, 6));
  for (let k = 0; out.length < n; k++) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      const i = out.length;
      const p = 50 * (1 + 0.0004 * i) * (1 + 0.06 * Math.sin(i / 3.1) + 0.03 * Math.sin(i / 1.3 + k));
      out.push({ date: d.toISOString().slice(0, 10), open: Math.round(p * 1000), close: Math.round(p * 1000), high: Math.round(p * 1000), low: Math.round(p * 1000), volume: 1e6 + (i % 7) * 1e5 });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const chart: LabelsChart = labelsChart({ code: 'sz300750', name: '宁德时代', bars: bars(1200), input: { ...LABEL_DEFAULTS, fast: 3, slow: 10 } }).chart;
const Stack = createNativeStackNavigator();
const textOf = (n: ReactTestRenderer.ReactTestInstance): string => n.children.map(x => (typeof x === 'string' ? x : textOf(x))).join('');

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
  for (const v of tree.root.findAll(x => x.props.accessibilityRole === 'image' && typeof x.props.onLayout === 'function')) {
    await act(async () => v.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 300 } } }));
  }
  return tree;
}

/** 三角：三个点的闭合路径。 */
const triangles = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll(x => x.type === Path && /^M[\d.]+,[\d.]+L[\d.]+,[\d.]+L[\d.]+,[\d.]+Z$/.test(x.props.d));
/** 图里的字（SVG 的 Text 不在 children 里，从渲染结果里找）。 */
const svgText = (tree: ReactTestRenderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());

test('卡片：每次信号一个三角，默认框出最近一次；下面是对比、结论和那一次的读数', async () => {
  expect(chart.events.length).toBeGreaterThan(8);
  const tree = await mount(<ChartCard data={chart} />);
  // 每次信号一个，框出的那次再画一个大的
  expect(triangles(tree)).toHaveLength(chart.events.length + 1);
  const last = chart.events[chart.events.length - 1];
  const box = tree.root.findAll(x => x.props.fillOpacity === 0.05)[0];
  expect(box).toBeDefined();
  const text = textOf(tree.root);
  expect(text).toContain('元标签 · 宁德时代 · MA3/10 金叉');
  expect(text).toContain('历史回测');
  expect(text).toContain('全部跟主信号');
  expect(text).toContain('只做放行的');
  expect(text).toContain('框出的是最近一次：' + eventLine(chart, last));
  expect(text).toContain('点图上的三角，看那一次信号的三道屏障');
  expect(text).toContain('实心：次级模型放行 · 空心：没放行 · 淡色：预热');
  // 框上写止盈止损离进场价多远
  expect(svgText(tree)).toMatch(/止盈 \+\d+\.\d%/);
  expect(svgText(tree)).toMatch(/止损 -\d+\.\d%/);
  await act(async () => tree.unmount());
});

test('点图：框离手指最近的那次信号，横轴写它的日期；读数、数据表、图例按信号写', async () => {
  const first = chart.events[0];
  const tree = await mount(<QuantChart data={chart} pick={first.i + 1} onPick={() => {}} />);
  expect(svgText(tree)).toContain('"' + md(chart.dates[first.i]) + '"');
  // 框从这次信号的进场那天画起
  const box = tree.root.findAll(x => x.props.fillOpacity === 0.05 && typeof x.props.x === 'number')[0];
  const marks = triangles(tree);
  expect(marks.length).toBe(chart.events.length + 1);
  expect(box.props.x).toBeCloseTo(Number(marks[0].props.d.match(/^M([\d.]+)/)![1]), 0);
  await act(async () => tree.unmount());
  expect(readout(chart, first.i + 1)).toBe(eventLine(chart, first));
  expect(tableRows(chart).map(r => r.text)).toEqual(chart.events.map(m => eventLine(chart, m)));
  expect(legendOf(chart).map(l => l.label)).toEqual(['收盘', 'MA3', 'MA10', '赚了', '亏了', '还没结果', '实心：次级模型放行 · 空心：没放行 · 淡色：预热']);
  expect(howToRead(chart).join('\n')).toContain('红色赚了（元标签 1），绿色亏了（元标签 0）');
});
