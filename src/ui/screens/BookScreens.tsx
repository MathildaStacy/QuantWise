/**
 * 书的地图（章 → 节 → 小节、每节状态、全文搜索、删书）和笔记（摘要、问答、卡点、高亮，导出 Markdown / Anki）。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { citeLabel, leavesOf, secLabel } from '../../book/book';
import { ankiCsv, notesMarkdown } from '../../book/export';
import type { Book, BookBlock, BookSection } from '../../book/types';
import * as bookRepo from '../../data/bookRepo';
import * as studyRepo from '../../data/studyRepo';
import { resumeSection } from '../../study/library';
import { exportText } from '../../app/exportFile';
import { ConfirmDialog } from '../components/Dialog';
import { AiFab, Button, NavBar, Note } from '../components/ui';
import { useAiContext, useCore } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { rc } from '../readTheme';
import { color, PAD } from '../theme';
import { toast } from '../toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const ICON: Record<studyRepo.SectionStatus, [string, string, string]> = {
  done: ['●', rc.main, '已学'],
  learning: ['◐', rc.main, '在学'],
  stuck: ['!', rc.stuck, '有卡点'],
  new: ['○', color.ink3, '未学'],
};

interface MapData {
  book: Book;
  sections: BookSection[];
  state: studyRepo.StudyState | null;
  stuck: Set<string>;
  notes: Map<string, string>;
}

export function BookMapScreen({ route }: RootScreenProps<'BookMap'>) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const [d, setD] = useState<MapData | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<BookBlock[] | null>(null);
  const [del, setDel] = useState(false);
  const { bookId } = route.params;
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const book = await bookRepo.book(core.db, bookId);
        if (!book) {
          return;
        }
        const [sections, state, stuck, notes] = await Promise.all([
          bookRepo.sections(core.db, bookId),
          studyRepo.getState(core.db, bookId),
          studyRepo.stuckOf(core.db, bookId),
          studyRepo.notesOf(core.db, bookId),
        ]);
        setD({ book, sections, state, stuck: new Set(stuck.filter(x => !x.resolvedAt).map(x => x.sectionId)), notes: new Map(notes.filter(n => n.summary).map(n => [n.sectionId, n.summary])) });
      })().catch(() => undefined);
    }, [core, bookId]),
  );
  useAiContext('BookMap', () => ({ name: '书的地图 · ' + (d?.book.title ?? ''), lines: d ? [leavesOf(d.sections).length + ' 个小节'] : [] }));
  if (!d) {
    return (
      <View style={st.page}>
        <NavBar title="书的地图" back />
      </View>
    );
  }
  const leaves = leavesOf(d.sections);
  const done = leaves.filter(s => d.state?.sections[s.id]?.done).length;
  const main = resumeSection(d.sections, d.state);
  const search = async () => setHits(await bookRepo.searchBlocks(core.db, bookId, q, 20));
  const row = (s: BookSection) => {
    const status = studyRepo.sectionStatus(d.state, s.id, d.stuck);
    const [icon, c, label] = ICON[status];
    return (
      <Pressable key={s.id} style={({ pressed }) => [st.row, pressed && st.pressed]} onPress={() => nav.navigate('Study', { bookId, sectionId: s.id })} accessibilityRole="button" accessibilityLabel={secLabel(s) + '，' + label}>
        <Text style={[st.icon, { color: c }]}>{icon}</Text>
        <View style={st.grow}>
          <Text style={st.rowT}>{secLabel(s)}</Text>
          {d.notes.get(s.id) ? <Text style={st.rowS} numberOfLines={1}>{d.notes.get(s.id)}</Text> : null}
        </View>
        <Text style={st.meta}>{label} · {s.pageFrom != null ? 'p.' + s.pageFrom : s.chars + ' 字'}</Text>
      </Pressable>
    );
  };
  return (
    <View style={st.page}>
      <NavBar title="书的地图" sub={d.book.title} back />
      <ScrollView contentContainerStyle={st.pad}>
        <View style={st.card}>
          <Text style={st.title}>{d.book.title}</Text>
          <Text style={st.meta}>{(d.book.author || '未知作者') + ' · ' + leaves.length + ' 节 · 已学 ' + done}</Text>
          {main ? <Button title={(d.state?.sections[main.id]?.done ? '回看 ' : d.state ? '继续 ' : '开始阅读 ') + secLabel(main)} tone="learn" onPress={() => nav.navigate('Study', { bookId, sectionId: main.id })} style={st.btn} /> : null}
          {d.book.body.warnings?.length ? <Note tone="warn">{d.book.body.warnings.length + ' 条解析提示：' + d.book.body.warnings.slice(0, 3).join('；')}</Note> : null}
        </View>
        <View style={st.searchRow}>
          <TextInput value={q} onChangeText={setQ} onSubmitEditing={search} placeholder="全文搜索，例如：换手、IC" placeholderTextColor={color.ink3} style={st.search} returnKeyType="search" />
          <Button title="搜索" small onPress={search} />
        </View>
        {hits ? (
          <View style={st.card}>
            {hits.length ? null : <Text style={st.meta}>没有找到「{q}」</Text>}
            {hits.map(b => {
              const s = d.sections.find(x => x.id === b.sectionId);
              return (
                <Pressable key={b.seq} style={st.hit} onPress={() => nav.navigate('Study', { bookId, sectionId: b.sectionId, mode: 'read', blockSeq: b.seq })} accessibilityRole="button">
                  <Text style={st.cite}>{s ? citeLabel(s, b) : b.sectionId}</Text>
                  <Text style={st.hitT} numberOfLines={2}>{b.text}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {d.sections.filter(s => s.level === 1).map(ch => {
          const kids = leaves.filter(s => chapterOf(d.sections, s) === ch.id);
          return kids.length ? (
            <View key={ch.id} style={st.card}>
              <Text style={st.chap}>{secLabel(ch)}</Text>
              {kids.map(row)}
            </View>
          ) : null;
        })}
        <View style={st.foot}>
          <Button title="笔记" small onPress={() => nav.navigate('Notes', { bookId })} style={st.grow} />
          {d.book.source !== 'sample' ? <Button title="从书架删除" small onPress={() => setDel(true)} style={st.grow} /> : null}
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={del}
        title="从书架删除这本书"
        rows={[]}
        okTitle="删除"
        okTone="sell"
        onCancel={() => setDel(false)}
        onOk={async () => {
          setDel(false);
          await bookRepo.deleteBook(core.db, bookId);
          toast.show('已删除：' + d.book.title);
          nav.goBack();
        }}
      >
        <Text style={st.meta}>章节、学习记录、笔记、闪卡和这本书的伴读对话一起删除，不能恢复。</Text>
      </ConfirmDialog>
      <AiFab />
    </View>
  );
}

/** 一个小节属于哪一章（沿 parentId 往上找到第 1 级）。 */
function chapterOf(sections: BookSection[], s: BookSection): string {
  let cur: BookSection | undefined = s;
  while (cur?.parentId) {
    cur = sections.find(x => x.id === cur!.parentId);
  }
  return cur?.id ?? s.id;
}

