import { StyleSheet, Text, View, type StyleProp, type TextStyle, type AccessibilityRole } from 'react-native';
import { inlineParts } from '../../book/markup';
import { unescapeBookText } from '../../book/presentation';
import { MathView } from '../math/MathView';
import { useBookTypography } from '../readerTypography';

export function BlockInline({ text, style, accessibilityRole }: { text: string; style?: StyleProp<TextStyle>; accessibilityRole?: AccessibilityRole }) {
  const { body } = useBookTypography();
  const textStyle = StyleSheet.flatten([body, style]) ?? body;
  const parts = inlineParts(text).map(p => p.t === 'math' ? p : { ...p, v: unescapeBookText(p.v) });
  // 简单式子可随正文排；矩阵等不能无损转成 Unicode 的式子，完整交给离线 MathJax。
  if (parts.some(x => x.t === 'math')) {
    const groups: { tex?: string; parts: typeof parts }[] = [];
    for (const part of parts) {
      if (part.t === 'math') groups.push({ tex: part.v, parts: [] });
      else {
        const last = groups[groups.length - 1];
        if (last && !last.tex) last.parts.push(part);
        else groups.push({ parts: [part] });
      }
    }
    return <View accessibilityRole={accessibilityRole}>{groups.map((g, i) => g.tex ? <MathView key={i} tex={g.tex} fontSize={textStyle.fontSize} /> : (
      <Text key={i} style={textStyle} selectable>{g.parts.map((p, j) => p.t === 'bold' ? <Text key={j} style={s.bold}>{p.v}</Text> : p.v)}</Text>
    ))}</View>;
  }
  return (
    <Text style={textStyle} selectable accessibilityRole={accessibilityRole} textBreakStrategy="highQuality" android_hyphenationFrequency="normal">
      {parts.map((x, i) =>
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

const s = StyleSheet.create({ bold: { fontWeight: '700' }, code: { fontFamily: 'monospace' } });
