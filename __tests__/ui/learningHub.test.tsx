import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as chat from '../../src/ai/chat';
import { useApp, type AppCore } from '../../src/app/boot';
import { setDocumentStore } from '../../src/app/exportFile';
import type { Spec } from '../../src/native/NativeDocumentStore';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import * as repo from '../../src/data/learningRepo';
import * as bookRepo from '../../src/data/bookRepo';
import { emptyResearch } from '../../src/learning/progress';
import { ensureSample } from '../../src/study/library';
import type { RootStackParamList } from '../../src/ui/navigation/types';
import {
  LearningHubView,
  LearningPlanScreen,
} from '../../src/ui/learning/HubScreen';
import {
  ConceptScreen,
  KnowledgeScreen,
} from '../../src/ui/learning/KnowledgeScreens';
import { QuantQuizScreen } from '../../src/ui/learning/QuizScreen';
import {
  ResearchEditScreen,
  ResearchNotesScreen,
} from '../../src/ui/learning/ResearchScreens';
import {
  LearningCoachScreen,
  LearningReportScreen,
} from '../../src/ui/learning/CoachReportScreens';

jest.mock('../../src/data/drivers/opSqlite', () => ({
  openDeviceDb: jest.fn(),
}));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));

const Stack = createNativeStackNavigator<RootStackParamList>();
let core: AppCore;
const trees: ReactTestRenderer.ReactTestRenderer[] = [];
const AiDestination = () => <Text>陪练对话已打开</Text>;
beforeEach(async () => {
  const db = openMemoryDb();
  await migrate(db);
  await ensureSample(db, new Date().toISOString());
  core = { db } as AppCore;
  useApp.setState({ core });
  chat.useChat.setState({ busy: null });
});
afterEach(async () => {
  await act(async () => trees.splice(0).forEach(t => t.unmount()));
  await core.db.close();
  setDocumentStore(undefined);
  jest.restoreAllMocks();
});

async function render<K extends keyof RootStackParamList>(
  name: K,
  params?: RootStackParamList[K],
) {
  const nav = createNavigationContainerRef<RootStackParamList>();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 800 },
          insets: { top: 0, bottom: 24, left: 0, right: 0 },
        }}
      >
        <NavigationContainer ref={nav}>
          <Stack.Navigator
            screenOptions={{ headerShown: false, animation: 'none' }}
          >
            <Stack.Screen name="Tabs" component={LearningHubView} />
            <Stack.Screen name="LearningPlan" component={LearningPlanScreen} />
            <Stack.Screen name="Knowledge" component={KnowledgeScreen} />
            <Stack.Screen name="Concept" component={ConceptScreen} />
            <Stack.Screen name="QuantQuiz" component={QuantQuizScreen} />
            <Stack.Screen
              name="ResearchNotes"
              component={ResearchNotesScreen}
            />
            <Stack.Screen name="ResearchEdit" component={ResearchEditScreen} />
            <Stack.Screen
              name="LearningCoach"
              component={LearningCoachScreen}
            />
            <Stack.Screen
              name="LearningReport"
              component={LearningReportScreen}
            />
            <Stack.Screen name="Ai" component={AiDestination} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  trees.push(tree);
  if (name !== 'Tabs') {
    await act(async () => {
      (nav.navigate as (n: string, p?: object) => void)(name, params as object);
    });
  }
  const screen = () => {
    const registry = {
      Tabs: LearningHubView,
      LearningPlan: LearningPlanScreen,
      Knowledge: KnowledgeScreen,
      Concept: ConceptScreen,
      QuantQuiz: QuantQuizScreen,
      ResearchNotes: ResearchNotesScreen,
      ResearchEdit: ResearchEditScreen,
      LearningCoach: LearningCoachScreen,
      LearningReport: LearningReportScreen,
      Ai: AiDestination,
    };
    const component =
      registry[nav.getCurrentRoute()!.name as keyof typeof registry];
    return tree.root.findAllByType(component).slice(-1)[0];
  };
  const text = () =>
    screen()
      .findAll(n => n.type === Text)
      .map(n => n.props.children)
      .flat(Infinity)
      .join(' ')
      .replace(/\s+/g, ' ');
  const button = (label: string) =>
    screen().findAll(
      n =>
        typeof n.props.onPress === 'function' &&
        (n.props.accessibilityLabel === label ||
          n.findAll(c => c.props.children === label).length > 0),
    )[0];
  const press = async (label: string) => {
    const b = button(label);
    if (!b) {
      throw new Error('找不到按钮：' + label);
    }
    await act(async () => {
      await b.props.onPress();
    });
  };
  const type = async (label: string, value: string) => {
    const input = screen().findAll(
      n =>
        n.props.accessibilityLabel === label &&
        typeof n.props.onChangeText === 'function',
    )[0];
    await act(async () => {
      input.props.onChangeText(value);
    });
  };
  return { tree, nav, text, button, press, type, screen };
}

