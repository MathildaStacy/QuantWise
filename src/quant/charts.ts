/**
 * 图表数据（QUANTWISE_DESIGN.md §7.4）：工具执行时算好、存在 ToolUi.chart 里，历史对话打开时和当时一样。
 * 每个构造函数同时给出一段文字摘要，作为工具结果发给模型，回答里的数字都能在摘要里找到。
 * 重点区间、标注点和看点见 docs/design/ai-lecture-charts.md：区间读数由 focusStats 算，图和摘要用同一份。
 */
import { addDays, type DateStr } from '../engine/calendar';
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

/**
 * 图上的点：极值（marks: true，标签「最高 405.00」）或 AI 标的某一天（kind: 'point'，标签是事件，
 * 日期写在横轴上、整列一条竖向引导线）。below 不填时按位置自动放上 / 下。
 */
export interface Mark {
  date: DateStr;
  label: string;
  below?: boolean;
  kind?: 'point';
}

/** 重点区间：已落到图里的交易日上（from、to 都在 dates 里）。 */
export interface Focus {
  from: DateStr;
  to: DateStr;
  label: string;
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
      focus?: Focus[];
      takeaway?: string;
      /** 最后一根是今天的盘中数据（还没收盘）时是那天的日期。 */
      live?: DateStr;
      /** 同期沪深 300 在每段重点区间的涨跌（和 focus 对齐，取不到的是 null）。 */
      bench?: { name: string; changes: (number | null)[] };
    }
  | {
      kind: 'compare';
      dates: DateStr[];
      series: { code: string; name: string; values: number[] }[];
      /** 收盘 = 100 的那天：有重点区间时是第一段区间的前一个交易日；不写时是图的第一天（旧图都是）。 */
      base?: DateStr;
      focus?: Focus[];
      takeaway?: string;
      live?: DateStr;
    }
  | {
      kind: 'factor'; factor: FactorId; universe: string; dates: DateStr[]; groups: number[][]; bench: number[]; longShort: number[];
      /** 这次检验的口径和关键统计（存进研究手记用）；旧图没有。 */
      stats?: FactorStats;
    }
  | { kind: 'ic'; factor: FactorId; dates: DateStr[]; ic: number[] }
  | { kind: 'groups'; factor: FactorId; means: number[] };

export interface FactorStats {
  universe: string;
  hold: number;
  groups: number;
  weight: 'equal' | 'cap';
  costBp: number;
  periods: number;
  icMean: number;
  icT: number;
  longShortMean: number;
  longShortT: number;
  longShortAnnual: number;
  /** 控制市值的双重排序：几个市值组、条件还是独立排序（旧图没有）。 */
  control?: { groups: number; sort: 'conditional' | 'independent' };
}

