/**
 * 学习 Tab 的「读书」（QUANTWISE_DESIGN.md §3）：继续学习、复习 / 因子实验室 / 笔记 / 导入、书架。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BookOpen, ChevronRight, FlaskConical, Layers, NotebookPen, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SAMPLE_BOOK_ID } from '../../book/sample';
import { secLabel } from '../../book/book';
import { beijingIso } from '../../market/clock';
import { pickAndImport, useParse } from '../../study/importer';
import { loadShelf, type Shelf } from '../../study/library';
import { useAiContext, useCore } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { rc } from '../readTheme';
import { color, num, PAD } from '../theme';
import { toast } from '../toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const coverColor = (b: Shelf['books'][number]['book']) => ({
  backgroundColor: b.format === 'pdf' ? '#7A4E2D' : b.source === 'sample' ? rc.main : '#6B5B95',
});

export function ShelfView() {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [busy, setBusy] = useState(false);
  // 后台解析完成/暂停也要刷新书架，不能只等用户离开再回来。
  const parseStatus = useParse(states => Object.entries(states).map(([id, p]) => id + ':' + p.stage + ':' + p.error).join('|'));
  const load = useCallback(() => {
    loadShelf(core.db, beijingIso().slice(0, 10)).then(setShelf).catch(() => undefined);
  }, [core]);
  useFocusEffect(load);
  useEffect(load, [load, parseStatus]);
  useAiContext('Learn', () => ({
    name: '学习 · 读书',
    lines: [
      ...(shelf?.books ?? []).map(b => '《' + b.book.title + '》' + (b.book.status === 'ready' ? b.done + ' / ' + b.leaves + ' 节已学' : '解析中')),
      ...(shelf?.resume ? ['继续学习：' + secLabel(shelf.resume.section)] : []),
      '今日待复习 ' + (shelf?.due ?? 0) + ' 张，没解决的卡点 ' + (shelf?.stuck ?? 0) + ' 个',
    ],
    tip: '书架上的书点进去是书的地图；「继续学习」直接进上次的小节。听讲时 AI 会用真实行情画图、算因子举例。',
  }));
  const importBook = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const r = await pickAndImport(core);
      if (r?.kind === 'pdf') {
        nav.navigate('ImportBook', { path: r.path, name: r.name, size: r.size });
      } else if (r?.kind === 'done') {
        toast.show(r.existed ? '这本书已经在书架上了' : '已导入：' + r.title);
        nav.navigate('BookMap', { bookId: r.bookId });
      }
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
      load();
    }
  };
  const r = shelf?.resume;
  const tools: [typeof Layers, string, string, () => void][] = [
    [Layers, '复习', '今日 ' + (shelf?.due ?? 0) + ' 张', () => nav.navigate('Review')],
    [FlaskConical, '因子实验', '7 个因子', () => nav.navigate('FactorLab')],
    [NotebookPen, '笔记', '按书和小节', () => nav.navigate('Notes', { bookId: r?.book.id ?? SAMPLE_BOOK_ID })],
    [Plus, busy ? '导入中…' : '导入', 'PDF/EPUB/MD', importBook],
  ];
  return (
    <ScrollView contentContainerStyle={s.pad}>
      {r ? (
        <Pressable
          style={({ pressed }) => [s.cont, pressed && s.pressed]}
          onPress={() => nav.navigate('Study', { bookId: r.book.id, sectionId: r.section.id })}
          accessibilityRole="button"
          accessibilityLabel={'继续学习 ' + secLabel(r.section)}
        >
          <Text style={s.contK}>继续学习{r.awayDays >= 1 ? ' · 距上次 ' + r.awayDays + ' 天' : ''}</Text>
          <Text style={s.contT}>{secLabel(r.section)}</Text>
          <Text style={s.contS} numberOfLines={2}>
            《{r.book.title}》· 第 {r.step + 1} 步{r.stuck ? ' · 上次卡在：' + r.stuck : ''}
          </Text>
          <Text style={s.contGo}>继续 ›</Text>
        </Pressable>
      ) : <View style={s.first}>
        <Text style={s.firstTitle}>{shelf?.introCompleted ? '已经认识动量，接着读原文' : '用 3 分钟，学懂第一个因子'}</Text>
        <Text style={s.firstBody}>涨过的股票，还会继续涨吗？先理解动量，再用数据检验。</Text>
        <Text style={s.firstMeta}>内置体验 · 无需连接 AI</Text>
        <Pressable accessibilityRole="button" style={s.start} onPress={() => shelf?.introCompleted ? nav.navigate('Study', { bookId: SAMPLE_BOOK_ID, sectionId: '3.1', mode: 'read' }) : nav.navigate('StudyIntro')}><BookOpen color="#FFFFFF" size={20} /><Text style={s.startText}>{shelf?.introCompleted ? '读动量原文' : '开始体验'}</Text></Pressable>
      </View>}
      <View style={s.tools}>
        {tools.map(([Icon, l, d, f]) => (
          <Pressable key={l} style={({ pressed }) => [s.tool, pressed && s.pressed]} onPress={f} accessibilityRole="button" accessibilityLabel={l}>
            <Icon size={22} color={rc.main} /><View style={s.grow}><Text style={s.toolL}>{l}</Text><Text style={s.toolD}>{d}</Text></View><ChevronRight color={color.ink3} size={18} />
          </Pressable>
        ))}
      </View>
      <View style={s.card}>
        <Text style={s.h}>书架</Text>
        {(shelf?.books ?? []).map(b => (
          <Pressable
            key={b.book.id}
            style={({ pressed }) => [s.row, pressed && s.pressed]}
            onPress={() => nav.navigate(b.book.status === 'ready' ? 'BookMap' : 'ParseProgress', { bookId: b.book.id })}
            accessibilityRole="button"
            accessibilityLabel={b.book.title}
          >
            <View style={[s.cover, coverColor(b.book)]}>
              <Text style={s.coverT}>{b.book.source === 'sample' ? '因子' : b.book.format.toUpperCase()}</Text>
            </View>
            <View style={s.grow}>
              <Text style={s.bookT} numberOfLines={3}>{b.book.title}</Text>
              <Text style={s.bookS} numberOfLines={1}>
                {(b.book.author || '未知作者') + ' · ' + (b.book.source === 'sample' ? '内置示例' : b.book.format.toUpperCase())}
              </Text>
            </View>
            <Text style={[s.bookR, num]}>
              {b.book.status === 'ready' ? b.done + ' / ' + b.leaves + ' 节' : b.book.status === 'failed' ? '解析失败' : b.book.error ? '已暂停' : '解析中'}
            </Text>
            <ChevronRight color={color.ink3} size={18} />
          </Pressable>
        ))}
      </View>
      <Text style={s.foot}>只学你自己拥有的书。PDF 在你确认后上传到 MinerU 解析；讲解时当前小节的原文会发给你配置的 AI 服务。</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  first: { padding: 20, gap: 12, backgroundColor: rc.page },
  firstTitle: { fontSize: 24, lineHeight: 34, color: rc.ink, fontWeight: '600' },
  firstBody: { fontSize: 16, lineHeight: 26, color: rc.secondary },
  firstMeta: { fontSize: 13, color: rc.secondary },
  start: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 48, marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: rc.main },
  startText: { fontSize: 16, color: '#FFFFFF', fontWeight: '600' },
  pad: { paddingBottom: 24 },
  pressed: { opacity: 0.8 },
  cont: { margin: 10, padding: 14, borderRadius: 12, backgroundColor: rc.main },
  contK: { fontSize: 12, color: '#FFFFFFCC' },
  contT: { fontSize: 18, fontWeight: '600', color: '#FFFFFF', marginTop: 2 },
  contS: { fontSize: 12, color: '#FFFFFFDD', marginTop: 2, lineHeight: 18 },
  contGo: { position: 'absolute', right: 14, top: 14, color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  tools: { paddingHorizontal: 16, backgroundColor: rc.page },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rc.line },
  toolL: { fontSize: 13, fontWeight: '600', color: color.ink },
  toolD: { fontSize: 12, color: color.ink3 },
  card: { backgroundColor: color.card, marginBottom: 8 },
  h: { fontSize: 15, fontWeight: '600', color: color.ink, paddingHorizontal: PAD, paddingTop: 12, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: PAD, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  cover: { width: 38, height: 50, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  coverT: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  grow: { flex: 1 },
  bookT: { fontSize: 15, fontWeight: '600', color: color.ink },
  bookS: { fontSize: 12, color: color.ink3, marginTop: 2 },
  bookR: { fontSize: 12, color: color.ink3 },
  foot: { fontSize: 11, color: color.ink3, paddingHorizontal: PAD, paddingVertical: 8, lineHeight: 17 },
});