test('研习入口能进入诊断，提交前无答案，错题持久化且不重复提交', async () => {
  const r = await render('Tabs');
  expect(r.text()).toContain('知识地图');
  await r.press('基础诊断');
  expect(r.text()).not.toContain('正确答案');
  await r.press('A. 0%');
  await r.press('提交答案');
  expect(r.text()).toContain('再看一下推导');
  expect(r.text()).toContain('正确答案');
  expect(await repo.loadAttempts(core.db)).toHaveLength(1);
  await r.press('下一题');
  expect(r.text()).not.toContain('正确答案');
  expect(r.text()).toContain('最大回撤');
});

test('答错到重新答对，错题清单清空且历史保留', async () => {
  await repo.recordAnswer(core.db, 'old', 'returns-1', 0);
  const r = await render('QuantQuiz', { mode: 'mistakes' });
  await r.press('B. −1%');
  await r.press('提交答案');
  await r.press('查看本轮结果');
  expect(r.text()).toContain('答对 1 / 1');
  await act(async () => r.nav.goBack());
  await r.press('错题再练');
  expect(r.text()).toContain('当前没有待练题目');
  expect(await repo.loadAttempts(core.db)).toHaveLength(2);
});

test('从概念页完成练习后，返回上一页回到原概念并显示最新进度', async () => {
  const r = await render('Concept', { id: 'returns' });
  await r.press('做两道练习');
  await r.press('B. −1%');
  await r.press('提交答案');
  await r.press('下一题');
  await r.press('C. (1+r₁)(1+r₂) − 1');
  await r.press('提交答案');
  await r.press('查看本轮结果');
  expect(r.text()).toContain('答对 2 / 2');
  expect(r.text()).not.toContain('返回研习');
  await r.press('返回上一页');
  expect(r.nav.getCurrentRoute()).toMatchObject({
    name: 'Concept',
    params: { id: 'returns' },
  });
  expect(r.text()).toContain('已通过 2 题');
});

test('搜索支持英文，收藏不把未测概念标成通过', async () => {
  const r = await render('Knowledge');
  await r.type('搜索概念', 'Sharpe');
  expect(r.text()).toContain('夏普比率');
  expect(r.text()).not.toContain('动量因子');
  await r.press('夏普比率');
  await r.press('收藏这个概念');
  expect((await repo.loadLearning(core.db)).saved).toEqual(['sharpe']);
  expect(r.text()).toContain('尚未测验');
});

test('计划保存后可重载，切目标不删除已做的练习', async () => {
  await repo.recordAnswer(core.db, 'r', 'returns-1', 1);
  const r = await render('LearningPlan');
  await r.press('建立研究习惯');
  await r.press('40 分钟');
  await r.press('3 天');
  await r.press('保存计划');
  expect(await repo.loadPlan(core.db)).toMatchObject({
    goal: 'research',
    minutes: 40,
    days: 3,
  });
  expect(await repo.loadAttempts(core.db)).toHaveLength(1);
  await act(async () => r.nav.goBack());
  expect(r.nav.getCurrentRoute()?.name).toBe('Tabs');
});

test('研究输入校验保留草稿；返回有未保存保护；保存后可重新打开', async () => {
  const r = await render('ResearchEdit', {});
  await r.type('标题', '我的动量研究');
  await r.press('保存研究手记');
  expect(r.text()).toContain('请填写标题和研究假设');
  expect(await repo.loadResearch(core.db)).toHaveLength(0);
  await r.type('研究假设', '20 日动量可预测下一周排名吗？');
  await act(async () => r.nav.goBack());
  expect(r.text()).toContain('有修改尚未保存');
  await r.press('继续编辑');
  await r.type('信息与交易时点', '收盘后计算，次日开盘执行');
  await r.press('保存研究手记');
  const notes = await repo.loadResearch(core.db);
  expect(notes).toHaveLength(1);
  expect(notes[0].checks.timing).toContain('次日开盘');
  await act(async () => r.nav.goBack());
  expect(r.nav.getCurrentRoute()?.name).toBe('Tabs');
  await r.press('研究手记');
  await r.press('我的动量研究');
  const input = r
    .screen()
    .findAll(
      n => n.props.accessibilityLabel === '研究假设' && n.props.onChangeText,
    )[0];
  expect(input.props.value).toContain('下一周排名');
});

