/**
 * 因子和行情图的几何（纯函数，可单测）：坐标换算、折线路径、刻度、十字线读数。画图组件在 QuantChart.tsx。
 */
import { fmtSub, focusSpan, groupScale, icSummary, md, MONTH_DAYS, signed, SUB_NAME, WEIGHT_NAME, type ChartData, type Focus, type IcChart } from '../../quant/charts';
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

// ---------- 刻度 ----------

/** 估算文字宽度（SVG 里量不了）：汉字一个字号宽，数字和字母约 0.6 个。 */
export function labelWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0x2e80 ? size : /[\d.+\-−%/,]/.test(ch) ? size * 0.58 : size * 0.62;
  }
  return w;
}

/** 刻度步长要几位小数：25 → 0，2.5 → 1，0.25 → 2。 */
export function tickDecimals(step: number): number {
  const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const scaled = step * 10 ** d;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6 ? d : d + 1;
}

/**
 * 「整」刻度：步长取 1 / 2 / 2.5 / 5 × 10ⁿ 里放得下（不超过 max 个）的最细一档，至少 2 个（范围太窄时放宽 max）。
 * 价格 182.3–247.9 → 200、220、240；ETF 4.512–4.738 → 4.55、4.6、4.65、4.7；百分比用小数算（0.1 = 10%）。
 */
export function niceTicks(lo: number, hi: number, max = 5): { ticks: number[]; step: number } {
  if (!(hi > lo)) {
    return { ticks: Number.isFinite(lo) ? [lo] : [], step: 1 };
  }
  const mag = 10 ** Math.floor(Math.log10((hi - lo) / max));
  const count = (s: number) => Math.floor(hi / s + 1e-9) - Math.ceil(lo / s - 1e-9) + 1;
  const step = [1, 2, 2.5, 5, 10, 20].map(m => m * mag).find(s => count(s) <= max) ?? 20 * mag;
  const d = tickDecimals(step);
  const ticks: number[] = [];
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) {
    ticks.push(Number((k * step).toFixed(d)));
  }
  return ticks.length < 2 && max < 12 ? niceTicks(lo, hi, max + 1) : { ticks, step };
}

export interface TimeTick {
  i: number;
  label: string;
}

type TimeUnit = { kind: 'week' | 'month' | 'year'; every: number };
const WEEKS: TimeUnit[] = [{ kind: 'week', every: 1 }, { kind: 'week', every: 2 }];
const MONTHS: TimeUnit[] = [
  { kind: 'month', every: 1 },
  { kind: 'month', every: 2 },
  { kind: 'month', every: 3 },
  { kind: 'month', every: 6 },
  { kind: 'year', every: 1 },
  { kind: 'year', every: 2 },
];

const mondayOf = (d: string) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

/** 每一段（周 / 月 / 年）的第一个交易日；图的第一天不算（那一段多半不完整）。 */
function starts(dates: string[], kind: TimeUnit['kind']): number[] {
  const key = kind === 'week' ? mondayOf : kind === 'month' ? (d: string) => d.slice(0, 7) : (d: string) => d.slice(0, 4);
  const out: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    if (key(dates[i]) !== key(dates[i - 1])) {
      out.push(i);
    }
  }
  return out;
}

const tickLabel = (d: string, u: TimeUnit) => {
  const m = Number(d.slice(5, 7));
  if (u.kind === 'week') {
    return m + '/' + Number(d.slice(8, 10));
  }
  return u.kind === 'year' || m === 1 ? d.slice(0, 4) + '年' : m + '月';
};

/**
 * 横轴刻度：两个半月以内按周，再长按月；从细到粗试「每周、隔周、每月、隔月、每季、半年、每年」，
 * 取第一个标签之间留得出 gap 的。minor 是没写标签的月份边界，week 是周边界（每周至少 7dp 时才给），
 * 都画成轴上的小刻度。
 */
