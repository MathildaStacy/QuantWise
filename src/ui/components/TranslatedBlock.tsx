import { useRef } from 'react';
import { StyleSheet, Text, View, type LayoutRectangle } from 'react-native';
import type { BookBlock } from '../../book/types';
import { bookListItem } from '../../book/presentation';
import type { TranslationPair } from '../../study/translation';
import type { ReaderTextPart } from '../../study/readerPosition';
import { rc } from '../readTheme';
import { useBookTypography } from '../readerTypography';
import { BlockInline, BookBlockView } from './BookBlock';

export function TranslatedBlock({ b, pairs, dir, onTextLayout }: {
  b: BookBlock; pairs: TranslationPair[]; dir?: string; onTextLayout?: (parts: ReaderTextPart[]) => void;
}) {
  const { prefs, body, caption, translation } = useBookTypography();
  const list = bookListItem(b);
  // Display grouping never rewrites cached sentence pairs or the source paragraph.
  const displayed = prefs.parallel === 'sentence' ? pairs : [{
    source: b.text,
    translation: pairs.map(p => p.translation.trim()).join(''),
  }];
  const isCaption = b.type === 'img';
  const positions = useRef(new Map<number, { y?: number; source?: LayoutRectangle; translation?: LayoutRectangle }>());
  const report = (i: number, patch: { y?: number; source?: LayoutRectangle; translation?: LayoutRectangle }) => {
    positions.current.set(i, { ...positions.current.get(i), ...patch });
    let start = 0;
    onTextLayout?.(displayed.flatMap((pair, index) => {
      const end = start + pair.source.length;
      const position = positions.current.get(index);
      const parts: ReaderTextPart[] = [];
      for (const lane of ['source', 'translation'] as const) {
        const rect = position?.[lane];
        if (position?.y != null && rect) parts.push({ start, end, lane, y: position.y + rect.y, height: rect.height });
      }
      start = end;
      return parts;
    }));
  };
  return <View style={list ? st.list : undefined}>
    {list ? <Text style={[body, st.marker]}>{list.marker}</Text> : null}
    <View style={st.words}>
      {isCaption ? <BookBlockView b={{ ...b, text: '' }} dir={dir} /> : null}
      {displayed.map((pair, i) => <View key={i} style={[st.pair, i > 0 && st.nextPair]} onLayout={e => report(i, { y: e.nativeEvent.layout.y })}>
        <View onLayout={e => report(i, { source: e.nativeEvent.layout })}>
          <BlockInline text={i === 0 && list ? bookListItem({ ...b, text: pair.source })?.text ?? pair.source : pair.source} style={isCaption ? caption : undefined} />
        </View>
        <View style={st.translation} onLayout={e => report(i, { translation: e.nativeEvent.layout })}>
          <BlockInline text={i === 0 && list ? bookListItem({ type: 'p', mark: null, text: pair.translation })?.text ?? pair.translation : pair.translation} style={isCaption ? caption : translation} />
        </View>
      </View>)}
    </View>
  </View>;
}

const st = StyleSheet.create({
  pair: { gap: 10 },
  nextPair: { marginTop: 20 },
  list: { flexDirection: 'row', gap: 8 },
  words: { flex: 1 },
  marker: { minWidth: 18, color: rc.secondary },
  translation: { paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: rc.line },
});
