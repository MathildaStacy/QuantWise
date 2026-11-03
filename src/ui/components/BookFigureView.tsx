import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Path, Polygon, Rect, Text as SvgText, TSpan } from 'react-native-svg';
import { figureSegments, figureTableHtml, figureYTicks, type BookFigure, type FigureChart, type FigureDiagram } from '../../book/figure';
import { rc } from '../readTheme';
import { useBookTypography } from '../readerTypography';
import { BookTable } from './BookTable';

// Book digitisation owns its visual grammar; it does not share the changing lecture chart implementation.
const inks = ['#2D5BA8', '#A65035', '#0F7B76', '#7B4FC4', '#8A651D', '#555B63'];
const dash = (style: string) => style === 'dotted' ? '2 5' : style === 'dashed' ? '9 5' : undefined;
const number = (n: number) => Math.abs(n) < 1e-5 && n !== 0 ? n.toExponential(1) : String(Number(n.toPrecision(4)));

function Chart({ f, width }: { f: FigureChart; width: number }) {
  const { fontScale } = useWindowDimensions();
  const { caption, body } = useBookTypography();
  const [dataOpen, setDataOpen] = useState(false);
  const fs = Math.max(12, caption.fontSize!) * fontScale;
  const left = 54 * fontScale, right = 16 * fontScale, top = 40 * fontScale, plotH = 210 * fontScale;
  const bottom = 40 * fontScale;
  const scale = (n: number) => f.yScale === 'log' ? Math.log10(n) : n;
  const y = (n: number) => top + (1 - (scale(n) - scale(f.yMin)) / (scale(f.yMax) - scale(f.yMin))) * plotH;
  const x = (n: number) => left + n * (width - left - right);
  const ticks = figureYTicks(f);
  const baseline = y(Math.max(f.yMin, Math.min(f.yMax, 0)));
  const gap = Math.min(...f.series.flatMap(s => s.points.slice(1).map((p, i) => p[0] - s.points[i][0])).filter(n => n > 0), 0.1);
  const barWidth = Math.min(32 * fontScale, gap * (width - left - right) * 0.72 / f.series.length);
  const tickCount = Math.min(f.xTicks.length, Math.max(2, Math.floor((width - left - right) / (Math.max(...f.xTicks.map(t => t.label.length)) * fs * 0.6 + 12))));
  const visibleTicks = Array.from({ length: tickCount }, (_, i) => f.xTicks[Math.round(i * (f.xTicks.length - 1) / (tickCount - 1))]);
  const data = { kind: 'table' as const, title: '', description: '', notes: [], rows: [['系列', '横轴位置 / 标记', '估读值'],
    ...f.series.flatMap(s => s.points.map(([a, b]) => [s.name, f.xTicks.find(t => Math.abs(t.at - a) < 0.0001)?.label ?? number(a * 100) + '% 位置', b == null ? '无法辨认' : '≈ ' + number(b)]))] };
  return <View style={st.figure}>
    {f.yLabel ? <Text style={caption}>{f.yLabel}{f.yScale === 'log' ? ' · 对数刻度' : ''}</Text> : null}
    <ScrollView horizontal nestedScrollEnabled accessibilityLabel="重绘图表，可横向滚动" showsHorizontalScrollIndicator>
      <Svg width={width} height={top + plotH + bottom} accessible accessibilityLabel={f.description}>
        {ticks.map((tick, i) => <ReactTick key={i} tick={tick} y={y(tick)} left={left} right={width - right} fontSize={fs} />)}
        <Line x1={left} y1={top} x2={left} y2={top + plotH} stroke={rc.secondary} />
        <Line x1={left} y1={top + plotH} x2={width - right} y2={top + plotH} stroke={rc.secondary} />
        {visibleTicks.map((t, i) => <SvgText key={i} x={x(t.at)} y={top + plotH + 22 * fontScale} fill={rc.secondary} fontSize={fs} textAnchor={i === 0 ? 'start' : i === visibleTicks.length - 1 ? 'end' : 'middle'}>{t.label}</SvgText>)}
        {f.series.map((s, i) => f.chartType === 'bar' ? s.points.map(([a, b], j) => b == null ? null : <Rect key={i + ':' + j} x={x(a) - barWidth * f.series.length / 2 + i * barWidth} y={Math.min(y(b), baseline)} width={barWidth} height={Math.max(0.5, Math.abs(y(b) - baseline))} fill={inks[i]} />)
          : f.chartType === 'scatter' ? s.points.map(([a, b], j) => b == null ? null : <Circle key={i + ':' + j} cx={x(a)} cy={y(b)} r={3 * fontScale} fill={inks[i]} />)
          : figureSegments(s.points).map((segment, j) => segment.length === 1
            ? <Circle key={i + ':' + j} cx={x(segment[0][0])} cy={y(segment[0][1])} r={3 * fontScale} fill={inks[i]} />
            : <Path key={i + ':' + j} d={segment.map(([a, b], k) => (k ? 'L' : 'M') + x(a) + ',' + y(b)).join(' ')} stroke={inks[i]} strokeWidth={2 * fontScale} strokeDasharray={dash(s.style)} fill="none" />))}
        {f.annotations.map((a, i) => <FigureAnnotation key={i} px={x(a.x)} py={y(a.y)} text={a.text} fontSize={fs} width={width} />)}
      </Svg>
    </ScrollView>
    {f.xLabel ? <Text style={[caption, st.axis]}>{f.xLabel}</Text> : null}
    <View style={st.legend}>{f.series.map((s, i) => <View key={i} style={st.legendItem}>
      <Svg width={24} height={16}><Line x1={0} y1={8} x2={24} y2={8} stroke={inks[i]} strokeWidth={2} strokeDasharray={dash(s.style)} /></Svg>
      <Text style={[caption, st.legendText]}>{s.name}</Text>
    </View>)}</View>
    <Pressable style={st.action} accessibilityRole="button" accessibilityState={{ expanded: dataOpen }} onPress={e => { e.stopPropagation(); setDataOpen(v => !v); }}>
      <Text style={[st.actionText, { color: body.color }]}>{dataOpen ? '收起估读数据' : '查看估读数据'}</Text>
    </Pressable>
    {dataOpen ? <BookTable text="" html={figureTableHtml(data)} /> : null}
  </View>;
}

