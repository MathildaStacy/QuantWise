/**
 * 宽表（PM 走查第 1 项）：书页里表比屏幕宽时行名列固定在左边、只横滑数据列；全屏看表时表头和行名都固定，可以切横屏。
 */
import { ScrollView, StyleSheet } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { tableText } from '../../src/study/import/mineruAdapter';
import { BookTable, TableScreen } from '../../src/ui/components/BookTable';

jest.mock('../../src/native/NativeScreenOrientation', () => ({ __esModule: true, default: { set: jest.fn() } }));
const orientation = require('../../src/native/NativeScreenOrientation').default as { set: jest.Mock };

const html = '<table><tr><th>组</th><th>1</th><th>2</th><th>3</th><th>多空</th></tr>' +
  '<tr><td colspan="5">Panel A：等权</td></tr>' +
  '<tr><td>动量最低组</td><td>0.11</td><td>0.12</td><td>0.13</td><td>0.14</td></tr>' +
  '<tr><td>动量最高组</td><td>0.21</td><td>0.22</td><td>0.23</td><td>0.24</td></tr></table>';
// 旧导入把表题、网格文字和表注存在一起
const text = '表3.19 动量分组的描述性统计\n' + tableText(html) + '\n来源：作者计算';

let tree: ReactTestRenderer;
afterEach(async () => { await act(async () => { tree?.unmount(); }); orientation.set.mockClear(); });

const words = (n: ReactTestInstance) => n.findAll(x => typeof x.props.text === 'string').map(x => x.props.text as string);
const layout = async (n: ReactTestInstance, width: number) => {
  await act(async () => { n.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 400 } } }); });
};

test('书页里的宽表：行名和整行小标题不在横滑区域里，数据列在', async () => {
  await act(async () => { tree = create(<BookTable text={text} html={html} />); });
  // 卡片宽 720（测试环境字号放大到 2 倍，相当于正常字号下一张 360 宽的卡片）
  await layout(tree.root.findAll(n => typeof n.props.onLayout === 'function' && StyleSheet.flatten(n.props.style)?.gap === 12)[0], 720);
  const scroller = tree.root.findAllByType(ScrollView).find(n => n.props.horizontal)!;
  expect(words(scroller)).toEqual(expect.arrayContaining(['0.11', '0.24', '多空']));
  expect(words(scroller)).not.toContain('动量最低组');
  expect(words(scroller)).not.toContain('Panel A：等权');
  expect(words(tree.root)).toEqual(expect.arrayContaining(['动量最低组', '动量最高组', 'Panel A：等权', '表3.19 动量分组的描述性统计', '来源：作者计算']));
  // 整行小标题铺满可见宽度（不是整张表的宽度）
  const panel = tree.root.findAll(n => n.props.style && n.findAll(x => x.props.text === 'Panel A：等权').length > 0 && StyleSheet.flatten(n.props.style)?.position === 'absolute')[0];
  expect(StyleSheet.flatten(panel.props.style).width).toBe(720);
  // 数据列 912 宽，可见 492：提示可以左右滑、行名固定
  await act(async () => {
    scroller.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 492, height: 272 } } });
    scroller.props.onContentSizeChange(912, 272);
  });
  expect(JSON.stringify(tree.toJSON())).toContain('向左滑动查看完整表格，行名固定在左边');
});

test('放得下的表不冻结；段落菜单里的小表只列前几行', async () => {
  await act(async () => { tree = create(<BookTable text={'| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |'} html={null} />); });
  await layout(tree.root.findAll(n => typeof n.props.onLayout === 'function' && StyleSheet.flatten(n.props.style)?.gap === 12)[0], 720);
  expect(words(tree.root.findAllByType(ScrollView)[0])).toEqual(['A', 'B', 'C', '1', '2', '3']);
  const rows = Array.from({ length: 10 }, (_, i) => '| ' + i + ' | x | y |').join('\n');
  await act(async () => { tree.update(<BookTable text={'| 组 | x | y |\n|---|---|---|\n' + rows} html={null} preview />); });
  expect(words(tree.root)).toContain('4');
  expect(words(tree.root)).not.toContain('5');
  expect(JSON.stringify(tree.toJSON())).toContain('共 11 行，这里只列前 6 行');
});

test('全屏看表：表头和行名固定，数据可以上下左右滑；横屏按钮切方向，关掉交回系统', async () => {
  const onClose = jest.fn();
  await act(async () => {
    tree = create(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <TableScreen title="表 3.19 动量分组的描述性统计" text={text} html={html} onClose={onClose} />
    </SafeAreaProvider>);
  });
  await layout(tree.root.findAll(n => typeof n.props.onLayout === 'function' && StyleSheet.flatten(n.props.style)?.marginHorizontal === 12)[0], 720);
  const body = tree.root.findAllByType(ScrollView).find(n => n.props.accessibilityLabel === '表格，可上下左右滑动')!;
  expect(words(body)).toEqual(expect.arrayContaining(['0.11', '0.24']));
  // 表头那一行（组、1、2、3、多空）和行名都在滚动区域外
  for (const fixed of ['组', '多空', '动量最低组', 'Panel A：等权']) expect(words(body)).not.toContain(fixed);
  expect(words(tree.root)).toEqual(expect.arrayContaining(['组', '多空', '动量最低组', 'Panel A：等权']));
  const press = async (label: string) => {
    const b = tree.root.findAll(n => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === label)[0];
    await act(async () => { b.props.onPress(); });
  };
  await press('横屏看表');
  expect(orientation.set).toHaveBeenLastCalledWith('landscape');
  await press('关闭全屏表格');
  expect(orientation.set).toHaveBeenLastCalledWith('auto');
  expect(onClose).toHaveBeenCalled();
});
