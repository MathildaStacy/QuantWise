/**
 * 原书内容块：跟随阅读字号，表格保留合并单元格，插图按原始比例显示。
 */
import { memo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { BookBlock } from '../../book/types';
import { bookListItem } from '../../book/presentation';
import { MathView } from '../math/MathView';
import { rc } from '../readTheme';
import { useBookTypography } from '../readerTypography';
import { BlockInline } from './BookInline';
import { BookTable } from './BookTable';
export { BlockInline } from './BookInline';

/** 插图和原页按实际比例展开，引用预览保留紧凑高度。 */
function BookImage({ uri, label, sourcePage, compact }: { uri: string; label: string; sourcePage: boolean; compact: boolean }) {
  const [ratio, setRatio] = useState(sourcePage ? 0.707 : 1.5);
  return <Image source={{ uri }} accessibilityLabel={label} resizeMode="contain" style={[s.image, compact ? s.imgSmall : { aspectRatio: ratio }]} onLoad={({ nativeEvent }) => {
    const { width, height } = nativeEvent.source;
    if (width > 0 && height > 0) setRatio(width / height);
  }} />;
}

export const BookBlockView = memo(function BlockView({
  b,
  dir,
  compact = false,
}: {
  b: BookBlock;
  /** 书目录（图片的相对路径从这里开始）。 */
  dir?: string;
  compact?: boolean;
}) {
  const { body, caption } = useBookTypography();
  const list = bookListItem(b);
  if (list) return <View style={s.li}>
    <Text style={[body, s.mark]}>{list.marker}</Text>
    <View style={s.liText}><BlockInline text={list.text} /></View>
  </View>;
  switch (b.type) {
    case 'eq':
      return <MathView tex={b.text} fontSize={body.fontSize} />;
    case 'code':
      return (
        <ScrollView horizontal nestedScrollEnabled style={s.pre} accessibilityLabel="代码，可横向滚动">
          <Text style={[s.code, { fontSize: body.fontSize! - 3, lineHeight: body.lineHeight! - 6 }]} selectable>{b.text}</Text>
        </ScrollView>
      );
    case 'table':
      return <BookTable text={b.text} html={b.html} />;
    case 'img':
      return (
        <View style={s.fig}>
          {b.image && dir ? <BookImage
            key={b.image}
            uri={(/^\w+:/.test(b.image) ? '' : 'file://' + dir.replace(/\/$/, '') + '/') + b.image}
            label={b.text || '书中插图'} sourcePage={b.image.startsWith('source-pages/')} compact={compact}
          /> : null}
          {b.text ? <BlockInline text={b.text} style={caption} /> : null}
        </View>
      );
    default:
      return <BlockInline text={b.text} style={compact ? s.small : undefined} />;
  }
});

const s = StyleSheet.create({
  small: { fontSize: 15, lineHeight: 26 },
  code: { fontFamily: 'monospace', color: rc.ink },
  li: { flexDirection: 'row', gap: 8 },
  mark: { color: rc.muted, minWidth: 18 },
  liText: { flex: 1 },
  pre: { backgroundColor: rc.soft, borderRadius: 4, padding: 14 },
  fig: { gap: 12, marginVertical: 8 },
  image: { width: '100%' },
  imgSmall: { height: 140 },
});
