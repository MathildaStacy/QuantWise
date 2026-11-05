/**
 * 因子（QUANTWISE_DESIGN.md §7.2）：在「面板」（同一套交易日上对齐的多只股票）上按调仓日取值。
 * 值越大越好（反转、低波动、低换手、小市值都取了相反数），分组时从低到高排，最高组 = 因子最看好的一组。
 */
import type { DateStr } from '../engine/calendar';
import type { QfqMeta } from '../data/quantRepo';
import type { KBar } from '../market/tencent';
import { mean, stdev } from './indicators';

export interface Panel {
  dates: DateStr[];
  codes: string[];
  names: Record<string, string>;
  /** 前复权收盘价（元），和 dates 对齐，没有数据是 null。 */
  close: Record<string, (number | null)[]>;
  /** 成交量（股）。 */
  volume: Record<string, (number | null)[]>;
  /** 取数据那天的总市值、流通市值（元）。 */
  cap: Record<string, { total: number | null; float: number | null }>;
}

type PanelMeta = Pick<QfqMeta, 'name' | 'totalCap' | 'floatCap'>;

/** 交易日 = 至少 minCoverage 比例的股票有数据的日期（停牌、新上市的不影响日历）；count 是每天有几只有数据。 */
export function panelDates(count: Map<string, number>, codes: number, minCoverage = 0.5): DateStr[] {
  const need = Math.max(1, Math.ceil(codes * minCoverage));
  return [...count.entries()].filter(([, n]) => n >= need).map(([d]) => d).sort();
}

/** 在定好的交易日上建一个空面板，再一只一只放进去（本地库按批读，中证 1000 不用一次把全部日线读进内存）。 */
export function panelBuilder(dates: DateStr[]) {
  const at = new Map(dates.map((d, i) => [d, i]));
  const p: Panel = { dates, codes: [], names: {}, close: {}, volume: {}, cap: {} };
  return {
    panel: p,
    add(c: string, bars: Pick<KBar, 'date' | 'close' | 'volume'>[], m: PanelMeta | undefined) {
      const cl = new Array<number | null>(dates.length).fill(null);
      const vo = new Array<number | null>(dates.length).fill(null);
      for (const b of bars) {
        const i = at.get(b.date);
        if (i != null) {
          cl[i] = b.close / 1000;
          vo[i] = b.volume;
        }
      }
      p.codes.push(c);
      p.close[c] = cl;
      p.volume[c] = vo;
      p.names[c] = m?.name ?? c;
      p.cap[c] = {
        total: m?.totalCap != null ? m.totalCap * 1e8 : null,
        float: m?.floatCap != null ? m.floatCap * 1e8 : null,
      };
    },
  };
}

export function buildPanel(
  bars: Map<string, KBar[]>,
  meta: Map<string, PanelMeta>,
  minCoverage = 0.5,
): Panel {
  const codes = [...bars.keys()].filter(c => (bars.get(c)?.length ?? 0) > 0);
  const count = new Map<string, number>();
  for (const c of codes) {
    for (const b of bars.get(c)!) {
      count.set(b.date, (count.get(b.date) ?? 0) + 1);
    }
  }
  const b = panelBuilder(panelDates(count, codes.length, minCoverage));
  for (const c of codes) {
    b.add(c, bars.get(c)!, meta.get(c));
  }
  return b.panel;
}

export type FactorId =
  | 'mom20'
  | 'mom60'
  | 'mom12_1'
  | 'rev20'
  | 'vol20'
  | 'turn20'
  | 'size';

export interface FactorDef {
  id: FactorId;
  name: string;
  /** 示例教材里讲这个因子的小节。 */
  section: string;
  /** 需要往回看多少个交易日。 */
  lookback: number;
  /** 用今天的股本往回推，有误差（3.4 ¶3）。 */
  approx?: boolean;
  formula: string;
  value(p: Panel, code: string, t: number): number | null;
}

const px = (p: Panel, c: string, t: number) => (t >= 0 ? p.close[c][t] : null);

function ret(p: Panel, c: string, from: number, to: number): number | null {
  const a = px(p, c, from);
  const b = px(p, c, to);
  return a != null && b != null && a > 0 ? b / a - 1 : null;
}

function window(p: Panel, c: string, t: number, n: number, k: 'close' | 'volume') {
  if (t - n + 1 < 0) {
    return null;
  }
  const w = p[k][c].slice(t - n + 1, t + 1);
  return w.every(x => x != null) ? (w as number[]) : null;
}

const lastClose = (p: Panel, c: string) => {
  const v = p.close[c];
  for (let i = v.length - 1; i >= 0; i--) {
    if (v[i] != null) {
      return v[i]!;
    }
  }
  return null;
};

export const FACTORS: Record<FactorId, FactorDef> = {
  mom20: { id: 'mom20', name: '20 日动量', section: '3.1', lookback: 20, formula: 'P(t) / P(t−20) − 1', value: (p, c, t) => ret(p, c, t - 20, t) },
  mom60: { id: 'mom60', name: '60 日动量', section: '3.1', lookback: 60, formula: 'P(t) / P(t−60) − 1', value: (p, c, t) => ret(p, c, t - 60, t) },
  mom12_1: { id: 'mom12_1', name: '12-1 月动量', section: '3.1', lookback: 252, formula: 'P(t−21) / P(t−252) − 1', value: (p, c, t) => ret(p, c, t - 252, t - 21) },
  rev20: {
    id: 'rev20', name: '20 日反转', section: '3.2', lookback: 20, formula: '−(P(t) / P(t−20) − 1)',
    value: (p, c, t) => {
      const r = ret(p, c, t - 20, t);
      return r == null ? null : -r;
    },
  },
  vol20: {
    id: 'vol20', name: '20 日低波动', section: '3.3', lookback: 20, formula: '−σ(最近 20 天日收益)',
    value: (p, c, t) => {
      const w = window(p, c, t, 21, 'close');
      return w ? -stdev(w.slice(1).map((x, i) => x / w[i] - 1)) : null;
    },
  },
  turn20: {
    id: 'turn20', name: '20 日低换手', section: '3.4', lookback: 20, approx: true, formula: '−平均成交量(20 天) / 流通股本（今天的股本）',
    value: (p, c, t) => {
      const w = window(p, c, t, 20, 'volume');
      const f = p.cap[c].float;
      const now = lastClose(p, c);
      return w && f && now ? -mean(w) / (f / now) : null;
    },
  },
  size: {
    id: 'size', name: '小市值', section: '2.3', lookback: 0, approx: true, formula: '−ln(总市值)，过去的市值 = 今天的市值 × P(t) / P(今天)',
    value: (p, c, t) => {
      const total = p.cap[c].total;
      const now = lastClose(p, c);
      const v = px(p, c, t);
      return total && now && v ? -Math.log((total * v) / now) : null;
    },
  },
};

export const FACTOR_IDS = Object.keys(FACTORS) as FactorId[];
