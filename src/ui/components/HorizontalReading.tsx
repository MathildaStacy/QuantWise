/**
 * 能横向滑动的公式、表格、代码：内容超宽时在下方写一行提示（放在横向手势区域外），读屏标签说明可以左右滑动。
 * 表格可以把行名列放在 frozen 里固定在左边，只滚数据列；overlay 是铺在这一行上面的格子（占满整行的小标题）。
 */
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { rc } from '../readTheme';

export function HorizontalReading({ label, spoken, children, style, contentContainerStyle, onWidth, frozen, overlay }: {
  label: string;
  /** 整块读出的内容（公式读 TeX）：给了就把这一块当成一个可读元素。 */
  spoken?: string;
  children: ReactNode; style?: StyleProp<ViewStyle>; contentContainerStyle?: StyleProp<ViewStyle>;
  onWidth?: (width: number) => void;
  /** 固定在左边、不跟着横滑的部分（表格的行名列）。 */
  frozen?: ReactNode;
  /** 盖在整行上面、不跟着横滑的格子（绝对定位，相对这一行）。 */
  overlay?: ReactNode;
}) {
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [offset, setOffset] = useState(0);
  const overflow = viewport > 0 && content > viewport + 2;
  const scroller = <ScrollView horizontal nestedScrollEnabled style={frozen ? [s.fill, style] : style} contentContainerStyle={contentContainerStyle}
    accessible={spoken != null || undefined} accessibilityRole={spoken != null ? 'text' : undefined}
    accessibilityLabel={(spoken ?? label) + (overflow ? '，可左右滑动查看完整内容' : '')}
    onLayout={e => { setViewport(e.nativeEvent.layout.width); onWidth?.(e.nativeEvent.layout.width); }}
    onContentSizeChange={width => setContent(width)}
    onScroll={e => setOffset(e.nativeEvent.contentOffset.x)} scrollEventThrottle={100}>
    {children}
  </ScrollView>;
  return <View>
    {frozen ? <View style={s.row}>{frozen}{scroller}{overlay}</View> : scroller}
    {overflow ? <Text style={s.hint} importantForAccessibility="no" accessibilityElementsHidden>{(offset > 8 ? offset + viewport >= content - 8 ? '向右滑动可回看开头' : '左右滑动查看完整' + label : '向左滑动查看完整' + label) + (frozen ? '，行名固定在左边' : '')}</Text> : null}
  </View>;
}

const s = StyleSheet.create({
  hint: { fontSize: 12, lineHeight: 20, color: rc.secondary, paddingTop: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  fill: { flex: 1 },
});
