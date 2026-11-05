/**
 * 因子用的数据（迁移 0008，QUANTWISE_DESIGN.md §7.1）：前复权日线、每只的元数据（市值）、股票池成分。
 * 前复权价会随分红整体变化，所以一只股票的日线整段替换，不做增量。
 */
import type { KBar } from '../market/tencent';
import type { Db } from './db';

export interface QfqMeta {
  code: string;
  name: string;
  fetchedAt: string;
  lastDate: string;
  bars: number;
  /** 总市值、流通市值（亿元，腾讯快照，取数据时的值）。 */
  totalCap: number | null;
  floatCap: number | null;
  /** 取数据时的价格（厘，不复权），用来把今天的市值换算成过去的。 */
  price: number | null;
}

export async function saveQfq(
  db: Db,
  meta: Omit<QfqMeta, 'bars' | 'lastDate'>,
  bars: KBar[],
): Promise<void> {
  await db.transaction(async tx => {
    await tx.run('DELETE FROM kline_qfq WHERE code = ?', [meta.code]);
    for (const b of bars) {
      await tx.run(
        'INSERT INTO kline_qfq (code, date, open, close, high, low, volume) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [meta.code, b.date, b.open, b.close, b.high, b.low, b.volume],
      );
    }
    await tx.run(
      `INSERT INTO kline_qfq_meta (code, name, fetched_at, last_date, bars, total_cap, float_cap, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, fetched_at = excluded.fetched_at, last_date = excluded.last_date, bars = excluded.bars,
         total_cap = excluded.total_cap, float_cap = excluded.float_cap, price = excluded.price`,
      [meta.code, meta.name, meta.fetchedAt, bars[bars.length - 1]?.date ?? '', bars.length, meta.totalCap, meta.floatCap, meta.price],
    );
  });
}

interface MetaRow {
  code: string;
  name: string;
  fetched_at: string;
  last_date: string;
  bars: number;
  total_cap: number | null;
  float_cap: number | null;
  price: number | null;
}

const toMeta = (r: MetaRow): QfqMeta => ({
  code: r.code,
  name: r.name,
  fetchedAt: r.fetched_at,
  lastDate: r.last_date,
  bars: Number(r.bars),
  totalCap: r.total_cap == null ? null : Number(r.total_cap),
  floatCap: r.float_cap == null ? null : Number(r.float_cap),
  price: r.price == null ? null : Number(r.price),
});

export async function qfqMeta(db: Db, codes: string[]): Promise<Map<string, QfqMeta>> {
  const out = new Map<string, QfqMeta>();
  if (!codes.length) {
    return out;
  }
  const rows = await db.all<MetaRow>(
    'SELECT * FROM kline_qfq_meta WHERE code IN (' + codes.map(() => '?').join(',') + ')',
    codes,
  );
  for (const r of rows) {
    out.set(r.code, toMeta(r));
  }
  return out;
}

/** 多只股票的前复权日线，按代码分组、日期从早到晚。 */
export async function qfqBars(db: Db, codes: string[]): Promise<Map<string, KBar[]>> {
  const out = new Map<string, KBar[]>();
  for (const c of codes) {
    out.set(c, []);
  }
  for (let i = 0; i < codes.length; i += 200) {
    const part = codes.slice(i, i + 200);
    const rows = await db.all<KBar & { code: string }>(
      'SELECT code, date, open, close, high, low, volume FROM kline_qfq WHERE code IN (' + part.map(() => '?').join(',') + ') ORDER BY code, date',
      part,
    );
    for (const r of rows) {
      out.get(r.code)!.push({
        date: r.date,
        open: Number(r.open),
        close: Number(r.close),
        high: Number(r.high),
        low: Number(r.low),
        volume: Number(r.volume),
      });
    }
  }
  return out;
}

/** 每个交易日有几只股票有数据（组面板的交易日用）。 */
export async function qfqDateCounts(db: Db, codes: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < codes.length; i += 500) {
    const part = codes.slice(i, i + 500);
    const rows = await db.all<{ date: string; n: number }>(
      'SELECT date, COUNT(*) AS n FROM kline_qfq WHERE code IN (' + part.map(() => '?').join(',') + ') GROUP BY date',
      part,
    );
    for (const r of rows) {
      out.set(r.date, (out.get(r.date) ?? 0) + Number(r.n));
    }
  }
  return out;
}

/** 按批读收盘价和成交量（因子只用这两列），每读一批（size 只）就按代码交给 onCode；中证 1000 约 125 万行，不一次读进内存。 */
export async function eachQfqCloseVolume(
  db: Db,
  codes: string[],
  onCode: (code: string, bars: { date: string; close: number; volume: number }[]) => void,
  size = 50,
): Promise<void> {
  for (let i = 0; i < codes.length; i += size) {
    const part = codes.slice(i, i + size);
    const rows = await db.all<{ code: string; date: string; close: number; volume: number }>(
      'SELECT code, date, close, volume FROM kline_qfq WHERE code IN (' + part.map(() => '?').join(',') + ') ORDER BY code, date',
      part,
    );
    const by = new Map<string, { date: string; close: number; volume: number }[]>(part.map(c => [c, []]));
    for (const r of rows) {
      by.get(r.code)?.push({ date: r.date, close: Number(r.close), volume: Number(r.volume) });
    }
    for (const c of part) {
      onCode(c, by.get(c)!);
    }
  }
}

export interface Universe {
  id: string;
  codes: string[];
  /** 成分对应的日期（新浪给的是当天的成分）。 */
  asOf: string;
  fetchedAt: string;
}

export async function universe(db: Db, id: string): Promise<Universe | null> {
  const r = await db.get<{ id: string; codes: string; as_of: string; fetched_at: string }>(
    'SELECT * FROM quant_universe WHERE id = ?',
    [id],
  );
  return r ? { id: r.id, codes: JSON.parse(r.codes), asOf: r.as_of, fetchedAt: r.fetched_at } : null;
}

export async function saveUniverse(db: Db, u: Universe): Promise<void> {
  await db.run(
    `INSERT INTO quant_universe (id, codes, as_of, fetched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET codes = excluded.codes, as_of = excluded.as_of, fetched_at = excluded.fetched_at`,
    [u.id, JSON.stringify(u.codes), u.asOf, u.fetchedAt],
  );
}
