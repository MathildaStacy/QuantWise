/**
 * 伴读记录（迁移 0008，QUANTWISE_DESIGN.md §4、§6）：进度、笔记和问答、卡点、闪卡、高亮，以及小节对应的伴读对话。
 * 小节状态不单独存：已学看 study_state.body，有卡点看 study_stuck，在学看讲到第几步。
 */
import type { DateStr } from '../engine/calendar';
import type { Db } from './db';

export type StudyMode = 'lecture' | 'read';
export type SectionStatus = 'new' | 'learning' | 'done' | 'stuck';

export interface SectionProgress {
  /** 讲到第几步（从 0 开始，-1 没讲过）。 */
  taught: number;
  /** 跳过的步（从 0 开始）。 */
  skipped: number[];
  /** 本节小结已保存。 */
  done?: boolean;
  /** 正在岔路上：问的是哪一节，从哪条消息开始（QUANTWISE_DESIGN.md §6.5）。 */
  detour?: { sectionId: string; fromMsg: number } | null;
  /** 回到主线后折叠起来的岔路（只影响显示，发给模型的历史不变）。 */
  folds?: { sectionId: string; fromMsg: number; toMsg: number; title: string; step: number }[];
}

export interface StudyState {
  bookId: string;
  main: string;
  step: number;
  mode: StudyMode;
  activeAt: string;
  sections: Record<string, SectionProgress>;
}

export const progressOf = (st: StudyState, sectionId: string): SectionProgress =>
  st.sections[sectionId] ?? { taught: -1, skipped: [] };

export function sectionStatus(
  st: StudyState | null,
  sectionId: string,
  stuck: Set<string>,
): SectionStatus {
  if (stuck.has(sectionId)) {
    return 'stuck';
  }
  const p = st?.sections[sectionId];
  if (p?.done) {
    return 'done';
  }
  return p && p.taught >= 0 ? 'learning' : st?.main === sectionId ? 'learning' : 'new';
}

interface StateRow {
  book_id: string;
  main_section: string;
  step: number;
  mode: StudyMode;
  active_at: string;
  body: string;
}

export async function getState(db: Db, bookId: string): Promise<StudyState | null> {
  const r = await db.get<StateRow>('SELECT * FROM study_state WHERE book_id = ?', [bookId]);
  return r
    ? {
        bookId,
        main: r.main_section,
        step: Number(r.step),
        mode: r.mode,
        activeAt: r.active_at,
        sections: JSON.parse(r.body).sections ?? {},
      }
    : null;
}

export async function saveState(db: Db, st: StudyState): Promise<void> {
  await db.run(
    `INSERT INTO study_state (book_id, main_section, step, mode, active_at, body) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET main_section = excluded.main_section, step = excluded.step, mode = excluded.mode, active_at = excluded.active_at, body = excluded.body`,
    [st.bookId, st.main, st.step, st.mode, st.activeAt, JSON.stringify({ sections: st.sections })],
  );
}

// ---------- 笔记和问答 ----------

export interface SectionNote {
  sectionId: string;
  summary: string;
  qa: { q: string; a: string; from?: string }[];
  updatedAt: string;
}

export async function notesOf(db: Db, bookId: string): Promise<SectionNote[]> {
  const rows = await db.all<{ section_id: string; summary: string; qa: string; updated_at: string }>(
    'SELECT * FROM section_note WHERE book_id = ?',
    [bookId],
  );
  return rows.map(r => ({ sectionId: r.section_id, summary: r.summary, qa: JSON.parse(r.qa), updatedAt: r.updated_at }));
}

async function upsertNote(db: Db, bookId: string, n: SectionNote): Promise<void> {
  await db.run(
    `INSERT INTO section_note (book_id, section_id, summary, qa, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(book_id, section_id) DO UPDATE SET summary = excluded.summary, qa = excluded.qa, updated_at = excluded.updated_at`,
    [bookId, n.sectionId, n.summary, JSON.stringify(n.qa), n.updatedAt],
  );
}

export async function noteOf(db: Db, bookId: string, sectionId: string): Promise<SectionNote | null> {
  return (await notesOf(db, bookId)).find(n => n.sectionId === sectionId) ?? null;
}

export async function saveSummary(db: Db, bookId: string, sectionId: string, summary: string, now: string) {
  const n = (await noteOf(db, bookId, sectionId)) ?? { sectionId, summary: '', qa: [], updatedAt: now };
  await upsertNote(db, bookId, { ...n, summary, updatedAt: now });
}

/** 岔路回到主线时，把这次问答记进被问的那一节（§6.5）。 */
export async function addQa(db: Db, bookId: string, sectionId: string, qa: SectionNote['qa'][number], now: string) {
  const n = (await noteOf(db, bookId, sectionId)) ?? { sectionId, summary: '', qa: [], updatedAt: now };
  await upsertNote(db, bookId, { ...n, qa: [...n.qa, qa], updatedAt: now });
}

// ---------- 卡点 ----------

export interface Stuck {
  id: number;
  bookId: string;
  sectionId: string;
  text: string;
  resolvedAt: string | null;
  createdAt: string;
}

