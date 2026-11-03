/**
 * 讲解记录（docs/design/ai-study-options.md §3）：一本书（或全部书）的讲解对话，按小节一行：
 * 状态、最后一个问题或本节摘要、模型和规模。点开继续讲；长按新开一轮、导出、删除；历史轮次只读可看。
 * 只读本机数据，不请求模型。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { configBrief } from '../../ai/models';
import type { StoredMessage } from '../../ai/types';
import { exportText } from '../../app/exportFile';
import { chapterOf, citeLabel, secLabel } from '../../book/book';
import { plainStudyText, type CiteCheck } from '../../book/markup';
import type { BookSection } from '../../book/types';
import * as aiRepo from '../../data/aiRepo';
import * as bookRepo from '../../data/bookRepo';
import * as studyRepo from '../../data/studyRepo';
import { deleteStudyThread, newStudyRound } from '../../study/session';
import { ChartCard } from '../charts/ChartCard';
import { LockScroll } from '../charts/scrub';
import { AiSheet } from '../components/AiOptions';
import { ConfirmDialog } from '../components/Dialog';
import { StudyText } from '../components/StudyText';
import { Button, Empty, NavBar } from '../components/ui';
import { useCore } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { rc } from '../readTheme';
import { toast } from '../toast';
import { realChecked, turnsOf } from './StudyThread';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 一个小节在列表里的一行：当前这一轮 + 归档的历史轮次。 */
interface Row {
  bookId: string;
  bookTitle: string;
  sectionId: string;
  section: BookSection | null;
  chapter: BookSection | null;
  active: studyRepo.StudyThreadRow | null;
  archived: studyRepo.StudyThreadRow[];
  updatedAt: string;
  done: boolean;
  taught: number;
  detour: boolean;
  stuck: boolean;
  note: string | null;
}

const when = (iso: string) => iso.slice(5, 16).replace('T', ' ');

async function loadRows(db: Parameters<typeof studyRepo.studyThreads>[0], bookId: string | undefined, query: string): Promise<Row[]> {
  const threads = await studyRepo.studyThreads(db, { bookId, query });
  const books = [...new Set(threads.map(t => t.bookId))];
  const info = new Map<string, { sections: BookSection[]; state: studyRepo.StudyState | null; notes: Map<string, string>; stuck: Set<string> }>();
  for (const id of books) {
    const [sections, state, notes, stuck] = await Promise.all([
      bookRepo.sections(db, id),
      studyRepo.getState(db, id),
      studyRepo.notesOf(db, id),
      studyRepo.stuckOf(db, id),
    ]);
    info.set(id, { sections, state, notes: new Map(notes.filter(n => n.summary).map(n => [n.sectionId, n.summary])), stuck: new Set(stuck.filter(x => !x.resolvedAt).map(x => x.sectionId)) });
  }
  const rows = new Map<string, Row>();
  for (const t of threads) {
    const k = t.bookId + '\u0000' + t.sectionId;
    let r = rows.get(k);
    if (!r) {
      const b = info.get(t.bookId)!;
      const section = b.sections.find(x => x.id === t.sectionId) ?? null;
      const p = b.state?.sections[t.sectionId];
      r = {
        bookId: t.bookId,
        bookTitle: t.bookTitle,
        sectionId: t.sectionId,
        section,
        chapter: section ? b.sections.find(x => x.id === chapterOf(b.sections, section)) ?? null : null,
        active: null,
        archived: [],
        updatedAt: t.updatedAt,
        done: !!p?.done,
        taught: p?.taught ?? -1,
        detour: !!p?.detour,
        stuck: b.stuck.has(t.sectionId),
        note: b.notes.get(t.sectionId) ?? null,
      };
      rows.set(k, r);
    }
    if (t.archivedAt) {
      r.archived.push(t);
    } else if (!r.active) {
      r.active = t;
    }
    if (t.updatedAt > r.updatedAt) r.updatedAt = t.updatedAt;
  }
  for (const r of rows.values()) r.archived.sort((a, b) => a.id - b.id);
  return [...rows.values()];
}

