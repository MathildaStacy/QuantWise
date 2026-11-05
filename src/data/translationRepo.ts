import type { BookBlock } from '../book/types';
import { splitTranslationSource, type TranslationPair } from '../study/translation';
import type { Db } from './db';

export interface BlockTranslation {
  source: string;
  pairs: TranslationPair[];
  providerId: string;
  model: string;
  updatedAt: string;
}

export async function loadTranslations(db: Db, bookId: string, blocks: BookBlock[]): Promise<Record<number, BlockTranslation>> {
  if (!blocks.length) return {};
  const rows = await db.all<{ block_seq: number; source: string; pairs: string; provider_id: string; model: string; updated_at: string }>(
    `SELECT t.* FROM book_translation t JOIN book_block b ON b.book_id = t.book_id AND b.seq = t.block_seq
     WHERE t.book_id = ? AND b.section_id = ? AND t.target = 'zh-CN'`, [bookId, blocks[0].sectionId],
  );
  const sources = new Map(blocks.map(b => [b.seq, b.text]));
  const out: Record<number, BlockTranslation> = {};
  for (const row of rows) {
    if (sources.get(row.block_seq) !== row.source) continue;
    const pairs = JSON.parse(row.pairs) as TranslationPair[];
    const expected = splitTranslationSource(row.source);
    if (pairs.length !== expected.length || pairs.some((p, i) => p.source !== expected[i])) continue;
    out[row.block_seq] = { source: row.source, pairs, providerId: row.provider_id, model: row.model, updatedAt: row.updated_at };
  }
  return out;
}

/** 这本书已保存的全部译文（原文没变的）：翻译时沿用以前的术语译法（study/glossary.ts 的 termHints）。 */
export async function savedTexts(db: Db, bookId: string): Promise<{ seq: number; sectionId: string; text: string }[]> {
  const rows = await db.all<{ block_seq: number; section_id: string; pairs: string }>(
    `SELECT t.block_seq, b.section_id, t.pairs FROM book_translation t JOIN book_block b ON b.book_id = t.book_id AND b.seq = t.block_seq
     WHERE t.book_id = ? AND t.target = 'zh-CN' AND t.source = b.text ORDER BY t.block_seq`, [bookId],
  );
  return rows.flatMap(r => {
    try {
      return [{ seq: r.block_seq, sectionId: r.section_id, text: (JSON.parse(r.pairs) as TranslationPair[]).map(p => p.translation).join('') }];
    } catch {
      return [];
    }
  });
}

export async function saveTranslation(db: Db, bookId: string, b: BookBlock, t: BlockTranslation): Promise<void> {
  // 生成期间若书被删掉或重新解析，不能把旧请求写到新内容上。
  const r = await db.run(`INSERT OR REPLACE INTO book_translation (book_id, block_seq, target, source, pairs, provider_id, model, updated_at)
    SELECT book_id, seq, 'zh-CN', ?, ?, ?, ?, ? FROM book_block WHERE book_id = ? AND seq = ? AND text = ?`,
  [t.source, JSON.stringify(t.pairs), t.providerId, t.model, t.updatedAt, bookId, b.seq, b.text]);
  if (!r.changes) throw new Error('原文已更新，请重新打开本节再翻译');
}
