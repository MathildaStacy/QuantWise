/// <reference types="node" />
/**
 * 复现书里的实证（docs/design/pm-reader-lecture-20261105.md 第 7 项）：控制市值的双重排序、中证 500 / 1000 股票池、
 * 准备数据（约 5 年、以前 750 根的重取、连续失败停下）、按批组面板。用原型快照日线（26 只个股约 250 个交易日）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runQuantTool } from '../../src/ai/tools/quant';
import { QUANT_TOOL_DEFS } from '../../src/ai/tools/quantDefs';
import type { AppCore } from '../../src/app/boot';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import * as quantRepo from '../../src/data/quantRepo';
import { TradingCalendar } from '../../src/engine/calendar';
import { T } from '../../src/engine/session';
import { indexMembersUrl, parseIndexMembers } from '../../src/market/eastmoney';
import type { MarketClient } from '../../src/market/client';
import type { KBar } from '../../src/market/tencent';
import { runFactorTest, SampleError, testSummary } from '../../src/quant/backtest';
import { factorCharts } from '../../src/quant/charts';
import { buildPanel } from '../../src/quant/factors';
import { spearman } from '../../src/quant/indicators';
import { isAStock, loadPanel, poolStatus, prepareBars, refreshIndex, type UniverseEnv } from '../../src/quant/universe';

const snap = JSON.parse(readFileSync(join(__dirname, '../../docs/design/prototype/snapshot-2026-10-26.json'), 'utf8')) as {
  kline: Record<string, [string, number, number, number, number, number][]>;
  quotes: Record<string, { name: string }>;
};
const barsOf = (code: string): KBar[] =>
  (snap.kline[code] ?? []).map(([date, o, c, h, l, v]) => ({ date, open: Math.round(o * 1000), close: Math.round(c * 1000), high: Math.round(h * 1000), low: Math.round(l * 1000), volume: v * 100 }));
const codes = Object.keys(snap.kline).filter(c => isAStock(c) && snap.kline[c].length >= 240);
const caps = new Map(codes.map((c, i) => [c, { name: snap.quotes[c].name, totalCap: 500 + i * 400, floatCap: 400 }]));
const panel = buildPanel(new Map(codes.map(c => [c, barsOf(c)])), caps);
const cal = new TradingCalendar();
const NOW = { date: '2026-10-26', t: T(16, 0) };

async function env(client: Partial<MarketClient> = {}): Promise<UniverseEnv> {
  const db = openMemoryDb();
  await migrate(db);
  return { db, client: { quotes: async () => [], ...client } as MarketClient, calendar: cal, now: () => NOW, held: () => [], isoNow: () => '2026-10-26T16:00:00+08:00' };
}

const fakeCodes = (n: number, from = 600000) => Array.from({ length: n }, (_, i) => 'sh' + (from + i));

describe('中证指数成分（东方财富数据中心）', () => {
  it('SECUCODE 换成 sh / sz 代码，名字去空格，坏行跳过；带总页数', () => {
    const r = parseIndexMembers({ result: { pages: 2, data: [{ SECUCODE: '000012.SZ', SECURITY_NAME_ABBR: '南 玻Ａ' }, { SECUCODE: '688800.SH', SECURITY_NAME_ABBR: '瑞可达' }, { SECUCODE: '430047.BJ' }, {}] } });
    expect(r).toEqual({ pages: 2, rows: [{ code: 'sz000012', name: '南玻Ａ' }, { code: 'sh688800', name: '瑞可达' }] });
    expect(parseIndexMembers({ result: null })).toEqual({ pages: 1, rows: [] });
    expect(indexMembersUrl('7', 2)).toContain('RPT_INDEX_TS_COMPONENT');
    expect(indexMembersUrl('7', 2)).toContain('(TYPE%3D%227%22)&pageNumber=2&pageSize=500');
  });

  it('沪深 300 新浪取不全时换东方财富；中证 1000 用东方财富；成分不够时报错，不存', async () => {
    const asked: string[] = [];
    const e = await env({
      hs300: async () => fakeCodes(10).map(code => ({ code, name: code })),
      indexMembers: async (type: string) => {
        asked.push(type);
        return (type === '3' ? fakeCodes(100) : fakeCodes(300)).map(code => ({ code, name: code }));
      },
    });
    expect(await refreshIndex(e, 'hs300')).toHaveLength(300);
    expect(asked).toEqual(['1']);
    await expect(refreshIndex(e, 'zz500')).rejects.toThrow('中证 500 成分只取到 100 只');
    expect(await quantRepo.universe(e.db, 'zz500')).toBeNull();
    expect((await quantRepo.universe(e.db, 'hs300'))?.codes).toHaveLength(300);
  });
});

describe('控制市值的双重排序', () => {
  const plain = runFactorTest(panel, { factor: 'mom20', hold: 20, groups: 5, costBp: 0 });
  const cond = runFactorTest(panel, { factor: 'mom20', hold: 20, groups: 5, costBp: 0, control: { by: 'size', groups: 2, sort: 'conditional' } });

  it('条件排序：每个市值组各自的多空；总多空 = 各市值组的平均（不扣费时）；IC 在市值组里算再平均', () => {
    expect(plain.controlLongShort).toBeUndefined();
    expect(cond.periods).toBe(plain.periods);
    expect(cond.controlLongShort).toHaveLength(2);
    const avg = (cond.controlLongShort![0].mean + cond.controlLongShort![1].mean) / 2;
    expect(cond.longShortMean).toBeCloseTo(avg, 12);
    expect(cond.groupMeans).not.toEqual(plain.groupMeans);
    // 第一期的 IC：按调仓日市值分两半，各算秩相关再平均
    const t = 21;
    const rows = panel.codes
      .map(c => {
        const a = panel.close[c][t];
        const b = panel.close[c][t + 20];
        const now = panel.close[c][panel.close[c].length - 1];
        return { x: a && b ? a / panel.close[c][t - 20]! - 1 : NaN, r: a && b ? b / a - 1 : NaN, s: a && now ? (panel.cap[c].total! * a) / now : NaN };
      })
      .filter(x => Number.isFinite(x.x) && Number.isFinite(x.r))
      .sort((a, b) => a.s - b.s);
    const half = Math.round(rows.length / 2);
    const ic = (xs: typeof rows) => spearman(xs.map(x => x.x), xs.map(x => x.r));
    expect(cond.ic[0].ic).toBeCloseTo((ic(rows.slice(0, half)) + ic(rows.slice(half))) / 2, 10);
  });

  it('独立排序可以和条件排序不同；分得太细时报样本不够，提示换中证 500 / 1000', () => {
    const ind = runFactorTest(panel, { factor: 'mom20', hold: 10, groups: 3, costBp: 0, control: { by: 'size', groups: 2, sort: 'independent' } });
    expect(ind.controlLongShort).toHaveLength(2);
    expect(() => runFactorTest(panel, { factor: 'mom20', hold: 20, groups: 5, costBp: 0, control: { by: 'size', groups: 5, sort: 'conditional' } })).toThrow(SampleError);
    expect(() => runFactorTest(panel, { factor: 'mom20', hold: 20, groups: 5, costBp: 0, control: { by: 'size', groups: 5, sort: 'conditional' } })).toThrow('中证 500 / 中证 1000');
  });

  it('摘要写明双重排序的口径、各市值组的多空和 t 值；给了书里的期数时写明差多少、t 值为什么小', () => {
    const text = testSummary(cond, '示例池', 240);
    expect(text).toContain('先按调仓日总市值从小到大分 2 组，在每个市值组里再按因子从低到高分 5 组（条件双重排序）');
    expect(text).toMatch(/各市值组的多空（从小市值到大市值.*）：S1 [+-]\d+\.\d\d%（t -?\d+\.\d\d），S2/);
    expect(text).toContain('期数对照：本次 ' + cond.periods + ' 期');
    expect(text).toContain('书中约 240 期');
    expect(text).toContain('所以本次 |t| 小不等于和书里矛盾');
    expect(text).toContain('（在每个市值组里算再平均）');
    expect(testSummary(plain, '示例池')).not.toContain('期数对照');
    expect(factorCharts(cond, 'sample')[0]).toMatchObject({ stats: { control: { groups: 2, sort: 'conditional' } } });
  });
});

describe('准备数据和按批组面板', () => {
  it('本地库按批读出的面板和一次读进内存的一样；日线太少的新股不进面板', async () => {
    const e = await env();
    const all = [...codes, 'sz301999'];
    for (const c of codes) {
      await quantRepo.saveQfq(e.db, { code: c, name: caps.get(c)!.name, fetchedAt: 'x', totalCap: caps.get(c)!.totalCap, floatCap: 400, price: null }, barsOf(c));
    }
    await quantRepo.saveQfq(e.db, { code: 'sz301999', name: '新股', fetchedAt: 'x', totalCap: 50, floatCap: 10, price: null }, barsOf(codes[0]).slice(-30));
    const loaded = await loadPanel(e.db, all);
    expect(loaded.codes).not.toContain('sz301999');
    expect(loaded).toEqual(panel);
    const seen: string[] = [];
    await quantRepo.eachQfqCloseVolume(e.db, codes, c => seen.push(c), 4);
    expect(seen).toEqual(codes);
  });

  it('以前只取了 750 根的重取一次，按日期段往回约 5 年；最新的不取', async () => {
    const calls: { code: string; start: string }[] = [];
    const e = await env({ klineRange: async (code: string, _t: string, start: string) => { calls.push({ code, start }); return barsOf('sh600036'); } });
    const days: string[] = [];
    for (let d = NOW.date; days.length < 750; d = cal.prev(d)) days.unshift(d);
    const legacy = days.map(date => ({ date, open: 1, close: 1, high: 1, low: 1, volume: 1 }));
    await quantRepo.saveQfq(e.db, { code: 'sh600000', name: '浦发银行', fetchedAt: 'x', totalCap: 1, floatCap: 1, price: 1 }, legacy);
    await quantRepo.saveQfq(e.db, { code: 'sh600036', name: '招商银行', fetchedAt: 'x', totalCap: 1, floatCap: 1, price: 1 }, legacy.slice(1));
    const p = await prepareBars(e, ['sh600000', 'sh600036']);
    expect(calls).toEqual([{ code: 'sh600000', start: '2021-08-13' }]);
    expect(p).toMatchObject({ done: 2, total: 2, failed: [] });
    expect((await quantRepo.qfqMeta(e.db, ['sh600000'])).get('sh600000')?.bars).toBe(barsOf('sh600036').length);
  });

  it('连续取不到（接口限流）时停下，不把剩下的都试一遍；说明下次只补没取到的', async () => {
    let n = 0;
    const e = await env({ klineRange: async () => { n++; throw new Error('行情接口返回 501'); } });
    const p = await prepareBars(e, fakeCodes(60));
    expect(p.halted).toContain('先停下');
    expect(p.halted).toContain('只补没取到的');
    expect(n).toBeLessThan(30);
    expect(p.failed).toHaveLength(n);
  });

  it('指数池：九成以上有日线才算准备好；过期或缺的只数单独数', async () => {
    const e = await env();
    expect((await poolStatus(e, 'hs300')).ready).toBe(false);
    const list = fakeCodes(300);
    await quantRepo.saveUniverse(e.db, { id: 'hs300', codes: list, asOf: NOW.date, fetchedAt: 'x' });
    for (const c of list.slice(0, 270)) {
      await quantRepo.saveQfq(e.db, { code: c, name: c, fetchedAt: 'x', totalCap: 1, floatCap: 1, price: 1 }, [{ date: NOW.date, open: 1, close: 1, high: 1, low: 1, volume: 1 }]);
    }
    expect(await poolStatus(e, 'hs300')).toMatchObject({ ready: true, stale: 30, lastDate: NOW.date, asOf: NOW.date });
  });
});

describe('factor_test 的指数池和双重排序参数', () => {
  // 快照里每只都有市值（控制市值要用），价格随便给：市值只用来排大小
  const quotes = async (list: string[]) =>
    list.map((code, i) => ({ info: { code, name: snap.quotes[code]?.name ?? code, type: 'GP-A', totalCap: 500 + i * 400, floatCap: 400 }, snapshot: { last: 10000, prevClose: 10000 } }));
  const core = async () => {
    const e = await env({ klineRange: async (code: string) => barsOf(code), quotes: quotes as unknown as MarketClient['quotes'] });
    return { db: e.db, client: e.client, sim: { calendar: cal, now: () => NOW, heldCodes: () => [] } } as unknown as AppCore;
  };

  it('中证 1000 没准备时不算、给提示和「准备数据」，不当成真实结果；小市值因子不能再控制市值', async () => {
    const c = await core();
    const r = await runQuantTool(c, 'factor_test', { factor: 'mom12_1', universe: 'zz1000' });
    expect(r.prepare).toEqual({ pool: 'zz1000', pending: true });
    expect(r.charts).toBeUndefined();
    expect(r.output).toContain('中证 1000 的数据还没准备');
    expect(r.output).toContain('「准备数据」');
    expect(r.output).toContain('不要编结果');
    await expect(runQuantTool(c, 'factor_test', { factor: 'size', universe: 'sample', control: 'size' })).rejects.toThrow('不能再控制市值');
  });

  it('示例池上的条件双重排序：标签写明先按市值分组，摘要带各市值组和期数对照', async () => {
    // 快照里只有示例池的 16 只：2 × 3 格（每期至少 12 只）够，2 × 5 格（至少 20 只）不够
    const c = await core();
    const r = await runQuantTool(c, 'factor_test', { factor: 'mom20', universe: 'sample', groups: 3, control: 'size', control_groups: 2, book_periods: 240 });
    expect(r.label).toContain('先按市值分 2 组 × 3 组');
    expect(r.output).toContain('各市值组的多空');
    expect(r.output).toContain('书中约 240 期');
    expect(r.prepare).toBeUndefined();
    const small = await runQuantTool(c, 'factor_test', { factor: 'mom20', universe: 'sample', control: 'size', control_groups: 2 });
    expect(small.label).toBe('因子检验：样本不够');
    expect(small.output).toContain('2 个市值组 × 5 个因子组，每期至少要 20 只');
  });

  it('工具定义：五个股票池、控制变量、书里的期数', () => {
    const ft = QUANT_TOOL_DEFS.find(t => t.name === 'factor_test')!;
    const props = (ft.schema as { properties: Record<string, { enum?: unknown[] }> }).properties;
    expect(props.universe.enum).toEqual(['sample', 'watch', 'hs300', 'zz500', 'zz1000']);
    expect(props.control.enum).toEqual(['size']);
    expect(props.control_sort.enum).toEqual(['conditional', 'independent']);
    expect(props.book_periods).toBeDefined();
  });
});
