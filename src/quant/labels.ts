/**
 * 三重屏障和元标签（AFML 第 3 章；docs/design/pm-reader-lecture-20261105.md 第 10 项）：在一只股票或指数的真实日线上，
 * 1. 主信号：快均线上穿慢均线（金叉）做多；side = both 时下穿（死叉）也做空。信号当天收盘进场。
 * 2. 三重屏障：止盈 = 进场价 × (1 + pt × 目标波动)，止损 = 进场价 × (1 − sl × 目标波动)（做空反过来），最长持有 hold 个交易日；
 *    目标波动 = 信号前 60 日日收益的标准差 × √hold。按每天的收盘价判断先碰到哪一道，都没碰到就到期出场。
 * 3. 元标签：跟这次主信号赚没赚钱（顺方向的收益 > 0 是 1，否则 0）。
 * 4. 次级模型：逻辑回归，特征是信号当天能看到的 20 日波动、20 日动量、离 60 日高点、5 日 / 60 日量比（side = both 时加方向），
 *    按时间顺序只用这次信号之前已经出了结果的信号训练（没有前视）；概率 ≥ 0.5 放行。训练样本不够时这次不出概率（预热）。
 * 5. 对比「全部跟主信号」和「只做次级模型放行的」：次数、命中率、平均收益；只比两边都有概率之后的信号。
 * 不扣成本、不管涨跌停和 T+1；用的是今天还在交易的这只证券的前复权价。
 */
import type { DateStr } from '../engine/calendar';
import type { KBar } from '../market/tencent';
import { mean, sma, stdev } from './indicators';
import { SampleError } from './backtest';
import { dots, md, pct } from './charts';

export interface LabelInput {
  fast: number;
  slow: number;
  /** long：只做金叉（A 股个股做空受限，默认）；both：死叉也做空。 */
  side: 'long' | 'both';
  /** 止盈、止损是目标波动的几倍；0 = 不设这一道。 */
  pt: number;
  sl: number;
  /** 最长持有几个交易日（第三道屏障）。 */
  hold: number;
}

export const LABEL_DEFAULTS: LabelInput = { fast: 5, slow: 20, side: 'long', pt: 1, sl: 1, hold: 20 };

/** 先碰到的屏障：止盈、止损、到期；null = 还没出结果（数据到头了）。 */
export type Barrier = 'pt' | 'sl' | 'time';
export const BARRIER_NAME: Record<Barrier, string> = { pt: '止盈', sl: '止损', time: '到期' };

export interface LabelEvent {
  /** 信号那天（进场）的下标。 */
  i: number;
  side: 1 | -1;
  /** 目标波动（日波动 × √hold）。 */
  target: number;
  exit: number | null;
  barrier: Barrier | null;
  /** 顺方向的收益（做空时是价格跌了多少）。 */
  ret: number | null;
  /** 元标签：1 赚、0 没赚；没出结果时 null。 */
  label: 0 | 1 | null;
  /** 次级模型给的赚钱概率；训练样本还不够（预热）时 null。 */
  prob: number | null;
  features: number[];
}

export interface LabelHit {
  n: number;
  hits: number;
  /** 每次的平均收益（顺方向）。 */
  mean: number;
}

export interface LabelResult {
  input: LabelInput;
  dates: DateStr[];
  events: LabelEvent[];
  /** 已出结果的信号里，三道屏障各碰到几次（到期的另记赚钱的次数）。 */
  barriers: { pt: number; sl: number; time: number; timeWin: number };
  /** 有结果、但次级模型还在预热（没有概率）的信号数。 */
  warm: number;
  /** 只比有概率的信号：全部跟、只做放行的、没放行的。 */
  all: LabelHit;
  taken: LabelHit;
  skipped: LabelHit;
  /** 放行的命中率比全部高几个标准误（没放行或全放行时 null）。 */
  z: number | null;
  medianTarget: number;
}

/** 日收益波动的窗口、次级模型最少要几条训练样本（每一类至少几条）。 */
export const VOL_DAYS = 60;
export const MIN_TRAIN = 20;
export const MIN_CLASS = 5;
export const FEATURE_NAMES = ['20 日波动', '20 日动量', '离 60 日高点', '5 日 / 60 日量比'];