export function timeTicks(
  dates: string[],
  x: (i: number) => number,
  size: number,
  gap = 8,
): { major: TimeTick[]; minor: number[]; week: number[] } {
  const units = dates.length <= 55 ? [...WEEKS, ...MONTHS] : MONTHS;
  for (const u of units) {
    const idx = starts(dates, u.kind).filter((i, k) =>
      u.kind === 'week' ? k % u.every === 0 : u.kind === 'month' ? (Number(dates[i].slice(5, 7)) - 1) % u.every === 0 : Number(dates[i].slice(0, 4)) % u.every === 0,
    );
    const major = idx.map(i => ({ i, label: tickLabel(dates[i], u) }));
    const fits = major.every((t, k) => k === 0 || x(t.i) - x(major[k - 1].i) >= (labelWidth(t.label, size) + labelWidth(major[k - 1].label, size)) / 2 + gap);
    if (fits) {
      const taken = new Set(idx);
      const minor = u.kind === 'week' ? [] : starts(dates, 'month').filter(i => !taken.has(i));
      const weeks = starts(dates, 'week');
      const roomy = weeks.length > 1 && (x(weeks[weeks.length - 1]) - x(weeks[0])) / (weeks.length - 1) >= 7;
      const used = new Set([...idx, ...minor]);
      return { major, minor, week: u.kind !== 'week' && roomy ? weeks.filter(i => !used.has(i)) : [] };
    }
  }
  return { major: [], minor: [], week: [] };
}

export interface PinnedLabel {
  x: number;
  label: string;
  tone: 'focus' | 'point';
  /** 第几段区间：同一段的第一天和最后一天挨得太近时合并。 */
  band?: number;
}

/**
 * 横轴上优先写的日期（区间第一天和最后一天、标注日），按给的顺序放：同一段区间的头尾挨得太近时合并成「9/1–9/3」；
 * 和已经放下的日期重叠的不写（两段区间首尾相接时，后一段的第一天让给前一段的最后一天）；和它们重叠的月份标签也不写。
 * 返回留下的月份刻度和要写的日期（x 已夹在图里）。
 */
export function axisLabels(
  major: TimeTick[],
  pinned: PinnedLabel[],
  x: (i: number) => number,
  size: number,
  width: number,
): { major: TimeTick[]; pinned: PinnedLabel[] } {
  const box = (p: PinnedLabel) => {
    const half = labelWidth(p.label, size) / 2;
    const cx = Math.max(half, Math.min(width - half, p.x));
    return { p, cx, x1: cx - half - 4, x2: cx + half + 4 };
  };
  const hits = (a: { x1: number; x2: number }, b: { x1: number; x2: number }) => a.x1 < b.x2 && b.x1 < a.x2;
  const placed: ReturnType<typeof box>[] = [];
  for (const p of pinned) {
    const b = box(p);
    const k = placed.findIndex(q => hits(q, b));
    if (k < 0) {
      placed.push(b);
    } else if (p.band != null && placed[k].p.band === p.band) {
      const q = placed[k].p;
      const m = box({ ...p, x: (q.x + p.x) / 2, label: q.label + '–' + p.label });
      if (!placed.some((o, j) => j !== k && hits(o, m))) {
        placed[k] = m;
      }
    }
  }
  const kept = major.filter(t => {
    const half = labelWidth(t.label, size) / 2;
    return !placed.some(b => x(t.i) + half > b.x1 && x(t.i) - half < b.x2);
  });
  return { major: kept, pinned: placed.map(b => ({ x: b.cx, label: b.p.label, tone: b.p.tone })) };
}

/**
 * 重点区间在横轴上的范围：区间里每个交易日占一格（点在格子中间），从第一天的格子左边到最后一天的格子右边。
 * 区间涨跌的基数（前一个交易日收盘）在区间左边一格，图上单独画一个点并写「前收」。
 */
export function bandX(dates: string[], f: Focus, x: (i: number) => number): { x1: number; x2: number } | null {
  const s = focusSpan(dates, f);
  if (!s) {
    return null;
  }
  const half = dates.length > 1 ? (x(1) - x(0)) / 2 : 4;
  return { x1: x(s.a) - half, x2: x(s.b) + half };
}

/** 十字线落在哪个区间里（区间第一天到最后一天）。 */
export function focusAt(c: ChartData, i: number): Focus | null {
  if (c.kind !== 'price' && c.kind !== 'compare') {
    return null;
  }
  return c.focus?.find(f => c.dates[i] >= f.from && c.dates[i] <= f.to) ?? null;
}

export const pointCount = (c: ChartData) =>
  c.kind === 'groups' ? c.means.length : c.kind === 'ic' ? c.ic.length : c.dates.length;

