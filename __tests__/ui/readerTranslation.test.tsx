import { useState } from 'react';
import { ScrollView } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setAiDeps } from '../../src/ai/chat';
import type { FetchLike } from '../../src/ai/http';
import { saveServices } from '../../src/ai/services';
import { useApp, type AppCore } from '../../src/app/boot';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import * as translations from '../../src/data/translationRepo';
import { importMarkdownText } from '../../src/study/library';
import { openSection, useStudy, type StudySession } from '../../src/study/session';
import { translationUnits } from '../../src/study/translation';
import { StudyReader } from '../../src/ui/screens/StudyReader';
import { CiteSheet, ContextSheet } from '../../src/ui/screens/StudySheets';
import { StudyThread } from '../../src/ui/screens/StudyThread';
import type { StoredMessage } from '../../src/ai/types';
import { citeLabel } from '../../src/book/book';

jest.mock('../../src/data/drivers/opSqlite', () => ({ openDeviceDb: jest.fn() }));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));

let core: AppCore;
let session: StudySession;
let tree: ReactTestRenderer | undefined;
const fetcher = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
const now = '2026-11-03T12:00:00Z';

beforeEach(async () => {
  const db = openMemoryDb();
  await migrate(db);
  core = { db } as AppCore;
  useApp.setState({ core });
  const { bookId } = await importMarkdownText(db, '# 1 Returns\n\nReturns are uncertain.\n\nRisk changes over time.', 'reader-flow.md', 'reader-flow', now);
  await saveServices(db, [{ id: 'reader-model', name: '测试', protocol: 'anthropic', baseUrl: 'https://reader.example.com', model: 'test-model', effort: 'off', cache: 'off', auth: 'bearer', price: null, keyTail: 'test' }]);
  await openSection(core, bookId, undefined, 'read');
  session = useStudy.getState().s!;
  await translations.saveTranslation(db, bookId, session.blocks[0], {
    source: session.blocks[0].text, pairs: [{ source: session.blocks[0].text, translation: '收益具有不确定性。' }], providerId: 'reader-model', model: 'test-model', updatedAt: now,
  });
  fetcher.mockReset();
  setAiDeps({ keys: { get: async () => 'test-key', set: async () => {}, remove: async () => {} }, fetch: fetcher });
});

afterEach(async () => {
  await act(async () => { tree?.unmount(); });
  tree = undefined;
  jest.restoreAllMocks();
  await core.db.close();
});

function Reader({ focusSeq, translation }: { focusSeq?: number; translation?: boolean }) {
  const [bilingual, setBilingual] = useState(true);
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
    <StudyReader s={session} focusSeq={focusSeq} onQuick={() => {}} onFinish={() => {}} translation={translation ?? bilingual} onTranslation={setBilingual} />
  </SafeAreaProvider>;
}

async function render() { await act(async () => { tree = create(<Reader />); }); }
const text = () => JSON.stringify(tree!.toJSON());
async function press(label: string) {
  const button = tree!.root.findAll(n => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || n.findAll(c => c.props.children === label).length > 0))[0];
  if (!button) throw new Error('Missing ' + label);
  await act(async () => { await button.props.onPress(); });
}

test('部分译文有独立单段入口；切换分组不发请求，失败重试只补缺失段', async () => {
  await render();
  expect(text()).toContain('收益具有不确定性。');
  expect(text()).toContain('还剩 1 段待译，已译内容可离线阅读。');
  expect(text()).not.toContain('尚无译文');
  await press('对照方式：按段阅读');
  await press('逐句核对');
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRejectedValueOnce(new Error('测试断网'));
  await press('翻译此段');
  expect(text()).toContain('这一段翻译失败');
  expect(text()).toContain('收益具有不确定性。');
  const b = session.blocks[1];
  fetcher.mockResolvedValueOnce({ status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ translations: translationUnits(b).map(u => ({ id: u.id, text: '风险随时间变化。' })) }) }], stop_reason: 'end_turn', usage: {} }) });
  await press('重试本段');
  expect(text()).toContain('风险随时间变化。');
  expect(text()).not.toContain('这一段翻译失败');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([, options]) => String(options?.body).includes(b.seq + ':0'))).toBe(true);
  expect(Object.keys(await translations.loadTranslations(core.db, session.book.id, session.blocks))).toHaveLength(2);
});

