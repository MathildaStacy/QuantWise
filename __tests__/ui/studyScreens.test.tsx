/// <reference types="node" />
/**
 * 读书伴学界面的冒烟测试：在内存库 + 示例教材 + 原型快照日线上把书架、地图、听讲（含图表卡片）、读书、
 * 本节小结、复习、笔记、因子实验室、全屏图、设置页都渲染一遍。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setAiDeps } from '../../src/ai/chat';
import type { FetchLike } from '../../src/ai/http';
import { saveServices } from '../../src/ai/services';
import { useApp, type AppCore } from '../../src/app/boot';
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
import { useStudy } from '../../src/study/session';
import type { RootStackParamList } from '../../src/ui/navigation/types';
import { BookMapScreen, NotesScreen } from '../../src/ui/screens/BookScreens';
import { ChartFullScreen, FactorLabScreen } from '../../src/ui/screens/FactorScreens';
import { MineruSettingsScreen, StudyPrefsScreen } from '../../src/ui/screens/ImportScreens';
import { LearnScreen } from '../../src/ui/screens/LearnScreens';
import { ReviewScreen, SectionDoneScreen } from '../../src/ui/screens/ReviewScreens';
import { StudyScreen } from '../../src/ui/screens/StudyScreen';
import { StudyIntroScreen } from '../../src/ui/screens/StudyIntroScreen';
import { loadReadingState } from '../../src/study/readingState';
import { beijingIso } from '../../src/market/clock';
import { addDays } from '../../src/book/review';

jest.mock('../../src/data/drivers/opSqlite', () => ({ openDeviceDb: () => { throw new Error('测试里不用设备数据库'); } }));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));

const snap = JSON.parse(readFileSync(join(__dirname, '../../docs/design/prototype/snapshot-2026-10-26.json'), 'utf8'));
const barsOf = (code: string): KBar[] =>
  (snap.kline[code] ?? []).map(([date, o, c, h, l, v]: number[]) => ({ date, open: Math.round(o * 1000), close: Math.round(c * 1000), high: Math.round(h * 1000), low: Math.round(l * 1000), volume: v * 100 }));
const Stack = createNativeStackNavigator<RootStackParamList>();
let replies: unknown[] = [];
const fetchMock: FetchLike = async () => ({ status: 200, text: async () => JSON.stringify(replies.shift()) });
const usage = { input_tokens: 1, output_tokens: 1 };

let core: AppCore;
const trees: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => { trees.splice(0).forEach(t => t.unmount()); });
  // 焦点清理会把最后一笔草稿写入，关闭数据库之前等它完成。
  await core.db.get('SELECT 1');
});
afterAll(async () => { await core.db.close(); });
beforeAll(async () => {
  const db = openMemoryDb();
  await migrate(db);
  await ensureSample(db, '2026-10-26T10:00:00+08:00');
  const quotes = parseQuotes(readFileSync(join(__dirname, '../market/fixtures/qt-2026-10-26-1452.txt'), 'utf8'));
  const client = {
    quotes: async (codes: string[]) => quotes.filter(q => codes.includes(q.snapshot.code)),
    search: async () => [],
    kline: async (code: string, _t: string, _p: string, n: number) => barsOf(code).slice(-n),
  } as unknown as MarketClient;
  const sim = await Simulator.open(db, client, () => ({ date: '2026-10-26', t: T(14, 53) }));
  await sim.ingest(quotes);
  const refresher = { settings: { ...DEFAULT_REFRESH }, setExtraCodes() {}, kick() {} } as unknown as Refresher;
  core = { db, client, sim, refresher } as AppCore;
  useApp.setState({ core, version: 1 });
  await saveServices(db, [{ id: 's1', name: '测试', protocol: 'anthropic', baseUrl: 'https://x.example.com', model: 'claude-sonnet-5-5', effort: 'low', cache: 'auto', auth: 'bearer', price: null, keyTail: 'abcd' }]);
  setAiDeps({ keys: { get: async () => 'sk', set: async () => undefined, remove: async () => undefined }, fetch: fetchMock });
});

async function render<K extends keyof RootStackParamList>(name: K, component: React.ComponentType<any>, params?: RootStackParamList[K]) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name={name} component={component} initialParams={params as never} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  await act(async () => {
    await new Promise(r => setTimeout(r, 60));
  });
  trees.push(tree);
  const text = () => JSON.stringify(tree.toJSON());
  const type = async (label: string, value: string) => {
    const input = tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function')[0];
    await act(async () => { input.props.onChangeText(value); });
  };
  const press = async (label: string) => {
    const [btn] = tree.root.findAll(n => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || n.findAll(c => c.props.children === label).length > 0));
    if (!btn) {
      throw new Error('找不到按钮：' + label);
    }
    await act(async () => {
      await btn.props.onPress();
      await new Promise(r => setTimeout(r, 60));
    });
  };
  return { tree, text, press, type };
}

test('首次学习 Tab：无虚假续学，有离线体验和书架；能切到路线', async () => {
  const r = await render('Tabs', LearnScreen);
  expect(r.text()).toContain('开始体验');
  expect(r.text()).not.toContain('继续学习');
  expect(r.text()).toContain('因子投资入门');
  expect(r.text()).toContain('0 / 19 节');
  await r.press('路线');
  expect(r.text()).toContain('当前阶段');
});

test('书的地图：章节和状态', async () => {
  const r = await render('BookMap', BookMapScreen, { bookId: SAMPLE_BOOK_ID });
  expect(r.text()).toContain('第 3 章 动量与反转');
  expect(r.text()).toContain('3.1 动量因子');
  expect(r.text()).toContain('未学');
});

test('听讲：进来不请求模型；开讲后显示讲解、引用和真实行情图；读书模式显示原文', async () => {
  const r = await render('Study', StudyScreen, { bookId: SAMPLE_BOOK_ID, sectionId: '3.1' });
  expect(r.text()).toContain('本节路线图 · ","4');
  expect(r.text()).toContain('开始讲第 1 步');
  replies = [
    { model: 'm', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'plot_chart', input: { code: 'sz300750', sub: 'mom20' } }], usage },
    { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '动量是累计收益 [[b:3.1#1]]，[[real]]宁德时代的例子[[/real]]' }], usage },
  ];
  await r.press('开始讲第 1 步');
  expect(r.text()).toContain('3.1 ¶1');
  expect(r.text()).toContain('真实行情');
  expect(r.text()).toContain('宁德时代 · 20 日动量');
  expect(r.text()).toContain('懂了，继续');
  await r.press('原文');
  expect(r.text()).toContain('读完这一节');
  expect(r.text()).toContain('¶5');
  await r.press('AI 讲解');
  replies = [
    { model: 'm', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'quiz-live', name: 'ask_quiz', input: { question: '10 元涨到 11 元的动量？', options: ['过去上涨 10%', '未来上涨 10%', '过去上涨 1%'], answer: 0, explain: '[[example]]11 ÷ 10 − 1 = 10%，描述过去。[[b:3.1#2]][[/example]]' } }], usage },
    { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '请选择一个答案。' }], usage },
  ];
  await r.press('考考我');
  expect(r.text()).not.toContain('11 ÷ 10');
  await r.press('过去上涨 10%');
  expect(r.text()).toContain('答对了。');
  expect(r.text()).toContain('AI 举例');
  expect(r.text()).toContain('11 ÷ 10 − 1 = 10%');
  expect(r.text()).not.toContain('[[example]]');
  expect(r.text()).not.toContain('[[b:');
  await r.press('原文 3.1 ¶2');
  expect(r.text()).toContain('原文 · 3.1 动量因子 ¶2');
});

test('本节小结、复习、笔记', async () => {
  const s = await render('SectionDone', SectionDoneScreen, { bookId: SAMPLE_BOOK_ID });
  expect(s.text()).toContain('本机草稿');
  expect(useStudy.getState().s?.section.id).toBe('3.1');
  await studyRepo.addCards(core.db, SAMPLE_BOOK_ID, '3.1', [{ front: '动量怎么算', back: 'P(t)/P(t−n)−1' }], '2026-01-01', '2026-01-01T00:00:00+08:00');
  await studyRepo.addStuck(core.db, SAMPLE_BOOK_ID, '2.2', 'MAD 的 1.4826', '2026-01-01T00:00:00+08:00');
  const r = await render('Review', ReviewScreen);
  expect(r.text()).toContain('开始复习');
  expect(r.text()).toContain('MAD 的 1.4826');
  expect(r.text()).toContain('让 AI 重讲');
  await studyRepo.saveSummary(core.db, SAMPLE_BOOK_ID, '3.1', '动量是累计收益', '2026-01-01T00:00:00+08:00');
  const n = await render('Notes', NotesScreen, { bookId: SAMPLE_BOOK_ID });
  expect(n.text()).toContain('动量是累计收益');
  expect(n.text()).toContain('导出 Anki CSV');
});

test('因子实验室：示例池现算，统计和三张图；全屏图有读数说明', async () => {
  const r = await render('FactorLab', FactorLabScreen, { factor: 'mom20' });
  await act(async () => {
    await new Promise(res => setTimeout(res, 300));
  });
  expect(r.text()).toContain('Rank IC 均值');
  expect(r.text()).toContain('分组净值 · 20 日动量');
  const factorCard = () => r.tree.root.findAll(n => n.props.data?.kind === 'factor')[0].props.data;
  const original = factorCard();
  await r.press('调整参数');
  await r.press('3 组');
  expect(r.text()).toContain('下面仍是上次结果');
  expect(factorCard()).toEqual(original);
  await r.press('取消修改');
  expect(r.text()).not.toContain('下面仍是上次结果');
  expect(factorCard()).toEqual(original);
  await r.press('调整参数');
  await r.press('3 组');
  await r.press('应用参数并计算');
  expect(factorCard().groups).toHaveLength(3);
  expect(r.text()).not.toContain('Rank IC · 每期');
  await r.press('更多图表：IC 与各组收益');
  expect(r.text()).toContain('Rank IC · 每期');
  const c = await render('ChartFull', ChartFullScreen, { chart: { kind: 'groups', factor: 'mom20', means: [0.01, -0.02, 0.03] } });
  expect(c.text()).toContain('怎么算的');
  expect(c.text()).toContain('在图上按住或拖动');
});

test('设置页：MinerU、讲解偏好', async () => {
  const m = await render('MineruSettings', MineruSettingsScreen);
  expect(m.text()).toContain('Token：');
  const p = await render('StudyPrefs', StudyPrefsScreen);
  expect(p.text()).toContain('优先用真实 A 股行情');
});


test('草稿跨退出重进；失败后问题可重试，进度不提前推进', async () => {
  const r = await render('Study', StudyScreen, { bookId: SAMPLE_BOOK_ID, sectionId: '3.2', mode: 'lecture' });
  await r.type('提问草稿', '请保留这个问题');
  await act(async () => { r.tree.unmount(); });
  const next = await render('Study', StudyScreen, { bookId: SAMPLE_BOOK_ID, sectionId: '3.2' });
  expect(next.text()).toContain('请保留这个问题');
  setAiDeps({ fetch: async () => { throw new Error('测试断网'); } });
  await next.press('发送');
  expect(next.text()).toContain('重试上次的问题');
  expect(useStudy.getState().s?.state.sections['3.2']?.taught ?? -1).toBe(-1);
  expect((await loadReadingState(core.db, SAMPLE_BOOK_ID, '3.2')).pending?.question).toBe('请保留这个问题');
  replies = [{ model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '已恢复的回答' }], usage }];
  setAiDeps({ fetch: fetchMock });
  await next.press('重试上次的问题');
  expect(next.text()).toContain('已恢复的回答');
  expect((await loadReadingState(core.db, SAMPLE_BOOK_ID, '3.2')).pending).toBeNull();
});

test('离线入门能完成检查题，保存小结后停在本节并展示真实复习日期', async () => {
  const transport = jest.fn(async () => { throw new Error('离线体验不应请求 AI'); });
  setAiDeps({ fetch: transport });
  const intro = await render('StudyIntro', StudyIntroScreen);
  await intro.press('看一个例子');
  await intro.press('判断一下');
  await intro.press('能，涨得多就会继续上涨');
  expect(intro.text()).toContain('你可以重新选择');
  await intro.press('不能，过去的排名不保证未来上涨');
  expect(intro.text()).toContain('保存本节小结');
  expect(transport).not.toHaveBeenCalled();
  const { openSection } = require('../../src/study/session');
  await act(async () => { await openSection(core, SAMPLE_BOOK_ID, '3.1'); });
  // 之前测试留有编辑草稿时，入门流程必须保留它。
  await core.db.run("DELETE FROM settings WHERE key = ?", ['reading:' + SAMPLE_BOOK_ID + ':3.1']);
  const done = await render('SectionDone', SectionDoneScreen, { bookId: SAMPLE_BOOK_ID });
  await done.press('加一张');
  await done.type('闪卡问题', '本轮新问题');
  await done.type('闪卡答案', '本轮新答案');
  const before = (await studyRepo.cards(core.db)).length;
  await done.press('保存，今天到这里');
  expect(done.text()).toContain('这一节，先学到这里');
  expect(done.text()).toContain(addDays(beijingIso().slice(0, 10), 1));
  expect(useStudy.getState().s?.section.id).toBe('3.1');
  expect((await studyRepo.cards(core.db)).length).toBe(before + 1);
  expect((await loadReadingState(core.db, SAMPLE_BOOK_ID, '3.1')).wrap).toBeNull();
  const map = await render('BookMap', BookMapScreen, { bookId: SAMPLE_BOOK_ID });
  expect(map.text()).toContain('继续 3.2 短期反转');
  setAiDeps({ fetch: fetchMock });
});

test('复习区分无卡、无到期和确实完成', async () => {
  await core.db.run('DELETE FROM study_card');
  const empty = await render('Review', ReviewScreen);
  expect(empty.text()).toContain('还没有闪卡');
  expect(empty.text()).not.toContain('今天的复习已完成');
  const today = beijingIso().slice(0, 10);
  await studyRepo.addCards(core.db, SAMPLE_BOOK_ID, '3.1', [{ front: '问题', back: '答案' }], addDays(today, 1), beijingIso());
  const waiting = await render('Review', ReviewScreen);
  expect(waiting.text()).toContain('今天没有到期的闪卡');
  const card = (await studyRepo.cards(core.db))[0];
  await studyRepo.reviewCard(core.db, card.id, 2, addDays(today, 3), beijingIso());
  const completed = await render('Review', ReviewScreen);
  expect(completed.text()).toContain('今天的复习已完成');
});

test('同一会话留在内存中，跨天再进入仍显示回顾且保留旧讲解', async () => {
  const { openSection } = require('../../src/study/session');
  await openSection(core, SAMPLE_BOOK_ID, '3.2', 'lecture');
  const session = useStudy.getState().s!;
  const state = { ...session.state, activeAt: addDays(beijingIso().slice(0, 10), -1) + 'T12:00:00+08:00' };
  await studyRepo.saveState(core.db, state);
  useStudy.setState({ s: { ...session, state, awayDays: 0 } });
  const r = await render('Study', StudyScreen, { bookId: SAMPLE_BOOK_ID, sectionId: '3.2' });
  expect(r.text()).toContain('距上次 ');
  expect(useStudy.getState().s?.awayDays).toBe(1);
  expect(r.text()).toContain('已恢复的回答');
});
