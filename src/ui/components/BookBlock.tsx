/**
 * 原书的一个内容块（读书模式、原文预览）：段落用宋体，公式用 MathView，表格转成 Markdown 表格，图片从书目录读。
 */
import { memo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { htmlTableToMarkdown, inlineParts } from '../../book/markup';
import type { BookBlock } from '../../book/types';
import { MathView } from '../math/MathView';
import { rc, serif } from '../readTheme';
import { Markdown } from './Markdown';

export function BlockInline({ text, style }: { text: string; style?: object }) {
  return (
    <Text style={[s.p, style]} selectable>
      {inlineParts(text).map((x, i) =>
        x.t === 'bold' ? (
          <Text key={i} style={s.bold}>
            {x.v}
          </Text>
        ) : x.t === 'math' ? (
          <Text key={i} style={s.code}>
            {x.v}
          </Text>
        ) : (
          x.v
        ),
      )}
    </Text>
  );
}

/** 原页截图按实际比例展开，避免完整一页被压进普通插图的 220px 框。 */
function SourcePageImage({ uri, label }: { uri: string; label: string }) {
  const [ratio, setRatio] = useState(0.707);
  return <Image source={{ uri }} accessibilityLabel={label} resizeMode="contain" style={[s.sourcePage, { aspectRatio: ratio }]} onLoad={({ nativeEvent }) => {
    const { width, height } = nativeEvent.source;
    if (width > 0 && height > 0) setRatio(width / height);
  }} />;
}

const noLink = () => undefined;

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
  switch (b.type) {
    case 'eq':
      return <MathView tex={b.text} />;
    case 'li':
      return (
        <View style={s.li}>
          <Text style={[s.p, s.mark]}>{b.mark ?? '•'}</Text>
          <BlockInline text={b.text} style={s.liText} />
        </View>
      );
    case 'code':
      return (
        <Text style={s.pre} selectable>
          {b.text}
        </Text>
      );
    case 'table': {
      const md = /^\s*\|/.test(b.text) ? b.text : b.html ? htmlTableToMarkdown(b.html) : null;
      return md ? <Markdown text={md} onLink={noLink} /> : <BlockInline text={b.text} />;
    }
    case 'img':
      return (
        <View style={s.fig}>
          {b.image?.startsWith('source-pages/') && dir && !compact ? (
            <SourcePageImage uri={'file://' + dir.replace(/\/$/, '') + '/' + b.image} label={b.text} />
          ) : b.image && dir ? (
            <Image
              source={{ uri: (/^\w+:/.test(b.image) ? '' : 'file://' + dir.replace(/\/$/, '') + '/') + b.image }}
              style={compact ? s.imgSmall : s.img}
              resizeMode="contain"
              accessibilityLabel={b.text || '图'}
            />
          ) : null}
          {b.text ? <Text style={s.caption}>{b.text}</Text> : null}
        </View>
      );
    default:
      return <BlockInline text={b.text} style={compact ? s.small : undefined} />;
  }
});

const s = StyleSheet.create({
  p: { fontFamily: serif, fontSize: 16.5, lineHeight: 30, color: rc.ink },
  small: { fontSize: 15, lineHeight: 26 },
  bold: { fontWeight: '700' },
  code: { fontFamily: 'monospace', fontSize: 14, color: rc.code },
  li: { flexDirection: 'row', gap: 6 },
  mark: { color: rc.muted, minWidth: 18 },
  liText: { flex: 1 },
  pre: { fontFamily: 'monospace', fontSize: 13, lineHeight: 21, color: rc.ink, backgroundColor: rc.soft, borderRadius: 8, padding: 10 },
  fig: { alignItems: 'center', gap: 4 },
  sourcePage: { width: '100%' },
  img: { width: '100%', height: 220 },
  imgSmall: { width: '100%', height: 140 },
  caption: { fontSize: 12, color: rc.muted, textAlign: 'center' },
});
