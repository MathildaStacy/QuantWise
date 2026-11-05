/**
 * 股票池和数据准备（QUANTWISE_DESIGN.md §7.1）：示例池、自选 + 持仓、沪深 300、中证 500、中证 1000。
 * 准备数据 = 每只取约 5 年前复权日 K（腾讯，按日期段取，个股一次只回最近约 640 根，往前分段补齐）+ 快照里的市值，
 * 整段写进 kline_qfq；最后一根不是最近收盘的交易日就重取，以前只取了 750 根（约 3 年）或 640 根的也重取一次。
 */
import type { Db } from '../data/db';
import * as quantRepo from '../data/quantRepo';
import * as repo from '../data/repos';
import { addDays, type DateStr, type TradingCalendar } from '../engine/calendar';
import { T } from '../engine/session';
import { BIG_CAPS } from '../learn/datalab';
import { INDEX_MEMBER_TYPE } from '../market/eastmoney';
import type { MarketClient } from '../market/client';
import type { KBar } from '../market/tencent';
import { panelBuilder, panelDates, type Panel } from './factors';

export type IndexPoolId = 'hs300' | 'zz500' | 'zz1000';
export type UniverseId = 'sample' | 'watch' | IndexPoolId;

export const UNIVERSE_NAME: Record<UniverseId, string> = {
  sample: '示例池（25 只大盘股）',
  watch: '自选 + 持仓',
  hs300: '沪深 300（当前成分）',
  zz500: '中证 500（当前成分）',
  zz1000: '中证 1000（当前成分）',
};

/** 要用户点「准备数据」的指数池：成分数、少于多少只算没取全、大约要多久和多少流量（每只约 80 KB）。 */
export const INDEX_POOLS: Record<IndexPoolId, { short: string; size: number; min: number; source: string; minutes: number; mb: number }> = {
  hs300: { short: '沪深 300', size: 300, min: 250, source: '新浪', minutes: 5, mb: 25 },
  zz500: { short: '中证 500', size: 500, min: 420, source: '东方财富', minutes: 8, mb: 40 },
  zz1000: { short: '中证 1000', size: 1000, min: 850, source: '东方财富', minutes: 16, mb: 80 },
};

export const UNIVERSE_IDS = Object.keys(UNIVERSE_NAME) as UniverseId[];
export const isIndexPool = (id: string): id is IndexPoolId => id in INDEX_POOLS;

/** 每只股票大约取多少根日线（约 5 年）：按日期段取，往回 1,900 个自然日。 */
export const QFQ_BARS = 1250;
export const QFQ_DAYS = 1900;
/**
 * 以前的版本只取到 750 根（按根数取）或 640 根（按日期段取但没往前补）：这样的重取一次。
 * 新上市刚好这么多根的会多取一次，不影响结果。
 */
const LEGACY_BARS = new Set([750, 640]);
/**
 * 腾讯前复权日 K 一次最多回多少根：个股约 640，指数可以更多。回满这么多又没到起点，就往前再取一段；
 * 最多两段（约 1,280 根、5 年多），第三段只多一两个月，却要多 50% 的请求。
 */
const PAGE_FULL = 600;
const MAX_PAGES = 2;

/**
 * 从 start 取到 end（空 = 最新）的前复权日 K。腾讯接口按日期段取时个股只回最近约 640 根，
 * 回满了又没到 start 就把 end 挪到最早那天的前一天往前再取一段；往前那段取失败（限流、返回网页）时用已经取到的。
 */
export async function klineSince(
  client: Pick<MarketClient, 'klineRange'>,
  code: string,
  type: string,
  start: DateStr,
  end: DateStr | '' = '',
): Promise<KBar[]> {
  let bars = await client.klineRange(code, type, start, end, 'qfq');
  for (let page = 1; page < MAX_PAGES && bars.length >= PAGE_FULL && bars[0].date > addDays(start, 10); page++) {
    const first = bars[0].date;
    let older: KBar[];
    try {
      older = (await client.klineRange(code, type, start, addDays(first, -1), 'qfq')).filter(b => b.date < first);
    } catch {
      break;
    }
    if (!older.length) break;
    bars = [...older, ...bars];
    if (older.length < PAGE_FULL) break;
  }
  return bars;
}
/** 每只个股要取两段（见 klineSince）。验收时并发 6 取沪深 300，两百多只后被行情接口限流，一个多小时都取不到；并发 3 时约每秒 1 只，没有再被拦。 */
const CONCURRENCY = 3;
/** 连续这么多只取不到（接口限流、断网）就停下，不把剩下的都试一遍；下次准备只补没取到的。 */
const HALT_AFTER = 12;

/** A 股个股（不含 ETF、指数、北交所）。 */
export const isAStock = (c: string) => /^(sh60|sh68|sz00|sz30)\d{4}$/.test(c);
/** 已经收盘的最近一个交易日：交易日 15:30 以后算今天，否则算上一个交易日。 */
export function lastClosedDay(
  cal: TradingCalendar,
  now: { date: DateStr; t: number },
): DateStr {
  return cal.isTradingDay(now.date) && now.t >= T(15, 30)
    ? now.date
    : cal.prev(now.date);
}

export interface UniverseEnv {
  db: Db;
  client: MarketClient;
  calendar: TradingCalendar;
  now: () => { date: DateStr; t: number };
  /** 当前持仓里的代码。 */
  held: () => string[];
  isoNow: () => string;
}

