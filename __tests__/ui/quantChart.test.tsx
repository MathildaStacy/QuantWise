/// <reference types="node" />
/**
 * 行情图的每种画法都画一遍（Jest 里系统字号是 2 倍，顺便压一压大字号）：价格图的六种副图、均线和布林带、
 * 对比图的区间、全屏十字线。量出宽度后才画 SVG，所以手动触发 onLayout。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { compareChart, fmtSub, md, pct, priceChart, type ChartData, type PriceChart, type SubKind } from '../../src/quant/charts';
import type { KBar } from '../../src/market/tencent';
import { ChartCard } from '../../src/ui/charts/ChartCard';
import { ChartPin, pinOf, relevance, type PinSpot } from '../../src/ui/charts/ChartPin';
import { QuantChart } from '../../src/ui/charts/QuantChart';
import { HOLD_MS, LockScroll } from '../../src/ui/charts/scrub';

const snap = JSON.parse(
  readFileSync(join(__dirname, '../../docs/design/prototype/snapshot-2026-10-26.json'), 'utf8'),
) as { kline: Record<string, [string, number, number, number, number, number][]> };
const barsOf = (code: string): KBar[] =>
  snap.kline[code].map(([date, o, c, h, l, v]) => ({
    date,
    open: Math.round(o * 1000),
    close: Math.round(c * 1000),
    high: Math.round(h * 1000),
    low: Math.round(l * 1000),
    volume: v * 100,
  }));
const SEP = [{ from: '2026-09-01', to: '2026-09-30', label: '9 月' }];
const Stack = createNativeStackNavigator();

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
  const charts = tree.root.findAll(n => n.props.accessibilityRole === 'image' && typeof n.props.onLayout === 'function');
  for (const v of charts) {
    await act(async () => {
      v.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 300 } } });
    });
  }
  return { tree, charts };
}

async function drawn(node: React.ReactElement) {
  const { tree } = await mount(node);
  const json = JSON.stringify(tree.toJSON());
  await act(async () => tree.unmount());
  return json;
}

/** 图上的两层触摸：外层（读屏的那张图）要跟手时抢过来，里层先接住点一下、按住。 */
function layers(tree: ReactTestRenderer.ReactTestRenderer) {
  const outer = tree.root.findAll(n => n.props.accessibilityRole === 'image' && typeof n.props.onMoveShouldSetResponderCapture === 'function')[0];
  const inner = outer.findAll(n => typeof n.props.onStartShouldSetResponder === 'function')[0];
  return { outer, inner };
}
/** 手指在图里横坐标 x 处（图左边在页面里是 6，卡片的内边距）。 */
const at = (x: number, pageY = 300) => ({ nativeEvent: { pageX: 6 + x, pageY, locationX: x, locationY: pageY - 100 } });
const dayChange = (c: PriceChart, i: number) => pct(c.close[i] / c.close[i - 1] - 1, 2);