export type PriceChart = Extract<ChartData, { kind: 'price' }>;
export type CompareChart = Extract<ChartData, { kind: 'compare' }>;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const rs = (s: Series) => s.map(v => (v == null ? null : r4(v)));
export const pct = (v: number, d = 1) => (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%';

// ---------- 重点区间、标注点、视窗 ----------

/** AI 给的区间（还没落到交易日上）。 */
export interface FocusReq {
  from: DateStr;
  to: DateStr;
  label: string;
}

export interface PointReq {
  date: DateStr;
  label: string;
}

// ---------- 让工具在数据里找一段行情（plot_chart 的 find） ----------

export type FindKind = 'drawdown' | 'rally' | 'volatile';
export const FIND_NAME: Record<FindKind, string> = { drawdown: '最深回撤', rally: '最大涨幅', volatile: '波动最大' };

/**
 * 在收盘价里找一段真实行情（docs/design/lecture-retrieval-20261104.md §4）：drawdown 峰到谷跌得最深，rally 谷到峰涨得最多，
 * volatile 连续 days 个交易日的日收益波动最大。返回区间第一天和最后一天的下标（区间涨跌的基数是 a − 1 那天，
 * 回撤和涨幅的基数正好是峰 / 谷那天），value 是回撤 / 涨幅或年化波动。
 */
export function findEpisode(close: number[], kind: FindKind, days = 20): { a: number; b: number; value: number } | null {
  if (close.length < 3) return null;
  if (kind === 'volatile') {
    const n = Math.max(5, Math.min(days, close.length - 1));
    let best: { a: number; b: number; value: number } | null = null;
    for (let b = n; b < close.length; b++) {
      const r = [];
      for (let i = b - n + 1; i <= b; i++) r.push(close[i] / close[i - 1] - 1);
      const m = r.reduce((x, y) => x + y, 0) / n;
      const sd = Math.sqrt(r.reduce((x, y) => x + (y - m) ** 2, 0) / (n - 1)) * Math.sqrt(250);
      if (!best || sd > best.value) best = { a: b - n + 1, b, value: sd };
    }
    return best;
  }
  let pivot = 0;
  let best: { a: number; b: number; value: number } | null = null;
  for (let i = 1; i < close.length; i++) {
    const move = close[i] / close[pivot] - 1;
    if (kind === 'drawdown' ? move < (best?.value ?? 0) : move > (best?.value ?? 0)) best = { a: pivot + 1, b: i, value: move };
    if (kind === 'drawdown' ? close[i] > close[pivot] : close[i] < close[pivot]) pivot = i;
  }
  return best && best.a <= best.b ? best : null;
}

/** 一张图最多画几根；和 plot_chart 的 bars 上限一致。 */
export const MAX_VIEW = 750;

const MAX_FOCUS = 2;
const MAX_POINTS = 3;
const pad2 = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** 「9/24」：图上和读数里的短日期。 */
export const md = (d: DateStr) => Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10));

/** 模型写的短文字：去掉换行和多余空格，超长截断。 */
export function clip(v: unknown, max: number): string {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * YYYY-MM-DD（也认 / 和 . 分隔、不补零）或 YYYY-MM（整月：from 取 1 日，to 取月末）。认不出返回 null。
 */
export function parseDay(v: unknown, edge: 'from' | 'to'): DateStr | null {
  const s = String(v ?? '').trim();
  const m = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})?$/.exec(s);
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) {
    return null;
  }
  const d = m[3] == null ? (edge === 'from' ? 1 : lastDay(y, mo)) : Number(m[3]);
  if (d < 1 || d > lastDay(y, mo)) {
    return null;
  }
  return y + '-' + pad2(mo) + '-' + pad2(d);
}

/** 没给名字时的区间名：整月「9 月」、连续几个整月「8–10 月」、否则「9/1–9/15」。 */
export function autoLabel(from: DateStr, to: DateStr): string {
  const fy = Number(from.slice(0, 4));
  const fm = Number(from.slice(5, 7));
  const ty = Number(to.slice(0, 4));
  const tm = Number(to.slice(5, 7));
  const whole = from.slice(8) === '01' && Number(to.slice(8)) === lastDay(ty, tm);
  if (whole && fy === ty) {
    return fm === tm ? fm + ' 月' : fm + '–' + tm + ' 月';
  }
  return from === to ? md(from) : md(from) + '–' + md(to);
}

/** plot_chart 的 focus 参数 → 最多 2 段区间（起止颠倒时对调；认不出的丢掉）。 */
export function parseFocus(v: unknown): FocusReq[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v.slice(0, MAX_FOCUS).flatMap((x: { from?: unknown; to?: unknown; label?: unknown } | null) => {
    let a = x?.from;
    let b = x?.to ?? x?.from;
    if ((parseDay(a, 'from') ?? '') > (parseDay(b, 'from') ?? '')) {
      [a, b] = [b, a];
    }
    const from = parseDay(a, 'from');
    const to = parseDay(b, 'to');
    return from && to ? [{ from, to, label: clip(x?.label, 8) || autoLabel(from, to) }] : [];
  });
}

/** plot_chart 的 points 参数 → 最多 3 个标注点。 */
export function parsePoints(v: unknown): PointReq[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v.slice(0, MAX_POINTS).flatMap((x: { date?: unknown; label?: unknown } | null) => {
    const date = parseDay(x?.date, 'from');
    return date ? [{ date, label: clip(x?.label, 10) }] : [];
  });
}

