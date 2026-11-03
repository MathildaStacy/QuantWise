/**
 * 行情与因子工具（QUANTWISE_DESIGN.md §8）：plot_chart、factor_test、get_factor_values。
 * AI 助手和伴读共用。每个工具把算好的图存进 ToolUi.chart，给模型的是同一份数据的文字摘要。
 */
import type { AppCore } from '../../app/boot';
import * as quantRepo from '../../data/quantRepo';
import { addDays, type DateStr } from '../../engine/calendar';
import { beijingIso } from '../../market/clock';
import { runFactorTest, SampleError, testSummary } from '../../quant/backtest';
import {
  compareChart,
  factorCharts,
  parseDay,
  parseFocus,
  parsePoints,
  priceChart,
  type ChartData,
  type SubKind,
} from '../../quant/charts';
import { FACTOR_IDS, FACTORS, type FactorId } from '../../quant/factors';
import { SUB_NAME } from '../../quant/charts';
import {
  isAStock,
  loadPanel,
  prepareBars,
  universeCodes,
  UNIVERSE_NAME,
  type UniverseEnv,
  type UniverseId,
} from '../../quant/universe';
import { normalizeCode, resolveCode } from './read';

export { QUANT_TOOL_DEFS, QUANT_TOOLS } from './quantDefs';


export interface QuantOutcome {
  output: string;
  label: string;
  charts?: ChartData[];
}

export function universeEnv(core: AppCore): UniverseEnv {
  return {
    db: core.db,
    client: core.client,
    calendar: core.sim.calendar,
    now: () => core.sim.now(),
    held: () => core.sim.heldCodes(),
    isoNow: () => beijingIso(),
  };
}

const int = (v: unknown, def: number, lo: number, hi: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
};

/**
 * 取日 K：没给日期时取最近 n + 80 根（前面 80 根给均线和动量预热）；给了区间、标注或 end 时按日期段取，
 * 3 年前的行情也能画。接口一次最多 2,000 根，所以两头都框住：最早的日期往前留出视窗和预热，最晚的往后一年多。
 */
function barsFetcher(core: AppCore, n: number | undefined, anchors: DateStr[]) {
  if (!anchors.length) {
    return (x: { code: string; type: string }) => core.client.kline(x.code, x.type, 'day', Math.min(800, (n ?? 250) + 80), 'qfq');
  }
  const sorted = [...anchors].sort();
  const start = addDays(sorted[0], -Math.ceil(((n ?? 250) + 140) * 1.5));
  const late = addDays(sorted[sorted.length - 1], 400);
  const end = late < beijingIso().slice(0, 10) ? late : '';
  return (x: { code: string; type: string }) => core.client.klineRange(x.code, x.type, start, end, 'qfq');
}

async function needCode(core: AppCore, v: unknown) {
  const r = await resolveCode(core, v);
  if (!r) {
    throw new Error('找不到证券「' + String(v ?? '') + '」');
  }
  if (r.name !== r.code) {
    return r;
  }
  // 不在自选和持仓里的证券本地没有名字（图的标题会只剩代码）：现拉一次行情取名字，取不到就用代码
  try {
    const q = (await core.client.quotes([r.code]))[0];
    return q ? { ...r, name: q.info.name, type: r.type || q.info.type } : r;
  } catch {
    return r;
  }
}

/** 股票池 → 代码；自动准备示例池和自选，沪深 300 没准备好时返回提示（不是错误）。 */
async function poolOf(core: AppCore, args: Record<string, unknown>) {
  const env = universeEnv(core);
  if (Array.isArray(args.codes) && args.codes.length) {
    const codes = [...new Set(args.codes.map(c => normalizeCode(String(c))).filter((c): c is string => !!c && isAStock(c)))].slice(0, 300);
    await prepareBars(env, codes);
    return { codes, name: '自定义 ' + codes.length + ' 只', id: 'custom' };
  }
  const id = (['sample', 'watch', 'hs300'].includes(String(args.universe)) ? args.universe : 'sample') as UniverseId;
  const { codes, asOf } = await universeCodes(env, id);
  if (id === 'hs300') {
    const ready = await quantRepo.qfqMeta(core.db, codes);
    if (codes.length < 250 || ready.size < codes.length * 0.9) {
      return { pending: '沪深 300 的数据还没准备：请用户在「学习 → 读书 → 因子实验室」点「准备数据」（约 1 分钟、15 MB 流量）。现在可以先用 universe = sample（示例池 25 只）。' };
    }
    return { codes, name: UNIVERSE_NAME.hs300 + (asOf ? '，成分取于 ' + asOf : ''), id };
  }
  if (!codes.length) {
    return { pending: '自选和持仓里没有 A 股个股，换 universe = sample。' };
  }
  await prepareBars(env, codes.slice(0, 60));
  return { codes: codes.slice(0, 60), name: UNIVERSE_NAME[id], id };
}

