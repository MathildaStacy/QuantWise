/**
 * 助手和讲解共用的整理收尾（docs/design/ai-study-options.md §4.7）：id < keepFrom 的消息标成已整理，
 * 不再发送；保留下来的 Anthropic 回答去掉思考块，否则新模型校验前缀不符会 400。
 */
import type { Db } from '../data/db';
import * as aiRepo from '../data/aiRepo';
import { retainedRaw } from './protocol';

export async function retireBefore(
  db: Db,
  threadId: number,
  keepFrom: number,
): Promise<void> {
  await aiRepo.markCompacted(db, threadId, keepFrom - 1);
  for (const m of await aiRepo.messages(db, threadId)) {
    if (m.compacted || m.role !== 'assistant' || !m.raw) {
      continue;
    }
    const raw = retainedRaw(m.raw);
    if (raw.items.length !== m.raw.items.length) {
      await aiRepo.updateMessageRaw(db, m.id, raw);
    }
  }
}