export interface ViewPlan {
  /** 要画的第一根、最后一根（在传入的 dates 里的下标）。 */
  start: number;
  end: number;
  focus: { a: number; b: number; label: string }[];
  points: { i: number; label: string; asked: DateStr }[];
  /** 画不出来的区间 / 标注，写进摘要告诉模型。 */
  notes: string[];
}

/**
 * 视窗（docs/design/ai-lecture-charts.md §3.2）：给了区间没给根数时自动缩放到区间附近 ——
 * 前面留出和区间一样长的一段作对比（至少 20 根），后面一小段（离最新不到 40 根就画到最新），总共 60–250 根；
 * 无论哪种都扩到包含区间前一个交易日（区间涨跌的基数）和所有标注点。
 */
export function resolveView(
  dates: DateStr[],
  o: { n?: number; end?: DateStr | null; focus?: FocusReq[]; points?: PointReq[] },
): ViewPlan {
  const last = dates.length - 1;
  const notes: string[] = [];
  const atOrAfter = (d: DateStr) => dates.findIndex(x => x >= d);
  const atOrBefore = (d: DateStr) => {
    for (let i = last; i >= 0; i--) {
      if (dates[i] <= d) {
        return i;
      }
    }
    return -1;
  };
  const range = dates.length ? '（数据 ' + dates[0] + ' 到 ' + dates[last] + '）' : '';
  const focus = (o.focus ?? []).flatMap(f => {
    const a = atOrAfter(f.from);
    const b = atOrBefore(f.to);
    if (a < 0 || b < 0 || a > b) {
      notes.push('区间「' + f.label + '」' + f.from + ' 到 ' + f.to + (a >= 0 && b >= 0 ? ' 没有交易日' : ' 不在数据范围里' + range) + '，没有画');
      return [];
    }
    return [{ a, b, label: f.label }];
  });
  const points = (o.points ?? []).flatMap(p => {
    const i = atOrAfter(p.date);
    // 休市日标在之后第一个交易日；隔了一周以上说明那天根本不在数据里
    if (i < 0 || dates[i] > addDays(p.date, 10)) {
      notes.push('标注 ' + p.date + ' 不在数据范围里' + range + '，没有画');
      return [];
    }
    return [{ i, label: p.label, asked: p.date }];
  });
  let end = last;
  if (o.end) {
    const e = atOrBefore(o.end);
    if (e < 0) {
      notes.push('end ' + o.end + ' 早于数据范围' + range + '，改成画到最新');
    } else {
      end = e;
    }
  }
  const fa = focus.length ? Math.min(...focus.map(f => f.a)) : -1;
  const fb = focus.length ? Math.max(...focus.map(f => f.b)) : -1;
  if (focus.length && !o.end && last - fb > 40) {
    end = Math.min(last, fb + Math.max(10, Math.round((fb - fa + 1) / 2)));
  }
  let start: number;
  if (o.n != null) {
    start = end - o.n + 1;
  } else if (focus.length) {
    start = fa - 1 - Math.max(20, fb - fa + 1);
    if (end - start + 1 < 60) {
      start = end - 59;
    } else if (end - start + 1 > 250) {
      start = Math.min(fa - 1, end - 249);
    }
  } else {
    start = end - 249;
  }
  // 区间前一个交易日、所有区间和标注点都要在图里
  for (const f of focus) {
    start = Math.min(start, f.a - 1);
    end = Math.max(end, f.b);
  }
  for (const p of points) {
    start = Math.min(start, p.i);
    end = Math.max(end, p.i);
  }
  start = Math.max(0, start);
  if (end - start + 1 > MAX_VIEW) {
    throw new Error('要标的区间和标注点前后跨了 ' + (end - start + 1) + ' 个交易日，一张图最多 ' + MAX_VIEW + ' 根：分成两张图画');
  }
  return { start, end, focus, points, notes };
}

/** 区间在图里的位置：a..b 是区间的交易日，k 是基数那天（区间前一个交易日；图从区间第一天开始时就是 a）。 */
export function focusSpan(dates: DateStr[], f: Focus): { a: number; b: number; k: number } | null {
  const a = dates.indexOf(f.from);
  const b = dates.indexOf(f.to);
  return a < 0 || b < a ? null : { a, b, k: Math.max(0, a - 1) };
}

