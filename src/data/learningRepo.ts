import type { Db } from './db';
import { CHECKS, GOALS, QUESTIONS, conceptById } from '../learning/catalog';
import { DEFAULT_PLAN, localDay } from '../learning/progress';
import type {
  Attempt,
  ConceptId,
  LearningData,
  LearningPlan,
  ResearchDraft,
  ResearchNote,
} from '../learning/types';

export async function loadPlan(db: Db): Promise<LearningPlan> {
  const row = await db.get<{ body: string }>(
    'SELECT body FROM learning_plan WHERE id = 1',
  );
  return row ? JSON.parse(row.body) : { ...DEFAULT_PLAN };
}

export async function savePlan(db: Db, plan: LearningPlan): Promise<void> {
  if (
    !GOALS[plan.goal] ||
    ![10, 20, 40].includes(plan.minutes) ||
    ![3, 5, 7].includes(plan.days)
  ) {
    throw new Error('请选择有效的学习目标与时间安排');
  }
  if (
    plan.bookId &&
    !(await db.get('SELECT id FROM book WHERE id = ? AND status = ?', [
      plan.bookId,
      'ready',
    ]))
  ) {
    throw new Error('这本书暂不可读，请重新选择书籍');
  }
  await db.run(
    'INSERT INTO learning_plan (id, body) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body',
    [JSON.stringify(plan)],
  );
}

export async function setConceptSaved(
  db: Db,
  id: ConceptId,
  saved: boolean,
): Promise<void> {
  if (!conceptById(id)) {
    throw new Error('找不到这个概念');
  }
  await db.run(
    saved
      ? 'INSERT OR IGNORE INTO learning_saved (concept_id) VALUES (?)'
      : 'DELETE FROM learning_saved WHERE concept_id = ?',
    [id],
  );
}

export async function recordAnswer(
  db: Db,
  runId: string,
  questionId: string,
  choice: number,
  now = new Date(),
): Promise<void> {
  const q = QUESTIONS.find(x => x.id === questionId);
  if (
    !runId ||
    !q ||
    !Number.isInteger(choice) ||
    choice < 0 ||
    choice >= q.options.length
  ) {
    throw new Error('请选择一个有效答案');
  }
  await db.run(
    'INSERT OR IGNORE INTO learning_attempt (run_id, question_id, choice, correct, day, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [
      runId,
      questionId,
      choice,
      choice === q.answer ? 1 : 0,
      localDay(now),
      now.toISOString(),
    ],
  );
}

interface AttemptRow
  extends Omit<Attempt, 'runId' | 'questionId' | 'createdAt' | 'correct'> {
  run_id: string;
  question_id: string;
  created_at: string;
  correct: number;
}
export async function loadAttempts(db: Db): Promise<Attempt[]> {
  return (
    await db.all<AttemptRow>('SELECT * FROM learning_attempt ORDER BY id')
  ).map(r => ({
    id: Number(r.id),
    runId: r.run_id,
    questionId: r.question_id,
    choice: Number(r.choice),
    correct: !!r.correct,
    day: r.day,
    createdAt: r.created_at,
  }));
}

interface ResearchRow {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
  created_day: string;
  updated_day: string;
}
const toResearch = (r: ResearchRow): ResearchNote => ({
  ...JSON.parse(r.body),
  id: r.id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  createdDay: r.created_day,
  updatedDay: r.updated_day,
});

export async function loadResearch(db: Db): Promise<ResearchNote[]> {
  return (
    await db.all<ResearchRow>(
      'SELECT * FROM learning_research ORDER BY updated_at DESC, id',
    )
  ).map(toResearch);
}
export async function getResearch(
  db: Db,
  id: string,
): Promise<ResearchNote | null> {
  const row = await db.get<ResearchRow>(
    'SELECT * FROM learning_research WHERE id = ?',
    [id],
  );
  return row ? toResearch(row) : null;
}
export async function saveResearch(
  db: Db,
  draft: ResearchDraft,
  now = new Date(),
): Promise<void> {
  if (!draft.id || !draft.title.trim() || !draft.hypothesis.trim()) {
    throw new Error('请填写标题和研究假设');
  }
  if (
    draft.title.length > 120 ||
    [
      draft.hypothesis,
      draft.method,
      draft.evidence,
      draft.conclusion,
      draft.nextStep,
    ].some(v => v.length > 4000) ||
    CHECKS.some(c => draft.checks[c.id].length > 1200)
  ) {
    throw new Error(
      '标题最多 120 字，正文每项最多 4000 字，自查依据每项最多 1200 字',
    );
  }
  if (draft.conceptId && !conceptById(draft.conceptId)) {
    throw new Error('请选择有效概念');
  }
  await db.transaction(async tx => {
    const old = await getResearch(tx, draft.id);
    if (
      draft.source &&
      JSON.stringify(draft.source) !== JSON.stringify(old?.source)
    ) {
      const row = await tx.get<{ title: string; section_title: string }>(
        'SELECT b.title, s.title AS section_title FROM book b JOIN book_section s ON b.id = s.book_id WHERE b.id = ? AND s.id = ? AND b.status = ? AND s.leaf = 1',
        [draft.source.bookId, draft.source.sectionId, 'ready'],
      );
      if (!row) {
        throw new Error('来源小节已不可用，请重新选择');
      }
      draft = {
        ...draft,
        source: {
          ...draft.source,
          bookTitle: row.title,
          sectionTitle: row.section_title,
        },
      };
    }
    const body: ResearchDraft = {
      ...draft,
      title: draft.title.trim(),
      hypothesis: draft.hypothesis.trim(),
    };
    await tx.run(
      `INSERT INTO learning_research (id, body, created_at, updated_at, created_day, updated_day) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, updated_day = excluded.updated_day`,
      [
        draft.id,
        JSON.stringify(body),
        now.toISOString(),
        now.toISOString(),
        localDay(now),
        localDay(now),
      ],
    );
  });
}
export async function deleteResearch(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM learning_research WHERE id = ?', [id]);
}

export async function loadLearning(db: Db): Promise<LearningData> {
  const [plan, saved, attempts, notes] = await Promise.all([
    loadPlan(db),
    db.all<{ concept_id: ConceptId }>('SELECT concept_id FROM learning_saved'),
    loadAttempts(db),
    loadResearch(db),
  ]);
  return { plan, saved: saved.map(r => r.concept_id), attempts, notes };
}
