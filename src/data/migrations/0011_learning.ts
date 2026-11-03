/** 学习记录独立于账户；手记来源保留快照，删书不级联删除研究。 */
export const m0011: string[] = [
  `CREATE TABLE learning_plan (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)`,
  `CREATE TABLE learning_saved (concept_id TEXT PRIMARY KEY)`,
  `CREATE TABLE learning_attempt (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, question_id TEXT NOT NULL,
    choice INTEGER NOT NULL, correct INTEGER NOT NULL CHECK(correct IN (0, 1)),
    day TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(run_id, question_id)
  )`,
  `CREATE INDEX learning_attempt_day ON learning_attempt(day)`,
  `CREATE TABLE learning_research (
    id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    created_day TEXT NOT NULL, updated_day TEXT NOT NULL
  )`,
];
