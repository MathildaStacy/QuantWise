/**
 * 分组回测和 Rank IC（QUANTWISE_DESIGN.md §7.3，示例教材 4.1–4.4）。和原型 quant.js 同一套口径：
 * 每 hold 个交易日调仓，按因子值从低到高分 G 组，等权（或按调仓日市值加权）持有到下一个调仓日；IC 是因子值和下一期收益的秩相关。
 * 多空每期收益的均值和 t 值对应书里分组表的「High−Low」一列（书里多是 Newey-West 调整的 t 值，这里是普通 t 值）。
 */
import type { DateStr } from '../engine/calendar';
import { FACTORS, type FactorId, type Panel } from './factors';
import { mean, ranks, spearman, stdev, TRADING_DAYS } from './indicators';

export interface TestInput {
  factor: FactorId;
  hold: number;
  groups: number;
  /** 单边成本（万分之）。 */
  costBp: number;
  /** 第一个调仓日的下标；默认 = 因子回看窗口 + 1。 */
  start?: number;
  /** 组内加权：等权（默认）或按调仓日的总市值（今天的市值按价格往回推，近似）。 */
  weight?: 'equal' | 'cap';
  /**
   * 控制市值的双重排序（书里「控制市值后」的表）：先按调仓日总市值分 groups 组，conditional 在每个市值组里再按因子分组，
   * independent 两个变量各自分组再取交集；因子各组的收益 = 各市值组同一因子组的平均，IC 在市值组内算再平均。
   */
  control?: { by: 'size'; groups: number; sort: 'conditional' | 'independent' };
}

export interface TestResult {
  input: TestInput;
  /** 每期至少几只股票才算一期（每组 2 只）。 */
  periods: number;
  /** 净值曲线的日期：第一个调仓日 + 每期结束的那天。 */
  dates: DateStr[];
  groupNav: number[][];
  benchNav: number[];
  longShortNav: number[];
  ic: { date: DateStr; ic: number }[];
  icMean: number;
  icStd: number;
  icir: number;
  icirAnnual: number;
  icPositive: number;
  t: number;
  groupMeans: number[];
  monotonicity: number;
  longShortAnnual: number;
  /** 多空（最高组 − 最低组，扣费后）每期收益的均值、标准差和 t 值。 */
  longShortMean: number;
  longShortStd: number;
  longShortT: number;
  turnover: number;
  avgStocks: number;
  stocks: number;
  /** 双重排序时每个市值组（从小到大）的多空（因子最高组 − 最低组，未扣费）每期平均和 t 值。 */
  controlLongShort?: { mean: number; t: number }[];
}

export class SampleError extends Error {}

/** 调仓日的总市值：今天的总市值 × P(t) / P(今天)（和小市值因子同一个近似）；没有市值时为 null。 */
function capAt(p: Panel, c: string, t: number): number | null {
  const total = p.cap[c].total;
  const v = p.close[c][t];
  let now: number | null = null;
  for (let i = p.close[c].length - 1; i >= 0 && now == null; i--) now = p.close[c][i];
  return total && v && now ? (total * v) / now : null;
}

/** 组收益：有权重时按权重（缺市值的按组内平均权重算），否则等权。 */
function weighted(rows: { r: number; w: number | null }[]): number {
  const known = rows.filter(x => x.w != null && x.w > 0);
  if (!known.length || (known.length === rows.length && rows.every(x => x.w === 1))) return mean(rows.map(x => x.r));
  const fill = known.reduce((n, x) => n + x.w!, 0) / known.length;
  let sw = 0;
  let sr = 0;
  for (const x of rows) {
    const w = x.w != null && x.w > 0 ? x.w : fill;
    sw += w;
    sr += w * x.r;
  }
  return sr / sw;
}

