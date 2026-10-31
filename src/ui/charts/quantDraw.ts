/**
 * 因子和行情图的几何（纯函数，可单测）：坐标换算、折线路径、十字线读数。画图组件在 QuantChart.tsx。
 */
import { SUB_NAME, type ChartData } from '../../quant/charts';
import type { Series } from '../../quant/indicators';

export function bounds(values: Series[], include: number[] = []): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of values) {
    for (const v of s) {
      if (v != null && Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  for (const v of include) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo)) {
    return [0, 1];
  }
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
}

/** 折线：遇到 null 断开。 */
export function linePath(xs: number[], ys: (number | null)[]): string {
  let d = '';
  let on = false;
  ys.forEach((y, i) => {
    if (y == null || !Number.isFinite(y)) {
      on = false;
      return;
    }
    d += (on ? 'L' : 'M') + xs[i].toFixed(1) + ',' + y.toFixed(1);
    on = true;
  });
  return d;
}

/** 横坐标：第 i 个点（共 n 个）落在 [left, right] 的哪里。 */
export const xAt = (i: number, n: number, left: number, right: number) =>
  n <= 1 ? left : left + ((right - left) * i) / (n - 1);

/** 手指的横坐标 → 最近的点。 */
export const indexAt = (x: number, n: number, left: number, right: number) =>
  Math.max(0, Math.min(n - 1, Math.round(((x - left) / Math.max(1, right - left)) * (n - 1))));

export const pointCount = (c: ChartData) =>
  c.kind === 'groups' ? c.means.length : c.kind === 'ic' ? c.ic.length : c.dates.length;

const pct = (v: number, d = 1) => (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%';

/** 十字线所在那一天的数字（全屏图下方的读数）。 */
export function readout(c: ChartData, i: number): string {
  switch (c.kind) {
    case 'price': {
      const parts = [c.dates[i] + ' 收盘 ' + c.close[i].toFixed(2)];
      const ma = c.ma?.values[i];
      if (ma != null) {
        parts.push('MA' + c.ma!.n + ' ' + ma.toFixed(2));
      }
      const sub = c.sub?.values[i];
      if (sub != null && c.sub) {
        parts.push(SUB_NAME[c.sub.kind] + ' ' + (c.sub.kind === 'rsi14' ? sub.toFixed(1) : c.sub.kind === 'volume' ? (sub / 1e4).toFixed(0) + ' 万股' : pct(sub)));
      }
      return parts.join(' · ');
    }
    case 'compare':
      return c.dates[i] + ' · ' + c.series.map(s => s.name + ' ' + s.values[i].toFixed(1)).join(' · ');
    case 'factor':
      return c.dates[i] + ' · ' + c.groups.map((g, k) => 'Q' + (k + 1) + ' ' + g[i].toFixed(3)).join(' ') + ' · 基准 ' + c.bench[i].toFixed(3);
    case 'ic':
      return c.dates[i] + ' · Rank IC ' + (c.ic[i] > 0 ? '+' : '') + c.ic[i].toFixed(3);
    case 'groups':
      return 'Q' + (i + 1) + ' 每期平均 ' + pct(c.means[i], 2);
  }
}

/** 「怎么算的」：全屏图下面的口径说明。 */
export function howComputed(c: ChartData): string[] {
  switch (c.kind) {
    case 'price':
      return [
        '收盘价：前复权日 K（腾讯行情）',
        ...(c.ma ? ['MA' + c.ma.n + '：最近 ' + c.ma.n + ' 个收盘价的平均'] : []),
        ...(c.band ? ['布林带：MA20 ± 2 倍 20 日标准差'] : []),
        ...(c.sub
          ? [
              {
                mom20: '20 日动量：P(t) / P(t−20) − 1',
                mom60: '60 日动量：P(t) / P(t−60) − 1',
                vol20: '20 日年化波动：最近 20 天日收益的标准差 × √252',
                dd: '回撤：收盘价 / 此前最高收盘价 − 1',
                rsi14: 'RSI(14)：Wilder 平滑的 14 日相对强弱',
                volume: '成交量：当天成交的股数',
              }[c.sub.kind],
            ]
          : []),
      ];
    case 'compare':
      return ['每只的收盘价除以第一天的收盘价 × 100，只用几只都有数据的交易日'];
    case 'factor':
      return ['每个调仓日按因子从低到高分组，每组等权持有到下一个调仓日', '虚线是池子里全部股票等权的基准', '成本只扣最高组和最低组（按换手）'];
    case 'ic':
      return ['每期的 Rank IC：因子值排名和下一期收益排名的相关系数', '虚线是累计 IC'];
    case 'groups':
      return ['各组每期收益的平均值；从左到右因子值从低到高'];
  }
}