const ret = (c: number[], i: number) => c[i] / c[i - 1] - 1;

/** 第 i 天收盘时能看到的特征：20 日波动、20 日动量、离 60 日最高收盘、log(5 日均量 / 60 日均量)。 */
function featuresAt(c: number[], v: number[], i: number): number[] {
  const r20 = Array.from({ length: 20 }, (_, k) => ret(c, i - k));
  const hi60 = Math.max(...c.slice(i - VOL_DAYS + 1, i + 1));
  const v5 = mean(v.slice(i - 4, i + 1));
  const v60 = mean(v.slice(i - VOL_DAYS + 1, i + 1));
  return [stdev(r20), c[i] / c[i - 20] - 1, c[i] / hi60 - 1, v5 > 0 && v60 > 0 ? Math.log(v5 / v60) : 0];
}

/** 信号前 VOL_DAYS 日日收益的标准差。 */
function dailyVol(c: number[], i: number): number {
  return stdev(Array.from({ length: VOL_DAYS }, (_, k) => ret(c, i - k)));
}

/** 快线上穿慢线（+1）、下穿（−1）的那天。 */
function crosses(fast: (number | null)[], slow: (number | null)[], from: number): { i: number; side: 1 | -1 }[] {
  const out: { i: number; side: 1 | -1 }[] = [];
  for (let i = Math.max(1, from); i < fast.length; i++) {
    const f0 = fast[i - 1];
    const s0 = slow[i - 1];
    const f1 = fast[i];
    const s1 = slow[i];
    if (f0 == null || s0 == null || f1 == null || s1 == null) {
      continue;
    }
    if (f0 <= s0 && f1 > s1) {
      out.push({ i, side: 1 });
    } else if (f0 >= s0 && f1 < s1) {
      out.push({ i, side: -1 });
    }
  }
  return out;
}

/** 按收盘价看先碰到哪一道屏障；hold 天里都没碰到就到期。数据不够 hold 天又没碰到时还没结果。 */
function touch(c: number[], i: number, side: 1 | -1, target: number, x: LabelInput): { exit: number; barrier: Barrier; ret: number } | null {
  const end = Math.min(c.length - 1, i + x.hold);
  for (let j = i + 1; j <= end; j++) {
    const r = side * (c[j] / c[i] - 1);
    if (x.pt > 0 && r >= x.pt * target) {
      return { exit: j, barrier: 'pt', ret: r };
    }
    if (x.sl > 0 && r <= -x.sl * target) {
      return { exit: j, barrier: 'sl', ret: r };
    }
  }
  return i + x.hold <= c.length - 1 ? { exit: i + x.hold, barrier: 'time', ret: side * (c[i + x.hold] / c[i] - 1) } : null;
}

/** 解 A·x = b（高斯消元，列主元）；奇异时返回 null。 */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, k) => [...row, b[k]]);
  for (let col = 0; col < n; col++) {
    let p = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[p][col])) {
        p = r;
      }
    }
    if (Math.abs(M[p][col]) < 1e-12) {
      return null;
    }
    [M[col], M[p]] = [M[p], M[col]];
    for (let r = 0; r < n; r++) {
      if (r !== col) {
        const f = M[r][col] / M[col][col];
        for (let k = col; k <= n; k++) {
          M[r][k] -= f * M[col][k];
        }
      }
    }
  }
  return M.map((row, k) => row[n] / row[k]);
}

/**
 * 逻辑回归（特征先按训练样本标准化，L2 惩罚 λ = 1，截距不罚），牛顿法迭代。返回预测函数。
 * 样本少（几十条）时 λ 让系数不至于飞出去。
 */
