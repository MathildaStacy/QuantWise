/// <reference types="node" />
/**
 * 讲解里的真实行情举例（docs/design/lecture-retrieval-20261104.md §4）：工具在数据里找一段行情（find）、盘中数据
 * 不当收盘、同期沪深 300 对照、行情接口偶发失败重试一次；因子检验的多空 t 值和市值加权。用原型快照日线。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openToday, retryOnce, runQuantTool } from '../../src/ai/tools/quant';
import type { AppCore } from '../../src/app/boot';
import { T } from '../../src/engine/session';
import { runFactorTest, testSummary } from '../../src/quant/backtest';
import { benchFocus, compareChart, findEpisode, focusStats, priceChart, type PriceChart } from '../../src/quant/charts';
import { buildPanel } from '../../src/quant/factors';
import { isAStock } from '../../src/quant/universe';
import type { KBar } from '../../src/market/tencent';
import { parseQuotes } from '../../src/market/tencent';

const snap = JSON.parse(readFileSync(join(__dirname, '../../docs/design/prototype/snapshot-2026-10-26.json'), 'utf8')) as {
  kline: Record<string, [string, number, number, number, number, number][]>;
  quotes: Record<string, { name: string }>;
};
const barsOf = (code: string): KBar[] =>
  (snap.kline[code] ?? []).map(([date, o, c, h, l, v]) => ({ date, open: Math.round(o * 1000), close: Math.round(c * 1000), high: Math.round(h * 1000), low: Math.round(l * 1000), volume: v * 100 }));
const CATL = barsOf('sz300750');

describe('find：让工具在数据里找一段真实行情', () => {
  it('最深回撤是峰到谷，最大涨幅是谷到峰，波动最大是 20 日窗口；区间读数的基数就是峰 / 谷那天', () => {
    expect(findEpisode([10, 12, 9, 11, 8, 13], 'drawdown')).toEqual({ a: 2, b: 4, value: 8 / 12 - 1 });
    expect(findEpisode([10, 8, 12, 7, 9, 14], 'rally')).toEqual({ a: 4, b: 5, value: 1 });
    expect(findEpisode([10, 10, 10], 'drawdown')).toBeNull();
    const calm = Array.from({ length: 60 }, (_, i) => 10 + (i % 2) * 0.01);
    const wild = [...calm.slice(0, 30), ...Array.from({ length: 20 }, (_, i) => 10 + (i % 2) * 2), ...calm.slice(0, 10)];
    const v = findEpisode(wild, 'volatile')!;
    expect(v.b - v.a + 1).toBe(20);
    expect(v.a).toBeGreaterThanOrEqual(29);
    expect(v.a).toBeLessThanOrEqual(31);
    // 画出来的区间读数和找到的回撤一致
    const close = CATL.map(b => b.close);
    const dd = findEpisode(close, 'drawdown')!;
    const c = priceChart({ code: 'sz300750', name: '宁德时代', bars: CATL, focus: [{ from: CATL[dd.a].date, to: CATL[dd.b].date, label: '最深回撤' }] }).chart as PriceChart;
    expect(focusStats(c, c.focus![0])!.change).toBeCloseTo(dd.value, 6);
  });

  it('plot_chart 的 find：摘要写明在哪段数据里找到的日期，图上标成重点区间，并带同期沪深 300 和超额', async () => {
    const quotes = parseQuotes(readFileSync(join(__dirname, '../market/fixtures/qt-2026-10-26-1452.txt'), 'utf8'));
    const core = {
      client: {
        quotes: async (codes: string[]) => quotes.filter(q => codes.includes(q.snapshot.code)),
        search: async () => [],
        kline: async (code: string, _t: string, _p: string, count: number) => barsOf(code).slice(-count),
        klineRange: async (code: string, _t: string, start: string, end: string) => barsOf(code).filter(k => k.date >= start && (!end || k.date <= end)),
      },
      sim: { quote: () => null, security: () => null },
    } as unknown as AppCore;
    const r = await runQuantTool(core, 'plot_chart', { code: '300750', find: 'drawdown', sub: 'dd' });
    const c = r.charts![0] as PriceChart;
    expect(c.focus?.[0].label).toBe('最深回撤');
    expect(r.output).toMatch(/find「最深回撤」：在 \d{4}-\d\d-\d\d 到 2026-10-26 的日线里找到 \d{4}-\d\d-\d\d 到 \d{4}-\d\d-\d\d，峰到谷 -\d+\.\d\d%/);
    expect(r.output).toMatch(/同期沪深 300（「最深回撤」同一基数日）[+-]\d+\.\d\d%，超额（个股 − 沪深 300）[+-]\d+\.\d\d 个百分点/);
    expect(c.bench?.name).toBe('沪深 300');
    // 同期沪深 300 和手算一致：基数日和个股的区间前一天是同一天
    const st = focusStats(c, c.focus![0])!;
    const hs = new Map(barsOf('sh000300').map(b => [b.date, b.close]));
    expect(c.bench!.changes[0]).toBeCloseTo(hs.get(st.to)! / hs.get(st.baseDate)! - 1, 4);
    // 沪深 300 自己画图时不再和自己比
    const self = await runQuantTool(core, 'plot_chart', { code: 'sh000300', find: 'rally' });
    expect((self.charts![0] as PriceChart).bench).toBeUndefined();
    expect(self.output).toContain('find「最大涨幅」');
  });
});

describe('盘中数据和接口重试', () => {
  it('最后一根是今天且没收盘：图和摘要都写盘中，不当收盘；收盘后照常', () => {
    expect(openToday({ date: '2026-10-26', t: T(14, 53) })).toBe('2026-10-26');
    expect(openToday({ date: '2026-10-26', t: T(15, 0) })).toBeNull();
    const live = priceChart({ code: 'sz300750', name: '宁德时代', bars: CATL, today: '2026-10-26' });
    expect((live.chart as PriceChart).live).toBe('2026-10-26');
    expect(live.text.split('\n')[0]).toContain('最后一根 2026-10-26 是今天的盘中数据');
    // 记下画图时刻：摘要和图脚写同一个时分
    const at = priceChart({ code: 'sz300750', name: '宁德时代', bars: CATL, today: '2026-10-26', at: '2026-10-26T10:32:07+08:00' });
    expect((at.chart as PriceChart).drawnAt).toBe('2026-10-26T10:32');
    expect(at.text.split('\n')[0]).toContain('最后一根 2026-10-26 是今天的盘中数据（取于 10:32）');
    expect(at.text.split('\n')[0]).toContain('「截至今天 10:32 盘中」');
    expect((priceChart({ code: 'sz300750', name: '宁德时代', bars: CATL, today: '2026-10-27' }).chart as PriceChart).live).toBeUndefined();
    const cmp = compareChart([{ code: 'sz300750', name: '宁德时代', bars: CATL }, { code: 'sh600519', name: '贵州茅台', bars: barsOf('sh600519') }], { today: '2026-10-26' });
    expect(cmp.text).toContain('盘中数据');
  });

  it('5xx、超时、断网等一下重试一次；还不行时告诉模型别凭记忆补数；别的错误不重试', async () => {
    let n = 0;
    expect(await retryOnce(async () => { if (n++ === 0) throw new Error('行情接口返回 501'); return 'ok'; }, 1)).toBe('ok');
    await expect(retryOnce(async () => { throw new Error('行情接口超时'); }, 1)).rejects.toThrow('已重试一次）：请告诉用户稍后再试，不要凭记忆补行情数字');
    let m = 0;
    await expect(retryOnce(async () => { m++; throw new Error('找不到证券'); }, 1)).rejects.toThrow('找不到证券');
    expect(m).toBe(1);
  });

  it('基准那天没数据时这段的同期涨跌是 null（不硬算）', () => {
    const c = priceChart({ code: 'sz300750', name: '宁德时代', bars: CATL, focus: [{ from: '2026-09-01', to: '2026-09-30', label: '9 月' }] }).chart as PriceChart;
    expect(benchFocus(c, barsOf('sh000300'))[0]).not.toBeNull();
    expect(benchFocus(c, barsOf('sh000300').filter(b => b.date !== '2026-09-30'))[0]).toBeNull();
  });
});

describe('因子检验：和书里的分组表对照', () => {
  const codes = Object.keys(snap.kline).filter(c => isAStock(c) && snap.kline[c].length >= 240);
  const caps = new Map(codes.map((c, i) => [c, { name: snap.quotes[c].name, totalCap: 500 + i * 400, floatCap: 400 }]));
  const p = buildPanel(new Map(codes.map(c => [c, barsOf(c)])), caps);

  it('多空每期平均收益和它的 t 值；摘要里写明，和 IC 的 t 值分开', () => {
    const r = runFactorTest(p, { factor: 'mom20', hold: 20, groups: 5, costBp: 0 });
    const ls = r.longShortNav.slice(1).map((v, i) => v / r.longShortNav[i] - 1);
    const mean = ls.reduce((a, b) => a + b, 0) / ls.length;
    const sd = Math.sqrt(ls.reduce((a, b) => a + (b - mean) ** 2, 0) / (ls.length - 1));
    expect(r.longShortMean).toBeCloseTo(mean, 10);
    expect(r.longShortT).toBeCloseTo(mean / (sd / Math.sqrt(ls.length)), 8);
    const text = testSummary(r, '示例池');
    expect(text).toContain('每期平均 ' + (r.longShortMean > 0 ? '+' : '') + (r.longShortMean * 100).toFixed(2) + '%（t 值 ' + r.longShortT.toFixed(2));
    expect(text).toContain('没做 Newey-West 调整');
    expect(text).toContain('等权持有');
  });

  it('市值加权：大市值的票权重大，组收益和等权不同；摘要写明加权和近似', () => {
    const eq = runFactorTest(p, { factor: 'mom20', hold: 20, groups: 5, costBp: 0 });
    const cap = runFactorTest(p, { factor: 'mom20', hold: 20, groups: 5, costBp: 0, weight: 'cap' });
    expect(cap.periods).toBe(eq.periods);
    expect(cap.groupMeans).not.toEqual(eq.groupMeans);
    expect(cap.ic).toEqual(eq.ic);
    const text = testSummary(cap, '示例池');
    expect(text).toContain('按调仓日总市值加权');
    expect(text).toContain('市值用今天的股本往回推，有误差');
  });
});