function FigureAnnotation({ px, py, text, fontSize, width }: { px: number; py: number; text: string; fontSize: number; width: number }) {
  const labelWidth = Math.min(width - 16, text.length * fontSize + 12, 16 * fontSize);
  const chars = Math.max(1, Math.floor((labelWidth - 12) / fontSize));
  const lines = Array.from({ length: Math.ceil(text.length / chars) }, (_, i) => text.slice(i * chars, (i + 1) * chars));
  const labelHeight = lines.length * fontSize * 1.4 + 8;
  const left = Math.max(8, Math.min(width - labelWidth - 8, px - labelWidth / 2));
  const top = Math.max(0, py - labelHeight - 12);
  return <>
    <Circle cx={px} cy={py} r={6} fill={rc.page} stroke={rc.secondary} />
    <Line x1={px} y1={py - 6} x2={left + labelWidth / 2} y2={top + labelHeight} stroke={rc.secondary} />
    <Rect x={left} y={top} width={labelWidth} height={labelHeight} fill={rc.page} />
    <SvgText fontSize={fontSize} fill={rc.ink} textAnchor="middle">{lines.map((line, i) => <TSpan key={i} x={left + labelWidth / 2} y={top + (i + 1) * fontSize * 1.4}>{line}</TSpan>)}</SvgText>
  </>;
}

function ReactTick({ tick, y, left, right, fontSize }: { tick: number; y: number; left: number; right: number; fontSize: number }) {
  return <>
    <Line x1={left} y1={y} x2={right} y2={y} stroke={rc.line} />
    <SvgText x={left - 8} y={y + fontSize * 0.35} fill={rc.secondary} fontSize={fontSize} textAnchor="end">{number(tick)}</SvgText>
  </>;
}

