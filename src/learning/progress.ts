import {
  CHECKS,
  CONCEPTS,
  GOALS,
  ORDER,
  QUESTIONS,
  conceptById,
} from './catalog';
import type {
  Attempt,
  ConceptId,
  LearningData,
  LearningPlan,
  ResearchDraft,
  ResearchNote,
} from './types';

export const DEFAULT_PLAN: LearningPlan = {
  goal: 'foundation',
  minutes: 20,
  days: 5,
  bookId: null,
};
export const localDay = (date = new Date()): string =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

export function latestAnswers(attempts: Attempt[]): Map<string, Attempt> {
  const out = new Map<string, Attempt>();
  for (const a of attempts) {
    if (!out.has(a.questionId) || out.get(a.questionId)!.id < a.id) {
      out.set(a.questionId, a);
    }
  }
  return out;
}

export function conceptProgress(id: ConceptId, attempts: Attempt[]) {
  const latest = latestAnswers(attempts);
  const questions = QUESTIONS.filter(q => q.conceptId === id);
  const answered = questions.filter(q => latest.has(q.id)).length;
  const correct = questions.filter(q => latest.get(q.id)?.correct).length;
  const wrong = questions.filter(
    q => latest.has(q.id) && !latest.get(q.id)!.correct,
  ).length;
  return {
    answered,
    correct,
    total: questions.length,
    wrong,
    passed: correct === questions.length,
    label: wrong
      ? '需要巩固'
      : correct === questions.length
      ? '已通过 ' + correct + ' 题'
      : answered
      ? '已答 ' + answered + '/' + questions.length
      : '尚未测验',
  };
}

export type QuizMode = 'diagnostic' | 'concept' | 'mistakes';
export function quizQuestions(
  mode: QuizMode,
  attempts: Attempt[],
  conceptId?: ConceptId,
) {
  const latest = latestAnswers(attempts);
  if (mode === 'mistakes') {
    return QUESTIONS.filter(
      q => latest.has(q.id) && !latest.get(q.id)!.correct,
    );
  }
  if (mode === 'concept') {
    return QUESTIONS.filter(q => q.conceptId === conceptId);
  }
  // 每个概念一题：未答优先，其次错题，再取最久未练的题。
  return CONCEPTS.map(
    c =>
      QUESTIONS.filter(q => q.conceptId === c.id).sort((a, b) => {
        const aa = latest.get(a.id),
          bb = latest.get(b.id);
        const rank = (x: Attempt | undefined) => (!x ? 0 : !x.correct ? 1 : 2);
        return rank(aa) - rank(bb) || (aa?.id ?? 0) - (bb?.id ?? 0);
      })[0],
  );
}

export function nextConcept(data: LearningData): ConceptId {
  const order = ORDER[data.plan.goal];
  return (
    order.find(id => conceptProgress(id, data.attempts).wrong > 0) ??
    order.find(id => !conceptProgress(id, data.attempts).passed) ??
    order[0]
  );
}

export interface LearningTask {
  kind: 'quiz' | 'mistakes' | 'read' | 'review' | 'research';
  title: string;
  detail: string;
  minutes: number;
}
export function todayTasks(
  data: LearningData,
  day: string,
  due: number,
): LearningTask[] {
  const next = conceptById(nextConcept(data))!;
  const mistakes = quizQuestions('mistakes', data.attempts).length;
  const tasks: LearningTask[] = [];
  if (due) {
    tasks.push({
      kind: 'review',
      title: '复习到期闪卡',
      detail: due + ' 张到期 · 使用已有复习安排',
      minutes: 5,
    });
  }
  if (mistakes) {
    tasks.push({
      kind: 'mistakes',
      title: '把错题再做一遍',
      detail: mistakes + ' 道待订正',
      minutes: 5,
    });
  } else if (!data.attempts.some(a => a.day === day)) {
    tasks.push({
      kind: 'quiz',
      title: '练习「' + next.title + '」',
      detail: '先独立作答，再看推导',
      minutes: 5,
    });
  }
  const research: LearningTask = {
    kind: 'research',
    title: '写下一条可验证的假设',
    detail: '从书中观点开始，记录验证方法',
    minutes: data.plan.minutes === 40 ? 15 : 5,
  };
  const read: LearningTask = {
    kind: 'read',
    title: '读一节，再用自己的话解释',
    detail: '继续计划书籍，或阅读对应概念原文',
    minutes: data.plan.minutes === 40 ? 15 : data.plan.minutes === 20 ? 10 : 5,
  };
  const candidates =
    data.plan.goal === 'research' ? [research, read] : [read, research];
  tasks.push(
    ...candidates.filter(
      t => t.kind !== 'research' || !data.notes.some(n => n.createdDay === day),
    ),
  );
  let remaining = data.plan.minutes;
  return tasks.filter(t => {
    if (t.minutes > remaining) {
      return false;
    }
    remaining -= t.minutes;
    return true;
  });
}

