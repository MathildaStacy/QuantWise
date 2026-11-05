/**
 * 原书表格：保留合并单元格，数值不折行。表比屏幕宽时行名列固定在左边、只滚数据列（PM 走查第 1 项）；
 * 全屏看表时表头和行名都固定，可以切横屏。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bookTableNotes, firstRows, freezableFirstColumn, headerRowCount, parseBookTable, spansRow, tableRowHeights, type BookCell, type BookTableData } from '../../book/table';
import Orientation from '../../native/NativeScreenOrientation';
import { rc } from '../readTheme';
import { useBookTypography } from '../readerTypography';
import { BlockInline } from './BookInline';
import { HorizontalReading } from './HorizontalReading';

/** 段落菜单里的小表只列前几行。 */
const PREVIEW_ROWS = 6;
const NUMBER = /^[-+−]?[\d,.]+[%％‰]?$/;

interface TableLayout {
  table: BookTableData;
  columns: number[];
  left: (col: number) => number;
  top: (row: number) => number;
  measureKey: string;
  measure: (i: number) => (e: LayoutChangeEvent) => void;
}

/** 列宽按可用宽度和数字长度算，行高按每格实际排出来的高度（合并格不挤占相邻格）。 */
function useTableLayout(table: BookTableData | null, width: number, key: string): TableLayout | null {
  const { caption } = useBookTypography();
  const { fontScale } = useWindowDimensions();
  // Key measurements by content and type metrics so a smaller font can shrink the table again.
  const measureKey = [key, width, fontScale, caption.fontSize, caption.lineHeight, caption.fontFamily].join('|');
  const [measurements, setMeasurements] = useState<{ key: string; cells: Record<number, number> }>({ key: '', cells: {} });
  if (!table) return null;
  const columns = Array<number>(table.columns).fill(Math.max(width / table.columns, (caption.fontSize! * 6 + 24) * fontScale));
  // Keep financial values on one line; a decimal tail on the next line looks like a different value.
  for (const cell of table.cells) {
    if (cell.colSpan === 1 && NUMBER.test(cell.text)) {
      columns[cell.col] = Math.max(columns[cell.col], (cell.text.length * caption.fontSize! * 0.65 + 24) * fontScale);
    }
  }
  const left = (col: number) => columns.slice(0, col).reduce((a, b) => a + b, 0);
  const heights = tableRowHeights(table, measurements.key === measureKey ? measurements.cells : {}, caption.lineHeight! * fontScale + 20);
  const top = (row: number) => heights.slice(0, row).reduce((a, b) => a + b, 0);
  const measure = (i: number) => (e: LayoutChangeEvent) => {
    const height = Math.ceil(e.nativeEvent.layout.height);
    setMeasurements(old => {
      const cells = old.key === measureKey ? old.cells : {};
      return cells[i] === height ? old : { key: measureKey, cells: { ...cells, [i]: height } };
    });
  };
  return { table, columns, left, top, measureKey, measure };
}

/** 一格：位置相对它所在的那一块（行名列、数据列、表头）的左上角 dx、dy。 */
function Cell({ cell, i, layout, dx, dy, width }: { cell: BookCell; i: number; layout: TableLayout; dx: number; dy: number; width?: number }) {
  const { body, caption } = useBookTypography();
  const { left, top } = layout;
  return <View style={[s.cell, cell.header && s.header, {
    left: left(cell.col) - dx, top: top(cell.row) - dy, width: width ?? left(cell.col + cell.colSpan) - left(cell.col),
    minHeight: top(cell.row + cell.rowSpan) - top(cell.row),
  }]}>
    <View key={layout.measureKey} style={s.words} onLayout={layout.measure(i)}>
      <BlockInline text={cell.text} style={[caption, { color: body.color }, cell.header && s.bold]} />
    </View>
  </View>;
}

type Indexed = { cell: BookCell; i: number };

/** 行名列放得下才冻结：不超过可见宽度的 45%。 */
const canFreeze = (l: TableLayout, width: number) => freezableFirstColumn(l.table) && l.columns[0] <= width * 0.45;

