/// <reference types="node" />
/**
 * 伴读运行时（QUANTWISE_DESIGN.md §6、§8）：内存库 + 示例教材 + 原型快照日线，用脚本化的「模型」走一遍：
 * 开讲 → 真实行情画图 → 岔路和回到主线 → 因子检验 → 检查题作答进 <action_results> → 本节小结。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setAiDeps, useChat } from '../../src/ai/chat';
import type { FetchLike } from '../../src/ai/http';
import { loadProviders, saveProviders, saveServices, type KeyStore } from '../../src/ai/services';
import type { AiService } from '../../src/ai/types';
import type { AppCore } from '../../src/app/boot';
import { SAMPLE_BOOK_ID } from '../../src/book/sample';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import * as studyRepo from '../../src/data/studyRepo';
import { T } from '../../src/engine';
import type { MarketClient } from '../../src/market/client';
import { parseQuotes, type KBar } from '../../src/market/tencent';
import { DEFAULT_REFRESH, type Refresher } from '../../src/sim/refresher';
import { Simulator } from '../../src/sim/simulator';
import { ensureSample } from '../../src/study/library';
import {
  askStudy,
  backToMain,
  citeCheck,
  openSection,
  pickQuiz,
  progressNow,
  newStudyRound,
  quickAsk,
  saveWrapup,
  selectStudyConfig,
  studyRebuild,
  useStudy,
  wrapDraft,
} from '../../src/study/session';
import { STUDY_COMPACT_PROMPT } from '../../src/study/compact';
import { runStudyTool, snippetOf, STUDY_TOOL_DEFS } from '../../src/study/tools';

jest.mock('../../src/data/drivers/opSqlite', () => ({ openDeviceDb: () => { throw new Error('测试里不用设备数据库'); } }));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));

const SVC: AiService = {
  id: 's1', name: '测试中转', protocol: 'anthropic', baseUrl: 'https://relay.example.com', model: 'claude-sonnet-5-5',
  effort: 'low', cache: 'auto', auth: 'bearer', price: null, keyTail: 'cret',
};
const snap = JSON.parse(readFileSync(join(__dirname, '../../docs/design/prototype/snapshot-2026-10-26.json'), 'utf8'));
const barsOf = (code: string): KBar[] =>
  (snap.kline[code] ?? []).map(([date, o, c, h, l, v]: number[]) => ({ date, open: Math.round(o * 1000), close: Math.round(c * 1000), high: Math.round(h * 1000), low: Math.round(l * 1000), volume: v * 100 }));

let replies: unknown[];
let sent: any[];
const fetchMock: FetchLike = async (_url, init) => {
  sent.push(JSON.parse(init.body));
  const r = replies.shift() ?? text('（没有更多脚本）');
  return { status: 200, text: async () => JSON.stringify(r) };
};
const keys = new Map([['s1', 'sk-test']]);
const keyStore: KeyStore = { get: async id => keys.get(id) ?? null, set: async () => undefined, remove: async () => undefined };
const usage = { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5 };
const text = (t: string) => ({ model: SVC.model, stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage });
let n = 0;
const tool = (name: string, input: Record<string, unknown>) => ({ model: SVC.model, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_' + ++n, name, input }], usage });
const lastUser = (body: any) => body.messages[body.messages.length - 1].content.map((c: any) => c.text ?? '').join('\n');
const s = () => useStudy.getState().s!;
const toolUis = () => s().messages.filter(m => m.role === 'tool').flatMap(m => m.ui?.tools ?? []);

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  await ensureSample(db, '2026-10-26T14:00:00+08:00');
  const quotes = parseQuotes(readFileSync(join(__dirname, '../market/fixtures/qt-2026-10-26-1452.txt'), 'utf8'));
  const client = {
    quotes: async (codes: string[]) => quotes.filter(q => codes.includes(q.snapshot.code)),
    search: async () => [],
    kline: async (code: string, _t: string, _p: string, count: number) => barsOf(code).slice(-count),
  } as unknown as MarketClient;
  const sim = await Simulator.open(db, client, () => ({ date: '2026-10-26', t: T(14, 53) }));
  await sim.ingest(quotes);
  const refresher = { settings: { ...DEFAULT_REFRESH }, setExtraCodes() {}, kick() {} } as unknown as Refresher;
  const core = { db, client, sim, refresher } as AppCore;
  await saveServices(db, [SVC]);
  setAiDeps({ keys: keyStore, fetch: fetchMock });
  replies = [];
  sent = [];
  return core;
}

test('伴读一节：请求结构、真实行情图、岔路、因子检验、检查题、小结', async () => {
  const core = await setup();
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  expect(s().steps).toHaveLength(4);
  expect(s().threadId).toBeNull();

  // 开讲：建对话、拍上下文快照、带 <study_state>
  replies = [text('动量是过去 n 天的累计收益 [[b:3.1#1]]。')];
  await askStudy(core, quickAsk(s(), 'start'));
  const body = sent[0];
  expect(body.system.map((x: any) => x.text).join('')).toContain('读书伴学老师');
  expect(JSON.stringify(body.system)).toContain('[3.1#2] (公式) $$MOM_{i,t}(n)');
  expect(body.tools.map((t: any) => t.name)).toEqual(STUDY_TOOL_DEFS.map(t => t.name));
  expect(STUDY_TOOL_DEFS.map(t => t.name)).toEqual([
    'ask_quiz', 'factor_test', 'get_benchmark', 'get_company_profile', 'get_factor_values', 'get_financials', 'get_kline', 'get_notes',
    'get_quote', 'load_section', 'mark_stuck', 'plot_chart', 'propose_section_wrapup', 'query_local_db', 'screen', 'search_book',
  ]);
  expect(lastUser(body)).toContain('现在讲：1. 动量是过去一段时间的累计收益（¶1–2）');
  expect(s().messages.find(m => m.role === 'user')?.ui?.question).toBe('开始讲第 1 步');
  expect(progressNow(s()).taught).toBe(0);

  // 真实行情举例：图的数据存在工具消息里
  replies = [tool('plot_chart', { code: 'sz300750', sub: 'mom20', marks: true, ma: 20 }), text('[[real]]宁德时代……[[/real]]')];
  await askStudy(core, quickAsk(s(), 'real'));
  const plot = toolUis().find(t => t.name === 'plot_chart')!;
  expect(plot.charts?.[0]).toMatchObject({ kind: 'price', code: 'sz300750' });
  expect(sent[sent.length - 1].messages.some((m: any) => JSON.stringify(m).includes('20 日动量：最高'))).toBe(true);

  // 岔路：读 4.2 之后能引用 4.2，没读过的 5.1 不行；回到主线折叠并记进 4.2 的笔记
  replies = [tool('load_section', { id: '4.2', detour: true }), text('IC 是横截面相关系数 [[b:4.2#1]]。')];
  await askStudy(core, { label: 'IC 是什么？', question: 'IC 是什么？' });
  expect(progressNow(s()).detour).toMatchObject({ sectionId: '4.2' });
  expect(citeCheck(s())('4.2', 2)).toBe('4.2 ¶2');
  expect(citeCheck(s())('5.1', 1)).toBeNull();
  expect(citeCheck(s())('3.1', 9)).toBeNull();
  await backToMain(core);
  expect(progressNow(s()).detour).toBeNull();
  expect(progressNow(s()).folds).toEqual([expect.objectContaining({ sectionId: '4.2', title: 'IC 是什么？', step: 0 })]);
  expect((await studyRepo.noteOf(core.db, SAMPLE_BOOK_ID, '4.2'))?.qa[0]).toMatchObject({ q: 'IC 是什么？', a: 'IC 是横截面相关系数 。', from: '3.1' });

  // 因子检验：示例池在本机算，三张图
  replies = [tool('factor_test', { factor: 'mom20', universe: 'sample' }), text('样本不够，不下结论。')];
  await askStudy(core, quickAsk(s(), 'factor'));
  const ft = toolUis().find(t => t.name === 'factor_test')!;
  expect(ft.charts?.map(c => c.kind)).toEqual(['factor', 'ic', 'groups']);
  expect(ft.label).toContain('示例池');

  // 检查题：作答结果在下一次提问里告诉模型，只告诉一次
  replies = [tool('ask_quiz', { question: '谁的动量高？', options: ['A', 'B', '一样'], answer: 0, explain: '横截面排序' }), text('选一个吧')];
  await askStudy(core, quickAsk(s(), 'quiz'));
  const qm = s().messages.find(m => m.ui?.tools?.some(t => t.quiz))!;
  await pickQuiz(core, qm.id, qm.ui!.tools![0].id, 1);
  await pickQuiz(core, qm.id, qm.ui!.tools![0].id, 0);
  replies = [text('懂了')];
  await askStudy(core, quickAsk(s(), 'next'));
  expect(lastUser(sent[sent.length - 1])).toContain('用户选了「B」，答错了（正确是「A」）');
  expect(s().state.step).toBe(1);
  replies = [text('好')];
  await askStudy(core, { label: '再问一句', question: '再问一句' });
  expect(lastUser(sent[sent.length - 1])).not.toContain('<action_results>');

  // 本节小结：草稿 → 保存 → 闪卡入库、这一节已学、下一节是 3.2
  replies = [tool('propose_section_wrapup', { summary: '动量 = 过去的累计收益', stuck: ['IC 的含义'], cards: [{ front: 'MOM 怎么算', back: 'P(t)/P(t-n)-1' }] }), text('请确认')];
  await askStudy(core, quickAsk(s(), 'finish'));
  const d = wrapDraft(s());
  expect(d.from).not.toBeNull();
  expect(d.cards).toEqual([{ front: 'MOM 怎么算', back: 'P(t)/P(t-n)-1', on: true }]);
  const next = await saveWrapup(core, d);
  expect(next?.id).toBe('3.2');
  expect(progressNow(s()).done).toBe(true);
  expect(await studyRepo.cards(core.db, SAMPLE_BOOK_ID)).toEqual([expect.objectContaining({ sectionId: '3.1', box: 1, front: 'MOM 怎么算' })]);
  expect((await studyRepo.stuckOf(core.db, SAMPLE_BOOK_ID)).map(x => x.text)).toEqual(['IC 的含义']);
  expect(wrapDraft(s()).from).toBeNull();
  await core.db.close();
});

test('伴读里不能用交易工具；没配置服务时说明怎么配', async () => {
  const core = await setup();
  await openSection(core, SAMPLE_BOOK_ID);
  expect(s().section.id).toBe('c1');
  replies = [tool('place_order', { code: '600036', side: 'B', price: 40, qty: 100 }), text('不能下单')];
  await askStudy(core, { label: '帮我买', question: '帮我买招商银行' });
  expect(toolUis()[0]).toMatchObject({ label: 'place_order（伴读里不能用）', error: true });
  keys.delete('s1');
  await expect(askStudy(core, { label: 'x', question: 'x' })).rejects.toThrow('还没有保存 API Key');
  keys.set('s1', 'sk-test');
  await core.db.close();
});

test.each(['empty', 'refusal', 'max_tokens', 'network'])('失败 %s 不推进；同一步可重试', async kind => {
  const core = await setup();
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  const a = quickAsk(s(), 'start');
  if (kind === 'network') setAiDeps({ fetch: async () => { throw new Error('测试断网'); } });
  else replies = [{ ...text(kind === 'empty' ? '' : '尚未讲完'), stop_reason: kind === 'empty' ? 'end_turn' : kind }];
  expect(await askStudy(core, a)).toBe(false);
  expect(progressNow(s()).taught).toBe(-1);
  expect(s().state.step).toBe(0);
  const { loadReadingState } = require('../../src/study/readingState');
  expect((await loadReadingState(core.db, SAMPLE_BOOK_ID, '3.1')).pending).toEqual(a);
  setAiDeps({ fetch: fetchMock });
  replies = [text('完整讲解')];
  expect(await askStudy(core, a)).toBe(true);
  expect(progressNow(s()).taught).toBe(0);
  expect((await loadReadingState(core.db, SAMPLE_BOOK_ID, '3.1')).pending).toBeNull();
  await core.db.close();
});

test('正在请求时禁止重复发送；跨节回复只更新原章节进度', async () => {
  const core = await setup();
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  let release!: () => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  setAiDeps({ fetch: async () => { began(); await hold; return { status: 200, text: async () => JSON.stringify(text('原章节的回答')) }; } });
  const a = { ...quickAsk(s(), 'start'), step: 2 };
  const { loadReadingState, saveReadingState } = require('../../src/study/readingState');
  await saveReadingState(core.db, SAMPLE_BOOK_ID, '3.1', { draft: a.question });
  await saveReadingState(core.db, SAMPLE_BOOK_ID, '3.2', { draft: '下一节的新草稿' });
  const request = askStudy(core, a);
  expect(await askStudy(core, a)).toBe(false);
  await started;
  await openSection(core, SAMPLE_BOOK_ID, '3.2');
  release();
  expect(await request).toBe(true);
  expect(s().section.id).toBe('3.2');
  expect(s().threadId).toBeNull();
  expect(s().state.main).toBe('3.2');
  expect(s().state.step).toBe(0);
  expect(s().state.sections['3.1'].taught).toBe(2);
  expect(progressNow(s()).taught).toBe(-1);
  expect((await loadReadingState(core.db, SAMPLE_BOOK_ID, '3.1')).draft).toBe('');
  expect((await loadReadingState(core.db, SAMPLE_BOOK_ID, '3.2')).draft).toBe('下一节的新草稿');
  await core.db.close();
});

test('停止生成保留问题且不推进步骤', async () => {
  const core = await setup();
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  setAiDeps({ fetch: async (_url, init) => {
    began();
    await new Promise<void>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    return { status: 200, text: async () => '' };
  } });
  const request = askStudy(core, quickAsk(s(), 'start'));
  await started;
  const { stopStudy } = require('../../src/study/session');
  stopStudy();
  expect(await request).toBe(false);
  expect(progressNow(s()).taught).toBe(-1);
  expect(useStudy.getState().error).toContain('已停止');
  await core.db.close();
});

test('保存小结是原子操作；失败可重试，重复确认不重复添卡', async () => {
  const core = await setup();
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  const d = { ...wrapDraft(s()), cards: [{ front: '测试问题', back: '测试答案', on: true }] };
  const add = jest.spyOn(studyRepo, 'addCards').mockRejectedValueOnce(new Error('测试存储失败'));
  await expect(saveWrapup(core, d)).rejects.toThrow('测试存储失败');
  expect(await studyRepo.noteOf(core.db, SAMPLE_BOOK_ID, '3.1')).toBeNull();
  expect(progressNow(s()).done).toBeUndefined();
  add.mockRestore();
  await Promise.all([saveWrapup(core, d), saveWrapup(core, d)]);
  expect(await studyRepo.cards(core.db)).toHaveLength(1);
  expect(progressNow(s()).taught).toBe(-1);
  const { loadShelf } = require('../../src/study/library');
  expect((await loadShelf(core.db, '2026-11-01')).resume.section.id).toBe('3.2');
  await core.db.close();
});

test('实验解读：工具定义照常发送（缓存不变），拒绝模型重新计算；无 Key 问题也保留', async () => {
  const core = await setup();
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  replies = [text('先讲一句')];
  await askStudy(core, quickAsk(s(), 'start'));
  const a = { label: '解释这次结果', question: '指定结果快照', snapshot: true };
  replies = [tool('factor_test', { factor: 'mom20' }), text('只根据屏幕上的结果解读')];
  expect(await askStudy(core, a)).toBe(true);
  // 和普通提问同一组工具、同样的前缀：快照解读不让缓存失效
  expect(sent[1].tools).toEqual(sent[0].tools);
  expect(JSON.stringify(sent[1].messages[0])).toBe(JSON.stringify(sent[0].messages[0]));
  expect(toolUis()).toEqual([expect.objectContaining({ name: 'factor_test', error: true, label: 'factor_test（只解读已有结果，没有执行）' })]);
  expect(toolUis()[0].charts).toBeUndefined();
  keys.delete('s1');
  await expect(askStudy(core, a)).rejects.toThrow('API Key');
  const { loadReadingState } = require('../../src/study/readingState');
  expect((await loadReadingState(core.db, SAMPLE_BOOK_ID, '3.1')).pending).toEqual(a);
  keys.set('s1', 'sk-test');
  await core.db.close();
});

test('准备阶段立即停止也不会发出模型请求', async () => {
  const core = await setup();
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  const request = askStudy(core, quickAsk(s(), 'start'));
  const { stopStudy } = require('../../src/study/session');
  stopStudy();
  expect(await request).toBe(false);
  expect(sent).toHaveLength(0);
  expect(progressNow(s()).taught).toBe(-1);
  await core.db.close();
});

test('讲解的模型 / 思考 / 搜索按小节保存，和 AI 助手分开；改了设置提示重建缓存、可改回，发送后插分隔线', async () => {
  const core = await setup();
  const ps = await loadProviders(core.db);
  await saveProviders(core.db, ps.map(p => ({ ...p, models: [...p.models, { id: 'claude-opus-5-5', enabled: true, price: null }] })));
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  expect(s().config).toMatchObject({ providerId: 's1', model: 'claude-sonnet-5-5', search: false });
  // 助手里开着别的模型和搜索：讲解不跟着变
  useChat.setState({ config: { providerId: 's1', model: 'claude-opus-5-5', effort: 'high', search: true } });
  replies = [text('第 1 步')];
  await askStudy(core, quickAsk(s(), 'start'));
  expect(sent[0].model).toBe('claude-sonnet-5-5');
  expect(sent[0].tools.some((t: any) => t.name === 'web_search')).toBe(false);
  expect(studyRebuild(s())).toBeNull();
  await selectStudyConfig(core, { ...s().config!, model: 'claude-opus-5-5', effort: 'medium' });
  expect(studyRebuild(s())).toMatchObject({ reason: '更换模型、调整思考强度' });
  await selectStudyConfig(core, studyRebuild(s())!.previous);
  expect(studyRebuild(s())).toBeNull();
  await selectStudyConfig(core, { ...s().config!, model: 'claude-opus-5-5', effort: 'medium' });
  replies = [text('第 2 步')];
  await askStudy(core, quickAsk(s(), 'next'));
  expect(sent[1].model).toBe('claude-opus-5-5');
  expect(sent[1].output_config).toEqual({ effort: 'medium' });
  expect(s().messages.filter(m => m.role === 'user').at(-1)?.ui?.divider).toContain('更换模型');
  expect(studyRebuild(s())).toBeNull();
  // 下一节沿用讲解最近一次选择，搜索不继承
  await selectStudyConfig(core, { ...s().config!, search: true });
  await openSection(core, SAMPLE_BOOK_ID, '3.2');
  expect(s().config).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium', search: false });
  useChat.setState({ config: null });
  await core.db.close();
});

test('讲解开启联网搜索：发送搜索工具，pause_turn 接着跑，来源记在回答上', async () => {
  const core = await setup();
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  await selectStudyConfig(core, { ...s().config!, search: true });
  const paused = { model: SVC.model, stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'Fama French 五因子 A股' } }], usage };
  const done = {
    model: SVC.model, stop_reason: 'end_turn', usage,
    content: [
      { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [{ type: 'web_search_result', url: 'https://example.com/ff5', title: 'FF 五因子在 A 股' }] },
      { type: 'text', text: '[[web]]有研究发现……（example.com）[[/web]]' },
    ],
  };
  replies = [paused, done];
  expect(await askStudy(core, { label: 'FF 五因子', question: 'Fama-French 五因子最新的 A 股实证？' })).toBe(true);
  expect(sent[0].tools[0]).toMatchObject({ name: 'web_search' });
  expect(sent).toHaveLength(2);
  expect(sent[1].messages.at(-1).role).toBe('assistant');
  const last = s().messages.filter(m => m.role === 'assistant').at(-1)!;
  expect(last.ui?.search?.sources).toEqual([expect.objectContaining({ url: 'https://example.com/ff5' })]);
  expect(last.ui?.searchOffer).toBeUndefined();
  await core.db.close();
});

test('回到讲解页时：模型停用了就换成可用的默认，删掉讲解对话不影响进度', async () => {
  const core = await setup();
  const ps = await loadProviders(core.db);
  await saveProviders(core.db, ps.map(p => ({ ...p, models: [...p.models, { id: 'claude-opus-5-5', enabled: true, price: null }] })));
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  await selectStudyConfig(core, { ...s().config!, model: 'claude-opus-5-5' });
  replies = [text('第 1 步')];
  await askStudy(core, quickAsk(s(), 'start'));
  await saveProviders(core.db, (await loadProviders(core.db)).map(p => ({ ...p, models: p.models.map(m => ({ ...m, enabled: m.id !== 'claude-opus-5-5' })) })));
  const { refreshStudyConfig, deleteStudyThread } = require('../../src/study/session');
  await refreshStudyConfig(core);
  expect(s().config?.model).toBe('claude-sonnet-5-5');
  await deleteStudyThread(core, s().threadId!);
  expect(s().threadId).toBeNull();
  expect(progressNow(s()).taught).toBe(0);
  expect(await studyRepo.studyThreads(core.db, { bookId: SAMPLE_BOOK_ID })).toEqual([]);
  await core.db.close();
});

test('长对话自动整理：回答后超过整理线就整理较早的讲解；保留的回答不再回放思考块，之后带上摘要', async () => {
  const core = await setup();
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  for (let i = 1; i <= 4; i++) {
    replies = [text('答' + i)];
    await askStudy(core, { label: '问' + i, question: '问' + i });
  }
  expect(sent).toHaveLength(4);
  const big = { input_tokens: 2000, cache_read_input_tokens: 68000, cache_creation_input_tokens: 500, output_tokens: 300 };
  replies = [{ ...text('答5'), content: [{ type: 'thinking', thinking: '想', signature: 'sig5' }, { type: 'text', text: '答5' }], usage: big }, text('讲到第 1 步；用户问过 1–2。')];
  expect(await askStudy(core, { label: '问5', question: '问5' })).toBe(true);
  expect(sent).toHaveLength(6);
  const req = sent[5];
  expect(lastUser(req)).toBe(STUDY_COMPACT_PROMPT);
  // 同一前缀：工具、system 不变，Anthropic 不改 tool_choice
  expect(req.tool_choice).toBeUndefined();
  expect(req.tools).toEqual(sent[4].tools);
  expect(JSON.stringify(req.system)).toBe(JSON.stringify(sent[4].system));
  expect(s().summary).toBe('讲到第 1 步；用户问过 1–2。');
  expect(s().messages.filter(m => m.role === 'user' && !m.compacted).map(m => m.ui?.question)).toEqual(['问3', '问4', '问5']);
  replies = [text('答6')];
  await askStudy(core, { label: '问6', question: '问6' });
  expect(sent[6].system[1].text).toContain('<lecture_summary>');
  const hist = JSON.stringify(sent[6].messages);
  expect(hist).not.toContain('问1');
  expect(hist).toContain('答5');
  expect(hist).not.toContain('sig5');
  expect((await studyRepo.studyThreads(core.db, { bookId: SAMPLE_BOOK_ID }))[0].compactedCount).toBe(2);
  await core.db.close();
});

test('一问之内工具结果按剩余上下文截断，不改历史', async () => {
  const core = await setup();
  const ps = await loadProviders(core.db);
  await saveProviders(core.db, ps.map(p => ({ ...p, models: p.models.map(m => ({ ...m, overrides: { ...m.overrides, context: 40000 } })) })));
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  replies = [{ ...tool('load_section', { id: '4.2' }), usage: { ...usage, input_tokens: 15800 } }, text('根据已读内容回答')];
  expect(await askStudy(core, { label: 'IC', question: 'IC 是什么' })).toBe(true);
  expect(JSON.stringify(sent[1].messages)).toContain('上下文快满了');
  expect(toolUis()[0].label).toContain('只发送了一部分');
  await core.db.close();
});

test('新开一轮：旧的讲解归档只读，下一问新建对话；讲解记录能列出、能搜索', async () => {
  const core = await setup();
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  replies = [text('第一轮')];
  await askStudy(core, quickAsk(s(), 'start'));
  const first = s().threadId!;
  // 岔路记的是这一轮的消息 id：新开一轮时清掉，讲到第几步保留
  replies = [tool('load_section', { id: '4.2', detour: true }), text('IC 是横截面相关系数')];
  await askStudy(core, { label: 'IC 是什么？', question: 'IC 是什么？' });
  expect(progressNow(s()).detour).not.toBeNull();
  await newStudyRound(core, first);
  expect(s().threadId).toBeNull();
  expect(s().messages).toEqual([]);
  expect(progressNow(s()).taught).toBe(0);
  expect(progressNow(s()).detour).toBeNull();
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  expect(s().threadId).toBeNull();
  replies = [text('第二轮')];
  await askStudy(core, quickAsk(s(), 'start'));
  expect(s().threadId).not.toBe(first);
  const rows = await studyRepo.studyThreads(core.db, { bookId: SAMPLE_BOOK_ID });
  expect(rows.map(r => [r.sectionId, r.archivedAt != null, r.questions, r.lastQuestion])).toEqual([
    ['3.1', false, 1, '开始讲第 1 步'],
    ['3.1', true, 2, 'IC 是什么？'],
  ]);
  expect(await studyRepo.studyThreads(core.db, { query: '第二轮' })).toHaveLength(1);
  await core.db.close();
});

test('load_section 可以从指定块接着读；search_book 只给命中处前后', async () => {
  const core = await setup();
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  const env = { core, threadId: 0, bookId: SAMPLE_BOOK_ID, sectionId: '3.1', sections: s().sections };
  const out = await runStudyTool(env, 'x', 'load_section', JSON.stringify({ id: '3.1', from: 2 }));
  expect(out.output).not.toContain('[3.1#1]');
  expect(out.output).toContain('[3.1#2]');
  expect(snippetOf('a'.repeat(500) + '动量' + 'b'.repeat(500), '动量')).toBe('…' + 'a'.repeat(200) + '动量' + 'b'.repeat(200) + '…');
  expect(snippetOf('短句里有动量', '动量')).toBe('短句里有动量');
  await core.db.close();
});

test('OpenAI Responses（Codex）：讲解带 reasoning、-study 缓存 key；整理用 tool_choice none 不破坏前缀，保留加密推理', async () => {
  const core = await setup();
  const ps = await loadProviders(core.db);
  await saveProviders(core.db, ps.map(p => ({ ...p, kind: 'openai' as const, protocol: 'openai' as const, baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-5.3-codex', enabled: true, price: null }] })));
  await openSection(core, SAMPLE_BOOK_ID, '3.1');
  expect(s().config).toMatchObject({ model: 'gpt-5.3-codex', effort: 'low', search: false });
  const out = (t: string, u: Record<string, unknown> = { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5 }, enc?: string) => ({
    model: 'gpt-5.3-codex',
    status: 'completed',
    output: [...(enc ? [{ type: 'reasoning', id: 'rs_' + enc, encrypted_content: enc, summary: [] }] : []), { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: t }] }],
    usage: u,
  });
  for (let i = 1; i <= 4; i++) {
    replies = [out('答' + i)];
    expect(await askStudy(core, { label: '问' + i, question: '问' + i })).toBe(true);
  }
  expect(sent[0]).toMatchObject({ model: 'gpt-5.3-codex', reasoning: { effort: 'low', summary: 'auto' }, store: false, include: ['reasoning.encrypted_content'] });
  expect(sent[0].prompt_cache_key).toMatch(/^quantwise-.+-study$/);
  expect(sent[0].tools.some((t: any) => t.type === 'web_search')).toBe(false);
  replies = [out('答5', { input_tokens: 70000, input_tokens_details: { cached_tokens: 60000 }, output_tokens: 300 }, 'enc5'), out('讲到第 1 步。')];
  expect(await askStudy(core, { label: '问5', question: '问5' })).toBe(true);
  expect(sent).toHaveLength(6);
  expect(sent[5].tool_choice).toBe('none');
  expect(sent[5].tools).toEqual(sent[4].tools);
  expect(sent[5].instructions).toBe(sent[4].instructions);
  expect(sent[5].prompt_cache_key).toBe(sent[4].prompt_cache_key);
  replies = [out('答6')];
  await askStudy(core, { label: '问6', question: '问6' });
  const hist = JSON.stringify(sent[6].input);
  expect(hist).toContain('enc5');
  expect(hist).not.toContain('问1');
  expect(sent[6].instructions).toContain('<lecture_summary>');
  await core.db.close();
});
