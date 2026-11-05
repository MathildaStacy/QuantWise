/** 可连续阅读的 AI 正文。表格共用列宽，宽表与代码只横向滚动自身。 */
import { createContext, useContext, useMemo, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { parseMarkdown, type MdInline } from '../../ai/markdown';
import { splitMissing } from '../../ai/provenance';
import { aiColor as c } from '../aiTheme';
import { color, num } from '../theme';

/** 找不到来源的数字加虚线（Android 不支持虚线样式时显示成下划线，颜色区分）。 */
const Missing = createContext<Set<string> | undefined>(undefined);

function Plain({ text }: { text: string }) {
  const missing = useContext(Missing);
  if (!missing) {
    return <>{text}</>;
  }
  return (
    <>
      {splitMissing(text, missing).map((x, i) =>
        x.missing ? (
          <Text
            key={i}
            style={s.missing}
            accessibilityLabel={x.text + '，找不到来源'}
          >
            {x.text}
          </Text>
        ) : (
          x.text
        ),
      )}
    </>
  );
}

function Inline({
  inl,
  onLink,
}: {
  inl: MdInline[];
  onLink: (href: string) => void;
}) {
  return (
    <>
      {inl.map((x, i) =>
        x.t === 'bold' ? (
          <Text key={i} style={s.bold}>
            <Plain text={x.text} />
          </Text>
        ) : x.t === 'code' ? (
          <Text key={i} style={s.icode}>
            {x.text}
          </Text>
        ) : x.t === 'link' && x.href === 'unv:' ? (
          // 伴读：引用不到本轮读过的原文（QUANTWISE_DESIGN.md §6.5）
          <Text key={i} style={s.unverified} accessibilityLabel="未核实的说法">
            {' 未核实'}
          </Text>
        ) : x.t === 'link' && x.href.startsWith('cite:') ? (
          <Text
            key={i}
            style={s.cite}
            onPress={() => onLink(x.href)}
            accessibilityRole="link"
            accessibilityLabel={'原文 ' + x.text}
          >
            {' ' + x.text + ' '}
          </Text>
        ) : x.t === 'link' ? (
          <Text
            key={i}
            style={[s.link, x.href.startsWith('source:') && s.citation]}
            onPress={() => onLink(x.href)}
            accessibilityRole="link"
            accessibilityLabel={
              x.href.startsWith('source:') ? '来源 ' + x.text : undefined
            }
          >
            {x.href.startsWith('source:') ? '[' + x.text + ']' : x.text}
          </Text>
        ) : (
          <Text key={i}>
            <Plain text={x.text} />
          </Text>
        ),
      )}
    </>
  );
}

function Table({
  rows,
  onLink,
}: {
  rows: MdInline[][][];
  onLink: (href: string) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  // 第一列固定时，两边同一行各自排出来的高度（取较高的那个，两边对齐）
  const [heights, setHeights] = useState<Record<string, number>>({});
  const count = Math.max(0, ...rows.map(row => row.length));
  const available = Math.min(720, width - 40);
  const widths = Array.from({ length: count }, (_, i) => {
    const longest = Math.max(
      ...rows.map(row => (row[i] ?? []).map(x => x.text).join('').length),
    );
    return count <= 2
      ? available / Math.max(1, count)
      : Math.min(
          220 * fontScale,
          Math.max(112 * fontScale, longest * 8 * fontScale + 24),
        );
  });
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (r: number, col: number) => (
    <View key={col} style={[s.cell, { width: widths[col] }]}>
      <Text selectable style={[s.td, num, r === 0 && s.bold]}>
        <Inline inl={rows[r][col] ?? []} onLink={onLink} />
      </Text>
    </View>
  );
  // 比屏幕宽时第一列（行名）固定在左边，只横滑后面的列（PM 走查第 1 项）
  const freeze = count >= 3 && total > available + 2 && widths[0] <= available * 0.45;
  if (!freeze) {
    return (
      <ScrollView
        horizontal
        style={s.tableWrap}
        showsHorizontalScrollIndicator
        nestedScrollEnabled
        accessibilityLabel="表格，可横向滚动"
      >
        <View style={s.table}>
          {rows.map((row, r) => (
            <View
              key={r}
              style={[s.tr, r === 0 && s.th, r === rows.length - 1 && s.lastRow]}
            >
              {widths.map((_w, col) => cell(r, col))}
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }
  const measure = (key: string) => (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    setHeights(old => (old[key] === h ? old : { ...old, [key]: h }));
  };
  const line = (r: number, side: 'l' | 'r', cols: number[]) => {
    const last = r === rows.length - 1;
    const a = heights['l' + r];
    const b = heights['r' + r];
    // 行的下边框画在行高里面：两边都量到了才定高
    const h = a && b ? Math.max(a, b) + (last ? 0 : StyleSheet.hairlineWidth) : undefined;
    return (
      <View
        key={r}
        style={[s.tr, r === 0 && s.th, last && s.lastRow, h != null && { height: h }]}
      >
        <View style={s.natural} onLayout={measure(side + r)}>
          {cols.map(col => cell(r, col))}
        </View>
      </View>
    );
  };
  const rest = widths.map((_w, i) => i).slice(1);
  return (
    <View style={[s.tableWrap, s.table, s.split]}>
      <View style={[s.frozen, { width: widths[0] }]}>
        {rows.map((_row, r) => line(r, 'l', [0]))}
      </View>
      <ScrollView
        horizontal
        style={s.fill}
        showsHorizontalScrollIndicator
        nestedScrollEnabled
        accessibilityLabel="表格，第一列固定，其余列可横向滚动"
      >
        <View>{rows.map((_row, r) => line(r, 'r', rest))}</View>
      </ScrollView>
    </View>
  );
}

export function Markdown({
  text,
  onLink,
  secondary = false,
  missing,
}: {
  text: string;
  secondary?: boolean;
  onLink: (href: string) => void;
  /** 找不到来源的数字（数字溯源，§13.9），加虚线。 */
  missing?: Set<string>;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <Missing.Provider value={missing}>
      <View>
        {blocks.map((b, i) => {
          switch (b.t) {
            case 'h':
              return (
                <Text
                  key={i}
                  selectable
                  accessibilityRole="header"
                  style={[
                    s.h,
                    b.level === 1 ? s.h1 : b.level === 2 ? s.h2 : s.h3,
                    i === 0 && s.firstHeading,
                    secondary && s.secondary,
                  ]}
                >
                  <Inline inl={b.inl} onLink={onLink} />
                </Text>
              );
            case 'li':
              return (
                <View
                  key={i}
                  style={[
                    s.li,
                    { paddingLeft: b.depth * 16 },
                    blocks[i + 1]?.t !== 'li' && s.listEnd,
                  ]}
                >
                  <Text
                    style={[
                      s.marker,
                      num,
                      { minWidth: Math.max(26, b.marker.length * 9) },
                    ]}
                  >
                    {b.marker}
                  </Text>
                  <Text selectable style={[s.liText, secondary && s.secondary]}>
                    <Inline inl={b.inl} onLink={onLink} />
                  </Text>
                </View>
              );
            case 'table':
              return <Table key={i} rows={b.rows} onLink={onLink} />;
            case 'code':
              return (
                <ScrollView
                  key={i}
                  horizontal
                  style={s.codeWrap}
                  nestedScrollEnabled
                  showsHorizontalScrollIndicator
                  accessibilityLabel="代码，可横向滚动"
                >
                  <Text selectable style={s.code}>
                    {b.text}
                  </Text>
                </ScrollView>
              );
            case 'quote':
              return (
                <View key={i} style={s.quote}>
                  <Text
                    selectable
                    style={[s.quoteText, secondary && s.secondary]}
                  >
                    <Inline inl={b.inl} onLink={onLink} />
                  </Text>
                </View>
              );
            case 'hr':
              return <View key={i} style={s.hr} />;
            default:
              return (
                <Text
                  key={i}
                  selectable
                  style={[s.p, secondary && s.secondary]}
                >
                  <Inline inl={b.inl} onLink={onLink} />
                </Text>
              );
          }
        })}
      </View>
    </Missing.Provider>
  );
}

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const s = StyleSheet.create({
  cite: {
    fontSize: 12,
    color: '#2D5BA8',
    backgroundColor: '#EAF0FA',
    fontVariant: ['tabular-nums'],
  },
  unverified: {
    fontSize: 12,
    color: c.muted,
    textDecorationLine: 'underline',
    textDecorationStyle: 'dashed',
  },
  missing: {
    color: color.warnInk,
    textDecorationLine: 'underline',
    textDecorationStyle: 'dashed',
    textDecorationColor: color.warnInk,
  },
  secondary: {
    fontSize: 13,
    lineHeight: 20,
    color: c.secondary,
    marginBottom: 8,
  },
  p: { fontSize: 16, lineHeight: 27, color: c.ink, marginBottom: 14 },
  h: { fontWeight: '600', color: c.ink, marginTop: 24, marginBottom: 10 },
  h1: { fontSize: 22, lineHeight: 32 },
  h2: { fontSize: 20, lineHeight: 30 },
  h3: { fontSize: 17, lineHeight: 27 },
  firstHeading: { marginTop: 0 },
  bold: { fontWeight: '600' },
  icode: {
    fontFamily: mono,
    fontSize: 14,
    backgroundColor: c.soft,
    color: c.code,
  },
  link: { color: c.ink, textDecorationLine: 'underline' },
  citation: { fontSize: 12, color: c.secondary, textDecorationLine: 'none' },
  li: { flexDirection: 'row', marginBottom: 5 },
  marker: {
    paddingRight: 6,
    flexShrink: 0,
    fontSize: 16,
    lineHeight: 27,
    color: c.secondary,
  },
  liText: { flex: 1, fontSize: 16, lineHeight: 27, color: c.ink },
  listEnd: { marginBottom: 16 },
  tableWrap: { marginVertical: 6, marginBottom: 20, borderRadius: 12 },
  table: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 12,
    overflow: 'hidden',
  },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  lastRow: { borderBottomWidth: 0 },
  split: { flexDirection: 'row' },
  frozen: { borderRightWidth: 1, borderRightColor: c.line },
  natural: { flexDirection: 'row', alignSelf: 'flex-start' },
  fill: { flex: 1 },
  th: { backgroundColor: c.soft },
  cell: { paddingHorizontal: 12, paddingVertical: 11 },
  td: { fontSize: 14, lineHeight: 22, color: c.ink },
  codeWrap: { backgroundColor: c.soft, borderRadius: 12, marginBottom: 18 },
  code: {
    fontFamily: mono,
    fontSize: 13,
    lineHeight: 21,
    color: c.ink,
    padding: 14,
  },
  quote: {
    borderLeftWidth: 1,
    borderLeftColor: c.line,
    paddingLeft: 14,
    marginVertical: 4,
    marginBottom: 18,
  },
  quoteText: { fontSize: 16, lineHeight: 27, color: c.secondary },
  hr: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: c.line,
    marginVertical: 20,
  },
});
