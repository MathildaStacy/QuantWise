/**
 * QuantWise：书、伴读和因子数据（QUANTWISE_DESIGN.md §4）。
 *
 * - book / book_section / book_block：解析后的书。块的 no 是节内序号，引用写成 [[b:3.1#2]]。
 * - book_part：PDF 分片（每片 ≤ 200 页）的 MinerU 任务，App 被杀后接着轮询，不重复上传。
 * - study_state / section_note / study_stuck / study_card / book_mark：伴读进度、笔记、卡点、闪卡、高亮。
 * - kline_qfq / kline_qfq_meta：前复权日线（因子用），按代码整段替换；撮合仍然用不复权的 kline_day。
 * - quant_universe：股票池成分（沪深 300 等）和取到的日期。
 * - ai_thread 加 kind：'study' 是伴读对话（一个小节一个），AI 助手的列表只看 'assistant'。
 */
export const m0008: string[] = [
  `CREATE TABLE book (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, format TEXT NOT NULL, source TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE, pages INTEGER, status TEXT NOT NULL, error TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE book_section (book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE, id TEXT NOT NULL, parent_id TEXT, ord INTEGER NOT NULL, level INTEGER NOT NULL, no TEXT NOT NULL, title TEXT NOT NULL, leaf INTEGER NOT NULL, block_from INTEGER, block_to INTEGER, page_from INTEGER, page_to INTEGER, chars INTEGER NOT NULL, PRIMARY KEY (book_id, id)) WITHOUT ROWID`,
  `CREATE TABLE book_block (book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE, seq INTEGER NOT NULL, section_id TEXT NOT NULL, no INTEGER NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL, page INTEGER, mark TEXT, image TEXT, html TEXT, PRIMARY KEY (book_id, seq)) WITHOUT ROWID`,
  'CREATE INDEX book_block_section ON book_block (book_id, section_id, no)',
  `CREATE TABLE book_part (book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE, part_no INTEGER NOT NULL, page_from INTEGER NOT NULL, page_to INTEGER NOT NULL, data_id TEXT NOT NULL, batch_id TEXT, state TEXT NOT NULL, error TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (book_id, part_no))`,
  `CREATE TABLE study_state (book_id TEXT PRIMARY KEY REFERENCES book(id) ON DELETE CASCADE, main_section TEXT NOT NULL, step INTEGER NOT NULL, mode TEXT NOT NULL, active_at TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE TABLE section_note (book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE, section_id TEXT NOT NULL, summary TEXT NOT NULL, qa TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (book_id, section_id))`,
  `CREATE TABLE study_stuck (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE, section_id TEXT NOT NULL, text TEXT NOT NULL, resolved_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE study_card (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE, section_id TEXT NOT NULL, front TEXT NOT NULL, back TEXT NOT NULL, box INTEGER NOT NULL, due_date TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_at TEXT)`,
  'CREATE INDEX study_card_due ON study_card (due_date)',
  `CREATE TABLE book_mark (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE, block_seq INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE kline_qfq (code TEXT NOT NULL, date TEXT NOT NULL, open INTEGER NOT NULL, close INTEGER NOT NULL, high INTEGER NOT NULL, low INTEGER NOT NULL, volume INTEGER NOT NULL, PRIMARY KEY (code, date)) WITHOUT ROWID`,
  `CREATE TABLE kline_qfq_meta (code TEXT PRIMARY KEY, name TEXT NOT NULL, fetched_at TEXT NOT NULL, last_date TEXT NOT NULL, bars INTEGER NOT NULL, total_cap REAL, float_cap REAL, price INTEGER)`,
  `CREATE TABLE quant_universe (id TEXT PRIMARY KEY, codes TEXT NOT NULL, as_of TEXT NOT NULL, fetched_at TEXT NOT NULL)`,
  `ALTER TABLE ai_thread ADD COLUMN kind TEXT NOT NULL DEFAULT 'assistant'`,
  'ALTER TABLE ai_thread ADD COLUMN book_id TEXT',
  'ALTER TABLE ai_thread ADD COLUMN section_id TEXT',
  'ALTER TABLE ai_thread ADD COLUMN context_snapshot TEXT',
  'CREATE INDEX ai_thread_study ON ai_thread (kind, book_id, section_id)',
];
