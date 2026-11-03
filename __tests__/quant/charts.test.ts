/// <reference types="node" />
/**
 * 讲解里的行情图（docs/design/ai-lecture-charts.md）：区间和标注的写法、视窗自动缩放、区间读数和摘要。
 * 用原型快照日线（宁德时代 2025-10-14 到 2026-10-26），区间读数和手算对账。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  autoLabel,
  chartTitle,
  clip,
  compareChart,
  fmtSub,
  focusStats,
  parseDay,
  parseFocus,
  parsePoints,
  priceChart,
  resolveView,
  type PriceChart,
} from '../../src/quant/charts';
import type { KBar } from '../../src/market/tencent';

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
const CATL = barsOf('sz300750');
const dates = CATL.map(b => b.date);
const SEP = { from: '2026-09-01', to: '2026-09-30', label: '9 月' };

describe('区间和标注的写法', () => {
  it('日期：整月取月初 / 月末，认 / 和 . 分隔，认不出的是 null', () => {
    expect(parseDay('2026-09', 'from')).toBe('2026-09-01');
    expect(parseDay('2026-09', 'to')).toBe('2026-09-30');
    expect(parseDay('2026-02', 'to')).toBe('2026-02-28');
    expect(parseDay('2024-02', 'to')).toBe('2024-02-29');
    expect(parseDay('2026/9/3', 'from')).toBe('2026-09-03');
    expect(parseDay('20260915', 'from')).toBe('2026-09-15');
    expect(parseDay('2026-13', 'from')).toBeNull();
    expect(parseDay('2026-02-30', 'from')).toBeNull();
    expect(parseDay('九月', 'from')).toBeNull();
    expect(parseDay(undefined, 'from')).toBeNull();
  });

  it('区间名：整月「9 月」、几个整月「8–10 月」、其他写起止日期；起止颠倒时对调，最多 2 段', () => {
    expect(autoLabel('2026-09-01', '2026-09-30')).toBe('9 月');
    expect(autoLabel('2026-08-01', '2026-10-31')).toBe('8–10 月');
    expect(autoLabel('2026-09-01', '2026-09-15')).toBe('9/1–9/15');
    expect(autoLabel('2026-09-24', '2026-09-24')).toBe('9/24');
    expect(parseFocus([{ from: '2026-09', to: '2026-09' }])).toEqual([SEP]);
    expect(parseFocus([{ from: '2026-10', to: '2026-09', label: '  九月到十月的这一大段下跌行情  ' }])).toEqual([
      { from: '2026-09-01', to: '2026-10-31', label: '九月到十月的这…' },
    ]);
    expect(parseFocus([{ from: '2026-09' }])).toEqual([SEP]);
    expect(parseFocus([{ from: 'x' }, ...Array(3).fill({ from: '2026-08', to: '2026-08' })])).toHaveLength(1);
    expect(parseFocus('2026-09')).toEqual([]);
  });

  it('标注最多 3 个，标签截断', () => {
    expect(parsePoints([{ date: '2026-09-15', label: '放量急跌，跌破二十日均线' }, { date: 'bad' }, { date: '2026-09-24' }, { date: '2026-09-25' }, { date: '2026-09-28' }])).toEqual([
      { date: '2026-09-15', label: '放量急跌，跌破二十…' },
      { date: '2026-09-24', label: '' },
    ]);
    expect(clip('a'.repeat(50), 40)).toHaveLength(40);
  });
});

describe('视窗', () => {
  const at = (d: string) => dates.indexOf(d);

  it('没给区间：画最近 250 根（给了 n 就画 n 根）', () => {
    expect(resolveView(dates, {})).toMatchObject({ start: 1, end: 250 });
    expect(resolveView(dates, { n: 60 })).toMatchObject({ start: 191, end: 250 });
  });

  it('最近的区间：画到最新，前面留出和区间一样长的对比（至少 20 根），总共至少 60 根，并包含区间前一个交易日', () => {
    const v = resolveView(dates, { focus: [SEP] });
    expect(v.focus).toEqual([{ a: at('2026-09-01'), b: at('2026-09-30'), label: '9 月' }]);
    expect(v.end).toBe(dates.length - 1);
    // 9 月 21 个交易日：前面 21 根 + 基数那天，再到最新（10 月 13 根）不到 60 根，往前补到 60 根
    expect(v.start).toBeLessThan(at('2026-09-01') - 1 - 21);
    expect(v.end - v.start + 1).toBe(60);
    expect(v.notes).toEqual([]);
    // 两个月的区间：前面也是两个月，不再拖出半年
    const two = resolveView(dates, { focus: [{ from: '2026-08-01', to: '2026-09-30', label: '8–9 月' }] });
    expect(two.start).toBe(at('2026-08-03') - 1 - (at('2026-09-30') - at('2026-08-03') + 1));
  });

  it('较早的区间：画到区间后一小段，不拖到最新', () => {
    const v = resolveView(dates, { focus: [{ from: '2026-01-01', to: '2026-01-31', label: '1 月' }] });
    const b = v.focus[0].b;
    expect(dates[b].startsWith('2026-01')).toBe(true);
    expect(v.end).toBe(b + 10);
    expect(v.end - v.start + 1).toBeGreaterThanOrEqual(60);
  });

  it('给了根数和区间：从 end 往前数，区间不在里面就扩进来', () => {
    const v = resolveView(dates, { n: 30, focus: [{ from: '2026-08-01', to: '2026-08-31', label: '8 月' }] });
    expect(v.start).toBe(at('2026-08-03') - 1);
    expect(v.end).toBe(dates.length - 1);
  });

  it('end：画到那天为止', () => {
    const v = resolveView(dates, { end: '2026-06-30', n: 60 });
    expect(dates[v.end]).toBe('2026-06-30');
    expect(v.end - v.start + 1).toBe(60);
  });

  it('画不出来的区间和标注写进 notes；休市日的标注落到之后第一个交易日', () => {
    const v = resolveView(dates, {
      focus: [{ from: '2026-10-01', to: '2026-10-07', label: '国庆' }, { from: '2024-09-01', to: '2024-09-30', label: '去年 9 月' }],
      points: [{ date: '2026-10-03', label: '假期' }, { date: '2020-01-02', label: '太早' }],
    });
    expect(v.focus).toEqual([]);
    expect(v.points).toEqual([{ i: at('2026-10-08'), label: '假期', asked: '2026-10-03' }]);
    expect(v.notes.join('\n')).toContain('区间「国庆」2026-10-01 到 2026-10-07 没有交易日');
    expect(v.notes.join('\n')).toContain('区间「去年 9 月」2024-09-01 到 2024-09-30 不在数据范围里（数据 2025-10-14 到 2026-10-26）');
    expect(v.notes.join('\n')).toContain('标注 2020-01-02 不在数据范围里');
  });

  it('区间和标注前后跨度超过 750 根：报错，让模型分开画', () => {
    const many = Array.from({ length: 1000 }, (_, i) => new Date(Date.UTC(2022, 0, 1 + i)).toISOString().slice(0, 10));
    expect(() => resolveView(many, { focus: [{ from: many[10], to: many[20], label: 'a' }, { from: many[900], to: many[910], label: 'b' }] })).toThrow('分成两张图画');
  });
});

describe('区间读数和摘要', () => {
  const { chart, text } = priceChart({
    code: 'sz300750',
    name: '宁德时代',
    bars: CATL,
    sub: 'mom20',
    ma: 20,
    focus: [SEP],
    points: [{ date: '2026-09-15', label: '放量急跌' }],
    takeaway: '9 月一路走低，20 日动量转负',
  });
  const c = chart as PriceChart;

  it('区间涨跌以区间前一个交易日收盘为基数（和手算一致）', () => {
    const st = focusStats(c, c.focus![0])!;
    expect(st).toMatchObject({ label: '9 月', days: 21, baseDate: '2026-08-31', base: 363.55, last: 291.11, hi: 358.1, hiDate: '2026-09-01', lo: 286.8, loDate: '2026-09-29' });
    expect(st.change).toBeCloseTo(291.11 / 363.55 - 1, 10);
    expect(st.sub!.from).toBe(c.sub!.values[st.k]);
    expect(st.sub!.to).toBe(c.sub!.values[st.b]);
  });

  it('图里存区间、看点和标注点；视窗自动缩放到 9 月附近', () => {
    expect(c.focus).toEqual([SEP]);
    expect(c.takeaway).toBe('9 月一路走低，20 日动量转负');
    expect(c.marks).toEqual([{ date: '2026-09-15', label: '放量急跌', kind: 'point' }]);
    expect(c.dates).toHaveLength(60);
    expect(c.dates[c.dates.length - 1]).toBe('2026-10-26');
    expect(c.sub!.values[0]).not.toBeNull();
  });

  it('摘要写区间读数（同一份数）和标注那天的收盘、当日涨跌', () => {
    expect(text).toContain('重点区间「9 月」2026-09-01 到 2026-09-30，21 个交易日：前收 363.55（2026-08-31）→ 末日收盘 291.11，区间 -19.93%；区间最高收盘 358.10（2026-09-01），最低 286.80（2026-09-29）；20 日动量 ');
    expect(text).toContain('标注 2026-09-15「放量急跌」：收盘 316.36，当日 ' + ((316.36 / 337.11 - 1) * 100).toFixed(2) + '%');
    // 标注那天的副图值也在摘要里
    expect(text).toContain('当日 ' + ((316.36 / 337.11 - 1) * 100).toFixed(2) + '%，20 日动量 ' + fmtSub('mom20', c.sub!.values[c.dates.indexOf('2026-09-15')]!));
    // 原有几行不变
    expect(text).toContain('宁德时代（sz300750）前复权日 K ');
    expect(text).toContain('20 日动量：最高');
  });

  it('区间从数据第一天开始（新股）：用区间第一天收盘做基数，摘要写明', () => {
    const r = priceChart({ code: 'sz300750', name: '宁德时代', bars: CATL, focus: [{ from: '2025-10-01', to: '2025-10-31', label: '10 月' }] });
    const st = focusStats(r.chart as PriceChart, (r.chart as PriceChart).focus![0])!;
    expect(st.k).toBe(st.a);
    expect(r.text).toContain('首日收盘 ' + st.base.toFixed(2) + '（图里没有更早的数据）');
  });

  it('对比图也能标区间：以区间前一个交易日 = 100（几条线从同一点出发），每只一个区间涨跌', () => {
    const r = compareChart(
      [
        { code: 'sz300750', name: '宁德时代', bars: CATL },
        { code: 'sh600036', name: '招商银行', bars: barsOf('sh600036') },
      ],
      { focus: [SEP], takeaway: '9 月宁德时代明显跑输' },
    );
    expect(r.chart).toMatchObject({ kind: 'compare', base: '2026-08-31', focus: [SEP], takeaway: '9 月宁德时代明显跑输' });
    const cc = r.chart as Extract<typeof r.chart, { kind: 'compare' }>;
    const at = cc.dates.indexOf('2026-08-31');
    expect(cc.series.map(s => s.values[at])).toEqual([100, 100]);
    expect(cc.series[0].values[cc.dates.indexOf('2026-09-30')]).toBeCloseTo(100 * (291.11 / 363.55), 1);
    expect(r.text).toContain('以 2026-08-31 收盘 = 100（第一段重点区间的前一个交易日）');
    expect(r.text).toContain('重点区间「9 月」2026-09-01 到 2026-09-30，21 个交易日（以 2026-08-31 收盘为基数）：宁德时代 -19.93%，招商银行 ');
    expect(chartTitle(r.chart)).toBe('宁德时代 / 招商银行 · 8/31 = 100');
    // 没有区间：图的第一天 = 100，不存 base
    const plain = compareChart([{ code: 'sz300750', name: '宁德时代', bars: CATL }, { code: 'sh600036', name: '招商银行', bars: barsOf('sh600036') }], { n: 60 });
    expect(plain.chart).not.toHaveProperty('base');
    expect(chartTitle(plain.chart)).toBe('宁德时代 / 招商银行 · 起点 = 100');
    expect(plain.text.startsWith('起点 = 100，')).toBe(true);
  });
});