test.each<[SubKind | 'none', string[]]>([
  ['none', ['前收 363.55', '"9/1"', '"9/30"', 'MA20']],
  ['mom20', ['"20 日动量"', '"0%"']],
  ['mom60', ['"60 日动量"']],
  ['vol20', ['"20 日年化波动"']],
  ['dd', ['"回撤"', '"0%"']],
  ['rsi14', ['RSI(14)：70 以上超买，30 以下超卖', '"70"', '"30"']],
  ['volume', ['"成交量"', '万']],
])('价格图 + %s 副图：画得出来，刻度和名字都在', async (sub, expected) => {
  const c = priceChart({ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750'), ma: 20, band: sub === 'none', ...(sub === 'none' ? {} : { sub }), focus: SEP, points: [{ date: '2026-09-15', label: '放量急跌' }], takeaway: '看 9 月' }).chart;
  const json = await drawn(<ChartCard data={c} />);
  for (const t of expected) {
    expect(json).toContain(t);
  }
  expect(json).toContain('-19.93%');
  expect(json).toContain('看点');
});

test('对比图：区间前一个交易日 = 100，区间右缘写每只的区间涨跌，100 基准刻度', async () => {
  const c = compareChart(
    [
      { code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750') },
      { code: 'sh600036', name: '招商银行', bars: barsOf('sh600036') },
    ],
    { focus: SEP },
  ).chart;
  const json = await drawn(<ChartCard data={c} />);
  expect(json).toContain('"9 月"');
  expect(json).toContain('"100"');
  expect(json).toContain('9 月 · 9/1–9/30 · 21 个交易日');
  expect(json).toContain('宁德时代 / 招商银行 · 8/31 = 100');
  expect(json).toContain('8/31 收盘 = 100 · ');
  // 区间右缘的标签（描边一遍、正文一遍）+ 图下读数一遍
  expect(json.split('"-19.93%"').length - 1).toBe(3);
});

test('两段区间首尾相接（9 月、10 月）：交界那天只画一个点、写一次价格，不再写第二个「前收」', async () => {
  const c = priceChart({ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750'), sub: 'mom20', focus: [...SEP, { from: '2026-10-01', to: '2026-10-31', label: '10 月' }] }).chart;
  const json = await drawn(<ChartCard data={c} />);
  // 每个标签描边一遍、正文一遍，按不同的值数
  expect([...new Set(json.match(/前收 [\d.]+/g))]).toEqual(['前收 363.55']);
  // 9 月末收盘：前一段的终点，也是后一段的基数
  expect(json).toContain('"291.11"');
  expect(json).not.toContain('前收 291.11');
  expect(json).not.toContain('9/30–10/8');
  expect(json).toContain('10 月 · 10/8–10/26 · 13 个交易日');
  // 副图在区间两端标出动量（8/31 是 9 月的基数，9/30 是 9 月终点也是 10 月的基数，10/26 是 10 月终点），交界那天只写一次
  const p = c as PriceChart;
  const mom = (d: string) => '"' + fmtSub('mom20', p.sub!.values[p.dates.indexOf(d)]!) + '"';
  for (const d of ['2026-08-31', '2026-09-30', '2026-10-26']) {
    expect(json).toContain(mom(d));
  }
  // 每个标签描边一遍、正文一遍
  expect(json.split(mom('2026-09-30')).length - 1).toBe(2);
});

test('卡片里点图：十字线画在卡片里，图下写当天读数（收盘、当日涨跌、副图值），点 × 收起；没点时有提示', async () => {
  const c = priceChart({ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750'), sub: 'mom20', focus: SEP }).chart as PriceChart;
  const { tree } = await mount(<ChartCard data={c} />);
  const text = () => JSON.stringify(tree.toJSON());
  expect(text()).toContain('点一下或按住拖动，看每一天的数');
  const { inner } = layers(tree);
  await act(async () => {
    inner.props.onResponderGrant(at(200));
    inner.props.onResponderRelease(at(200));
  });
  const picked = text();
  expect(picked).not.toContain('点一下或按住拖动，看每一天的数');
  const line = /"(2026-\d\d-\d\d) 收盘 ([\d.]+)（当日 [+-]?[\d.]+%(?:，较前收 [+-]?[\d.]+%)?） · 20 日动量 [^"]+"/.exec(picked);
  expect(line).not.toBeNull();
  const i = c.dates.indexOf(line![1]);
  expect(line![2]).toBe(c.close[i].toFixed(2));
  // 十字线的读数牌：卡片里横轴上写短日期（「9/15」），收起后少一个；副图值也写在副图的刻度栏里
  const badge = '"' + md(line![1]) + '"';
  const withBadge = picked.split(badge).length;
  expect(withBadge).toBeGreaterThan(1);
  expect(picked).not.toContain('"' + line![1] + '"');
  expect(picked).toContain('"' + fmtSub('mom20', c.sub!.values[i]!) + '"');
  // 松手了：图顶不浮读数牌（当日涨跌只在图下的读数里）
  expect(picked).not.toContain('"' + dayChange(c, i) + '"');
  // 不在讲解里（没有 onAsk）时不出「问这一天」
  expect(tree.root.findAll(n => n.props.accessibilityLabel === '就这一天提问')).toHaveLength(0);
  const close = tree.root.findAll(n => n.props.accessibilityLabel === '收起这一天的读数' && typeof n.props.onPress === 'function')[0];
  await act(async () => close.props.onPress());
  expect(text()).toContain('点一下或按住拖动，看每一天的数');
  expect(text().split(badge).length).toBe(withBadge - 1);
  await act(async () => tree.unmount());
});

test('讲解里的卡片：点中一天后「问这一天」带上图名和读数；「怎么看」展开读图说明', async () => {
  const c = priceChart({ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750'), sub: 'mom20', focus: SEP }).chart as PriceChart;
  const ask = jest.fn();
  const { tree } = await mount(<ChartCard data={c} onAsk={ask} />);
  const text = () => JSON.stringify(tree.toJSON());
  const button = (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  expect(button('就这一天提问')).toBeUndefined();
  const { inner } = layers(tree);
  await act(async () => {
    inner.props.onResponderGrant(at(200));
    inner.props.onResponderRelease(at(200));
  });
  await act(async () => button('就这一天提问').props.onPress());
  expect(ask).toHaveBeenCalledTimes(1);
  expect(ask.mock.calls[0][0]).toMatch(/^看图中这一天：宁德时代 · 20 日动量，2026-\d\d-\d\d 收盘 [\d.]+（当日 .+。$/);
  expect(text()).not.toContain('下面的柱子是 20 日动量');
  await act(async () => button('怎么看这张图').props.onPress());
  expect(text()).toContain('下面的柱子是 20 日动量');
  expect(text()).toContain('黄色区间是讲解里说到的那段');
  await act(async () => tree.unmount());
});

describe('卡片里按住拖动看每一天', () => {
  const c = priceChart({ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750'), sub: 'mom20', focus: SEP }).chart as PriceChart;
  const dateOf = (json: string) => /"(2026-\d\d-\d\d) 收盘 /.exec(json)?.[1] ?? null;
  afterEach(() => jest.useRealTimers());

  it('左右拖：外层马上接手并拦住页面滚动；十字线跟着手指走，移出图外也按页面坐标算；手指在图上时图顶有读数牌，松手后收起、读数留着', async () => {
    const { tree } = await mount(<ChartCard data={c} />);
    const text = () => JSON.stringify(tree.toJSON());
    const { inner, outer } = layers(tree);
    await act(async () => inner.props.onResponderGrant(at(100)));
    // 刚按下：还不出十字线
    expect(dateOf(text())).toBeNull();
    // 竖着动：不接手，交给页面滚动
    expect(outer.props.onMoveShouldSetResponderCapture(at(103, 330))).toBe(false);
    // 横着拖过 6dp：接手；grant 返回 true = 拦住页面滚动；里层被换下来
    expect(outer.props.onMoveShouldSetResponderCapture(at(110, 303))).toBe(true);
    let blocked: unknown;
    await act(async () => {
      blocked = outer.props.onResponderGrant(at(110, 303));
      inner.props.onResponderTerminate();
    });
    expect(blocked).toBe(true);
    expect(outer.props.onResponderTerminationRequest()).toBe(false);
    const d1 = dateOf(text())!;
    expect(d1).not.toBeNull();
    const i1 = c.dates.indexOf(d1);
    expect(text()).toContain('"' + dayChange(c, i1) + '"');
    // 往右下拖：只看横坐标。locationX 已经不以图为准（手指在别的元素上），按页面坐标算
    await act(async () => outer.props.onResponderMove({ nativeEvent: { pageX: 6 + 250, pageY: 520, locationX: 3 } }));
    const d2 = dateOf(text())!;
    expect(d2 > d1).toBe(true);
    await act(async () => outer.props.onResponderMove({ nativeEvent: { pageX: 6 + 250, pageY: 160, locationX: 90 } }));
    expect(dateOf(text())).toBe(d2);
    // 拖出图的右边：停在最后一天
    await act(async () => outer.props.onResponderMove(at(900, 300)));
    expect(dateOf(text())).toBe(c.dates[c.dates.length - 1]);
    await act(async () => outer.props.onResponderRelease(at(900, 300)));
    const after = text();
    expect(dateOf(after)).toBe(c.dates[c.dates.length - 1]);
    expect(after).not.toContain('"' + dayChange(c, c.dates.length - 1) + '"');
    await act(async () => tree.unmount());
  });

  it('按住一会儿：十字线出来，之后往哪个方向移都跟手、页面不滚', async () => {
    const { tree } = await mount(<ChartCard data={c} />);
    const text = () => JSON.stringify(tree.toJSON());
    const { inner, outer } = layers(tree);
    jest.useFakeTimers();
    await act(async () => inner.props.onResponderGrant(at(150)));
    // 手指抖了 2dp：还算按住
    await act(async () => inner.props.onResponderMove(at(152, 302)));
    expect(dateOf(text())).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(HOLD_MS);
    });
    const d1 = dateOf(text())!;
    expect(d1).not.toBeNull();
    expect(text()).toContain('"' + dayChange(c, c.dates.indexOf(d1)) + '"');
    // 按住之后竖着移也接手
    expect(outer.props.onMoveShouldSetResponderCapture(at(152, 360))).toBe(true);
    await act(async () => {
      outer.props.onResponderGrant(at(152, 360));
      inner.props.onResponderTerminate();
    });
    await act(async () => outer.props.onResponderMove(at(60, 420)));
    expect(dateOf(text())! < d1).toBe(true);
    await act(async () => outer.props.onResponderRelease(at(60, 420)));
    expect(dateOf(text())! < d1).toBe(true);
    await act(async () => tree.unmount());
  });

  it('一开始就上下滑：不出十字线；按住后被页面滚动抢走：收回按住时画的十字线，回到按之前那天', async () => {
    const { tree } = await mount(<ChartCard data={c} />);
    const text = () => JSON.stringify(tree.toJSON());
    const { inner, outer } = layers(tree);
    jest.useFakeTimers();
    // 上下滑：外层不接手，页面滚动把触摸抢走
    await act(async () => inner.props.onResponderGrant(at(150)));
    await act(async () => inner.props.onResponderMove(at(151, 312)));
    expect(outer.props.onMoveShouldSetResponderCapture(at(151, 312))).toBe(false);
    await act(async () => {
      inner.props.onResponderTerminate();
      jest.advanceTimersByTime(HOLD_MS);
    });
    expect(text()).toContain('点一下或按住拖动，看每一天的数');
    // 先点一天，再在别处按住：十字线挪过去；页面滚动抢走后回到先点的那天
    await act(async () => {
      inner.props.onResponderGrant(at(80));
      inner.props.onResponderRelease(at(80));
    });
    const tapped = dateOf(text());
    await act(async () => inner.props.onResponderGrant(at(260)));
    await act(async () => {
      jest.advanceTimersByTime(HOLD_MS);
    });
    expect(dateOf(text())).not.toBe(tapped);
    await act(async () => inner.props.onResponderTerminate());
    expect(dateOf(text())).toBe(tapped);
    await act(async () => tree.unmount());
  });

  it('放在 LockScroll 里：按住到时间、左右拖接手时锁住外面的滚动，松手解开；点一下、上下滑不锁', async () => {
    const { tree } = await mount(
      <LockScroll>
        <ChartCard data={c} />
      </LockScroll>,
    );
    const scrollable = () => tree.root.findAll(n => typeof n.props.scrollEnabled === 'boolean')[0].props.scrollEnabled;
    const { inner, outer } = layers(tree);
    expect(scrollable()).toBe(true);
    jest.useFakeTimers();
    await act(async () => inner.props.onResponderGrant(at(150)));
    await act(async () => {
      jest.advanceTimersByTime(HOLD_MS);
    });
    expect(scrollable()).toBe(false);
    await act(async () => inner.props.onResponderRelease(at(150)));
    expect(scrollable()).toBe(true);
    // 左右拖：外层接手时锁
    await act(async () => inner.props.onResponderGrant(at(150)));
    await act(async () => {
      outer.props.onResponderGrant(at(170, 302));
      inner.props.onResponderTerminate();
    });
    expect(scrollable()).toBe(false);
    await act(async () => outer.props.onResponderRelease(at(170, 302)));
    expect(scrollable()).toBe(true);
    // 点一下、上下滑：从头到尾不锁
    await act(async () => inner.props.onResponderGrant(at(150)));
    expect(scrollable()).toBe(true);
    await act(async () => inner.props.onResponderRelease(at(150)));
    await act(async () => inner.props.onResponderGrant(at(150)));
    await act(async () => inner.props.onResponderMove(at(150, 330)));
    await act(async () => {
      inner.props.onResponderTerminate();
      jest.advanceTimersByTime(HOLD_MS);
    });
    expect(scrollable()).toBe(true);
    await act(async () => tree.unmount());
  });

  it('对比图：拖动时每条线上一个点，图顶的读数牌写每只这一天的值；松手后只留图下读数', async () => {
    const cc = compareChart(
      [
        { code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750') },
        { code: 'sh600036', name: '招商银行', bars: barsOf('sh600036') },
      ],
      { focus: SEP },
    ).chart as Extract<ChartData, { kind: 'compare' }>;
    const { tree } = await mount(<ChartCard data={cc} />);
    const text = () => JSON.stringify(tree.toJSON());
    const { inner, outer } = layers(tree);
    await act(async () => inner.props.onResponderGrant(at(120)));
    expect(outer.props.onMoveShouldSetResponderCapture(at(130, 301))).toBe(true);
    await act(async () => {
      outer.props.onResponderGrant(at(130, 301));
      inner.props.onResponderTerminate();
    });
    const line = /"(2026-\d\d-\d\d) · 宁德时代 [\d.]+ · 招商银行 [\d.]+/.exec(text());
    expect(line).not.toBeNull();
    const i = cc.dates.indexOf(line![1]);
    const vals = cc.series.map(s => '"' + s.values[i].toFixed(1) + '"');
    for (const v of vals) {
      expect(text()).toContain(v);
    }
    await act(async () => outer.props.onResponderRelease(at(130, 301)));
    for (const v of vals) {
      expect(text()).not.toContain(v);
    }
    await act(async () => tree.unmount());
  });
});

test('没有区间的旧图照常画：最新价标签、月份横轴，没有区间标签', async () => {
  const c = priceChart({ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750'), n: 250 }).chart;
  const json = await drawn(<ChartCard data={c} />);
  expect(json).toContain('"239.52"');
  expect(json).toContain('"2026年"');
  expect(json).not.toContain('前收');
});

test('全屏十字线：一按下就出来，竖线、横线，刻度栏写收盘价、横轴写日期', async () => {
  const c = priceChart({ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750'), focus: SEP }).chart as PriceChart;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  const picks: (number | null)[] = [];
  await act(async () => {
    tree = ReactTestRenderer.create(<QuantChart data={c} full onPick={i => picks.push(i)} />);
  });
  const v = tree.root.findAll(n => typeof n.props.onLayout === 'function')[0];
  await act(async () => v.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 700 } } }));
  const { inner } = layers(tree);
  await act(async () => inner.props.onResponderGrant(at(200)));
  const json = JSON.stringify(tree.toJSON());
  expect(picks).toHaveLength(1);
  const i = picks[0]!;
  expect(json).toContain('"' + c.dates[i] + '"');
  expect(json).toContain('"' + c.close[i].toFixed(2) + '"');
  // 手指还按着：图顶的读数牌写当日涨跌；还没松手时左右移也跟着走
  expect(json).toContain('"' + dayChange(c, i) + '"');
  await act(async () => inner.props.onResponderMove(at(260, 302)));
  expect(picks[picks.length - 1]).toBeGreaterThan(i);
  await act(async () => inner.props.onResponderRelease(at(260, 302)));
  await act(async () => tree.unmount());
});

describe('图文同屏：钉住的小图', () => {
  const spot = (turn: number, y: number, h = 200): PinSpot => ({ turn, y, h, data: priceChart({ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750'), focus: SEP }).chart });
  const turns = new Map([[1, { y: 0, height: 1200 }], [2, { y: 1200, height: 900 }]]);
  const view = (top: number) => ({ top, height: 400 });
  const key = (...a: Parameters<typeof pinOf>) => pinOf(...a)?.key ?? null;

  it('画线区域滚出视窗顶部六成以上、这一问还在读：钉最靠后的那张；滚回来、读到下一问、收起过都不钉', () => {
    const spots = new Map([['a', spot(1, 100)], ['b', spot(1, 600)], ['c', spot(2, 100)]]);
    // a 的画线区域 100–300：露出一半时不钉，滚过六成时钉
    expect(key(spots, turns, view(180), new Set())).toBeNull();
    expect(key(spots, turns, view(240), new Set())).toBe('a');
    // a、b 都滚过去了：钉后面的 b
    expect(key(spots, turns, view(760), new Set())).toBe('b');
    // 第 1 问只剩视窗上面不到三成（1200 < 1100 + 120）：不钉第 1 问的图；第 2 问的图还没到
    expect(key(spots, turns, view(1100), new Set())).toBeNull();
    // 第 2 问的图滚过去：钉 c
    expect(key(spots, turns, view(1200 + 230), new Set())).toBe('c');
    // 收起过第 1 问：第 1 问的图都不钉
    expect(key(spots, turns, view(760), new Set([1]))).toBeNull();
    // 这一问还没量出位置、图高为 0：不钉
    expect(key(new Map([['x', spot(9, 0)], ['y', spot(1, 0, 0)]]), turns, view(500), new Set())).toBeNull();
  });

  it('这一问没画图、讲的是前面的图：钉前面最相关的一张；不提图、名字、区间名，或这一问自己画了图（含因子图）时不钉', () => {
    const catl = priceChart({ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750'), sub: 'mom20', focus: [...SEP, { from: '2026-10-01', to: '2026-10-31', label: '10 月' }] }).chart;
    const pair = compareChart([{ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750') }, { code: 'sh600036', name: '招商银行', bars: barsOf('sh600036') }], { focus: SEP }).chart;
    const spots = new Map<string, PinSpot>([['p', { turn: 1, y: 100, h: 200, data: catl }], ['c', { turn: 1, y: 600, h: 200, data: pair }]]);
    const info = (text: string, charts = 0) => (id: number) => (id === 2 ? { text, charts } : { text: '', charts: 2 });
    const reading2 = view(1300);
    // 简称、区间名都提到：价格图两个区间都提到，比只有 9 月的对比图更相关；收起时记的是正在读的第 2 问
    expect(pinOf(spots, turns, reading2, new Set(), info('宁德九月末……时代的 9 月、10 月末动量'))).toEqual({ key: 'p', reading: 2 });
    // 一样相关（都只提到「图中」）：取最近的
    expect(key(spots, turns, reading2, new Set(), info('看图中黄色区间'))).toBe('c');
    // 提到招商银行：只有对比图里有它
    expect(key(spots, turns, reading2, new Set(), info('招商银行 9 月'))).toBe('c');
    // 不提图、名字、区间名：不钉
    expect(key(spots, turns, reading2, new Set(), info('换手率越高，交易成本越高'))).toBeNull();
    // 这一问自己画了图（例如因子检验的三张图）：不借前面的图
    expect(key(spots, turns, reading2, new Set(), info('看图中 Q5 组', 3))).toBeNull();
    // 在这一问收起过：不钉
    expect(key(spots, turns, reading2, new Set([2]), info('看图中黄色区间'))).toBeNull();
  });

  it('相关程度：提到图 0.5、名字或代码 1、每个区间名 1；只认名字里相邻的两个汉字', () => {
    const c = priceChart({ code: 'sh600519', name: '贵州茅台', bars: barsOf('sz300750'), focus: [{ from: '2026-09-01', to: '2026-09-30', label: '九月' }] }).chart;
    expect(relevance(c, '茅台九月末')).toBe(2);
    expect(relevance(c, '600519 在图中')).toBe(1.5);
    expect(relevance(c, '贵 州')).toBe(1);
    expect(relevance(c, '州 x 台')).toBe(0);
    expect(relevance(c, '换手')).toBe(0);
  });

  it('价格图：标题行写名字和区间涨跌，下一行写区间两端的副图值；小图里有区间起止日、整刻度，不画副图、不写前收；× 收起', async () => {
    const c = priceChart({ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750'), sub: 'mom20', ma: 20, focus: SEP, points: [{ date: '2026-09-15', label: '放量急跌' }] }).chart as PriceChart;
    const closed: number[] = [];
    const { tree } = await mount(<ChartPin data={c} onClose={() => closed.push(1)} />);
    const v = tree.root.findAll(n => n.props.accessibilityRole === 'image' && typeof n.props.onLayout === 'function');
    for (const x of v) {
      await act(async () => x.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 130 } } }));
    }
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('"宁德时代"');
    expect(json).toContain('" 9 月 "');
    expect(json).toContain('"-19.93% "');
    expect(json).toContain('"9/1"');
    expect(json).toContain('"9/30"');
    expect(json).toContain('"300"');
    expect(json).not.toContain('前收');
    expect(json).not.toContain('放量急跌');
    // 副图不画（没有副图的刻度和 0 线标签），区间两端的值写在标题下一行：8/31 … → 9/30 …（和卡片的区间读数同一份数）
    expect(json).not.toContain('"0%"');
    const mom = (d: string) => '"' + fmtSub('mom20', c.sub!.values[c.dates.indexOf(d)]!) + '"';
    expect(json).toContain('"20 日动量  "');
    expect(json).toContain('"8/31 "');
    expect(json).toContain('" → 9/30 "');
    expect(json).toContain(mom('2026-08-31'));
    expect(json).toContain(mom('2026-09-30'));
    const close = tree.root.findAll(n => n.props.accessibilityLabel === '收起钉住的图' && typeof n.props.onPress === 'function')[0];
    await act(async () => close.props.onPress());
    expect(closed).toEqual([1]);
    await act(async () => tree.unmount());
  });

  it('两段首尾相接：副图值接着写「8/31 … → 9/30 … → 10/26 …」，交界那天只写一次', async () => {
    const c = priceChart({ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750'), sub: 'mom20', focus: [...SEP, { from: '2026-10-01', to: '2026-10-31', label: '10 月' }] }).chart as PriceChart;
    const { tree } = await mount(<ChartPin data={c} onClose={() => undefined} />);
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('"8/31 "');
    expect(json.split('" → 9/30 "').length - 1).toBe(1);
    expect(json).toContain('" → 10/26 "');
    expect(json).not.toContain('"9/30 "');
    expect(json).toContain('" 10 月 "');
    await act(async () => tree.unmount());
  });

  it('对比图：标题行是图例和区间名，每只的区间涨跌写在小图的区间右缘', async () => {
    const c = compareChart(
      [
        { code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750') },
        { code: 'sh600036', name: '招商银行', bars: barsOf('sh600036') },
      ],
      { focus: SEP },
    ).chart as Extract<ChartData, { kind: 'compare' }>;
    const { tree } = await mount(<ChartPin data={c} onClose={() => undefined} />);
    for (const x of tree.root.findAll(n => n.props.accessibilityRole === 'image' && typeof n.props.onLayout === 'function')) {
      await act(async () => x.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 130 } } }));
    }
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('" 宁德时代"');
    expect(json).toContain('" 招商银行"');
    expect(json).toContain('" 9 月 "');
    expect(json).toContain('"-19.93%"');
    expect(json).toContain('"100"');
    await act(async () => tree.unmount());
  });
});
