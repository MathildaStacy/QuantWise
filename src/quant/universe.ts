/**
 * 股票池和数据准备（QUANTWISE_DESIGN.md §7.1）：示例池、自选 + 持仓、沪深 300。
 * 准备数据 = 每只取 750 根前复权日 K（腾讯）+ 快照里的市值，整段写进 kline_qfq；最后一根不是最近收盘的交易日就重取。
 */
import type { Db } from '../data/db';
import * as quantRepo from '../data/quantRepo';
import * as repo from '../data/repos';
import type { DateStr, TradingCalendar } from '../engine/calendar';
import { T } from '../engine/session';
import { BIG_CAPS } from '../learn/datalab';
import type { MarketClient } from '../market/client';
import { buildPanel, type Panel } from './factors';

export type UniverseId = 'sample' | 'watch' | 'hs300';

export const UNIVERSE_NAME: Record<UniverseId, string> = {
  sample: '示例池（25 只大盘股）',
  watch: '自选 + 持仓',
  hs300: '沪深 300（当前成分）',
};

export const QFQ_BARS = 750;
const CONCURRENCY = 6;

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
  const u = await quantRepo.universe(env.db, 'hs300');
  return { codes: u?.codes ?? [], asOf: u?.asOf ?? null };
}

/** 新浪 hs300 节点：当前 300 只成分，存下来并记日期。 */
export async function refreshHs300(env: UniverseEnv): Promise<string[]> {
  const codes = (await env.client.hs300()).map(x => x.code).filter(isAStock);
  if (codes.length < 250) {
    throw new Error('沪深 300 成分只取到 ' + codes.length + ' 只，稍后再试');
  }
  await quantRepo.saveUniverse(env.db, {
    id: 'hs300',
    codes,
    asOf: env.now().date,
    fetchedAt: env.isoNow(),
  });
  return codes;
}

export interface PrepareProgress {
  done: number;
  total: number;
  failed: string[];
}

/** 过期或没有的才取；返回取失败的代码（数据照常用其余的）。 */
export async function prepareBars(
  env: UniverseEnv,
  codes: string[],
  onProgress?: (p: PrepareProgress) => void,
  signal?: AbortSignal,
): Promise<PrepareProgress> {
  const want = lastClosedDay(env.calendar, env.now());
  const meta = await quantRepo.qfqMeta(env.db, codes);
  const stale = codes.filter(c => (meta.get(c)?.lastDate ?? '') < want);
  const prog: PrepareProgress = { done: codes.length - stale.length, total: codes.length, failed: [] };
  onProgress?.({ ...prog });
  const quotes = new Map<string, Awaited<ReturnType<MarketClient['quotes']>>[number]>();
  if (stale.length) {
    for (const q of await env.client.quotes(stale)) {
      quotes.set(q.info.code, q);
    }
  }
  let next = 0;
  const worker = async () => {
    while (next < stale.length && !signal?.aborted) {
      const c = stale[next++];
      try {
        const q = quotes.get(c);
        const bars = await env.client.kline(c, q?.info.type ?? 'GP-A', 'day', QFQ_BARS, 'qfq');
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
      } catch {
        prog.failed.push(c);
      }
      prog.done++;
      onProgress?.({ ...prog, failed: [...prog.failed] });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stale.length) }, worker));
  return prog;
}

/** 从本地库组面板；minBars 以下的股票（新上市）不进面板。 */
export async function loadPanel(db: Db, codes: string[], minBars = 60): Promise<Panel> {
  const bars = await quantRepo.qfqBars(db, codes);
  const meta = await quantRepo.qfqMeta(db, codes);
  for (const [c, b] of bars) {
    if (b.length < minBars) {
      bars.delete(c);
    }
  }
  return buildPanel(bars, meta);
}
