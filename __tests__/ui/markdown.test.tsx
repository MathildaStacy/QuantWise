import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { Markdown } from '../../src/ui/components/Markdown';

const sample =
  '# 投资判断\n\n**先核实**再决定仓位。\n\n### 判断依据\n\n1. 盈利\n   - 公告\n\n| 项目 | 建议 | 理由 |\n|---|---|---|\n| 一只名称非常长的证券 | 持有观察 | 比较财报中的经营现金流 |\n| ETF | 暂不追买 | 等待估值回归 |\n\n> 先控制集中度。\n> 再评估调整。\n\n```python\ntarget_weight = 0.10\n```\n\n[来源](source:0)';
let tree: ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
});
const text = () =>
  JSON.stringify(tree.toJSON(), (k, v) => (k === 'props' ? {} : v));

test('长回答保留分级标题、嵌套列表、引用、代码与可点击来源，表格列在各行对齐', async () => {
  const onLink = jest.fn();
  await act(async () => {
    tree = create(<Markdown text={sample} onLink={onLink} />);
  });
  expect(
    tree.root
      .findAllByType(Text)
      .filter(n => n.props.accessibilityRole === 'header'),
  ).toHaveLength(2);
  for (const t of [
    '投资判断',
    '公告',
    '一只名称非常长的证券',
    '比较财报中的经营现金流',
    'target_weight = 0.10',
    '再评估调整',
  ])
    expect(text()).toContain(t);
  const table = tree.root
    .findAllByType(ScrollView)
    .find(n => n.props.accessibilityLabel === '表格，可横向滚动')!;
  const rows = table.findAll(
    n =>
      n.type === View &&
      StyleSheet.flatten(n.props.style)?.flexDirection === 'row',
  );
  expect(rows).toHaveLength(3);
  const widths = rows.map(row =>
    row
      .findAll(
        n =>
          n.type === View &&
          typeof StyleSheet.flatten(n.props.style)?.width === 'number',
      )
      .map(n => StyleSheet.flatten(n.props.style).width),
  );
  expect(widths[0]).toHaveLength(3);
  expect(widths[1]).toEqual(widths[0]);
  expect(widths[2]).toEqual(widths[0]);
  expect(
    tree.root.findAllByType(ScrollView).filter(n => n.props.horizontal),
  ).toHaveLength(2);
  const citation = tree.root
    .findAllByType(Text)
    .find(n => n.props.accessibilityLabel === '来源 来源')!;
  await act(async () => citation.props.onPress());
  expect(onLink).toHaveBeenCalledWith('source:0');
});

test('流式增量形成新段落和表格时，已收到的中文和代码仍保留', async () => {
  await act(async () => {
    tree = create(
      <Markdown
        text={'## 判断\n\n先确认公告。\n\n| 项目 |'}
        onLink={jest.fn()}
      />,
    );
  });
  expect(text()).toContain('先确认公告');
  await act(async () =>
    tree.update(
      <Markdown
        text={
          '## 判断\n\n先确认公告。\n\n| 项目 | 建议 |\n|---|---|\n| 盈利 | 持有观察 |\n\n```\n完整代码\n```'
        }
        onLink={jest.fn()}
      />,
    ),
  );
  for (const t of ['先确认公告', '持有观察', '完整代码'])
    expect(text()).toContain(t);
  expect(
    tree.root
      .findAllByType(ScrollView)
      .some(n => n.props.accessibilityLabel === '表格，可横向滚动'),
  ).toBe(true);
});

test('讲解里的宽表第一列固定：行名不跟着横滑，两边同一行按较高的那边对齐（PM 走查第 1 项）', async () => {
  const wide = '| 指标 | 1 | 2 | 3 | 4 | 多空 |\n|---|---|---|---|---|---|\n| 月均收益 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 |\n| t 值 | 1.1 | 1.2 | 1.3 | 1.4 | 1.5 |';
  await act(async () => {
    tree = create(<Markdown text={wide} onLink={jest.fn()} />);
  });
  const words = (n: ReturnType<typeof tree.root.find>) =>
    n.findAll(x => typeof x.props.text === 'string').map(x => x.props.text as string);
  const scroller = tree.root
    .findAllByType(ScrollView)
    .find(n => n.props.accessibilityLabel === '表格，第一列固定，其余列可横向滚动')!;
  expect(words(scroller)).toEqual(expect.arrayContaining(['1', '多空', '0.5', '1.5']));
  for (const name of ['指标', '月均收益', 't 值']) {
    expect(words(scroller)).not.toContain(name);
    expect(words(tree.root)).toContain(name);
  }
  // 第一列是一组数（没有行名列）时不固定，整张表一起横滑
  const numeric = '| Low | 2 | 3 | 4 | High | 多空 |\n|---|---|---|---|---|---|\n| 1.19(1.60) | 1.32 | 1.47 | 1.50 | 1.14 | -0.04 |\n| 0.87(1.21) | 0.82 | 0.88 | 0.61 | 0.95 | 0.08 |';
  let plain!: ReturnType<typeof create>;
  await act(async () => {
    plain = create(<Markdown text={numeric} onLink={jest.fn()} />);
  });
  expect(plain.root.findAllByType(ScrollView).some(n => n.props.accessibilityLabel === '表格，第一列固定，其余列可横向滚动')).toBe(false);
  await act(async () => plain.unmount());
  // 只取原生节点（组件节点和原生节点 props 一样，会重复）
  const natural = () =>
    tree.root.findAll(
      n =>
        typeof n.type === 'string' &&
        typeof n.props.onLayout === 'function' &&
        StyleSheet.flatten(n.props.style)?.alignSelf === 'flex-start',
    );
  // 左边 3 行在前，右边 3 行在后：第 2 行左边排出 40 高，右边 66 高
  await act(async () => {
    natural()[1].props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 224, height: 40 } } });
    natural()[4].props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 1120, height: 66 } } });
  });
  const height = (i: number) => {
    let row = natural()[i].parent;
    while (row && !(typeof row.type === 'string' && StyleSheet.flatten(row.props.style)?.borderBottomColor)) row = row.parent;
    return StyleSheet.flatten(row!.props.style).height;
  };
  expect(height(1)).toBe(66 + StyleSheet.hairlineWidth);
  expect(height(4)).toBe(66 + StyleSheet.hairlineWidth);
  // 只量到一边的行先不定高
  expect(height(0)).toBeUndefined();
});
