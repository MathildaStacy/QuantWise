/**
 * 因子和行情图的几何（纯函数，可单测）：坐标换算、折线路径、刻度、十字线读数。画图组件在 QuantChart.tsx。
 */
import { fmtSub, focusSpan, SUB_NAME, type ChartData, type Focus } from '../../quant/charts';
import type { Series } from '../../quant/indicators';

export function bounds(values: Series[], include: number[] = []): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of values) {
    for (const v of s) {
      if (v != null && Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  for (const v of include) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo)) {
    return [0, 1];
  }
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
}

/** 折线：遇到 null 断开。 */
export function linePath(xs: number[], ys: (number | null)[]): string {
  let d = '';
  let on = false;
  ys.forEach((y, i) => {
    if (y == null || !Number.isFinite(y)) {
      on = false;
      return;
    }
    d += (on ? 'L' : 'M') + xs[i].toFixed(1) + ',' + y.toFixed(1);
    on = true;
  });
  return d;
}

/** 横坐标：第 i 个点（共 n 个）落在 [left, right] 的哪里。 */
export const xAt = (i: number, n: number, left: number, right: number) =>
  n <= 1 ? left : left + ((right - left) * i) / (n - 1);

/** 手指的横坐标 → 最近的点。 */
export const indexAt = (x: number, n: number, left: number, right: number) =>
  Math.max(0, Math.min(n - 1, Math.round(((x - left) / Math.max(1, right - left)) * (n - 1))));

// ---------- 刻度 ----------

/** 估算文字宽度（SVG 里量不了）：汉字一个字号宽，数字和字母约 0.6 个。 */
export function labelWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0x2e80 ? size : /[\d.+\-−%/,]/.test(ch) ? size * 0.58 : size * 0.62;
  }
  return w;
}

/** 刻度步长要几位小数：25 → 0，2.5 → 1，0.25 → 2。 */
export function tickDecimals(step: number): number {
  const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const scaled = step * 10 ** d;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6 ? d : d + 1;
}

/**
 * 「整」刻度：步长取 1 / 2 / 2.5 / 5 × 10ⁿ 里放得下（不超过 max 个）的最细一档，至少 2 个（范围太窄时放宽 max）。
 * 价格 182.3–247.9 → 200、220、240；ETF 4.512–4.738 → 4.55、4.6、4.65、4.7；百分比用小数算（0.1 = 10%）。
 */
export function niceTicks(lo: number, hi: number, max = 5): { ticks: number[]; step: number } {
  if (!(hi > lo)) {
    return { ticks: Number.isFinite(lo) ? [lo] : [], step: 1 };
  }
  const mag = 10 ** Math.floor(Math.log10((hi - lo) / max));
  const count = (s: number) => Math.floor(hi / s + 1e-9) - Math.ceil(lo / s - 1e-9) + 1;
  const step = [1, 2, 2.5, 5, 10, 20].map(m => m * mag).find(s => count(s) <= max) ?? 20 * mag;
  const d = tickDecimals(step);
  const ticks: number[] = [];
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) {
    ticks.push(Number((k * step).toFixed(d)));
  }
  return ticks.length < 2 && max < 12 ? niceTicks(lo, hi, max + 1) : { ticks, step };
}

export interface TimeTick {
  i: number;
  label: string;
}

type TimeUnit = { kind: 'week' | 'month' | 'year'; every: number };
const WEEKS: TimeUnit[] = [{ kind: 'week', every: 1 }, { kind: 'week', every: 2 }];
const MONTHS: TimeUnit[] = [
  { kind: 'month', every: 1 },
  { kind: 'month', every: 2 },
  { kind: 'month', every: 3 },
  { kind: 'month', every: 6 },
  { kind: 'year', every: 1 },
  { kind: 'year', every: 2 },
];

const mondayOf = (d: string) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

/** 每一段（周 / 月 / 年）的第一个交易日；图的第一天不算（那一段多半不完整）。 */
function starts(dates: string[], kind: TimeUnit['kind']): number[] {
  const key = kind === 'week' ? mondayOf : kind === 'month' ? (d: string) => d.slice(0, 7) : (d: string) => d.slice(0, 4);
  const out: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    if (key(dates[i]) !== key(dates[i - 1])) {
      out.push(i);
    }
  }
  return out;
}

const tickLabel = (d: string, u: TimeUnit) => {
  const m = Number(d.slice(5, 7));
  if (u.kind === 'week') {
    return m + '/' + Number(d.slice(8, 10));
  }
  return u.kind === 'year' || m === 1 ? d.slice(0, 4) + '年' : m + '月';
};

