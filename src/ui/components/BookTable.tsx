import { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { bookTableNotes, parseBookTable, tableRowHeights } from '../../book/table';
import { rc } from '../readTheme';
import { useBookTypography } from '../readerTypography';
import { BlockInline } from './BookInline';
import { HorizontalReading } from './HorizontalReading';

export function BookTable({ text, html }: { text: string; html: string | null }) {
  const table = useMemo(() => parseBookTable(text, html), [text, html]);
  const notes = useMemo(() => bookTableNotes(text, html), [text, html]);
  const { body, caption } = useBookTypography();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(300);
  // Key measurements by content and type metrics so a smaller font can shrink the table again.
  const measureKey = [text, html, width, fontScale, caption.fontSize, caption.lineHeight, caption.fontFamily].join('|');
  const [measurements, setMeasurements] = useState<{ key: string; cells: Record<number, number> }>({ key: '', cells: {} });
  if (!table) return <BlockInline text={text} />;
  const columns = Array<number>(table.columns).fill(Math.max(width / table.columns, (caption.fontSize! * 6 + 24) * fontScale));
  // Keep financial values on one line; a decimal tail on the next line looks like a different value.
  for (const cell of table.cells) {
    if (cell.colSpan === 1 && /^[-+−]?[\d,.]+[%％‰]?$/.test(cell.text)) {
      columns[cell.col] = Math.max(columns[cell.col], (cell.text.length * caption.fontSize! * 0.65 + 24) * fontScale);
    }
  }
  const left = (col: number) => columns.slice(0, col).reduce((a, b) => a + b, 0);
  const heights = tableRowHeights(table, measurements.key === measureKey ? measurements.cells : {}, caption.lineHeight! * fontScale + 20);
  const top = (row: number) => heights.slice(0, row).reduce((a, b) => a + b, 0);
  return <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={s.wrap}>
    {notes.caption ? <BlockInline text={notes.caption} style={caption} /> : null}
    <HorizontalReading label="表格">
      <View style={[s.table, { width: left(table.columns), height: top(table.rows) }]}>
        {table.cells.map((cell, i) => <View key={i} style={[s.cell, cell.header && s.header, {
          left: left(cell.col), top: top(cell.row), width: left(cell.col + cell.colSpan) - left(cell.col),
          minHeight: top(cell.row + cell.rowSpan) - top(cell.row),
        }]}>
          <View key={measureKey} style={s.words} onLayout={e => {
            const height = Math.ceil(e.nativeEvent.layout.height);
            setMeasurements(old => {
              const cells = old.key === measureKey ? old.cells : {};
              return cells[i] === height ? old : { key: measureKey, cells: { ...cells, [i]: height } };
            });
          }}>
            <BlockInline text={cell.text} style={[caption, { color: body.color }, cell.header && s.bold]} />
          </View>
        </View>)}
      </View>
    </HorizontalReading>
    {notes.footnote ? <BlockInline text={notes.footnote} style={caption} /> : null}
  </View>;
}

const s = StyleSheet.create({
  wrap: { marginVertical: 8, gap: 12 },
  table: { borderTopWidth: 1, borderTopColor: rc.secondary, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: rc.line },
  cell: { position: 'absolute', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rc.line, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: rc.line },
  words: { paddingHorizontal: 12, paddingVertical: 10 },
  header: { backgroundColor: rc.soft },
  bold: { fontWeight: '600' },
});
