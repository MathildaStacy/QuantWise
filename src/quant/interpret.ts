/** 同一份计算结果的可读结论与解释请求，不触发计算。 */
import type { TestResult } from './backtest';
import { FACTORS } from './factors';
import { UNIVERSE_NAME, type UniverseId } from './universe';

export interface FactorSnapshot {
  r: TestResult;
  universe: UniverseId;
  codes: number;
  from: string;
  computedAt: string;
}

export function factorConclusion(r: TestResult): string {
  const direction = Math.abs(r.icMean) < 0.01 ? '排序关系接近零' : r.icMean > 0 ? '排序关系偏正' : '排序关系偏负';
  const evidence = Math.abs(r.t) < 2 ? '证据还不足以支持稳定预测' : '在本样本中达到常用显著性阈值，仍需样本外检验';
  const performance = r.longShortAnnual > 0 ? '为正' : r.longShortAnnual < 0 ? '为负' : '接近零';
  return `本样本中${direction}，${evidence}。按当前分组与调仓设定，${r.input.costBp ? '扣费后' : '未扣费'}多空年化收益${performance}。`;
}

export function snapshotQuestion(s: FactorSnapshot): string {
  const r = s.r;
  return '请解释下面这一次已完成的因子实验。使用此结果快照，不调用 factor_test 重跑，不把新数据混入。用中文解释排序关系、证据强度和策略收益为何可以不同，并说明样本边界。\n' + JSON.stringify({
    factor: FACTORS[r.input.factor].name, universe: UNIVERSE_NAME[s.universe], input: r.input,
    computedAt: s.computedAt, codes: s.codes, dailyDataFrom: s.from,
    resultFrom: r.dates[0], resultTo: r.dates[r.dates.length - 1], periods: r.periods,
    rankIc: r.icMean, t: r.t, icir: r.icir, positiveIcFraction: r.icPositive,
    longShortAnnual: r.longShortAnnual, turnover: r.turnover, groupMeans: r.groupMeans,
    methodology: {
      groupOrder: `Q1 因子值最低 → Q${r.input.groups} 最高；各组等权持有`,
      groupMeans: '各组每个持有期的平均收益，未扣交易成本；数值用小数表示',
      longShortAnnual: `最高组减最低组；${r.input.costBp ? '已按两端换手扣除交易成本（换手比例 × 单边成本 × 2）' : '未扣交易成本'}；按每年 252 个交易日复利年化，数值用小数表示`,
      turnover: '最高组每次调仓的平均换手比例，不含首次建仓',
    },
    limits: '股票池使用当前成分，有幸存者偏差；本次样本结果不代表未来收益。',
  });
}