/**
 * 横轴刻度：两个半月以内按周，再长按月；从细到粗试「每周、隔周、每月、隔月、每季、半年、每年」，
 * 取第一个标签之间留得出 gap 的。minor 是没写标签的月份边界，week 是周边界（每周至少 7dp 时才给），
 * 都画成轴上的小刻度。
 */
export function timeTicks(
  dates: string[],
  x: (i: number) => number,
  size: number,
  gap = 8,
): { major: TimeTick[]; minor: number[]; week: number[] } {
  const units = dates.length <= 55 ? [...WEEKS, ...MONTHS] : MONTHS;
  for (const u of units) {
    const idx = starts(dates, u.kind).filter((i, k) =>
      u.kind === 'week' ? k % u.every === 0 : u.kind === 'month' ? (Number(dates[i].slice(5, 7)) - 1) % u.every === 0 : Number(dates[i].slice(0, 4)) % u.every === 0,
    );
    const major = idx.map(i => ({ i, label: tickLabel(dates[i], u) }));
    const fits = major.every((t, k) => k === 0 || x(t.i) - x(major[k - 1].i) >= (labelWidth(t.label, size) + labelWidth(major[k - 1].label, size)) / 2 + gap);
    if (fits) {
      const taken = new Set(idx);
      const minor = u.kind === 'week' ? [] : starts(dates, 'month').filter(i => !taken.has(i));
      const weeks = starts(dates, 'week');
      const roomy = weeks.length > 1 && (x(weeks[weeks.length - 1]) - x(weeks[0])) / (weeks.length - 1) >= 7;
      const used = new Set([...idx, ...minor]);
      return { major, minor, week: u.kind !== 'week' && roomy ? weeks.filter(i => !used.has(i)) : [] };
    }
  }
  return { major: [], minor: [], week: [] };
}

export interface PinnedLabel {
  x: number;
  label: string;
  tone: 'focus' | 'point';
  /** 第几段区间：同一段的第一天和最后一天挨得太近时合并。 */
  band?: number;
}

/**
 * 横轴上优先写的日期（区间第一天和最后一天、标注日），按给的顺序放：同一段区间的头尾挨得太近时合并成「9/1–9/3」；
 * 和已经放下的日期重叠的不写（两段区间首尾相接时，后一段的第一天让给前一段的最后一天）；和它们重叠的月份标签也不写。
 * 返回留下的月份刻度和要写的日期（x 已夹在图里）。
 */
export function axisLabels(
  major: TimeTick[],
  pinned: PinnedLabel[],
  x: (i: number) => number,
  size: number,
  width: number,
): { major: TimeTick[]; pinned: PinnedLabel[] } {
  const box = (p: PinnedLabel) => {
    const half = labelWidth(p.label, size) / 2;
    const cx = Math.max(half, Math.min(width - half, p.x));
    return { p, cx, x1: cx - half - 4, x2: cx + half + 4 };
  };
  const hits = (a: { x1: number; x2: number }, b: { x1: number; x2: number }) => a.x1 < b.x2 && b.x1 < a.x2;
  const placed: ReturnType<typeof box>[] = [];
  for (const p of pinned) {
    const b = box(p);
    const k = placed.findIndex(q => hits(q, b));
    if (k < 0) {
      placed.push(b);
    } else if (p.band != null && placed[k].p.band === p.band) {
      const q = placed[k].p;
      const m = box({ ...p, x: (q.x + p.x) / 2, label: q.label + '–' + p.label });
      if (!placed.some((o, j) => j !== k && hits(o, m))) {
        placed[k] = m;
      }
    }
  }
  const kept = major.filter(t => {
    const half = labelWidth(t.label, size) / 2;
    return !placed.some(b => x(t.i) + half > b.x1 && x(t.i) - half < b.x2);
  });
  return { major: kept, pinned: placed.map(b => ({ x: b.cx, label: b.p.label, tone: b.p.tone })) };
}

/**
 * 重点区间在横轴上的范围：区间里每个交易日占一格（点在格子中间），从第一天的格子左边到最后一天的格子右边。
 * 区间涨跌的基数（前一个交易日收盘）在区间左边一格，图上单独画一个点并写「前收」。
 */
export function bandX(dates: string[], f: Focus, x: (i: number) => number): { x1: number; x2: number } | null {
  const s = focusSpan(dates, f);
  if (!s) {
    return null;
  }
  const half = dates.length > 1 ? (x(1) - x(0)) / 2 : 4;
  return { x1: x(s.a) - half, x2: x(s.b) + half };
}

/** 十字线落在哪个区间里（区间第一天到最后一天）。 */
export function focusAt(c: ChartData, i: number): Focus | null {
  if (c.kind !== 'price' && c.kind !== 'compare') {
    return null;
  }
  return c.focus?.find(f => c.dates[i] >= f.from && c.dates[i] <= f.to) ?? null;
}