export function fitLogistic(X: number[][], y: number[], lambda = 1): (x: number[]) => number {
  const d = X[0].length;
  const mu = Array.from({ length: d }, (_, k) => mean(X.map(r => r[k])));
  const sd = Array.from({ length: d }, (_, k) => stdev(X.map(r => r[k])) || 1);
  const z = (x: number[]) => [1, ...x.map((v, k) => (v - mu[k]) / sd[k])];
  const Z = X.map(z);
  let w = new Array(d + 1).fill(0);
  const p = (zr: number[]) => 1 / (1 + Math.exp(-zr.reduce((s, v, k) => s + v * w[k], 0)));
  for (let it = 0; it < 30; it++) {
    const g = w.map((wk, k) => (k ? lambda * wk : 0));
    const H = w.map((_, a) => w.map((__, b) => (a === b && a ? lambda : 0) + (a === b ? 1e-9 : 0)));
    Z.forEach((zr, r) => {
      const pr = p(zr);
      const s = pr * (1 - pr);
      for (let a = 0; a <= d; a++) {
        g[a] += (pr - y[r]) * zr[a];
        for (let b = 0; b <= d; b++) {
          H[a][b] += s * zr[a] * zr[b];
        }
      }
    });
    const step = solve(H, g);
    if (!step) {
      break;
    }
    w = w.map((wk, k) => wk - step[k]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) {
      break;
    }
  }
  return x => p(z(x));
}

const hitOf = (xs: LabelEvent[]): LabelHit => ({
  n: xs.length,
  hits: xs.filter(e => e.label === 1).length,
  mean: mean(xs.map(e => e.ret as number)),
});

/** 收盘价（元）、成交量和日期：按日期排好。 */
export function runLabels(bars: { date: DateStr; close: number; volume: number }[], x: LabelInput): LabelResult {
  const c = bars.map(b => b.close);
  const v = bars.map(b => b.volume);
  const start = Math.max(VOL_DAYS, x.slow);
  if (c.length < start + x.hold + 60) {
    throw new SampleError('日线只有 ' + c.length + ' 根：均线、波动和持有期要用掉约 ' + (start + x.hold) + ' 根，剩下的不够产生信号。换一只上市更久的证券，或者把 slow、hold 调小');
  }
  const fast = sma(c, x.fast);
  const slow = sma(c, x.slow);
  const events: LabelEvent[] = [];
  for (const s of crosses(fast, slow, start)) {
    if (x.side === 'long' && s.side < 0) {
      continue;
    }
    const target = dailyVol(c, s.i) * Math.sqrt(x.hold);
    if (!(target > 0)) {
      continue;
    }
    const t = touch(c, s.i, s.side, target, x);
    const label: 0 | 1 | null = t ? (t.ret > 0 ? 1 : 0) : null;
    const features = [...featuresAt(c, v, s.i), ...(x.side === 'both' ? [s.side] : [])];
    events.push({ i: s.i, side: s.side, target, exit: t?.exit ?? null, barrier: t?.barrier ?? null, ret: t?.ret ?? null, label, prob: null, features });
  }
  // 次级模型：每次信号只用在它之前已经出了结果（出场在信号之前）的信号训练
  for (const e of events) {
    const train = events.filter(o => o.exit != null && o.exit < e.i);
    const wins = train.filter(o => o.label === 1).length;
    if (train.length >= MIN_TRAIN && wins >= MIN_CLASS && train.length - wins >= MIN_CLASS) {
      e.prob = fitLogistic(train.map(o => o.features), train.map(o => o.label as number))(e.features);
    }
  }
  const done = events.filter(e => e.label != null);
  const scored = done.filter(e => e.prob != null);
  const taken = scored.filter(e => e.prob! >= 0.5);
  const all = hitOf(scored);
  const tk = hitOf(taken);
  // 放行的命中率比全部高几个标准误：随机挑同样多次时命中率的标准差（不放回抽样）
  const p0 = all.n ? all.hits / all.n : 0;
  const se = all.n > 1 && tk.n > 0 && tk.n < all.n ? Math.sqrt((p0 * (1 - p0) / tk.n) * ((all.n - tk.n) / (all.n - 1))) : 0;
  const sorted = events.map(e => e.target).sort((a, b) => a - b);
  return {
    input: x,
    dates: bars.map(b => b.date),
    events,
    barriers: {
      pt: done.filter(e => e.barrier === 'pt').length,
      sl: done.filter(e => e.barrier === 'sl').length,
      time: done.filter(e => e.barrier === 'time').length,
      timeWin: done.filter(e => e.barrier === 'time' && e.label === 1).length,
    },
    warm: done.length - scored.length,
    all,
    taken: tk,
    skipped: hitOf(scored.filter(e => e.prob! < 0.5)),
    z: se > 0 ? (tk.hits / tk.n - p0) / se : null,
    medianTarget: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
  };
}

