/**
 * 序列指标（QUANTWISE_DESIGN.md §7、§7.4）：输入是按日期排好的收盘价（元，前复权），输出和输入等长，
 * 算不出来的位置是 null。和原型 docs/design/prototype/quant.js 同一套算法。
 */
export type Series = (number | null)[];

export const TRADING_DAYS = 252;

export function sma(v: number[], n: number): Series {
  const out: Series = new Array(v.length).fill(null);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) {
      sum -= v[i - n];
    }
    if (i >= n - 1) {
      out[i] = sum / n;
    }
  }
  return out;
}

/** n 日收益（动量）：P(t) / P(t−n) − 1。 */
export function momentum(v: number[], n: number): Series {
  return v.map((x, i) => (i >= n && v[i - n] > 0 ? x / v[i - n] - 1 : null));
}

export function dailyReturns(v: number[]): Series {
  return v.map((x, i) => (i && v[i - 1] > 0 ? x / v[i - 1] - 1 : null));
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** 样本标准差（除以 n − 1）。 */
export function stdev(xs: number[]): number {
  if (xs.length < 2) {
    return 0;
  }
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** n 日滚动波动率，年化（× √252）。 */
export function rollingVol(v: number[], n: number): Series {
  const r = dailyReturns(v);
  return r.map((_, i) => {
    if (i < n) {
      return null;
    }
    const w = r.slice(i - n + 1, i + 1) as number[];
    return stdev(w) * Math.sqrt(TRADING_DAYS);
  });
}

/** 回撤：相对此前最高点跌了多少（≤ 0）。 */
export function drawdown(v: number[]): Series {
  let peak = -Infinity;
  return v.map(x => {
    peak = Math.max(peak, x);
    return peak > 0 ? x / peak - 1 : null;
  });
}

/** RSI（Wilder 平滑，n 默认 14），0–100。 */
export function rsi(v: number[], n = 14): Series {
  const out: Series = new Array(v.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= n) {
      gain += g / n;
      loss += l / n;
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
    }
    if (i >= n) {
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

/** 布林带：MA ± k 倍标准差（总体标准差，和多数行情软件一致）。 */
export function bollinger(v: number[], n = 20, k = 2) {
  const mid = sma(v, n);
  const upper: Series = [];
  const lower: Series = [];
  v.forEach((_, i) => {
    const m = mid[i];
    if (m == null) {
      upper.push(null);
      lower.push(null);
      return;
    }
    const w = v.slice(i - n + 1, i + 1);
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / n);
    upper.push(m + k * sd);
    lower.push(m - k * sd);
  });
  return { mid, upper, lower };
}

/** 平均名次（并列取平均），从 1 开始。 */
export function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) {
      j++;
    }
    for (let k = i; k <= j; k++) {
      out[idx[k][1]] = (i + j) / 2 + 1;
    }
    i = j + 1;
  }
  return out;
}

export function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) {
    return 0;
  }
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

/** 斯皮尔曼相关 = 名次的皮尔逊相关。 */
export const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));

/** 序列里有效值的最大、最小（和位置）。 */
export function extremes(s: Series): { hi: number; lo: number; hiAt: number; loAt: number } | null {
  let hi = -Infinity;
  let lo = Infinity;
  let hiAt = -1;
  let loAt = -1;
  s.forEach((x, i) => {
    if (x == null || !Number.isFinite(x)) {
      return;
    }
    if (x > hi) {
      hi = x;
      hiAt = i;
    }
    if (x < lo) {
      lo = x;
      loAt = i;
    }
  });
  return hiAt < 0 ? null : { hi, lo, hiAt, loAt };
}
