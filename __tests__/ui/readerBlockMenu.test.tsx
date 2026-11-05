/**
 * 段落菜单按块类型给（PM 走查第 1、2 项）：表、图、代码各有自己的动作，菜单标题写「表 3.21」「图 3.22」「Snippet 3.6」，
 * 表格预览是一张小表，「全屏看表」打开固定表头和行名的全屏表。
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useApp, type AppCore } from '../../src/app/boot';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { importMarkdownText } from '../../src/study/library';
import { openSection, quickAsk, useStudy, type StudySession } from '../../src/study/session';
import { TableScreen } from '../../src/ui/components/BookTable';
import { StudyReader } from '../../src/ui/screens/StudyReader';
import { citeLabel } from '../../src/book/book';

jest.mock('../../src/data/drivers/opSqlite', () => ({ openDeviceDb: jest.fn() }));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));

const BOOK = [
  '# 3 动量',
  '## 3.5 双重排序',
  '表3.21 动量和市值独立双重排序月均收益率（%）',
  '| 市值组 | 低动量 | 高动量 | 多空 |\n|---|---|---|---|\n| 小 | 0.8 | 1.2 | 0.4 |\n| 大 | 0.5 | 0.6 | 0.1 |',
  '![图3.22 动量因子的覆盖率](fig.png)',
  'SNIPPET 3.6 Expanding getBins to incorporate meta-labeling',
  '```python\ndef getBins(events, close):\n    return out\n```',
].join('\n\n');

let core: AppCore;
let session: StudySession;
let tree: ReactTestRenderer | undefined;
const onQuick = jest.fn();

beforeEach(async () => {
  const db = openMemoryDb();
  await migrate(db);
  core = { db } as AppCore;
  useApp.setState({ core });
  const { bookId } = await importMarkdownText(db, BOOK, 'blocks.md', 'reader-blocks', '2026-11-05T10:00:00+08:00');
  await openSection(core, bookId, '3.5', 'read');
  session = useStudy.getState().s!;
  onQuick.mockReset();
});

afterEach(async () => {
  await act(async () => { tree?.unmount(); });
  tree = undefined;
  await core.db.close();
});

async function render() {
  await act(async () => {
    tree = create(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <StudyReader s={session} onQuick={onQuick} onFinish={() => {}} />
    </SafeAreaProvider>);
  });
}
const text = () => JSON.stringify(tree!.toJSON());
async function press(label: string) {
  const button = tree!.root.findAll(n => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || n.findAll(c => c.props.children === label).length > 0))[0];
  if (!button) throw new Error('Missing ' + label);
  await act(async () => { await button.props.onPress(); });
}
const block = (type: string) => session.blocks.find(b => b.type === type)!;

test('表：标题写表号，预览是小表；解释、在 A 股复现这张表、全屏看表，没有「解释这一段」', async () => {
  await render();
  await press('表 3.21 图表操作');
  const menu = text();
  expect(menu).toContain('"表 3.21"');
  expect(menu).toContain('动量和市值独立双重排序月均收益率（%）');
  // 预览是表格的格子，不是一串竖线
  expect(tree!.root.findAll(n => n.props.text === '高动量').length).toBeGreaterThan(0);
  expect(menu).not.toContain('| 市值组');
  for (const item of ['解释这张表', '在 A 股复现这张表', '全屏看表', '从这里开始讲']) expect(menu).toContain('"' + item + '"');
  for (const item of ['解释这一段', '用真实行情举例']) expect(menu).not.toContain(item);
  await press('在 A 股复现这张表');
  expect(onQuick).toHaveBeenLastCalledWith('replicateBlock', block('table'), undefined);
  await press('表 3.21 图表操作');
  await press('全屏看表');
  const full = tree!.root.findByType(TableScreen);
  expect(full.props.title).toBe('表 3.21 动量和市值独立双重排序月均收益率（%）');
});

test('图和代码：各自的动作，标题写图号、Snippet 号', async () => {
  await render();
  await press('图 3.22 图表操作');
  let menu = text();
  expect(menu).toContain('"图 3.22"');
  for (const item of ['解释这张图', '用 A 股数据画同类图']) expect(menu).toContain('"' + item + '"');
  expect(menu).not.toContain('解释这一段');
  const code = block('code');
  const open = tree!.root.findAll(n => typeof n.props.onPress === 'function' && String(n.props.accessibilityLabel).startsWith(citeLabel(session.section, code) + '：'))[0];
  await act(async () => { open.props.onPress(); });
  menu = text();
  expect(menu).toContain('"Snippet 3.6"');
  for (const item of ['逐行讲解', '这段代码的输入输出', '在真实日线上跑一遍']) expect(menu).toContain('"' + item + '"');
  expect(menu).not.toContain('解释这一段');
  await press('这段代码的输入输出');
  expect(onQuick).toHaveBeenLastCalledWith('ioBlock', code, undefined);
});

test('发给模型的问题和对话里的按钮写编号；复现表格时把这张表的块号交给 factor_test', () => {
  const table = block('table');
  const explain = quickAsk(session, 'explainBlock', table);
  expect(explain.label).toBe('解释 表 3.21');
  expect(explain.question).toContain('[3.5#2]（表 3.21，3.5 ¶2）');
  expect(explain.question).toContain('（动量和市值独立双重排序月均收益率（%））');
  expect(explain.question).not.toContain('| 市值组');
  expect(explain.source?.label).toBe('表 3.21');
  const rep = quickAsk(session, 'replicateBlock', table);
  expect(rep.label).toBe('在 A 股复现 表 3.21');
  expect(rep.question).toContain('book_table 填 3.5#2');
  const lines = quickAsk(session, 'linesBlock', block('code'));
  expect(lines.label).toBe('逐行讲解 Snippet 3.6');
  expect(lines.pinSeq).toBe(block('code').seq);
  expect(quickAsk(session, 'ioBlock', block('code')).label).toBe('Snippet 3.6 的输入输出');
  const fig = quickAsk(session, 'realBlock', block('img'));
  expect(fig.label).toBe('用 A 股数据画同类图 · 图 3.22');
  // 图注讲因子但不是分组结果（覆盖率）：交给模型按图注在因子检验和行情图之间选
  expect(fig.question).toContain('factor_test');
  expect(fig.question).toContain('plot_chart');
  expect(fig.question).not.toContain('书里画的是行情');
});