function Diagram({ f, width }: { f: FigureDiagram; width: number }) {
  const { fontScale } = useWindowDimensions();
  const { caption } = useBookTypography();
  const height = Math.max(width * 0.65, ...f.nodes.map(n => {
    const lines = Math.ceil(n.label.length / Math.max(1, (n.width * width - 24) / (caption.fontSize! * fontScale)));
    return (lines * caption.lineHeight! * fontScale + 24) / n.height;
  }));
  const nodes = f.nodes.map(n => ({ ...n, x: n.x * width, y: n.y * height, width: n.width * width, height: n.height * height }));
  return <ScrollView horizontal nestedScrollEnabled accessibilityLabel="重绘结构图，可横向滚动">
    <View style={{ width, height }}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {f.edges.map((e, i) => {
          const from = nodes.find(n => n.id === e.from)!, to = nodes.find(n => n.id === e.to)!;
          const dx = (to.x + to.width / 2) - (from.x + from.width / 2), dy = (to.y + to.height / 2) - (from.y + from.height / 2);
          const fromK = Math.min(dx ? from.width / 2 / Math.abs(dx) : Infinity, dy ? from.height / 2 / Math.abs(dy) : Infinity);
          const toK = Math.min(dx ? to.width / 2 / Math.abs(dx) : Infinity, dy ? to.height / 2 / Math.abs(dy) : Infinity);
          if (!Number.isFinite(fromK) || !Number.isFinite(toK)) return null;
          const length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
          const offset = f.edges.some(other => other.from === e.to && other.to === e.from) ? 7 * fontScale : 0;
          const x1 = from.x + from.width / 2 + dx * fromK - uy * offset, y1 = from.y + from.height / 2 + dy * fromK + ux * offset;
          const x2 = to.x + to.width / 2 - dx * toK - uy * offset, y2 = to.y + to.height / 2 - dy * toK + ux * offset;
          const arrow = 8 * fontScale;
          return <ViewEdge key={i} x1={x1} y1={y1} x2={x2} y2={y2} ux={ux} uy={uy} arrow={arrow} label={e.label} fontSize={caption.fontSize! * fontScale} />;
        })}
      </Svg>
      {nodes.map(n => <View key={n.id} style={[st.node, { left: n.x, top: n.y, width: n.width, height: n.height }]}>
        <Text selectable style={[caption, st.nodeText]}>{n.label}</Text>
      </View>)}
    </View>
  </ScrollView>;
}

function ViewEdge({ x1, y1, x2, y2, ux, uy, arrow, label, fontSize }: { x1: number; y1: number; x2: number; y2: number; ux: number; uy: number; arrow: number; label: string; fontSize: number }) {
  return <>
    <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={rc.secondary} strokeWidth={1.5} />
    <Polygon points={`${x2},${y2} ${x2 - ux * arrow - uy * arrow / 2},${y2 - uy * arrow + ux * arrow / 2} ${x2 - ux * arrow + uy * arrow / 2},${y2 - uy * arrow - ux * arrow / 2}`} fill={rc.secondary} />
    {label ? <SvgText x={(x1 + x2) / 2 + 8} y={(y1 + y2) / 2 - 8} fontSize={fontSize} fill={rc.ink}>{label}</SvgText> : null}
  </>;
}

export function BookFigureView({ figure, sourceCaption = '' }: { figure: Exclude<BookFigure, { kind: 'unsupported' }>; sourceCaption?: string }) {
  const { caption } = useBookTypography();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const [available, setAvailable] = useState(windowWidth - 48);
  const [large, setLarge] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const width = large ? Math.max(available, 680 * fontScale) : available;
  return <View style={st.figure} onLayout={e => setAvailable(e.nativeEvent.layout.width)}>
    {figure.title && !sourceCaption.replace(/\s/g, '').includes(figure.title.replace(/\s/g, '')) ? <Text style={[caption, st.figureTitle]}>{figure.title}</Text> : null}
    {figure.kind === 'table' ? <Text selectable style={caption}>{figure.description}</Text> : null}
    {figure.kind === 'chart' ? <Chart f={figure} width={width} /> : figure.kind === 'table' ? <BookTable text="" html={figureTableHtml(figure)} /> : <Diagram f={figure} width={width} />}
    <View style={st.legend}>
      {figure.kind !== 'table' ? <Pressable style={st.action} accessibilityRole="button" accessibilityState={{ expanded: large }} onPress={e => { e.stopPropagation(); setLarge(v => !v); }}><Text style={st.actionText}>{large ? '收起放大' : '放大图表'}</Text></Pressable> : null}
      <Pressable style={st.action} accessibilityRole="button" accessibilityState={{ expanded: notesOpen }} onPress={e => { e.stopPropagation(); setNotesOpen(v => !v); }}><Text style={st.actionText}>{notesOpen ? '收起识别说明' : '识别说明'}</Text></Pressable>
    </View>
    {notesOpen ? <Text selectable style={caption}>{[figure.description, ...figure.notes].join('\n')}</Text> : null}
  </View>;
}

const st = StyleSheet.create({
  figure: { gap: 8 },
  figureTitle: { color: rc.ink, fontWeight: '600' },
  axis: { textAlign: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  legendText: { flexShrink: 1 },
  action: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  actionText: { color: rc.ink, fontSize: 13, textDecorationLine: 'underline' },
  node: { position: 'absolute', backgroundColor: rc.page, borderWidth: 1, borderColor: rc.secondary, padding: 8, alignItems: 'center', justifyContent: 'center' },
  nodeText: { color: rc.ink, textAlign: 'center' },
});
