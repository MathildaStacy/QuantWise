/**
 * 学一个小节（QUANTWISE_DESIGN.md §6）：同一个页面两种模式。听讲：本节路线图、AI 讲解、快捷动作、输入框；
 * 读书：重排原文、段落菜单。进来不请求模型，点了快捷动作或提问才请求。
 */
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ArrowDown, ArrowUp, Brain, ChevronDown, Globe, MessagesSquare, Square } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { EFFORT_NAME, normaliseConfig, prettyModel, protocolNotice, resolvedService, searchAvailability } from '../../ai/models';
import { loadProviders } from '../../ai/services';
import type { AiProvider, ModelEntry } from '../../ai/types';
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
import { EffortPicker, ModelPicker, SearchUnavailable } from '../components/AiOptions';
import { Button, NavBar } from '../components/ui';
import { color } from '../theme';
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
  const bar = quickBar({ steps: s.steps, step: s.state.step, taught: p.taught, detour: !!p.detour, factor: factorish(s.section.title + s.blocks.map(b => b.text).join('')) });
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
            <StudyThread onTurnLayout={(id, box) => { turnLayouts.current.set(id, box); restoreThread(); }} s={s} busy={busy} a={{ onLink, onPick: (m, t, k) => pickQuiz(core, m, t, k), onWrapup: () => nav.navigate('SectionDone', { bookId }), onStuck: q => markStuck(core, q).then(() => toast.show('已记成卡点', 'learn')), onSearch: q => { searchAgain(q).catch(fail); }, onSummary: () => setCtx(true) }} />
            </View>
            {ask && reading.pending && !busy ? <Button title={askLabel ?? '发送刚才的问题'} onPress={() => { nav.setParams({ ask: undefined, askLabel: undefined, askSnapshot: undefined }); send({ label: askLabel ?? ask, question: ask, snapshot: askSnapshot }); }} /> : null}
            {reading.pending && !busy ? <View style={st.retry}>
              <Text style={st.cardP}>{error || '上次的问题还未完成：' + reading.pending.label}</Text>
              {lastError === TRUNCATED_ERROR && !auth ? <Button title="接着讲" tone="learn" onPress={() => send({ label: '接着讲', question: '你上一条回答因为篇幅停在半截了。从停下的地方接着讲，不要重复已经讲过的内容。', step: reading.pending?.step })} /> : null}
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
              <TextInput value={text} onChangeText={value => { setText(value); remember({ draft: value }); }} accessibilityLabel="提问草稿" placeholder="不懂就问，比如「用茅台举例」" placeholderTextColor={rc.muted} style={st.input} multiline maxLength={2000} />
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
                  onPress={() => (busy ? stopStudy() : text.trim() && send({ label: text.trim(), question: text.trim() }))}
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
