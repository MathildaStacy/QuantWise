/// <reference types="node" />
/** 显式 AI_EVAL_LIVE=1 才联网；其余检查跳过。Key 只从运行环境读取。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setAiDeps } from '../../src/ai/chat';
import type { FetchLike } from '../../src/ai/http';
import { saveServices } from '../../src/ai/services';
import type { AiService } from '../../src/ai/types';
import type { AppCore } from '../../src/app/boot';
import { SAMPLE_BOOK_ID } from '../../src/book/sample';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { setSetting } from '../../src/data/repos';
import * as studyRepo from '../../src/data/studyRepo';
import { T } from '../../src/engine';
import { BIG_CAPS } from '../../src/learn/datalab';
import type { MarketClient } from '../../src/market/client';
import { parseQuotes, type KBar } from '../../src/market/tencent';
import { runFactorTest } from '../../src/quant/backtest';
import { buildPanel } from '../../src/quant/factors';
import { snapshotQuestion } from '../../src/quant/interpret';
import { DEFAULT_REFRESH, type Refresher } from '../../src/sim/refresher';
import { Simulator } from '../../src/sim/simulator';
import { ensureSample } from '../../src/study/library';
import { loadReadingState, saveReadingState } from '../../src/study/readingState';
import { askStudy, citeCheck, openSection, pickQuiz, progressNow, quickAsk, saveWrapup, STUDY_PREFS_KEY, useStudy, wrapDraft } from '../../src/study/session';

jest.mock('../../src/data/drivers/opSqlite', () => ({ openDeviceDb: () => { throw new Error('联网验收使用独立内存库'); } }));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));

const live = process.env.AI_EVAL_LIVE === '1' ? describe : describe.skip;
const secret = process.env.AI_EVAL_KEY ?? '';
const service: AiService = {
  id: 'live-study', name: '联网验收', protocol: 'openai',
  baseUrl: process.env.AI_EVAL_BASE_URL ?? '', model: process.env.AI_EVAL_MODEL ?? '',
  effort: 'low', cache: 'auto', auth: 'bearer', price: null, keyTail: '',
};
const fixture = JSON.parse(readFileSync(join(__dirname, '../../docs/design/prototype/snapshot-2026-10-26.json'), 'utf8'));
const barsOf = (code: string): KBar[] => (fixture.kline[code] ?? []).map(([date, o, c, h, l, v]: [string, number, number, number, number, number]) => ({ date, open: Math.round(o * 1000), close: Math.round(c * 1000), high: Math.round(h * 1000), low: Math.round(l * 1000), volume: v * 100 }));
const requests: { status: number; ms: number; firstChunkMs: number | null; chunks: number; tools: number; toolResults: number; cache: boolean; reasoning: unknown }[] = [];
const turns: Record<string, unknown>[] = [];
let core: AppCore;
const session = () => useStudy.getState().s!;
const answer = () => [...session().messages].reverse().find(m => m.role === 'assistant')?.parts.filter(p => p.t === 'text').map(p => p.t === 'text' ? p.text : '').join('') ?? '';

const liveFetch: FetchLike = async (url, init) => {
  // 测试凭据只发送到指定服务；禁止重定向到另一站点。
  expect(new URL(url).origin).toBe(new URL(service.baseUrl).origin);
  const body = JSON.parse(init.body);
  const started = Date.now();
  const { onChunk, ...req } = init;
  const res = await fetch(url, { ...req, redirect: 'error' } as RequestInit);
  const record = { status: res.status, ms: 0, firstChunkMs: null as number | null, chunks: 0, tools: body.tools?.length ?? 0, toolResults: body.input?.filter((x: { type: string }) => x.type === 'function_call_output').length ?? 0, cache: !!body.prompt_cache_key, reasoning: body.reasoning };
  requests.push(record);
  let full = '';
  if (onChunk && res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      record.firstChunkMs ??= Date.now() - started;
      record.chunks++;
      const chunk = dec.decode(value, { stream: true });
      full += chunk;
      onChunk(chunk);
    }
  } else full = await res.text();
  record.ms = Date.now() - started;
  return { status: res.status, text: async () => full };
};

async function ask(question: string, label: string, snapshot = false) {
  const start = Date.now();
  const before = session().messages.length;
  const ok = await askStudy(core, { question, label, snapshot });
  turns.push({ label, ok, ms: Date.now() - start, answer: answer(), tools: session().messages.slice(before).flatMap(m => m.ui?.tools ?? []).map(t => ({ name: t.name, error: t.error ?? false })), error: useStudy.getState().error });
  expect({ label, ok, error: useStudy.getState().error }).toEqual({ label, ok: true, error: null });
  expect(answer().length).toBeGreaterThan(15);
}

live('真实 Responses API · 伴读流程', () => {
  beforeAll(async () => {
    expect(secret.length).toBeGreaterThan(0);
    expect(service.baseUrl).toMatch(/^https:\/\//);
    expect(service.model).not.toBe('');
    const db = openMemoryDb();
    await migrate(db);
    await ensureSample(db, '2026-10-26T14:00:00+08:00');
    const quotes = parseQuotes(readFileSync(join(__dirname, '../market/fixtures/qt-2026-10-26-1452.txt'), 'utf8'));
    const client = { quotes: async (codes: string[]) => quotes.filter(q => codes.includes(q.info.code)), search: async () => [], kline: async (code: string) => barsOf(code) } as unknown as MarketClient;
    const sim = await Simulator.open(db, client, () => ({ date: '2026-10-26', t: T(14, 53) }));
    await sim.ingest(quotes);
    core = { db, client, sim, refresher: { settings: { ...DEFAULT_REFRESH }, setExtraCodes() {}, kick() {} } as unknown as Refresher };
    await saveServices(db, [service]);
    await setSetting(db, STUDY_PREFS_KEY, { example: 'book', quiz: 'off', terms: true });
    setAiDeps({ keys: { get: async () => secret, set: async () => {}, remove: async () => {} }, fetch: liveFetch });
  });

  afterAll(async () => {
    const report = process.env.AI_EVAL_REPORT;
    if (report) {
      const json = JSON.stringify({ endpoint: service.baseUrl, model: service.model, requests, turns, lastSessionUsage: session()?.messages.filter(m => m.role === 'assistant').map(m => m.ui?.usage) }, null, 2);
      writeFileSync(report, secret ? json.split(secret).join('[redacted]') : json);
    }
    await core?.db.close();
  });

  test('真实流式讲解完成后推进，引用能定位到当前原文', async () => {
    await openSection(core, SAMPLE_BOOK_ID, '3.1');
    const start = Date.now();
    const ok = await askStudy(core, quickAsk(session(), 'start'));
    turns.push({ label: '开始第 1 步', ok, ms: Date.now() - start, answer: answer(), error: useStudy.getState().error });
    expect({ ok, error: useStudy.getState().error }).toEqual({ ok: true, error: null });
    expect(progressNow(session()).taught).toBe(0);
    expect(requests.some(r => r.chunks > 1)).toBe(true);
    const cites = [...answer().matchAll(/\[\[b:([\w.-]+)#(\d+)\]\]/g)];
    expect(cites.length).toBeGreaterThan(0);
    for (const c of cites) expect(citeCheck(session())(c[1], Number(c[2]))).not.toBeNull();
  }, 180_000);

  test('真实工具调用与工具结果回传：题目作答、小结确认与保存', async () => {
    await ask('请用 ask_quiz 给我一道关于动量排名不保证未来上涨的选择题，3 个选项；出题后简短提示我作答，不要直接公布答案。', '检查题');
    const m = [...session().messages].reverse().find(x => x.ui?.tools?.some(t => t.quiz));
    const tool = m?.ui?.tools?.find(t => t.quiz);
    expect(tool?.quiz?.options.length).toBeGreaterThanOrEqual(3);
    await pickQuiz(core, m!.id, tool!.id, tool!.quiz!.answer);
    await ask('我理解了：动量只是过去的相对排名。我已完成本节阅读，现在请调用 propose_section_wrapup 起草不超过 120 字的小结和 3 张闪卡，先展示草稿，等我确认保存。', '小结草稿');
    const draft = wrapDraft(session());
    expect(draft.from).not.toBeNull();
    expect(draft.cards.length).toBeGreaterThanOrEqual(3);
    expect(await studyRepo.cards(core.db)).toHaveLength(0);
    await saveWrapup(core, draft);
    expect(await studyRepo.cards(core.db)).toHaveLength(draft.cards.length);
    expect(requests.some(r => r.toolResults > 0)).toBe(true);
  }, 240_000);

  test('同次实验快照解读不重算，真实回复保留统计值', async () => {
    await openSection(core, SAMPLE_BOOK_ID, '4.2');
    const bars = new Map(BIG_CAPS.filter(c => fixture.kline[c]).map(c => [c, barsOf(c)]));
    const panel = buildPanel(bars, new Map());
    const result = runFactorTest(panel, { factor: 'mom20', hold: 20, groups: 5, costBp: 15 });
    const snapshot = { r: result, universe: 'sample' as const, codes: panel.codes.length, from: panel.dates[0], computedAt: '2026-11-02T12:00:00+08:00' };
    const before = requests.length;
    await ask(snapshotQuestion(snapshot), '解释当前实验', true);
    turns[turns.length - 1].snapshot = snapshot;
    expect(requests.slice(before).every(r => r.tools === 0)).toBe(true);
    // 允许模型保留更多小数位；仍校验数值与符号，不要求特定字符串格式。
    const numbers = (answer().replace(/−/g, '-').match(/[+-]?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const hasNumber = (value: number, precision: number) => numbers.some(n => Math.abs(n - value) <= 0.5 * 10 ** -precision);
    expect(hasNumber(result.icMean, 3)).toBe(true);
    expect(hasNumber(result.t, 2)).toBe(true);
    expect(hasNumber(result.longShortAnnual * 100, 1)).toBe(true);
  }, 180_000);

  test('连接中断后问题与进度保留，恢复真实服务后可重试', async () => {
    await openSection(core, SAMPLE_BOOK_ID, '3.2');
    const pending = quickAsk(session(), 'start');
    await saveReadingState(core.db, SAMPLE_BOOK_ID, '3.2', { draft: pending.question });
    setAiDeps({ fetch: async () => { throw new Error('验收注入：连接中断'); } });
    expect(await askStudy(core, pending)).toBe(false);
    expect(progressNow(session()).taught).toBe(-1);
    expect((await loadReadingState(core.db, SAMPLE_BOOK_ID, '3.2')).pending).toEqual(pending);
    setAiDeps({ fetch: liveFetch });
    const start = Date.now();
    const ok = await askStudy(core, pending);
    turns.push({ label: '中断后重试', ok, ms: Date.now() - start, answer: answer(), error: useStudy.getState().error });
    expect(ok).toBe(true);
    expect(progressNow(session()).taught).toBe(0);
    expect(await loadReadingState(core.db, SAMPLE_BOOK_ID, '3.2')).toMatchObject({ draft: '', pending: null });
  }, 180_000);
});
