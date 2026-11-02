import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { activeService, aiKeys, ask, newThread, useChat } from '../../ai/chat';
import { exportText } from '../../app/exportFile';
import { getResearch, loadLearning } from '../../data/learningRepo';
import {
  coachMaterial,
  localDay,
  reportMarkdown,
  weeklyReport,
} from '../../learning/progress';
import { Button } from '../components/ui';
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

export function LearningCoachScreen({
  route,
}: RootScreenProps<'LearningCoach'>) {
  const core = useCore(),
    nav = useNavigation<LearningNav>();
  const { noteId, conceptId } = route.params;
  const r = useResource(
    useCallback(async () => {
      const note = noteId ? await getResearch(core.db, noteId) : null;
      if (noteId && !note) {
        throw new Error('这篇手记已不存在，请返回重新选择');
      }
      return {
        ...coachMaterial(conceptId, note),
        service: await activeService(core),
      };
    }, [core, noteId, conceptId]),
  );
  const [question, setQuestion] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );
  const a = useAction(),
    chatBusy = useChat(s => s.busy);
  useEffect(() => {
    if (r.data && question === null) {
      setQuestion(r.data.question);
    }
  }, [r.data, question]);
  const send = () =>
    a.run(async () => {
      if (!r.data || !question?.trim()) {
        return;
      }
      if (useChat.getState().busy) {
        throw new Error('通用助手正在回答，请等这一轮结束后再开始陪练');
      }
      const svc = await activeService(core);
      if (!svc || !(await aiKeys().get(svc.id))) {
        throw new Error('请先配置可用的供应商、模型和 API Key，再返回发送');
      }
      newThread();
      // 不注册全页上下文；只提交预览中的材料。系统提示词与现有工具保持原样。
      await ask(core, {
        question: question.trim(),
        page: null,
        attach: { label: '本次量化陪练材料', text: r.data.material },
      });
      setSent(true);
      if (focused.current) {
        nav.navigate('Ai');
      }
    });
  return (
    <LearningPage title="AI 陪练" sub="预览问题与材料，准备好再发送">
      <LoadState error={r.error} loading={!r.data} reload={r.reload} />
      {r.data ? (
        <>
          <Text style={ls.body}>让 AI 先提问，再根据你的回答逐步提示。</Text>
          <Input
            label="发给 AI 的问题"
            value={question ?? ''}
            onChange={setQuestion}
          />
          <Heading>本次附带材料</Heading>
          <View style={ls.inset}>
            <Text selectable style={ls.body}>
              {r.data.material}
            </Text>
          </View>
          <Text style={ls.muted}>
            {r.data.service
              ? '使用：' + r.data.service.name + ' · ' + r.data.service.model
              : '尚未配置可用的 AI 模型'}
          </Text>
          <ActionError error={a.error} />
          {a.busy ? (
            <>
              <Text style={ls.muted} accessibilityLiveRegion="polite">
                {chatBusy || '正在准备陪练…'}
              </Text>
              <Button
                title="查看对话与停止生成"
                onPress={() => nav.navigate('Ai')}
              />
            </>
          ) : null}
          {sent ? (
            <Button
              title="继续陪练对话"
              tone="learn"
              onPress={() => nav.navigate('Ai')}
            />
          ) : (
            <Button
              title="发送并开始陪练"
              tone="learn"
              disabled={a.busy || !!chatBusy || !question?.trim()}
              onPress={send}
            />
          )}
          {chatBusy && !a.busy ? (
            <Text style={ls.muted}>
              通用助手正在回答，结束后可以开始新的陪练。
            </Text>
          ) : null}
          <Entry
            title="配置供应商与模型"
            detail="返回后保留当前问题"
            onPress={() => nav.navigate('AiServices')}
          />
        </>
      ) : null}
    </LearningPage>
  );
}

export function LearningReportScreen() {
  const core = useCore(),
    nav = useNavigation<LearningNav>();
  const r = useResource(useCallback(() => loadLearning(core.db), [core])),
    a = useAction();
  const day = localDay(),
    report = r.data ? weeklyReport(r.data, day) : null;
  return (
    <LearningPage
      title="学习周报"
      sub={report ? report.start + ' 至 ' + report.end : undefined}
    >
      <LoadState error={r.error} loading={!r.data} reload={r.reload} />
      {r.data && report ? (
        <>
          <Text style={ls.hero}>这一周，留下了哪些学习证据</Text>
          <Heading>学习节奏</Heading>
          <Text style={ls.body}>
            活跃 {report.activeDays} 天 / 每周计划 {r.data.plan.days} 天
          </Text>
          <Text style={ls.muted}>
            以设备本地日期统计本周作答或新建手记的天数。计划分钟数不计为实际投入。
          </Text>
          <Heading>练习反馈</Heading>
          <Text style={ls.body}>
            {report.attempts
              ? '作答 ' +
                report.attempts +
                ' 次 · 答对 ' +
                report.correct +
                ' 次 · 正确率 ' +
                report.accuracy +
                '%'
              : '本周还没有作答记录'}
          </Text>
          <Text style={ls.muted}>
            每次提交都计入，包括重做；知识地图按每题最近一次作答判断。
          </Text>
          <Heading>当前需要巩固</Heading>
          {report.weak.length ? (
            report.weak.map(c => (
              <Entry
                key={c.id}
                title={c.title}
                detail="回顾概念后，再做练习"
                onPress={() => nav.navigate('Concept', { id: c.id })}
              />
            ))
          ) : (
            <Text style={ls.muted}>
              暂无已记录错题；尚未测验的概念仍需练习。
            </Text>
          )}
          <Heading>研究沉淀</Heading>
          <Text style={ls.body}>
            本周新建 {report.created} 篇 · 更新 {report.notes.length} 篇
          </Text>
          {report.notes.map(n => (
            <Entry
              key={n.id}
              title={n.title}
              detail={n.conclusion || '还没有写结论，继续补充证据。'}
              onPress={() => nav.navigate('ResearchEdit', { id: n.id })}
            />
          ))}
          <ActionError error={a.error} />
          <Button
            title={a.busy ? '正在准备文件…' : '导出本周 Markdown'}
            tone="learn"
            disabled={a.busy}
            onPress={() =>
              a.run(async () => {
                await exportText(
                  'QuantWise-学习周报-' + day + '.md',
                  reportMarkdown(r.data!, day),
                  'text/plain',
                );
              })
            }
          />
          <Text style={ls.muted}>
            导出包含本周更新的手记全文，可在电脑上继续研究。
          </Text>
        </>
      ) : null}
    </LearningPage>
  );
}
