import { setAiDeps, useChat } from '../../src/ai/chat';
import type { FetchLike } from '../../src/ai/http';
import { loadProviders, saveProviders, saveServices } from '../../src/ai/services';
import type { AiService, Protocol } from '../../src/ai/types';
import type { AppCore } from '../../src/app/boot';
import type { BookBlock, BookSection } from '../../src/book/types';
import { createBook, deleteBook, saveContent } from '../../src/data/bookRepo';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate, migrations } from '../../src/data/migrations';
import { loadTranslations } from '../../src/data/translationRepo';
import * as repo from '../../src/data/repos';
import { STUDY_LAST_CONFIG_KEY } from '../../src/study/config';
import { translateBlocks } from '../../src/study/translate';
import { canTranslate, parseTranslations, splitTranslationSource, translationBatches, translationUnits } from '../../src/study/translation';

jest.mock('../../src/data/drivers/opSqlite', () => ({ openDeviceDb: jest.fn() }));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));

const block = (text: string, seq = 0, type: BookBlock['type'] = 'p'): BookBlock => ({ seq, no: seq + 1, sectionId: '1', text, type, page: null, mark: null, image: null, html: null });
const section: BookSection = { id: '1', parentId: null, ord: 0, level: 1, no: '1', title: 'Returns', leaf: true, blockFrom: 0, blockTo: 3, pageFrom: null, pageTo: null, chars: 100 };
const book = { id: 'translation-book', title: 'Finance' };
const now = '2026-11-02T12:00:00Z';
const service: AiService = { id: 'translation-provider', name: '测试模型', protocol: 'anthropic', baseUrl: 'https://translation.example.com', model: 'test-model', effort: 'off', cache: 'auto', auth: 'bearer', price: null, keyTail: 'test' };
const fixture = [block('Returns are uncertain. Diversify your portfolio.'), block('Use $r_t = 0.05$ to measure returns.', 1), block('这是一段纯中文。', 2), block('x^2', 3, 'eq')];
const payload = (b: BookBlock) => JSON.stringify({ translations: translationUnits(b).map(u => ({ id: u.id, text: u.source.includes('$') ? '使用 $r_t = 0.05$ 衡量收益。' : u.id.endsWith(':0') ? '收益具有不确定性。' : '分散投资组合。' })) });
const envelope = (text: string, protocol: Protocol) => protocol === 'anthropic' ?
  { model: 'test-model', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: {} } : protocol === 'chat' ?
  { model: 'test-model', choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: {} } :
  { model: 'test-model', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], usage: {} };

async function setup(protocol: Protocol = 'anthropic') {
  const db = openMemoryDb();
  await migrate(db);
  await createBook(db, { ...book, author: '', format: 'md', source: 'import', sha256: 'fixture', pages: null, status: 'ready', error: null, body: {} }, now);
  await saveContent(db, book.id, { title: book.title, author: '', sections: [section], blocks: fixture, warnings: [] }, now);
  await saveServices(db, [{ ...service, protocol }]);
  setAiDeps({ keys: { get: async () => 'test-key', set: async () => {}, remove: async () => {} } });
  return { db } as AppCore;
}

test('本地切句不丢字符；小数、缩写、引用和行内数学不拆开', () => {
  const source = 'Dr. Smith used Eq. 2.1, e.g. $x = 1.5$. "It works!"\nNext is \\(a. b\\). 中文。';
  const pieces = splitTranslationSource(source);
  expect(pieces.join('')).toBe(source);
  expect(pieces.map(p => p.trim())).toEqual(['Dr. Smith used Eq. 2.1, e.g. $x = 1.5$.', '"It works!"', 'Next is \\(a. b\\).', '中文。']);
  const long = 'A word without punctuation '.repeat(500);
  const units = translationUnits(block(long));
  expect(units.map(u => u.source).join('')).toBe(long);
  expect(translationBatches(units).length).toBeGreaterThan(3);
  expect(translationBatches(units).every(batch => batch.length <= 12 && batch.reduce((n, u) => n + u.source.length, 0) <= 2400)).toBe(true);
});