export function runFactorTest(p: Panel, input: TestInput): TestResult {
  const f = FACTORS[input.factor];
  const { hold, groups: G } = input;
  const cost = input.costBp / 1e4;
  const start = input.start ?? f.lookback + 1;
  const groupNav = Array.from({ length: G }, () => [1]);
  const benchNav = [1];
  const longShortNav = [1];
  const ic: TestResult['ic'] = [];
  const dates: DateStr[] = [];
  const groupRets: number[][] = Array.from({ length: G }, () => []);
  const turns: number[] = [];
  const sizes: number[] = [];
  const lsRets: number[] = [];
  const capWeight = input.weight === 'cap';
  const ctl = input.control;
  /** 市值组数；不控制时只有一组，下面的算法和单变量分组完全一样。 */
  const S = ctl ? ctl.groups : 1;
  const cellRets: number[][] = Array.from({ length: S }, () => []);
  let prevTop: string[] | null = null;
  let prevBottom: string[] | null = null;
  type Row = { c: string; x: number; r: number; w: number | null; s: number };
  const split = <X>(xs: X[], n: number) => {
    const per = xs.length / n;
    return Array.from({ length: n }, (_, g) => xs.slice(Math.round(g * per), Math.round((g + 1) * per)));
  };
  for (let t = start; t + hold < p.dates.length; t += hold) {
    const rows: Row[] = [];
    for (const c of p.codes) {
      const a = p.close[c][t];
      const b = p.close[c][t + hold];
      const x = a != null && b != null && a > 0 ? f.value(p, c, t) : null;
      const s = ctl ? capAt(p, c, t) : 0;
      if (x != null && Number.isFinite(x) && s != null) {
        rows.push({ c, x, r: b! / a! - 1, w: capWeight ? (ctl ? s : capAt(p, c, t)) : 1, s });
      }
    }
    if (rows.length < G * 2 * S) {
      continue;
    }
    rows.sort((a, b) => a.x - b.x);
    // 每个市值组里的因子分组 cells[s][g]：条件排序在市值组里按因子再分，独立排序用全部股票的因子分位
    let cells: Row[][][];
    if (!ctl) {
      cells = [split(rows, G)];
    } else {
      const bySize = split([...rows].sort((a, b) => a.s - b.s), S);
      if (ctl.sort === 'conditional') {
        cells = bySize.map(grp => split([...grp].sort((a, b) => a.x - b.x), G));
      } else {
        const fg = new Map<string, number>();
        split(rows, G).forEach((g, k) => g.forEach(r => fg.set(r.c, k)));
        cells = bySize.map(grp => Array.from({ length: G }, (_, k) => grp.filter(r => fg.get(r.c) === k)));
        if (cells.some(grp => grp.some(g => !g.length))) {
          continue;
        }
      }
    }
    const buckets = ctl ? cells.map(b => b.flat()) : [rows];
    if (!dates.length) {
      dates.push(p.dates[t]);
    }
    ic.push({ date: p.dates[t], ic: mean(buckets.map(b => spearman(b.map(r => r.x), b.map(r => r.r)))) });
    const gr = Array.from({ length: G }, (_, g) => mean(cells.map(b => weighted(b[g]))));
    cells.forEach((b, k) => cellRets[k].push(weighted(b[G - 1]) - weighted(b[0])));
    const top = cells.flatMap(b => b[G - 1].map(r => r.c));
    const bottom = cells.flatMap(b => b[0].map(r => r.c));
    const changed = (now: string[], prev: string[] | null) =>
      prev ? now.filter(c => !prev.includes(c)).length / now.length : 1;
    const tTop = changed(top, prevTop);
    const tBottom = changed(bottom, prevBottom);
    prevTop = top;
    prevBottom = bottom;
    turns.push(tTop);
    gr.forEach((r, g) => {
      groupRets[g].push(r);
      const c = g === G - 1 ? tTop : g === 0 ? tBottom : 0;
      groupNav[g].push(groupNav[g][groupNav[g].length - 1] * (1 + r - c * cost * 2));
    });
    const ls = gr[G - 1] - gr[0] - (tTop + tBottom) * cost * 2;
    lsRets.push(ls);
    longShortNav.push(longShortNav[longShortNav.length - 1] * (1 + ls));
    benchNav.push(benchNav[benchNav.length - 1] * (1 + mean(rows.map(r => r.r))));
    dates.push(p.dates[t + hold]);
    sizes.push(rows.length);
  }
  if (ic.length < 3) {
    throw new SampleError(
      ctl
        ? '样本不够：双重排序只有 ' + ic.length + ' 期（至少 3 期；' + S + ' 个市值组 × ' + G + ' 个因子组，每期至少要 ' + S * G * 2 + ' 只' + (ctl.sort === 'independent' ? '，独立排序时每一格都要有股票' : '') + '）。换一个更大的股票池（中证 500 / 中证 1000），或者少分几组。'
        : '样本不够：只有 ' + ic.length + ' 期（至少 3 期、每期每组 2 只）。换一个更大的股票池、更短的调仓周期，或者回看更短的因子。',
    );
  }
  const icv = ic.map(x => x.ic);
  const m = mean(icv);
  const sd = stdev(icv);
  const perYear = TRADING_DAYS / hold;
  const n = longShortNav.length - 1;
  const groupMeans = groupRets.map(mean);
  const lsMean = mean(lsRets);
  const lsSd = lsRets.length > 1 ? stdev(lsRets) : 0;
  return {
    input,
    periods: ic.length,
    dates,
    groupNav,
    benchNav,
    longShortNav,
    ic,
    icMean: m,
    icStd: sd,
    icir: sd ? m / sd : 0,
    icirAnnual: sd ? (m / sd) * Math.sqrt(perYear) : 0,
    icPositive: icv.filter(x => x > 0).length / icv.length,
    t: sd ? m / (sd / Math.sqrt(icv.length)) : 0,
    groupMeans,
    monotonicity: spearman(groupMeans.map((_, i) => i), ranks(groupMeans)),
    longShortAnnual: Math.pow(longShortNav[n], perYear / n) - 1,
    longShortMean: lsMean,
    longShortStd: lsSd,
    longShortT: lsSd ? lsMean / (lsSd / Math.sqrt(lsRets.length)) : 0,
    turnover: mean(turns.slice(1)),
    avgStocks: mean(sizes),
    stocks: p.codes.length,
    ...(ctl
      ? {
          controlLongShort: cellRets.map(xs => {
            const sd2 = stdev(xs);
            return { mean: mean(xs), t: sd2 ? mean(xs) / (sd2 / Math.sqrt(xs.length)) : 0 };
          }),
        }
      : {}),
  };
}