export function BookTable({ text, html, preview = false }: { text: string; html: string | null; preview?: boolean }) {
  const parsed = useMemo(() => parseBookTable(text, html), [text, html]);
  const table = useMemo(() => (parsed && preview ? firstRows(parsed, PREVIEW_ROWS) : parsed), [parsed, preview]);
  const notes = useMemo(() => bookTableNotes(text, html), [text, html]);
  const { caption } = useBookTypography();
  const [width, setWidth] = useState(300);
  const layout = useTableLayout(table, width, text + '|' + html + '|' + preview);
  if (!table || !layout) return <BlockInline text={text} />;
  const total = layout.left(table.columns);
  const height = layout.top(table.rows);
  const cells: Indexed[] = table.cells.map((cell, i) => ({ cell, i }));
  const freeze = total > width + 2 && canFreeze(layout, width);
  const fw = layout.columns[0];
  // 冻结时占满整行的小标题盖在这一行上（dy = -1：表格的上边框占 1，和两边的格子对齐）
  return <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={s.wrap}>
    {notes.caption && !preview ? <BlockInline text={notes.caption} style={caption} /> : null}
    {freeze ? <HorizontalReading label="表格"
      frozen={<View style={[s.table, s.frozen, { width: fw, height }]}>
        {cells.filter(x => x.cell.col === 0 && !spansRow(table, x.cell)).map(x => <Cell key={x.i} {...x} layout={layout} dx={0} dy={0} />)}
      </View>}
      overlay={cells.filter(x => spansRow(table, x.cell)).map(x => <Cell key={x.i} {...x} layout={layout} dx={0} dy={-1} width={width} />)}>
      <View style={[s.table, s.scrolled, { width: total - fw, height }]}>
        {cells.filter(x => x.cell.col > 0).map(x => <Cell key={x.i} {...x} layout={layout} dx={fw} dy={0} />)}
      </View>
    </HorizontalReading> : <HorizontalReading label="表格">
      <View style={[s.table, { width: total, height }]}>
        {cells.map(x => <Cell key={x.i} {...x} layout={layout} dx={0} dy={0} />)}
      </View>
    </HorizontalReading>}
    {preview && parsed && parsed.rows > table.rows ? <Text style={s.more}>{'共 ' + parsed.rows + ' 行，这里只列前 ' + table.rows + ' 行；「全屏看表」看完整的表。'}</Text> : null}
    {notes.footnote && !preview ? <BlockInline text={notes.footnote} style={caption} /> : null}
  </View>;
}

/** 系统能不能切横屏（只有 Android 实现）。 */
export const canTurnScreen = () => Orientation != null;

/**
 * 全屏看表：表头上下滑动时固定，行名左右滑动时固定；可以切横屏，关掉时交回系统的方向设置。
 * title 是「表 3.19 动量分组的描述性统计」这样的标题。
 */
