/**
 * 分组回测和 Rank IC（QUANTWISE_DESIGN.md §7.3，示例教材 4.1–4.4）。和原型 quant.js 同一套口径：
 * 每 hold 个交易日调仓，按因子值从低到高分 G 组，等权持有到下一个调仓日；IC 是因子值和下一期收益的秩相关。
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
  turnover: number;
  avgStocks: number;
  stocks: number;
}

export class SampleError extends Error {}

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
  let prevTop: string[] | null = null;
  let prevBottom: string[] | null = null;
  for (let t = start; t + hold < p.dates.length; t += hold) {
    const rows: { c: string; x: number; r: number }[] = [];
    for (const c of p.codes) {
      const a = p.close[c][t];
      const b = p.close[c][t + hold];
      const x = a != null && b != null && a > 0 ? f.value(p, c, t) : null;
      if (x != null && Number.isFinite(x)) {
        rows.push({ c, x, r: b! / a! - 1 });
      }
    }
    if (rows.length < G * 2) {
      continue;
    }
    rows.sort((a, b) => a.x - b.x);
    if (!dates.length) {
      dates.push(p.dates[t]);
    }
    ic.push({ date: p.dates[t], ic: spearman(rows.map(r => r.x), rows.map(r => r.r)) });
    const per = rows.length / G;
    const part = (g: number) => rows.slice(Math.round(g * per), Math.round((g + 1) * per));
    const gr = Array.from({ length: G }, (_, g) => mean(part(g).map(r => r.r)));
    const top = part(G - 1).map(r => r.c);
    const bottom = part(0).map(r => r.c);
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
    longShortNav.push(longShortNav[longShortNav.length - 1] * (1 + ls));
    benchNav.push(benchNav[benchNav.length - 1] * (1 + mean(rows.map(r => r.r))));
    dates.push(p.dates[t + hold]);
    sizes.push(rows.length);
  }
  if (ic.length < 3) {
    throw new SampleError(
      '样本不够：只有 ' + ic.length + ' 期（至少 3 期、每期每组 2 只）。换一个更大的股票池、更短的调仓周期，或者回看更短的因子。',
    );
  }
  const icv = ic.map(x => x.ic);
  const m = mean(icv);
  const sd = stdev(icv);
  const perYear = TRADING_DAYS / hold;
  const n = longShortNav.length - 1;
  const groupMeans = groupRets.map(mean);
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
    turnover: mean(turns.slice(1)),
    avgStocks: mean(sizes),
    stocks: p.codes.length,
  };
}

const pct = (v: number, d = 1) => (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
const sgn = (v: number, d: number) => (v > 0 ? '+' : '') + v.toFixed(d);

/** 给模型看的结果：全部统计 + 怎么读（经验线、样本够不够），数字和图里的一致。 */
export function testSummary(r: TestResult, universeName: string): string {
  const f = FACTORS[r.input.factor];
  const sig = Math.abs(r.t) >= 2;
  return [
    '因子：' + f.name + '（' + f.formula + (f.approx ? '，近似' : '') + '）；股票池：' + universeName + '，' + r.stocks + ' 只，每期平均 ' + r.avgStocks.toFixed(0) + ' 只',
    '口径：每 ' + r.input.hold + ' 个交易日调仓，从低到高分 ' + r.input.groups + ' 组等权持有；单边成本 ' + (r.input.costBp ? '万 ' + r.input.costBp : '不扣') + '；前复权日线 ' + r.dates[0] + ' 到 ' + r.dates[r.dates.length - 1] + '，' + r.periods + ' 期',
    'Rank IC 均值 ' + sgn(r.icMean, 3) + '，标准差 ' + r.icStd.toFixed(3) + '，ICIR ' + r.icir.toFixed(2) + '（年化 ' + r.icirAnnual.toFixed(2) + '），IC 为正 ' + (r.icPositive * 100).toFixed(0) + '%，t 值 ' + r.t.toFixed(2),
    '各组每期平均收益（Q1 因子最低 → Q' + r.input.groups + ' 最高）：' + r.groupMeans.map(x => pct(x, 2)).join('，') + '；单调性 ' + r.monotonicity.toFixed(2),
    '多空（最高组 − 最低组' + (r.input.costBp ? '，已扣费' : '') + '）年化 ' + pct(r.longShortAnnual) + '；最高组每期平均换手 ' + (r.turnover * 100).toFixed(0) + '%',
    '怎么读：月度 Rank IC 均值绝对值 0.03 是常见的关注线；' + (sig ? '|t| ≥ 2，在这个样本里显著。' : '|t| < 2，在这个样本里不显著，期数少时多空收益很可能是噪声。') + '股票池用的是当前成分，有幸存者偏差。' + (f.approx ? '这个因子用今天的股本往回推，有误差。' : ''),
  ].join('\n');
}