test('中文为主：只显示译文，段旁「原文」展开英文；菜单里预览先写中文，已开着对照时不出「查看中文译文」（PM 走查第 6 项）', async () => {
  await render();
  await press('对照方式：按段阅读');
  await press('中文为主');
  expect(text()).toContain('"中文为主"');
  const first = session.blocks[0];
  // 译好的那段：正文是中文，原文收着；没译的那段照常显示原文
  const visible = () => tree!.root.findAll(n => typeof n.props.text === 'string').map(n => n.props.text as string);
  expect(visible()).toContain('收益具有不确定性。');
  expect(visible()).not.toContain(first.text);
  expect(visible()).toContain(session.blocks[1].text);
  await press('看这一段的原文');
  expect(visible()).toContain(first.text);
  await press('收起这一段的原文');
  expect(visible()).not.toContain(first.text);
  // 段落菜单：预览先写中文、下面小字附原文；对照已经开着，不再出「查看中文译文」
  const open = tree!.root.findAll(n => typeof n.props.onPress === 'function' && String(n.props.accessibilityLabel).startsWith(citeLabel(session.section, first) + '：'))[0];
  await act(async () => { open.props.onPress(); });
  const menu = visible();
  expect(menu.indexOf('收益具有不确定性。')).toBeLessThan(menu.lastIndexOf(first.text));
  expect(text()).not.toContain('查看中文译文');
  expect(fetcher).not.toHaveBeenCalled();
});

test('中文书的脚注不算待译：顶栏写「本节无需翻译」，不出「翻译本节」「翻译此段」（PM 走查第 4 项）', async () => {
  const { bookId } = await importMarkdownText(core.db, '# 3 动量\n\n动量效应在 A 股的表现和美国市场有明显不同，我们用 1997 年到 2019 年的数据检验了价格动量和盈利动量两种口径。\n\n[3]见Liu and Lee（2001）和Li et al.（2010）等研究。\n\n[4]参见Zhang（2004）和Dobrynskaya（2017）等。', 'zh-notes.md', 'zh-notes', now);
  await openSection(core, bookId, undefined, 'read');
  session = useStudy.getState().s!;
  await render();
  expect(text()).toContain('本节无需翻译');
  expect(text()).toContain('原文保留展示，中文内容无需重复翻译。');
  expect(text()).not.toContain('翻译本节');
  expect(text()).not.toContain('翻译此段');
  expect(text()).not.toContain('待译');
});

test('缓存读取失败时重试重新读本地译文，不发翻译请求', async () => {
  const read = jest.spyOn(translations, 'loadTranslations').mockRejectedValueOnce(new Error('临时读取失败'));
  await render();
  expect(text()).toContain('译文读取失败，请重试');
  expect(text()).toContain('译文暂未读取');
  expect(text()).not.toContain('尚无译文');
  expect(text()).not.toContain('定位待译');
  await press('重读译文');
  expect(read).toHaveBeenCalledTimes(2);
  expect(text()).toContain('收益具有不确定性。');
  expect(text()).not.toContain('译文读取失败，请重试');
  expect(fetcher).not.toHaveBeenCalled();
});

test('对照重排后跳到同节另一段，以新跳转为准', async () => {
  await render();
  const list = tree!.root.findAllByType(ScrollView).find(n => n.props.onScrollBeginDrag)!;
  const scrollTo = list.instance.scrollTo as jest.Mock;
  const first = session.blocks[0], second = session.blocks[1];
  const firstBox = list.findAll(n => n.props.onLayout && n.findAll(b => b.props.b?.seq === first.seq).length > 0)[0];
  const secondBox = list.findAll(n => n.props.onLayout && n.findAll(b => b.props.b?.seq === second.seq).length > 0)[0];
  await act(async () => {
    firstBox.props.onLayout({ nativeEvent: { layout: { x: 0, y: 100, width: 300, height: 600 } } });
    secondBox.props.onLayout({ nativeEvent: { layout: { x: 0, y: 800, width: 300, height: 600 } } });
    list.props.onContentSizeChange(360, 2000);
    list.props.onScrollBeginDrag();
    list.props.onScroll({ nativeEvent: { contentOffset: { y: 300 } } });
  });
  await press('对照方式：按段阅读');
  await press('逐句核对');
  scrollTo.mockClear();
  await act(async () => { tree!.update(<Reader focusSeq={second.seq} />); });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 760, animated: false });
});

