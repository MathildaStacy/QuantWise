import type { TestResult } from '../../src/quant/backtest';
import { factorConclusion, snapshotQuestion } from '../../src/quant/interpret';

const result: TestResult = {
  input: { factor: 'mom20', hold: 20, groups: 5, costBp: 15 },
  periods: 12, dates: ['2025-10-20', '2026-10-20'], groupNav: [], benchNav: [], longShortNav: [], ic: [],
  icMean: 0.051, icStd: 0.1, icir: 0.4, icirAnnual: 1.2, icPositive: 0.6, t: 1.35,
  groupMeans: [-0.02, -0.01, 0.01, 0.02, 0.03], monotonicity: 0.5, longShortAnnual: -0.104, longShortMean: -0.009, longShortStd: 0.04, longShortT: -0.78,
  turnover: 0.3, avgStocks: 16, stocks: 16,
};

test('正 IC、弱证据、负收益分别解释，显著性以 t 绝对值判断', () => {
  expect(factorConclusion(result)).toBe('本样本中排序关系偏正，证据还不足以支持稳定预测。按当前分组与调仓设定，扣费后多空年化收益为负。');
  expect(factorConclusion({ ...result, icMean: -0.05, t: -2.1 })).toContain('排序关系偏负，在本样本中达到常用显著性阈值');
});

test('解释使用该份结果的参数、日期、时间及统计值', () => {
  const prompt = snapshotQuestion({ r: result, universe: 'sample', codes: 16, from: '2025-09-01', computedAt: '2026-11-01T10:00:00+08:00' });
  expect(prompt).toContain('不调用 factor_test 重跑');
  const data = JSON.parse(prompt.slice(prompt.indexOf('{')));
  expect(data).toMatchObject({ input: result.input, rankIc: 0.051, t: 1.35, longShortAnnual: -0.104, resultFrom: '2025-10-20', resultTo: '2026-10-20', computedAt: '2026-11-01T10:00:00+08:00' });
});
