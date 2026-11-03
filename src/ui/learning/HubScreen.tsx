import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import * as bookRepo from '../../data/bookRepo';
import * as studyRepo from '../../data/studyRepo';
import { loadLearning, savePlan } from '../../data/learningRepo';
import { SAMPLE_BOOK_ID } from '../../book/sample';
import { CONCEPTS, GOALS, conceptById } from '../../learning/catalog';
import {
  conceptProgress,
  localDay,
  nextConcept,
  quizQuestions,
  todayTasks,
  weeklyReport,
  type LearningTask,
} from '../../learning/progress';
import type { LearningPlan } from '../../learning/types';
import { beijingIso } from '../../market/clock';
import { Button } from '../components/ui';
import { useCore } from '../hooks';
import { toast } from '../toast';
import {
  ActionError,
  Choice,
  Entry,
  Heading,
  LearningPage,
  LoadState,
  UnsavedGuard,
  ls,
  useAction,
  useResource,
  type LearningNav,
} from './shared';

export function LearningHubView() {
  const core = useCore(),
    nav = useNavigation<LearningNav>();
  const loader = useCallback(async () => {
    const [learning, cards] = await Promise.all([
      loadLearning(core.db),
      studyRepo.cards(core.db),
    ]);
    const book = learning.plan.bookId
      ? await bookRepo.book(core.db, learning.plan.bookId)
      : null;
    return {
      learning,
      book,
      due: cards.filter(c => c.due <= beijingIso().slice(0, 10)).length,
    };
  }, [core]);
  const r = useResource(loader),
    action = useAction();
  const d = r.data?.learning,
    day = localDay();
  const openTask = (t: LearningTask) =>
    action.run(async () => {
      if (!d) {
        return;
      }
      const conceptId = nextConcept(d);
      if (t.kind === 'quiz' || t.kind === 'mistakes') {
        nav.navigate('QuantQuiz', {
          mode: t.kind === 'mistakes' ? 'mistakes' : 'concept',
          conceptId,
        });
      } else if (t.kind === 'review') {
        nav.navigate('ReviewRun');
      } else if (t.kind === 'research') {
        nav.navigate('ResearchEdit', { conceptId });
      } else {
        const b = r.data?.book;
        if (b?.status === 'ready') {
          const state = await studyRepo.getState(core.db, b.id);
          nav.navigate('Study', {
            bookId: b.id,
            sectionId: state?.main,
            mode: 'read',
          });
        } else {
          nav.navigate('Study', {
            bookId: SAMPLE_BOOK_ID,
            sectionId: conceptById(conceptId)!.sectionId,
            mode: 'read',
          });
        }
      }
    });
  const report = d ? weeklyReport(d, day) : null;
  return (
    <ScrollView
      style={ls.page}
      contentContainerStyle={[ls.content, ls.hubContent]}
    >
      <LoadState error={r.error} loading={!d} reload={r.reload} />
      {d && report ? (
        <>
          <Text style={ls.hero}>把读过的知识，变成自己的方法</Text>
          <Entry
            title={GOALS[d.plan.goal].title}
            detail={
              '每次 ' +
              d.plan.minutes +
              ' 分钟 · 每周 ' +
              d.plan.days +
              ' 天 · 调整计划'
            }
            onPress={() => nav.navigate('LearningPlan')}
          />
          <Heading>今天从这里开始</Heading>
          <Text style={ls.muted}>
            预计用时按计划安排；已提交答案会自动记录。
          </Text>
          {d.plan.bookId ? (
            <Text style={ls.muted}>
              {r.data?.book?.status === 'ready'
                ? '计划书籍：《' + r.data.book.title + '》'
                : '计划书籍暂不可读，先用内置教材继续；可在计划中换书。'}
            </Text>
          ) : null}
          {todayTasks(d, day, r.data!.due).map(t => (
            <Entry
              key={t.kind}
              title={t.title}
              detail={t.detail}
              trailing={t.minutes + ' 分钟'}
              onPress={() => openTask(t)}
            />
          ))}
          <ActionError error={action.error} />
          <Heading>理解、练习、研究</Heading>
          <Entry
            title="知识地图"
            detail={
              CONCEPTS.filter(c => conceptProgress(c.id, d.attempts).passed)
                .length + ' / 8 个概念通过练习 · 中英搜索与收藏'
            }
            onPress={() => nav.navigate('Knowledge')}
          />
          <Entry
            title="基础诊断"
            detail="8 道题，发现当前薄弱点"
            onPress={() => nav.navigate('QuantQuiz', { mode: 'diagnostic' })}
          />
          <Entry
            title="错题再练"
            detail={
              quizQuestions('mistakes', d.attempts).length +
              ' 道待订正 · 答对后自动移出'
            }
            onPress={() => nav.navigate('QuantQuiz', { mode: 'mistakes' })}
          />
          <Entry
            title="研究手记"
            detail={
              d.notes.length
                ? d.notes.length + ' 篇假设与验证记录'
                : '把书中观点变成第一个可验证假设'
            }
            onPress={() => nav.navigate('ResearchNotes')}
          />
          <Heading>本周进展</Heading>
          <Text style={ls.body}>
            活跃 {report.activeDays} / 计划 {d.plan.days} 天
          </Text>
          <Text style={ls.muted}>
            按作答和新建手记统计。
            {report.attempts
              ? '已答 ' +
                report.attempts +
                ' 次，答对 ' +
                report.correct +
                ' 次。'
              : '完成一次练习，就会留下第一条学习记录。'}
          </Text>
          <Entry
            title="查看学习周报"
            detail="薄弱点、研究记录与 Markdown 导出"
            onPress={() => nav.navigate('LearningReport')}
          />
        </>
      ) : null}
    </ScrollView>
  );
}

