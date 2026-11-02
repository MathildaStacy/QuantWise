/** 按书和小节保存阅读锚点、草稿与待重试问题；与教学进度分开，避免滚动写入覆盖进度。 */
import type { Db } from '../data/db';
import { getSetting, setSetting } from '../data/repos';
import type { StudyAsk, WrapDraft } from './session';

export interface ReadingAnchor {
  id: number;
  offset: number;
}

export interface ReadingState {
  translation?: boolean;
  draft?: string;
  reader?: ReadingAnchor;
  thread?: ReadingAnchor;
  follow?: boolean;
  pending?: StudyAsk | null;
  wrap?: WrapDraft | null;
  /** 最后保存的小结内容，用于重复确认时避免重复插入闪卡。 */
  savedWrap?: string;
}

const keyOf = (bookId: string, sectionId: string) => 'reading:' + bookId + ':' + sectionId;

export const loadReadingState = (db: Db, bookId: string, sectionId: string) =>
  getSetting<ReadingState>(db, keyOf(bookId, sectionId), {});

export async function saveReadingState(db: Db, bookId: string, sectionId: string, patch: Partial<ReadingState>): Promise<void> {
  await db.transaction(async tx => {
    const old = await loadReadingState(tx, bookId, sectionId);
    await setSetting(tx, keyOf(bookId, sectionId), { ...old, ...patch });
  });
}

/** 找到视口顶部最近的稳定内容块，偏移保存为该块高度的比例，便于调整字号后恢复。 */
export function anchorAt(layouts: Map<number, { y: number; height: number }>, y: number): ReadingAnchor | undefined {
  const entries = [...layouts].sort((a, b) => a[1].y - b[1].y);
  const entry = [...entries].reverse().find(([, box]) => box.y <= y + 1) ?? entries[0];
  return entry ? { id: entry[0], offset: Math.max(0, Math.min(1, (y - entry[1].y) / Math.max(1, entry[1].height))) } : undefined;
}

export function anchorY(anchor: ReadingAnchor, box: { y: number; height: number }): number {
  return Math.max(0, box.y + anchor.offset * box.height);
}
