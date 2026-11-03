import { useNavigation } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { SAMPLE_BOOK_ID } from '../../book/sample';
import { loadLearning, setConceptSaved } from '../../data/learningRepo';
import { CONCEPTS, GOALS, conceptById } from '../../learning/catalog';
import { conceptProgress } from '../../learning/progress';
import { Button, Segmented } from '../components/ui';
import { useCore } from '../hooks';
import type { RootScreenProps } from '../navigation/types';
import {
  ActionError,
  Entry,
  Heading,
  Input,
  LearningPage,
  LoadState,
  ls,
  useAction,
  useResource,
  type LearningNav,
} from './shared';

export function KnowledgeScreen() {
  const core = useCore(),
    nav = useNavigation<LearningNav>();
  const r = useResource(useCallback(() => loadLearning(core.db), [core]));
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState<'all' | 'saved' | 'weak'>('all');
  const needle = query.trim().toLowerCase();
  const concepts = CONCEPTS.filter(c =>
    (c.title + ' ' + c.english + ' ' + c.definition + ' ' + c.formula)
      .toLowerCase()
      .includes(needle),
  ).filter(
    c =>
      filter === 'all' ||
      (filter === 'saved'
        ? r.data?.saved.includes(c.id)
        : conceptProgress(c.id, r.data?.attempts ?? []).wrong > 0),
  );
  return (
    <LearningPage title="知识地图" sub="从收益风险，到因子研究">
      <Input
        label="搜索概念"
        value={query}
        onChange={setQuery}
        hint="输入中文、英文或公式关键词"
        multiline={false}
        maxLength={100}
      />
      <Segmented
        items={[
          ['all', '全部'],
          ['saved', '收藏'],
          ['weak', '待巩固'],
        ]}
        value={filter}
        onChange={setFilter}
      />
      <LoadState error={r.error} loading={!r.data} reload={r.reload} />
      {r.data && !concepts.length ? (
        <View style={ls.block}>
          <Text style={ls.body}>
            {query
              ? '没有匹配的概念'
              : filter === 'saved'
              ? '还没有收藏概念'
              : '暂无已记录错题，未测概念可以先做基础诊断'}
          </Text>
          <Button
            title="查看全部概念"
            onPress={() => {
              setQuery('');
              setFilter('all');
            }}
          />
        </View>
      ) : null}
      {r.data
        ? (Object.keys(GOALS) as Array<keyof typeof GOALS>).map(group => {
            const list = concepts.filter(c => c.group === group);
            return list.length ? (
              <View key={group}>
                <Heading>{GOALS[group].title}</Heading>
                {list.map(c => (
                  <Entry
                    key={c.id}
                    title={c.title}
                    detail={
                      c.english +
                      ' · ' +
                      conceptProgress(c.id, r.data!.attempts).label
                    }
                    onPress={() => nav.navigate('Concept', { id: c.id })}
                  />
                ))}
              </View>
            ) : null;
          })
        : null}
    </LearningPage>
  );
}

export function ConceptScreen({ route }: RootScreenProps<'Concept'>) {
  const core = useCore(),
    nav = useNavigation<LearningNav>();
  const r = useResource(useCallback(() => loadLearning(core.db), [core]));
  const a = useAction(),
    c = conceptById(route.params.id);
  if (!c) {
    return (
      <LearningPage title="概念不可用">
        <Text style={ls.body}>请返回知识地图选择概念。</Text>
      </LearningPage>
    );
  }
  const saved = r.data?.saved.includes(c.id) ?? false;
  return (
    <LearningPage title={c.title} sub={c.english}>
      <Text style={ls.body}>{c.definition}</Text>
      <View style={ls.inset}>
        <Text selectable style={ls.body}>
          {c.formula}
        </Text>
      </View>
      <Heading>用一个例子理解</Heading>
      <Text style={ls.body}>{c.example}</Text>
      <Heading>最容易混淆的地方</Heading>
      <Text style={ls.body}>{c.pitfall}</Text>
      {c.prerequisites.length ? (
        <>
          <Heading>先把这些弄清楚</Heading>
          {c.prerequisites.map(id => (
            <Entry
              key={id}
              title={conceptById(id)!.title}
              onPress={() => nav.push('Concept', { id })}
            />
          ))}
        </>
      ) : null}
      <LoadState error={r.error} loading={!r.data} reload={r.reload} />
      {r.data ? (
        <>
          <Heading>检验理解</Heading>
          <Text style={ls.muted}>
            {conceptProgress(c.id, r.data.attempts).label} ·
            按每题最近一次作答判断
          </Text>
          <Button
            title="做两道练习"
            tone="learn"
            onPress={() =>
              nav.navigate('QuantQuiz', { mode: 'concept', conceptId: c.id })
            }
          />
          <Button
            title={saved ? '取消收藏' : '收藏这个概念'}
            disabled={a.busy}
            onPress={() =>
              a.run(async () => {
                await setConceptSaved(core.db, c.id, !saved);
                r.reload();
              })
            }
          />
        </>
      ) : null}
      <ActionError error={a.error} />
      <Entry
        title="回到教材原文"
        detail={'《因子投资入门》 · ' + c.sectionId + ' · 内置教材'}
        onPress={() =>
          nav.navigate('Study', {
            bookId: SAMPLE_BOOK_ID,
            sectionId: c.sectionId,
            mode: 'read',
          })
        }
      />
      <Entry
        title="请 AI 陪我练习"
        detail="先预览问题，再开始逐问练习"
        onPress={() => nav.navigate('LearningCoach', { conceptId: c.id })}
      />
      <Entry
        title="写一个研究假设"
        detail="用这个概念设计验证方法"
        onPress={() => nav.navigate('ResearchEdit', { conceptId: c.id })}
      />
    </LearningPage>
  );
}
