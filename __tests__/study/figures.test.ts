import { setAiDeps } from '../../src/ai/chat';
import { saveServices } from '../../src/ai/services';
import type { AiService, Protocol } from '../../src/ai/types';
import type { AppCore } from '../../src/app/boot';
import type { Book, BookBlock, BookSection } from '../../src/book/types';
import { figureSegments, parseFigure } from '../../src/book/figure';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { canRedraw, loadFigure, type FigureIo } from '../../src/study/figures';
import { redrawFigure } from '../../src/study/redrawFigure';
import { figureRequest } from '../../src/study/figureRequest';

jest.mock('../../src/data/drivers/opSqlite', () => ({ openDeviceDb: jest.fn() }));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));

const chart = { kind: 'chart', chartType: 'line', title: '指数', description: '指数与均线', notes: [], annotations: [], xLabel: '日期', yLabel: '点', yMin: 600, yMax: 1800, yScale: 'linear',
  xTicks: [{ at: 0, label: '2007' }, { at: 1, label: '2008' }], series: [{ name: '指数', style: 'solid', points: [[0, 1500], [0.5, null], [1, 900]] }] };
const block: BookBlock = { seq: 12, no: 2, sectionId: '3', type: 'img', text: '图 3', image: 'part1/images/figure.jpg', html: null, page: 45, mark: null };
const book = { id: 'book-1', title: '真实扫描书', body: { dir: '/book' } } as Book;
const section = { id: '3', title: '趋势' } as BookSection;
const service: AiService = { id: 'figure-provider', name: '测试', protocol: 'openai', baseUrl: 'https://figure.example.com', model: 'vision-model', effort: 'off', cache: 'off', auth: 'bearer', price: null, keyTail: 'test' };
const envelope = (text: string, protocol: Protocol) => protocol === 'anthropic'
  ? { model: 'vision-model', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: {} }
  : protocol === 'chat' ? { model: 'vision-model', choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: {} }
  : { model: 'vision-model', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], usage: {} };

function memoryIo() {
  const files = new Map<string, string>([['/book/' + block.image, 'original-image']]);
  const io: FigureIo = {
    exists: async p => files.has(p), read: async p => files.get(p)!, write: async (p, text) => { files.set(p, text); },
    hash: async p => 'hash:' + files.get(p), size: async p => files.get(p)!.length, mkdir: async () => {},
  };
  return { files, io };
}

test('图像数据保留空缺与原轴范围；未知结构、越界值和虚构节点不能进入渲染', () => {
  expect(parseFigure(JSON.stringify(chart))).toEqual(chart);
  expect(figureSegments([[0, 1500], [0.5, null], [1, 900]])).toEqual([[[0, 1500]], [[1, 900]]]);
  for (const v of [{ ...chart, yMin: 1800 }, { ...chart, yMin: 0, yScale: 'log' },
    { ...chart, series: [{ ...chart.series[0], points: [[0, 900], [1, 2000]] }] },
    { ...chart, xTicks: [...chart.xTicks].reverse() }, { kind: 'svg', code: '<svg />' },
    { kind: 'table', title: '', description: '表', notes: [], rows: [['a', 'b'], ['c']] },
    { kind: 'diagram', title: '', description: '图', notes: [], nodes: [{ id: 'a', label: '节点', x: 0, y: 0, width: 0.3, height: 0.2 }], edges: [{ from: 'a', to: 'missing', label: '' }] }]) {
    expect(() => parseFigure(JSON.stringify(v))).toThrow('识别结果');
  }
  expect(parseFigure('{"kind":"unsupported","reason":"图例无法辨认"}')).toEqual({ kind: 'unsupported', reason: '图例无法辨认' });
  expect(canRedraw(block)).toBe(true);
  for (const image of ['source-pages/p45.png', '../private.png', 'https://example.com/a.jpg']) expect(canRedraw({ ...block, image })).toBe(false);
});

test.each<Protocol>(['openai', 'chat', 'anthropic'])('%s 图片协议、生成缓存与离线复用，不改原书或讲解', async protocol => {
  const core = { db: openMemoryDb() } as AppCore;
  const { io, files } = memoryIo();
  try {
    await migrate(core.db); await saveServices(core.db, [{ ...service, protocol }]);
    const fetch = jest.fn(async () => ({ status: 200, text: async () => JSON.stringify(envelope(JSON.stringify(chart), protocol)) }));
    setAiDeps({ keys: { get: async () => 'test-key', set: async () => {}, remove: async () => {} }, fetch });
    const req = figureRequest({ ...service, protocol }, { base64: 'picture', mime: 'image/jpeg' }, 'caption');
    expect(JSON.stringify(req.body)).toContain(protocol === 'anthropic' ? 'media_type' : protocol === 'chat' ? 'image_url' : 'input_image');
    expect(JSON.stringify(req.body)).not.toContain('web_search');
    const result = await redrawFigure(core, book, section, block, [block], new AbortController().signal, io);
    expect(result.figure).toEqual(chart);
    expect(await loadFigure(book, block, io)).toEqual(result);
    expect(await redrawFigure(core, book, section, block, [block], new AbortController().signal, io)).toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(files.get('/book/' + block.image)).toBe('original-image');
    expect(await core.db.all('SELECT * FROM ai_thread')).toEqual([]);
    expect(await core.db.all('SELECT * FROM study_state')).toEqual([]);
    expect(await loadFigure(book, { ...block, text: '新图注' }, io)).toBeNull();
    files.set('/book/' + block.image, 'updated-image');
    expect(await loadFigure(book, block, io)).toBeNull();
    files.delete('/book/' + block.image);
    expect(await loadFigure(book, block, io)).toBeNull();
  } finally { await core.db.close(); }
});

test('取消后的迟到响应和非法图不会覆盖现有缓存；缺模型可恢复配置', async () => {
  const core = { db: openMemoryDb() } as AppCore;
  const { io, files } = memoryIo();
  try {
    await migrate(core.db);
    await expect(redrawFigure(core, book, section, block, [block], new AbortController().signal, io)).rejects.toMatchObject({ code: 'auth' });
    await saveServices(core.db, [service]);
    const ctl = new AbortController();
    setAiDeps({ keys: { get: async () => 'test-key', set: async () => {}, remove: async () => {} }, fetch: async () => {
      ctl.abort(); return { status: 200, text: async () => JSON.stringify(envelope(JSON.stringify(chart), 'openai')) };
    } });
    await expect(redrawFigure(core, book, section, block, [block], ctl.signal, io)).rejects.toMatchObject({ code: 'cancelled' });
    expect(files.has('/book/redrawn/12.json')).toBe(false);
    setAiDeps({ fetch: async () => ({ status: 200, text: async () => JSON.stringify(envelope('{"kind":"chart"}', 'openai')) }) });
    await expect(redrawFigure(core, book, section, block, [block], new AbortController().signal, io)).rejects.toThrow('识别结果');
    expect(files.has('/book/redrawn/12.json')).toBe(false);
  } finally { await core.db.close(); }
});
