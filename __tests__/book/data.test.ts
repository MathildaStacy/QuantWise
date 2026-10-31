/**
 * 数据层（迁移 0008）：示例教材入库、小节和块、全文搜索、伴读记录、伴读对话不进 AI 助手的列表、前复权日线。
 */
import * as aiRepo from '../../src/data/aiRepo';
import * as bookRepo from '../../src/data/bookRepo';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate, SCHEMA_VERSION } from '../../src/data/migrations';
import * as quantRepo from '../../src/data/quantRepo';
import * as studyRepo from '../../src/data/studyRepo';
import { SAMPLE_BOOK_ID } from '../../src/book/sample';
import { ensureSample, importMarkdownText, loadShelf } from '../../src/study/library';

const NOW = '2026-11-01T10:00:00+08:00';

async function db() {
  const d = openMemoryDb();
  await migrate(d);
  return d;
}

describe('书和伴读记录', () => {
  it('迁移到第 8 版，示例教材只写一次', async () => {
    const d = await db();
    expect(SCHEMA_VERSION).toBe(8);
    await ensureSample(d, NOW);
    await ensureSample(d, NOW);
    const all = await bookRepo.books(d);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: SAMPLE_BOOK_ID, title: '因子投资入门', status: 'ready', source: 'sample' });
    expect(all[0].body).toMatchObject({ sections: 24, leaves: 19 });
    const secs = await bookRepo.sections(d, SAMPLE_BOOK_ID);
    expect(secs.find(s => s.id === '3.1')).toMatchObject({ parentId: '3', leaf: true, blockFrom: 35 });
    const blocks = await bookRepo.sectionBlocks(d, SAMPLE_BOOK_ID, '3.1');
    expect(blocks.map(b => b.type)).toEqual(['p', 'eq', 'p', 'p', 'p']);
    const hits = await bookRepo.searchBlocks(d, SAMPLE_BOOK_ID, '幸存者');
    expect(hits.map(h => h.sectionId)).toEqual(['4.5']);
  });

  it('导入 Markdown：同一个文件不重复；没有标题的报错', async () => {
    const d = await db();
    const md = '# 第一章 测试\n\n## 1.1 小节\n\n正文 $x$。\n';
    const a = await importMarkdownText(d, md, 'note.md', 'sha-a', NOW);
    const b = await importMarkdownText(d, md, 'note.md', 'sha-a', NOW);
    expect(a.existed).toBe(false);
    expect(b).toEqual({ bookId: a.bookId, existed: true });
    expect((await bookRepo.book(d, a.bookId))?.title).toBe('note');
    await expect(importMarkdownText(d, '', 'empty.md', 'sha-b', NOW)).rejects.toThrow('没有切出');
  });

  it('进度、笔记、卡点、闪卡、高亮', async () => {
    const d = await db();
    await ensureSample(d, NOW);
    const st: studyRepo.StudyState = { bookId: SAMPLE_BOOK_ID, main: '3.1', step: 1, mode: 'lecture', activeAt: NOW, sections: { '3.1': { taught: 1, skipped: [] }, '2.3': { taught: 2, skipped: [], done: true } } };
    await studyRepo.saveState(d, st);
    expect(await studyRepo.getState(d, SAMPLE_BOOK_ID)).toEqual(st);
    await studyRepo.saveSummary(d, SAMPLE_BOOK_ID, '2.3', '三类因子', NOW);
    await studyRepo.addQa(d, SAMPLE_BOOK_ID, '2.2', { q: 'MAD 是什么', a: '绝对离差中位数', from: '3.1' }, NOW);
    expect((await studyRepo.notesOf(d, SAMPLE_BOOK_ID)).map(n => [n.sectionId, n.summary, n.qa.length]).sort()).toEqual([['2.2', '', 1], ['2.3', '三类因子', 0]]);
    const id = await studyRepo.addStuck(d, SAMPLE_BOOK_ID, '2.2', '1.4826 怎么来的', NOW);
    expect(await studyRepo.addStuck(d, SAMPLE_BOOK_ID, '2.2', '1.4826 怎么来的', NOW)).toBe(id);
    const stuck = new Set((await studyRepo.stuckOf(d, SAMPLE_BOOK_ID)).filter(s => !s.resolvedAt).map(s => s.sectionId));
    expect(studyRepo.sectionStatus(st, '2.2', stuck)).toBe('stuck');
    expect(studyRepo.sectionStatus(st, '2.3', stuck)).toBe('done');
    expect(studyRepo.sectionStatus(st, '3.1', stuck)).toBe('learning');
    expect(studyRepo.sectionStatus(st, '4.1', stuck)).toBe('new');
    await studyRepo.resolveStuck(d, id, NOW);
    expect((await studyRepo.stuckOf(d))[0].resolvedAt).toBe(NOW);
    await studyRepo.addCards(d, SAMPLE_BOOK_ID, '3.1', [{ front: 'Q', back: 'A' }, { front: 'Q2', back: 'A2' }], '2026-11-02', NOW);
    const cs = await studyRepo.cards(d);
    await studyRepo.reviewCard(d, cs[0].id, 2, '2026-11-05', NOW);
    expect((await studyRepo.cards(d)).map(c => [c.box, c.due])).toEqual([[2, '2026-11-05'], [1, '2026-11-02']]);
    expect(await studyRepo.toggleHighlight(d, SAMPLE_BOOK_ID, 39, NOW)).toBe(true);
    expect(await studyRepo.toggleHighlight(d, SAMPLE_BOOK_ID, 39, NOW)).toBe(false);
    const shelf = await loadShelf(d, '2026-11-04');
    expect(shelf.resume).toMatchObject({ section: { id: '3.1' }, step: 1, awayDays: 3 });
    expect(shelf.books[0]).toMatchObject({ leaves: 19, done: 1 });
    expect(shelf.due).toBe(1);
  });

  it('伴读对话 kind = study，不出现在 AI 助手的对话列表和检索里', async () => {
    const d = await db();
    await ensureSample(d, NOW);
    const a = await aiRepo.createThread(d, '助手对话', NOW);
    const s = await studyRepo.createStudyThread(d, { title: '3.1 动量因子', bookId: SAMPLE_BOOK_ID, sectionId: '3.1', context: 'CTX' }, NOW);
    expect((await aiRepo.threads(d)).map(t => t.id)).toEqual([a]);
    expect(await studyRepo.studyThreadId(d, SAMPLE_BOOK_ID, '3.1')).toBe(s);
    expect(await studyRepo.threadContext(d, s)).toBe('CTX');
    expect(await aiRepo.searchConversations(d, '动量', null)).toEqual([]);
    await bookRepo.deleteBook(d, SAMPLE_BOOK_ID);
    expect(await studyRepo.studyThreadId(d, SAMPLE_BOOK_ID, '3.1')).toBeNull();
    expect(await aiRepo.thread(d, s)).toBeNull();
  });

  it('前复权日线整段替换，元数据记下最后一天和市值', async () => {
    const d = await db();
    const bar = (date: string, close: number) => ({ date, open: close, close, high: close, low: close, volume: 100 });
    const meta = { code: 'sh600036', name: '招商银行', fetchedAt: NOW, totalCap: 10000, floatCap: 8000, price: 43550 };
    await quantRepo.saveQfq(d, meta, [bar('2026-10-29', 43000), bar('2026-10-30', 43550)]);
    await quantRepo.saveQfq(d, meta, [bar('2026-10-30', 43500)]);
    expect((await quantRepo.qfqBars(d, ['sh600036', 'sz000001'])).get('sh600036')).toEqual([bar('2026-10-30', 43500)]);
    expect((await quantRepo.qfqMeta(d, ['sh600036'])).get('sh600036')).toMatchObject({ lastDate: '2026-10-30', bars: 1, totalCap: 10000 });
    await quantRepo.saveUniverse(d, { id: 'hs300', codes: ['sh600036'], asOf: '2026-10-30', fetchedAt: NOW });
    expect(await quantRepo.universe(d, 'hs300')).toMatchObject({ codes: ['sh600036'], asOf: '2026-10-30' });
  });
});