test('跳过中文、独立公式、代码、表格和原页截图，保留外文正文/列表/图注', () => {
  expect(fixture.map(canTranslate)).toEqual([true, true, false, false]);
  expect(canTranslate(block('这是 $MOM$。'))).toBe(false);
  expect(canTranslate(block('English', 0, 'table'))).toBe(false);
  expect(canTranslate(block('English', 0, 'code'))).toBe(false);
  expect(canTranslate(block('Risk', 0, 'li'))).toBe(true);
  expect(canTranslate(block('Figure: Returns', 0, 'img'))).toBe(true);
  expect(canTranslate({ ...block('Source page', 0, 'img'), image: 'source-pages/1.png' })).toBe(false);
});

test('按本地 ID 对齐乱序回复；拒绝缺句、重复、未知 ID、空译文和公式改写', () => {
  const units = translationUnits(fixture[0]);
  const rows = [{ id: '0:1', text: '分散投资。' }, { id: '0:0', text: '收益不确定。' }];
  expect(parseTranslations('```json\n' + JSON.stringify({ translations: rows }) + '\n```', units)).toEqual([
    { source: units[0].source, translation: '收益不确定。' }, { source: units[1].source, translation: '分散投资。' },
  ]);
  for (const translations of [rows.slice(1), [rows[0], rows[0]], [rows[0], { id: 'x', text: '错句' }], [rows[0], { id: '0:0', text: '' }]]) {
    expect(() => parseTranslations(JSON.stringify({ translations }), units)).toThrow('不匹配');
  }
  expect(() => parseTranslations('not JSON', units)).toThrow('不匹配');
  expect(() => parseTranslations('{"translations":[{"id":"1:0","text":"收益 0.05。"}]}', translationUnits(fixture[1]))).toThrow('公式');
});

test.each<Protocol>(['anthropic', 'openai', 'chat'])('%s：翻译存库、离线复用；不创建讲解对话或调用工具', async protocol => {
  const core = await setup(protocol);
  const fetchMock = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
  for (const b of fixture.slice(0, 2)) fetchMock.mockResolvedValueOnce({ status: 200, text: async () => JSON.stringify(envelope(payload(b), protocol)) });
  setAiDeps({ fetch: fetchMock });
  const onBlock = jest.fn();
  await translateBlocks(core, book, section, fixture, {}, new AbortController().signal, onBlock, jest.fn());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(JSON.stringify(sent)).not.toContain('web_search');
  expect(sent.tools ?? []).toEqual([]);
  const cached = await loadTranslations(core.db, book.id, fixture);
  expect(Object.keys(cached)).toEqual(['0', '1']);
  expect(cached[0].pairs[1].translation).toBe('分散投资组合。');
  await translateBlocks(core, book, section, fixture, cached, new AbortController().signal, onBlock, jest.fn());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await core.db.all('SELECT * FROM ai_thread')).toEqual([]);
  expect(await core.db.all('SELECT * FROM study_state')).toEqual([]);
  expect(await loadTranslations(core.db, 'other-book', fixture)).toEqual({});
  expect(await loadTranslations(core.db, book.id, [block('Updated source')])).toEqual({});
  await deleteBook(core.db, book.id);
  expect(await core.db.all('SELECT * FROM book_translation')).toEqual([]);
  await core.db.close();
});

test('普通数字、负号、小数、百分比必须保留；允许调整数字出现的语序', () => {
  const units = translationUnits(block('The monthly return is -0.05 with a 5% fee on 1,000 units.'));
  const response = (text: string) => JSON.stringify({ translations: [{ id: '0:0', text }] });
  expect(parseTranslations(response('1,000 单位的费用为 5%，月收益为 −0.05。'), units)[0].translation).toContain('−0.05');
  for (const text of ['月收益为 0.05，1,000 单位的费用为 5%。', '月收益为 -0.50，1,000 单位的费用为 5%。', '月收益为 -0.05，1,000 单位的费用为 5。']) {
    expect(() => parseTranslations(response(text), units)).toThrow('数字');
  }
  expect(() => parseTranslations(response('月收益率为 0.50。'), translationUnits(block('The monthly return is 0.05.')))).toThrow('数字');
  expect(() => parseTranslations(response('收益为 05。'), translationUnits(block('The return is .05.')))).toThrow('数字');
  expect(() => parseTranslations(response('收益为 5%。'), translationUnits(block('Compare 5% with 5%.')))).toThrow('数字');
  expect(() => parseTranslations(response('收益为 5%，持续 2 个月。'), translationUnits(block('The return is 5%.')))).toThrow('数字');
});