export function LearningPlanScreen() {
  const core = useCore();
  const r = useResource(
    useCallback(
      async () => ({
        learning: await loadLearning(core.db),
        books: (await bookRepo.books(core.db)).filter(
          b => b.status === 'ready',
        ),
      }),
      [core],
    ),
  );
  const [plan, setPlan] = useState<LearningPlan | null>(null),
    [baseline, setBaseline] = useState('');
  const a = useAction();
  useEffect(() => {
    if (r.data && !plan) {
      setPlan(r.data.learning.plan);
      setBaseline(JSON.stringify(r.data.learning.plan));
    }
  }, [r.data, plan]);
  const patch = (p: Partial<LearningPlan>) =>
    setPlan(v => (v ? { ...v, ...p } : v));
  return (
    <LearningPage title="个人学习计划">
      <LoadState error={r.error} loading={!plan} reload={r.reload} />
      {plan ? (
        <>
          <Heading>当前更想做好什么</Heading>
          {(Object.keys(GOALS) as LearningPlan['goal'][]).map(goal => (
            <Choice
              key={goal}
              title={GOALS[goal].title}
              detail={GOALS[goal].description}
              selected={plan.goal === goal}
              onPress={() => patch({ goal })}
            />
          ))}
          <Heading>每次预留的时间</Heading>
          {([10, 20, 40] as const).map(minutes => (
            <Choice
              key={minutes}
              title={minutes + ' 分钟'}
              selected={plan.minutes === minutes}
              onPress={() => patch({ minutes })}
            />
          ))}
          <Heading>每周学习频率</Heading>
          {([3, 5, 7] as const).map(days => (
            <Choice
              key={days}
              title={days + ' 天'}
              selected={plan.days === days}
              onPress={() => patch({ days })}
            />
          ))}
          <Heading>计划阅读的书</Heading>
          <Choice
            title="跟随概念读内置教材"
            selected={!plan.bookId}
            onPress={() => patch({ bookId: null })}
          />
          {r.data?.books.map(b => (
            <Choice
              key={b.id}
              title={b.title}
              selected={plan.bookId === b.id}
              onPress={() => patch({ bookId: b.id })}
            />
          ))}
          {plan.bookId && !r.data?.books.some(b => b.id === plan.bookId) ? (
            <Text style={ls.error}>原书已移除或尚未解析完成，请换一本书。</Text>
          ) : null}
          <ActionError error={a.error} />
          <Button
            title={a.busy ? '正在保存…' : '保存计划'}
            tone="learn"
            disabled={a.busy}
            onPress={() =>
              a.run(async () => {
                await savePlan(core.db, plan);
                setBaseline(JSON.stringify(plan));
                toast.show('学习计划已保存');
              })
            }
          />
          <UnsavedGuard dirty={JSON.stringify(plan) !== baseline} />
        </>
      ) : null}
    </LearningPage>
  );
}
