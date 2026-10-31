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
  const text = () => JSON.stringify(tree.toJSON());
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
  return { tree, text, press };
}

test('学习 Tab 默认是读书：继续学习、书架；能切到路线', async () => {
  const r = await render('Tabs', LearnScreen);
  expect(r.text()).toContain('继续学习');
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
  await r.press('读书');
  expect(r.text()).toContain('读完这一节');
  expect(r.text()).toContain('¶5');
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
