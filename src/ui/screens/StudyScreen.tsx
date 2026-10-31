/**
 * 学一个小节（QUANTWISE_DESIGN.md §6）：同一个页面两种模式。听讲：本节路线图、AI 讲解、快捷动作、输入框；
 * 读书：重排原文、段落菜单。进来不请求模型，点了快捷动作或提问才请求。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Send, Square } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { secLabel } from '../../book/book';
import type { BookBlock } from '../../book/types';
import { beijingIso } from '../../market/clock';
import { factorish, quickBar, type QuickKind } from '../../study/quick';
import {
  askStudy,
  backToMain,
  markStuck,
  openSection,
  pickQuiz,
  progressNow,
  quickAsk,
  setStudyMode,
  stopStudy,
  useStudy,
  type StudyAsk,
  type StudySession,
} from '../../study/session';
import { notesOf, stuckOf } from '../../data/studyRepo';
import { NavBar } from '../components/ui';
import { useAiContext, useCore } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { rc } from '../readTheme';
import { toast } from '../toast';
import { CiteSheet, ContextSheet, type CiteTarget } from './StudySheets';
import { StudyReader } from './StudyReader';
import { StudyThread } from './StudyThread';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function StudyScreen({ route }: RootScreenProps<'Study'>) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const { s, busy } = useStudy();
  const [text, setText] = useState('');
  const [cite, setCite] = useState<CiteTarget | null>(null);
  const [ctx, setCtx] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const follow = useRef(true);
  const { bookId, sectionId, mode, ask, blockSeq } = route.params;

  useEffect(() => {
    let alive = true;
    openSection(core, bookId, sectionId, mode)
      .then(() => {
        if (alive && ask) {
          send({ label: ask, question: ask });
        }
      })
      .catch(e => toast.show(e instanceof Error ? e.message : String(e), 'bad'));
    return () => {
      alive = false;
    };
    // 只在进入页面时打开一次；切换小节走 replace
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, bookId, sectionId]);

  useAiContext('Study', () => ({
    name: s ? (s.state.mode === 'read' ? '读书 · ' : '听讲 · ') + secLabel(s.section) : '读书',
    lines: s ? ['《' + s.book.title + '》第 ' + (s.state.step + 1) + ' / ' + s.steps.length + ' 步：' + (s.steps[s.state.step]?.title ?? '')] : [],
    tip: '这一节的讲解在本页的听讲对话里；右下角的 AI 助手是另一个对话，能看行情、下模拟单。',
  }));

  const send = (a: StudyAsk) => {
    follow.current = true;
    askStudy(core, a).catch(e => {
      const msg = e instanceof Error ? e.message : String(e);
      toast.show(msg, 'bad');
      if (/配置|API Key/.test(msg)) {
        nav.navigate('AiServices');
      }
    });
  };
  const runQuick = async (k: QuickKind, block?: BookBlock) => {
    if (!s) {
      return;
    }
    if (s.state.mode === 'read') {
      await setStudyMode(core, 'lecture');
    }
    const a = quickAsk(useStudy.getState().s!, k, block);
    if (k === 'finish') {
      follow.current = true;
      try {
        await askStudy(core, a);
      } catch (e) {
        toast.show(e instanceof Error ? e.message : String(e), 'bad');
      }
      nav.navigate('SectionDone', { bookId });
      return;
    }
    send(a);
  };
  const onLink = (href: string) => {
    const m = /^cite:([\w.-]+)#(\d+)$/.exec(href);
    if (m && s) {
      setCite({ sectionId: m[1], no: Number(m[2]) });
    } else if (/^stock:/.test(href)) {
      nav.navigate('Stock', { code: href.slice(6) });
    } else if (/^lesson:/.test(href)) {
      nav.navigate('Lesson', { id: href.slice(7) });
    }
  };

  /** 原文预览里点「在读书模式打开」：本节的块直接定位，别的小节换过去再定位。 */
  const openCite = (t: CiteTarget) => {
    setCite(null);
    if (!s) {
      return;
    }
    const seq = (t.sectionId === s.section.id ? s.blocks : s.extra[t.sectionId] ?? []).find(b => b.no === t.no)?.seq;
    if (t.sectionId === s.section.id) {
      setStudyMode(core, 'read');
      nav.setParams({ blockSeq: seq });
    } else {
      nav.push('Study', { bookId, sectionId: t.sectionId, mode: 'read', blockSeq: seq });
    }
  };

  if (!s || s.book.id !== bookId) {
    return (
      <View style={st.page}>
        <NavBar title="读书" back />
      </View>
    );
  }
  const p = progressNow(s);
  const read = s.state.mode === 'read';
  const bar = quickBar({ steps: s.steps, step: s.state.step, taught: p.taught, detour: !!p.detour, factor: factorish(s.section.title + s.blocks.map(b => b.text).join('')) });
  return (
    <KeyboardAvoidingView style={st.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <NavBar
        title={secLabel(s.section)}
        sub={s.book.title}
        back
        right={
          <View style={st.modes}>
            {(['read', 'lecture'] as const).map(m => (
              <Pressable key={m} onPress={() => setStudyMode(core, m)} style={[st.mode, s.state.mode === m && st.modeOn]} accessibilityRole="tab" accessibilityState={{ selected: s.state.mode === m }}>
                <Text style={[st.modeT, s.state.mode === m && st.modeTOn]}>{m === 'read' ? '读书' : '听讲'}</Text>
              </Pressable>
            ))}
          </View>
        }
      />
      {read ? (
        <StudyReader s={s} focusSeq={blockSeq} onQuick={runQuick} onFinish={() => runQuick('finish')} />
      ) : (
        <>
          <View style={st.head}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.steps}>
              {s.steps.map((x, i) => (
                <Pressable key={i} style={st.step} onPress={() => !busy && send({ ...quickAsk(s, 'start'), label: '从第 ' + (i + 1) + ' 步讲', step: i, question: '讲第 ' + (i + 1) + ' 步「' + x.title + '」。' })} accessibilityRole="button" accessibilityLabel={'第 ' + (i + 1) + ' 步 ' + x.title}>
                  <View style={[st.stepBar, i <= p.taught && st.stepDone, i === s.state.step && p.taught >= 0 && st.stepCur]} />
                  <Text style={[st.stepT, i === s.state.step && st.stepTCur, p.skipped.includes(i) && st.skip]} numberOfLines={1}>
                    {i + 1} · {x.title}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={st.seen} onPress={() => setCtx(true)} accessibilityRole="button" accessibilityLabel="AI 现在看到了什么">
              <Text style={st.seenK}>AI 现在看到</Text>
              <Text style={st.chip}>{s.section.id} 原文</Text>
              {s.loaded.size > 1 ? <Text style={st.chip}>+{[...s.loaded].filter(x => !x.includes('#')).length - 1} 节</Text> : null}
              <Text style={st.chip}>书的地图</Text>
              <Text style={st.seenK}>›</Text>
            </Pressable>
            {p.detour ? (
              <View style={st.detour}>
                <Text style={st.detourT} numberOfLines={1}>岔路 · {secLabel(s.sections.find(x => x.id === p.detour!.sectionId) ?? { no: '', title: p.detour.sectionId })}</Text>
                <Pressable style={st.detourB} onPress={() => backToMain(core)} accessibilityRole="button">
                  <Text style={st.detourBT}>回到主线</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          <ScrollView
            ref={scroll}
            style={st.thread}
            contentContainerStyle={st.threadIn}
            onScrollBeginDrag={() => (follow.current = false)}
            onContentSizeChange={() => follow.current && scroll.current?.scrollToEnd({ animated: false })}
          >
            {!s.messages.length ? <Intro s={s} onReviewStuck={q => send({ label: '先复习卡点：' + q, question: '先帮我弄懂上次的卡点：' + q + '。如果它属于别的小节，先 load_section 读那一节（detour: true）。' })} /> : null}
            <StudyThread s={s} busy={busy} a={{ onLink, onPick: (m, t, k) => pickQuiz(core, m, t, k), onWrapup: () => nav.navigate('SectionDone', { bookId }), onStuck: q => markStuck(core, q).then(() => toast.show('已记成卡点', 'learn')) }} />
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.chips} contentContainerStyle={st.chipsIn} keyboardShouldPersistTaps="handled">
            {bar.map((k, i) => {
              const q = quickAsk(s, k);
              return (
                <Pressable key={k} disabled={!!busy} onPress={() => runQuick(k)} style={[st.q, i === 0 && st.qMain, busy && st.dim]} accessibilityRole="button">
                  <Text style={[st.qT, i === 0 && st.white]}>{q.label}</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={() => setStudyMode(core, 'read')} style={st.q} accessibilityRole="button">
              <Text style={st.qT}>看原文</Text>
            </Pressable>
          </ScrollView>
          <View style={st.composer}>
            <TextInput value={text} onChangeText={setText} placeholder="不懂就问，比如「用茅台举例」" placeholderTextColor={rc.muted} style={st.input} multiline maxLength={2000} />
            <Pressable
              onPress={() => (busy ? stopStudy() : text.trim() && (send({ label: text.trim(), question: text.trim() }), setText('')))}
              style={[st.sendB, !busy && !text.trim() && st.sendOff]}
              accessibilityRole="button"
              accessibilityLabel={busy ? '停止' : '发送'}
            >
              {busy ? <Square size={14} color="#FFFFFF" fill="#FFFFFF" /> : <Send size={16} color="#FFFFFF" />}
            </Pressable>
          </View>
        </>
      )}
      <CiteSheet target={cite} s={s} onClose={() => setCite(null)} onOpen={openCite} />
      <ContextSheet visible={ctx} s={s} onClose={() => setCtx(false)} />
    </KeyboardAvoidingView>
  );
}

/** 进入一节时：本节路线图；距上次 ≥ 1 天时先给一段本地拼出来的回顾（不请求模型）。 */
function Intro({ s, onReviewStuck }: { s: StudySession; onReviewStuck: (q: string) => void }) {
  const core = useCore();
  const [stuck, setStuck] = useState<string | null>(null);
  const [prev, setPrev] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const open = (await stuckOf(core.db, s.book.id)).filter(x => !x.resolvedAt);
      const notes = (await notesOf(core.db, s.book.id)).filter(n => n.summary).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      if (alive) {
        setStuck(open[0] ? open[0].sectionId + ' · ' + open[0].text : null);
        setPrev(notes[0] ? notes[0].sectionId + '：' + notes[0].summary : null);
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [core, s.book.id]);
  return (
    <View style={st.card}>
      {s.awayDays >= 1 ? (
        <>
          <Text style={st.cardK}>距上次 {s.awayDays} 天 · {beijingIso().slice(0, 10)}</Text>
          {prev ? <Text style={st.cardP}>上次学完 {prev}</Text> : null}
          {stuck ? <Text style={st.cardP}>你卡过一个点：{stuck}</Text> : null}
          {stuck ? (
            <Pressable style={st.small} onPress={() => onReviewStuck(stuck)} accessibilityRole="button">
              <Text style={st.smallT}>先复习卡点</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      <Text style={st.cardK}>本节路线图 · {s.steps.length} 步</Text>
      {s.steps.map(x => (
        <Text key={x.index} style={st.cardP}>
          {x.index + 1}. {x.title}
        </Text>
      ))}
      <Text style={st.cardS}>点「开始讲第 1 步」开始；熟悉的步骤可以跳过。只有你点了或提问时才会请求 AI。</Text>
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: rc.page },
  modes: { flexDirection: 'row', backgroundColor: rc.soft, borderRadius: 8, padding: 2, marginRight: 6 },
  mode: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6 },
  modeOn: { backgroundColor: rc.paper },
  modeT: { fontSize: 12, color: rc.secondary },
  modeTOn: { color: rc.ink, fontWeight: '600' },
  head: { backgroundColor: rc.page, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rc.line },
  steps: { paddingHorizontal: 10, paddingTop: 8, gap: 6 },
  step: { width: 104, gap: 4 },
  stepBar: { height: 3, borderRadius: 2, backgroundColor: rc.line },
  stepDone: { backgroundColor: rc.main, opacity: 0.45 },
  stepCur: { opacity: 1 },
  stepT: { fontSize: 11, color: rc.muted },
  stepTCur: { color: rc.ink },
  skip: { textDecorationLine: 'line-through' },
  seen: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6 },
  seenK: { fontSize: 11, color: rc.muted },
  chip: { fontSize: 11, color: rc.secondary, backgroundColor: rc.soft, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden' },
  detour: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 10, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: rc.detourBg },
  detourT: { flex: 1, fontSize: 13, fontWeight: '600', color: rc.detour },
  detourB: { backgroundColor: rc.detour, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  detourBT: { fontSize: 12, color: '#FFFFFF' },
  thread: { flex: 1 },
  threadIn: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  chips: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: rc.line },
  chipsIn: { gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  q: { borderWidth: 1, borderColor: rc.line, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 5, backgroundColor: rc.paper },
  qMain: { backgroundColor: rc.main, borderColor: rc.main },
  qT: { fontSize: 13, color: rc.secondary },
  white: { color: '#FFFFFF' },
  dim: { opacity: 0.5 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingBottom: 10 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderRadius: 18, backgroundColor: rc.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, color: rc.ink },
  sendB: { width: 36, height: 36, borderRadius: 18, backgroundColor: rc.action, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  sendOff: { backgroundColor: rc.disabled },
  card: { marginVertical: 10, padding: 12, borderRadius: 12, backgroundColor: rc.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, gap: 4 },
  cardK: { fontSize: 12, color: rc.muted, marginTop: 2 },
  cardP: { fontSize: 14, color: rc.ink, lineHeight: 22 },
  cardS: { fontSize: 12, color: rc.muted, lineHeight: 18, marginTop: 4 },
  small: { alignSelf: 'flex-start', borderRadius: 14, borderWidth: 1, borderColor: rc.line, paddingHorizontal: 12, paddingVertical: 5, marginVertical: 4 },
  smallT: { fontSize: 12, color: rc.secondary },
});