test('数据库加载失败显示重试，而不显示虚假的空周报', async () => {
  jest.spyOn(repo, 'loadLearning').mockRejectedValue(new Error('磁盘不可用'));
  const r = await render('LearningReport');
  expect(r.text()).toContain('加载失败');
  expect(r.text()).not.toContain('本周还没有作答记录');
  expect(r.button('重新加载')).toBeTruthy();
});

test('只有一本书时，小节加载失败可重试同书且保留研究草稿', async () => {
  const books = await bookRepo.books(core.db);
  expect(books).toHaveLength(1);
  const sections = jest
    .spyOn(bookRepo, 'sections')
    .mockRejectedValueOnce(new Error('读取暂时失败'));
  const r = await render('ResearchEdit', {});
  await r.type('标题', '保留我的研究');
  await r.type('研究假设', '动量是否具有样本外预测能力？');
  await r.press('选择书籍与小节');
  await r.press(books[0].title);
  expect(r.text()).toMatch(/小节加载失败：\s*读取暂时失败/);
  await r.press('重新加载小节');
  expect(sections).toHaveBeenCalledTimes(2);
  expect(sections.mock.calls[1]).toEqual([core.db, books[0].id]);
  expect(r.text()).not.toContain('小节加载失败');
  await r.press('3.1 动量因子');
  await r.press('保存研究手记');
  expect(await repo.loadResearch(core.db)).toEqual([
    expect.objectContaining({
      title: '保留我的研究',
      hypothesis: '动量是否具有样本外预测能力？',
      source: expect.objectContaining({
        bookId: books[0].id,
        sectionId: '3.1',
      }),
    }),
  ]);
});

test('周报导出调用系统分享，文件带手记正文和正确率口径', async () => {
  await repo.saveResearch(core.db, {
    ...emptyResearch('ic'),
    title: '研究证据',
    hypothesis: 'IC 稳定吗',
    evidence: '观察值来自测试集',
  });
  const writeAndShare = jest.fn(async () => undefined);
  setDocumentStore({ writeAndShare } as unknown as Spec);
  const r = await render('LearningReport');
  await r.press('导出本周 Markdown');
  const [name, base64, mime] = writeAndShare.mock
    .calls[0] as unknown as string[];
  expect(name).toMatch(/学习周报.*\.md$/);
  expect(mime).toBe('text/plain');
  expect(Buffer.from(base64, 'base64').toString('utf8')).toContain(
    '观察值来自测试集',
  );
  expect(r.text()).not.toContain('已保存文件');
});

test('AI 陪练预览不请求模型，明确发送后只附本次材料', async () => {
  jest
    .spyOn(chat, 'activeService')
    .mockResolvedValue({ id: 's', name: '测试服务', model: 'test' } as Awaited<
      ReturnType<typeof chat.activeService>
    >);
  jest.spyOn(chat, 'aiKeys').mockReturnValue({
    get: async () => 'test',
    set: async () => undefined,
    remove: async () => undefined,
  });
  const ask = jest.spyOn(chat, 'ask').mockResolvedValue(undefined);
  const r = await render('LearningCoach', { conceptId: 'ic' });
  expect(ask).not.toHaveBeenCalled();
  expect(r.text()).toContain('信息系数');
  await r.type('发给 AI 的问题', '一次问一道题，请等我回答');
  await r.press('发送并开始陪练');
  expect(ask).toHaveBeenCalledTimes(1);
  expect(ask.mock.calls[0][1]).toMatchObject({
    question: '一次问一道题，请等我回答',
    page: null,
    attach: { label: '本次量化陪练材料' },
  });
  expect(ask.mock.calls[0][1].attach?.text).toContain('Rank IC');
  expect(r.nav.getCurrentRoute()?.name).toBe('Ai');
});

test('未配置模型时保留陪练问题并给出设置入口', async () => {
  jest.spyOn(chat, 'activeService').mockResolvedValue(null);
  const ask = jest.spyOn(chat, 'ask').mockResolvedValue(undefined);
  const r = await render('LearningCoach', { conceptId: 'returns' });
  await r.press('发送并开始陪练');
  expect(ask).not.toHaveBeenCalled();
  expect(r.text()).toContain('请先配置');
  expect(r.button('配置供应商与模型')).toBeTruthy();
});
