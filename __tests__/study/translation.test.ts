import { setAiDeps, useChat } from '../../src/ai/chat';
import type { FetchLike } from '../../src/ai/http';
import { loadProviders, saveProviders, saveServices } from '../../src/ai/services';
import type { AiService, Protocol } from '../../src/ai/types';
import type { AppCore } from '../../src/app/boot';
import type { BookBlock, BookSection } from '../../src/book/types';
import { createBook, deleteBook, saveContent } from '../../src/data/bookRepo';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate, migrations } from '../../src/data/migrations';
import { loadTranslations, saveTranslation } from '../../src/data/translationRepo';
import * as repo from '../../src/data/repos';
import { STUDY_LAST_CONFIG_KEY } from '../../src/study/config';
import { TRANSLATION_PROMPT, translateBlocks } from '../../src/study/translate';
import { canTranslate, chineseSection, isNote, parseTranslations, sectionTargets, splitTranslationSource, translationBatches, translationUnits } from '../../src/study/translation';

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

test('中文段落中的外文术语不重复整段翻译，外文正文和日文仍可翻译', () => {
  const chinese = '一种定义趋势的方法是用移动平均线交叉（moving average crossover）来判断，即用一个短周期指标和一个长周期指标进行比较。当短周期指标在长周期指标下方，则可以认为市场将会开始出现下跌趋势。';
  expect(canTranslate(block(chinese))).toBe(false);
  expect(canTranslate(block('A股的 IC 和 IR 分别用于衡量预测能力及其稳定性。'))).toBe(false);
  expect(canTranslate(block('协方差矩阵（covariance matrix）'))).toBe(false);
  expect(canTranslate(block('The model estimates 收益 from historical observations.'))).toBe(true);
  expect(canTranslate(block('日本語の投資戦略を説明します。'))).toBe(true);
  expect(canTranslate(block('Diversification reduces portfolio risk.'))).toBe(true);
  expect(canTranslate(block('(Figure: Returns)'))).toBe(true);
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

test('脚注、参考文献和以中文为主的一节不算待译；外文正文照常（PM 走查第 4 项）', () => {
  // 《因子投资》3.5.3 节末的三条脚注：作者名的字母比中文多
  const notes = ['[3]见Liu and Lee（2001）和Li et al.（2010）等研究。', '[4]参见Zhang（2004）和Dobrynskaya（2017）等。', '[6]更多相关研究见Frazzini（2006）和Bhootra and Hur（2012）。'];
  const zh = [block('动量效应在 A 股的表现和美国市场有明显不同，我们用 1997 年到 2019 年的数据检验了价格动量和盈利动量两种口径。', 0), ...notes.map((t, i) => block(t, i + 1))];
  expect(notes.map(t => isNote(block(t)))).toEqual([true, true, true]);
  expect(chineseSection(zh)).toBe(true);
  expect(sectionTargets(section, zh)).toEqual([]);
  // 英文书：脚注不算，正文照常；^1、上标、圈码也认作脚注
  const en = [block('Momentum strategies earn abnormal returns over 3 to 12 months.', 0), block('1 See Jegadeesh and Titman (1993).', 1), block('^2 Data from CRSP.', 2), block('² Data from CRSP.', 3), block('① Data from CRSP.', 4)];
  expect(chineseSection(en)).toBe(false);
  expect(sectionTargets(section, en).map(b => b.seq)).toEqual([0, 1]);
  // 参考文献一节整节不译
  expect(sectionTargets({ title: 'References' }, en)).toEqual([]);
  expect(sectionTargets({ title: '7 参考文献' }, en)).toEqual([]);
  // 日文不算中文
  expect(chineseSection([block('日本語の投資戦略を説明します。', 0)])).toBe(false);
});

test('翻译请求附上这一段命中的术语：沿用本书以前的译法，本节第一次出现时写「中文（English）」（PM 走查第 5 项）', async () => {
  const blocks = [block('I call this problem meta-labeling.', 0), block('Meta-labeling is useful when the primary model has high recall.', 1)];
  const core = await setup();
  await saveContent(core.db, book.id, {
    title: book.title, author: '', warnings: [],
    sections: [{ ...section, blockTo: 1 }, { ...section, id: '0', ord: -1, no: '0', title: 'Preface', blockFrom: 2, blockTo: 2 }],
    blocks: [...blocks, { ...block('Meta-labeling, again.', 2), sectionId: '0' }],
  }, now);
  const earlier = { ...block('Meta-labeling, again.', 2), sectionId: '0' };
  await saveTranslation(core.db, book.id, earlier, { source: earlier.text, pairs: [{ source: earlier.text, translation: '又是元标注，元标注。' }], providerId: service.id, model: 'test-model', updatedAt: now });
  const reply = (b: BookBlock, text: string) => ({ status: 200, text: async () => JSON.stringify(envelope(JSON.stringify({ translations: translationUnits(b).map(u => ({ id: u.id, text })) }), 'anthropic')) });
  const fetchMock = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
    .mockResolvedValueOnce(reply(blocks[0], '我把这个问题称为元标注（meta-labeling）。'))
    .mockResolvedValueOnce(reply(blocks[1], '主模型召回率高时，元标注很有用。'));
  setAiDeps({ fetch: fetchMock });
  await translateBlocks(core, book, section, blocks, {}, new AbortController().signal, jest.fn(), jest.fn());
  const sent = (i: number) => {
    const body = JSON.parse(fetchMock.mock.calls[i][1].body as string);
    const content = body.messages[body.messages.length - 1].content;
    return JSON.parse(typeof content === 'string' ? content : content.map((p: { text: string }) => p.text).join(''));
  };
  // 本书以前译成「元标注」：沿用；第一段是本节第一次出现
  expect(sent(0).terms).toEqual([{ en: 'meta-labeling', zh: '元标注', first: true }]);
  // 第二段：元标签本节前面已经写过，不再加括号；主模型是第一次出现；recall 是日常词，不自动对译
  expect(sent(1).terms).toEqual([{ en: 'Meta-labeling', zh: '元标注', first: false }, { en: 'primary model', zh: '主模型', first: true }]);
  expect(TRANSLATION_PROMPT).toContain('「元标签（meta-labeling）」');
  await core.db.close();
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
  // 这一段没有命中术语：请求里不带 terms
  expect(JSON.stringify(body.messages)).not.toContain('terms');
  useChat.setState({ config: null });
  await core.db.close();
});