test('原文页变短时保留目标位置，切回对照不采用被截短的程序滚动位置', async () => {
  await render();
  const list = tree!.root.findAllByType(ScrollView).find(n => n.props.onScrollBeginDrag)!;
  const scrollTo = list.instance.scrollTo as jest.Mock;
  const firstBox = list.findAll(n => n.props.onLayout && n.findAll(b => b.props.b?.seq === session.blocks[0].seq).length > 0)[0];
  const measure = (height: number) => firstBox.props.onLayout({ nativeEvent: { layout: { x: 0, y: 100, width: 300, height } } });
  await act(async () => {
    measure(600);
    list.props.onContentSizeChange(360, 2000);
    list.props.onScrollBeginDrag();
    list.props.onScroll({ nativeEvent: { contentOffset: { y: 300 } } });
  });
  await act(async () => { tree!.update(<Reader translation={false} />); });
  await act(async () => {
    measure(200);
    list.props.onScroll({ nativeEvent: { contentOffset: { y: 100 } } });
  });
  await act(async () => { tree!.update(<Reader translation />); });
  scrollTo.mockClear();
  await act(async () => { measure(600); });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 300, animated: false });
});

test('单段翻译失败后定位失败段，而不是更早的未译段', async () => {
  const failed = { ...session.blocks[1], seq: session.blocks[1].seq + 1, no: 3, text: 'Costs reduce returns.' };
  session = { ...session, blocks: [...session.blocks, failed] };
  await render();
  const list = tree!.root.findAllByType(ScrollView).find(n => n.props.onScrollBeginDrag)!;
  const scrollTo = list.instance.scrollTo as jest.Mock;
  await act(async () => {
    session.blocks.forEach((b, i) => {
      const box = list.findAll(n => n.props.onLayout && n.findAll(c => c.props.b?.seq === b.seq).length > 0)[0];
      box.props.onLayout({ nativeEvent: { layout: { x: 0, y: 100 + i * 700, width: 300, height: 600 } } });
    });
    list.props.onContentSizeChange(360, 2500);
  });
  fetcher.mockRejectedValueOnce(new Error('测试单段失败'));
  await press('翻译这一段，' + citeLabel(session.section, failed));
  expect(text()).toContain('定位失败');
  scrollTo.mockClear();
  await press('定位失败段落，已译 1/3 段');
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 1500, animated: false });
});

test('PDF 工具栏页码跟随当前原文块，导读放在独立面板', async () => {
  session = { ...session, book: { ...session.book, format: 'pdf', body: { ...session.book.body, dir: '/tmp/reader-test' } },
    section: { ...session.section, pageFrom: 10 }, blocks: session.blocks.map((b, i) => ({ ...b, page: 10 + i })) };
  await render();
  const page = () => tree!.root.findAll(n => n.props.accessibilityLabel === '查看 PDF 原页')[0].props.accessibilityValue.text;
  expect(page()).toBe('第 10 页');
  const list = tree!.root.findAllByType(ScrollView).find(n => n.props.onScrollBeginDrag)!;
  await act(async () => {
    session.blocks.forEach((b, i) => {
      const box = list.findAll(n => n.props.onLayout && n.findAll(c => c.props.b?.seq === b.seq).length > 0)[0];
      box.props.onLayout({ nativeEvent: { layout: { x: 0, y: 100 + i * 700, width: 300, height: 600 } } });
    });
    list.props.onContentSizeChange(360, 2000);
    list.props.onScrollBeginDrag();
    list.props.onScroll({ nativeEvent: { contentOffset: { y: 850 } } });
  });
  expect(page()).toBe('第 11 页');
  await press('本节导读');
  const guide = tree!.root.findAll(n => n.props.title === '本节导读' && n.props.visible === true)[0];
  expect(guide.findAllByType(ScrollView)).toHaveLength(1);
  expect(list.findAll(n => n.props.children === session.steps[0].title)).toHaveLength(0);
  expect(fetcher).not.toHaveBeenCalled();
});

test('引用预览先显示目标段，前后文按需展开且新引用重新收起', async () => {
  const onOpen = jest.fn();
  const target = { sectionId: session.section.id, no: session.blocks[1].no };
  const view = (no: number) => <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><CiteSheet s={session} target={{ ...target, no }} onClose={() => {}} onOpen={onOpen} /></SafeAreaProvider>;
  await act(async () => { tree = create(view(target.no)); });
  expect(text()).toContain(session.blocks[1].text);
  expect(text()).not.toContain(session.blocks[0].text);
  await press('查看前后文');
  expect(text()).toContain(session.blocks[0].text);
  await press('在读书模式打开');
  expect(onOpen).toHaveBeenCalledWith(target);
  await act(async () => { tree!.update(view(session.blocks[0].no)); });
  expect(text()).not.toContain(session.blocks[1].text);
  expect(text()).toContain('查看前后文');
  await act(async () => { tree!.update(view(999)); });
  expect(text()).not.toContain(session.blocks[0].text);
  expect(text()).toContain('这一块还没加载');
});

