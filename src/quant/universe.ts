/**
 * 股票池和数据准备（QUANTWISE_DESIGN.md §7.1）：示例池、自选 + 持仓、沪深 300、中证 500、中证 1000。
 * 准备数据 = 每只取约 5 年前复权日 K（先用东方财富，一次就能取全；取不到再用腾讯，个股一次只回最近约 640 根，往前分段补齐）+ 快照里的市值，
 * 只存到最近一个已收盘的交易日（盘中取到的当天那根还没收盘，不存），整段写进 kline_qfq；
 * 最后一根不是最近收盘的交易日就重取，以前只取了 750 根（约 3 年）或 640 根的、以前盘中存下的当天那根，也重取一次（needsFetch）。
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

/**
 * 成分按代码的哈希排成固定的随机顺序（FNV-1a 再混一次）：同一只股票每次排在同一处，和板块、市值、代码大小无关。
 * 准备数据按这个顺序取；被限流停下时，排在前面、已经取全的那一段就是成分的一个随机样本（成分表本身按代码排，
 * 前几百只几乎都是深市 000、002 开头的）。
 */
/* eslint-disable no-bitwise -- 哈希本来就是按位运算 */
export function randomOrder(codes: string[]): string[] {
  const key = (c: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < c.length; i++) {
      h = Math.imul(h ^ c.charCodeAt(i), 0x01000193);
    }
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  return codes.map(c => [key(c), c] as const).sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1)).map(x => x[1]);
}
/* eslint-enable no-bitwise */
/** 指数池没取全时，随机样本至少这么多只才拿来算（中证 1000 先按市值分 5 组 × 10 组，每期至少要 100 只）。 */
export const SAMPLE_MIN = 150;
/**
 * 随机样本 = 按固定随机顺序排在最前、缺的不超过 1/20 的最长一段里有日线的股票。缺的多半是被限流时没取到的，
 * 和这只股票是什么样的无关；更后面零散取到的（以前按代码顺序取的）不算，免得样本偏向某个板块。
 */
function samplePrefix(order: string[], have: (c: string) => boolean): string[] {
  let got = 0;
  let end = 0;
  order.forEach((c, i) => {
    if (have(c)) got++;
    if (got * 20 >= (i + 1) * 19) end = i + 1;
  });
  return order.slice(0, end).filter(have);
}

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
/**
 * v1.10.0 验收时只用腾讯，每只个股要取两段（见 klineSince）：并发 6 取沪深 300，两百多只后被限流，一个多小时都取不到；
 * 并发 3 补齐了沪深 300，中证 1000 取到 158 只又被限流（接口返回 501）。现在先用东方财富（一只一次），取不到再用腾讯，
 * 请求少一半，两家的限流也分开算。两家都会限流（东方财富被限流时直接断开连接，App 里是「网络错误」），并发仍是 3；
 * 停下时只留已取到的、下次只补没取到的。
 */
const CONCURRENCY = 3;
/** 东方财富连续这么多只取不到，这一轮剩下的只用腾讯（多半是被限流了，不再白发请求）。 */
const EM_OFF_AFTER = 3;
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

/**
 * 这只要不要重取：没有日线；最后一根早于 want（最近收盘的交易日）；以前只取了 750 / 640 根；
 * 或者最后一根是在那天 15:30 以前取的（v1.10.1 以前盘中准备会存下当天还没收盘的那根，日期已经是最新的，
 * 收盘后照旧算不过期，要到下一个交易日收盘才重取）。fetchedAt 是北京时间的 ISO（带 +08:00），按字符串比。
 */