export async function universeCodes(
  env: UniverseEnv,
  id: UniverseId,
): Promise<{ codes: string[]; asOf: string | null }> {
  if (id === 'sample') {
    return { codes: BIG_CAPS, asOf: null };
  }
  if (id === 'watch') {
    const codes = [...new Set([...(await repo.watchlist(env.db)), ...env.held()])].filter(isAStock);
    return { codes, asOf: null };
  }
  const u = await quantRepo.universe(env.db, id);
  return { codes: u?.codes ?? [], asOf: u?.asOf ?? null };
}

/** 指数池的数据够不够用：成分取全了、九成以上有日线；stale 是过期或只有 3 年数据的只数。 */
export async function poolStatus(env: UniverseEnv, id: IndexPoolId): Promise<{ codes: string[]; asOf: string | null; ready: boolean; stale: number; lastDate: string | null }> {
  const { codes, asOf } = await universeCodes(env, id);
  const meta = await quantRepo.qfqMeta(env.db, codes);
  const want = lastClosedDay(env.calendar, env.now());
  let stale = 0;
  let lastDate: string | null = null;
  for (const m of meta.values()) {
    if (m.lastDate < want || LEGACY_BARS.has(m.bars)) stale++;
    if (!lastDate || m.lastDate > lastDate) lastDate = m.lastDate;
  }
  return { codes, asOf, ready: codes.length >= INDEX_POOLS[id].min && meta.size >= codes.length * 0.9, stale: stale + codes.length - meta.size, lastDate };
}

/**
 * 指数池的当前成分，存下来并记日期：沪深 300 用新浪的 hs300 节点（取不全时换东方财富），
 * 中证 500 / 1000 用东方财富数据中心（新浪没有中证 1000 的节点）。
 */
export async function refreshIndex(env: UniverseEnv, id: IndexPoolId): Promise<string[]> {
  const pool = INDEX_POOLS[id];
  const em = async () => (await env.client.indexMembers(INDEX_MEMBER_TYPE[id])).map(x => x.code).filter(isAStock);
  let codes: string[] = [];
  if (id === 'hs300') {
    codes = await env.client.hs300().then(r => r.map(x => x.code).filter(isAStock), () => []);
    if (codes.length < pool.min) codes = await em();
  } else {
    codes = await em();
  }
  if (codes.length < pool.min) {
    throw new Error(pool.short + ' 成分只取到 ' + codes.length + ' 只，稍后再试');
  }
  await quantRepo.saveUniverse(env.db, { id, codes, asOf: env.now().date, fetchedAt: env.isoNow() });
  return codes;
}

export interface PrepareProgress {
  done: number;
  total: number;
  failed: string[];
  /** 连续取不到、提前停下时的说明（已经取到的照常用，下次准备只补没取到的）。 */
  halted?: string;
}

/** 过期、没有或只有 750 根的才取；返回取失败的代码（数据照常用其余的）。 */
export async function prepareBars(
  env: UniverseEnv,
  codes: string[],
  onProgress?: (p: PrepareProgress) => void,
  signal?: AbortSignal,
): Promise<PrepareProgress> {
  const want = lastClosedDay(env.calendar, env.now());
  const meta = await quantRepo.qfqMeta(env.db, codes);
  const stale = codes.filter(c => {
    const m = meta.get(c);
    return !m || m.lastDate < want || LEGACY_BARS.has(m.bars);
  });
  const prog: PrepareProgress = { done: codes.length - stale.length, total: codes.length, failed: [] };
  onProgress?.({ ...prog });
  const quotes = new Map<string, Awaited<ReturnType<MarketClient['quotes']>>[number]>();
  if (stale.length) {
    for (const q of await env.client.quotes(stale)) {
      quotes.set(q.info.code, q);
    }
  }
  const start = addDays(env.now().date, -QFQ_DAYS);
  let next = 0;
  let streak = 0;
  const worker = async () => {
    while (next < stale.length && !signal?.aborted && !prog.halted) {
      const c = stale[next++];
      try {
        const q = quotes.get(c);
        const bars = await klineSince(env.client, c, q?.info.type ?? 'GP-A', start);
        if (!bars.length) {
          throw new Error('没有日线');
        }
        await quantRepo.saveQfq(
          env.db,
          {
            code: c,
            name: q?.info.name ?? c,
            fetchedAt: env.isoNow(),
            totalCap: q?.info.totalCap ?? null,
            floatCap: q?.info.floatCap ?? null,
            price: q?.snapshot.last ?? q?.snapshot.prevClose ?? null,
          },
          bars,
        );
        streak = 0;
      } catch (e) {
        prog.failed.push(c);
        if (++streak >= HALT_AFTER) {
          const why = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 60);
          prog.halted = '连续 ' + streak + ' 只没取到（' + (why ? '最后一只：' + why : '行情接口限流或断网') + '），先停下；已取到的照常用。断网的话恢复后再点一次；被行情接口限流可能要等一两个小时。再点只补没取到的';
        }
      }
      prog.done++;
      onProgress?.({ ...prog, failed: [...prog.failed] });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stale.length) }, worker));
  return prog;
}

/**
 * 从本地库组面板；minBars 以下的股票（新上市）不进面板。按批读收盘价和成交量，
 * 中证 1000 约 125 万行日线也不会一次全读进内存。
 */
export async function loadPanel(db: Db, codes: string[], minBars = 60): Promise<Panel> {
  const meta = await quantRepo.qfqMeta(db, codes);
  const keep = codes.filter(c => (meta.get(c)?.bars ?? 0) >= minBars);
  const b = panelBuilder(panelDates(await quantRepo.qfqDateCounts(db, keep), keep.length));
  await quantRepo.eachQfqCloseVolume(db, keep, (c, bars) => b.add(c, bars, meta.get(c)));
  return b.panel;
}