export interface FocusStats {
  label: string;
  from: DateStr;
  to: DateStr;
  days: number;
  a: number;
  b: number;
  k: number;
  baseDate: DateStr;
  base: number;
  last: number;
  change: number;
  hi: number;
  hiDate: DateStr;
  lo: number;
  loDate: DateStr;
  sub?: { from: number | null; to: number | null };
}

/**
 * 区间读数：区间涨跌 = 区间最后一天收盘 ÷ 区间前一个交易日收盘 − 1（和行情软件的「区间涨跌幅」一样）。
 * 副图取同样两天的值。区间最高 / 最低只看区间里的收盘。
 */
export function focusStats(c: PriceChart, f: Focus): FocusStats | null {
  const s = focusSpan(c.dates, f);
  if (!s) {
    return null;
  }
  const { a, b, k } = s;
  let hiAt = a;
  let loAt = a;
  for (let i = a; i <= b; i++) {
    if (c.close[i] > c.close[hiAt]) {
      hiAt = i;
    }
    if (c.close[i] < c.close[loAt]) {
      loAt = i;
    }
  }
  return {
    label: f.label,
    from: f.from,
    to: f.to,
    days: b - a + 1,
    a,
    b,
    k,
    baseDate: c.dates[k],
    base: c.close[k],
    last: c.close[b],
    change: c.close[b] / c.close[k] - 1,
    hi: c.close[hiAt],
    hiDate: c.dates[hiAt],
    lo: c.close[loAt],
    loDate: c.dates[loAt],
    ...(c.sub ? { sub: { from: c.sub.values[k] ?? null, to: c.sub.values[b] ?? null } } : {}),
  };
}

/** 对比图：每只证券在区间里的涨跌（同样以区间前一个交易日为基数）。 */
/** 同期基准在每段重点区间的涨跌：基数和个股同一天（区间前一个交易日），基准那天没数据时为 null。 */
export function benchFocus(c: PriceChart, bars: KBar[]): (number | null)[] {
  const at = new Map(bars.map(b => [b.date, b.close / 1000]));
  return (c.focus ?? []).map(f => {
    const st = focusStats(c, f);
    const a = st && at.get(st.baseDate);
    const b = st && at.get(st.to);
    return a && b ? r4(b / a - 1) : null;
  });
}

export function compareFocus(c: CompareChart, f: Focus): { span: { a: number; b: number; k: number }; series: { name: string; change: number }[] } | null {
  const span = focusSpan(c.dates, f);
  return span ? { span, series: c.series.map(s => ({ name: s.name, change: s.values[span.b] / s.values[span.k] - 1 })) } : null;
}

/** 区间那一行的开头：「9 月」2026-09-01 到 2026-09-30，21 个交易日。 */
/** 最后一根是盘中数据时给模型的提醒（放在摘要第一行）。 */
const liveNote = (d: DateStr) =>
  '注意：最后一根 ' + d + ' 是今天的盘中数据，还没收盘；摘要里这一天的「收盘」「末日收盘」「最新」都是盘中价，讲的时候说「截至今天盘中」，不要说成收盘价。';

const focusHead = (f: { label: string; from: DateStr; to: DateStr }, days: number) =>
  '重点区间「' + f.label + '」' + f.from + (f.to !== f.from ? ' 到 ' + f.to : '') + '，' + days + ' 个交易日';

/** 图的时间范围：同一年时后一个日期省掉年份（「2026-06-01 至 10-26」）。 */
export function dateRange(dates: DateStr[]): string {
  const a = dates[0] ?? '';
  const b = dates[dates.length - 1] ?? '';
  return a + ' 至 ' + (a.slice(0, 4) === b.slice(0, 4) ? b.slice(5) : b);
}

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

export const fmtSub = (kind: SubKind, v: number) =>
  kind === 'rsi14' ? v.toFixed(1) : kind === 'volume' ? (v / 1e4).toFixed(0) + ' 万股' : pct(v);

