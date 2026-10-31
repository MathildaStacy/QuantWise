/**
 * 图表数据（QUANTWISE_DESIGN.md §7.4）：工具执行时算好、存在 ToolUi.chart 里，历史对话打开时和当时一样。
 * 每个构造函数同时给出一段文字摘要，作为工具结果发给模型，回答里的数字都能在摘要里找到。
 */
import type { DateStr } from '../engine/calendar';
import type { KBar } from '../market/tencent';
import type { TestResult } from './backtest';
import { FACTORS, type FactorId } from './factors';
import {
  bollinger,
  drawdown,
  extremes,
  momentum,
  rollingVol,
  rsi,
  sma,
  type Series,
} from './indicators';

export type SubKind = 'mom20' | 'mom60' | 'vol20' | 'dd' | 'rsi14' | 'volume';

export const SUB_NAME: Record<SubKind, string> = {
  mom20: '20 日动量',
  mom60: '60 日动量',
  vol20: '20 日年化波动',
  dd: '回撤',
  rsi14: 'RSI(14)',
  volume: '成交量',
};

export interface Mark {
  date: DateStr;
  label: string;
  below?: boolean;
}

export type ChartData =
  | {
      kind: 'price';
      code: string;
      name: string;
      dates: DateStr[];
      close: number[];
      ma?: { n: number; values: Series };
      band?: { upper: Series; lower: Series };
      sub?: { kind: SubKind; values: Series };
      marks?: Mark[];
    }
  | { kind: 'compare'; dates: DateStr[]; series: { code: string; name: string; values: number[] }[] }
  | { kind: 'factor'; factor: FactorId; universe: string; dates: DateStr[]; groups: number[][]; bench: number[]; longShort: number[] }
  | { kind: 'ic'; factor: FactorId; dates: DateStr[]; ic: number[] }
  | { kind: 'groups'; factor: FactorId; means: number[] };

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const rs = (s: Series) => s.map(v => (v == null ? null : r4(v)));
const pct = (v: number, d = 1) => (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%';

function subSeries(kind: SubKind, close: number[], bars: KBar[]): Series {
  switch (kind) {
    case 'mom20':
      return momentum(close, 20);
    case 'mom60':
      return momentum(close, 60);
    case 'vol20':
      return rollingVol(close, 20);
    case 'dd':
      return drawdown(close);
    case 'rsi14':
      return rsi(close, 14);
    case 'volume':
      return bars.map(b => b.volume);
  }
}

const fmtSub = (kind: SubKind, v: number) =>
  kind === 'rsi14' ? v.toFixed(1) : kind === 'volume' ? (v / 1e4).toFixed(0) + ' 万股' : pct(v);

export function priceChart(o: {
  code: string;
  name: string;
  bars: KBar[];
  n: number;
  ma?: number;
  band?: boolean;
  sub?: SubKind;
  marks?: boolean;
}): { chart: ChartData; text: string } {
  const all = o.bars.map(b => b.close / 1000);
  const off = Math.max(0, all.length - o.n);
  const close = all.slice(off);
  const dates = o.bars.slice(off).map(b => b.date);
  const cut = (s: Series) => rs(s.slice(off));
  const ma = o.ma ? { n: o.ma, values: cut(sma(all, o.ma)) } : undefined;
  const bb = o.band ? bollinger(all, 20, 2) : null;
  // 指标在全部 K 线上算（前面的当预热），再截出要画的那段：图的第一天就有 20 日动量
  const sub = o.sub ? { kind: o.sub, values: o.sub === 'dd' ? rs(drawdown(close)) : cut(subSeries(o.sub, all, o.bars)) } : undefined;
  const lines = [
    o.name + '（' + o.code + '）前复权日 K ' + dates[0] + ' 到 ' + dates[dates.length - 1] + '，' + close.length + ' 根',
    '首日收盘 ' + close[0].toFixed(2) + '，末日收盘 ' + close[close.length - 1].toFixed(2) + '，区间 ' + pct(close[close.length - 1] / close[0] - 1),
  ];
  const px = extremes(close);
  if (px) {
    lines.push('最高收盘 ' + px.hi.toFixed(2) + '（' + dates[px.hiAt] + '），最低收盘 ' + px.lo.toFixed(2) + '（' + dates[px.loAt] + '）');
  }
  if (ma) {
    const last = ma.values[ma.values.length - 1];
    if (last != null) {
      lines.push('MA' + ma.n + ' 最新 ' + last.toFixed(2) + '，收盘在均线' + (close[close.length - 1] >= last ? '上方' : '下方'));
    }
  }
  const marks: Mark[] = [];
  if (sub) {
    const e = extremes(sub.values);
    const last = sub.values[sub.values.length - 1];
    if (e) {
      lines.push(SUB_NAME[sub.kind] + '：最高 ' + fmtSub(sub.kind, e.hi) + '（' + dates[e.hiAt] + '），最低 ' + fmtSub(sub.kind, e.lo) + '（' + dates[e.loAt] + '）' + (last != null ? '，最新 ' + fmtSub(sub.kind, last) : ''));
      if (o.marks && sub.kind !== 'volume') {
        marks.push({ date: dates[e.hiAt], label: (sub.kind === 'dd' ? '高点' : '最高 ') + (sub.kind === 'dd' ? '' : fmtSub(sub.kind, e.hi)) });
        marks.push({ date: dates[e.loAt], label: (sub.kind === 'dd' ? '最大回撤 ' : '最低 ') + fmtSub(sub.kind, e.lo), below: true });
      }
    }
  } else if (o.marks && px) {
    marks.push({ date: dates[px.hiAt], label: '最高 ' + px.hi.toFixed(2) }, { date: dates[px.loAt], label: '最低 ' + px.lo.toFixed(2), below: true });
  }
  return {
    chart: {
      kind: 'price',
      code: o.code,
      name: o.name,
      dates,
      close: close.map(r3),
      ...(ma ? { ma } : {}),
      ...(bb ? { band: { upper: cut(bb.upper), lower: cut(bb.lower) } } : {}),
      ...(sub ? { sub } : {}),
      ...(marks.length ? { marks } : {}),
    },
    text: lines.join('\n'),
  };
}

/** 几只证券起点 = 100 对比；只用都有数据的日期。 */
export function compareChart(
  list: { code: string; name: string; bars: KBar[] }[],
  n: number,
): { chart: ChartData; text: string } {
  const sets = list.map(x => new Map(x.bars.map(b => [b.date, b.close / 1000])));
  const common = [...sets[0].keys()].filter(d => sets.every(s => s.has(d))).sort().slice(-n);
  const series = list.map((x, i) => {
    const base = sets[i].get(common[0])!;
    return { code: x.code, name: x.name, values: common.map(d => r3((sets[i].get(d)! / base) * 100)) };
  });
  const text = [
    '起点 = 100，' + common[0] + ' 到 ' + common[common.length - 1] + '，' + common.length + ' 个共同交易日',
    ...series.map(s => s.name + '（' + s.code + '）期末 ' + s.values[s.values.length - 1].toFixed(1) + '，区间 ' + pct(s.values[s.values.length - 1] / 100 - 1)),
  ].join('\n');
  return { chart: { kind: 'compare', dates: common, series }, text };
}

export function factorCharts(r: TestResult, universe: string): ChartData[] {
  const f = r.input.factor;
  return [
    { kind: 'factor', factor: f, universe, dates: r.dates, groups: r.groupNav.map(g => g.map(r4)), bench: r.benchNav.map(r4), longShort: r.longShortNav.map(r4) },
    { kind: 'ic', factor: f, dates: r.ic.map(x => x.date), ic: r.ic.map(x => r4(x.ic)) },
    { kind: 'groups', factor: f, means: r.groupMeans.map(r4) },
  ];
}

export function chartTitle(c: ChartData): string {
  switch (c.kind) {
    case 'price':
      return c.name + (c.sub ? ' · ' + SUB_NAME[c.sub.kind] : '');
    case 'compare':
      return c.series.map(s => s.name).join(' / ') + ' · 起点 = 100';
    case 'factor':
      return '分组净值 · ' + FACTORS[c.factor].name;
    case 'ic':
      return 'Rank IC · 每期';
    case 'groups':
      return '各组每期平均收益 · ' + FACTORS[c.factor].name;
  }
}