// ---------- 笔记 ----------

interface NotesData {
  book: Book;
  sections: BookSection[];
  notes: studyRepo.SectionNote[];
  stuck: studyRepo.Stuck[];
  cards: studyRepo.Card[];
  highlights: { sectionId: string; label: string; text: string }[];
}

export function NotesScreen({ route }: RootScreenProps<'Notes'>) {
  const core = useCore();
  const [d, setD] = useState<NotesData | null>(null);
  const { bookId } = route.params;
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const book = await bookRepo.book(core.db, bookId);
        if (!book) {
          return;
        }
        const sections = await bookRepo.sections(core.db, bookId);
        const marks = (await studyRepo.marksOf(core.db, bookId)).filter(m => m.kind === 'highlight');
        const blocks = await bookRepo.blocksBySeq(core.db, bookId, marks.map(m => m.blockSeq));
        setD({
          book,
          sections,
          notes: await studyRepo.notesOf(core.db, bookId),
          stuck: await studyRepo.stuckOf(core.db, bookId),
          cards: await studyRepo.cards(core.db, bookId),
          highlights: blocks.map(b => ({ sectionId: b.sectionId, label: citeLabel(sections.find(s => s.id === b.sectionId) ?? { id: b.sectionId, no: '', title: '' }, b), text: b.text })),
        });
      })().catch(() => undefined);
    }, [core, bookId]),
  );
  if (!d) {
    return (
      <View style={st.page}>
        <NavBar title="笔记" back />
      </View>
    );
  }
  const exp = {
    title: d.book.title,
    author: d.book.author,
    sections: d.sections,
    notes: d.notes,
    stuck: d.stuck.map(x => ({ sectionId: x.sectionId, text: x.text, resolved: !!x.resolvedAt })),
    highlights: d.highlights,
  };
  const share = (name: string, text: string, mime: 'text/plain' | 'text/csv') =>
    exportText(name, text, mime).catch(e => toast.show(e instanceof Error ? e.message : String(e), 'bad'));
  const with_ = d.sections.filter(s => d.notes.some(n => n.sectionId === s.id && (n.summary || n.qa.length)) || d.stuck.some(x => x.sectionId === s.id) || d.highlights.some(h => h.sectionId === s.id));
  return (
    <View style={st.page}>
      <NavBar title="笔记" sub={d.book.title} back />
      <ScrollView contentContainerStyle={st.pad}>
        <View style={st.card}>
          <Text style={st.meta}>{d.notes.filter(n => n.summary).length} 节摘要 · {d.notes.reduce((n, x) => n + x.qa.length, 0)} 条问答 · {d.cards.length} 张闪卡 · {d.highlights.length} 处高亮</Text>
          <View style={st.foot}>
            <Button title="导出 Markdown" small onPress={() => share(d.book.title + '-笔记.md', notesMarkdown(exp), 'text/plain')} style={st.grow} />
            <Button title="导出 Anki CSV" small disabled={!d.cards.length} onPress={() => share(d.book.title + '-闪卡.csv', ankiCsv(d.cards, d.book.title), 'text/csv')} style={st.grow} />
          </View>
        </View>
        {!with_.length ? <Text style={[st.meta, st.empty]}>学完一节、保存小结后，这里会有摘要、问答和卡点。</Text> : null}
        {with_.map(s => {
          const n = d.notes.find(x => x.sectionId === s.id);
          return (
            <View key={s.id} style={st.card}>
              <Text style={st.chap}>{secLabel(s)}</Text>
              {n?.summary ? <Text style={st.body}>{n.summary}</Text> : null}
              {n?.qa.map((x, i) => (
                <View key={i} style={st.qa}>
                  <Text style={st.qaQ}>问：{x.q}</Text>
                  <Text style={st.body}>{x.a}</Text>
                </View>
              ))}
              {d.stuck.filter(x => x.sectionId === s.id).map(x => (
                <Text key={x.id} style={[st.body, st.stuck]}>! 卡点：{x.text}{x.resolvedAt ? '（已解决）' : ''}</Text>
              ))}
              {d.highlights.filter(h => h.sectionId === s.id).map(h => (
                <Text key={h.label} style={st.hl} numberOfLines={3}>{h.text}（{h.label}）</Text>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 96 },
  pressed: { backgroundColor: color.press },
  card: { backgroundColor: color.card, marginBottom: 8, paddingHorizontal: PAD, paddingVertical: 10, gap: 6 },
  title: { fontSize: 17, fontWeight: '600', color: color.ink },
  meta: { fontSize: 12, color: color.ink3 },
  btn: { marginTop: 6 },
  chap: { fontSize: 14, fontWeight: '600', color: color.ink2, paddingTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  icon: { width: 20, textAlign: 'center', fontSize: 14, fontWeight: '700' },
  grow: { flex: 1 },
  rowT: { fontSize: 15, color: color.ink },
  rowS: { fontSize: 11, color: color.ink3, marginTop: 2 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingBottom: 8 },
  search: { flex: 1, height: 38, borderRadius: 8, backgroundColor: color.card, paddingHorizontal: 12, fontSize: 14, color: color.ink },
  hit: { paddingVertical: 8, gap: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  cite: { fontSize: 11, color: rc.main },
  hitT: { fontSize: 13, color: color.ink2, lineHeight: 19 },
  foot: { flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  empty: { padding: PAD, lineHeight: 18 },
  body: { fontSize: 14, color: color.ink, lineHeight: 22 },
  qa: { gap: 2 },
  qaQ: { fontSize: 14, fontWeight: '600', color: color.ink },
  stuck: { color: rc.stuck },
  hl: { fontSize: 13, color: color.ink2, backgroundColor: rc.highlight, padding: 6, borderRadius: 4, lineHeight: 20 },
});
