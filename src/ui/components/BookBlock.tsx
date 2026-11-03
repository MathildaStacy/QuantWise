/**
 * 原书内容块：跟随阅读字号，表格保留合并单元格，插图按原始比例显示。
 */
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { BookBlock } from '../../book/types';
import { bookListItem } from '../../book/presentation';
import { MathView } from '../math/MathView';
import { rc } from '../readTheme';
import { useBookTypography } from '../readerTypography';
import { BlockInline } from './BookInline';
import { BookTable } from './BookTable';
import { ScannedFigure } from './ScannedFigure';
import { HorizontalReading } from './HorizontalReading';
export { BlockInline } from './BookInline';

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
        <HorizontalReading label="代码" style={s.pre}>
          <Text style={[s.code, { fontSize: body.fontSize! - 3, lineHeight: body.lineHeight! - 6 }]} selectable>{b.text}</Text>
        </HorizontalReading>
      );
    case 'table':
      return <BookTable text={b.text} html={b.html} />;
    case 'img':
      return (
        <View style={s.fig}>
          {b.image && dir ? <ScannedFigure
            key={b.image}
            b={b}
            uri={(/^\w+:/.test(b.image) ? '' : 'file://' + dir.replace(/\/$/, '') + '/') + b.image}
            compact={compact}
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
});