function needsFetch(m: quantRepo.QfqMeta | undefined, want: DateStr): boolean {
  return !m || m.lastDate < want || LEGACY_BARS.has(m.bars) || m.fetchedAt < m.lastDate + 'T15:30';
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

export interface PoolStatus {
  codes: string[];
  asOf: string | null;
  /** 成分取全了、九成以上有日线。 */
  ready: boolean;
  /** 要重取的只数（needsFetch）：过期、只有约 3 年数据、最后一根是盘中存的，或者还没有日线。 */
  stale: number;
  lastDate: string | null;
  /** 没取全时能拿来算的随机样本（见 samplePrefix）；不到 SAMPLE_MIN 只时不能用。 */
  sample: string[];
}

/** 指数池的数据够不够用：成分取全了、九成以上有日线；stale 是过期或只有 3 年数据的只数。 */
export async function poolStatus(env: UniverseEnv, id: IndexPoolId): Promise<PoolStatus> {
  const { codes, asOf } = await universeCodes(env, id);
  const meta = await quantRepo.qfqMeta(env.db, codes);
  const want = lastClosedDay(env.calendar, env.now());
  let stale = 0;
  let lastDate: string | null = null;
  for (const m of meta.values()) {
    if (needsFetch(m, want)) stale++;
    if (!lastDate || m.lastDate > lastDate) lastDate = m.lastDate;
  }
  return {
    codes,
    asOf,
    ready: codes.length >= INDEX_POOLS[id].min && meta.size >= codes.length * 0.9,
    stale: stale + codes.length - meta.size,
    lastDate,
    sample: codes.length >= INDEX_POOLS[id].min ? samplePrefix(randomOrder(codes), c => meta.has(c)) : [],
  };
}

/** 准备完以后怎么办：ready = 取全了；sample = 没取全，但随机样本比准备前多、够 SAMPLE_MIN 只，先用它算；否则 error 是要给用户看的话。 */
export type PrepareOutcome = { use: 'ready' | 'sample'; n: number; note?: string } | { use: 'none'; error: string };

export function afterPrepare(id: IndexPoolId, before: PoolStatus, after: PoolStatus, p: PrepareProgress): PrepareOutcome {
  const name = INDEX_POOLS[id].short;
  const n = after.sample.length;
  if (after.ready) {
    return { use: 'ready', n: after.codes.length, ...(p.halted ? { note: p.halted } : p.failed.length ? { note: p.failed.length + ' 只没取到（停牌或接口出错），用其余的继续' } : {}) };
  }
  if (n >= SAMPLE_MIN && n > before.sample.length) {
    return { use: 'sample', n, note: (p.halted ? p.halted + '。' : '') + '先用按固定随机顺序取全的 ' + n + ' 只（' + name + ' 的随机样本）算' };
  }
  const why = p.halted ?? p.failed.length + ' 只没取到，数据还不够用，过几分钟再试';
  return {
    use: 'none',
    error:
      why +
      (n >= SAMPLE_MIN
        ? '。随机样本还是 ' + n + ' 只，没有多取到'
        : '。按固定随机顺序已取全 ' + n + ' 只，取全 ' + SAMPLE_MIN + ' 只以后就先用这个随机样本算'),
  };
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

/** 要重取的才取（needsFetch），只存到最近一个已收盘的交易日；返回取失败的代码（数据照常用其余的）。 */
export async function prepareBars(
  env: UniverseEnv,
  codes: string[],
  onProgress?: (p: PrepareProgress) => void,
  signal?: AbortSignal,
): Promise<PrepareProgress> {
  const want = lastClosedDay(env.calendar, env.now());
  const meta = await quantRepo.qfqMeta(env.db, codes);
  // 按固定随机顺序取：被限流停下时，已取到的是一个随机样本（见 randomOrder）
  const stale = randomOrder(codes).filter(c => needsFetch(meta.get(c), want));
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
  let emFails = 0;
  /** 东方财富最近一次取不到的原因；两家都取不到时一起写进停下的说明。 */
  let emWhy = '';
  const brief = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 40) || '原因不明';
  /** 先东方财富（一次约 5 年），取不到或回空再腾讯分段取；两家的前复权价一致（eastmoney.ts 的 emDailyUrl）。 */
  const daily = async (c: string, type: string): Promise<KBar[]> => {
    if (env.client.emDaily && emFails < EM_OFF_AFTER) {
      try {
        const got = await env.client.emDaily(c, start);
        if (got.length) {
          emFails = 0;
          return got;
        }
        emWhy = '没有日线';
      } catch (e) {
        emWhy = brief(e);
      }
      emFails++;
    }
    const both = (tx: string) => new Error(emWhy ? '东方财富 ' + emWhy + '，腾讯 ' + tx : tx);
    let bars: KBar[];
    try {
      bars = await klineSince(env.client, c, type, start);
    } catch (e) {
      throw both(brief(e));
    }
    if (!bars.length) {
      throw both('没有日线');
    }
    return bars;
  };
  const worker = async () => {
    while (next < stale.length && !signal?.aborted && !prog.halted) {
      const c = stale[next++];
      try {
        const q = quotes.get(c);
        // 盘中取到的当天那根还没收盘，不存；15:30 以后这只算过期，会再取到当天
        const bars = (await daily(c, q?.info.type ?? 'GP-A')).filter(b => b.date <= want);
        // 只有当天一根（当天上市）时什么都不存，收盘后再取
        if (bars.length) {
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
        }
        streak = 0;
      } catch (e) {
        prog.failed.push(c);
        if (++streak >= HALT_AFTER) {
          const why = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 100) || '原因不明';
          // 腾讯限流时返回 501（验收时看到的）；换成验证网页时 JSON 解析失败
          const limited = /返回 (?:429|501)|JSON/i.test(why);
          prog.halted = '连续 ' + streak + ' 只没取到（' + (limited ? '行情接口限流，' : '') + '最后一只：' + why + '），先停下；已取到的照常用。' + (limited ? '限流一般要隔一两个小时' : '网络恢复后') + '再点，只补没取到的';
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