/** 一轮讲解导出成 Markdown：问题和回答正文（去掉标记），引用写成块号。 */
async function roundMarkdown(db: Parameters<typeof aiRepo.messages>[0], t: studyRepo.StudyThreadRow): Promise<string> {
  const msgs = await aiRepo.messages(db, t.id);
  const out = ['# ' + t.bookTitle + ' · ' + t.title, '', '讲解时间：' + when(t.createdAt) + ' – ' + when(t.updatedAt), ''];
  for (const m of msgs) {
    if (m.role === 'user' && m.ui?.question) out.push('## 问：' + m.ui.question, '');
    if (m.role === 'assistant') {
      const text = m.parts.map(x => (x.t === 'text' ? x.text : '')).join('').replace(/\[\[b:([\w.-]+)[#¶](\d+)\]\]/g, '（$1 ¶$2）');
      if (text.trim()) out.push(plainStudyText(text), '');
    }
  }
  return out.join('\n');
}

export function StudyHistoryList({ bookId }: { bookId?: string }) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<'recent' | 'toc'>('recent');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<Row | null>(null);
  const [del, setDel] = useState<studyRepo.StudyThreadRow | null>(null);
  /** 列表当前按哪个词筛过（输入框里的字没提交前不算）。 */
  const [applied, setApplied] = useState('');
  const reload = useCallback((q = query) => {
    setApplied(q.trim());
    loadRows(core.db, bookId, q).then(setRows).catch(() => setRows([]));
  }, [core, bookId, query]);
  useFocusEffect(useCallback(() => reload(), [reload]));
  const fail = (e: unknown) => toast.show(e instanceof Error ? e.message : String(e), 'bad');

  const groups = useMemo(() => {
    const list = rows ?? [];
    const out: { key: string; title: string | null; rows: Row[] }[] = [];
    const push = (key: string, title: string | null, r: Row) => {
      const g = out.find(x => x.key === key) ?? (out.push({ key, title, rows: [] }), out[out.length - 1]);
      g.rows.push(r);
    };
    const sorted = order === 'recent'
      ? [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      : [...list].sort((a, b) => (a.bookTitle === b.bookTitle ? (a.section?.ord ?? 0) - (b.section?.ord ?? 0) : a.bookTitle < b.bookTitle ? -1 : 1));
    for (const r of sorted) {
      const book = bookId ? '' : r.bookTitle;
      if (order === 'toc') {
        push(r.bookId + ':' + (r.chapter?.id ?? ''), [book, r.chapter ? secLabel(r.chapter) : ''].filter(Boolean).join(' · ') || null, r);
      } else {
        push(bookId ? 'all' : r.bookId, bookId ? null : r.bookTitle, r);
      }
    }
    return out;
  }, [rows, order, bookId]);

  const status = (r: Row) =>
    [r.done ? '✓ 已学完' : r.taught >= 0 ? '讲到第 ' + (r.taught + 1) + ' 步' : '还没讲完第 1 步', r.detour ? '有岔路' : '', r.stuck ? '有没解决的卡点' : ''].filter(Boolean).join(' · ');
  const meta = (r: Row) => {
    const t = r.active;
    const c = t?.config;
    return [
      c ? configBrief(c) : '',
      t ? t.questions + ' 问' : applied ? '当前一轮没有匹配' : '还没有新的一轮',
      t?.compactedCount ? '较早 ' + t.compactedCount + ' 问已整理' : '',
    ].filter(Boolean).join(' · ');
  };

  return (
    <View style={st.grow}>
      <View style={st.tools}>
        <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => reload(query)} placeholder="在问题和讲解里搜索" placeholderTextColor={rc.muted} style={st.search} returnKeyType="search" accessibilityLabel="搜索讲解记录" />
        <View style={st.seg}>
          {(['recent', 'toc'] as const).map(k => (
            <Pressable key={k} onPress={() => setOrder(k)} style={[st.segB, order === k && st.segOn]} accessibilityRole="tab" accessibilityState={{ selected: order === k }}>
              <Text style={[st.segT, order === k && st.segTOn]}>{k === 'recent' ? '最近' : '按目录'}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <ScrollView contentContainerStyle={st.pad} keyboardShouldPersistTaps="handled">
        {rows && !rows.length ? <Empty text={applied ? '没有找到「' + applied + '」' : '还没有讲解记录。打开任意小节点「开始讲」就会出现在这里。'} /> : null}
        {groups.map(g => (
          <View key={g.key}>
            {g.title ? <Text style={st.group}>{g.title}</Text> : null}
            <View style={st.card}>
              {g.rows.map(r => {
                const k = r.bookId + ':' + r.sectionId;
                const line = r.done && r.note ? '摘要：' + r.note : r.active?.lastQuestion ? '「' + r.active.lastQuestion + '」' : null;
                return (
                  <View key={k} style={st.item}>
                    <Pressable
                      style={({ pressed }) => [st.row, pressed && st.pressed]}
                      onPress={() => nav.navigate('Study', { bookId: r.bookId, sectionId: r.sectionId, mode: 'lecture' })}
                      onLongPress={() => setMenu(r)}
                      accessibilityRole="button"
                      accessibilityHint="长按可以新开一轮、导出或删除"
                    >
                      <View style={st.head}>
                        <Text style={st.title} numberOfLines={1}>{r.section ? secLabel(r.section) : r.active?.title ?? r.sectionId}</Text>
                        <Text style={st.time}>{when(r.updatedAt)}</Text>
                      </View>
                      <Text style={[st.sub, r.done && st.done]}>{status(r)}</Text>
                      {line ? <Text style={st.line} numberOfLines={2}>{line}</Text> : null}
                      <Text style={st.meta} numberOfLines={1}>{meta(r)}</Text>
                    </Pressable>
                    {r.archived.length ? (
                      <Pressable style={st.more} onPress={() => setOpen(o => ({ ...o, [k]: !o[k] }))} accessibilityRole="button" accessibilityState={{ expanded: !!open[k] }}>
                        <Text style={st.meta}>另有 {r.archived.length} 轮历史 {open[k] ? '▴' : '▸'}</Text>
                      </Pressable>
                    ) : null}
                    {open[k] ? r.archived.map((t, i) => (
                      <Pressable key={t.id} style={({ pressed }) => [st.round, pressed && st.pressed]} onPress={() => nav.navigate('StudyRound', { threadId: t.id, bookId: r.bookId, sectionId: r.sectionId })} accessibilityRole="button">
                        <Text style={st.sub}>第 {i + 1} 轮 · {when(t.createdAt)} · {t.questions} 问 · 只读 ›</Text>
                      </Pressable>
                    )) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
      <AiSheet title={menu?.section ? secLabel(menu.section) : '讲解记录'} visible={!!menu} onClose={() => setMenu(null)}>
        <View style={st.menu}>
          <Button title="继续讲解" tone="learn" onPress={() => { const r = menu!; setMenu(null); nav.navigate('Study', { bookId: r.bookId, sectionId: r.sectionId, mode: 'lecture' }); }} />
          {menu?.active ? <>
            <Button title="新开一轮" onPress={() => { const t = menu!.active!; setMenu(null); newStudyRound(core, t.id).then(() => { toast.show('已新开一轮：旧的讲解保留为只读，下次提问从头开始', 'learn'); reload(); }).catch(fail); }} />
            <Text style={st.menuNote}>新开一轮会重新拍书的地图（带上最新的小节摘要），学习进度、笔记、闪卡和卡点不变。</Text>
            <Button title="导出 Markdown" onPress={() => { const t = menu!.active!; setMenu(null); roundMarkdown(core.db, t).then(text => exportText(t.bookTitle + '-' + t.title + '-讲解.md', text, 'text/plain')).catch(fail); }} />
            <Button title="删除这一轮" onPress={() => { const t = menu!.active!; setMenu(null); setDel(t); }} />
          </> : null}
        </View>
      </AiSheet>
      <ConfirmDialog
        visible={!!del}
        title="删除讲解对话"
        rows={[{ k: '小节', v: del?.title ?? '' }, { k: '提问', v: (del?.questions ?? 0) + ' 问' }]}
        okTitle="删除"
        okTone="sell"
        onCancel={() => setDel(null)}
        onOk={() => { const t = del!; setDel(null); deleteStudyThread(core, t.id).then(() => reload()).catch(fail); }}
      >
        <Text style={st.menuNote}>学习进度、笔记、闪卡和卡点会保留。</Text>
      </ConfirmDialog>
    </View>
  );
}

export function StudyHistoryScreen({ route }: RootScreenProps<'StudyHistory'>) {
  const core = useCore();
  const bookId = route.params?.bookId;
  const [title, setTitle] = useState<string | undefined>(undefined);
  useFocusEffect(useCallback(() => {
    if (bookId) bookRepo.book(core.db, bookId).then(b => setTitle(b?.title)).catch(() => undefined);
  }, [core, bookId]));
  return (
    <View style={st.page}>
      <NavBar title="讲解记录" sub={title} back />
      <StudyHistoryList bookId={bookId} />
    </View>
  );
}

/** 归档的一轮讲解：只读，不请求模型。 */
export function StudyRoundScreen({ route }: RootScreenProps<'StudyRound'>) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const { threadId, bookId, sectionId } = route.params;
  const [d, setD] = useState<{ title: string; createdAt: string; messages: StoredMessage[]; sections: BookSection[] } | null>(null);
  useFocusEffect(useCallback(() => {
    (async () => {
      const [thread, messages, sections] = await Promise.all([aiRepo.thread(core.db, threadId), aiRepo.messages(core.db, threadId), bookRepo.sections(core.db, bookId)]);
      if (thread) setD({ title: thread.title, createdAt: thread.createdAt, messages, sections });
    })().catch(() => undefined);
  }, [core, threadId, bookId]));
  const turns = useMemo(() => (d ? turnsOf(d.messages) : []), [d]);
  const checked = useMemo(() => realChecked(turns), [turns]);
  const check: CiteCheck = useCallback((sec: string, no: number) => {
    const s = d?.sections.find(x => x.id === sec);
    return s ? citeLabel(s, { no, page: null }) : null;
  }, [d]);
  const onLink = (href: string) => {
    const m = /^cite:([\w.-]+)#(\d+)$/.exec(href);
    if (m) nav.navigate('Study', { bookId, sectionId: m[1], mode: 'read' });
    else if (/^https?:\/\//.test(href)) Linking.openURL(href).catch(() => toast.show('打不开这个链接', 'bad'));
  };
  return (
    <View style={st.page}>
      <NavBar title={d?.title ?? '讲解'} sub="历史轮次 · 只读" back />
      <LockScroll contentContainerStyle={st.pad}>
        {d ? (
          <View style={st.banner}>
            <Text style={st.sub}>这是 {when(d.createdAt)} 开始的一轮讲解，只读。</Text>
            <Button title="回到当前讲解" small onPress={() => nav.navigate('Study', { bookId, sectionId, mode: 'lecture' })} />
          </View>
        ) : null}
        {turns.map(t => (
          <View key={t.first}>
            {t.question ? <View style={st.uRow}><Text style={st.u}>{t.question}</Text></View> : null}
            {t.tools.map(x => <Text key={x.id} style={st.meta}>↳ {x.label}</Text>)}
            {t.flow.map(x => {
              if ('charts' in x) {
                return x.charts.map((c, i) => <ChartCard key={'c' + x.id + ':' + i} data={c} />);
              }
              const text = x.m.parts.map(p => (p.t === 'text' ? p.text : '')).join('');
              return text.trim() ? <StudyText key={x.m.id} text={text} check={check} onLink={onLink} realChecked={!!checked.get(t.first)} /> : null;
            })}
          </View>
        ))}
      </LockScroll>
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: rc.page },
  grow: { flex: 1 },
  pad: { padding: 16, paddingBottom: 32, gap: 8 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10 },
  search: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: rc.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, paddingHorizontal: 12, fontSize: 15, color: rc.ink },
  seg: { flexDirection: 'row', backgroundColor: rc.soft, borderRadius: 10, padding: 3 },
  segB: { minHeight: 42, minWidth: 48, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 8 },
  segOn: { backgroundColor: rc.paper },
  segT: { fontSize: 13, color: rc.secondary },
  segTOn: { color: rc.ink, fontWeight: '600' },
  group: { fontSize: 12, color: rc.muted, marginTop: 8, marginBottom: 2 },
  card: { borderRadius: 12, backgroundColor: rc.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, overflow: 'hidden' },
  item: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rc.line },
  row: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, gap: 3 },
  pressed: { backgroundColor: rc.soft },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: rc.ink },
  time: { fontSize: 12, color: rc.muted, fontVariant: ['tabular-nums'] },
  sub: { fontSize: 13, color: rc.secondary, lineHeight: 19 },
  done: { color: rc.realInk },
  line: { fontSize: 13, color: rc.ink, lineHeight: 20 },
  meta: { fontSize: 12, color: rc.muted, lineHeight: 18 },
  more: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  round: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 24 },
  menu: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  menuNote: { fontSize: 12, color: rc.muted, lineHeight: 18 },
  banner: { padding: 12, borderRadius: 12, backgroundColor: rc.soft, gap: 8 },
  uRow: { alignItems: 'flex-end', marginTop: 14, marginBottom: 6 },
  u: { backgroundColor: rc.user, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, maxWidth: '85%', fontSize: 15, lineHeight: 24, color: rc.ink, overflow: 'hidden' },
});
