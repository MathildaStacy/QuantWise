/// <reference types="node" />
/**
 * 三重屏障和元标签（pm-reader-lecture-20261105.md 第 10 项）：屏障按收盘价判断、次级模型不偷看后面的结果、
 * 对比的账算得对；meta_label_test 的摘要、图和参数；讲到打标签的方法时「用真实行情举例」走这个工具。
 * 日线是固定种子的随机游走（约 5 年）和原型快照里的宁德时代。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUANT_TOOL_DEFS, runQuantTool } from '../../src/ai/tools/quant';
import type { AppCore } from '../../src/app/boot';
import { chartTitle } from '../../src/quant/charts';
import { eventLine, fitLogistic, LABEL_DEFAULTS, labelsChart, MIN_TRAIN, runLabels, type LabelInput } from '../../src/quant/labels';
import { parseQuotes, type KBar } from '../../src/market/tencent';
import { labeling, quick } from '../../src/study/quick';

/** Park–Miller：固定种子的伪随机数（0–1）。 */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
}

/** n 个交易日（跳过周末）的随机游走：日波动约 2%。 */
function walk(n: number, seed: number): { date: string; close: number; volume: number }[] {
  const r = rng(seed);
  const out: { date: string; close: number; volume: number }[] = [];
  const d = new Date(Date.UTC(2020, 0, 6));
  let p = 50;
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      p *= 1 + 0.02 * Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
      out.push({ date: d.toISOString().slice(0, 10), close: p, volume: Math.round(1e6 * (0.5 + r())) });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const kbars = (rows: { date: string; close: number; volume: number }[]): KBar[] =>
  rows.map(x => ({ date: x.date, open: Math.round(x.close * 1000), close: Math.round(x.close * 1000), high: Math.round(x.close * 1000), low: Math.round(x.close * 1000), volume: x.volume }));

const FAST: LabelInput = { ...LABEL_DEFAULTS, fast: 3, slow: 10 };
const rows = walk(1200, 3);

test('三重屏障：按收盘价看先碰到哪一道，出场前没碰过别的；元标签是顺方向的收益 > 0', () => {
  for (const x of [FAST, { ...FAST, side: 'both' as const, pt: 2, sl: 1 }, { ...FAST, pt: 0 }]) {
    const r = runLabels(rows, x);
    const done = r.events.filter(e => e.label != null);
    expect(done.length).toBeGreaterThan(30);
    expect(r.barriers.pt + r.barriers.sl + r.barriers.time).toBe(done.length);
    for (const e of done) {
      const path = (j: number) => e.side * (rows[j].close / rows[e.i].close - 1);
      for (let j = e.i + 1; j < e.exit!; j++) {
        expect(x.pt === 0 || path(j) < x.pt * e.target).toBe(true);
        expect(x.sl === 0 || path(j) > -x.sl * e.target).toBe(true);
      }
      expect(e.ret).toBeCloseTo(path(e.exit!), 10);
      expect(e.label).toBe(e.ret! > 0 ? 1 : 0);
      if (e.barrier === 'pt') {
        expect(e.ret!).toBeGreaterThanOrEqual(x.pt * e.target);
      } else if (e.barrier === 'sl') {
        expect(e.ret!).toBeLessThanOrEqual(-x.sl * e.target);
      } else {
        expect(e.exit! - e.i).toBe(x.hold);
      }
    }
    if (x.pt === 0) {
      expect(r.barriers.pt).toBe(0);
    }
    if (x.side === 'long') {
      expect(r.events.every(e => e.side === 1)).toBe(true);
    } else {
      expect(r.events.some(e => e.side === -1)).toBe(true);
    }
    // 最后几次还没到期、也没碰到屏障：没有标签，也不进对比
    expect(r.events.filter(e => e.label == null).every(e => e.i + x.hold > rows.length - 1)).toBe(true);
  }
});

test('次级模型不偷看后面的结果：把日线截在某天，那天以前的信号概率不变；预热是开头连续的一段', () => {
  const full = runLabels(rows, FAST);
  const cut = runLabels(rows.slice(0, 900), FAST);
  const byDay = new Map(full.events.map(e => [e.i, e]));
  const before = cut.events.filter(e => e.prob != null);
  expect(before.length).toBeGreaterThan(10);
  for (const e of before) {
    expect(byDay.get(e.i)!.prob).toBe(e.prob);
  }
  const first = full.events.findIndex(e => e.prob != null);
  expect(first).toBeGreaterThanOrEqual(MIN_TRAIN);
  expect(full.events.slice(first).every(e => e.prob != null)).toBe(true);
});

test('对比的账：放行 + 没放行 = 比较期全部；标准误按不放回抽样算', () => {
  const r = runLabels(rows, FAST);
  const scored = r.events.filter(e => e.label != null && e.prob != null);
  expect(r.all.n).toBe(scored.length);
  expect(r.taken.n + r.skipped.n).toBe(r.all.n);
  expect(r.taken.hits + r.skipped.hits).toBe(r.all.hits);
  expect(r.warm + r.all.n).toBe(r.events.filter(e => e.label != null).length);
  const taken = scored.filter(e => e.prob! >= 0.5);
  expect(r.taken.mean).toBeCloseTo(taken.reduce((a, e) => a + e.ret!, 0) / taken.length, 10);
  const p = r.all.hits / r.all.n;
  const se = Math.sqrt(((p * (1 - p)) / r.taken.n) * ((r.all.n - r.taken.n) / (r.all.n - 1)));
  expect(r.z).toBeCloseTo((r.taken.hits / r.taken.n - p) / se, 10);
});

test('逻辑回归：特征和结果真有关系时，概率跟着特征走', () => {
  const r = rng(11);
  const F = Array.from({ length: 80 }, () => [r() * 2 - 1, r()]);
  const Y = F.map(f => (f[0] + 0.3 * (r() - 0.5) > 0 ? 1 : 0));
  const p = fitLogistic(F, Y);
  expect(p([0.8, 0.5])).toBeGreaterThan(0.8);
  expect(p([-0.8, 0.5])).toBeLessThan(0.2);
});

test('图：只画最近 n 根和里面的信号；止盈止损按方向和倍数放在进场价两边；今天的盘中那根不用', () => {
  const x = { ...FAST, side: 'both' as const, pt: 2, sl: 1 };
  const bars = kbars(rows);
  const today = bars[bars.length - 1].date;
  const { chart, text } = labelsChart({ code: 'sz300750', name: '宁德时代', bars, input: x, n: 200, today });
  expect(chart.dates).toHaveLength(200);
  expect(chart.stats.to).toBe(bars[bars.length - 2].date);
  expect(chart.stats.bars).toBe(bars.length - 1);
  expect(text).toContain(today + ' 是今天的盘中数据，没有用');
  expect(chart.events.length).toBeGreaterThan(5);
  for (const m of chart.events) {
    expect(m.i).toBeGreaterThanOrEqual(0);
    expect(m.i).toBeLessThan(200);
    expect(m.entry).toBe(chart.close[m.i]);
    // target 存的是四位小数：差几厘；乘数或方向弄反时差几元
    const [up, down] = m.side > 0 ? [x.pt, x.sl] : [x.sl, x.pt];
    expect(m.upper!).toBeCloseTo(m.entry * (1 + up * m.target), 1);
    expect(m.lower!).toBeCloseTo(m.entry * (1 - down * m.target), 1);
  }
  expect(chartTitle(chart)).toBe('元标签 · 宁德时代 · MA3/10 交叉');
  const long = chart.events.find(m => m.side > 0 && m.barrier)!;
  expect(eventLine(chart, long)).toMatch(/^\d{4}-\d\d-\d\d 金叉做多 · 进场 \d+\.\d\d · 止盈 \d+\.\d\d（\+\d+\.\d%），止损 \d+\.\d\d（-\d+\.\d%）· \d+\/\d+ (止盈|止损|到期)出场 [-+]?\d+\.\d%（元标签 [01]）· 次级模型/);
  const short = chart.events.find(m => m.side < 0)!;
  expect(eventLine(chart, short)).toContain('死叉做空');
  // 做空：止盈在下面
  expect(short.lower!).toBeLessThan(short.entry);
  expect(eventLine(chart, short)).toContain('止盈 ' + short.lower!.toFixed(2));
});

describe('meta_label_test', () => {
  const quotes = parseQuotes(readFileSync(join(__dirname, '../market/fixtures/qt-2026-10-26-1452.txt'), 'utf8'));
  const snap = JSON.parse(readFileSync(join(__dirname, '../../docs/design/prototype/snapshot-2026-10-26.json'), 'utf8')) as {
    kline: Record<string, [string, number, number, number, number, number][]>;
  };
  const catl: KBar[] = snap.kline.sz300750.map(([date, o, c, h, l, v]) => ({ date, open: Math.round(o * 1000), close: Math.round(c * 1000), high: Math.round(h * 1000), low: Math.round(l * 1000), volume: v * 100 }));
  const coreWith = (bars: KBar[]) =>
    ({
      client: {
        quotes: async (codes: string[]) => quotes.filter(q => codes.includes(q.snapshot.code)),
        search: async () => [],
        klineRange: async () => bars,
      },
      sim: { quote: () => null, security: () => null },
    } as unknown as AppCore);

  it('约 5 年日线：摘要写口径、三道屏障各碰到几次、对比和结论，图是元标签图；参数收回到范围里', async () => {
    const r = await runQuantTool(coreWith(kbars(rows)), 'meta_label_test', { code: '300750', fast: 3, slow: 10, pt: 9, hold: 1000 });
    const c = r.charts![0];
    expect(c.kind).toBe('labels');
    if (c.kind !== 'labels') {
      return;
    }
    expect(c.stats).toMatchObject({ fast: 3, slow: 10, side: 'long', pt: 5, sl: 1, hold: 120 });
    expect(r.label).toBe('元标签：宁德时代 · MA3/10 金叉 · ' + c.stats.signals + ' 次信号');
    expect(r.output).toContain('元标签检验：宁德时代（sz300750）前复权日线');
    expect(r.output).toContain('主信号：MA3 上穿 MA10（金叉）做多，信号当天收盘进场');
    expect(r.output).toMatch(/结果：止盈 \d+ 次、止损 \d+ 次、到期 \d+ 次/);
    expect(r.output).toContain('按时间顺序，每次只用在它之前已经出了结果的信号训练');
    expect(r.output).toMatch(/- 全部跟主信号：\d+ 次，命中率 \d+\.\d%/);
    expect(r.output).toContain('不扣佣金和印花税');
    await expect(runQuantTool(coreWith(kbars(rows)), 'meta_label_test', { code: '300750', fast: 20, slow: 10 })).rejects.toThrow('slow（10）要比 fast（20）大');
  });

  it('日线太短时写明差多少；信号太少时照常画三重屏障，说明不够训练次级模型', async () => {
    const short = await runQuantTool(coreWith(catl.slice(-120)), 'meta_label_test', { code: '300750' });
    expect(short.label).toBe('元标签：宁德时代 · MA5/20 金叉：日线不够');
    expect(short.output).toContain('日线只有 120 根');
    expect(short.charts).toBeUndefined();
    const year = await runQuantTool(coreWith(catl), 'meta_label_test', { code: '300750' });
    expect(year.output).toContain('不够训练次级模型');
    expect(year.charts![0].kind).toBe('labels');
  });

  it('助手和讲解共用这份工具定义（讲解的工具列表在 session.test.ts 里核对）', () => {
    expect(QUANT_TOOL_DEFS.map(t => t.name)).toContain('meta_label_test');
  });
});

test('讲到打标签的方法时，「用真实行情举例」改用 meta_label_test，不假设一个信号', () => {
  const steps = [{ index: 0, title: '元标签', from: 1, to: 3 }];
  const afml = 'Suppose that you have a model for setting the side of the bet. Meta-labeling helps us learn the size of the bet.';
  expect(labeling(afml)).toBe(true);
  expect(labeling('三重屏障法给每个事件打标签')).toBe(true);
  expect(labeling('动量是过去一段时间的累计收益。')).toBe(false);
  const a = quick('real', { steps, step: 0, stepText: afml });
  expect(a.question).toContain('meta_label_test');
  expect(a.question).not.toContain('plot_chart');
  expect(a.hint).toContain('三重屏障');
  const b = quick('realBlock', { steps, step: 0, block: { label: '3.6 ¶1', id: '3.6#1', text: afml, sentence: 'It helps us learn the size.' } });
  expect(b.question).toContain('这一段讲的是打标签的方法');
  expect(b.question).toContain('不要假设一个信号');
});