// ---------- 图 ----------

/** 图里的一次信号（下标都是图里的下标）。 */
export interface LabelMark {
  i: number;
  side: 1 | -1;
  entry: number;
  /** 上、下两道屏障的价格（做多时上面是止盈；做空时上面是止损）；pt / sl 为 0 时没有那一道。 */
  upper: number | null;
  lower: number | null;
  /** 到期那天（可能在图的右边外面）。 */
  due: number;
  exit: number | null;
  barrier: Barrier | null;
  ret: number | null;
  label: 0 | 1 | null;
  prob: number | null;
  target: number;
}

export interface LabelStats extends LabelInput {
  /** 全部样本：起止日期、日线根数、信号次数、已出结果的次数。 */
  from: DateStr;
  to: DateStr;
  bars: number;
  signals: number;
  done: number;
  warm: number;
  barriers: LabelResult['barriers'];
  all: LabelHit;
  taken: LabelHit;
  skipped: LabelHit;
  z: number | null;
  medianTarget: number;
}

export interface LabelsChart {
  kind: 'labels';
  code: string;
  name: string;
  dates: DateStr[];
  close: number[];
  fast: (number | null)[];
  slow: (number | null)[];
  events: LabelMark[];
  stats: LabelStats;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const pc = (v: number, d = 2) => pct(v, d);
const p1 = (h: LabelHit) => (h.n ? ((h.hits / h.n) * 100).toFixed(1) + '%' : '—');

/** 「金叉做多」「死叉做空」。 */
export const signalName = (side: 1 | -1) => (side > 0 ? '金叉做多' : '死叉做空');

/** 「止盈 = 进场价 × (1 + 1 × 目标波动)，止损 = 进场价 × (1 − 1 × 目标波动)，最长持有 20 个交易日」（做多时）。 */
export const barrierRule = (s: LabelInput) =>
  [
    s.pt ? '止盈 = 进场价 × (1 + ' + s.pt + ' × 目标波动)' : '不设止盈',
    s.sl ? '止损 = 进场价 × (1 − ' + s.sl + ' × 目标波动)' : '不设止损',
    '最长持有 ' + s.hold + ' 个交易日',
  ].join('，');

/** 一次信号的读数：「2026-09-15 金叉做多 · 进场 245.30 · 止盈 266.80（+8.8%），止损 223.80（-8.8%）· 9/28 止盈出场 +9.1%（元标签 1）· 次级模型 62% 放行」。 */
export function eventLine(c: LabelsChart, m: LabelMark): string {
  const pt = m.side > 0 ? m.upper : m.lower;
  const sl = m.side > 0 ? m.lower : m.upper;
  const bar = (name: string, p: number | null) => (p == null ? '' : name + ' ' + p.toFixed(2) + '（' + pc(p / m.entry - 1, 1) + '）');
  const barriers = [bar('止盈', pt), bar('止损', sl)].filter(Boolean).join('，');
  const out = m.barrier && m.exit != null && m.ret != null
    ? md(c.dates[m.exit]) + ' ' + BARRIER_NAME[m.barrier] + '出场 ' + pc(m.ret, 1) + '（元标签 ' + m.label + '）'
    : '还没出结果（最长持有 ' + c.stats.hold + ' 个交易日）';
  const model = m.prob == null ? '次级模型预热中' : '次级模型 ' + Math.round(m.prob * 100) + '% ' + (m.prob >= 0.5 ? '放行' : '不放行');
  return dots([c.dates[m.i] + ' ' + signalName(m.side), '进场 ' + m.entry.toFixed(2), ...(barriers ? [barriers] : []), out, model]);
}

/** 放行的比全部好不好：样本太少、不到 2 个标准误时都说「说明不了」。 */
export function labelVerdict(s: LabelStats): string {
  if (!s.taken.n) {
    return '次级模型这段时间一次也没放行（给的概率都不到 0.5）：它从这些特征里学到的是「多数信号不赚」，比不出放行之后好不好';
  }
  if (!s.skipped.n) {
    return '次级模型全部放行：和「全部跟主信号」一样，这段数据里它没起作用';
  }
  const d = (s.taken.hits / s.taken.n - s.all.hits / s.all.n) * 100;
  const head = '放行的命中率比全部' + (d >= 0 ? '高 ' : '低 ') + Math.abs(d).toFixed(1) + ' 个百分点';
  if (s.all.n < MIN_TRAIN || s.taken.n < MIN_CLASS) {
    return head + '，但全部只有 ' + s.all.n + ' 次、放行 ' + s.taken.n + ' 次，样本太少，这次说明不了次级模型有没有用（想多一些信号可以把 fast、slow 调小，例如 3 / 10）';
  }
  const z = s.z ?? 0;
  // 几次信号的持有期重叠，标签不是独立的：按独立算的标准误偏小（AFML 第 4 章讲的就是这个）
  return head + '，约 ' + Math.abs(z).toFixed(1) + ' 个标准误' +
    (Math.abs(z) < 2
      ? '（不到 2 个）：可能只是运气，这次说明不了次级模型有没有用'
      : (z > 0 ? '：这段样本里放行的信号更好' : '：次级模型反而挑出了更差的信号') +
        '；但几次信号的持有期重叠、结果并不独立，这个标准误偏小，换一段时间、换一只证券不一定还成立');
}

/**
 * 画图的数据和给模型的摘要：全部样本算标签和次级模型，图只画最近 n 根（默认 250）和里面的信号。
 * 最后一根是今天的盘中数据时不用（收盘价还没定）。
 */
export function labelsChart(o: { code: string; name: string; bars: KBar[]; input: LabelInput; n?: number; today?: string | null }): { chart: LabelsChart; text: string } {
  const live = !!o.today && o.bars[o.bars.length - 1]?.date === o.today;
  const bars = (live ? o.bars.slice(0, -1) : o.bars).map(b => ({ date: b.date, close: b.close / 1000, volume: b.volume }));
  const r = runLabels(bars, o.input);
  const x = o.input;
  const n = Math.min(bars.length, Math.max(60, Math.min(750, o.n ?? 250)));
  const a = bars.length - n;
  const fast = sma(bars.map(b => b.close), x.fast);
  const slow = sma(bars.map(b => b.close), x.slow);
  const events: LabelMark[] = r.events.filter(e => e.i >= a).map(e => {
    const entry = bars[e.i].close;
    const up = e.side > 0 ? x.pt : x.sl;
    const down = e.side > 0 ? x.sl : x.pt;
    return {
      i: e.i - a,
      side: e.side,
      entry: r3(entry),
      upper: up > 0 ? r3(entry * (1 + up * e.target)) : null,
      lower: down > 0 ? r3(entry * (1 - down * e.target)) : null,
      due: e.i - a + x.hold,
      exit: e.exit == null ? null : e.exit - a,
      barrier: e.barrier,
      ret: e.ret == null ? null : r4(e.ret),
      label: e.label,
      prob: e.prob == null ? null : r3(e.prob),
      target: r4(e.target),
    };
  });
  const hit = (h: LabelHit): LabelHit => ({ ...h, mean: r4(h.mean) });
  const stats: LabelStats = {
    ...x,
    from: bars[0].date,
    to: bars[bars.length - 1].date,
    bars: bars.length,
    signals: r.events.length,
    done: r.events.filter(e => e.label != null).length,
    warm: r.warm,
    barriers: r.barriers,
    all: hit(r.all),
    taken: hit(r.taken),
    skipped: hit(r.skipped),
    z: r.z == null ? null : Math.round(r.z * 100) / 100,
    medianTarget: r4(r.medianTarget),
  };
  const chart: LabelsChart = {
    kind: 'labels',
    code: o.code,
    name: o.name,
    dates: bars.slice(a).map(b => b.date),
    close: bars.slice(a).map(b => r3(b.close)),
    fast: fast.slice(a).map(v => (v == null ? null : r3(v))),
    slow: slow.slice(a).map(v => (v == null ? null : r3(v))),
    events,
    stats,
  };
  return { chart, text: labelText(chart, live ? o.bars[o.bars.length - 1].date : null) };
}

/** 给模型的摘要：口径、三道屏障各碰到几次、元标签、次级模型的对比和结论，图怎么看。 */
function labelText(c: LabelsChart, live: DateStr | null): string {
  const s = c.stats;
  const b = s.barriers;
  const sig = 'MA' + s.fast + ' 上穿 MA' + s.slow + '（金叉）做多' + (s.side === 'both' ? '、下穿（死叉）做空' : '');
  const lines = [
    '元标签检验：' + c.name + '（' + c.code + '）前复权日线 ' + s.from + ' 至 ' + s.to + '，共 ' + s.bars + ' 根' + (live ? '（' + live + ' 是今天的盘中数据，没有用）' : ''),
    '主信号：' + sig + '，信号当天收盘进场；共 ' + s.signals + ' 次，' + s.done + ' 次已出结果' + (s.signals > s.done ? '，最近 ' + (s.signals - s.done) + ' 次还没到期' : ''),
    '三重屏障：' + barrierRule(s) + (s.side === 'both' ? '（做空时止盈在下、止损在上）' : '') +
      '；目标波动 = 信号前 ' + VOL_DAYS + ' 日日收益的标准差 × √' + s.hold + '（这次的中位数 ' + (s.medianTarget * 100).toFixed(1) + '%）；按每天的收盘价判断先碰到哪一道',
    '结果：止盈 ' + b.pt + ' 次、止损 ' + b.sl + ' 次、到期 ' + b.time + ' 次（其中 ' + b.timeWin + ' 次到期时是赚的）；元标签（跟这次主信号赚没赚）为 1 的 ' + (b.pt + b.timeWin) + ' / ' + s.done,
    '次级模型：逻辑回归，特征是信号当天的' + FEATURE_NAMES.join('、') + (s.side === 'both' ? '和方向' : '') + '；按时间顺序，每次只用在它之前已经出了结果的信号训练（至少 ' + MIN_TRAIN + ' 次，赚和没赚各 ' + MIN_CLASS + ' 次以上），赚钱概率 ≥ 0.5 才放行',
  ];
  if (!s.all.n) {
    lines.push('已出结果的信号只有 ' + s.done + ' 次，不够训练次级模型：可以把 fast、slow 调小让信号多一些，或者换一只上市更久的证券；这次只看三重屏障的标签，比不了加不加次级模型');
  } else {
    lines.push(
      '对比（前 ' + s.warm + ' 次是次级模型的预热，不算；比的是之后的 ' + s.all.n + ' 次）：',
      '- 全部跟主信号：' + s.all.n + ' 次，命中率 ' + p1(s.all) + '，平均每次 ' + pc(s.all.mean),
      '- 只做次级模型放行的：' + s.taken.n + ' 次，命中率 ' + p1(s.taken) + '，平均每次 ' + (s.taken.n ? pc(s.taken.mean) : '—'),
      '- 没放行的：' + s.skipped.n + ' 次，命中率 ' + p1(s.skipped) + '，平均每次 ' + (s.skipped.n ? pc(s.skipped.mean) : '—'),
      labelVerdict(s),
    );
    if (s.taken.n && s.skipped.n) {
      lines.push('精确率和召回率：放行的里赚钱的占 ' + p1(s.taken) + '（精确率）；比较期赚钱的 ' + s.all.hits + ' 次里放行了 ' + s.taken.hits + ' 次（召回率 ' + ((s.taken.hits / Math.max(1, s.all.hits)) * 100).toFixed(1) + '%）：次级模型用少做来换命中率');
    }
  }
  lines.push('口径：不扣佣金和印花税，不管涨跌停和 T+1，按收盘价进出；几次信号的持有期会重叠，平均收益不能连成一条净值线；用的是今天还在交易的这只证券（幸存者偏差）');
  const last = c.events[c.events.length - 1];
  lines.push(
    '图：最近 ' + c.dates.length + ' 个交易日的收盘价和 MA' + s.fast + ' / MA' + s.slow + '，里面的 ' + c.events.length + ' 次信号画成三角（向上是金叉做多' + (s.side === 'both' ? '、向下是死叉做空' : '') +
      '），红色赚、绿色亏、灰色还没结果，实心是次级模型放行、空心是没放行，淡色是预热；默认框出最近一次信号的三道屏障，用户点别的三角看那一次' + (last ? '。最近一次：' + eventLine(c, last) : ''),
  );
  return lines.join('\n');
}
