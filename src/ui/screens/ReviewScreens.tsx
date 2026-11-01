/**
 * 本节小结（摘要、卡点、闪卡草稿，确认后保存、进度前移）和复习（Leitner 5 盒、卡点清单、翻卡），QUANTWISE_DESIGN.md §6.6。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { leavesOf, secLabel } from '../../book/book';
import { addDays, BOX_DAYS, dueToday, rateCard, type Rating } from '../../book/review';
import type { BookSection } from '../../book/types';
import * as bookRepo from '../../data/bookRepo';
import * as studyRepo from '../../data/studyRepo';
import { beijingIso } from '../../market/clock';
import { saveWrapup, useStudy, wrapDraft, type WrapDraft } from '../../study/session';
import { BlockInline } from '../components/BookBlock';
import { Button, Details, NavBar, Note } from '../components/ui';
import { useCore } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { rc } from '../readTheme';
import { color, num, PAD } from '../theme';
import { loadReadingState, saveReadingState } from '../../study/readingState';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SectionDoneScreen({ route }: RootScreenProps<'SectionDone'>) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const s = useStudy(x => x.s);
  const [d, setD] = useState<WrapDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!s) return;
    let alive = true;
    loadReadingState(core.db, s.book.id, s.section.id).then(ui => {
      if (alive) setD(ui.wrap ?? wrapDraft(s));
    }).catch(e => setSaveError(String(e)));
    return () => { alive = false; };
    // 当前小节固定；流式消息不会覆盖正在编辑的草稿。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, s?.book.id, s?.section.id]);
  useEffect(() => {
    if (d && s && !saved && !lock.current) saveReadingState(core.db, s.book.id, s.section.id, { wrap: d }).catch(e => setSaveError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, d]);
  if (!s || !d || s.book.id !== route.params.bookId) {
    return (
      <View style={st.page}>
        <NavBar title="本节小结" back /><Text style={st.body}>{saveError || '加载小结…'}</Text>
      </View>
    );
  }
  const setCard = (i: number, patch: Partial<WrapDraft['cards'][number]>) => setD({ ...d, cards: d.cards.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const save = async (continueReading: boolean) => {
    if (lock.current || saved) return;
    lock.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const next = await saveWrapup(core, d);
      setSaved(true);
      if (continueReading && next) {
        nav.pop();
        nav.replace('Study', { bookId: s.book.id, sectionId: next.id });
      }
    } catch (e) {
      lock.current = false;
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  if (saved) return <View style={st.page}><NavBar title="已保存" back /><View style={st.card}>
    <Text style={st.h}>这一节，先学到这里</Text>
    <Text style={st.body}>小结已保存在本机，学习进度已保留。</Text>
    <Text style={st.body}>{d.cards.filter(c => c.on && c.front.trim()).length ? '首次复习：' + addDays(beijingIso().slice(0, 10), 1) + ' · ' + d.cards.filter(c => c.on && c.front.trim()).length + ' 张闪卡' : '本次仅保存小结，没有新增闪卡。'}</Text>
    <Button title="返回书架" tone="learn" onPress={() => nav.popTo('Tabs', { screen: 'Learn' })} />
    <Button title="查看复习安排" onPress={() => nav.replace('Review')} />
  </View></View>;
  return (
    <View style={st.page}>
      <NavBar title="本节小结" sub={secLabel(s.section)} back />
      <ScrollView contentContainerStyle={st.pad} keyboardShouldPersistTaps="handled">
        <View style={st.card}>
          <Text style={st.k}>{d.from ? 'AI 小结草稿 · 确认后保存' : '本机草稿 · 确认后保存'}</Text>
          <Text style={st.h}>摘要</Text>
          {editing ? <TextInput accessibilityLabel="小结摘要" value={d.summary} onChangeText={summary => setD({ ...d, summary })} multiline style={st.ta} placeholder="这一节讲了什么（120 字以内）" placeholderTextColor={color.ink3} /> : <Text style={st.body}>{d.summary}</Text>}
          <Button title={editing ? "完成编辑" : "编辑小结"} onPress={() => setEditing(v => !v)} />
          {d.skipped.length ? <Text style={st.k}>跳过了第 {d.skipped.map(x => x + 1).join('、')} 步</Text> : null}
        </View>
        <View style={st.card}>
          <Text style={st.h}>卡点</Text>
          {d.stuck.length ? d.stuck.map((x, i) => <Text key={i} style={st.body}>! {x}</Text>) : <Text style={st.k}>这一节没有新卡点</Text>}
        </View>
        <View style={st.card}>
          <Text style={st.h}>闪卡草稿 <Text style={st.k}>默认全选，不要的取消</Text></Text>
          {d.cards.map((c, i) => (
            <View key={i} style={st.cardRow}>
              <Pressable style={st.cardCheck} onPress={() => setCard(i, { on: !c.on })} accessibilityRole="checkbox" accessibilityLabel={'保存闪卡：' + c.front} accessibilityState={{ checked: c.on }}>
              <View style={[st.box, c.on && st.boxOn]}>{c.on ? <Text style={st.tick}>✓</Text> : null}</View>
              </Pressable><View style={st.grow}>
                {editing ? <><TextInput accessibilityLabel="闪卡问题" value={c.front} onChangeText={front => setCard(i, { front })} style={st.front} multiline />
                <TextInput accessibilityLabel="闪卡答案" value={c.back} onChangeText={back => setCard(i, { back })} style={st.back} multiline /></> : <><Text style={st.body}>{c.front}</Text><Text style={st.k}>{c.back}</Text></>}
              </View>
            </View>
          ))}
          <Button title="加一张" small onPress={() => { setEditing(true); setD({ ...d, cards: [...d.cards, { front: '', back: '', on: true }] }); }} style={st.add} />
        </View>
        {saveError ? <Note tone="warn">保存未完成：{saveError}。草稿仍在，可以重试。</Note> : null}
        <View style={st.actions}>
          <Button title={saving ? '保存中…' : '保存，今天到这里'} tone="learn" disabled={saving} onPress={() => save(false)} />
          {leavesOf(s.sections).findIndex(x => x.id === s.section.id) < leavesOf(s.sections).length - 1 ? <Button title="保存，继续下一节" disabled={saving} onPress={() => save(true)} /> : null}
          <Button title="返回继续读" disabled={saving} onPress={() => nav.goBack()} />
        </View>
      </ScrollView>
    </View>
  );
}

// ---------- 复习 ----------

interface ReviewData {
  cards: studyRepo.Card[];
  stuck: studyRepo.Stuck[];
  sections: Map<string, BookSection>;
}

async function loadReview(core: ReturnType<typeof useCore>): Promise<ReviewData> {
  const cards = await studyRepo.cards(core.db);
  const stuck = await studyRepo.stuckOf(core.db);
  const sections = new Map<string, BookSection>();
  for (const b of new Set([...cards, ...stuck].map(x => x.bookId))) {
    for (const s of await bookRepo.sections(core.db, b)) {
      sections.set(b + '/' + s.id, s);
    }
  }
  return { cards, stuck, sections };
}

const label = (d: ReviewData, bookId: string, sectionId: string) => {
  const s = d.sections.get(bookId + '/' + sectionId);
  return s ? secLabel(s) : sectionId;
};

export function ReviewScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const [d, setD] = useState<ReviewData | null>(null);
  const reload = useCallback(() => {
    loadReview(core).then(setD).catch(() => undefined);
  }, [core]);
  useFocusEffect(reload);
  const today = beijingIso().slice(0, 10);
  const due = d ? dueToday(d.cards, today) : [];
  const nextDue = d?.cards.filter(c => c.due > today).map(c => c.due).sort()[0];
  const reviewedToday = d?.cards.filter(c => c.reviewedAt?.slice(0, 10) === today).length ?? 0;
  const boxes = [1, 2, 3, 4, 5].map(n => d?.cards.filter(c => c.box === n).length ?? 0);
  const max = Math.max(1, ...boxes);
  const open = (d?.stuck ?? []).filter(x => !x.resolvedAt);
  return (
    <View style={st.page}>
      <NavBar title="复习" back />
      <ScrollView contentContainerStyle={st.pad}>
        <View style={st.card}>
          <View style={st.top}>
            <View>
              <Text style={st.k}>今日待复习</Text>
              <Text style={[st.big, num]}>{due.length}</Text>
              <Text style={st.k}>共 {d?.cards.length ?? 0} 张 · 每天最多 30</Text>
            </View>
            <View style={st.boxes}>
              {boxes.map((v, i) => (
                <View key={i} style={st.boxCol}>
                  <View style={[st.bar, { height: 6 + (v / max) * 44 }]} />
                  <Text style={st.k}>{i + 1}</Text>
                </View>
              ))}
            </View>
          </View>
          {due.length ? <Button title="开始复习" tone="learn" onPress={() => nav.navigate('ReviewRun')} /> : <>
            <Text style={st.h}>{!d ? '加载复习安排…' : !d.cards.length ? '还没有闪卡' : reviewedToday ? '今天的复习已完成' : '今天没有到期的闪卡'}</Text>
            {d && !d.cards.length ? <><Text style={st.body}>学完一小节，在小结中保存第一张闪卡。</Text><Button title="去学一小节" onPress={() => nav.navigate('Tabs', { screen: 'Learn' })} /></> : null}
            {nextDue ? <Text style={st.body}>下次复习：{nextDue} · {d?.cards.filter(c => c.due === nextDue).length} 张</Text> : null}
            {reviewedToday ? <Text style={st.k}>今天已复习 {reviewedToday} 张</Text> : null}
          </>}
          <Details title="复习如何安排"><Text style={st.k}>盒子 1–5 分别隔 {BOX_DAYS.join(' / ')} 天再复习：记得升一盒，模糊不动，忘了回盒 1。</Text></Details>
        </View>
        <View style={st.card}>
          <Text style={st.h}>卡点清单</Text>
          {!open.length ? <Text style={st.k}>没有没解决的卡点</Text> : null}
          {open.map(x => (
            <View key={x.id} style={st.stuckRow}>
              <View style={st.grow}>
                <Text style={st.body}>{x.text}</Text>
                <Text style={st.k}>{d ? label(d, x.bookId, x.sectionId) : x.sectionId}</Text>
              </View>
              <Button title="让 AI 重讲" small onPress={() => nav.navigate('Study', { bookId: x.bookId, sectionId: x.sectionId, ask: '我没完全懂这一点，换个角度再讲一次：' + x.text })} />
              <Button title="懂了" small onPress={() => studyRepo.resolveStuck(core.db, x.id, beijingIso()).then(reload)} />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export function ReviewRunScreen() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const [d, setD] = useState<ReviewData | null>(null);
  const [queue, setQueue] = useState<studyRepo.Card[]>([]);
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const [stat, setStat] = useState({ again: 0, hard: 0, good: 0 });
  useEffect(() => {
    loadReview(core)
      .then(r => {
        setD(r);
        setQueue(dueToday(r.cards, beijingIso().slice(0, 10)));
      })
      .catch(() => undefined);
  }, [core]);
  const c = queue[i];
  const rate = async (r: Rating) => {
    const now = beijingIso();
    const next = rateCard(c.box, r, now.slice(0, 10));
    await studyRepo.reviewCard(core.db, c.id, next.box, next.due, now);
    if (r === 'again') {
      await studyRepo.addStuck(core.db, c.bookId, c.sectionId, c.front, now);
    }
    setStat(x => ({ ...x, [r]: x[r] + 1 }));
    setFlip(false);
    setI(i + 1);
  };
  if (!d) {
    return (
      <View style={st.page}>
        <NavBar title="复习" back />
      </View>
    );
  }
  if (!c) {
    return (
      <View style={st.page}>
        <NavBar title="复习" back />
        <View style={[st.card, st.center]}>
          <Text style={st.h}>{queue.length ? '本轮复习已完成' : '当前没有待复习的闪卡'}</Text>
          <Text style={st.body}>记得 {stat.good} · 模糊 {stat.hard} · 忘了 {stat.again}</Text>
          {stat.again ? <Note>忘了的卡回到盒 1，明天再来；对应的点加进了卡点清单。</Note> : null}
          <Button title="返回" onPress={() => nav.goBack()} />
        </View>
      </View>
    );
  }
  const btn = (r: Rating, t: string, box: number) => (
    <Pressable key={r} style={[st.rate, r === 'good' && st.rateMain]} onPress={() => rate(r)} accessibilityRole="button" accessibilityLabel={t}>
      <Text style={[st.rateT, r === 'good' && st.white]}>{t}</Text>
      <Text style={[st.rateS, r === 'good' && st.white]}>盒 {box} · {BOX_DAYS[box - 1]} 天</Text>
    </Pressable>
  );
  return (
    <View style={st.page}>
      <NavBar title="复习" sub={i + 1 + ' / ' + queue.length} back />
      <Pressable style={st.flash} onPress={() => setFlip(true)} accessibilityRole="button" accessibilityLabel={flip ? '答案' : '点一下看答案'}>
        <Text style={st.k}>{label(d, c.bookId, c.sectionId)} · 盒 {c.box}</Text>
        <BlockInline text={c.front} style={st.front2} />
        {flip ? <BlockInline text={c.back} style={st.back2} /> : <Text style={[st.k, st.tap]}>点一下看答案</Text>}
      </Pressable>
      {flip ? <View style={st.rates}>{[btn('again', '忘了', 1), btn('hard', '模糊', c.box), btn('good', '记得', Math.min(5, c.box + 1))]}</View> : null}
      <View style={st.foot}>
        <Button title="回到原文" small onPress={() => nav.navigate('Study', { bookId: c.bookId, sectionId: c.sectionId, mode: 'read' })} style={st.grow} />
        <Button title="问 AI" small onPress={() => nav.navigate('Study', { bookId: c.bookId, sectionId: c.sectionId, ask: '这张闪卡我没把握：' + c.front })} style={st.grow} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  cardCheck: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  actions: { padding: 16, gap: 10 },
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 40 },
  card: { backgroundColor: color.card, marginBottom: 8, paddingHorizontal: PAD, paddingVertical: 12, gap: 8 },
  center: { margin: 12, borderRadius: 12, alignItems: 'center' },
  k: { fontSize: 12, color: color.ink3, lineHeight: 18 },
  h: { fontSize: 15, fontWeight: '600', color: color.ink },
  body: { fontSize: 14, color: color.ink, lineHeight: 22 },
  ta: { minHeight: 96, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line, borderRadius: 8, padding: 10, fontSize: 14, lineHeight: 22, color: color.ink, textAlignVertical: 'top' },
  cardRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  box: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: '#C5CAD0', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  boxOn: { backgroundColor: rc.main, borderColor: rc.main },
  tick: { color: '#FFFFFF', fontSize: 12 },
  grow: { flex: 1 },
  grow2: { flex: 2 },
  front: { fontSize: 14, color: color.ink, paddingVertical: 4 },
  back: { fontSize: 13, color: color.ink2, paddingVertical: 2 },
  add: { alignSelf: 'flex-start' },
  foot: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  top: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  big: { fontSize: 34, fontWeight: '600', color: color.ink },
  boxes: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  boxCol: { alignItems: 'center', gap: 3 },
  bar: { width: 18, borderRadius: 3, backgroundColor: rc.main, opacity: 0.75 },
  stuckRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  flash: { margin: 14, minHeight: 260, padding: 18, borderRadius: 16, backgroundColor: rc.page, borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, gap: 12 },
  front2: { fontSize: 18, fontWeight: '600', lineHeight: 28 },
  back2: { fontSize: 15, lineHeight: 25, color: rc.secondary },
  tap: { marginTop: 'auto' },
  rates: { flexDirection: 'row', gap: 6, paddingHorizontal: 14 },
  rate: { flex: 1, backgroundColor: color.card, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  rateMain: { backgroundColor: rc.main },
  rateT: { fontSize: 15, fontWeight: '600', color: color.ink },
  rateS: { fontSize: 10, color: color.ink3 },
  white: { color: '#FFFFFF' },
});