export function weekStart(day: string): string {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function weeklyReport(data: LearningData, day: string) {
  const start = weekStart(day);
  const within = (d: string) => d >= start && d <= day;
  const attempts = data.attempts.filter(a => within(a.day));
  const created = data.notes.filter(n => within(n.createdDay));
  const notes = data.notes.filter(n => within(n.updatedDay));
  const activeDays = new Set([
    ...attempts.map(a => a.day),
    ...created.map(n => n.createdDay),
  ]).size;
  const correct = attempts.filter(a => a.correct).length;
  const weak = CONCEPTS.filter(
    c =>
      conceptProgress(
        c.id,
        data.attempts.filter(a => a.day <= day),
      ).wrong,
  );
  return {
    start,
    end: day,
    attempts: attempts.length,
    correct,
    accuracy: attempts.length
      ? Math.round((correct / attempts.length) * 100)
      : null,
    activeDays,
    created: created.length,
    notes,
    weak,
  };
}

export const newLearningId = () =>
  Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
export const emptyResearch = (
  conceptId: ConceptId | null = null,
): ResearchDraft => ({
  id: newLearningId(),
  title: '',
  hypothesis: '',
  method: '',
  evidence: '',
  conclusion: '',
  nextStep: '',
  conceptId,
  source: null,
  checks: { timing: '', universe: '', cost: '', holdout: '' },
});
export const checkCount = (note: ResearchDraft) =>
  CHECKS.filter(c => note.checks[c.id].trim()).length;

export function researchMarkdown(note: ResearchNote): string {
  const source = note.source
    ? '《' + note.source.bookTitle + '》 · ' + note.source.sectionTitle
    : '未关联书籍';
  return [
    '## ' + note.title,
    '',
    '来源：' + source,
    '概念：' + (conceptById(note.conceptId ?? '')?.title ?? '未关联'),
    '创建：' + note.createdDay + ' · 更新：' + note.updatedDay,
    '',
    ...(
      [
        ['假设', note.hypothesis],
        ['验证方法', note.method],
        ['观察证据', note.evidence],
        ['结论', note.conclusion],
        ['下一步', note.nextStep],
      ] as const
    ).flatMap(([label, value]) => [
      '### ' + label,
      '',
      value || '尚未记录',
      '',
    ]),
    '### 实验自查依据',
    '',
    ...CHECKS.flatMap(c => [
      '**' + c.title + '**',
      '',
      note.checks[c.id] || '待补充',
      '',
    ]),
  ].join('\n');
}

export function reportMarkdown(data: LearningData, day: string): string {
  const r = weeklyReport(data, day);
  return [
    '# QuantWise 学习周报',
    '',
    r.start + ' 至 ' + r.end,
    '',
    '学习目标：' + GOALS[data.plan.goal].title,
    '计划：每次 ' +
      data.plan.minutes +
      ' 分钟 / 每周 ' +
      data.plan.days +
      ' 天（计划值，不是实测时长）',
    '活跃：' + r.activeDays + ' 天（作答或新建研究手记）',
    '作答：' +
      r.attempts +
      ' 次，其中答对 ' +
      r.correct +
      ' 次；正确率 ' +
      (r.accuracy == null ? '暂无' : r.accuracy + '%'),
    '本周新建研究：' + r.created + ' 篇',
    '',
    '## 当前需要巩固',
    '',
    r.weak.map(c => '- ' + c.title).join('\n') ||
      '暂无已记录错题；未测概念仍需练习。',
    '',
    '## 本周更新的研究',
    '',
    ...r.notes.map(researchMarkdown),
    ...(!r.notes.length ? ['本周暂无研究手记。'] : []),
  ].join('\n');
}

export function coachMaterial(
  conceptId?: ConceptId,
  note?: ResearchNote | null,
): { question: string; material: string } {
  const concept = conceptById(conceptId ?? note?.conceptId ?? '');
  return {
    question: note
      ? '请作为我的量化研究教练，一次只问一个问题。先指出这个假设最需要澄清的地方，再追问证据、反例与验证方法。不要代替我下结论，也不要把自查记录当成已验证的事实。'
      : '请用苏格拉底式方法帮我掌握这个概念：先出一道与材料不同的小题，等我回答后再判断理解是否准确，逐步提示并要求我解释。一次只问一个问题，不先给答案。',
    material: [
      ...(concept
        ? [
            '学习概念：' + concept.title,
            concept.definition,
            '公式口径：' + concept.formula,
            '教学例子：' + concept.example,
            '常见误区：' + concept.pitfall,
          ]
        : []),
      ...(note
        ? [
            '以下是用户的研究记录，不是经过验证的实验结果：',
            '研究标题：' + note.title,
            ...(note.source
              ? [
                  '来源：《' +
                    note.source.bookTitle +
                    '》 · ' +
                    note.source.sectionTitle,
                ]
              : []),
            ...(
              [
                ['假设', note.hypothesis],
                ['验证方法', note.method],
                ['观察证据', note.evidence],
                ['结论', note.conclusion],
                ['下一步', note.nextStep],
              ] as const
            )
              .filter(([, value]) => value.trim())
              .map(([label, value]) => label + '：' + value),
            ...CHECKS.filter(c => note.checks[c.id].trim()).map(
              c => c.title + '自查：' + note.checks[c.id],
            ),
            ...(checkCount(note) === 0 ? ['尚未记录实验自查依据。'] : []),
          ]
        : []),
    ].join('\n\n'),
  };
}
