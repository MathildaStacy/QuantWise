import { Platform, StyleSheet, Text, View } from 'react-native';
import type { BookBlock } from '../../book/types';
import type { TranslationPair } from '../../study/translation';
import { rc } from '../readTheme';
import { BlockInline, BookBlockView } from './BookBlock';

export function TranslatedBlock({ b, pairs, dir }: { b: BookBlock; pairs: TranslationPair[]; dir?: string }) {
  return <View>
    {b.type === 'img' ? <BookBlockView b={{ ...b, text: '' }} dir={dir} /> : null}
    {pairs.map((pair, i) => <View key={i} style={st.pair}>
      <View style={st.source}>
        {b.type === 'li' && i === 0 ? <Text style={st.marker}>{b.mark ?? '•'}</Text> : null}
        <View style={st.words}><BlockInline text={pair.source} /></View>
      </View>
      <View style={st.translation}>
        <BlockInline text={pair.translation} style={st.chinese} />
      </View>
    </View>)}
  </View>;
}

const st = StyleSheet.create({
  pair: { marginBottom: 14, gap: 4 },
  source: { flexDirection: 'row', gap: 6 },
  words: { flex: 1 },
  marker: { minWidth: 18, fontSize: 16, lineHeight: 30, color: rc.secondary },
  translation: { paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: rc.line },
  chinese: { fontFamily: Platform.select({ ios: 'System', default: 'sans-serif' }), fontSize: 16, lineHeight: 28, color: rc.secondary },
});
