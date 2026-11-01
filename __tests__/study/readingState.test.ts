import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { SAMPLE_BOOK_ID } from '../../src/book/sample';
import { completeStudyIntro } from '../../src/study/intro';
import { anchorAt, anchorY, loadReadingState, saveReadingState } from '../../src/study/readingState';

 test('不同页面并发写草稿、锚点、小结互不覆盖；按书和章节隔离', async () => {
  const db = openMemoryDb();
  await migrate(db);
  const wrap = { from: null, summary: '我的摘要', stuck: [], cards: [], skipped: [] };
  await Promise.all([
    saveReadingState(db, 'book', '3.1', { draft: '未发送问题' }),
    saveReadingState(db, 'book', '3.1', { reader: { id: 8, offset: 0.25 } }),
    saveReadingState(db, 'book', '3.1', { wrap }),
  ]);
  expect(await loadReadingState(db, 'book', '3.1')).toEqual({ draft: '未发送问题', reader: { id: 8, offset: 0.25 }, wrap });
  expect(await loadReadingState(db, 'other', '3.1')).toEqual({});
  expect(await loadReadingState(db, 'book', '3.2')).toEqual({});
  await saveReadingState(db, 'book', '3.1', { wrap: null });
  await saveReadingState(db, 'book', '3.1', { draft: '继续输入' });
  expect((await loadReadingState(db, 'book', '3.1')).wrap).toBeNull();
  await db.close();
});

test('以段落比例恢复位置，放大文字后仍定位同一段', () => {
  const layouts = new Map([[1, { y: 80, height: 160 }], [2, { y: 240, height: 80 }]]);
  const anchor = anchorAt(layouts, 280)!;
  expect(anchor).toEqual({ id: 2, offset: 0.5 });
  expect(anchorY(anchor, { y: 360, height: 120 })).toBe(420);
});

test('离线体验仅建立一次小结草稿；复访保留编辑，保存后不再新建', async () => {
  const db = openMemoryDb();
  await migrate(db);
  await completeStudyIntro(db);
  const ui = await loadReadingState(db, SAMPLE_BOOK_ID, '3.1');
  expect(ui.wrap?.cards).toHaveLength(1);
  const edited = { ...ui.wrap!, summary: '我修改过的摘要' };
  await saveReadingState(db, SAMPLE_BOOK_ID, '3.1', { wrap: edited });
  await completeStudyIntro(db);
  expect((await loadReadingState(db, SAMPLE_BOOK_ID, '3.1')).wrap?.summary).toBe('我修改过的摘要');
  await saveReadingState(db, SAMPLE_BOOK_ID, '3.1', { wrap: null });
  await completeStudyIntro(db);
  expect((await loadReadingState(db, SAMPLE_BOOK_ID, '3.1')).wrap).toBeNull();
  await db.close();
});
