import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate, migrations } from '../../src/data/migrations';
import * as learning from '../../src/data/learningRepo';
import * as bookRepo from '../../src/data/bookRepo';
import * as studyRepo from '../../src/data/studyRepo';
import { SAMPLE_BOOK_ID } from '../../src/book/sample';
import { ensureSample } from '../../src/study/library';
import { CHECKS, CONCEPTS, QUESTIONS } from '../../src/learning/catalog';
import {
  DEFAULT_PLAN,
  coachMaterial,
  conceptProgress,
  emptyResearch,
  localDay,
  quizQuestions,
  reportMarkdown,
  todayTasks,
  weekStart,
  weeklyReport,
} from '../../src/learning/progress';
import type { LearningData } from '../../src/learning/types';
import type { Db } from '../../src/data/db';

let db: Db;
const monday = new Date(2026, 10, 2, 12);
beforeEach(async () => {
  db = openMemoryDb();
  await migrate(db);
});
afterEach(async () => {
  await db.close();
});

test('v10 升级保留书籍、小结和配置，重复迁移不改内容', async () => {
  await db.close();
  db = openMemoryDb();
  for (const migration of migrations.slice(0, 10)) {
    for (const sql of migration) {
      await db.run(sql);
    }
  }
  await db.run('PRAGMA user_version = 10');
  await ensureSample(db, monday.toISOString());
  await studyRepo.saveSummary(
    db,
    SAMPLE_BOOK_ID,
    '1.1',
    '已有小结',
    monday.toISOString(),
  );
  expect(await migrate(db)).toEqual({ from: 10, to: 11 });
  expect(await migrate(db)).toEqual({ from: 11, to: 11 });
  expect((await studyRepo.noteOf(db, SAMPLE_BOOK_ID, '1.1'))?.summary).toBe(
    '已有小结',
  );
  expect(await learning.loadPlan(db)).toEqual(DEFAULT_PLAN);
});

test('并发重复提交只计一次，改变选项不能改写已提交的答案', async () => {
  await Promise.all(
    Array.from({ length: 5 }, () =>
      learning.recordAnswer(db, 'run', 'returns-1', 0, monday),
    ),
  );
  await learning.recordAnswer(db, 'run', 'returns-1', 1, monday);
  const answers = await learning.loadAttempts(db);
  expect(answers).toHaveLength(1);
  expect(answers[0]).toMatchObject({
    correct: false,
    choice: 0,
    day: '2026-11-02',
  });
  expect(quizQuestions('mistakes', answers).map(q => q.id)).toEqual([
    'returns-1',
  ]);
});

test('新轮答对后移出错题，旧记录仍进入周报分母', async () => {
  await learning.recordAnswer(db, 'a', 'returns-1', 0, monday);
  await learning.recordAnswer(db, 'b', 'returns-1', 1, monday);
  const data = await learning.loadLearning(db);
  expect(quizQuestions('mistakes', data.attempts)).toHaveLength(0);
  expect(conceptProgress('returns', data.attempts)).toMatchObject({
    answered: 1,
    correct: 1,
    passed: false,
  });
  expect(weeklyReport(data, '2026-11-02')).toMatchObject({
    attempts: 2,
    correct: 1,
    accuracy: 50,
    activeDays: 1,
  });
  await learning.recordAnswer(db, 'c', 'returns-2', 2, monday);
  expect(
    conceptProgress('returns', await learning.loadAttempts(db)).passed,
  ).toBe(true);
});

test('诊断覆盖所有概念，第二轮先选未答题', async () => {
  const first = quizQuestions('diagnostic', []);
  expect(new Set(first.map(q => q.conceptId)).size).toBe(8);
  for (const q of first) {
    await learning.recordAnswer(db, 'first', q.id, q.answer, monday);
  }
  const next = quizQuestions('diagnostic', await learning.loadAttempts(db));
  expect(next.every(q => !first.some(f => f.id === q.id))).toBe(true);
  expect(quizQuestions('concept', [], 'ic').map(q => q.id)).toEqual([
    'ic-1',
    'ic-2',
  ]);
});

test.each([
  ['missing', 0],
  ['returns-1', -1],
  ['returns-1', 3],
  ['returns-1', 0.5],
])('拒绝无效作答 %s %s', async (id, choice) => {
  await expect(
    learning.recordAnswer(db, 'run', String(id), Number(choice), monday),
  ).rejects.toThrow('有效答案');
  expect(await learning.loadAttempts(db)).toHaveLength(0);
});

test('切换目标不重置作答或收藏，计划绑定真实书籍', async () => {
  await ensureSample(db, monday.toISOString());
  await learning.recordAnswer(db, 'r', 'ic-1', 2, monday);
  await learning.setConceptSaved(db, 'ic', true);
  await learning.savePlan(db, {
    goal: 'research',
    minutes: 40,
    days: 3,
    bookId: SAMPLE_BOOK_ID,
  });
  const data = await learning.loadLearning(db);
  expect(data.plan).toMatchObject({ goal: 'research', bookId: SAMPLE_BOOK_ID });
  expect(data.attempts).toHaveLength(1);
  expect(data.saved).toEqual(['ic']);
  await learning.setConceptSaved(db, 'ic', false);
  expect((await learning.loadLearning(db)).saved).toEqual([]);
  await expect(
    learning.savePlan(db, { ...DEFAULT_PLAN, bookId: 'missing' }),
  ).rejects.toThrow('重新选择');
});