export function TableScreen({ title, text, html, onClose }: { title: string; text: string; html: string | null; onClose: () => void }) {
  const safe = useSafeAreaInsets();
  const window = useWindowDimensions();
  const table = useMemo(() => parseBookTable(text, html), [text, html]);
  const notes = useMemo(() => bookTableNotes(text, html), [text, html]);
  const { caption } = useBookTypography();
  const [width, setWidth] = useState(Math.max(200, window.width - 24));
  const layout = useTableLayout(table, width, 'full|' + text + '|' + html);
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const turned = useRef(false);
  useEffect(() => () => { if (turned.current) Orientation?.set('auto'); }, []);
  const close = () => {
    if (turned.current) Orientation?.set('auto');
    turned.current = false;
    onClose();
  };
  const landscape = window.width > window.height;
  const control = (label: string, spoken: string, onPress: () => void) => <Pressable accessibilityRole="button" accessibilityLabel={spoken} onPress={onPress} style={s.button}><Text style={s.buttonText}>{label}</Text></Pressable>;
  let grid = null;
  if (table && layout) {
    const total = layout.left(table.columns);
    const freeze = canFreeze(layout, width);
    const fw = freeze ? layout.columns[0] : 0;
    const hr = headerRowCount(table);
    const headH = layout.top(hr);
    const bodyH = layout.top(table.rows) - headH;
    const cells: Indexed[] = table.cells.map((cell, i) => ({ cell, i }));
    const wide = (c: BookCell) => freeze && spansRow(table, c);
    const head = cells.filter(c => c.cell.row < hr), rest = cells.filter(c => c.cell.row >= hr);
    const shiftX = { transform: [{ translateX: Animated.multiply(x, -1) }] };
    const shiftY = { transform: [{ translateY: Animated.multiply(y, -1) }] };
    grid = <View style={s.grid} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      {hr ? <View style={[s.gridRow, { height: headH }]}>
        {freeze ? <View style={[s.frozen, { width: fw, height: headH }]}>
          {head.filter(c => c.cell.col === 0 && !wide(c.cell)).map(c => <Cell key={c.i} {...c} layout={layout} dx={0} dy={0} />)}
        </View> : null}
        <View style={s.clip}>
          <Animated.View style={[{ width: total - fw, height: headH }, shiftX]}>
            {head.filter(c => (freeze ? c.cell.col > 0 : true) && !wide(c.cell)).map(c => <Cell key={c.i} {...c} layout={layout} dx={fw} dy={0} />)}
          </Animated.View>
        </View>
        {head.filter(c => wide(c.cell)).map(c => <Cell key={c.i} {...c} layout={layout} dx={0} dy={0} width={width} />)}
      </View> : null}
      <View style={s.gridBody}>
        {freeze ? <View style={[s.frozen, s.frozenBody, { width: fw }]}>
          <Animated.View style={[{ width: fw, height: bodyH }, shiftY]}>
            {rest.filter(c => c.cell.col === 0 && !wide(c.cell)).map(c => <Cell key={c.i} {...c} layout={layout} dx={0} dy={headH} />)}
          </Animated.View>
        </View> : null}
        <Animated.ScrollView style={s.clip} scrollEventThrottle={16} accessibilityLabel="表格，可上下左右滑动"
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: true })}>
          <Animated.ScrollView horizontal nestedScrollEnabled scrollEventThrottle={16}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x } } }], { useNativeDriver: true })}>
            <View style={{ width: total - fw, height: bodyH }}>
              {rest.filter(c => (freeze ? c.cell.col > 0 : true) && !wide(c.cell)).map(c => <Cell key={c.i} {...c} layout={layout} dx={fw} dy={headH} />)}
            </View>
          </Animated.ScrollView>
        </Animated.ScrollView>
        {rest.some(c => wide(c.cell)) ? <Animated.View pointerEvents="none" style={[s.overlay, { width, height: bodyH }, shiftY]}>
          {rest.filter(c => wide(c.cell)).map(c => <Cell key={c.i} {...c} layout={layout} dx={0} dy={headH} width={width} />)}
        </Animated.View> : null}
      </View>
    </View>;
  }
  return <Modal visible animationType="slide" onRequestClose={close} supportedOrientations={['portrait', 'landscape']}>
    <View style={[s.screen, { paddingTop: safe.top, paddingBottom: safe.bottom, paddingLeft: safe.left, paddingRight: safe.right }]}>
      <View style={s.bar}>
        <Text accessibilityRole="header" style={s.title} numberOfLines={2}>{title}</Text>
        {Orientation ? control(landscape ? '竖屏' : '横屏', landscape ? '切回竖屏看表' : '横屏看表', () => {
          turned.current = true;
          Orientation?.set(landscape ? 'portrait' : 'landscape');
        }) : null}
        {control('关闭', '关闭全屏表格', close)}
      </View>
      {notes.caption ? <BlockInline text={notes.caption} style={[caption, s.note]} /> : null}
      {grid ?? <View style={s.grid}><BlockInline text={text} /></View>}
      {notes.footnote ? <BlockInline text={notes.footnote} style={[caption, s.note]} /> : null}
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  wrap: { marginVertical: 8, gap: 12 },
  table: { borderTopWidth: 1, borderTopColor: rc.secondary, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: rc.line },
  // 固定的行名列右边一条实线，看得出数据列是从它下面滑过去的
  frozen: { borderRightWidth: 1, borderRightColor: rc.line, backgroundColor: rc.page },
  scrolled: { borderLeftWidth: 0 },
  cell: { position: 'absolute', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rc.line, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: rc.line },
  words: { paddingHorizontal: 12, paddingVertical: 10 },
  header: { backgroundColor: rc.soft },
  bold: { fontWeight: '600' },
  more: { fontSize: 12, lineHeight: 18, color: rc.secondary },
  screen: { flex: 1, backgroundColor: rc.page },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 8 },
  title: { flex: 1, fontSize: 16, lineHeight: 24, fontWeight: '600', color: rc.ink },
  button: { minHeight: 48, minWidth: 48, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center' },
  buttonText: { fontSize: 15, color: rc.main, fontWeight: '500' },
  note: { paddingHorizontal: 12, paddingVertical: 6 },
  grid: { flex: 1, marginHorizontal: 12, marginBottom: 8, borderTopWidth: 1, borderTopColor: rc.secondary, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: rc.line },
  gridRow: { flexDirection: 'row' },
  gridBody: { flex: 1, flexDirection: 'row', overflow: 'hidden' },
  clip: { flex: 1, overflow: 'hidden' },
  frozenBody: { overflow: 'hidden' },
  overlay: { position: 'absolute', left: 0, top: 0 },
});
