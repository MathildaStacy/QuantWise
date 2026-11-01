/**
 * 行情与因子图（QUANTWISE_DESIGN.md §7.4）：价格（均线、布林带、副图、标注）、对比、分组净值、IC、各组收益。
 * 对话里的卡片和全屏图用同一个组件；full 时按住或拖动出十字线，onPick 给出读数。
 */
import { useState } from 'react';
import { useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G as SvgG, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { chartTitle, type ChartData } from '../../quant/charts';
import { groupColor, rc, SERIES_COLORS } from '../readTheme';
import { color } from '../theme';
import { bounds, indexAt, linePath, pointCount, xAt } from './quantDraw';

const FONT = 12;
const L = 4;

export const chartHeight = (c: ChartData, full = false) =>
  full ? 320 : c.kind === 'price' && c.sub ? 210 : c.kind === 'groups' ? 140 : 168;

export function QuantChart({
  data,
  full = false,
  onPick,
  extremes = false,
}: {
  data: ChartData;
  full?: boolean;
  extremes?: boolean;
  onPick?: (i: number | null) => void;
}) {
  const [w, setW] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const { fontScale } = useWindowDimensions();
  const h = chartHeight(data, full) * Math.max(1, fontScale);
  const n = pointCount(data);
  const R = w - 4;
  const move = (x: number) => {
    const i = indexAt(x, n, L, R);
    setPick(i);
    onPick?.(i);
  };
  const touch = full
    ? {
        onStartShouldSetResponder: () => true,
        onMoveShouldSetResponder: () => true,
        onResponderGrant: (e: { nativeEvent: { locationX: number } }) => move(e.nativeEvent.locationX),
        onResponderMove: (e: { nativeEvent: { locationX: number } }) => move(e.nativeEvent.locationX),
      }
    : {};
  return (
    <View
      style={{ height: h }}
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={chartTitle(data) + '，可打开全屏查看读数和数据表'}
      {...touch}
    >
      {w > 0 ? (
        <Svg width={w} height={h}>
          {draw(data, w, h, extremes, fontScale)}
          {full && pick != null && data.kind !== 'groups' ? (
            <Line x1={xAt(pick, n, L, R)} x2={xAt(pick, n, L, R)} y1={0} y2={h - 16} stroke={rc.ink} strokeOpacity={0.5} strokeDasharray="3,3" />
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

/** 文字先描一圈白底再写，压在柱子、折线上也读得清。 */
function ChartLabel({ x, y, text, anchor, fill }: { x: number; y: number; text: string; anchor: 'start' | 'end' | 'middle'; fill: string }) {
  const { fontScale } = useWindowDimensions();
  const size = FONT * fontScale;
  const top = Math.max(size, y);
  return <SvgG><SvgText x={x} y={top} fontSize={size} fill={rc.paper} stroke={rc.paper} strokeWidth={3} strokeLinejoin="round" textAnchor={anchor}>{text}</SvgText><SvgText x={x} y={top} fontSize={size} fill={fill} textAnchor={anchor}>{text}</SvgText></SvgG>;
}
const label = (x: number, y: number, text: string, anchor: 'start' | 'end' | 'middle' = 'start', fill: string = rc.muted) =>
  <ChartLabel key={'t' + x + ':' + y + text} x={x} y={y} text={text} anchor={anchor} fill={fill} />;

function dateAxis(dates: string[], w: number, h: number) {
  return [label(L, h - 3, dates[0] ?? ''), label(w - 4, h - 3, dates[dates.length - 1] ?? '', 'end')];
}

function draw(c: ChartData, w: number, h: number, extremes: boolean, fontScale: number) {
  const R = w - 4;
  switch (c.kind) {
    case 'price':
      return drawPrice(c, w, h);
    case 'compare': {
      const [lo, hi] = bounds(c.series.map(s => s.values), [100]);
      const Y = (v: number) => 10 + ((h - 30) * (hi - v)) / (hi - lo);
      const xs = c.dates.map((_, i) => xAt(i, c.dates.length, L, R));
      return [
        <Line key="base" x1={0} x2={w} y1={Y(100)} y2={Y(100)} stroke={rc.line} strokeDasharray="3,3" />,
        ...c.series.map((s, k) => <Path key={s.code} d={linePath(xs, s.values.map(Y))} stroke={SERIES_COLORS[k % SERIES_COLORS.length]} strokeWidth={1.5} fill="none" />),
        label(L, 9, hi.toFixed(0)),
        label(L, h - 22, lo.toFixed(0)),
        ...dateAxis(c.dates, w, h),
      ];
    }
    case 'factor': {
      const [lo, hi] = bounds([...c.groups, c.bench, c.longShort]);
      const Y = (v: number) => 10 + ((h - 30) * (hi - v)) / (hi - lo);
      const xs = c.dates.map((_, i) => xAt(i, c.dates.length, L, R));
      const G = c.groups.length;
      return [
        <Line key="one" x1={0} x2={w} y1={Y(1)} y2={Y(1)} stroke={rc.grid} />,
        ...c.groups.map((g, k) => (!extremes || k === 0 || k === G - 1) ? <Path key={'g' + k} d={linePath(xs, g.map(Y))} stroke={groupColor(k, G)} strokeWidth={k === 0 || k === G - 1 ? 2 : 1.3} strokeDasharray={k === 0 ? '6,3' : undefined} fill="none" /> : null),
        <Path key="bench" d={linePath(xs, c.bench.map(Y))} stroke={rc.bench} strokeWidth={1} strokeDasharray="3,3" fill="none" />,
        <Path key="ls" d={linePath(xs, c.longShort.map(Y))} stroke={rc.accent} strokeWidth={1.2} strokeDasharray="5,2" fill="none" />,
        label(L, 9, hi.toFixed(2)),
        label(L, h - 22, lo.toFixed(2)),
        ...dateAxis(c.dates, w, h),
      ];
    }
    case 'ic': {
      const lim = Math.max(0.2, ...c.ic.map(Math.abs));
      const Y = (v: number) => 8 + ((h - 30) * (lim - v)) / (2 * lim);
      const bw = (w - 8) / Math.max(1, c.ic.length);
      const cum: number[] = [];
      c.ic.reduce((a, b, i) => (cum[i] = a + b), 0);
      const [clo, chi] = bounds([cum]);
      const CY = (v: number) => 8 + ((h - 30) * (chi - v)) / (chi - clo);
      return [
        <Line key="zero" x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke={rc.grid} />,
        ...c.ic.map((v, i) => <Rect key={'b' + i} x={L + i * bw + 1} y={Math.min(Y(0), Y(v))} width={Math.max(1, bw - 2)} height={Math.abs(Y(v) - Y(0))} fill={v >= 0 ? '#C7533A' : '#3E7C5A'} />),
        <Path key="cum" d={linePath(cum.map((_, i) => L + i * bw + bw / 2), cum.map(CY))} stroke={rc.ink} strokeWidth={1.2} strokeDasharray="4,2" fill="none" />,
        label(L, 9, '+' + lim.toFixed(2)),
        label(L, h - 22, '−' + lim.toFixed(2)),
        label(w - 4, 9, '虚线：累计 IC', 'end'),
        ...dateAxis(c.dates, w, h),
      ];
    }
    case 'groups': {
      const v = c.means.map(x => x * 100);
      const lim = Math.max(...v.map(Math.abs)) * 1.2 || 1;
      const Y = (x: number) => 14 + ((h - 36) * (lim - x)) / (2 * lim);
      const bw = (w - 8) / v.length;
      return [
        <Line key="zero" x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke={rc.grid} />,
        ...v.flatMap((x, i) => [
          <Rect key={'r' + i} x={L + i * bw + bw * 0.2} y={Math.min(Y(0), Y(x))} width={bw * 0.6} height={Math.abs(Y(x) - Y(0))} fill={groupColor(i, v.length)} />,
          bw >= 48 * fontScale ? label(L + i * bw + bw / 2, x >= 0 ? Y(x) - 3 : Y(x) + 11, (x > 0 ? '+' : '') + x.toFixed(2) + '%', 'middle', rc.ink) : null,
          label(L + i * bw + bw / 2, h - 4, 'Q' + (i + 1), 'middle'),
        ]),
      ];
    }
  }
}

function drawPrice(c: Extract<ChartData, { kind: 'price' }>, w: number, h: number) {
  const R = w - 4;
  const n = c.dates.length;
  const subH = c.sub ? (h - 16) * 0.32 : 0;
  const mainB = h - 16 - subH - (c.sub ? 8 : 0);
  const [lo, hi] = bounds([c.close, c.ma?.values ?? [], c.band?.upper ?? [], c.band?.lower ?? []]);
  const Y = (v: number) => 8 + ((mainB - 14) * (hi - v)) / (hi - lo);
  const xs = c.dates.map((_, i) => xAt(i, n, L, R));
  const ys = (s: (number | null)[]) => s.map(v => (v == null ? null : Y(v)));
  const out = [
    ...[0.25, 0.5, 0.75].map(f => <Line key={'g' + f} x1={0} x2={w} y1={8 + (mainB - 14) * f} y2={8 + (mainB - 14) * f} stroke={rc.grid} />),
    ...(c.band
      ? [
          <Path key="bu" d={linePath(xs, ys(c.band.upper))} stroke="#9DB4D8" strokeWidth={1} strokeDasharray="3,2" fill="none" />,
          <Path key="bl" d={linePath(xs, ys(c.band.lower))} stroke="#9DB4D8" strokeWidth={1} strokeDasharray="3,2" fill="none" />,
        ]
      : []),
    <Path key="close" d={linePath(xs, c.close.map(Y))} stroke={rc.main} strokeWidth={1.5} fill="none" />,
    ...(c.ma ? [<Path key="ma" d={linePath(xs, ys(c.ma.values))} stroke="#E08A1E" strokeWidth={1.1} fill="none" />] : []),
    label(L, 16, hi.toFixed(2)),
    label(L, mainB - 6, lo.toFixed(2)),
    ...(c.marks ?? []).flatMap(m => {
      const i = c.dates.indexOf(m.date);
      if (i < 0) {
        return [];
      }
      const x = xs[i];
      const y = Y(c.close[i]);
      const right = x > w * 0.7;
      return [
        <Circle key={'m' + m.date + m.label} cx={x} cy={y} r={3.2} fill={rc.accent} />,
        label(x + (right ? -6 : 6), y + (m.below ? 14 : -6), m.label, right ? 'end' : 'start', rc.accent),
      ];
    }),
  ];
  if (c.sub) {
    const top = mainB + 8;
    const [slo, shi] = bounds([c.sub.values], c.sub.kind === 'rsi14' || c.sub.kind === 'vol20' || c.sub.kind === 'volume' ? [] : [0]);
    const base = c.sub.kind === 'rsi14' ? 50 : c.sub.kind === 'vol20' || c.sub.kind === 'volume' ? slo : 0;
    const SY = (v: number) => top + ((subH - 2) * (shi - v)) / (shi - slo);
    const bw = Math.max(1, (w - 8) / n - 0.4);
    const signed = c.sub.kind === 'mom20' || c.sub.kind === 'mom60';
    out.push(<Line key="sz" x1={0} x2={w} y1={SY(base)} y2={SY(base)} stroke={rc.grid} />);
    c.sub.values.forEach((v, i) => {
      if (v == null) {
        return;
      }
      out.push(
        <Rect
          key={'s' + i}
          x={xs[i] - bw / 2}
          y={Math.min(SY(base), SY(v))}
          width={bw}
          height={Math.max(0.6, Math.abs(SY(v) - SY(base)))}
          fill={signed ? (v >= 0 ? color.up : color.down) : '#9DB4D8'}
          fillOpacity={signed ? 0.55 : 1}
        />,
      );
    });
  }
  return [...out, ...dateAxis(c.dates, w, h)];
}