export async function stuckOf(db: Db, bookId?: string): Promise<Stuck[]> {
  const rows = await db.all<{ id: number; book_id: string; section_id: string; text: string; resolved_at: string | null; created_at: string }>(
    'SELECT * FROM study_stuck' + (bookId ? ' WHERE book_id = ?' : '') + ' ORDER BY resolved_at IS NOT NULL, id DESC',
    bookId ? [bookId] : [],
  );
  return rows.map(r => ({ id: Number(r.id), bookId: r.book_id, sectionId: r.section_id, text: r.text, resolvedAt: r.resolved_at, createdAt: r.created_at }));
}

export async function addStuck(db: Db, bookId: string, sectionId: string, text: string, now: string): Promise<number> {
  const dup = await db.get<{ id: number }>(
    'SELECT id FROM study_stuck WHERE book_id = ? AND section_id = ? AND text = ? AND resolved_at IS NULL',
    [bookId, sectionId, text],
  );
  if (dup) {
    return Number(dup.id);
  }
  const r = await db.get<{ id: number }>(
    'INSERT INTO study_stuck (book_id, section_id, text, created_at) VALUES (?, ?, ?, ?) RETURNING id',
    [bookId, sectionId, text, now],
  );
  return Number(r!.id);
}

export async function resolveStuck(db: Db, id: number, now: string): Promise<void> {
  await db.run('UPDATE study_stuck SET resolved_at = ? WHERE id = ?', [now, id]);
}

// ---------- 闪卡 ----------

export interface Card {
  id: number;
  bookId: string;
  sectionId: string;
  front: string;
  back: string;
  box: number;
  due: DateStr;
  createdAt: string;
  reviewedAt: string | null;
}

export async function cards(db: Db, bookId?: string): Promise<Card[]> {
  const rows = await db.all<{ id: number; book_id: string; section_id: string; front: string; back: string; box: number; due_date: string; created_at: string; reviewed_at: string | null }>(
    'SELECT * FROM study_card' + (bookId ? ' WHERE book_id = ?' : '') + ' ORDER BY id',
    bookId ? [bookId] : [],
  );
  return rows.map(r => ({ id: Number(r.id), bookId: r.book_id, sectionId: r.section_id, front: r.front, back: r.back, box: Number(r.box), due: r.due_date, createdAt: r.created_at, reviewedAt: r.reviewed_at }));
}

export async function addCards(
  db: Db,
  bookId: string,
  sectionId: string,
  list: { front: string; back: string }[],
  due: DateStr,
  now: string,
): Promise<void> {
  await db.transaction(async tx => {
    for (const c of list) {
      await tx.run(
        'INSERT INTO study_card (book_id, section_id, front, back, box, due_date, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
        [bookId, sectionId, c.front, c.back, due, now],
      );
    }
  });
}

export async function reviewCard(db: Db, id: number, box: number, due: DateStr, now: string): Promise<void> {
  await db.run('UPDATE study_card SET box = ?, due_date = ?, reviewed_at = ? WHERE id = ?', [box, due, now, id]);
}

// ---------- 高亮和便签 ----------

export interface Mark {
  id: number;
  blockSeq: number;
  kind: 'highlight' | 'pin';
  text: string;
}

export async function marksOf(db: Db, bookId: string): Promise<Mark[]> {
  const rows = await db.all<{ id: number; block_seq: number; kind: Mark['kind']; text: string }>(
    'SELECT id, block_seq, kind, text FROM book_mark WHERE book_id = ? ORDER BY id',
    [bookId],
  );
  return rows.map(r => ({ id: Number(r.id), blockSeq: Number(r.block_seq), kind: r.kind, text: r.text }));
}

export async function addMark(db: Db, bookId: string, m: Omit<Mark, 'id'>, now: string): Promise<void> {
  await db.run('INSERT INTO book_mark (book_id, block_seq, kind, text, created_at) VALUES (?, ?, ?, ?, ?)', [bookId, m.blockSeq, m.kind, m.text, now]);
}

export async function toggleHighlight(db: Db, bookId: string, blockSeq: number, now: string): Promise<boolean> {
  const had = await db.run("DELETE FROM book_mark WHERE book_id = ? AND block_seq = ? AND kind = 'highlight'", [bookId, blockSeq]);
  if (had.changes) {
    return false;
  }
  await addMark(db, bookId, { blockSeq, kind: 'highlight', text: '' }, now);
  return true;
}

// ---------- 伴读对话（ai_thread.kind = 'study'） ----------

export async function studyThreadId(db: Db, bookId: string, sectionId: string): Promise<number | null> {
  const r = await db.get<{ id: number }>(
    "SELECT id FROM ai_thread WHERE kind = 'study' AND book_id = ? AND section_id = ? ORDER BY id DESC LIMIT 1",
    [bookId, sectionId],
  );
  return r ? Number(r.id) : null;
}

export async function createStudyThread(
  db: Db,
  o: { title: string; bookId: string; sectionId: string; context: string },
  now: string,
): Promise<number> {
  const r = await db.get<{ id: number }>(
    "INSERT INTO ai_thread (title, kind, book_id, section_id, context_snapshot, created_at, updated_at) VALUES (?, 'study', ?, ?, ?, ?, ?) RETURNING id",
    [o.title, o.bookId, o.sectionId, o.context, now, now],
  );
  return Number(r!.id);
}

export async function threadContext(db: Db, threadId: number): Promise<string | null> {
  const r = await db.get<{ context_snapshot: string | null }>('SELECT context_snapshot FROM ai_thread WHERE id = ?', [threadId]);
  return r?.context_snapshot ?? null;
}
