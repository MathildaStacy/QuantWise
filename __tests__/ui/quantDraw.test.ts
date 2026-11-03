/// <reference types="node" />
/**
 * 行情图的刻度和区间几何（src/ui/charts/quantDraw.ts）：整刻度、按跨度选的时间刻度、横轴上优先写的日期、
 * 区间的横向范围、十字线读数。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceChart, type PriceChart } from '../../src/quant/charts';
import type { KBar } from '../../src/market/tencent';
import {
  axisLabels,
  bandX,
  focusAt,
  howComputed,
  labelWidth,
  niceTicks,
  readout,
  tickDecimals,
  timeTicks,
} from '../../src/ui/charts/quantDraw';

const snap = JSON.parse(
  readFileSync(join(__dirname, '../../docs/design/prototype/snapshot-2026-10-26.json'), 'utf8'),
) as { kline: Record<string, [string, number, number, number, number, number][]> };
const bars: KBar[] = snap.kline.sz300750.map(([date, o, c, h, l, v]) => ({
  date,
  open: Math.round(o * 1000),
  close: Math.round(c * 1000),
  high: Math.round(h * 1000),
  low: Math.round(l * 1000),
  volume: v * 100,
}));
const dates = bars.map(b => b.date);

test('整刻度：1 / 2 / 2.5 / 5 × 10ⁿ，至少 2 个', () => {
  expect(niceTicks(182.3, 247.9)).toEqual({ ticks: [200, 220, 240], step: 20 });
  expect(niceTicks(0.95, 1.32)).toEqual({ ticks: [1, 1.1, 1.2, 1.3], step: 0.1 });
  expect(niceTicks(4.512, 4.738).ticks).toEqual([4.55, 4.6, 4.65, 4.7]);
  // 动量副图 -23% 到 +18%：太窄的范围也给两个刻度
  expect(niceTicks(-0.23, 0.18, 3).ticks.length).toBeGreaterThanOrEqual(2);
  expect(niceTicks(5, 5)).toEqual({ ticks: [5], step: 1 });
  expect([25, 2.5, 0.25, 0.5, 0.02, 20].map(tickDecimals)).toEqual([0, 1, 2, 1, 2, 0]);
});

test('文字宽度：汉字一个字号、数字约 0.6 个', () => {
  expect(labelWidth('9月', 10)).toBeCloseTo(15.8, 5);
  expect(labelWidth('2026年', 10)).toBeCloseTo(33.2, 5);
});

describe('时间刻度', () => {
  const ok = (major: { i: number; label: string }[], x: (i: number) => number, size: number) =>
    major.every((t, k) => k === 0 || x(t.i) - x(major[k - 1].i) >= (labelWidth(t.label, size) + labelWidth(major[k - 1].label, size)) / 2 + 8);

  it('一年的日 K 在手机宽度上标月份（放不下就隔月），跨年写年份，标签不挤', () => {
    const x = (i: number) => (i * 330) / (dates.length - 1);
    const t = timeTicks(dates, x, 11);
    expect(t.major.length).toBeGreaterThanOrEqual(5);
    expect(t.major.every(m => /^(\d{1,2}月|\d{4}年)$/.test(m.label))).toBe(true);
    expect(t.major.map(m => m.label)).toContain('2026年');
    expect(ok(t.major, x, 11)).toBe(true);
    // 刻度落在每个月的第一个交易日
    for (const m of t.major) {
      expect(dates[m.i].slice(0, 7)).not.toBe(dates[m.i - 1].slice(0, 7));
    }
  });

  it('宽一点的图逐月标注；没写标签的月份边界是小刻度', () => {
    const x = (i: number) => (i * 1200) / (dates.length - 1);
    const t = timeTicks(dates, x, 11);
    expect(t.major.map(m => m.label).slice(0, 3)).toEqual(['11月', '12月', '2026年']);
    const narrow = timeTicks(dates, i => (i * 250) / (dates.length - 1), 11);
    expect(narrow.minor.length).toBeGreaterThan(0);
  });

  it('两个月以内按周标「9/7」', () => {
    const d = dates.slice(-40);
    const x = (i: number) => (i * 330) / (d.length - 1);
    const t = timeTicks(d, x, 11);
    expect(t.major.length).toBeGreaterThanOrEqual(3);
    expect(t.major.every(m => /^\d{1,2}\/\d{1,2}$/.test(m.label))).toBe(true);
    expect(ok(t.major, x, 11)).toBe(true);
  });

  it('区间起止日优先写，和它重叠的月份标签不写；同一段的头尾挨得太近合并成「9/1–9/3」', () => {
    const x = (i: number) => i * 4;
    const major = [{ i: 10, label: '8月' }, { i: 31, label: '9月' }, { i: 52, label: '10月' }];
    const r = axisLabels(major, [{ x: x(31), label: '9/1', tone: 'focus', band: 0 }, { x: x(51), label: '9/30', tone: 'focus', band: 0 }], x, 11, 400);
    expect(r.major.map(m => m.label)).toEqual(['8月']);
    expect(r.pinned.map(p => p.label)).toEqual(['9/1', '9/30']);
    const close = axisLabels([], [{ x: 100, label: '9/1', tone: 'focus', band: 0 }, { x: 108, label: '9/3', tone: 'focus', band: 0 }], x, 11, 400);
    expect(close.pinned).toEqual([{ x: 104, label: '9/1–9/3', tone: 'focus' }]);
    // 两段区间首尾相接（9 月、10 月）：后一段的第一天让给前一段的最后一天，不串成「9/30–10/8–10/30」
    const two = axisLabels(
      [],
      [
        { x: x(0), label: '9/1', tone: 'focus', band: 0 },
        { x: x(20), label: '9/30', tone: 'focus', band: 0 },
        { x: x(21), label: '10/8', tone: 'focus', band: 1 },
        { x: x(37), label: '10/30', tone: 'focus', band: 1 },
      ],
      x,
      11,
      400,
    );
    expect(two.pinned.map(p => p.label)).toEqual(['9/1', '9/30', '10/30']);
    // 标注日和区间日期挤在一起：先给的区间日期优先
    expect(axisLabels([], [{ x: 100, label: '9/1', tone: 'focus', band: 0 }, { x: 104, label: '9/2', tone: 'point' }], x, 11, 400).pinned.map(p => p.label)).toEqual(['9/1']);
    // 贴边的日期往里挪，不出图
    expect(axisLabels([], [{ x: 398, label: '10/26', tone: 'point' }], x, 11, 400).pinned[0].x).toBeLessThanOrEqual(400 - labelWidth('10/26', 11) / 2);
  });
});

describe('重点区间', () => {
  const c = priceChart({ code: 'sz300750', name: '宁德时代', bars, ma: 20, focus: [{ from: '2026-09-01', to: '2026-09-30', label: '9 月' }] }).chart as PriceChart;

  it('区间每个交易日占一格：从第一天格子的左边到最后一天格子的右边', () => {
    const a = c.dates.indexOf('2026-09-01');
    const b = c.dates.indexOf('2026-09-30');
    expect(bandX(c.dates, c.focus![0], i => i * 10)).toEqual({ x1: a * 10 - 5, x2: b * 10 + 5 });
    expect(bandX(c.dates, { from: '2026-12-01', to: '2026-12-31', label: 'x' }, i => i)).toBeNull();
  });

  it('十字线在区间里时读数末尾注明，数据表里不写；口径说明写区间涨跌怎么算', () => {
    const i = c.dates.indexOf('2026-09-15');
    expect(focusAt(c, i)?.label).toBe('9 月');
    expect(focusAt(c, c.dates.indexOf('2026-08-31'))).toBeNull();
    expect(readout(c, i)).toBe('2026-09-15 收盘 316.36（当日 ' + ((316.36 / 337.11 - 1) * 100).toFixed(2) + '%） · MA20 ' + c.ma!.values[i]!.toFixed(2) + ' · 在「9 月」区间内');
    // 图的第一天没有前一天，不写当日涨跌
    expect(readout(c, 0)).not.toContain('当日');
    expect(readout(c, i, false)).not.toContain('区间内');
    expect(howComputed(c).join('\n')).toContain('区间最后一天收盘 ÷ 区间前一个交易日收盘 − 1');
  });
});
