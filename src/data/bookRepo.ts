/**
 * 书和伴读记录的读写（迁移 0008，QUANTWISE_DESIGN.md §4）。书写入时整本一个事务；学习记录按需小写。
 */
import type { DateStr } from '../engine/calendar';
import type {
  AssembledBook,
  Book,
  BookBlock,
  BookBody,
  BookFormat,
  BookSection,
  BookStatus,
} from '../book/types';
import type { Db } from './db';

interface BookRow {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  source: 'sample' | 'import';
  sha256: string;
  pages: number | null;
  status: BookStatus;
  error: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

const toBook = (r: BookRow): Book => ({
  id: r.id,
  title: r.title,
  author: r.author,
  format: r.format,
  source: r.source,
  sha256: r.sha256,
  pages: r.pages == null ? null : Number(r.pages),
  status: r.status,
  error: r.error,
  body: JSON.parse(r.body) as BookBody,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function books(db: Db): Promise<Book[]> {
  const rows = await db.all<BookRow>(
    "SELECT * FROM book ORDER BY source = 'sample' DESC, updated_at DESC",
  );
  return rows.map(toBook);
}

export async function book(db: Db, id: string): Promise<Book | null> {
  const r = await db.get<BookRow>('SELECT * FROM book WHERE id = ?', [id]);
  return r ? toBook(r) : null;
}

export async function bookBySha(db: Db, sha256: string): Promise<Book | null> {
  const r = await db.get<BookRow>('SELECT * FROM book WHERE sha256 = ?', [sha256]);
  return r ? toBook(r) : null;
}

/** 新建一本书（解析中或已就绪）；章节和块另外用 saveContent 写。 */
export async function createBook(
  db: Db,
  b: Omit<Book, 'createdAt' | 'updatedAt'>,
  now: string,
): Promise<void> {
  await db.run(
    'INSERT INTO book (id, title, author, format, source, sha256, pages, status, error, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [b.id, b.title, b.author, b.format, b.source, b.sha256, b.pages, b.status, b.error, JSON.stringify(b.body), now, now],
  );
}

export async function updateBook(
  db: Db,
  id: string,
  patch: Partial<Pick<Book, 'title' | 'author' | 'pages' | 'status' | 'error' | 'body'>>,
  now: string,
): Promise<void> {
  const cols: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    cols.push(k + ' = ?');
    vals.push(k === 'body' ? JSON.stringify(v) : (v as string | number | null));
  }
  await db.run(
    'UPDATE book SET ' + cols.concat('updated_at = ?').join(', ') + ' WHERE id = ?',
    [...vals, now, id],
  );
}

/** 写入解析结果：替换这本书原有的章节和块，书标成 ready。 */
export async function saveContent(
  db: Db,
  id: string,
  a: AssembledBook,
  now: string,
): Promise<void> {
  await db.transaction(async tx => {
    await tx.run('DELETE FROM book_section WHERE book_id = ?', [id]);
    await tx.run('DELETE FROM book_block WHERE book_id = ?', [id]);
    for (const s of a.sections) {
      await tx.run(
        'INSERT INTO book_section (book_id, id, parent_id, ord, level, no, title, leaf, block_from, block_to, page_from, page_to, chars) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, s.id, s.parentId, s.ord, s.level, s.no, s.title, s.leaf ? 1 : 0, s.blockFrom, s.blockTo, s.pageFrom, s.pageTo, s.chars],
      );
    }
    for (const b of a.blocks) {
      await tx.run(
        'INSERT INTO book_block (book_id, seq, section_id, no, type, text, page, mark, image, html) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, b.seq, b.sectionId, b.no, b.type, b.text, b.page, b.mark, b.image, b.html],
      );
    }
    const old = await book(tx, id);
    await updateBook(
      tx,
      id,
      {
        title: a.title || old?.title,
        author: a.author || old?.author,
        status: 'ready',
        error: null,
        body: {
          ...old?.body,
          warnings: a.warnings,
          sections: a.sections.length,
          leaves: a.sections.filter(s => s.leaf).length,
        },
      },
      now,
    );
  });
}

export async function deleteBook(db: Db, id: string): Promise<void> {
  await db.transaction(async tx => {
    await tx.run("DELETE FROM ai_message WHERE thread_id IN (SELECT id FROM ai_thread WHERE kind = 'study' AND book_id = ?)", [id]);
    await tx.run("DELETE FROM ai_thread WHERE kind = 'study' AND book_id = ?", [id]);
    await tx.run('DELETE FROM book WHERE id = ?', [id]);
  });
}

interface SectionRow {
  id: string;
  parent_id: string | null;
  ord: number;
  level: number;
  no: string;
  title: string;
  leaf: number;
  block_from: number | null;
  block_to: number | null;
  page_from: number | null;
  page_to: number | null;
  chars: number;
}

const nOrNull = (v: number | null) => (v == null ? null : Number(v));

export async function sections(db: Db, bookId: string): Promise<BookSection[]> {
  const rows = await db.all<SectionRow>(
    'SELECT * FROM book_section WHERE book_id = ? ORDER BY ord',
    [bookId],
  );
  return rows.map(r => ({
    id: r.id,
    parentId: r.parent_id,
    ord: Number(r.ord),
    level: Number(r.level) as 1 | 2 | 3,
    no: r.no,
    title: r.title,
    leaf: !!Number(r.leaf),
    blockFrom: nOrNull(r.block_from),
    blockTo: nOrNull(r.block_to),
    pageFrom: nOrNull(r.page_from),
    pageTo: nOrNull(r.page_to),
    chars: Number(r.chars),
  }));
}

interface BlockRow {
  seq: number;
  section_id: string;
  no: number;
  type: BookBlock['type'];
  text: string;
  page: number | null;
  mark: string | null;
  image: string | null;
  html: string | null;
}

const toBlock = (r: BlockRow): BookBlock => ({
  seq: Number(r.seq),
  sectionId: r.section_id,
  no: Number(r.no),
  type: r.type,
  text: r.text,
  page: nOrNull(r.page),
  mark: r.mark,
  image: r.image,
  html: r.html,
});

export async function sectionBlocks(
  db: Db,
  bookId: string,
  sectionId: string,
): Promise<BookBlock[]> {
  const rows = await db.all<BlockRow>(
    'SELECT * FROM book_block WHERE book_id = ? AND section_id = ? ORDER BY no',
    [bookId, sectionId],
  );
  return rows.map(toBlock);
}

/** 全文搜索（V1 用 LIKE，§13）：前 limit 个命中，按全书顺序。 */
export async function searchBlocks(
  db: Db,
  bookId: string,
  query: string,
  limit = 8,
): Promise<BookBlock[]> {
  const q = query.trim().replace(/[%_]/g, '');
  if (!q) {
    return [];
  }
  const rows = await db.all<BlockRow>(
    'SELECT * FROM book_block WHERE book_id = ? AND text LIKE ? ORDER BY seq LIMIT ?',
    [bookId, '%' + q + '%', limit],
  );
  return rows.map(toBlock);
}

export const today = (iso: string): DateStr => iso.slice(0, 10);