export function priceChart(o: {
  code: string;
  name: string;
  bars: KBar[];
  /** 画多少根；不给时没有区间画 250 根，有区间按区间自动取。 */
  n?: number;
  /** 图的最后一天，默认最新。 */
  end?: DateStr | null;
  ma?: number;
  band?: boolean;
  sub?: SubKind;
  marks?: boolean;
  focus?: FocusReq[];
  points?: PointReq[];
  takeaway?: string;
  /** 今天（北京时间）还没收盘：最后一根是今天时标成盘中。 */
  today?: DateStr | null;
}): { chart: ChartData; text: string } {
  const all = o.bars.map(b => b.close / 1000);
  const view = resolveView(o.bars.map(b => b.date), { n: o.n, end: o.end, focus: o.focus, points: o.points });
  const off = view.start;
  const stop = view.end + 1;
  const close = all.slice(off, stop);
  const dates = o.bars.slice(off, stop).map(b => b.date);
  const cut = (s: Series) => rs(s.slice(off, stop));
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
  for (const p of view.points) {
    marks.push({ date: o.bars[p.i].date, label: p.label, kind: 'point' });
  }
  const focus: Focus[] = view.focus.map(f => ({ from: o.bars[f.a].date, to: o.bars[f.b].date, label: f.label }));
  const takeaway = clip(o.takeaway, 40);
  const chart: PriceChart = {
    kind: 'price',
    code: o.code,
    name: o.name,
    dates,
    close: close.map(r3),
    ...(ma ? { ma } : {}),
    ...(bb ? { band: { upper: cut(bb.upper), lower: cut(bb.lower) } } : {}),
    ...(sub ? { sub } : {}),
    ...(marks.length ? { marks } : {}),
    ...(focus.length ? { focus } : {}),
    ...(takeaway ? { takeaway } : {}),
    ...(o.today && dates[dates.length - 1] === o.today ? { live: o.today } : {}),
  };
  if (chart.live) lines.unshift(liveNote(chart.live));
  // 区间读数用存下来的图算（和界面显示的是同一份数）
  for (const f of focus) {
    const st = focusStats(chart, f)!;
    const subPart = st.sub && sub && st.sub.from != null && st.sub.to != null ? '；' + SUB_NAME[sub.kind] + ' ' + fmtSub(sub.kind, st.sub.from) + ' → ' + fmtSub(sub.kind, st.sub.to) : '';
    lines.push(
      focusHead(f, st.days) + '：' +
        (st.k < st.a ? '前收 ' + st.base.toFixed(2) + '（' + st.baseDate + '）' : '首日收盘 ' + st.base.toFixed(2) + '（图里没有更早的数据）') +
        '→ 末日收盘 ' + st.last.toFixed(2) + '，区间 ' + pct(st.change, 2) +
        '；区间最高收盘 ' + st.hi.toFixed(2) + '（' + st.hiDate + '），最低 ' + st.lo.toFixed(2) + '（' + st.loDate + '）' + subPart,
    );
  }
  for (const p of view.points) {
    const i = p.i;
    const d = o.bars[i].date;
    const day = i > 0 ? '，当日 ' + pct(all[i] / all[i - 1] - 1, 2) : '';
    // 标注那天的副图值：讲「九月末动量 -3.1%」时能引用
    const sv = sub?.values[i - off];
    const subDay = sub && sv != null ? '，' + SUB_NAME[sub.kind] + ' ' + fmtSub(sub.kind, sv) : '';
    lines.push('标注 ' + d + (p.label ? '「' + p.label + '」' : '') + (d !== p.asked ? '（' + p.asked + ' 休市，标在之后第一个交易日）' : '') + '：收盘 ' + all[i].toFixed(2) + day + subDay);
  }
  lines.push(...view.notes);
  return { chart, text: lines.join('\n') };
}

/**
 * 几只证券对比，收盘 = 100；只用都有数据的日期。有重点区间时以第一段区间的前一个交易日 = 100：几条线在区间左边缘
 * 从同一点出发，区间里谁的线高谁就强（以图的第一天为 100 时，区间开始前的差距会让图看起来和区间涨跌相反）。
 */
