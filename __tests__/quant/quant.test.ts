/// <reference types="node" />
/**
 * 因子引擎（QUANTWISE_DESIGN.md §7）：指标、分组回测、图表数据。
 * 和原型对账：用原型同一份快照日线（26 只个股约 250 个交易日），结果和 quant.js 算出的一样。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFactorTest, SampleError, testSummary } from '../../src/quant/backtest';
import { compareChart, factorCharts, priceChart } from '../../src/quant/charts';
import { buildPanel, FACTORS, type Panel } from '../../src/quant/factors';
import {
  bollinger,
  drawdown,
  momentum,
  ranks,
  rsi,
  sma,
  spearman,
} from '../../src/quant/indicators';
import { isAStock, lastClosedDay } from '../../src/quant/universe';
import { TradingCalendar } from '../../src/engine/calendar';
import { T } from '../../src/engine/session';
import type { KBar } from '../../src/market/tencent';

const snap = JSON.parse(
  readFileSync(join(__dirname, '../../docs/design/prototype/snapshot-2026-10-26.json'), 'utf8'),
) as { kline: Record<string, [string, number, number, number, number, number][]>; quotes: Record<string, { name: string }> };

const barsOf = (code: string): KBar[] =>
  snap.kline[code].map(([date, o, c, h, l, v]) => ({
    date,
    open: Math.round(o * 1000),
    close: Math.round(c * 1000),
    high: Math.round(h * 1000),
    low: Math.round(l * 1000),
    volume: v * 100,
  }));

function snapshotPanel(): Panel {
  const codes = Object.keys(snap.kline).filter(c => isAStock(c) && snap.kline[c].length >= 240);
  const bars = new Map(codes.map(c => [c, barsOf(c)]));
  const meta = new Map(codes.map(c => [c, { name: snap.quotes[c].name, totalCap: 1000, floatCap: 800 }]));
  return buildPanel(bars, meta);
}

describe('指标', () => {
  it('均线、动量、回撤、布林带', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(momentum([10, 11, 12.1], 1).map(x => x && +x.toFixed(4))).toEqual([null, 0.1, 0.1]);
    expect(drawdown([10, 12, 9, 12.5])).toEqual([0, 0, -0.25, 0]);
    const bb = bollinger([1, 2, 3], 3, 2);
    expect(bb.mid[2]).toBe(2);
    expect(bb.upper[2]).toBeCloseTo(2 + 2 * Math.sqrt(2 / 3), 10);
  });

  it('RSI：一直涨是 100，涨跌各半在 50 附近', () => {
    expect(rsi([1, 2, 3, 4, 5], 3)[4]).toBe(100);
    const zig = Array.from({ length: 40 }, (_, i) => 10 + (i % 2));
    expect(rsi(zig, 14)[39]).toBeGreaterThan(45);
    expect(rsi(zig, 14)[39]).toBeLessThan(55);
  });

  it('名次并列取平均，斯皮尔曼和单调变换无关', () => {
    expect(ranks([3, 1, 3, 2])).toEqual([3.5, 1, 3.5, 2]);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [1, 8, 27, 64])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });
});

describe('分组回测和原型对账', () => {
  const p = snapshotPanel();

  it('面板：26 只个股、251 个交易日', () => {
    expect(p.codes).toHaveLength(26);
    expect(p.dates).toHaveLength(251);
    expect(p.dates[0]).toBe('2025-10-14');
  });

  it.each([
    ['mom20', 20, 9, 0.094, 0.92, 0.652, 0.7],
    ['mom60', 20, 9, 0.109, 0.88, 0.619, 0.4],
    ['vol20', 5, 37, 0.112, 2.02, 0.212, 0.17],
    ['rev20', 10, 18, -0.06, -0.7, -0.596, 0.6],
  ] as const)('%s 每 %i 日：期数、IC、t、多空年化、换手和原型一致', (factor, hold, periods, ic, t, ls, turn) => {
    const r = runFactorTest(p, { factor, hold, groups: 5, costBp: 0, start: 61 });
    expect(r.periods).toBe(periods);
    expect(r.icMean).toBeCloseTo(ic, 3);
    expect(r.t).toBeCloseTo(t, 2);
    expect(r.longShortAnnual).toBeCloseTo(ls, 3);
    expect(r.turnover).toBeCloseTo(turn, 2);
    expect(r.groupNav).toHaveLength(5);
    expect(r.dates).toHaveLength(periods + 1);
  });

  it('成本只扣最高组和最低组；扣费后多空收益变小', () => {
    const a = runFactorTest(p, { factor: 'mom20', hold: 20, groups: 5, costBp: 0 });
    const b = runFactorTest(p, { factor: 'mom20', hold: 20, groups: 5, costBp: 30 });
    expect(b.groupNav[2]).toEqual(a.groupNav[2]);
    expect(b.longShortAnnual).toBeLessThan(a.longShortAnnual);
    expect(b.groupNav[4][b.groupNav[4].length - 1]).toBeLessThan(a.groupNav[4][a.groupNav[4].length - 1]);
  });

  it('样本不够时报错：12-1 月动量要 252 天，这份数据只有 251 天', () => {
    expect(() => runFactorTest(p, { factor: 'mom12_1', hold: 20, groups: 5, costBp: 0 })).toThrow(SampleError);
  });

  it('近似因子用今天的市值往回推；摘要里写明口径和怎么读', () => {
    const r = runFactorTest(p, { factor: 'size', hold: 20, groups: 5, costBp: 15 });
    expect(r.periods).toBeGreaterThan(5);
    const text = testSummary(r, '示例池');
    expect(text).toContain('小市值');
    expect(text).toContain('近似');
    expect(text).toContain('单边成本 万 15');
    expect(text).toContain('幸存者偏差');
    expect(FACTORS.turn20.value(p, 'sh600036', 100)).toBeLessThan(0);
  });

  it('图表数据：三张图，长度和期数对得上', () => {
    const r = runFactorTest(p, { factor: 'mom20', hold: 20, groups: 5, costBp: 0 });
    const [nav, ic, groups] = factorCharts(r, 'sample');
    expect(nav).toMatchObject({ kind: 'factor', universe: 'sample' });
    expect(nav.kind === 'factor' && nav.groups[0]).toHaveLength(r.periods + 1);
    expect(ic.kind === 'ic' && ic.ic).toHaveLength(r.periods);
    expect(groups.kind === 'groups' && groups.means).toHaveLength(5);
  });
});

describe('价格图和对比图', () => {
  it('副图在全部 K 线上预热：图的第一天就有 20 日动量，摘要里的极值和标注一致', () => {
    const { chart, text } = priceChart({ code: 'sz300750', name: '宁德时代', bars: barsOf('sz300750'), n: 200, ma: 20, sub: 'mom20', marks: true });
    expect(chart.kind).toBe('price');
    if (chart.kind !== 'price') {
      return;
    }
    expect(chart.dates).toHaveLength(200);
    expect(chart.sub!.values[0]).not.toBeNull();
    expect(chart.ma!.values[0]).not.toBeNull();
    expect(chart.marks).toHaveLength(2);
    expect(text).toContain('20 日动量：最高');
    expect(text).toContain(chart.marks![0].date);
  });

  it('对比图只用共同交易日，起点都是 100', () => {
    const { chart, text } = compareChart(
      [
        { code: 'sh600036', name: '招商银行', bars: barsOf('sh600036') },
        { code: 'sh510300', name: '沪深300ETF', bars: barsOf('sh510300') },
      ],
      { n: 120 },
    );
    expect(chart.kind === 'compare' && chart.series.map(s => s.values[0])).toEqual([100, 100]);
    expect(chart.kind === 'compare' && chart.dates).toHaveLength(120);
    expect(text).toContain('起点 = 100');
  });

  it('已经收盘的交易日', () => {
    const cal = new TradingCalendar();
    expect(lastClosedDay(cal, { date: '2026-10-30', t: T(16, 0) })).toBe('2026-10-30');
    expect(lastClosedDay(cal, { date: '2026-10-30', t: T(10, 0) })).toBe('2026-10-29');
    expect(lastClosedDay(cal, { date: '2026-11-01', t: T(10, 0) })).toBe('2026-10-30');
  });
});