const pct = (v: number, d = 1) => (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
const sgn = (v: number, d: number) => (v > 0 ? '+' : '') + v.toFixed(d);

/**
 * 给模型看的结果：全部统计 + 怎么读（经验线、样本够不够），数字和图里的一致。
 * bookPeriods 是书里那张表的期数（例如 2000—2019 年月频约 240 期）：给了就写明本次少多少、t 值为什么会小。
 */
export function testSummary(r: TestResult, universeName: string, bookPeriods?: number): string {
  const f = FACTORS[r.input.factor];
  const sig = Math.abs(r.t) >= 2;
  const ctl = r.input.control;
  const years = (Date.parse(r.dates[r.dates.length - 1]) - Date.parse(r.dates[0])) / (365.25 * 864e5);
  const how = (r.input.weight === 'cap' ? '按调仓日总市值加权（市值用今天的股本往回推，近似）' : '等权') + '持有';
  const sort = ctl
    ? '先按调仓日总市值从小到大分 ' + ctl.groups + ' 组，' + (ctl.sort === 'conditional' ? '在每个市值组里再按因子从低到高分 ' : '因子另外按全部股票从低到高分 ') + r.input.groups + ' 组（' + (ctl.sort === 'conditional' ? '条件' : '独立') + '双重排序），' + how + '，因子各组的收益 = 各市值组同一因子组的平均'
    : '从低到高分 ' + r.input.groups + ' 组' + how;
  const lines = [
    '因子：' + f.name + '（' + f.formula + (f.approx ? '，近似' : '') + '）；股票池：' + universeName + '，' + r.stocks + ' 只，每期平均 ' + r.avgStocks.toFixed(0) + ' 只',
    '口径：每 ' + r.input.hold + ' 个交易日调仓，' + sort + '；单边成本 ' + (r.input.costBp ? '万 ' + r.input.costBp : '不扣') + '；前复权日线 ' + r.dates[0] + ' 到 ' + r.dates[r.dates.length - 1] + '（约 ' + years.toFixed(1) + ' 年），' + r.periods + ' 期',
    'Rank IC 均值 ' + sgn(r.icMean, 3) + (ctl ? '（在每个市值组里算再平均）' : '') + '，标准差 ' + r.icStd.toFixed(3) + '，ICIR ' + r.icir.toFixed(2) + '（年化 ' + r.icirAnnual.toFixed(2) + '），IC 为正 ' + (r.icPositive * 100).toFixed(0) + '%，t 值 ' + r.t.toFixed(2),
    '各组每期平均收益（Q1 因子最低 → Q' + r.input.groups + ' 最高）：' + r.groupMeans.map(x => pct(x, 2)).join('，') + '；单调性 ' + r.monotonicity.toFixed(2),
    '多空（最高组 − 最低组' + (r.input.costBp ? '，已扣费' : '') + '）每期平均 ' + pct(r.longShortMean, 2) + '（t 值 ' + r.longShortT.toFixed(2) + '，' + r.periods + ' 期，普通 t 值、没做 Newey-West 调整），年化 ' + pct(r.longShortAnnual) + '；最高组每期平均换手 ' + (r.turnover * 100).toFixed(0) + '%',
  ];
  if (r.controlLongShort) {
    lines.push('各市值组的多空（从小市值到大市值，未扣费，对应书里双重排序表里每个市值组的 High−Low）：' + r.controlLongShort.map((x, k) => 'S' + (k + 1) + ' ' + pct(x.mean, 2) + '（t ' + x.t.toFixed(2) + '）').join('，') + '；上面的多空是它们的平均');
  }
  if (bookPeriods && bookPeriods > 0) {
    const k = bookPeriods / r.periods;
    lines.push('期数对照：本次 ' + r.periods + ' 期（约 ' + years.toFixed(1) + ' 年），书中约 ' + bookPeriods + ' 期' + (k >= 1.5 ? '，约为本次的 ' + k.toFixed(k >= 10 ? 0 : 1) + ' 倍。同样的每期收益和波动，t 值大约随期数的平方根变大，书中的 t 值相当于本次的 ' + Math.sqrt(k).toFixed(1) + ' 倍左右，所以本次 |t| 小不等于和书里矛盾' : ''));
  }
  lines.push('怎么读：月度 Rank IC 均值绝对值 0.03 是常见的关注线；' + (sig ? 'IC 的 |t| ≥ 2，在这个样本里显著。' : 'IC 的 |t| < 2，在这个样本里不显著，期数少时多空收益很可能是噪声。') + '和书里的分组表对照时看多空每期平均和它的 t 值。股票池用的是当前成分，有幸存者偏差；回测区间只有约 ' + years.toFixed(1) + ' 年，期数远少于学术研究。' + (f.approx || r.input.weight === 'cap' || ctl ? '市值用今天的股本往回推，有误差。' : ''));
  return lines.join('\n');
}
