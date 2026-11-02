/**
 * 学一个小节（QUANTWISE_DESIGN.md §6）：同一个页面两种模式。听讲：本节路线图、AI 讲解、快捷动作、输入框；
 * 读书：重排原文、段落菜单。进来不请求模型，点了快捷动作或提问才请求。
 */
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ArrowDown, ChevronDown, Send, Square } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { anchorAt, anchorY, loadReadingState, saveReadingState, type ReadingState } from '../../study/readingState';
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
import { Button, NavBar } from '../components/ui';
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
  const { s, busy, error } = useStudy();
  const safe = useSafeAreaInsets();
  const [reading, setReading] = useState<ReadingState | null>(null);
  const readingRef = useRef<ReadingState>({});
  const dirty = useRef<Partial<ReadingState>>({});
  const owner = useRef<{ bookId: string; sectionId: string } | null>(null);
  const focused = useIsFocused();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [latest, setLatest] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [recap, setRecap] = useState(true);
  const [auth, setAuth] = useState(false);
  const restored = useRef(false);
  const turnLayouts = useRef(new Map<number, { y: number; height: number }>());
  const threadTop = useRef<number | null>(null);
  const threadContentReady = useRef(false);
  const threadUserMoved = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openError, setOpenError] = useState('');
  const [text, setText] = useState('');
  const [cite, setCite] = useState<CiteTarget | null>(null);
  const [ctx, setCtx] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const follow = useRef(true);
  const { bookId, sectionId, mode, ask, askLabel, askSnapshot, wrapup, blockSeq } = route.params;
  const sendRef = useRef<(a: StudyAsk) => void>(() => {});

  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const target = owner.current;
    const changes = dirty.current;
    dirty.current = {};
    if (target && Object.keys(changes).length) {
      saveReadingState(core.db, target.bookId, target.sectionId, changes).catch(() => toast.show('阅读记录保存失败，请重试', 'bad'));
    }
  }, [core]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    setOpenError('');
    setReading(null);
    const open = async () => {
      const current = useStudy.getState().s;
      const returnedAfterDay = current && current.state.activeAt.slice(0, 10) !== beijingIso().slice(0, 10);
      if (!current || current.book.id !== bookId || (sectionId && current.section.id !== sectionId) || returnedAfterDay) {
        await openSection(core, bookId, sectionId);
      }
      const session = useStudy.getState().s;
      if (!session || session.book.id !== bookId || (sectionId && session.section.id !== sectionId)) return;
      const ui = await loadReadingState(core.db, bookId, session.section.id);
      if (!alive) return;
      owner.current = { bookId, sectionId: session.section.id };
      readingRef.current = ui;
      dirty.current = {};
      turnLayouts.current.clear();
      threadTop.current = null;
      threadContentReady.current = false;
      threadUserMoved.current = false;
      setReading(ui);
      setAuth(false);
      useStudy.setState({ error: null });
      setText(ui.draft ?? '');
      follow.current = ui.follow ?? !ui.thread;
      restored.current = false;
      setLatest(!follow.current);
    };
    open().catch(e => alive && setOpenError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; flush(); };
    // loadAttempt 是用户点「重新打开」时的显式重试标记。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, bookId, sectionId, flush, loadAttempt]));

  useEffect(() => {
    if (!focused || !reading || !s || s.book.id !== bookId || (sectionId && s.section.id !== sectionId)) return;
    if (mode) {
      setStudyMode(core, mode);
      nav.setParams({ mode: undefined });
    }
    if (wrapup) {
      nav.setParams({ wrapup: undefined });
      nav.navigate('SectionDone', { bookId });
    }
    if (ask && !reading.pending && !busy) {
      nav.setParams({ ask: undefined, askLabel: undefined, askSnapshot: undefined });
      setStudyMode(core, 'lecture').then(() => sendRef.current({ label: askLabel ?? ask, question: ask, snapshot: askSnapshot }));
    }
  }, [core, nav, focused, reading, s, bookId, sectionId, mode, wrapup, ask, askLabel, askSnapshot, busy]);

  useAiContext('Study', () => ({
    name: s ? (s.state.mode === 'read' ? '读书 · ' : 'AI 讲解 · ') + secLabel(s.section) : '读书',
    lines: s ? ['《' + s.book.title + '》第 ' + (s.state.step + 1) + ' / ' + s.steps.length + ' 步：' + (s.steps[s.state.step]?.title ?? '')] : [],
    tip: '这一节的讲解在本页；通用助手是独立会话。',
  }));

  const remember = (changes: Partial<Pick<ReadingState, 'draft' | 'reader' | 'thread' | 'follow' | 'translation'>>) => {
    readingRef.current = { ...readingRef.current, ...changes };
    dirty.current = { ...dirty.current, ...changes };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 300);
  };
  const send = async (a: StudyAsk) => {
    if (useStudy.getState().busy) return;
    const target = owner.current;
    const isCurrent = () => target?.bookId === owner.current?.bookId && target?.sectionId === owner.current?.sectionId;
    follow.current = true;
    setLatest(false);
    setAuth(false);
    remember({ follow: true });
    setReading(v => ({ ...v, pending: a }));
    try {
      const ok = await askStudy(core, a);
      if (!isCurrent()) return;
      if (ok) {
        const changes = { pending: null, ...(readingRef.current.draft?.trim() === a.question.trim() ? { draft: '' } : {}) };
        if (changes.draft === '') remember({ draft: '' });
        setReading(v => ({ ...v, ...changes }));
        if (changes.draft === '') setText('');
      }
    } catch (e) {
      if (!isCurrent()) return;
      const msg = e instanceof Error ? e.message : String(e);
      useStudy.setState({ error: msg });
      setAuth(/配置|API Key/.test(msg));
    }
  };
  sendRef.current = send;
  const runQuick = async (k: QuickKind, block?: BookBlock) => {
    if (!s) {
      return;
    }
    if (s.state.mode === 'read') {
      await setStudyMode(core, 'lecture');
    }
    const a = quickAsk(useStudy.getState().s!, k, block);
    if (k === 'finish') {
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

  const restoreThread = () => {
    if (!threadContentReady.current) return;
    if (follow.current) {
      scroll.current?.scrollToEnd({ animated: false });
      restored.current = true;
    } else if (!threadUserMoved.current) {
      const anchor = readingRef.current.thread;
      const box = anchor && turnLayouts.current.get(anchor.id);
      if (anchor && box && threadTop.current != null) {
        scroll.current?.scrollTo({ y: threadTop.current + anchorY(anchor, box), animated: false });
        restored.current = true;
      } else if (!anchor) restored.current = true;
    }
  };
  const rememberThreadScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!restored.current || !threadUserMoved.current) return;
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const atEnd = contentSize.height - contentOffset.y - layoutMeasurement.height < 60;
    follow.current = atEnd;
    setLatest(!atEnd);
    const anchor = anchorAt(turnLayouts.current, Math.max(0, contentOffset.y - (threadTop.current ?? 0)));
    remember({ ...(anchor ? { thread: anchor } : {}), follow: atEnd });
  };

  if (!s || s.book.id !== bookId || (sectionId && s.section.id !== sectionId) || !reading) {
    return (
      <View style={st.page}>
        <NavBar title="读书" back /><Text style={st.cardP}>{openError || '恢复阅读位置…'}</Text>
        {openError ? <Button title="重新打开" onPress={() => setLoadAttempt(v => v + 1)} /> : null}
      </View>
    );
  }
  const p = progressNow(s);
  const read = s.state.mode === 'read';
  const readerMode = read ? (readingRef.current.translation ? 'translation' : 'read') : 'lecture';
  const setTranslation = (translation: boolean) => {
    remember({ translation });
    setReading(v => ({ ...v, translation }));
  };
  const bar = quickBar({ steps: s.steps, step: s.state.step, taught: p.taught, detour: !!p.detour, factor: factorish(s.section.title + s.blocks.map(b => b.text).join('')) });
  return (
    <KeyboardAvoidingView style={st.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <NavBar
        title={secLabel(s.section)}
        sub={s.book.title}
        back
      />
      <View style={st.modes}>
        {(['read', 'translation', 'lecture'] as const).map(m => (
          <Pressable key={m} onPress={() => { restored.current = false; threadContentReady.current = false; threadUserMoved.current = false; nav.setParams({ blockSeq: undefined }); if (m !== 'lecture') setTranslation(m === 'translation'); setStudyMode(core, m === 'lecture' ? 'lecture' : 'read'); }} style={[st.mode, readerMode === m && st.modeOn]} accessibilityRole="tab" accessibilityState={{ selected: readerMode === m }}>
            <Text style={[st.modeT, readerMode === m && st.modeTOn]}>{m === 'read' ? '原文' : m === 'translation' ? '中文对照' : 'AI 讲解'}</Text>
          </Pressable>
        ))}
      </View>
      {read ? (
        <StudyReader key={s.book.id + ':' + s.section.id} s={s} anchor={readingRef.current.reader} onAnchor={reader => remember({ reader })} focusSeq={blockSeq} onQuick={runQuick} onFinish={() => runQuick('finish')}
          translation={readingRef.current.translation} onTranslation={setTranslation} active={focused}
          onConfigure={() => nav.navigate('AiServices', { returnToStudy: { bookId, sectionId: s.section.id } })} />
      ) : (
        <>
          <View style={st.head}>
            <Pressable style={st.stepToggle} onPress={() => setStepsOpen(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: stepsOpen }}>
              <Text style={st.stepTitle}>第 {s.state.step + 1} / {s.steps.length} 步 · {s.steps[s.state.step]?.title}</Text><ChevronDown size={18} color={rc.secondary} />
            </Pressable>
            {stepsOpen ? <View style={st.steps}>
              {s.steps.map((x, i) => (
                <Pressable key={i} style={st.step} onPress={() => !busy && send({ ...quickAsk(s, 'start'), label: '从第 ' + (i + 1) + ' 步讲', step: i, question: '讲第 ' + (i + 1) + ' 步「' + x.title + '」。' })} accessibilityRole="button" accessibilityLabel={'第 ' + (i + 1) + ' 步 ' + x.title}>
                  <View style={[st.stepBar, i <= p.taught && st.stepDone, i === s.state.step && p.taught >= 0 && st.stepCur]} />
                  <Text style={[st.stepT, i === s.state.step && st.stepTCur, p.skipped.includes(i) && st.skip]}>
                    {i + 1} · {x.title}
                  </Text>
                </Pressable>
              ))}
            </View> : null}
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
            scrollEventThrottle={200}
            onScrollBeginDrag={() => { threadUserMoved.current = true; restored.current = true; follow.current = false; }}
            onScroll={rememberThreadScroll}
            onScrollEndDrag={rememberThreadScroll}
            onMomentumScrollEnd={rememberThreadScroll}
            onContentSizeChange={() => { threadContentReady.current = true; restoreThread(); }}
          >
            {(!s.messages.length || (recap && s.awayDays >= 1)) ? <Intro s={s} onReviewStuck={q => send({ label: '先复习卡点：' + q, question: '先帮我弄懂上次的卡点：' + q + '。如果它属于别的小节，先 load_section 读那一节（detour: true）。' })} /> : null}
            {recap && s.awayDays >= 1 ? <Button title="收起回顾" onPress={() => setRecap(false)} /> : null}
            <View onLayout={e => { threadTop.current = e.nativeEvent.layout.y; restoreThread(); }}>
            <StudyThread onTurnLayout={(id, box) => { turnLayouts.current.set(id, box); restoreThread(); }} s={s} busy={busy} a={{ onLink, onPick: (m, t, k) => pickQuiz(core, m, t, k), onWrapup: () => nav.navigate('SectionDone', { bookId }), onStuck: q => markStuck(core, q).then(() => toast.show('已记成卡点', 'learn')) }} />
            </View>
            {ask && reading.pending && !busy ? <Button title={askLabel ?? '发送刚才的问题'} onPress={() => { nav.setParams({ ask: undefined, askLabel: undefined, askSnapshot: undefined }); send({ label: askLabel ?? ask, question: ask, snapshot: askSnapshot }); }} /> : null}
            {reading.pending && !busy ? <View style={st.retry}>
              <Text style={st.cardP}>{error || '上次的问题还未完成：' + reading.pending.label}</Text>
              <Button title={auth ? '连接 AI，保留问题' : '重试上次的问题'} tone="learn" onPress={() => auth ? nav.navigate('AiServices', { returnToStudy: { bookId, sectionId: s.section.id } }) : send(reading.pending!)} />
              <Button title="稍后再问" onPress={() => { saveReadingState(core.db, bookId, s.section.id, { pending: null }).catch(() => toast.show('暂存失败，请重试', 'bad')); setReading(v => ({ ...v, pending: null })); useStudy.setState({ error: null }); }} />
            </View> : null}
          </ScrollView>
          {latest ? <Pressable style={st.latest} accessibilityRole="button" accessibilityLabel="回到最新" onPress={() => { follow.current = true; remember({ follow: true }); setLatest(false); scroll.current?.scrollToEnd({ animated: true }); }}><ArrowDown size={18} color={rc.main} /><Text style={st.smallT}>回到最新</Text></Pressable> : null}
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
          <View style={[st.composer, { paddingBottom: Math.max(12, safe.bottom) }]}>
            <TextInput value={text} onChangeText={value => { setText(value); remember({ draft: value }); }} accessibilityLabel="提问草稿" placeholder="不懂就问，比如「用茅台举例」" placeholderTextColor={rc.muted} style={st.input} multiline maxLength={2000} />
            <Pressable
              onPress={() => (busy ? stopStudy() : text.trim() && send({ label: text.trim(), question: text.trim() }))}
              disabled={!busy && !text.trim()}
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
  modes: { flexDirection: 'row', backgroundColor: rc.soft, borderRadius: 12, padding: 3, marginHorizontal: 16, marginVertical: 8 },
  mode: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9 },
  modeOn: { backgroundColor: rc.paper },
  modeT: { fontSize: 14, color: rc.secondary },
  modeTOn: { color: rc.ink, fontWeight: '600' },
  head: { backgroundColor: rc.page, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rc.line },
  steps: { paddingHorizontal: 10, paddingTop: 8, gap: 6 },
  step: { minHeight: 48, paddingVertical: 8, gap: 4 },
  stepBar: { height: 3, borderRadius: 2, backgroundColor: rc.line },
  stepDone: { backgroundColor: rc.main, opacity: 0.45 },
  stepCur: { opacity: 1 },
  stepT: { fontSize: 13, color: rc.muted },
  stepTCur: { color: rc.ink },
  skip: { textDecorationLine: 'line-through' },
  seen: { minHeight: 48, flexWrap: 'wrap', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6 },
  seenK: { fontSize: 11, color: rc.muted },
  chip: { fontSize: 11, color: rc.secondary, backgroundColor: rc.soft, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden' },
  detour: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 10, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: rc.detourBg },
  detourT: { flex: 1, fontSize: 13, fontWeight: '600', color: rc.detour },
  detourB: { minHeight: 48, justifyContent: 'center', backgroundColor: rc.detour, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  detourBT: { fontSize: 12, color: '#FFFFFF' },
  stepToggle: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepTitle: { flex: 1, fontSize: 13, lineHeight: 20, color: rc.ink },
  retry: { padding: 12, backgroundColor: rc.soft, borderRadius: 12, gap: 8 },
  latest: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 16 },
  thread: { flex: 1 },
  threadIn: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  chips: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: rc.line },
  chipsIn: { gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  q: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: rc.line, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 5, backgroundColor: rc.paper },
  qMain: { backgroundColor: rc.main, borderColor: rc.main },
  qT: { fontSize: 13, color: rc.secondary },
  white: { color: '#FFFFFF' },
  dim: { opacity: 0.5 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingBottom: 10 },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderRadius: 18, backgroundColor: rc.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, paddingHorizontal: 14, paddingVertical: 9, fontSize: 16, color: rc.ink },
  sendB: { width: 48, height: 48, borderRadius: 24, backgroundColor: rc.action, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  sendOff: { backgroundColor: rc.disabled },
  card: { marginVertical: 10, padding: 12, borderRadius: 12, backgroundColor: rc.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, gap: 4 },
  cardK: { fontSize: 12, color: rc.muted, marginTop: 2 },
  cardP: { fontSize: 14, color: rc.ink, lineHeight: 22 },
  cardS: { fontSize: 12, color: rc.muted, lineHeight: 18, marginTop: 4 },
  small: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', borderRadius: 14, borderWidth: 1, borderColor: rc.line, paddingHorizontal: 12, paddingVertical: 5, marginVertical: 4 },
  smallT: { fontSize: 12, color: rc.secondary },
});
