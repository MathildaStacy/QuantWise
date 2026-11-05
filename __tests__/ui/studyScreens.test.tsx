/// <reference types="node" />
/**
 * 读书伴学界面的冒烟测试：在内存库 + 示例教材 + 原型快照日线上把书架、地图、听讲（含图表卡片）、读书、
 * 本节小结、复习、笔记、因子实验室、全屏图、设置页都渲染一遍。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ReactTestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
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
import * as importer from '../../src/study/importer';
import { ImportBookScreen, MineruSettingsScreen, ParseProgressScreen, StudyPrefsScreen } from '../../src/ui/screens/ImportScreens';
import { LearnScreen } from '../../src/ui/screens/LearnScreens';
import { ReviewScreen, SectionDoneScreen } from '../../src/ui/screens/ReviewScreens';
import { StudyScreen } from '../../src/ui/screens/StudyScreen';
import { StudyIntroScreen } from '../../src/ui/screens/StudyIntroScreen';
import { loadReadingState } from '../../src/study/readingState';
import { beijingIso } from '../../src/market/clock';
import { addDays } from '../../src/book/review';
import { assemble } from '../../src/book/assemble';
import * as bookRepo from '../../src/data/bookRepo';
import { BlockInline } from '../../src/ui/components/BookBlock';
import { MathView } from '../../src/ui/math/MathView';
import { ShelfView } from '../../src/ui/screens/ShelfView';
import { ChartCard } from '../../src/ui/charts/ChartCard';
import { importMarkdownText } from '../../src/study/library';
import { loadTranslations } from '../../src/data/translationRepo';
import { secLabel } from '../../src/book/book';
import { translationUnits } from '../../src/study/translation';

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
    klineRange: async (code: string, _t: string, start: string, end: string) => barsOf(code).filter(k => k.date >= start && (!end || k.date <= end)),
  } as unknown as MarketClient;
  const sim = await Simulator.open(db, client, () => ({ date: '2026-10-26', t: T(14, 53) }));
  await sim.ingest(quotes);
  const refresher = { settings: { ...DEFAULT_REFRESH }, setExtraCodes() {}, kick() {} } as unknown as Refresher;
  core = { db, client, sim, refresher } as AppCore;
  useApp.setState({ core, version: 1 });
  await saveServices(db, [{ id: 's1', name: '测试', protocol: 'anthropic', baseUrl: 'https://x.example.com', model: 'claude-sonnet-5-5', effort: 'low', cache: 'auto', auth: 'bearer', price: null, keyTail: 'abcd' }]);
  setAiDeps({ keys: { get: async () => 'sk', set: async () => undefined, remove: async () => undefined }, fetch: fetchMock });
});

async function render<K extends keyof RootStackParamList>(name: K, component: React.ComponentType<any>, params?: RootStackParamList[K], extra: { name: keyof RootStackParamList; component: React.ComponentType<any> }[] = []) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name={name} component={component} initialParams={params as never} />
            {extra.map(x => <Stack.Screen key={x.name} name={x.name} component={x.component} />)}
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

test('Part 下没有自身正文的章仍在目录里，小节和附录入口保留', async () => {
  const now = '2026-11-02T12:00:00+08:00';
  const id = 'nested-reading-audit';
  await bookRepo.createBook(core.db, { id, title: '层级教材', author: '', format: 'pdf', source: 'import', sha256: id, pages: 10, status: 'parsing', error: null, body: {} }, now);
  await bookRepo.saveContent(core.db, id, assemble({ title: '层级教材', author: '', warnings: [], items: [
    { kind: 'heading', text: 'Part I Methods', level: 1, sectionLevel: 1 },
    { kind: 'heading', text: '第 1 章 无独立正文的章标题', level: 2, sectionLevel: 2 },
    { kind: 'heading', text: '1.1 可读小节', level: 3, sectionLevel: 3 },
    { kind: 'block', type: 'p', text: '章节正文。', page: 2 },
    { kind: 'heading', text: '附录 答案', level: 1, sectionLevel: 1 },
    { kind: 'block', type: 'p', text: '答案正文。', page: 9 },
  ] }), now);
  const r = await render('BookMap', BookMapScreen, { bookId: id });
  expect(r.text()).toContain('无独立正文的章标题');
  expect(r.text()).toContain('1.1 可读小节');
  expect(r.text()).toContain('附录 答案');
});

test('停在书架时解析完成，状态和入口刷新', async () => {
  const now = '2026-11-02T12:00:00+08:00', id = 'shelf-finish-audit';
  await bookRepo.createBook(core.db, { id, title: '后台完成教材', author: '', format: 'pdf', source: 'import', sha256: id, pages: 1, status: 'parsing', error: null, body: {} }, now);
  const r = await render('Tabs', ShelfView);
  expect(r.text()).toContain('解析中');
  await act(async () => {
    await bookRepo.saveContent(core.db, id, assemble({ title: '后台完成教材', author: '', warnings: [], items: [{ kind: 'block', type: 'p', text: '已完成正文。', page: 1 }] }), now);
    importer.useParse.setState({ [id]: { stage: '完成', done: 1, error: null } });
    await new Promise(resolve => setTimeout(resolve, 60));
  });
  expect(r.text()).not.toContain('解析中');
  expect(r.text()).toContain('0 / 1 节');
});

test('复杂行内公式交给数学渲染器，脚注标签不作为正文显示', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { tree = ReactTestRenderer.create(<BlockInline text={'约束 $\\begin{matrix}x&y\\end{matrix}$，说明<sup>[1]</sup>。'} />); });
  trees.push(tree);
  expect(tree.root.findByType(MathView).props.tex).toBe('\\begin{matrix}x&y\\end{matrix}');
  expect(JSON.stringify(tree.toJSON())).toContain('说明[1]');
  expect(JSON.stringify(tree.toJSON())).not.toContain('<sup>');
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
  expect(r.text()).not.toContain('考考我');
  await r.press('更多讲解方式');
  // 每个讲解方式下面一行小字写明这次会做什么；3.1 第 2 步讲的是公式和去掉最近 1 个月，画图标出那段
  expect(r.text()).toContain('出一道选择题，答完给解析');
  expect(r.text()).toContain('画一张真实行情图，标出讲到的那段，数字从日线现算');
  expect(r.text()).toContain('按书里的口径用因子检验跑一次，股票池跟书里的样本走');
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

test('相邻小节连续阅读保留中文对照，打开步骤面板不请求 AI', async () => {
  const stateBefore = useStudy.getState();
  const transport = jest.fn(async () => { throw new Error('此路径不应请求 AI'); });
  setAiDeps({ fetch: transport });
  try {
    const { bookId } = await importMarkdownText(core.db, '# 1 First\n\nRead this first.\n\n# 2 Second\n\nThen continue here.', 'sections.md', 'section-navigation', beijingIso());
    const sections = await bookRepo.sections(core.db, bookId);
    const [first, second] = sections.filter(x => x.leaf);
    const r = await render('Study', StudyScreen, { bookId, sectionId: first.id, mode: 'read' });
    await r.press('中文对照');
    await r.press('下一节：' + secLabel(second));
    expect(useStudy.getState().s?.section.id).toBe(second.id);
    expect((await loadReadingState(core.db, bookId, first.id)).translation).toBe(true);
    expect((await loadReadingState(core.db, bookId, second.id)).translation).toBe(true);
    await r.press('上一节：' + secLabel(first));
    expect(useStudy.getState().s?.section.id).toBe(first.id);
    await r.press('本书目录');
    expect(r.text()).toContain('共 2 个小节 · 当前 1/2');
    await r.type('搜索本书目录', 'second');
    expect(r.text()).toContain('找到 1 个小节');
    const row = r.tree.root.findAll(n => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === secLabel(second))[0];
    await act(async () => { row.props.onPress(); await new Promise(done => setTimeout(done, 60)); });
    expect(useStudy.getState().s?.section.id).toBe(second.id);
    expect((await loadReadingState(core.db, bookId, second.id)).translation).toBe(true);
    await r.press('上一节：' + secLabel(first));
    await r.press('AI 讲解');
    await r.press('本节讲解步骤');
    expect(r.text()).toContain('本节讲解步骤');
    expect(r.text()).toContain('当前步骤');
    expect(transport).not.toHaveBeenCalled();
  } finally { setAiDeps({ fetch: fetchMock }); await act(async () => { useStudy.setState(stateBefore); }); }
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

test('从原文发起讲解：对话保留引用片段，点开回到原文', async () => {
  const r = await render('Study', StudyScreen, { bookId: SAMPLE_BOOK_ID, sectionId: '3.1', mode: 'read' });
  const block = r.tree.root.findAll(n => typeof n.props.onPress === 'function' && String(n.props.accessibilityLabel).startsWith('3.1 ¶2：'))[0];
  await act(async () => { block.props.onPress(); });
  replies = [{ model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '这一段讲动量怎么算。' }], usage }];
  await r.press('解释这一段');
  expect(r.text()).toContain('这一段讲动量怎么算。');
  expect(r.text()).toContain('提问原文 · 3.1 ¶2');
  await r.press('查看提问原文 3.1 ¶2');
  expect(r.text()).toContain('原文 · 3.1 动量因子 ¶2');
});

test('段落菜单：只问其中一句；讲横截面结论的段落多一个「在 A 股复现这个结论」', async () => {
  const r = await render('Study', StudyScreen, { bookId: SAMPLE_BOOK_ID, sectionId: '2.1', mode: 'read' });
  const open = (label: string) => r.tree.root.findAll(n => typeof n.props.onPress === 'function' && String(n.props.accessibilityLabel).startsWith(label))[0];
  await act(async () => { open('2.1 ¶2：').props.onPress(); });
  expect(r.text()).toContain('只问其中一句（共 2 句）');
  expect(r.text()).toContain('在 A 股复现这个结论');
  await r.press('只问其中一句（共 2 句）');
  const sentence = r.tree.root.findAll(n => n.props.accessibilityRole === 'radio' && typeof n.props.onPress === 'function')[1];
  await act(async () => { sentence.props.onPress(); });
  expect(r.text()).toContain('解释这一句');
  expect(r.text()).not.toContain('从这里开始讲');
  replies = [{ model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '这一句说的是横截面。' }], usage }];
  await r.press('解释这一句');
  expect(r.text()).toContain('这一句说的是横截面。');
  expect(r.text()).toContain('解释这一句 · 2.1 ¶2');
  expect(r.text()).toContain('它不回答「大盘明天涨不涨」');
  const msg = useStudy.getState().s!.messages.find(m => m.role === 'user' && m.ui?.studySource);
  expect(msg?.ui?.studySource).toMatchObject({ sentence: true, no: 2 });
});

test('讲解里的因子检验图可以存进研究手记：草稿带书里的结论、口径和结果', async () => {
  const drafts: unknown[] = [];
  const Research = ({ route }: { route: { params: RootStackParamList['ResearchEdit'] } }) => { drafts.push(route.params.draft); return null; };
  const r = await render('Study', StudyScreen, { bookId: SAMPLE_BOOK_ID, sectionId: '3.1', mode: 'lecture' }, [{ name: 'ResearchEdit', component: Research }]);
  replies = [
    { model: 'm', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'ft1', name: 'factor_test', input: { factor: 'mom20', universe: 'sample' } }], usage },
    { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '[[real]]IC 不显著。[[/real]]' }], usage },
  ];
  await r.type('提问草稿', '动量在 A 股有效吗？');
  await r.press('发送');
  expect(r.text()).toContain('存进研究手记');
  await r.press('把这次检验存进研究手记');
  const params = { draft: drafts[drafts.length - 1] as { method: string; evidence: string } };
  expect(params.draft).toMatchObject({ title: '复现：20 日动量 · 3.1 动量因子', hypothesis: expect.stringContaining('动量在 A 股有效吗？') });
  expect(params.draft.method).toContain('示例池');
  expect(params.draft.evidence).toMatch(/Rank IC 均值 [+-]\d\.\d{3}（t [-\d.]+/);
});

test('发送后清空输入框；没问完的问题留在重试区，可改了再问', async () => {
  setAiDeps({ fetch: async () => { throw new Error('测试断网'); } });
  try {
    const r = await render('Study', StudyScreen, { bookId: SAMPLE_BOOK_ID, sectionId: '3.3', mode: 'lecture' });
    const input = () => r.tree.root.findAll(n => n.props.accessibilityLabel === '提问草稿' && typeof n.props.onChangeText === 'function')[0];
    await r.type('提问草稿', '低波动为什么反而收益高？');
    await r.press('发送');
    expect(input().props.value).toBe('');
    expect(r.text()).toContain('低波动为什么反而收益高？');
    expect(r.text()).toContain('重试上次的问题');
    await r.press('修改后再问');
    expect(input().props.value).toBe('低波动为什么反而收益高？');
    expect(r.text()).not.toContain('重试上次的问题');
    expect((await loadReadingState(core.db, SAMPLE_BOOK_ID, '3.3')).pending).toBeNull();
  } finally { setAiDeps({ fetch: fetchMock }); }
});

test('生成中状态固定在输入框上方，可直接停止，问题不丢', async () => {
  let stopped = false;
  setAiDeps({ fetch: (_url, init) => new Promise((_resolve, reject) => { init.signal?.addEventListener('abort', () => { stopped = true; reject(new Error('stop')); }); }) });
  try {
    const r = await render('Study', StudyScreen, { bookId: SAMPLE_BOOK_ID, sectionId: '3.4', mode: 'lecture' });
    await r.type('提问草稿', '换手率高说明什么？');
    await r.press('发送');
    expect(r.text()).toContain('停止讲解');
    expect(r.text()).not.toContain('更多讲解方式');
    await r.press('停止讲解');
    expect(stopped).toBe(true);
    expect(r.text()).not.toContain('停止讲解');
    expect(r.text()).toContain('换手率高说明什么？');
    expect(r.text()).toContain('重试上次的问题');
  } finally { setAiDeps({ fetch: fetchMock }); }
});

test('没调用过行情工具时「真实行情」标成未核对；画过图之后照常；图上「问这一天」带到输入框', async () => {
  const r = await render('Study', StudyScreen, { bookId: SAMPLE_BOOK_ID, sectionId: '2.1', mode: 'lecture' });
  replies = [{ model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '[[real]]茅台去年涨了 30%。[[/real]]' }], usage }];
  await r.type('提问草稿', '横截面是什么意思？');
  await r.press('发送');
  expect(r.text()).toContain('行情未核对');
  expect(r.text()).toContain('没有经过行情工具计算');
  replies = [
    { model: 'm', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'p21', name: 'plot_chart', input: { code: 'sz300750', focus: [{ from: '2026-09', to: '2026-09' }] } }], usage },
    { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '[[real]]图中黄色区间是 9 月。[[/real]]' }], usage },
  ];
  await r.type('提问草稿', '用宁德时代画一下');
  await r.press('发送');
  // 新的一问有工具数据撑着；之前那一问仍标未核对
  expect(r.text().split('没有经过行情工具计算').length - 1).toBe(1);
  expect(r.text()).toContain('图中黄色区间是 9 月。');
  const card = r.tree.root.findAll(n => n.type === ChartCard)[0];
  await act(async () => { card.props.onAsk('看图中这一天：宁德时代，2026-09-15 收盘 316.36。'); });
  const input = r.tree.root.findAll(n => n.props.accessibilityLabel === '提问草稿' && typeof n.props.onChangeText === 'function')[0];
  expect(input.props.value).toBe('看图中这一天：宁德时代，2026-09-15 收盘 316.36。');
  await r.type('提问草稿', input.props.value + '为什么这天跌这么多？');
  await act(async () => { card.props.onAsk('看图中这一天：宁德时代，2026-09-16 收盘 300.00。'); });
  expect(r.tree.root.findAll(n => n.props.accessibilityLabel === '提问草稿' && typeof n.props.onChangeText === 'function')[0].props.value)
    .toBe('看图中这一天：宁德时代，2026-09-16 收盘 300.00。为什么这天跌这么多？');
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


test('PDF 默认开启 OCR；主动关闭后切换模型不重置选择', async () => {
  const plan = jest.spyOn(importer, 'planPdf').mockResolvedValue({ pages: 2, size: 100, parts: [{ partNo: 1, pageFrom: 1, pageTo: 2 }], blocked: null });
  try {
    const r = await render('ImportBook', ImportBookScreen, { path: '/cache/book.pdf', name: 'book.pdf', size: 100 });
    const toggle = () => r.tree.root.findAll(n => n.props.accessibilityLabel === 'OCR 文字识别' && typeof n.props.onValueChange === 'function')[0];
    expect(toggle().props.value).toBe(true);
    expect(r.text()).toContain('推荐开启，减少公式、负号和变量的识别错误');
    await act(async () => { toggle().props.onValueChange(false); });
    await r.press('pipeline');
    expect(toggle().props.value).toBe(false);
    expect(r.text()).toContain('已关闭，文字层中的公式和符号可能遗漏');
  } finally {
    plan.mockRestore();
  }
});

test('解析进度区分等待上传、上传、云端确认、排队和生成结果，暂停时提供继续入口', async () => {
  const now = beijingIso(), id = 'parse-progress-recovery';
  await bookRepo.createBook(core.db, { id, title: '上传恢复测试', author: '', format: 'pdf', source: 'import', sha256: id, pages: 1000, status: 'parsing', error: null, body: {} }, now);
  const states: bookRepo.PartState[] = ['uploading', 'pending', 'uploaded', 'queued', 'converting'];
  for (const [i, state] of states.entries()) {
    await bookRepo.savePart(core.db, id, { partNo: i + 1, pageFrom: i * 200 + 1, pageTo: (i + 1) * 200, dataId: id + '-p' + (i + 1), batchId: 'batch', state, error: null, updatedAt: now });
  }
  const run = jest.spyOn(importer, 'runParse').mockResolvedValue();
  importer.useParse.setState({ [id]: { stage: '上传第 1 / 5 片', done: 0.1, error: null } });
  try {
    const r = await render('ParseProgress', ParseProgressScreen, { bookId: id });
    for (const label of ['上传第 1 / 5 片', '上传时请保持 App 在前台', '等待上传', '上传中', '已上传，等待云端确认', 'MinerU 排队中', '正在生成解析结果']) expect(r.text()).toContain(label);
    await act(async () => {
      importer.useParse.setState({ [id]: { stage: '已暂停', done: 0.1, error: 'MinerU 一直未确认收到文件，请检查网络后点「继续」补传' } });
    });
    expect(r.text()).toContain('上传未完成');
    expect(r.text()).not.toContain('上传中');
    expect(r.text()).toContain('未确认收到文件');
    await r.press('继续');
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(core, id);
  } finally {
    run.mockRestore();
  }
});

test('读书对照翻译：显式请求、错误重试、原文切换和离线缓存', async () => {
  const { bookId } = await importMarkdownText(core.db, '# 1 Returns\n\nReturns are uncertain. Diversify your portfolio.\n\nRisk changes over time.\n', 'translation-ui.md', 'translation-ui', beijingIso());
  const secs = await bookRepo.sections(core.db, bookId);
  const blocks = await bookRepo.sectionBlocks(core.db, bookId, secs[0].id);
  const response = (index: number) => ({ status: 200, text: async () => JSON.stringify({ model: 'test', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ translations: translationUnits(blocks[index]).map((u, i) => ({ id: u.id, text: index === 1 ? '风险随时间变化。' : i === 0 ? '收益具有不确定性。' : '分散投资组合。' })) }) }], usage }) });
  const fetcher = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>().mockResolvedValueOnce(response(0))
    .mockRejectedValueOnce(new Error('测试断网')).mockResolvedValueOnce(response(1));
  setAiDeps({ fetch: fetcher });
  try {
    const r = await render('Study', StudyScreen, { bookId, sectionId: secs[0].id, mode: 'read' });
    await r.press('中文对照');
    expect(fetcher).not.toHaveBeenCalled();
    expect(r.text()).toContain('翻译本节');
    await r.press('翻译本节');
    expect(fetcher).not.toHaveBeenCalled();
    expect(r.text()).toContain('待译 2 段');
    await r.press('开始翻译 2 段');
    expect(r.text()).toContain('收益具有不确定性。');
    expect(r.text()).toContain('测试断网');
    expect(r.text()).toContain('重试翻译');
    await r.press('重试翻译');
    expect(r.text()).toContain('风险随时间变化。');
    expect(r.text()).not.toContain('测试断网');
    const bilingualBlock = r.tree.root.findAll(n => typeof n.props.onPress === 'function' && n.props.accessibilityLabel?.includes('译文：收益具有不确定性。'))[0];
    expect(bilingualBlock.props.accessibilityLabel).toContain('原文：Diversify your portfolio.译文：分散投资组合。');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(useStudy.getState().s?.messages).toHaveLength(0);
    await r.press('原文');
    expect(r.text()).not.toContain('收益具有不确定性。');
    expect(r.text()).toContain('Returns are uncertain. Diversify your portfolio.');
    await r.press('中文对照');
    expect(r.text()).toContain('收益具有不确定性。');
    expect(fetcher).toHaveBeenCalledTimes(3);
    await act(async () => { r.tree.unmount(); });
    await core.db.get('SELECT 1');
    expect((await loadReadingState(core.db, bookId, secs[0].id)).translation).toBe(true);
    const reopened = await render('Study', StudyScreen, { bookId, sectionId: secs[0].id, mode: 'read' });
    expect(reopened.text()).toContain('风险随时间变化。');
    expect(fetcher).toHaveBeenCalledTimes(3);
  } finally { setAiDeps({ fetch: fetchMock }); }
});

test('关闭对照即停止：迟到响应不显示、不缓存，保留继续入口', async () => {
  const { bookId } = await importMarkdownText(core.db, '# 1 Stop\n\nRisk is uncertain.\n', 'translation-stop.md', 'translation-stop', beijingIso());
  const secs = await bookRepo.sections(core.db, bookId);
  let stopped = false;
  const fetcher: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => { stopped = true; reject(new Error('stop')); });
  });
  setAiDeps({ fetch: fetcher });
  try {
    const r = await render('Study', StudyScreen, { bookId, sectionId: secs[0].id, mode: 'read' });
    await r.press('中文对照');
    await r.press('翻译本节');
    await r.press('开始翻译 1 段');
    expect(r.text()).toContain('停止翻译');
    await r.press('原文');
    expect(stopped).toBe(true);
    await r.press('中文对照');
    expect(r.text()).toContain('已停止');
    expect(r.text()).toContain('翻译本节');
    expect(await loadTranslations(core.db, bookId, await bookRepo.sectionBlocks(core.db, bookId, secs[0].id))).toEqual({});
  } finally { setAiDeps({ fetch: fetchMock }); }
});

test('讲到某一段行情：图紧跟在调用的地方、讲解之前；黄色区间、前收、横轴日期、区间读数和看点；卡片和全屏都有区间最高最低', async () => {
  const r = await render('Study', StudyScreen, { bookId: SAMPLE_BOOK_ID, sectionId: '1.3' });
  replies = [
    { model: 'm', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tf', name: 'plot_chart', input: { code: 'sz300750', sub: 'dd', focus: [{ from: '2026-09', to: '2026-09' }], points: [{ date: '2026-09-15', label: '放量急跌' }], takeaway: '9 月一路走低，回撤加深' } }], usage },
    { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '[[real]]图中黄色区间是 9 月：从前收 363.55 跌到 291.11。[[/real]]' }], usage },
  ];
  await r.press('开始讲第 1 步');
  const page = r.text();
  expect(page).toContain('9 月一路走低，回撤加深');
  expect(page).toContain('9 月 · 9/1–9/30 · 21 个交易日');
  expect(page).toContain('-19.93%');
  expect(page).toContain('收盘 363.55（8/31）→ 291.11（9/30）');
  expect(page).toContain('区间最高收盘 358.10（9/1）· 最低 286.80（9/29）');
  expect(page).toContain('2026-07-27 至 10-26');
  // 图在讲这张图的文字之前
  expect(page.indexOf('宁德时代 · 回撤')).toBeGreaterThan(0);
  expect(page.indexOf('宁德时代 · 回撤')).toBeLessThan(page.indexOf('图中黄色区间是 9 月'));
  // 量出宽度后画 SVG：区间标签、前收、横轴上的区间起止日、标注事件、副图名字
  // （测试里系统字号是 2 倍，标注日 9/15 在横轴上挤不下，让给区间起止日；事件名照样写在图上）
  const plot = r.tree.root.findAll(n => n.props.accessibilityRole === 'image' && typeof n.props.onLayout === 'function')[0];
  expect(plot.props.accessibilityLabel).toContain('重点区间 9 月 -19.93%');
  await act(async () => { plot.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 268 } } }); });
  const svg = r.text();
  for (const t of ['前收 363.55', '291.11', '"9/1"', '"9/30"', '放量急跌', '"回撤"', '239.52']) {
    expect(svg).toContain(t);
  }
  const chart = r.tree.root.findAll(n => n.props.data?.kind === 'price')[0].props.data;
  const full = await render('ChartFull', ChartFullScreen, { chart });
  expect(full.text()).toContain('区间最高收盘 358.10（9/1）· 最低 286.80（9/29）');
  expect(full.text()).toContain('区间最后一天收盘 ÷ 区间前一个交易日收盘 − 1');
});

test('图文同屏：小图占位不盖住回答，滚回图卡或收起后不钉', async () => {
  const r = await render('Study', StudyScreen, { bookId: SAMPLE_BOOK_ID, sectionId: '1.4' });
  replies = [
    { model: 'm', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tp', name: 'plot_chart', input: { code: 'sz300750', focus: [{ from: '2026-09', to: '2026-09' }] } }], usage },
    { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '[[real]]图中黄色区间是 9 月。[[/real]]' }], usage },
  ];
  await r.press('开始讲第 1 步');
  const pinned = () => r.tree.root.findAll(n => n.props.accessibilityLabel === '收起钉住的图').length > 0;
  expect(pinned()).toBe(false);
  // 量出各层位置：对话顶部在内容里 y = 200；这一问 0–1400；图卡在这一问里 y = 90，画线区域在卡片里 y = 60、高 274
  const handlers = (n: ReactTestInstance) => [...new Set(n.findAll(x => typeof x.props.onLayout === 'function').map(x => x.props.onLayout as (e: unknown) => void))];
  const up = (n: ReactTestInstance) => {
    let p = n.parent;
    while (p && (typeof p.props.onLayout !== 'function' || p.props.onLayout === n.props.onLayout)) {
      p = p.parent;
    }
    return p!;
  };
  const layout = async (f: (e: unknown) => void, y: number, height: number) => act(async () => f({ nativeEvent: { layout: { x: 0, y, width: 368, height } } }));
  const card = r.tree.root.findAll(n => n.props.data?.kind === 'price' && typeof n.props.onBox === 'function')[0];
  const turn = up(card);
  const thread = up(turn);
  const [cardBox, plotBox] = handlers(card);
  const scroller = r.tree.root.findAll(n => typeof n.props.onMomentumScrollEnd === 'function')[0];
  await layout(scroller.props.onLayout, 0, 380);
  await layout(thread.props.onLayout, 200, 1400);
  await layout(turn.props.onLayout, 0, 1400);
  await layout(cardBox, 90, 520);
  await layout(plotBox, 60, 274);
  const scrollTo = async (y: number) => act(async () => scroller.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y }, layoutMeasurement: { width: 368, height: 380 }, contentSize: { width: 368, height: 1700 } } }));
  // 画线区域还露出一半：不钉
  await scrollTo(200 + 150 + 120);
  expect(pinned()).toBe(false);
  // 滚过六成：钉住，标题行写名字和区间涨跌；步骤栏对读屏隐藏
  await scrollTo(200 + 150 + 200);
  expect(pinned()).toBe(true);
  const page = r.text();
  expect(page).toContain('宁德时代');
  expect(page).toContain(' 9 月 ');
  expect(page).toContain('-19.93% ');
  expect(r.tree.root.findAll(n => n.props.importantForAccessibility === 'no-hide-descendants').length).toBeGreaterThan(0);
  // 滚回图卡：不钉
  await scrollTo(200);
  expect(pinned()).toBe(false);
  // 读到这一问的末尾（这一问只占视窗上面不到三成）：不钉
  await scrollTo(200 + 1400 - 100);
  expect(pinned()).toBe(false);
  // 收起之后，这一问再滚过去也不钉
  await scrollTo(200 + 150 + 200);
  expect(pinned()).toBe(true);
  await r.press('收起钉住的图');
  expect(pinned()).toBe(false);
  await scrollTo(200 + 150 + 260);
  expect(pinned()).toBe(false);
  // 下一问没画图、讲的是前面那张图（模型直接引用前面的数）：读这一问时钉前面那张
  replies = [{ model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '[[real]]宁德时代 9 月的跌幅里，前半段跌得最急。[[/real]]' }], usage }];
  await r.type('提问草稿', '9 月前半段呢？');
  await r.press('发送');
  const slots = r.tree.root.findAll(n => typeof n.props.report === 'function' && typeof n.props.id === 'number');
  const ids = [...new Set(slots.map(n => n.props.id as number))].sort((a, b) => a - b);
  expect(ids).toHaveLength(2);
  await act(async () => {
    slots[0].props.report(ids[0], { y: 0, height: 1400 });
    slots[0].props.report(ids[1], { y: 1400, height: 600 });
  });
  await scrollTo(200 + 1400 + 50);
  expect(pinned()).toBe(true);
  expect(r.text()).toContain('-19.93% ');
  await r.press('收起钉住的图');
  expect(pinned()).toBe(false);
});