test('上下文默认使用小节名称，技术明细按需显示', async () => {
  const other = { ...session.section, id: 'internal-chapter-id', no: '2', title: 'Portfolio Risk' };
  const s = { ...session, sections: [...session.sections, other], loaded: new Set([...session.loaded, other.id]) };
  await act(async () => { tree = create(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ContextSheet s={s} visible onClose={() => {}} /></SafeAreaProvider>); });
  expect(text()).toContain('Portfolio Risk');
  expect(text()).not.toContain('internal-chapter-id');
  expect(text()).not.toContain('工具定义');
  await press('请求与用量明细');
  expect(text()).toContain('工具定义');
  expect(fetcher).not.toHaveBeenCalled();
});

test('工具成功记录默认收起，错误、讲解和检查题保持可见', async () => {
  const msg = (id: number, role: StoredMessage['role'], parts: StoredMessage['parts'], ui: StoredMessage['ui']): StoredMessage => ({ id, threadId: 1, role, parts, ui, raw: null, compacted: false, createdAt: now });
  const quiz = { id: 'quiz', name: 'ask_quiz', label: '生成检查题', quiz: { question: '风险会改变吗？', options: ['会', '不会'], answer: 0, explain: '风险会随时间变化。', picked: -1 } };
  const s = { ...session, messages: [msg(1, 'user', [], { question: '解释风险' }), msg(2, 'tool', [], { tools: [
    { id: 'loaded', name: 'load_section', label: '读取 Portfolio Risk 完成' },
    { id: 'error', name: 'plot_chart', label: '行情读取超时', error: true }, quiz,
  ] }), msg(3, 'assistant', [{ t: 'text', text: '风险会随时间变化。' }], null)] };
  const onDisclosure = jest.fn();
  await act(async () => { tree = create(<StudyThread s={s} busy={null} a={{ onLink() {}, onPick() {}, onWrapup() {}, onStuck() {}, onDisclosure }} />); });
  expect(text()).not.toContain('读取 Portfolio Risk 完成');
  expect(text()).toContain('行情读取超时');
  expect(text()).toContain('风险会随时间变化。');
  expect(text()).toContain('风险会改变吗？');
  await press('工具记录，2 项成功');
  expect(onDisclosure).toHaveBeenCalledTimes(1);
  expect(text()).toContain('读取 Portfolio Risk 完成');
  await press('工具记录，2 项成功');
  expect(text()).not.toContain('读取 Portfolio Risk 完成');
  expect(text()).toContain('行情读取超时');
});

test('因子检验说指数池数据没准备：最近那一问下面出「准备数据并重做这次检验」，不算真实行情', async () => {
  const msg = (id: number, role: StoredMessage['role'], parts: StoredMessage['parts'], ui: StoredMessage['ui']): StoredMessage => ({ id, threadId: 1, role, parts, ui, raw: null, compacted: false, createdAt: now });
  const pending = (id: string) => ({ id, name: 'factor_test', label: '12-1 月动量：数据还没准备', prepare: { pool: 'zz1000' as const, pending: true } });
  const s = { ...session, messages: [
    msg(1, 'user', [], { question: '在 A 股复现表 3.20' }), msg(2, 'tool', [], { tools: [pending('a')] }), msg(3, 'assistant', [{ t: 'text', text: '先准备数据。' }], null),
    msg(4, 'user', [], { question: '再试一次' }), msg(5, 'tool', [], { tools: [pending('b')] }), msg(6, 'assistant', [{ t: 'text', text: '还没准备。' }], null),
  ] };
  const onPrepare = jest.fn();
  await act(async () => { tree = create(<StudyThread s={s} busy={null} a={{ onLink() {}, onPick() {}, onWrapup() {}, onStuck() {}, onPrepare, prep: null }} />); });
  expect(text()).toContain('准备中证 1000 数据');
  expect(text()).toContain('约 16 分钟、80 MB 流量');
  expect(tree!.root.findAll(n => n.props.children === '准备数据并重做这次检验' && typeof n.type === 'string')).toHaveLength(1);
  await press('准备数据并重做这次检验');
  expect(onPrepare).toHaveBeenCalledWith('zz1000');
  const { realChecked, turnsOf } = require('../../src/ui/screens/StudyThread');
  expect([...realChecked(turnsOf(s.messages)).values()]).toEqual([false, false]);
  // 准备中：进度和停止
  await act(async () => { tree!.update(<StudyThread s={s} busy={null} a={{ onLink() {}, onPick() {}, onWrapup() {}, onStuck() {}, onPrepare, prep: { pool: 'zz1000', done: 120, total: 1000, running: true } }} />); });
  expect(text()).toContain('下载中…');
  expect(text()).toContain('停止');
});
