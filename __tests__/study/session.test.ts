/// <reference types="node" />
/**
 * 伴读运行时（QUANTWISE_DESIGN.md §6、§8）：内存库 + 示例教材 + 原型快照日线，用脚本化的「模型」走一遍：
 * 开讲 → 真实行情画图 → 岔路和回到主线 → 因子检验 → 检查题作答进 <action_results> → 本节小结。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setAiDeps } from '../../src/ai/chat';
import type { FetchLike } from '../../src/ai/http';
import { saveServices, type KeyStore } from '../../src/ai/services';
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
  quickAsk,
  saveWrapup,
  useStudy,
  wrapDraft,
} from '../../src/study/session';
import { STUDY_TOOL_DEFS } from '../../src/study/tools';

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
