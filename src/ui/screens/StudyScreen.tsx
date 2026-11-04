/**
 * 学一个小节（QUANTWISE_DESIGN.md §6）：同一个页面两种模式。听讲：本节路线图、AI 讲解、快捷动作、输入框；
 * 读书：重排原文、段落菜单。进来不请求模型，点了快捷动作或提问才请求。
 */
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ArrowDown, ArrowUp, Brain, ChevronDown, Globe, Info, MessagesSquare, Square } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance, type TextInputInstance } from 'react-native';
import { EFFORT_NAME, normaliseConfig, prettyModel, protocolNotice, resolvedService, searchAvailability } from '../../ai/models';
import { loadProviders } from '../../ai/services';
import type { AiProvider, ModelEntry } from '../../ai/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { anchorAt, anchorY, loadReadingState, saveReadingState, type ReadingState } from '../../study/readingState';
import { researchFromFactor } from '../../study/research';
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
  refreshStudyConfig,
  selectStudyConfig,
  setStudyMode,
  stopStudy,
  studyRebuild,
  TRUNCATED_ERROR,
  useStudy,
  type StudyAsk,
  type StudySession,
} from '../../study/session';
import { notesOf, stuckOf } from '../../data/studyRepo';
import { ChartPin, pinnable, pinOf, type PinSpot } from '../charts/ChartPin';
import { LockScroll } from '../charts/scrub';
import { AiSheet, EffortPicker, ModelPicker, SearchUnavailable } from '../components/AiOptions';
import { Button, NavBar } from '../components/ui';
import { color } from '../theme';
import { useAiContext, useCore } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { rc } from '../readTheme';
import { toast } from '../toast';
import { CiteSheet, ContextSheet, type CiteTarget } from './StudySheets';
import { StudyReader } from './StudyReader';
import { StudyThread, turnInfo } from './StudyThread';

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
  const [actionsOpen, setActionsOpen] = useState(false);
  const [recap, setRecap] = useState(true);
  const [auth, setAuth] = useState(false);
  const restored = useRef(false);
  const turnLayouts = useRef(new Map<number, { y: number; height: number }>());
  // 图文同屏：图卡的画线区域在哪一问的哪里、视窗在哪，滚过图卡后把小图钉在步骤栏上（ChartPin）
  const chartSpots = useRef(new Map<string, PinSpot>());
  const viewport = useRef({ y: 0, h: 0 });
  const [pin, setPin] = useState<{ key: string; reading: number } | null>(null);
  const [unpinned, setUnpinned] = useState<ReadonlySet<number>>(() => new Set());
  const [cover, setCover] = useState(0);
  const threadTop = useRef<number | null>(null);
  const threadContentReady = useRef(false);
  const threadUserMoved = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openError, setOpenError] = useState('');
  const [text, setText] = useState('');
  const input = useRef<TextInputInstance>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [cite, setCite] = useState<CiteTarget | null>(null);
  const [ctx, setCtx] = useState(false);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [sheet, setSheet] = useState<'model' | 'effort' | 'search' | 'searchModels' | null>(null);
  /** 「开启搜索并重问」时当前模型不能搜索：选好能搜索的模型后接着问这一句。 */
  const [searchQuestion, setSearchQuestion] = useState<string | null>(null);
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

  // 打字时收起快捷操作，把高度留给讲解。
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useFocusEffect(useCallback(() => {
    loadProviders(core.db).then(setProviders).then(() => refreshStudyConfig(core)).catch(() => undefined);
  }, [core]));

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
      chartSpots.current.clear();
      setPin(null);
      setUnpinned(new Set());
      threadTop.current = null;
      threadContentReady.current = false;
      threadUserMoved.current = false;
      setReading(ui);
      setAuth(false);
      useStudy.setState({ error: null });
      setText(ui.draft ?? '');
      // 新开一轮或删掉对话后，保存的位置指向已经不在的消息：改回跟随最新
      const stale = !!ui.thread && !session.messages.some(m => m.id === ui.thread!.id);
      follow.current = stale || (ui.follow ?? !ui.thread);
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
  // 钉图要知道每一问说了什么、画了几张图（这一问没画图、讲的是前面那张图时钉前面那张）
  const turnTexts = useMemo(() => turnInfo(s?.messages ?? []), [s?.messages]);

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
  /** 发出去就清空输入框；没问完的问题留在重试区（pending），不会丢。 */
  const sendDraft = () => {
    const q = text.trim();
    if (!q || useStudy.getState().busy) return;
    setText('');
    remember({ draft: '' });
    // 在原文里最近读到哪一块：模型据此理解「这里」「这段」
    send({ label: q, question: q, readingAt: readingRef.current.reader?.id, translation: !!readingRef.current.translation });
  };
  const setDraft = (value: string) => {
    setText(value);
    remember({ draft: value });
  };
  /** 图上「问这一天」：这一天的读数放在草稿前面（换一天时替换掉上一天的），接着写问题。 */
  const askChart = (day: string) => {
    setDraft(day + text.replace(/^看图中这一天：[^。]*。/, ''));
    input.current?.focus();
  };
  const runQuick = async (k: QuickKind, block?: BookBlock, sentence?: string) => {
    if (!s) {
      return;
    }
    if (s.state.mode === 'read') {
      await setStudyMode(core, 'lecture');
    }
    const a = { ...quickAsk(useStudy.getState().s!, k, block, sentence), ...(block ? { translation: !!readingRef.current.translation } : {}) };
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
    } else if (/^https?:\/\//.test(href)) {
      Linking.openURL(href).catch(() => toast.show('打不开这个链接', 'bad'));
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
  /** 视窗或图的位置变了：重新算钉哪张图（流式讲解自动滚动时也算）。 */
  const updatePin = (closed: ReadonlySet<number> = unpinned) => {
    if (threadTop.current == null || viewport.current.h <= 0) return;
    const k = pinOf(chartSpots.current, turnLayouts.current, { top: viewport.current.y - threadTop.current, height: viewport.current.h }, closed, id => turnTexts.get(id));
    setPin(prev => (prev?.key === k?.key && prev?.reading === k?.reading ? prev : k));
  };
  const trackPin = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    viewport.current = { y: e.nativeEvent.contentOffset.y, h: e.nativeEvent.layoutMeasurement.height };
    updatePin();
  };
  const rememberThreadScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    trackPin(e);
    if (!restored.current || !threadUserMoved.current) return;
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const atEnd = contentSize.height - contentOffset.y - layoutMeasurement.height < 60;
    follow.current = atEnd;
    setLatest(!atEnd);
    const anchor = anchorAt(turnLayouts.current, Math.max(0, contentOffset.y - (threadTop.current ?? 0)));
    remember({ ...(anchor ? { thread: anchor } : {}), follow: atEnd });
  };

  const holdThread = () => {
    threadUserMoved.current = true;
    restored.current = true;
    follow.current = false;
    setLatest(true);
    remember({ follow: false });
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
  const cfg = s.config;
  const provider = providers.find(x => x.id === cfg?.providerId);
  const model = provider?.models.find(x => x.id === cfg?.model);
  const svc = cfg ? resolvedService(providers, cfg) : null;
  const availability = provider && model ? searchAvailability(provider, model) : { ok: false, reason: '请先选择并配置模型' };
  const rebuild = studyRebuild(s);
  const lastError = [...s.messages].reverse().find(m => m.role === 'assistant')?.ui?.error;
  const fail = (e: unknown) => toast.show(e instanceof Error ? e.message : String(e), 'bad');
  const choose = async (pv: AiProvider, m: ModelEntry) => {
    const forSearch = sheet === 'searchModels';
    await selectStudyConfig(core, normaliseConfig({ providerId: pv.id, model: m.id, effort: cfg?.effort ?? 'low', search: forSearch ? true : cfg?.search ?? false }, providers));
    setSheet(null);
    if (searchQuestion && forSearch) {
      const q = searchQuestion;
      setSearchQuestion(null);
      send({ label: q, question: q });
    }
  };
  const toggleSearch = () => {
    if (!cfg || busy) return;
    if (!availability.ok) {
      setSheet('search');
      return;
    }
    if (!cfg.search) toast.show('已开启联网搜索：网页资料单独标出，搜索可能另外计费', 'learn');
    selectStudyConfig(core, { ...cfg, search: !cfg.search }).catch(fail);
  };
  const searchAgain = async (q: string) => {
    if (busy || !cfg) return;
    if (!availability.ok) {
      setSearchQuestion(q);
      setSheet('search');
      return;
    }
    await selectStudyConfig(core, { ...cfg, search: true });
    send({ label: q, question: q });
  };
  /** 自己输入的问题（不是快捷动作）可以改了再问。 */
  const typed = (a: StudyAsk) => a.label.trim() === a.question.trim();
  const dropPending = () => {
    saveReadingState(core.db, bookId, s.section.id, { pending: null }).catch(() => toast.show('暂存失败，请重试', 'bad'));
    setReading(v => ({ ...v, pending: null }));
    useStudy.setState({ error: null });
  };
  const bar = quickBar({ steps: s.steps, step: s.state.step, taught: p.taught, detour: !!p.detour, factor: factorish(s.section.title + s.blocks.map(b => b.text).join('')) });
  // 步骤面板打开时先露出步骤入口。
  const pinSpot = pin && !stepsOpen ? chartSpots.current.get(pin.key) : undefined;
  const pinned = pin && pinSpot && pinnable(pinSpot.data) ? { reading: pin.reading, data: pinSpot.data } : null;
  /** 收起钉图：正在读的这一问不再钉，读到下一问照常钉。 */
  const closePin = (turn: number) => {
    const next = new Set(unpinned).add(turn);
    setUnpinned(next);
    setPin(null);
    updatePin(next);
  };
  return (
    <KeyboardAvoidingView style={st.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <NavBar
        title={secLabel(s.section)}
        sub={s.book.title}
        back
        right={
          <Pressable style={st.navBtn} onPress={() => nav.navigate('StudyHistory', { bookId })} accessibilityRole="button" accessibilityLabel="讲解记录">
            <MessagesSquare size={21} color={rc.secondary} />
          </Pressable>
        }
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
          onSection={async id => {
            flush();
            try {
              await saveReadingState(core.db, bookId, id, { translation: readingRef.current.translation ?? false });
              nav.replace('Study', { bookId, sectionId: id, mode: 'read' });
            } catch (e) { fail(e); }
          }}
          onConfigure={() => nav.navigate('AiServices', { returnToStudy: { bookId, sectionId: s.section.id } })} />
      ) : (
        <>
          <View style={pinned && st.pinHost}>
          <View style={[st.head, pinned && st.coveredHead]} pointerEvents={pinned ? 'none' : 'auto'} importantForAccessibility={pinned ? 'no-hide-descendants' : 'auto'}>
            <View style={st.headRow} onLayout={e => setCover(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
            <Pressable style={st.stepToggle} onPress={() => setStepsOpen(v => !v)} accessibilityRole="button" accessibilityLabel="本节讲解步骤" accessibilityValue={{ text: '第 ' + (s.state.step + 1) + ' / ' + s.steps.length + ' 步，' + s.steps[s.state.step]?.title }} accessibilityState={{ expanded: stepsOpen }}>
              <Text style={st.stepTitle}>第 {s.state.step + 1} / {s.steps.length} 步 · {s.steps[s.state.step]?.title}</Text><ChevronDown size={18} color={rc.secondary} />
            </Pressable>
            <Pressable style={st.seen} onPress={() => setCtx(true)} accessibilityRole="button" accessibilityLabel="AI 现在看到了什么">
              <Info size={18} color={rc.secondary} /><Text style={st.seenK}>上下文</Text>
            </Pressable>
            </View>
          </View>
          {/* 小图按自身高度占位；紧凑的步骤栏保留测量，但不遮住对话。 */}
          {pinned ? <ChartPin data={pinned.data} style={{ minHeight: cover }} onClose={() => closePin(pinned.reading)} /> : null}
            {p.detour ? (
              <View style={st.detour}>
                <Text style={st.detourT} numberOfLines={1}>岔路 · {secLabel(s.sections.find(x => x.id === p.detour!.sectionId) ?? { no: '', title: p.detour.sectionId })}</Text>
                <Pressable style={st.detourB} onPress={() => backToMain(core)} accessibilityRole="button">
                  <Text style={st.detourBT}>回到主线</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          <LockScroll
            ref={scroll}
            style={st.thread}
            contentContainerStyle={st.threadIn}
            scrollEventThrottle={200}
            onLayout={e => { viewport.current = { ...viewport.current, h: e.nativeEvent.layout.height }; updatePin(); }}
            onScrollBeginDrag={() => { threadUserMoved.current = true; restored.current = true; follow.current = false; }}
            onScroll={rememberThreadScroll}
            onScrollEndDrag={rememberThreadScroll}
            onMomentumScrollEnd={rememberThreadScroll}
            onContentSizeChange={(_, h) => {
              threadContentReady.current = true;
              restoreThread();
              // 跟随最新时视窗贴着底部（程序滚动不一定发滚动事件）
              if (follow.current) viewport.current = { ...viewport.current, y: Math.max(0, h - viewport.current.h) };
              updatePin();
            }}
          >
            {(!s.messages.length || (recap && s.awayDays >= 1)) ? <Intro s={s} onReviewStuck={q => send({ label: '先复习卡点：' + q, question: '先帮我弄懂上次的卡点：' + q + '。如果它属于别的小节，先 load_section 读那一节（detour: true）。' })} /> : null}
            {recap && s.awayDays >= 1 ? <Button title="收起回顾" onPress={() => setRecap(false)} /> : null}
            <View onLayout={e => { threadTop.current = e.nativeEvent.layout.y; restoreThread(); updatePin(); }}>
            <StudyThread
              onTurnLayout={(id, box) => { if (box) turnLayouts.current.set(id, box); else turnLayouts.current.delete(id); restoreThread(); updatePin(); }}
              onChartBox={(key, spot) => { if (spot) chartSpots.current.set(key, spot); else chartSpots.current.delete(key); updatePin(); }}
              s={s} busy={busy} a={{ onLink, onPick: (m, t, k) => pickQuiz(core, m, t, k), onWrapup: () => nav.navigate('SectionDone', { bookId }), onStuck: q => markStuck(core, q).then(() => toast.show('已记成卡点', 'learn')), onSearch: q => { searchAgain(q).catch(fail); }, onSummary: () => setCtx(true), onDisclosure: holdThread, onAskChart: askChart, onSaveResearch: (chart, claim, answer) => nav.navigate('ResearchEdit', { draft: researchFromFactor({ chart, book: s.book, section: s.section, claim, answer }) }) }} />
            </View>
            {ask && reading.pending && !busy ? <Button title={askLabel ?? '发送刚才的问题'} onPress={() => { nav.setParams({ ask: undefined, askLabel: undefined, askSnapshot: undefined }); send({ label: askLabel ?? ask, question: ask, snapshot: askSnapshot }); }} /> : null}
            {reading.pending && !busy ? <View style={st.retry}>
              <Text style={st.cardK}>{error ? '这个问题没有问完' : '上次的问题还未完成'}</Text>
              <Text style={st.retryQ} numberOfLines={4}>{reading.pending.label}</Text>
              {error ? <Text style={st.retryErr} accessibilityRole="alert">{error}</Text> : null}
              {lastError === TRUNCATED_ERROR && !auth ? <Button title="接着讲" tone="learn" onPress={() => send({ label: '接着讲', question: '你上一条回答因为篇幅停在半截了。从停下的地方接着讲，不要重复已经讲过的内容。', step: reading.pending?.step })} /> : null}
              <Button title={auth ? '连接 AI，保留问题' : '重试上次的问题'} tone="learn" onPress={() => auth ? nav.navigate('AiServices', { returnToStudy: { bookId, sectionId: s.section.id } }) : send(reading.pending!)} />
              {typed(reading.pending) ? <Button title="修改后再问" onPress={() => { const q = reading.pending!.question; dropPending(); setDraft(q); input.current?.focus(); }} /> : null}
              <Button title="稍后再问" onPress={() => { const q = reading.pending!; dropPending(); if (typed(q) && !text.trim()) setDraft(q.question); }} />
            </View> : null}
          </LockScroll>
          {latest ? <Pressable style={st.latest} accessibilityRole="button" accessibilityLabel="回到最新" onPress={() => { follow.current = true; remember({ follow: true }); setLatest(false); scroll.current?.scrollToEnd({ animated: true }); }}><ArrowDown size={18} color={rc.main} /><Text style={st.smallT}>回到最新</Text></Pressable> : null}
          {/* 生成中：状态和「停止」固定在输入框上方，不随对话滚走；打字时收起快捷操作。 */}
          {busy ? <View style={st.status}>
            <ActivityIndicator size="small" color={rc.main} />
            <Text style={st.statusT} numberOfLines={1} accessibilityLiveRegion="polite">{busy}</Text>
            <Pressable style={st.stop} onPress={stopStudy} accessibilityRole="button" accessibilityLabel="停止讲解">
              <Square size={12} color={rc.main} fill={rc.main} /><Text style={st.stopT}>停止</Text>
            </Pressable>
          </View> : keyboard ? null : <View style={st.chips}>
            {bar.slice(0, 1).map(k => {
              const q = quickAsk(s, k);
              return (
                <Pressable key={k} onPress={() => runQuick(k)} style={[st.q, st.qMain]} accessibilityRole="button">
                  <Text style={[st.qT, st.white]}>{q.label}</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={() => setStudyMode(core, 'read')} style={st.q} accessibilityRole="button">
              <Text style={st.qT}>看原文</Text>
            </Pressable>
            {bar.length > 1 ? <Pressable onPress={() => setActionsOpen(true)} style={st.more} accessibilityRole="button" accessibilityLabel="更多讲解方式" accessibilityState={{ expanded: actionsOpen }}>
              <Text style={st.qT}>更多</Text><ChevronDown size={14} color={rc.secondary} />
            </Pressable> : null}
          </View>}
          <View style={[st.composer, { paddingBottom: Math.max(12, safe.bottom) }]}>
            {rebuild && !busy ? (
              <View style={st.cacheWarning}>
                <Text style={st.cacheText}>{rebuild.reason + (rebuild.tokens ? '：下次预计重建约 ' + rebuild.tokens.toLocaleString('zh-CN') + ' 词元的缓存' : '：下次提问要重建缓存')}</Text>
                <Pressable style={st.revert} onPress={() => selectStudyConfig(core, rebuild.previous).catch(fail)} accessibilityRole="button">
                  <Text style={st.revertText}>改回</Text>
                </Pressable>
              </View>
            ) : null}
            {provider && cfg && protocolNotice(provider, cfg.model) ? <Text style={st.notice}>{protocolNotice(provider, cfg.model)}</Text> : null}
            {svc?.capabilities?.tools === false ? <Text style={st.notice}>这个模型不能调用读书工具：不能读其他小节、出检查题、用真实行情举例</Text> : svc?.capabilities?.tools === null ? <Text style={st.notice}>这个模型的工具能力未知，可在供应商里标注</Text> : null}
            <View style={st.box}>
              <TextInput ref={input} value={text} onChangeText={setDraft} accessibilityLabel="提问草稿" placeholder="不懂就问，比如「用茅台举例」" placeholderTextColor={rc.muted} style={st.input} multiline maxLength={2000} />
              <View style={st.toolbar}>
                <Pressable style={[st.control, st.modelControl]} onPress={() => setSheet('model')} disabled={!!busy} accessibilityRole="button" accessibilityLabel="选择讲解模型" accessibilityValue={{ text: cfg?.model ?? '未选择' }} accessibilityState={{ disabled: !!busy }}>
                  <Text style={st.controlText} numberOfLines={1}>{cfg ? prettyModel(cfg.model) : '选择模型'}</Text>
                  <ChevronDown size={13} color={rc.secondary} />
                </Pressable>
                <Pressable style={st.control} onPress={toggleSearch} disabled={!!busy || !cfg} accessibilityRole="button" accessibilityLabel="联网搜索" accessibilityState={{ selected: !!cfg?.search, disabled: !!busy || !cfg }} accessibilityValue={{ text: !availability.ok ? '当前模型不可用' : cfg?.search ? '已开启' : '已关闭' }}>
                  <View style={[st.symbol, !availability.ok && st.unavailable]}>
                    <Globe size={19} color={cfg?.search ? rc.main : rc.secondary} />
                  </View>
                  {cfg?.search ? <View style={st.searchDot} /> : null}
                </Pressable>
                <Pressable style={st.control} onPress={() => setSheet('effort')} disabled={!!busy || !svc} accessibilityRole="button" accessibilityLabel="思考强度" accessibilityValue={{ text: cfg ? EFFORT_NAME[cfg.effort] : '未选择' }} accessibilityState={{ disabled: !!busy || !svc }}>
                  <Brain size={19} color={rc.secondary} />
                  <Text style={st.controlText}>{'思考' + (cfg ? EFFORT_NAME[cfg.effort] : '未选')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => (busy ? stopStudy() : sendDraft())}
                  disabled={!busy && !text.trim()}
                  style={st.send}
                  accessibilityRole="button"
                  accessibilityLabel={busy ? '停止' : '发送'}
                  accessibilityState={{ disabled: !busy && !text.trim() }}
                >
                  <View style={[st.sendDisc, !busy && !text.trim() && st.sendOff]}>
                    {busy ? <Square size={14} color="#FFFFFF" fill="#FFFFFF" /> : <ArrowUp size={20} color="#FFFFFF" />}
                  </View>
                </Pressable>
              </View>
            </View>
          </View>
        </>
      )}
      {stepsOpen ? <AiSheet title="本节讲解步骤" visible onClose={() => setStepsOpen(false)}>
        <ScrollView style={st.steps}>
          {s.steps.map((x, i) => <Pressable key={i} style={st.step} disabled={!!busy}
            onPress={() => { setStepsOpen(false); send({ ...quickAsk(s, 'start'), label: '从第 ' + (i + 1) + ' 步讲', step: i, question: '讲第 ' + (i + 1) + ' 步「' + x.title + '」。' }); }}
            accessibilityRole="button" accessibilityLabel={'第 ' + (i + 1) + ' 步 ' + x.title} accessibilityState={{ selected: i === s.state.step, disabled: !!busy }}>
            <View style={st.stepWords}><Text style={[st.stepT, i === s.state.step && st.stepTCur]}>{i + 1} · {x.title}</Text>
              <Text style={st.stepStatus}>{i === s.state.step ? '当前步骤' : p.skipped.includes(i) ? '已跳过' : i <= p.taught ? '已讲过' : '未讲解'}</Text></View>
          </Pressable>)}
          {busy ? <Text style={st.notice}>讲解结束后可切换步骤。</Text> : null}
        </ScrollView>
      </AiSheet> : null}
      {actionsOpen ? <AiSheet title="更多讲解方式" visible onClose={() => setActionsOpen(false)}>
        <ScrollView style={st.steps}>
          {bar.slice(1).map(k => <Pressable key={k} style={st.step} disabled={!!busy} accessibilityRole="button" accessibilityState={{ disabled: !!busy }} onPress={() => { setActionsOpen(false); runQuick(k); }}>
            <Text style={st.stepT}>{quickAsk(s, k).label}</Text>
          </Pressable>)}
          {busy ? <Text style={st.notice}>讲解结束后可继续提问。</Text> : null}
        </ScrollView>
      </AiSheet> : null}
      <CiteSheet target={cite} s={s} onClose={() => setCite(null)} onOpen={openCite} />
      <ContextSheet visible={ctx} s={s} onClose={() => setCtx(false)} />
      <ModelPicker
        visible={sheet === 'model' || sheet === 'searchModels'}
        searchOnly={sheet === 'searchModels'}
        providers={providers}
        config={cfg}
        onClose={() => { setSheet(null); setSearchQuestion(null); }}
        onSelect={(pv, m) => { choose(pv, m).catch(fail); }}
        onManage={() => { setSheet(null); nav.navigate('AiServices', { returnToStudy: { bookId, sectionId: s.section.id } }); }}
      />
      <EffortPicker
        visible={sheet === 'effort'}
        caps={svc?.capabilities ?? null}
        config={cfg}
        onClose={() => setSheet(null)}
        onSelect={effort => { if (cfg) selectStudyConfig(core, { ...cfg, effort }).then(() => setSheet(null)).catch(fail); }}
        onManage={() => { setSheet(null); nav.navigate('AiService', { id: provider?.id }); }}
        note={'讲解用「低」通常就够；推导、证明类小节可以调到「中」。' + (svc?.capabilities?.thinking?.some(e => e === 'xhigh' || e === 'max') ? '「极高」「最高」更容易因篇幅太长被截断。' : '')}
      />
      <SearchUnavailable
        visible={sheet === 'search'}
        reason={availability.reason}
        onClose={() => { setSheet(null); setSearchQuestion(null); }}
        onChoose={() => setSheet('searchModels')}
      />
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
      <Text style={st.cardP}>{s.steps[s.state.step]?.title}</Text>
      <Text style={st.cardS}>点「{quickAsk(s, 'start').label}」开始，也可以直接提问。点顶部步骤查看完整路线。</Text>
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
  pinHost: { zIndex: 2 },
  coveredHead: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  steps: { flexShrink: 1, paddingHorizontal: 20 },
  step: { minHeight: 48, justifyContent: 'center', paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: rc.line },
  stepWords: { gap: 4 },
  stepT: { fontSize: 15, lineHeight: 24, color: rc.ink },
  stepTCur: { color: rc.main, fontWeight: '600' },
  stepStatus: { fontSize: 12, lineHeight: 20, color: rc.secondary },
  seen: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6 },
  seenK: { fontSize: 12, color: rc.secondary },
  detour: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 10, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: rc.detourBg },
  detourT: { flex: 1, fontSize: 13, fontWeight: '600', color: rc.detour },
  detourB: { minHeight: 48, justifyContent: 'center', backgroundColor: rc.detour, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  detourBT: { fontSize: 12, color: '#FFFFFF' },
  stepToggle: { flex: 1, minHeight: 48, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepTitle: { flex: 1, fontSize: 13, lineHeight: 20, color: rc.ink },
  retry: { padding: 12, backgroundColor: rc.soft, borderRadius: 12, gap: 8 },
  retryQ: { fontSize: 15, lineHeight: 24, color: rc.ink },
  retryErr: { fontSize: 13, lineHeight: 21, color: color.upText },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingLeft: 16, paddingRight: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: rc.line },
  statusT: { flex: 1, fontSize: 13, lineHeight: 20, color: rc.secondary },
  stop: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12 },
  stopT: { fontSize: 14, fontWeight: '600', color: rc.main },
  latest: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 16 },
  thread: { flex: 1 },
  threadIn: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: rc.line },
  more: { minHeight: 48, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  q: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: rc.line, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 5, backgroundColor: rc.paper },
  qMain: { backgroundColor: rc.main, borderColor: rc.main },
  qT: { fontSize: 13, color: rc.secondary },
  white: { color: '#FFFFFF' },
  navBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  composer: { paddingHorizontal: 10, paddingBottom: 10 },
  box: { borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, borderRadius: 18, padding: 4, backgroundColor: rc.paper },
  input: { minHeight: 36, maxHeight: 120, paddingHorizontal: 10, paddingVertical: 6, fontSize: 16, lineHeight: 24, color: rc.ink },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  control: { minHeight: 48, minWidth: 48, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 12 },
  modelControl: { flex: 1, justifyContent: 'flex-start', paddingHorizontal: 10 },
  controlText: { fontSize: 12, lineHeight: 18, color: rc.secondary, flexShrink: 1 },
  symbol: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  unavailable: { borderWidth: 1, borderColor: rc.line, borderStyle: 'dashed', borderRadius: 14 },
  searchDot: { position: 'absolute', right: 10, top: 9, width: 4, height: 4, borderRadius: 2, backgroundColor: rc.main },
  send: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  sendDisc: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: rc.action },
  sendOff: { backgroundColor: rc.disabled },
  cacheWarning: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: color.warnBg, borderRadius: 12, paddingLeft: 12, marginBottom: 8 },
  cacheText: { flex: 1, fontSize: 12, lineHeight: 19, color: color.warnInk },
  revert: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center' },
  revertText: { fontSize: 12, fontWeight: '600', color: color.warnInk },
  notice: { fontSize: 12, lineHeight: 18, color: rc.muted, marginBottom: 6, paddingHorizontal: 4 },
  card: { marginVertical: 10, padding: 12, borderRadius: 12, backgroundColor: rc.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, gap: 4 },
  cardK: { fontSize: 12, color: rc.muted, marginTop: 2 },
  cardP: { fontSize: 14, color: rc.ink, lineHeight: 22 },
  cardS: { fontSize: 12, color: rc.muted, lineHeight: 18, marginTop: 4 },
  small: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', borderRadius: 14, borderWidth: 1, borderColor: rc.line, paddingHorizontal: 12, paddingVertical: 5, marginVertical: 4 },
  smallT: { fontSize: 12, color: rc.secondary },
});
