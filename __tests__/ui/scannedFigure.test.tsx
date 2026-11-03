import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { Circle, Path } from 'react-native-svg';
import type { Book, BookBlock } from '../../src/book/types';
import type { FigureChart } from '../../src/book/figure';
import { loadFigure, type SavedFigure } from '../../src/study/figures';
import { ReaderFigures, ScannedFigure } from '../../src/ui/components/ScannedFigure';
import { BookImage } from '../../src/ui/components/BookImage';
import { BookFigureView } from '../../src/ui/components/BookFigureView';

jest.mock('../../src/study/figures', () => ({ canRedraw: () => true, loadFigure: jest.fn() }));

const b: BookBlock = { seq: 174, no: 5, sectionId: '3', type: 'img', text: '指数走势', page: 45, image: 'part1/figure.jpg', html: null, mark: null };
const f: FigureChart = { kind: 'chart', chartType: 'line', title: b.text, description: '扫描图中的趋势', notes: ['按图估读'], annotations: [],
  xLabel: '日期', yLabel: '指数', yMin: 600, yMax: 1800, yScale: 'linear', xTicks: [{ at: 0, label: '2007' }, { at: 1, label: '2008' }],
  series: [{ name: '指数', style: 'solid', points: [[0, 1500], [0.5, null], [1, 900]] }] };
const saved: SavedFigure = { version: 1, image: b.image!, imageHash: 'hash', caption: b.text, model: 'vision', updatedAt: '2026-11-03', figure: f };
const redraw = jest.fn<Promise<SavedFigure>, [BookBlock, AbortSignal]>();
const reader = { book: { id: 'b', body: { dir: '/book' } } as Book, blocks: [b], active: true, redraw };
const texts = (tree: ReactTestRenderer) => tree.root.findAllByType(Text).map(n => n.props.children).filter(x => typeof x === 'string');
async function press(tree: ReactTestRenderer, label: string) {
  const button = tree.root.findAll(n => typeof n.props.onPress === 'function' && n.findAll(c => c.props.children === label).length > 0)[0];
  expect(button).toBeDefined();
  await act(async () => { button!.props.onPress({ stopPropagation: jest.fn() }); });
}

test('缓存默认显示矢量图，可核对原图、放大和查看数据，不重复调用模型', async () => {
  jest.mocked(loadFigure).mockResolvedValue(saved);
  redraw.mockClear();
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(<ReaderFigures.Provider value={reader}><ScannedFigure b={b} uri="file:///book/figure.jpg" compact={false} /></ReaderFigures.Provider>); });
    expect(tree.root.findAllByType(BookFigureView)).toHaveLength(1);
    expect(tree.root.findAllByType(BookImage)).toHaveLength(0);
    expect(texts(tree)).toContain('AI 近似重绘 · 读图估值');
    // An unreadable span must remain a gap, with both isolated observations still visible.
    expect(tree.root.findAllByType(Circle)).toHaveLength(2);
    expect(tree.root.findAllByType(Path)).toHaveLength(0);
    await press(tree, '对照原图');
    expect(tree.root.findAllByType(BookImage)).toHaveLength(1);
    await press(tree, '查看重绘');
    await press(tree, '放大图表');
    expect(texts(tree)).toContain('收起放大');
    await press(tree, '查看估读数据');
    expect(texts(tree)).toContain('收起估读数据');
    expect(redraw).not.toHaveBeenCalled();
  } finally { await act(async () => { tree.unmount(); }); }
});

test('通过图片下按钮生成；失焦停止请求，迟到结果不替换原图', async () => {
  jest.mocked(loadFigure).mockResolvedValue(null);
  let resolve!: (value: SavedFigure) => void;
  redraw.mockImplementation(() => new Promise(done => { resolve = done; }));
  let tree!: ReactTestRenderer;
  const render = (active: boolean) => <ReaderFigures.Provider value={{ ...reader, active }}><ScannedFigure b={b} uri="file:///book/figure.jpg" compact={false} /></ReaderFigures.Provider>;
  try {
    await act(async () => { tree = create(render(true)); });
    await press(tree, 'AI 清晰重绘');
    expect(texts(tree)).toContain('停止识别');
    const signal = redraw.mock.calls.at(-1)![1];
    await act(async () => { tree.update(render(false)); });
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(saved); });
    expect(tree.root.findAllByType(BookFigureView)).toHaveLength(0);
  } finally { await act(async () => { tree.unmount(); }); }
});
