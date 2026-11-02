/** 译文随原内容块一起删除，重新解析也不会留下过期结果。 */
export const m0009: string[] = [
  `CREATE TABLE book_translation (
    book_id TEXT NOT NULL,
    block_seq INTEGER NOT NULL,
    target TEXT NOT NULL,
    source TEXT NOT NULL,
    pairs TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, block_seq, target),
    FOREIGN KEY (book_id, block_seq) REFERENCES book_block(book_id, seq) ON DELETE CASCADE
  ) WITHOUT ROWID`,
];
