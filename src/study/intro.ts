/** 内置体验的完成记录，只写本机，不请求 AI，也不覆盖已有小结。 */
import { SAMPLE_BOOK_ID } from '../book/sample';
import type { Db } from '../data/db';
import { getSetting, setSetting } from '../data/repos';
import { loadReadingState, saveReadingState } from './readingState';

export async function completeStudyIntro(db: Db): Promise<void> {
  await db.transaction(async tx => {
    if (await getSetting(tx, 'studyIntroCompleted', false)) return;
    const reading = await loadReadingState(tx, SAMPLE_BOOK_ID, '3.1');
    if (!reading.wrap && !reading.savedWrap) {
      await saveReadingState(tx, SAMPLE_BOOK_ID, '3.1', { wrap: {
        from: null,
        summary: '动量描述过去的累计收益，用来比较同一天股票的相对排名；排名高并不保证未来上涨。',
        stuck: [],
        cards: [{ front: '动量排名高，就一定会上涨吗？', back: '不能。动量描述过去的相对排名，还需要检验未来收益关系并考虑成本。', on: true }],
        skipped: [],
      } });
    }
    await setSetting(tx, 'studyIntroCompleted', true);
  });
}