export const pointCount = (c: ChartData) =>
  c.kind === 'groups' ? c.means.length : c.kind === 'ic' ? c.ic.length : c.dates.length;

const pct = (v: number, d = 1) => (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%';

/** 十字线所在那一天的数字（全屏图下方的读数）；落在重点区间里时末尾注明（数据表里用竖线标，不写）。 */
export function readout(c: ChartData, i: number, focusNote = true): string {
  const f = focusNote ? focusAt(c, i) : null;
  const inFocus = f ? ' · 在「' + f.label + '」区间内' : '';
  switch (c.kind) {
    case 'price': {
      const day = i > 0 ? '（当日 ' + pct(c.close[i] / c.close[i - 1] - 1, 2) + '）' : '';
      const parts = [c.dates[i] + ' 收盘 ' + c.close[i].toFixed(2) + day];
      const ma = c.ma?.values[i];
      if (ma != null) {
        parts.push('MA' + c.ma!.n + ' ' + ma.toFixed(2));
      }
      if (c.band?.upper[i] != null && c.band.lower[i] != null) {
        parts.push('布林带上轨 ' + c.band.upper[i]!.toFixed(2) + ' / 下轨 ' + c.band.lower[i]!.toFixed(2));
      }
      const sub = c.sub?.values[i];
      if (sub != null && c.sub) {
        parts.push(SUB_NAME[c.sub.kind] + ' ' + fmtSub(c.sub.kind, sub));
      }
      return parts.join(' · ') + inFocus;
    }
    case 'compare':
      return c.dates[i] + ' · ' + c.series.map(s => s.name + ' ' + s.values[i].toFixed(1)).join(' · ') + inFocus;
    case 'factor':
      return c.dates[i] + ' · ' + c.groups.map((g, k) => 'Q' + (k + 1) + ' ' + g[i].toFixed(3)).join(' ') + ' · 基准 ' + c.bench[i].toFixed(3) + ' · 多空 ' + c.longShort[i].toFixed(3);
    case 'ic':
      return c.dates[i] + ' · Rank IC ' + (c.ic[i] > 0 ? '+' : '') + c.ic[i].toFixed(3) + ' · 累计 IC ' + c.ic.slice(0, i + 1).reduce((sum, v) => sum + v, 0).toFixed(3);
    case 'groups':
      return 'Q' + (i + 1) + ' 每期平均 ' + pct(c.means[i], 2);
  }
}

/** 「怎么算的」：全屏图下面的口径说明。 */
export function howComputed(c: ChartData): string[] {
  const focus = (c.kind === 'price' || c.kind === 'compare') && c.focus?.length
    ? ['重点区间（黄色）的涨跌：区间最后一天收盘 ÷ 区间前一个交易日收盘 − 1，和行情软件的「区间涨跌幅」一样']
    : [];
  switch (c.kind) {
    case 'price':
      return [
        '收盘价：前复权日 K（腾讯行情）',
        ...(c.ma ? ['MA' + c.ma.n + '：最近 ' + c.ma.n + ' 个收盘价的平均'] : []),
        ...(c.band ? ['布林带：MA20 ± 2 倍 20 日标准差'] : []),
        ...(c.sub
          ? [
              {
                mom20: '20 日动量：P(t) / P(t−20) − 1',
                mom60: '60 日动量：P(t) / P(t−60) − 1',
                vol20: '20 日年化波动：最近 20 天日收益的标准差 × √252',
                dd: '回撤：收盘价 / 此前最高收盘价 − 1',
                rsi14: 'RSI(14)：Wilder 平滑的 14 日相对强弱；70 以上通常叫超买，30 以下叫超卖',
                volume: '成交量：当天成交的股数；收盘比前一天高画红色，低画绿色',
              }[c.sub.kind],
            ]
          : []),
        ...focus,
      ];
    case 'compare':
      return [
        c.base
          ? '每只的收盘价除以 ' + c.base + '（第一段重点区间的前一个交易日）的收盘价 × 100：几条线在区间左边缘从同一点出发，区间里谁的线高谁就强；只用几只都有数据的交易日'
          : '每只的收盘价除以第一天的收盘价 × 100，只用几只都有数据的交易日',
        ...focus,
      ];
    case 'factor':
      return ['每个调仓日按因子从低到高分组，每组等权持有到下一个调仓日', '虚线是池子里全部股票等权的基准', '成本只扣最高组和最低组（按换手）'];
    case 'ic':
      return ['每期的 Rank IC：因子值排名和下一期收益排名的相关系数', '虚线是累计 IC'];
    case 'groups':
      return ['各组每期收益的平均值；从左到右因子值从低到高'];
  }
}