export async function runQuantTool(
  core: AppCore,
  name: string,
  args: Record<string, unknown>,
): Promise<QuantOutcome> {
  if (name === 'plot_chart') {
    const r = await needCode(core, args.code);
    const n = args.bars == null ? undefined : int(args.bars, 250, 20, 750);
    const focus = parseFocus(args.focus);
    const points = parsePoints(args.points);
    const end = parseDay(args.end, 'to');
    const takeaway = typeof args.takeaway === 'string' ? args.takeaway : undefined;
    const fetch = barsFetcher(core, n, [...focus.flatMap(f => [f.from, f.to]), ...points.map(p => p.date), ...(end ? [end] : [])]);
    const what = (c: ChartData) =>
      (c.kind === 'price' || c.kind === 'compare') && c.focus ? ' · 标出' + c.focus.map(f => '「' + f.label + '」').join('') : '';
    const compare = Array.isArray(args.compare) ? args.compare.slice(0, 4) : [];
    if (compare.length) {
      const all = [r, ...(await Promise.all(compare.map(c => needCode(core, c))))];
      const bars = await Promise.all(all.map(fetch));
      const c = compareChart(all.map((x, i) => ({ code: x.code, name: x.name, bars: bars[i] })), { n, end, focus, takeaway });
      return { output: c.text, label: '画图：' + all.map(x => x.name).join(' / ') + ' 对比' + what(c.chart), charts: [c.chart] };
    }
    const sub = Object.keys(SUB_NAME).includes(String(args.sub)) ? (args.sub as SubKind) : undefined;
    const ma = args.ma == null ? undefined : int(args.ma, 20, 5, 120);
    const bars = await fetch(r);
    if (bars.length < 2) {
      throw new Error('没有拿到 ' + r.name + ' 的日 K');
    }
    const c = priceChart({ code: r.code, name: r.name, bars, n, end, ma, band: args.band === true, sub, marks: args.marks === true, focus, points, takeaway });
    // 一行：日期范围和根数在卡片底部写着
    return { output: c.text, label: '画图：' + r.name + (sub ? ' · ' + SUB_NAME[sub] : '') + what(c.chart), charts: [c.chart] };
  }
  const factor = String(args.factor) as FactorId;
  if (!FACTORS[factor]) {
    throw new Error('factor 只能是 ' + FACTOR_IDS.join(' / '));
  }
  const pool = await poolOf(core, args);
  if ('pending' in pool) {
    return { output: pool.pending!, label: FACTORS[factor].name + '：数据还没准备' };
  }
  const panel = await loadPanel(core.db, pool.codes);
  if (name === 'factor_test') {
    const input = { factor, hold: [5, 10, 20, 60].includes(Number(args.hold)) ? Number(args.hold) : 20, groups: [3, 5, 10].includes(Number(args.groups)) ? Number(args.groups) : 5, costBp: int(args.cost_bp, 0, 0, 50) };
    try {
      const res = runFactorTest(panel, input);
      return { output: testSummary(res, pool.name), label: '因子检验：' + FACTORS[factor].name + ' · ' + pool.name + ' · ' + input.groups + ' 组 · 每 ' + input.hold + ' 日 · ' + res.periods + ' 期', charts: factorCharts(res, pool.id) };
    } catch (e) {
      if (e instanceof SampleError) {
        return { output: e.message, label: '因子检验：样本不够' };
      }
      throw e;
    }
  }
  return valuesOf(core, panel, factor, pool.name, args);
}

async function valuesOf(core: AppCore, panel: Awaited<ReturnType<typeof loadPanel>>, factor: FactorId, poolName: string, args: Record<string, unknown>): Promise<QuantOutcome> {
  const f = FACTORS[factor];
  const want = typeof args.date === 'string' ? args.date : panel.dates[panel.dates.length - 1];
  let t = panel.dates.length - 1;
  while (t > 0 && panel.dates[t] > want) {
    t--;
  }
  const rows = panel.codes
    .map(c => ({ c, x: f.value(panel, c, t) }))
    .filter((r): r is { c: string; x: number } => r.x != null && Number.isFinite(r.x))
    .sort((a, b) => b.x - a.x);
  const n = int(args.n, 5, 1, 20);
  const line = (r: { c: string; x: number }, i: number) => i + 1 + '. ' + panel.names[r.c] + '（' + r.c + '）' + fmt(factor, r.x);
  const out = [f.name + '（' + f.formula + (f.approx ? '，近似' : '') + '）· ' + poolName + ' · ' + panel.dates[t] + ' · ' + rows.length + ' 只，从高（因子最看好）到低：', ...rows.slice(0, n).map(line)];
  if (rows.length > n * 2) {
    out.push('…', ...rows.slice(-n).map((r, i) => line(r, rows.length - n + i)));
  }
  if (args.code != null) {
    const r = await resolveCode(core, args.code);
    const i = r ? rows.findIndex(x => x.c === r.code) : -1;
    out.push(r && i >= 0 ? r.name + ' 排第 ' + (i + 1) + ' / ' + rows.length + '，' + fmt(factor, rows[i].x) : '「' + String(args.code) + '」不在这个股票池里或当天没有数据');
  }
  return { output: out.join('\n'), label: '读取 ' + f.name + ' 排名 · ' + poolName + ' · ' + panel.dates[t] };
}

const fmt = (f: FactorId, x: number) =>
  f === 'size'
    ? '，总市值约 ' + (Math.exp(-x) / 1e8).toFixed(0) + ' 亿元'
    : f === 'vol20'
    ? '，日波动 ' + (-x * 100).toFixed(2) + '%'
    : f === 'turn20'
    ? '，日均换手 ' + (-x * 100).toFixed(2) + '%'
    : '，' + (x > 0 ? '+' : '') + (x * 100).toFixed(2) + '%';
