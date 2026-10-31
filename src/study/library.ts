/**
 * 书架（QUANTWISE_DESIGN.md §3、§4）：内置示例教材、导入 Markdown 文本、书架和地图页要的汇总。
 */
import { assemble } from '../book/assemble';
import { leavesOf } from '../book/book';
import { parseMarkdownBook } from '../book/markdown';
import { SAMPLE_BOOK_ID, SAMPLE_BOOK_MD } from '../book/sample';
import type { AssembledBook, Book, BookFormat, BookSection } from '../book/types';
import * as bookRepo from '../data/bookRepo';
import type { Db } from '../data/db';
import * as studyRepo from '../data/studyRepo';
import type { DateStr } from '../engine/calendar';
import { dueToday } from '../book/review';

/** FNV-1a：只用来判断内置教材的内容变没变。 */
/* eslint-disable no-bitwise */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
/* eslint-enable no-bitwise */

/** 第一次启动写入示例教材；以后版本改了内容就重写章节和块（小节号不变，学习记录保留）。 */
export async function ensureSample(db: Db, now: string): Promise<void> {
  const hash = fnv1a(SAMPLE_BOOK_MD);
  const old = await bookRepo.book(db, SAMPLE_BOOK_ID);
  if (old && old.sha256 === 'sample:' + hash) {
    return;
  }
  const a = assemble(parseMarkdownBook(SAMPLE_BOOK_MD));
  if (!old) {
    await bookRepo.createBook(
      db,
      {
        id: SAMPLE_BOOK_ID,
        title: a.title,
        author: a.author,
        format: 'md',
        source: 'sample',
        sha256: 'sample:' + hash,
        pages: null,
        status: 'parsing',
        error: null,
        body: { fileName: 'sample.md' },
      },
      now,
    );
  } else {
    await db.run('UPDATE book SET sha256 = ? WHERE id = ?', ['sample:' + hash, SAMPLE_BOOK_ID]);
  }
  await bookRepo.saveContent(db, SAMPLE_BOOK_ID, a, now);
}

export const bookIdOf = (sha256: string) => 'bk_' + sha256.slice(0, 16);

/** 把已经解析好的书写进书架（Markdown / EPUB / MinerU 都走这里）。同一个文件导入过就直接返回原来的书。 */
export async function saveImported(
  db: Db,
  o: { a: AssembledBook; format: BookFormat; sha256: string; fileName: string; dir?: string; pages?: number | null },
  now: string,
): Promise<{ bookId: string; existed: boolean }> {
  const dup = await bookRepo.bookBySha(db, o.sha256);
  if (dup && dup.status === 'ready') {
    return { bookId: dup.id, existed: true };
  }
  const id = dup?.id ?? bookIdOf(o.sha256);
  if (!dup) {
    await bookRepo.createBook(
      db,
      {
        id,
        title: o.a.title || o.fileName.replace(/\.\w+$/, ''),
        author: o.a.author,
        format: o.format,
        source: 'import',
        sha256: o.sha256,
        pages: o.pages ?? null,
        status: 'parsing',
        error: null,
        body: { fileName: o.fileName, dir: o.dir },
      },
      now,
    );
  }
  await bookRepo.saveContent(db, id, { ...o.a, title: o.a.title || o.fileName.replace(/\.\w+$/, '') }, now);
  return { bookId: id, existed: false };
}

export async function importMarkdownText(
  db: Db,
  text: string,
  fileName: string,
  sha256: string,
  now: string,
) {
  const a = assemble(parseMarkdownBook(text, fileName.replace(/\.\w+$/, '')));
  if (!a.sections.some(s => s.leaf)) {
    throw new Error('没有切出能学的小节：标题要用 # / ## 开头');
  }
  return saveImported(db, { a, format: 'md', sha256, fileName }, now);
}

// ---------- 书架和地图要的汇总 ----------

export interface ShelfBook {
  book: Book;
  leaves: number;
  done: number;
}

export interface Shelf {
  books: ShelfBook[];
  /** 继续学习：最近打开过的一本书和它的主线小节。 */
  resume: { book: Book; section: BookSection; step: number; steps: number | null; awayDays: number; stuck: string | null } | null;
  due: number;
  stuck: number;
}

export async function loadShelf(db: Db, today: DateStr): Promise<Shelf> {
  const all = await bookRepo.books(db);
  const stuck = (await studyRepo.stuckOf(db)).filter(s => !s.resolvedAt);
  const books: ShelfBook[] = [];
  let resume: Shelf['resume'] = null;
  let latest = '';
  let first: Shelf['resume'] = null;
  for (const b of all) {
    if (b.status !== 'ready') {
      books.push({ book: b, leaves: b.body.leaves ?? 0, done: 0 });
      continue;
    }
    const st = await studyRepo.getState(db, b.id);
    const secs = await bookRepo.sections(db, b.id);
    const leaves = leavesOf(secs);
    books.push({ book: b, leaves: leaves.length, done: leaves.filter(s => st?.sections[s.id]?.done).length });
    if (!first && leaves[0]) {
      // 还没打开过任何书时，继续学习指向书架第一本（示例教材）的第一节
      first = { book: b, section: leaves[0], step: 0, steps: null, awayDays: 0, stuck: null };
    }
    if (st && st.activeAt > latest) {
      latest = st.activeAt;
      resume = {
        book: b,
        section: secs.find(s => s.id === st.main) ?? leaves[0],
        step: st.step,
        steps: null,
        awayDays: Math.max(0, Math.round((Date.parse(today) - Date.parse(st.activeAt.slice(0, 10))) / 86400000)),
        stuck: stuck.find(s => s.bookId === b.id)?.text ?? null,
      };
    }
  }
  resume ??= first;
  const due = dueToday(await studyRepo.cards(db), today).length;
  return { books, resume, due, stuck: stuck.length };
}