test('中途失败保留已完成段落；重试只请求缺失内容', async () => {
  const core = await setup();
  const fetchMock = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
    .mockResolvedValueOnce({ status: 200, text: async () => JSON.stringify(envelope(payload(fixture[0]), 'anthropic')) })
    .mockRejectedValueOnce(new Error('断网'))
    .mockResolvedValueOnce({ status: 200, text: async () => JSON.stringify(envelope(payload(fixture[1]), 'anthropic')) });
  setAiDeps({ fetch: fetchMock });
  await expect(translateBlocks(core, book, section, fixture, {}, new AbortController().signal, jest.fn(), jest.fn())).rejects.toThrow('断网');
  const cached = await loadTranslations(core.db, book.id, fixture);
  expect(Object.keys(cached)).toEqual(['0']);
  await translateBlocks(core, book, section, fixture, cached, new AbortController().signal, jest.fn(), jest.fn());
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(Object.keys(await loadTranslations(core.db, book.id, fixture))).toEqual(['0', '1']);
  await core.db.close();
});

test('停止后迟到的成功响应不会落盘，完整的上一段仍保留', async () => {
  const core = await setup();
  const ctl = new AbortController();
  let count = 0;
  setAiDeps({ fetch: async () => {
    const index = count++;
    if (index === 1) ctl.abort();
    return { status: 200, text: async () => JSON.stringify(envelope(payload(fixture[index]), 'anthropic')) };
  } });
  const onBlock = jest.fn();
  await expect(translateBlocks(core, book, section, fixture, {}, ctl.signal, onBlock, jest.fn())).rejects.toThrow('已停止');
  expect(onBlock).toHaveBeenCalledTimes(1);
  expect(Object.keys(await loadTranslations(core.db, book.id, fixture))).toEqual(['0']);
  await core.db.close();
});

test('没有 Key 可恢复配置；非法译文不会被缓存', async () => {
  const core = await setup();
  setAiDeps({ keys: { get: async () => null, set: async () => {}, remove: async () => {} } });
  await expect(translateBlocks(core, book, section, fixture, {}, new AbortController().signal, jest.fn(), jest.fn())).rejects.toThrow('API Key');
  setAiDeps({ keys: { get: async () => 'test', set: async () => {}, remove: async () => {} }, fetch: async () => ({ status: 200, text: async () => JSON.stringify(envelope('{"translations":[]}', 'anthropic')) }) });
  await expect(translateBlocks(core, book, section, fixture, {}, new AbortController().signal, jest.fn(), jest.fn())).rejects.toThrow('不匹配');
  expect(await loadTranslations(core.db, book.id, fixture)).toEqual({});
  await core.db.close();
});

test('v1.1 数据库无损升级：旧表保留，新增译文外键', async () => {
  const db = openMemoryDb();
  for (const sql of migrations.slice(0, 8).flat()) await db.run(sql);
  await db.run('PRAGMA user_version = 8');
  expect(await migrate(db)).toEqual({ from: 8, to: 11 });
  expect((await db.all("SELECT * FROM pragma_foreign_key_list('book_translation')"))).toHaveLength(2);
  await db.close();
});

test('翻译用这一节讲解的模型，不跟 AI 助手当前打开的对话走；不发缓存和思考参数', async () => {
  const core = await setup();
  const ps = await loadProviders(core.db);
  await saveProviders(core.db, ps.map(p => ({ ...p, models: [...p.models, { id: 'lecture-model', enabled: true, price: null }] })));
  await repo.setSetting(core.db, STUDY_LAST_CONFIG_KEY, { providerId: service.id, model: 'lecture-model', effort: 'off', search: false });
  useChat.setState({ config: { providerId: service.id, model: 'test-model', effort: 'off', search: true } });
  const fetchMock = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
  for (const b of fixture.slice(0, 2)) fetchMock.mockResolvedValueOnce({ status: 200, text: async () => JSON.stringify(envelope(payload(b), 'anthropic')) });
  setAiDeps({ fetch: fetchMock });
  await translateBlocks(core, book, section, fixture, {}, new AbortController().signal, jest.fn(), jest.fn());
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.model).toBe('lecture-model');
  expect(JSON.stringify(body)).not.toContain('cache_control');
  expect(body.tools ?? []).toEqual([]);
  useChat.setState({ config: null });
  await core.db.close();
});
