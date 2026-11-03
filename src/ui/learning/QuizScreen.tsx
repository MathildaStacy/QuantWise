import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { loadAttempts, recordAnswer } from '../../data/learningRepo';
import { conceptById } from '../../learning/catalog';
import { newLearningId, quizQuestions } from '../../learning/progress';
import type { Question } from '../../learning/types';
import { Button } from '../components/ui';
import { useCore } from '../hooks';
import type { RootScreenProps } from '../navigation/types';
import {
  ActionError,
  Choice,
  Entry,
  Heading,
  LearningPage,
  LoadState,
  ls,
  useAction,
  useResource,
  type LearningNav,
} from './shared';

export function QuantQuizScreen({ route }: RootScreenProps<'QuantQuiz'>) {
  const core = useCore(),
    nav = useNavigation<LearningNav>();
  const { mode, conceptId } = route.params;
  const r = useResource(useCallback(() => loadAttempts(core.db), [core]));
  const [queue, setQueue] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0),
    [choice, setChoice] = useState<number | null>(null),
    [submitted, setSubmitted] = useState(false);
  const [correct, setCorrect] = useState(0),
    [runId, setRunId] = useState(newLearningId);
  const a = useAction(),
    once = useRef(false);
  const previous = useRef('');
  // 同一栈页面被 navigate 复用时也开启独立一轮；从概念页返回则保留当前轮。
  const key = mode + ':' + (conceptId ?? '');
  useEffect(() => {
    if (previous.current !== key) {
      previous.current = key;
      setQueue(null);
      setIndex(0);
      setChoice(null);
      setSubmitted(false);
      setCorrect(0);
      setRunId(newLearningId());
      once.current = false;
    }
  }, [key]);
  useEffect(() => {
    if (r.data && !queue) {
      setQueue(quizQuestions(mode, r.data, conceptId));
    }
  }, [r.data, queue, mode, conceptId]);
  const q = queue?.[index];
  const submit = () =>
    a.run(async () => {
      if (!q || choice == null || once.current) {
        return;
      }
      await recordAnswer(core.db, runId, q.id, choice);
      once.current = true;
      setSubmitted(true);
      setCorrect(v => v + (choice === q.answer ? 1 : 0));
    });
  const title =
    mode === 'mistakes'
      ? '错题再练'
      : mode === 'concept'
      ? '概念练习'
      : '基础诊断';
  return (
    <LearningPage
      key={q?.id ?? 'result'}
      title={title}
      sub={q ? '第 ' + (index + 1) + ' / ' + queue!.length + ' 题' : undefined}
    >
      <LoadState error={r.error} loading={!queue} reload={r.reload} />
      {queue && !queue.length ? (
        <>
          <Heading>当前没有待练题目</Heading>
          <Text style={ls.body}>
            答错的题会自动加入这里；答对后移出，历史作答仍保留。
          </Text>
          <Entry title="去知识地图" onPress={() => nav.navigate('Knowledge')} />
        </>
      ) : null}
      {queue?.length && !q ? (
        <>
          <Text style={ls.hero}>这一轮完成了</Text>
          <Text style={ls.body}>
            答对 {correct} / {queue.length} 题
          </Text>
          <Text style={ls.muted}>
            {correct < queue.length
              ? '错题已加入待练列表，可以先回顾概念，再换一轮练习。'
              : '继续用不同例子检验理解，也可以把一个想法写成研究假设。'}
          </Text>
          <Button
            title="查看知识地图"
            tone="learn"
            onPress={() => nav.navigate('Knowledge')}
          />
          <Button title="返回上一页" onPress={() => nav.goBack()} />
        </>
      ) : null}
      {q ? (
        <View key={q.id} style={ls.block}>
          <Text style={ls.muted}>{conceptById(q.conceptId)!.title}</Text>
          <Text style={ls.heading}>{q.prompt}</Text>
          {q.options.map((option, i) =>
            submitted ? (
              <View
                key={option}
                style={[
                  ls.choice,
                  (i === q.answer || i === choice) && ls.selected,
                ]}
              >
                <Text style={ls.body}>
                  {String.fromCharCode(65 + i)}. {option}
                </Text>
                {i === q.answer ? <Text style={ls.link}>正确答案</Text> : null}
                {i === choice ? <Text style={ls.muted}>你的选择</Text> : null}
              </View>
            ) : (
              <Choice
                key={option}
                title={String.fromCharCode(65 + i) + '. ' + option}
                selected={choice === i}
                onPress={() => {
                  if (!a.busy) {
                    setChoice(i);
                  }
                }}
              />
            ),
          )}
          <ActionError error={a.error} />
          {!submitted ? (
            <Button
              title={a.busy ? '正在记录…' : '提交答案'}
              disabled={choice == null || a.busy}
              tone="learn"
              onPress={submit}
            />
          ) : (
            <>
              <View style={ls.inset}>
                <Text style={ls.title}>
                  {choice === q.answer ? '答对了' : '再看一下推导'}
                </Text>
                <Text style={ls.body}>{q.explanation}</Text>
              </View>
              <Entry
                title="回顾这个概念"
                onPress={() => nav.navigate('Concept', { id: q.conceptId })}
              />
              <Button
                title={index + 1 === queue!.length ? '查看本轮结果' : '下一题'}
                tone="learn"
                onPress={() => {
                  setIndex(v => v + 1);
                  setChoice(null);
                  setSubmitted(false);
                  once.current = false;
                }}
              />
            </>
          )}
        </View>
      ) : null}
    </LearningPage>
  );
}