export function compareChart(
  list: { code: string; name: string; bars: KBar[] }[],
  o: { n?: number; end?: DateStr | null; focus?: FocusReq[]; takeaway?: string; today?: DateStr | null } = {},
): { chart: ChartData; text: string } {
  const sets = list.map(x => new Map(x.bars.map(b => [b.date, b.close / 1000])));
  const all = [...sets[0].keys()].filter(d => sets.every(s => s.has(d))).sort();
  if (all.length < 2) {
    throw new Error('这几只证券没有足够的共同交易日，画不了对比');
  }
  const view = resolveView(all, { n: o.n, end: o.end, focus: o.focus });
  const common = all.slice(view.start, view.end + 1);
  const fa = view.focus.length ? Math.min(...view.focus.map(f => f.a)) : -1;
  const base = fa > 0 ? all[fa - 1] : common[0];
  const series = list.map((x, i) => {
    const b0 = sets[i].get(base)!;
    return { code: x.code, name: x.name, values: common.map(d => r3((sets[i].get(d)! / b0) * 100)) };
  });
  const focus: Focus[] = view.focus.map(f => ({ from: all[f.a], to: all[f.b], label: f.label }));
  const takeaway = clip(o.takeaway, 40);
  const chart: CompareChart = {
    kind: 'compare',
    dates: common,
    series,
    ...(base !== common[0] ? { base } : {}),
    ...(focus.length ? { focus } : {}),
    ...(takeaway ? { takeaway } : {}),
    ...(o.today && common[common.length - 1] === o.today ? { live: o.today } : {}),
  };
  const lines = [
    (chart.base ? '以 ' + base + ' 收盘 = 100（第一段重点区间的前一个交易日）' : '起点 = 100') + '，' + common[0] + ' 到 ' + common[common.length - 1] + '，' + common.length + ' 个共同交易日',
    ...series.map(s => s.name + '（' + s.code + '）期末 ' + s.values[s.values.length - 1].toFixed(1) + '，' + (chart.base ? base + ' 以来 ' : '区间 ') + pct(s.values[s.values.length - 1] / 100 - 1)),
  ];
  for (const f of focus) {
    const r = compareFocus(chart, f)!;
    lines.push(focusHead(f, r.span.b - r.span.a + 1) + '（以 ' + common[r.span.k] + ' 收盘为基数）：' + r.series.map(s => s.name + ' ' + pct(s.change, 2)).join('，'));
  }
  if (chart.live) lines.unshift(liveNote(chart.live));
  lines.push(...view.notes);
  return { chart, text: lines.join('\n') };
}

export function factorCharts(r: TestResult, universe: string, universeName = universe): ChartData[] {
  const f = r.input.factor;
  const stats: FactorStats = {
    universe: universeName, hold: r.input.hold, groups: r.input.groups, weight: r.input.weight ?? 'equal', costBp: r.input.costBp, periods: r.periods,
    icMean: r4(r.icMean), icT: Math.round(r.t * 100) / 100, longShortMean: r4(r.longShortMean), longShortT: Math.round(r.longShortT * 100) / 100, longShortAnnual: r4(r.longShortAnnual),
    ...(r.input.control ? { control: { groups: r.input.control.groups, sort: r.input.control.sort } } : {}),
  };
  return [
    { kind: 'factor', factor: f, universe, dates: r.dates, groups: r.groupNav.map(g => g.map(r4)), bench: r.benchNav.map(r4), longShort: r.longShortNav.map(r4), stats },
    { kind: 'ic', factor: f, dates: r.ic.map(x => x.date), ic: r.ic.map(x => r4(x.ic)) },
    { kind: 'groups', factor: f, means: r.groupMeans.map(r4) },
  ];
}

export function chartTitle(c: ChartData): string {
  switch (c.kind) {
    case 'price':
      return c.name + (c.sub ? ' · ' + SUB_NAME[c.sub.kind] : '');
    case 'compare':
      return c.series.map(s => s.name).join(' / ') + ' · ' + (c.base ? md(c.base) + ' = 100' : '起点 = 100');
    case 'factor':
      return '分组净值 · ' + FACTORS[c.factor].name;
    case 'ic':
      return 'Rank IC · 每期';
    case 'groups':
      return '各组每期平均收益 · ' + FACTORS[c.factor].name;
  }
}
