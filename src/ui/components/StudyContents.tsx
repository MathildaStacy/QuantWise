/** 读书模式的本书目录：按原书顺序列出所有小节，可按标题或编号搜索，打开时停在当前小节；讲解生成中不能换节。 */
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { leavesOf, secLabel } from '../../book/book';
import type { StudySession } from '../../study/session';
import { AiSheet } from './AiOptions';
import { rc } from '../readTheme';

export function StudyContents({ s, busy, onClose, onSelect }: {
  s: StudySession; busy: boolean; onClose: () => void; onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const sections = useMemo(() => leavesOf(s.sections), [s.sections]);
  const filtered = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return sections.filter(section => words.every(word => secLabel(section).toLocaleLowerCase().includes(word)));
  }, [query, sections]);
  return <AiSheet title="本书目录" visible onClose={onClose}>
    <View style={st.search}>
      <TextInput value={query} onChangeText={setQuery} placeholder="搜索章节标题或编号" placeholderTextColor={rc.muted}
        accessibilityLabel="搜索本书目录" style={st.input} returnKeyType="search" />
      {query ? <Pressable style={st.clear} accessibilityRole="button" accessibilityLabel="清空目录搜索" onPress={() => setQuery('')}><Text style={st.action}>清空</Text></Pressable> : null}
    </View>
    <Text style={st.meta}>{busy ? '讲解结束后可切换小节' : query.trim() ? `找到 ${filtered.length} 个小节` : `共 ${sections.length} 个小节 · 当前 ${sections.findIndex(x => x.id === s.section.id) + 1}/${sections.length}`}</Text>
    {filtered.length ? <FlatList style={st.list} data={filtered} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled"
      initialScrollIndex={query.trim() ? undefined : Math.max(0, sections.findIndex(x => x.id === s.section.id) - 1)}
      onScrollToIndexFailed={() => {}} initialNumToRender={12}
      renderItem={({ item }) => {
        const current = item.id === s.section.id;
        return <Pressable style={[st.row, current && st.current]} accessibilityRole="button"
          accessibilityLabel={secLabel(item) + (current ? '，当前小节' : '')}
          accessibilityState={{ selected: current, disabled: busy && !current }} disabled={busy && !current}
          onPress={() => { if (current) onClose(); else onSelect(item.id); }}>
          <View style={st.words}><Text style={[st.title, current && st.action]}>{secLabel(item)}</Text>
            <Text style={st.detail}>{[current ? '正在阅读' : s.state.sections[item.id]?.done ? '已学完' : '', item.pageFrom != null ? '原页 ' + item.pageFrom : item.chars + ' 字'].filter(Boolean).join(' · ')}</Text>
          </View>
          {current ? <Check size={18} color={rc.main} /> : null}
        </Pressable>;
      }} /> : <Text style={st.empty}>没有匹配的小节，试试章节编号或更短的关键词。</Text>}
  </AiSheet>;
}

const st = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, borderWidth: 1, borderColor: rc.line, borderRadius: 10, backgroundColor: rc.paper },
  input: { flex: 1, minHeight: 48, fontSize: 15, color: rc.ink, paddingHorizontal: 12, paddingVertical: 10 },
  clear: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
  meta: { paddingHorizontal: 20, paddingVertical: 10, fontSize: 12, lineHeight: 20, color: rc.secondary },
  list: { flexShrink: 1 },
  row: { minHeight: 64, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', gap: 12, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: rc.line },
  current: { backgroundColor: rc.mainBg },
  words: { flex: 1, gap: 4 },
  title: { fontSize: 15, lineHeight: 24, color: rc.ink },
  detail: { fontSize: 12, lineHeight: 20, color: rc.secondary },
  action: { color: rc.main, fontSize: 15 },
  empty: { fontSize: 15, lineHeight: 24, color: rc.secondary, padding: 20 },
});
