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
  expect(text()).toContain('尚无译文');
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

test('缓存读取失败时重试重新读本地译文，不发翻译请求', async () => {
  const read = jest.spyOn(translations, 'loadTranslations').mockRejectedValueOnce(new Error('临时读取失败'));
  await render();
  expect(text()).toContain('译文读取失败，请重试');
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