test('书被删后手记的来源快照仍保留，也可以继续编辑', async () => {
  await ensureSample(db, monday.toISOString());
  const draft = {
    ...emptyResearch('momentum'),
    title: '  动量假设  ',
    hypothesis: '20 日动量能解释下一周截面收益吗？',
    source: {
      bookId: SAMPLE_BOOK_ID,
      sectionId: '3.1',
      bookTitle: '未核对标题',
      sectionTitle: '未核对小节',
    },
  };
  await learning.saveResearch(db, draft, monday);
  const note = (await learning.getResearch(db, draft.id))!;
  expect(note.source).toMatchObject({
    bookTitle: '因子投资入门',
    sectionTitle: '动量因子',
  });
  expect(note.title).toBe('动量假设');
  await bookRepo.deleteBook(db, SAMPLE_BOOK_ID);
  await learning.saveResearch(
    db,
    { ...note, conclusion: '暂不支持，需要换区间验证' },
    new Date(2026, 10, 3, 12),
  );
  const updated = (await learning.getResearch(db, draft.id))!;
  expect(updated.createdDay).toBe('2026-11-02');
  expect(updated.updatedDay).toBe('2026-11-03');
  expect(updated.source?.bookTitle).toBe('因子投资入门');
  await learning.deleteResearch(db, draft.id);
  expect(await learning.getResearch(db, draft.id)).toBeNull();
});

test('无效新来源或缺少假设不产生半条手记', async () => {
  const draft = emptyResearch();
  await expect(
    learning.saveResearch(db, { ...draft, title: '测试' }),
  ).rejects.toThrow('研究假设');
  await expect(
    learning.saveResearch(db, {
      ...draft,
      title: '测试',
      hypothesis: '假设',
      source: {
        bookId: 'missing',
        sectionId: '1',
        bookTitle: '未知',
        sectionTitle: '未知',
      },
    }),
  ).rejects.toThrow('来源');
  expect(await learning.loadResearch(db)).toEqual([]);
});

test('今日建议遵守时间预算，正确作答后不重复显示基础练习，新建手记后不重复建议新建', async () => {
  for (const minutes of [10, 20, 40] as const) {
    for (const goal of ['foundation', 'factor', 'research'] as const) {
      const data: LearningData = {
        plan: { ...DEFAULT_PLAN, minutes, goal },
        attempts: [],
        notes: [],
        saved: [],
      };
      const tasks = todayTasks(data, '2026-11-02', 5);
      expect(tasks.reduce((n, t) => n + t.minutes, 0)).toBeLessThanOrEqual(
        minutes,
      );
      expect(tasks[0].kind).toBe('review');
    }
  }
  await learning.recordAnswer(db, 'run', 'returns-1', 1, monday);
  await learning.saveResearch(
    db,
    { ...emptyResearch(), title: '测试假设', hypothesis: '某现象可以重复吗' },
    monday,
  );
  const tasks = todayTasks(await learning.loadLearning(db), '2026-11-02', 0);
  expect(tasks.map(t => t.kind)).toEqual(['read']);
});

test('周报按本地周一开始，跨年不混入上周或未来记录，无答案时没有虚构正确率', async () => {
  expect(weekStart('2027-01-01')).toBe('2026-12-28');
  expect(weekStart('2026-11-08')).toBe('2026-11-02');
  expect(localDay(new Date(2026, 10, 2, 0, 1))).toBe('2026-11-02');
  const empty = await learning.loadLearning(db);
  expect(weeklyReport(empty, '2026-11-02').accuracy).toBeNull();
  await learning.recordAnswer(
    db,
    'before',
    'returns-1',
    1,
    new Date(2026, 10, 1, 23),
  );
  await learning.recordAnswer(db, 'today', 'returns-1', 0, monday);
  await learning.recordAnswer(
    db,
    'future',
    'returns-1',
    1,
    new Date(2026, 10, 3, 1),
  );
  const report = weeklyReport(await learning.loadLearning(db), '2026-11-02');
  expect(report).toMatchObject({
    attempts: 1,
    correct: 0,
    accuracy: 0,
    activeDays: 1,
  });
  expect(report.weak.map(c => c.id)).toEqual(['returns']);
});

test('导出保留来源、假设和自查依据，陪练只携带选中材料', async () => {
  const draft = {
    ...emptyResearch('ic'),
    title: 'IC 验证',
    hypothesis: 'IC 稳定吗',
    evidence: '单月 0.05',
    checks: { timing: '收盘后计算', universe: '', cost: '', holdout: '' },
  };
  await learning.saveResearch(db, draft, monday);
  const data = await learning.loadLearning(db),
    note = data.notes[0];
  const output = reportMarkdown(data, '2026-11-02');
  expect(output).toContain('单月 0.05');
  expect(output).toContain('收盘后计算');
  expect(output).toContain('正确率 暂无');
  const coach = coachMaterial(undefined, note);
  expect(coach.material).toContain('IC 验证');
  expect(coach.question).toContain('一次只问一个问题');
  expect(coachMaterial('returns').material).not.toContain('IC 验证');
});

test('所有教材链接都指向可读小节，题库选择及先修引用有效', async () => {
  await ensureSample(db, monday.toISOString());
  const sections = await bookRepo.sections(db, SAMPLE_BOOK_ID);
  expect(new Set(QUESTIONS.map(q => q.id)).size).toBe(QUESTIONS.length);
  for (const c of CONCEPTS) {
    expect(sections.some(s => s.id === c.sectionId && s.leaf)).toBe(true);
    expect(c.prerequisites.every(id => CONCEPTS.some(x => x.id === id))).toBe(
      true,
    );
    expect(QUESTIONS.filter(q => q.conceptId === c.id)).toHaveLength(2);
  }
  for (const q of QUESTIONS) {
    expect(q.options[q.answer]).toBeTruthy();
  }
  expect(CHECKS).toHaveLength(4);
});