const pct = (v: number, d = 1) => (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%';

/** 十字线所在那一天的数字（全屏图下方的读数）；落在重点区间里时末尾注明（数据表里用竖线标，不写）。 */
export function readout(c: ChartData, i: number, focusNote = true): string {
  const f = focusNote ? focusAt(c, i) : null;
  const inFocus = f ? ' · 在「' + f.label + '」区间内' : '';
  switch (c.kind) {
    case 'price': {
      // 区间里的一天另写离区间起点走了多少（和图下区间读数同一个基数）
      const sp = f ? focusSpan(c.dates, f) : null;
      const sofar = sp && i !== sp.k ? (sp.k < sp.a ? '较前收 ' : '较首日 ') + pct(c.close[i] / c.close[sp.k] - 1, 2) : '';
      const day = i > 0 || sofar ? '（' + [i > 0 ? '当日 ' + pct(c.close[i] / c.close[i - 1] - 1, 2) : '', sofar].filter(Boolean).join('，') + '）' : '';
      const parts = [c.dates[i] + ' 收盘 ' + c.close[i].toFixed(2) + day];
      const ma = c.ma?.values[i];
      if (ma != null) {
        parts.push('MA' + c.ma!.n + ' ' + ma.toFixed(2));
      }
      if (c.band?.upper[i] != null && c.band.lower[i] != null) {
        parts.push('布林带上轨 ' + c.band.upper[i]!.toFixed(2) + ' / 下轨 ' + c.band.lower[i]!.toFixed(2));
      }
      const sub = c.sub?.values[i];
      if (sub != null && c.sub) {
        parts.push(SUB_NAME[c.sub.kind] + ' ' + fmtSub(c.sub.kind, sub));
      }
      return parts.join(' · ') + inFocus;
    }
    case 'compare':
      return c.dates[i] + ' · ' + c.series.map(s => s.name + ' ' + s.values[i].toFixed(1)).join(' · ') + inFocus;
    case 'factor':
      return c.dates[i] + ' · ' + c.groups.map((g, k) => 'Q' + (k + 1) + ' ' + g[i].toFixed(3)).join(' ') + ' · 基准 ' + c.bench[i].toFixed(3) + ' · 多空 ' + c.longShort[i].toFixed(3);
    case 'ic':
      return c.dates[i] + ' · Rank IC ' + (c.ic[i] > 0 ? '+' : '') + c.ic[i].toFixed(3) + ' · 累计 IC ' + c.ic.slice(0, i + 1).reduce((sum, v) => sum + v, 0).toFixed(3);
    case 'groups': {
      const g = groupScale(c);
      const pp = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
      return g.book
        ? 'Q' + (i + 1) + ' 本次' + (g.unit === 'monthly' ? '折成月均 ' : '折成年化 ') + pp(g.ours[i]) + ' · 书中 ' + pp(g.book[i]) + '（每期平均 ' + pct(c.means[i], 2) + '）'
        : 'Q' + (i + 1) + ' 每期平均 ' + pct(c.means[i], 2);
    }
  }
}

/**
 * IC 图的走势，一句话：累计 IC 一路向上 / 一路向下 / 来回摆动（按 t 值和最后落在哪），
 * 加一句噪声提醒（大部分柱子在噪声带里时）。
 */
export function icTrend(c: IcChart): string[] {
  const s = icSummary(c);
  const cum: number[] = [];
  c.ic.reduce((a, b, i) => (cum[i] = a + b), 0);
  const end = cum[cum.length - 1] ?? 0;
  const hi = Math.max(0, ...cum);
  const lo = Math.min(0, ...cum);
  const f2 = (v: number) => signed(v, 2);
  const trend =
    s.t >= 2
      ? '这次累计 IC 一路向上（到 ' + f2(end) + '）：因子排名高的股票下一期多数涨得更多，方向稳定'
      : s.t <= -2
      ? '这次累计 IC 一路向下（到 ' + f2(end) + '）：因子排名高的股票下一期反而涨得少，方向稳定但和预期相反'
      : end > 0 && end >= hi * 0.6
      ? '这次累计 IC 大体向上（到 ' + f2(end) + '），但 |t| < 2，还说不上稳定'
      : end < 0 && end <= lo * 0.6
      ? '这次累计 IC 大体向下（到 ' + f2(end) + '），但 |t| < 2，还说不上稳定'
      : '这次累计 IC 来回摆动（最高 ' + f2(hi) + '、最低 ' + f2(lo) + '，最后 ' + f2(end) + '）：方向不稳定';
  const inside = c.noise ? c.ic.filter(v => Math.abs(v) <= c.noise!).length : 0;
  const noisy = c.noise && inside >= c.ic.length * 0.7;
  return [
    trend,
    ...(noisy ? [s.n + ' 期里 ' + inside + ' 期的柱子在灰色噪声带里：单期 IC 多半是噪声，看均值和 t 值，不看某一期'] : []),
  ];
}

/** 「怎么看」：卡片里给刚入门的人的读图说明，只说这张图上真有的东西（口径公式在全屏的「怎么算的」）。 */
export function howToRead(c: ChartData): string[] {
  const focus = (c.kind === 'price' || c.kind === 'compare') && c.focus?.length
    ? ['黄色区间是讲解里说到的那段；顶部标签和图下读数是这段的区间涨跌']
    : [];
  switch (c.kind) {
    case 'price':
      return [
        '蓝线是每天的收盘价；前复权把分红、送股折算进过去的价格，前后涨跌才能直接比',
        ...focus,
        ...(c.focus?.length ? ['空心点：左边是「前收」（区间开始前一天的收盘，算区间涨跌的基数），右边是区间最后一天'] : []),
        ...(c.marks?.some(m => m.kind === 'point') ? ['锈红色的点是讲解要你看的那一天，日期写在横轴上'] : []),
        ...(c.ma ? ['紫线 MA' + c.ma.n + ' 是最近 ' + c.ma.n + ' 天收盘的平均；收盘在它上方，说明这段时间偏强'] : []),
        ...(c.band ? ['布林带：价格碰到上轨或下轨，说明离 20 日均价偏得比较远'] : []),
        ...(c.sub
          ? [
              {
                mom20: '下面的柱子是 20 日动量：今天比 20 个交易日前涨了多少；红柱在 0 线上方是在涨，绿柱在下方是在跌',
                mom60: '下面的柱子是 60 日动量：今天比 60 个交易日前涨了多少；红柱在 0 线上方是在涨，绿柱在下方是在跌',
                vol20: '下面的线是 20 日年化波动：最近 20 天涨跌有多剧烈，线越高走得越颠簸',
                dd: '下面的绿色区域是回撤：比之前的最高收盘跌了多少，越深说明离高点越远',
                rsi14: 'RSI(14) 在 0–100 之间，最近上涨越占上风越高；70 以上常叫超买、30 以下叫超卖，只是参考，不是买卖信号',
                volume: '下面的柱子是成交量：越高成交越活跃；红柱是当天收盘比前一天高，绿柱是更低',
              }[c.sub.kind],
            ]
          : []),
        '颜色按 A 股习惯：红涨绿跌',
      ];
    case 'compare':
      return [
        (c.base ? '每只都换算成 ' + md(c.base) + ' 收盘 = 100' : '每只都换算成第一天收盘 = 100') + '：线越高，说明从那天以来涨得越多，几只可以直接比',
        ...focus,
        ...(c.focus?.length ? ['区间右缘写着每只在区间里的涨跌'] : []),
      ];
    case 'factor':
      return [
        '按因子值把股票从低到高分成几组（Q1 最低），每条线是这一组的净值，从 1.00 出发' + (c.stats?.weight === 'cap' ? '；组内按市值加权' : ''),
        '最高组和最低组拉得越开、各组排得越整齐，说明这个因子越能区分股票；默认只画最高、最低两组，「看全部分组」画出每一组',
        '灰色虚线是池子里全部股票等权的基准' + (c.stats?.weight === 'cap' ? '（这次各组是市值加权，基准仍是等权，两者口径不同）' : '') + '，锈红虚线是多空：最高组减最低组',
      ];
    case 'ic':
      return [
        '每根柱子是一期的 Rank IC：因子排名和下一期收益排名有多一致，红柱为正、绿柱为负；左上、左下写着柱子的刻度',
        ...(c.noise ? ['灰色带是 ±' + c.noise.toFixed(2) + '：因子完全没有预测力时，约 95% 的柱子也会落在这里（股票越少，带越宽）'] : []),
        '虚线是累计 IC（把每期的 IC 加起来），刻度写在右侧，和柱子共用 0 线',
        ...icTrend(c),
      ];
    case 'groups': {
      const g = groupScale(c);
      return [
        g.book
          ? '每根柱子是这次一组的收益，按调仓周期折成' + (g.unit === 'monthly' ? '月均' : '年化') + '，和书里的数同一个单位；从左到右因子值从低到高'
          : '每根柱子是一组的每期平均收益，从左到右因子值从低到高；从左到右一路升高或降低，说明因子能区分好坏',
        ...(c.book
          ? [
              '空心点连虚线是书中 ' + c.book.label + ' 的数（App 从书里的表格读出' + (c.book.merged ? '，' + c.book.merged : '') + '），两边样本期、股票池不同，先比形状再比大小',
              '形状用秩相关看：组序和各组收益排名的相关，一路升高是 +1，一路降低是 −1，没有单调关系时在 0 附近',
            ]
          : []),
      ];
    }
  }
}

/** 「怎么算的」：全屏图下面的口径说明。 */
export function howComputed(c: ChartData): string[] {
  const focus = (c.kind === 'price' || c.kind === 'compare') && c.focus?.length
    ? ['重点区间（黄色）的涨跌：区间最后一天收盘 ÷ 区间前一个交易日收盘 − 1，和行情软件的「区间涨跌幅」一样']
    : [];
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
                rsi14: 'RSI(14)：Wilder 平滑的 14 日相对强弱；70 以上通常叫超买，30 以下叫超卖',
                volume: '成交量：当天成交的股数；收盘比前一天高画红色，低画绿色',
              }[c.sub.kind],
            ]
          : []),
        ...focus,
      ];
    case 'compare':
      return [
        c.base
          ? '每只的收盘价除以 ' + c.base + '（第一段重点区间的前一个交易日）的收盘价 × 100：几条线在区间左边缘从同一点出发，区间里谁的线高谁就强；只用几只都有数据的交易日'
          : '每只的收盘价除以第一天的收盘价 × 100，只用几只都有数据的交易日',
        ...focus,
      ];
    case 'factor': {
      const cap = c.stats?.weight === 'cap';
      return [
        '每个调仓日按因子从低到高分组，每组' + (cap ? '按调仓日总市值加权' : '等权') + '持有到下一个调仓日' + (cap ? '（市值用今天的股本往回推，近似）' : ''),
        ...(c.stats?.control ? ['控制市值：先按调仓日总市值分 ' + c.stats.control.groups + ' 组，' + (c.stats.control.sort === 'conditional' ? '在每个市值组里再按因子分组' : '因子另外按全部股票分组，两边取交集') + '；因子各组的收益是各市值组同一因子组的平均'] : []),
        '虚线是池子里全部股票等权的基准' + (cap ? '（' + WEIGHT_NAME.cap + '的各组和它口径不同）' : ''),
        '成本只扣最高组和最低组（按换手）',
      ];
    }
    case 'ic':
      return [
        '每期的 Rank IC：因子值排名和下一期收益排名的相关系数' + (c.stats?.control ? '（在每个市值组里算再平均）' : ''),
        ...(c.noise && c.stats?.avgStocks ? ['噪声带 ±' + c.noise.toFixed(2) + '：每期平均 ' + c.stats.avgStocks + ' 只，没有预测力时单期 Rank IC 的标准差约 1/√(只数 − 1)，取 ±2 倍'] : []),
        '虚线是累计 IC（每期 IC 的累加），刻度在右侧',
        'IC 只看排名，组内等权还是市值加权都一样',
      ];
    case 'groups': {
      const g = groupScale(c);
      const hold = c.stats?.hold;
      return [
        '各组每期收益的平均值；从左到右因子值从低到高',
        ...(g.book && hold
          ? [
              (g.unit === 'monthly' ? '折成月均：每期收益 × ' + MONTH_DAYS + ' / ' + hold : '折成年化：每期收益 × 252 / ' + hold) + '（单利近似），和书里的数同一个单位',
              '书中的数由 App 从 ' + c.book!.cite + ' 的表格单元格读出' + (c.book!.merged ? '，' + c.book!.merged : ''),
              '秩相关：组序（1、2、…）和各组收益的 Spearman 相关；书中按原书的组数算',
            ]
          : []),
      ];
    }
  }
}
