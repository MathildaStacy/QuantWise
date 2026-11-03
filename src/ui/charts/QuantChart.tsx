/**
 * 行情与因子图（QUANTWISE_DESIGN.md §7.4，讲解里怎么看图见 docs/design/ai-lecture-charts.md）：
 * 价格（均线、布林带、副图、标注、重点区间）、对比、分组净值、IC、各组收益。
 * 价格图和对比图的纵轴刻度写在右侧刻度栏里，横轴按跨度标周 / 月 / 年；重点区间的第一天、最后一天和标注日
 * 直接写在横轴上。区间里每个交易日占一格涂成浅黄，区间外的线变淡、区间里的线加粗；区间前一个交易日的收盘
 * 单独一个点写「前收」，从它的高度到区间最后一天收盘画一支量程箭头，顶部标签写区间涨跌；副图在同样两天标出指标值。
 * 对话里的卡片和全屏图用同一个组件：点一下、按住或左右拖动出十字线（手势见 scrub.ts），线上一个点，刻度栏写纵坐标、
 * 横轴写日期；手指还在图上时图顶再浮一个读数牌（图下的读数被手挡住）。onPick 给出读数。
 * mini：读讲解时钉在页面顶部的小图，只画主图的线、区间、标注点、几个刻度和横轴，高度跟着外面的格子。
 */
import { useMemo, useRef, useState, type ReactElement } from 'react';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G as SvgG, Line, Path, Rect, Text as SvgText, TSpan } from 'react-native-svg';
import {
  chartTitle,
  compareFocus,
  fmtSub,
  focusSpan,
  focusStats,
  md,
  pct,
  SUB_NAME,
  type ChartData,
  type CompareChart,
  type Focus,
  type PriceChart,
  type SubKind,
} from '../../quant/charts';
import { groupColor, rc, SERIES_COLORS } from '../readTheme';
import { color } from '../theme';
import {
  axisLabels,
  bandX,
  bounds,
  indexAt,
  labelWidth,
  linePath,
  niceTicks,
  pointCount,
  tickDecimals,
  timeTicks,
  xAt,
  type PinnedLabel,
} from './quantDraw';
import { useScrub } from './scrub';

const FONT = 12;
const TICK = 11;
const L = 4;
/** 网格线：比 1dp 细一点，颜色比纸色深一档。 */
const GRID = 0.8;

let clipSeq = 0;
const sheet = StyleSheet.create({ fill: { flex: 1 } });

export const chartHeight = (c: ChartData, full = false) =>
  full
    ? c.kind === 'price' && c.sub
      ? 420
      : 350
    : c.kind === 'price'
    ? c.sub
      ? 268
      : 212
    : c.kind === 'compare'
    ? 206
    : c.kind === 'groups'
    ? 140
    : 176;

export function QuantChart({
  data,
  full = false,
  mini = false,
  onPick,
  pick: pickProp,
  extremes = false,
}: {
  data: ChartData;
  full?: boolean;
  /** 钉在讲解页顶部的小图：撑满外面的格子，不能点（外面整块是一个按钮）。只给价格图和对比图用。 */
  mini?: boolean;
  extremes?: boolean;
  /** 选中的那一天：点图、按住或拖动时给出下标。 */
  onPick?: (i: number | null) => void;
  /** 由外面管的十字线位置（卡片里收起读数时清掉）；不给时自己记。 */
  pick?: number | null;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [own, setOwn] = useState<number | null>(null);
  const pick = pickProp !== undefined ? pickProp : own;
  const { fontScale } = useWindowDimensions();
  const clipId = useRef('qc' + ++clipSeq).current;
  const w = size.w;
  const h = mini ? size.h : chartHeight(data, full) * Math.max(1, fontScale);
  const n = pointCount(data);
  const box = useMemo(() => plotBox(data, w, h, fontScale, full), [data, w, h, fontScale, full]);
  // 图本身只在数据和尺寸变了时重画；拖动时只换十字线那一层
  const base = useMemo(
    () => (w > 0 && h > 0 ? (mini && (data.kind === 'price' || data.kind === 'compare') ? drawMini(data, w, h, fontScale, clipId) : draw(data, w, h, extremes, fontScale, clipId, full)) : null),
    [data, w, h, mini, extremes, fontScale, clipId, full],
  );
  const cur = useRef(pick);
  cur.current = pick;
  const set = (i: number | null) => {
    cur.current = i;
    setOwn(i);
    onPick?.(i);
  };
  const scrub = useScrub({
    full,
    pick,
    move: x => {
      const i = indexAt(x, n, box.L, box.R);
      if (i !== cur.current) {
        set(i);
      }
    },
    restore: set,
  });
  // 卡片：点一下、按住或左右拖动；全屏：一按下就跟手。各组收益图在卡片里没有日期，不点
  const touch = !mini && (full || (onPick && data.kind !== 'groups'));
  return (
    <View
      style={mini ? sheet.fill : { height: h }}
      onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      accessible={!mini}
      accessibilityRole="image"
      accessibilityLabel={mini ? undefined : chartTitle(data) + focusSpeech(data) + (full ? '，按住或拖动看每一天的数' : '，点一下或按住拖动看每一天的数，全屏有数据表')}
      collapsable={false}
      {...(touch ? scrub.outer : null)}
    >
      <View style={sheet.fill} {...(touch ? scrub.inner : null)}>
        {base ? (
          <Svg width={w} height={h}>
            {base}
            {!mini && pick != null && pick < n && data.kind !== 'groups' ? cursor(data, pick, n, box, w, fontScale, full, scrub.live) : null}
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

/** 读屏：「，重点区间 9 月 -19.93%」。 */
function focusSpeech(c: ChartData): string {
  if (c.kind === 'compare' && c.focus?.length) {
    return '，重点区间 ' + c.focus.map(f => f.label).join('、');
  }
  if (c.kind !== 'price' || !c.focus?.length) {
    return '';
  }
  return '，重点区间 ' + c.focus.map(f => {
    const st = focusStats(c, f);
    return f.label + (st ? ' ' + pct(st.change, 2) : '');
  }).join('、');
}

/** 文字先描一圈纸色再写，压在柱子、折线上也读得清。 */
function ChartLabel({ x, y, text, anchor, fill, bold }: { x: number; y: number; text: string; anchor: 'start' | 'end' | 'middle'; fill: string; bold?: boolean }) {
  const { fontScale } = useWindowDimensions();
  const size = FONT * fontScale;
  const top = Math.max(size, y);
  const weight = bold ? 'bold' : 'normal';
  return <SvgG><SvgText x={x} y={top} fontSize={size} fontWeight={weight} fill={rc.paper} stroke={rc.paper} strokeWidth={3} strokeLinejoin="round" textAnchor={anchor}>{text}</SvgText><SvgText x={x} y={top} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor}>{text}</SvgText></SvgG>;
}
const label = (x: number, y: number, text: string, anchor: 'start' | 'end' | 'middle' = 'start', fill: string = rc.muted, bold = false) =>
  <ChartLabel key={'t' + x + ':' + y + text} x={x} y={y} text={text} anchor={anchor} fill={fill} bold={bold} />;

// ---------- 布局 ----------

interface Scale {
  ticks: number[];
  dp: number;
  y: (v: number) => number;
}

/** 数据范围上下各留一点，取整刻度。 */
function scaleOf(lo0: number, hi0: number, top: number, bottom: number, max: number, padTop = 0.08, padBottom = 0.08): Scale {
  const span = hi0 - lo0 || Math.abs(hi0) * 0.02 || 1;
  const lo = lo0 - span * padBottom;
  const hi = hi0 + span * padTop;
  const { ticks, step } = niceTicks(lo, hi, max);
  return { ticks, dp: tickDecimals(step), y: v => top + ((bottom - top) * (hi - v)) / (hi - lo) };
}

interface Frame {
  /** 画线的左右；R 右边是刻度栏。 */
  R: number;
  /** 主图上沿（上面是区间标签带）、主图下沿。 */
  top: number;
  mainB: number;
  /** 副图上沿（没有副图时 = mainB）。 */
  subTop: number;
  axisY: number;
  main: Scale;
  sub: (Scale & { fmt: (v: number) => string; lines: { v: number; text: string; dashed?: boolean }[] }) | null;
  tick: number;
  tag: number;
}

const subFmt = (kind: SubKind, dp: number) => (v: number) =>
  kind === 'rsi14' ? v.toFixed(0) : kind === 'volume' ? (v >= 1e8 ? (v / 1e8).toFixed(1) + '亿' : (v / 1e4).toFixed(0) + '万') : (v > 0 ? '+' : '') + (v * 100).toFixed(Math.max(0, dp - 2)) + '%';

function priceFrame(c: PriceChart, w: number, h: number, fontScale: number, full: boolean): Frame {
  const tick = TICK * fontScale;
  const tag = FONT * fontScale;
  const top = c.focus?.length ? tag + 16 : 10;
  const axisY = h - (tick + 9);
  const subH = c.sub ? Math.round((axisY - top) * 0.3) : 0;
  const gap = c.sub ? Math.round(tick + 10) : 0;
  const mainB = axisY - subH - gap;
  const [lo, hi] = bounds([c.close, c.ma?.values ?? [], c.band?.upper ?? [], c.band?.lower ?? []]);
  // 底部多留一点给区间终点下方的价格标签
  const main = scaleOf(lo, hi, top, mainB, full ? 6 : 5, 0.08, 0.12);
  let sub: Frame['sub'] = null;
  if (c.sub) {
    const subTop = mainB + gap;
    const k = c.sub.kind;
    if (k === 'rsi14') {
      const y = (v: number) => subTop + ((axisY - subTop) * (100 - v)) / 100;
      sub = { ticks: [], dp: 0, y, fmt: subFmt(k, 0), lines: [{ v: 70, text: '70', dashed: true }, { v: 50, text: '' }, { v: 30, text: '30', dashed: true }] };
    } else if (k === 'volume') {
      const [, vhi] = bounds([c.sub.values], [0]);
      const { ticks, step } = niceTicks(0, vhi, 3);
      const y = (v: number) => axisY - ((axisY - subTop) * v) / (vhi || 1);
      const top1 = ticks.filter(t => t > 0).pop();
      sub = { ticks: top1 ? [top1] : [], dp: tickDecimals(step), y, fmt: subFmt(k, 0), lines: [] };
    } else {
      const [slo, shi] = bounds([c.sub.values], k === 'vol20' ? [] : [0]);
      const s = scaleOf(slo, shi, subTop + 2, axisY - 2, 3, 0.1, 0.1);
      sub = { ...s, fmt: subFmt(k, s.dp), lines: k === 'vol20' ? [] : [{ v: 0, text: '' }] };
    }
  }
  const last = c.close[c.close.length - 1];
  const widths = [
    ...main.ticks.map(t => labelWidth(t.toFixed(main.dp), tick)),
    labelWidth(last.toFixed(2), tick) + 8,
    ...(sub ? [...sub.ticks.map(t => labelWidth(sub!.fmt(t), tick)), ...sub.lines.map(l => labelWidth(l.text, tick))] : []),
  ];
  const gutter = Math.ceil(Math.max(...widths)) + 8;
  return { R: w - gutter, top, mainB, subTop: c.sub ? mainB + gap : mainB, axisY, main, sub, tick, tag };
}

function compareFrame(c: CompareChart, w: number, h: number, fontScale: number, full: boolean): Frame {
  const tick = TICK * fontScale;
  const tag = FONT * fontScale;
  const top = c.focus?.length ? tag + 16 : 10;
  const axisY = h - (tick + 9);
  const [lo, hi] = bounds(c.series.map(s => s.values), [100]);
  const main = scaleOf(lo, hi, top, axisY - 4, full ? 6 : 5);
  const gutter = Math.ceil(Math.max(...main.ticks.map(t => labelWidth(t.toFixed(main.dp), tick)), labelWidth('100.0', tick) + 8)) + 8;
  return { R: w - gutter, top, mainB: axisY - 4, subTop: axisY - 4, axisY, main, sub: null, tick, tag };
}

interface Box {
  L: number;
  R: number;
  top: number;
  bottom: number;
  y?: (v: number) => number;
  /** 价格图的副图：纵坐标换算和上下沿。 */
  sub?: { y: (v: number) => number; top: number; bottom: number };
}

/** 十字线用：画线区域的左右上下，价格图和对比图还给纵坐标换算。 */
function plotBox(c: ChartData, w: number, h: number, fontScale: number, full: boolean): Box {
  if (w <= 0) {
    return { L, R: L + 1, top: 0, bottom: h };
  }
  if (c.kind === 'price') {
    const f = priceFrame(c, w, h, fontScale, full);
    return { L, R: f.R, top: f.top, bottom: f.axisY, y: f.main.y, ...(f.sub ? { sub: { y: f.sub.y, top: f.subTop, bottom: f.axisY } } : {}) };
  }
  if (c.kind === 'compare') {
    const f = compareFrame(c, w, h, fontScale, full);
    return { L, R: f.R, top: f.top, bottom: f.axisY, y: f.main.y };
  }
  return { L, R: w - 4, top: 0, bottom: h - 16 };
}

// ---------- 共用的几层 ----------

interface Band {
  f: Focus;
  x1: number;
  x2: number;
}

function bandsOf(dates: string[], focus: Focus[] | undefined, X: (i: number) => number, R: number): Band[] {
  return (focus ?? []).flatMap(f => {
    const b = bandX(dates, f, X);
    return b ? [{ f, x1: Math.max(L, b.x1), x2: Math.min(R, b.x2) }] : [];
  });
}

/** 区间底色和两条琥珀色边线（贯通主图和副图）。 */
function bandLayer(bands: Band[], top: number, bottom: number): ReactElement[] {
  return bands.flatMap((b, k) => [
    <Rect key={'fb' + k} x={b.x1} y={top} width={Math.max(2, b.x2 - b.x1)} height={bottom - top} fill={rc.focus} />,
    <Line key={'fe' + k + 'a'} x1={b.x1} x2={b.x1} y1={top} y2={bottom} stroke={rc.focusEdge} strokeWidth={1} strokeDasharray="3,3" />,
    <Line key={'fe' + k + 'b'} x1={b.x2} x2={b.x2} y1={top} y2={bottom} stroke={rc.focusEdge} strokeWidth={1} strokeDasharray="3,3" />,
  ]);
}

/** 区间裁剪：区间里的线再画一遍（加粗、不透明）。 */
function clipDefs(id: string, bands: Band[], h: number): ReactElement[] {
  return bands.length
    ? [
        <Defs key="defs">
          <ClipPath id={id}>
            {bands.map((b, k) => <Rect key={k} x={b.x1} y={0} width={Math.max(2, b.x2 - b.x1)} height={h} />)}
          </ClipPath>
        </Defs>,
      ]
    : [];
}

/** 区间外淡、区间里加粗：paint(true) 是区间里那一遍。 */
function emphasis(key: string, bands: Band[], clipId: string, paint: (focus: boolean) => ReactElement[]): ReactElement[] {
  if (!bands.length) {
    return [<SvgG key={key}>{paint(false)}</SvgG>];
  }
  return [
    <SvgG key={key} opacity={0.35}>{paint(false)}</SvgG>,
    <SvgG key={key + 'F'} clipPath={'url(#' + clipId + ')'}>{paint(true)}</SvgG>,
  ];
}

/**
 * 区间第一天、最后一天（琥珀色）和标注日（锈红）写在横轴上。挤不下时按这里的顺序优先：先保整体的起止（第一段的第一天、
 * 最后一段的最后一天），再写两段之间的交界，最后是标注日。
 */
function pinnedOf(dates: string[], focus: Focus[] | undefined, marks: PriceChart['marks'], X: (i: number) => number): PinnedLabel[] {
  const edges: PinnedLabel[] = [];
  (focus ?? []).forEach((f, band) => {
    const s = focusSpan(dates, f);
    if (s) {
      edges.push({ x: X(s.a), label: md(f.from), tone: 'focus', band });
      if (s.b !== s.a) {
        edges.push({ x: X(s.b), label: md(f.to), tone: 'focus', band });
      }
    }
  });
  const out = edges.length > 2 ? [edges[0], edges[edges.length - 1], ...edges.slice(1, -1)] : edges;
  for (const m of marks ?? []) {
    const i = dates.indexOf(m.date);
    if (m.kind === 'point' && i >= 0) {
      out.push({ x: X(i), label: md(m.date), tone: 'point' });
    }
  }
  return out;
}

/**
 * 横轴：轴线、周和月的小刻度、按跨度选的刻度和标签、区间条，以及优先写的日期（区间起止、标注日；
 * 和它们重叠的月份标签不写）。
 */
function timeAxis(dates: string[], X: (i: number) => number, right: number, axisY: number, w: number, tick: number, bands: Band[] = [], pinned: PinnedLabel[] = []): ReactElement[] {
  const tt = timeTicks(dates, X, tick);
  const al = axisLabels(tt.major, pinned, X, tick, w);
  const ty = axisY + tick + 4;
  return [
    <Line key="axis" x1={L} x2={right} y1={axisY} y2={axisY} stroke={rc.line} />,
    ...tt.week.map(i => <Line key={'wk' + i} x1={X(i)} x2={X(i)} y1={axisY} y2={axisY + 2} stroke={rc.muted} strokeOpacity={0.3} />),
    ...tt.minor.map(i => <Line key={'mn' + i} x1={X(i)} x2={X(i)} y1={axisY} y2={axisY + 3} stroke={rc.muted} strokeOpacity={0.55} />),
    ...tt.major.map(t => <Line key={'mj' + t.i} x1={X(t.i)} x2={X(t.i)} y1={axisY} y2={axisY + 4} stroke={rc.muted} />),
    ...al.major.map(t => {
      const x = X(t.i);
      const lw = labelWidth(t.label, tick);
      const anchor = x - lw / 2 < 0 ? 'start' : x + lw / 2 > w ? 'end' : 'middle';
      return (
        <SvgText key={'xl' + t.i} x={anchor === 'start' ? 0 : anchor === 'end' ? w : x} y={ty} fontSize={tick} fill={rc.secondary} textAnchor={anchor}>
          {t.label}
        </SvgText>
      );
    }),
    ...bands.map((b, k) => <Rect key={'fx' + k} x={b.x1} y={axisY - 1.5} width={Math.max(2, b.x2 - b.x1)} height={3} rx={1} fill={rc.focusEdge} />),
    ...al.pinned.map(p => (
      <SvgText key={'pn' + p.label + p.x} x={p.x} y={ty} fontSize={tick} fontWeight="bold" fill={p.tone === 'focus' ? rc.focusInk : rc.accent} textAnchor="middle">
        {p.label}
      </SvgText>
    )),
  ];
}

/** 竖向网格：只在有标签的时间刻度上。 */
function timeGrid(dates: string[], X: (i: number) => number, top: number, bottom: number, tick: number): ReactElement[] {
  return timeTicks(dates, X, tick).major.map(t => <Line key={'gx' + t.i} x1={X(t.i)} x2={X(t.i)} y1={top} y2={bottom} stroke={rc.grid} strokeWidth={GRID} />);
}

/**
 * 区间标签：「9 月 -19.93%」，对齐区间中点；挤在一起时左右让开（先往右推，出界了再往左收），
 * 一排放不下时只写区间名（涨跌在图下的读数里）。
 */
function pills(bands: Band[], w: number, top: number, tag: number, change: (f: Focus) => number | null): ReactElement[] {
  const gap = tag * 0.35;
  const ph = tag + 7;
  const y0 = top - ph - 6;
  const sized = (withPct: boolean) =>
    bands.map(b => {
      const v = withPct ? change(b.f) : null;
      const text2 = v == null ? '' : pct(v, 2);
      return { b, v, text2, pw: labelWidth(b.f.label, tag) + (text2 ? gap + labelWidth(text2, tag) : 0) + 14 };
    });
  let items = sized(true);
  if (items.reduce((sum, p) => sum + p.pw + 4, -4) > w) {
    items = sized(false);
  }
  const xs = items.map(p => Math.max(0, Math.min(w - p.pw, (p.b.x1 + p.b.x2) / 2 - p.pw / 2)));
  for (let k = 1; k < xs.length; k++) {
    xs[k] = Math.max(xs[k], xs[k - 1] + items[k - 1].pw + 4);
  }
  for (let k = xs.length - 1; k >= 0; k--) {
    xs[k] = Math.max(0, Math.min(xs[k], (k === xs.length - 1 ? w : xs[k + 1] - 4) - items[k].pw));
  }
  return items.flatMap((p, k) => {
    const x0 = xs[k];
    const cx = Math.max(x0 + 6, Math.min(x0 + p.pw - 6, (p.b.x1 + p.b.x2) / 2));
    return [
      // 标签下方一个小三角指向区间
      <Path key={'pa' + k} d={'M' + (cx - 4) + ',' + (y0 + ph - 0.5) + 'L' + cx + ',' + (y0 + ph + 4) + 'L' + (cx + 4) + ',' + (y0 + ph - 0.5) + 'Z'} fill={rc.focusTag} />,
      <Rect key={'pl' + k} x={x0} y={y0} width={p.pw} height={ph} rx={4} fill={rc.focusTag} />,
      <SvgText key={'pt' + k} x={x0 + 7} y={y0 + ph / 2 + tag * 0.36} fontSize={tag} fontWeight="bold">
        <TSpan fill={rc.focusInk}>{p.b.f.label}</TSpan>
        {p.text2 ? <TSpan dx={gap} fill={p.v! >= 0 ? color.upText : color.downText}>{p.text2}</TSpan> : null}
      </SvgText>,
    ];
  });
}

/** 刻度栏里的数字（纵向居中在刻度线上）。 */
const yLabel = (key: string, w: number, y: number, text: string, tick: number, fill: string = rc.muted) => (
  <SvgText key={key} x={w - 3} y={y + tick * 0.36} fontSize={tick} fill={fill} textAnchor="end">
    {text}
  </SvgText>
);

/** 读数牌：深色底白字，刻度栏或横轴上。 */
function badge(key: string, x: number, y: number, text: string, size: number, anchor: 'end' | 'middle', w: number): ReactElement {
  const bw = labelWidth(text, size) + 10;
  const bh = size + 7;
  const x0 = anchor === 'end' ? x - bw : Math.max(0, Math.min(w - bw, x - bw / 2));
  return (
    <SvgG key={key}>
      <Rect x={x0} y={y} width={bw} height={bh} rx={3} fill={rc.ink} />
      <SvgText x={x0 + bw / 2} y={y + bh / 2 + size * 0.36} fontSize={size} fill="#FFFFFF" textAnchor="middle">
        {text}
      </SvgText>
    </SvgG>
  );
}

/**
 * 十字线：竖线贯通主图和副图。价格图在收盘价和副图值上各一条横线、一个点，刻度栏写收盘价和副图值；对比图每条线一个点。
 * 横轴写日期：卡片里只写「9/15」（少挡住区间起止日，完整日期在图下的读数里），全屏写完整日期。
 * live（手指还在图上）：图顶再浮一个读数牌写日期和这一天的数，跟着十字线走（图下的读数、横轴上的日期这时被手挡住）。
 */
function cursor(c: ChartData, i: number, n: number, box: Box, w: number, fontScale: number, full: boolean, live: boolean): ReactElement {
  const x = xAt(i, n, box.L, box.R);
  const tick = TICK * fontScale;
  const bh = tick + 7;
  const date = c.kind === 'groups' ? null : c.dates[i];
  const out: ReactElement[] = [<Line key="vx" x1={x} x2={x} y1={box.top} y2={box.bottom} stroke={rc.ink} strokeOpacity={0.55} strokeDasharray="3,3" />];
  const cross = (key: string, y: number, text: string, top: number, bottom: number) => [
    <Line key={key + 'h'} x1={box.L} x2={box.R} y1={y} y2={y} stroke={rc.ink} strokeOpacity={0.4} strokeDasharray="3,3" />,
    <Circle key={key + 'd'} cx={x} cy={y} r={3.6} fill={rc.ink} stroke={rc.paper} strokeWidth={1.2} />,
    badge(key + 'b', w - 1, Math.max(top, Math.min(bottom - bh, y - bh / 2)), text, tick, 'end', w),
  ];
  const tip: TipPart[] = date ? [{ text: full ? date : md(date) }] : [];
  if (c.kind === 'price' && box.y) {
    out.push(...cross('cy', box.y(c.close[i]), c.close[i].toFixed(2), 0, box.sub ? box.sub.top : box.bottom));
    const v = c.sub?.values[i];
    if (c.sub && box.sub && v != null) {
      out.push(...cross('cs', box.sub.y(v), fmtSub(c.sub.kind, v), box.sub.top, box.sub.bottom));
    }
    tip.push({ text: c.close[i].toFixed(2), gap: true });
    if (i > 0) {
      const d = c.close[i] / c.close[i - 1] - 1;
      tip.push({ text: pct(d, 2), gap: true, fill: d > 0 ? color.upText : d < 0 ? color.downText : rc.ink });
    }
  }
  if (c.kind === 'compare' && box.y) {
    c.series.forEach((s, k) => {
      const col = SERIES_COLORS[k % SERIES_COLORS.length];
      out.push(<Circle key={'cd' + k} cx={x} cy={box.y!(s.values[i])} r={3.4} fill={col} stroke={rc.paper} strokeWidth={1.2} />);
      tip.push({ text: '●', gap: true, fill: col }, { text: s.values[i].toFixed(1) });
    });
  }
  if (c.kind === 'ic') {
    tip.push({ text: 'IC ' + (c.ic[i] > 0 ? '+' : '') + c.ic[i].toFixed(3), gap: true });
  }
  if (date && (c.kind === 'price' || c.kind === 'compare')) {
    out.push(badge('cx', x, box.bottom + 2, full ? date : md(date), tick, 'middle', w));
  }
  if (live && tip.length) {
    out.push(floatTip(tip, x, tick, w));
  }
  return <SvgG>{out}</SvgG>;
}

interface TipPart {
  text: string;
  fill?: string;
  /** 前面空一格。 */
  gap?: boolean;
}

/** 手指还在图上时图顶的读数牌：纸色底、细边，跟着十字线走，贴边时往里收。 */
function floatTip(parts: TipPart[], x: number, size: number, w: number): ReactElement {
  const gap = size * 0.6;
  const tw = parts.reduce((sum, p) => sum + labelWidth(p.text, size) + (p.gap ? gap : 0), 0) + 12;
  const th = size + 8;
  const x0 = Math.max(1, Math.min(w - tw - 1, x - tw / 2));
  return (
    <SvgG key="tip">
      <Rect x={x0} y={1} width={tw} height={th} rx={4} fill={rc.paper} stroke={rc.ink} strokeOpacity={0.3} strokeWidth={1} />
      <SvgText x={x0 + 6} y={1 + th / 2 + size * 0.36} fontSize={size} fill={rc.ink}>
        {parts.map((p, k) => (
          <TSpan key={k} dx={p.gap ? gap : 0} fill={p.fill ?? rc.ink}>
            {p.text}
          </TSpan>
        ))}
      </SvgText>
    </SvgG>
  );
}

// ---------- 各种图 ----------

function draw(c: ChartData, w: number, h: number, extremes: boolean, fontScale: number, clipId: string, full: boolean): (ReactElement | null)[] {
  const R = w - 4;
  const tick = TICK * fontScale;
  switch (c.kind) {
    case 'price':
      return drawPrice(c, w, h, fontScale, clipId, full);
    case 'compare':
      return drawCompare(c, w, h, fontScale, clipId, full);
    case 'factor': {
      const [lo, hi] = bounds([...c.groups, c.bench, c.longShort]);
      const Y = (v: number) => 10 + ((h - 30) * (hi - v)) / (hi - lo);
      const X = (i: number) => xAt(i, c.dates.length, L, R);
      const xs = c.dates.map((_, i) => X(i));
      const G = c.groups.length;
      return [
        <Line key="one" x1={0} x2={w} y1={Y(1)} y2={Y(1)} stroke={rc.grid} />,
        ...c.groups.map((g, k) => (!extremes || k === 0 || k === G - 1) ? <Path key={'g' + k} d={linePath(xs, g.map(Y))} stroke={groupColor(k, G)} strokeWidth={k === 0 || k === G - 1 ? 2 : 1.3} strokeDasharray={k === 0 ? '6,3' : undefined} fill="none" /> : null),
        <Path key="bench" d={linePath(xs, c.bench.map(Y))} stroke={rc.bench} strokeWidth={1} strokeDasharray="3,3" fill="none" />,
        <Path key="ls" d={linePath(xs, c.longShort.map(Y))} stroke={rc.accent} strokeWidth={1.2} strokeDasharray="5,2" fill="none" />,
        label(L, 9, hi.toFixed(2)),
        label(L, h - 24, lo.toFixed(2)),
        ...timeAxis(c.dates, X, R, h - (tick + 9), w, tick),
      ];
    }
    case 'ic': {
      const lim = Math.max(0.2, ...c.ic.map(Math.abs));
      const Y = (v: number) => 8 + ((h - 30) * (lim - v)) / (2 * lim);
      const bw = (w - 8) / Math.max(1, c.ic.length);
      const X = (i: number) => L + i * bw + bw / 2;
      const cum: number[] = [];
      c.ic.reduce((a, b, i) => (cum[i] = a + b), 0);
      const [clo, chi] = bounds([cum]);
      const CY = (v: number) => 8 + ((h - 30) * (chi - v)) / (chi - clo);
      return [
        <Line key="zero" x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke={rc.grid} />,
        ...c.ic.map((v, i) => <Rect key={'b' + i} x={L + i * bw + 1} y={Math.min(Y(0), Y(v))} width={Math.max(1, bw - 2)} height={Math.abs(Y(v) - Y(0))} fill={v >= 0 ? '#C7533A' : '#3E7C5A'} />),
        <Path key="cum" d={linePath(cum.map((_, i) => X(i)), cum.map(CY))} stroke={rc.ink} strokeWidth={1.2} strokeDasharray="4,2" fill="none" />,
        label(L, 9, '+' + lim.toFixed(2)),
        label(L, h - 24, '−' + lim.toFixed(2)),
        label(w - 4, 9, '虚线：累计 IC', 'end'),
        ...timeAxis(c.dates, X, R, h - (tick + 9), w, tick),
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

/**
 * 区间的量程：前收那一点（空心）和「前收 363.55」、从前收高度沿区间画一条虚线、在区间右缘画箭头指到区间最后一天收盘，
 * 箭头尖写最后一天收盘价。涨红跌绿。两段区间首尾相接时（ends 里有基数那天），那一点和价格前一段已经画了，不再写「前收」。
 */
function measure(c: PriceChart, b: Band, k: number, X: (i: number) => number, Y: (v: number) => number, top: number, bottom: number, R: number, tag: number, ends: Set<string>): ReactElement[] {
  const st = focusStats(c, b.f);
  if (!st) {
    return [];
  }
  const tone = st.change >= 0 ? color.upText : color.downText;
  const y0 = Y(st.base);
  const y1 = Y(st.last);
  const xb = X(st.k);
  const xe = X(st.b);
  const ax = Math.min(R - 1, b.x2);
  const out: ReactElement[] = [];
  const hasBase = st.k < st.a;
  const shared = hasBase && ends.has(st.baseDate);
  if (hasBase) {
    out.push(<Line key={'ml' + k} x1={xb} x2={ax} y1={y0} y2={y0} stroke={tone} strokeOpacity={0.7} strokeWidth={1} strokeDasharray="4,3" />);
  }
  if (Math.abs(y1 - y0) >= 12) {
    const dir = y1 > y0 ? 1 : -1;
    const head = 6;
    out.push(
      <Line key={'ma' + k} x1={ax} x2={ax} y1={y0} y2={y1 - dir * head} stroke={tone} strokeWidth={1.4} />,
      <Path key={'mh' + k} d={'M' + (ax - 4) + ',' + (y1 - dir * head) + 'L' + ax + ',' + y1 + 'L' + (ax + 4) + ',' + (y1 - dir * head) + 'Z'} fill={tone} />,
    );
  }
  // 起止点：空心圆，基数那天写「前收」
  out.push(
    ...(hasBase && !shared ? [<Circle key={'fb0' + k} cx={xb} cy={y0} r={3.4} fill={rc.paper} stroke={rc.main} strokeWidth={1.8} />] : []),
    <Circle key={'fb1' + k} cx={xe} cy={y1} r={3.4} fill={rc.paper} stroke={rc.main} strokeWidth={1.8} />,
  );
  if (!shared) {
    const baseText = (hasBase ? '前收 ' : '起点 ') + st.base.toFixed(2);
    const bw = labelWidth(baseText, tag);
    out.push(
      xb - 7 - bw >= L
        ? label(xb - 7, y0 + tag * 0.36, baseText, 'end', rc.secondary)
        : label(xb + 6, Math.max(top + tag, y0 - 8), baseText, 'start', rc.secondary),
    );
  }
  // 终点价格放在箭头尖的外侧（跌了放下面、涨了放上面），不压住进来的线
  const endText = st.last.toFixed(2);
  const ey = y1 > y0 ? Math.min(bottom - 2, y1 + tag + 4) : Math.max(top + tag, y1 - 8);
  const ew = labelWidth(endText, tag);
  out.push(label(Math.max(L + ew, Math.min(R - 2, ax)), ey, endText, 'end', tone, true));
  return out;
}

/**
 * 副图上区间两端的读数：基数那天和区间最后一天各一个空心点，写指标值（和图下读数「20 日动量 -4.4% → -3.1%」同一份数），
 * 讲解说「九月末动量 -3.1%」时图上就找得到。基数写在点左边、终点写在点右边（放不下就写左边）。
 * 两段区间首尾相接时交界那天只写一次；成交量不标（两端那天的量没有讲解意义）。
 */
function subMeasure(c: PriceChart, b: Band, k: number, X: (i: number) => number, S: (v: number) => number, top: number, bottom: number, R: number, tag: number, ends: Set<string>): ReactElement[] {
  const st = focusStats(c, b.f);
  const kind = c.sub?.kind;
  if (!st?.sub || !kind || kind === 'volume') {
    return [];
  }
  const tone = (v: number) => (kind === 'mom20' || kind === 'mom60' ? (v >= 0 ? color.upText : color.downText) : rc.ink);
  const pts = [
    ...(st.k !== st.b && !ends.has(st.baseDate) ? [{ i: st.k, v: st.sub.from, end: false }] : []),
    { i: st.b, v: st.sub.to, end: true },
  ];
  return pts.flatMap(p => {
    if (p.v == null) {
      return [];
    }
    const x = X(p.i);
    const y = S(p.v);
    const text = fmtSub(kind, p.v);
    const left = !p.end || x + 6 + labelWidth(text, tag) > R;
    const ty = Math.max(top + tag, Math.min(bottom - 2, y + tag * 0.36));
    return [
      <Circle key={'sm' + k + (p.end ? 'e' : 'b')} cx={x} cy={y} r={3} fill={rc.paper} stroke={rc.main} strokeWidth={1.6} />,
      label(left ? x - 6 : x + 6, ty, text, left ? 'end' : 'start', p.end ? tone(p.v) : rc.secondary, p.end),
    ];
  });
}

function drawPrice(c: PriceChart, w: number, h: number, fontScale: number, clipId: string, full: boolean): ReactElement[] {
  const fr = priceFrame(c, w, h, fontScale, full);
  const { R, top, mainB, subTop, axisY, main, sub, tick, tag } = fr;
  const n = c.dates.length;
  const X = (i: number) => xAt(i, n, L, R);
  const xs = c.dates.map((_, i) => X(i));
  const Y = main.y;
  const ys = (s: (number | null)[]) => s.map(v => (v == null ? null : Y(v)));
  const bands = bandsOf(c.dates, c.focus, X, R);
  // 各段区间的最后一天：两段首尾相接时，后一段的基数那天不再单独画点、写数
  const ends = new Set((c.focus ?? []).map(f => f.to));
  const last = c.close[n - 1];
  const lastY = Y(last);
  const th = tick + 6;
  const tagY = Math.max(top - 3, Math.min(mainB - th / 2, lastY - th / 2));
  const points = (c.marks ?? []).filter(m => m.kind === 'point');
  const out: ReactElement[] = [
    ...clipDefs(clipId, bands, h),
    ...bandLayer(bands, top - 3, axisY),
    ...main.ticks.map(t => <Line key={'gy' + t} x1={L} x2={R} y1={Y(t)} y2={Y(t)} stroke={rc.grid} strokeWidth={GRID} />),
    ...timeGrid(c.dates, X, top, axisY, tick),
    // 标注日：整列一条锈红虚线，横轴上写日期
    ...points.flatMap(m => {
      const i = c.dates.indexOf(m.date);
      return i < 0 ? [] : [<Line key={'pg' + m.date} x1={X(i)} x2={X(i)} y1={top} y2={axisY} stroke={rc.accent} strokeOpacity={0.55} strokeWidth={1} strokeDasharray="2,3" />];
    }),
    ...emphasis('main', bands, clipId, focus => [
      ...(c.band
        ? [
            <Path key="bu" d={linePath(xs, ys(c.band.upper))} stroke={rc.bandLine} strokeWidth={1} strokeDasharray="3,2" fill="none" />,
            <Path key="bl" d={linePath(xs, ys(c.band.lower))} stroke={rc.bandLine} strokeWidth={1} strokeDasharray="3,2" fill="none" />,
          ]
        : []),
      ...(c.ma ? [<Path key="ma" d={linePath(xs, ys(c.ma.values))} stroke={rc.maLine} strokeWidth={1.2} fill="none" />] : []),
      <Path key="close" d={linePath(xs, c.close.map(Y))} stroke={rc.main} strokeWidth={focus ? 2.4 : 1.6} strokeLinejoin="round" fill="none" />,
    ]),
  ];
  if (c.sub && sub) {
    const kind = c.sub.kind;
    const vals = c.sub.values;
    const S = sub.y;
    const bw = Math.max(1, (R - L) / n - 0.6);
    out.push(
      <SvgText key="subT" x={L} y={subTop - 5} fontSize={tick} fill={rc.secondary}>
        {SUB_NAME[kind] + (kind === 'rsi14' ? '：70 以上超买，30 以下超卖' : '')}
      </SvgText>,
      ...sub.lines.map(l => <Line key={'sl' + l.v} x1={L} x2={R} y1={S(l.v)} y2={S(l.v)} stroke={l.dashed ? rc.bench : rc.grid} strokeOpacity={l.dashed ? 0.6 : 1} strokeWidth={l.dashed ? 1 : GRID} strokeDasharray={l.dashed ? '3,3' : undefined} />),
      ...sub.ticks.map(t => <Line key={'st' + t} x1={L} x2={R} y1={S(t)} y2={S(t)} stroke={rc.grid} strokeWidth={GRID} />),
      ...emphasis('sub', bands, clipId, () => {
        if (kind === 'mom20' || kind === 'mom60' || kind === 'volume') {
          return vals.flatMap((v, i) => {
            if (v == null) {
              return [];
            }
            const up = kind === 'volume' ? i === 0 || c.close[i] >= c.close[i - 1] : v >= 0;
            return [
              <Rect
                key={'s' + i}
                x={xs[i] - bw / 2}
                y={Math.min(S(0), S(v))}
                width={bw}
                height={Math.max(0.6, Math.abs(S(v) - S(0)))}
                fill={up ? color.up : color.down}
                fillOpacity={0.6}
              />,
            ];
          });
        }
        if (kind === 'dd') {
          const d = linePath(xs, vals.map(v => (v == null ? null : S(v))));
          const first = vals.findIndex(v => v != null);
          const lastI = vals.length - 1 - [...vals].reverse().findIndex(v => v != null);
          return first < 0
            ? []
            : [
                <Path key="dda" d={d + 'L' + xs[lastI].toFixed(1) + ',' + S(0).toFixed(1) + 'L' + xs[first].toFixed(1) + ',' + S(0).toFixed(1) + 'Z'} fill={color.down} fillOpacity={0.16} />,
                <Path key="ddl" d={d} stroke={color.down} strokeWidth={1.2} fill="none" />,
              ];
        }
        return [<Path key="sline" d={linePath(xs, vals.map(v => (v == null ? null : S(v))))} stroke={rc.main} strokeWidth={1.3} fill="none" />];
      }),
      ...sub.ticks.map(t => yLabel('sy' + t, w, S(t), sub.fmt(t), tick)),
      ...sub.lines.filter(l => l.text).map(l => yLabel('sly' + l.v, w, S(l.v), l.text, tick)),
      ...bands.flatMap((b, k) => subMeasure(c, b, k, X, S, subTop, axisY, R, tag, ends)),
    );
  }
  out.push(...bands.flatMap((b, k) => measure(c, b, k, X, Y, top, mainB, R, tag, ends)));
  // 标注点：标注日只写事件（日期在横轴上），极值写数值；挨得近的上下错开
  const placed: { x1: number; x2: number; y: number }[] = [];
  for (const m of c.marks ?? []) {
    const i = c.dates.indexOf(m.date);
    if (i < 0) {
      continue;
    }
    const x = X(i);
    const y = Y(c.close[i]);
    const text = m.label;
    const lw = labelWidth(text, tag);
    const right = x + 7 + lw > R;
    const lx1 = right ? x - 7 - lw : x + 7;
    const at = (below: boolean) => Math.max(top + tag - 2, Math.min(mainB - 3, below ? y + tag + 4 : y - 7));
    let below = m.below ?? y < top + (mainB - top) * 0.35;
    if (placed.some(p => p.x1 < lx1 + lw && lx1 < p.x2 && Math.abs(p.y - at(below)) < tag + 2)) {
      below = !below;
    }
    placed.push({ x1: lx1, x2: lx1 + lw, y: at(below) });
    out.push(
      <Circle key={'m' + m.date + m.label} cx={x} cy={y} r={3.6} fill={rc.accent} stroke={rc.paper} strokeWidth={1.4} />,
      ...(text ? [label(right ? x - 7 : x + 7, at(below), text, right ? 'end' : 'start', rc.accent, m.kind === 'point')] : []),
    );
  }
  // 刻度栏：价格刻度（和最新价标签挤的不写）、最新价
  out.push(
    ...main.ticks.filter(t => Math.abs(Y(t) - (tagY + th / 2)) >= th * 0.9).map(t => yLabel('y' + t, w, Y(t), t.toFixed(main.dp), tick)),
    <Circle key="lastDot" cx={X(n - 1)} cy={lastY} r={2.6} fill={rc.main} />,
    <Rect key="lastBg" x={R + 3} y={tagY} width={w - R - 4} height={th} rx={3} fill={rc.main} />,
    yLabel('lastT', w, tagY + th / 2, last.toFixed(2), tick, '#FFFFFF'),
    ...timeAxis(c.dates, X, R, axisY, w, tick, bands, pinnedOf(c.dates, c.focus, c.marks, X)),
    ...pills(bands, w, top, tag, f => focusStats(c, f)?.change ?? null),
  );
  return out;
}

/**
 * 对比图的区间读数：区间最后一天每条线一个点，旁边用线的颜色写这一只的区间涨跌（和图下读数同一份数）；
 * 挨得近的上下错开。几条线从同一点出发的那天（= 100 的那天）画一个空心点。
 */
function compareMeasure(c: CompareChart, b: Band, k: number, X: (i: number) => number, Y: (v: number) => number, top: number, bottom: number, R: number, tag: number): ReactElement[] {
  const r = compareFocus(c, b.f);
  if (!r) {
    return [];
  }
  const e = r.span.b;
  const items = r.series.map((s, j) => ({ j, y: Y(c.series[j].values[e]), text: pct(s.change, 2), ty: 0 }));
  const outside = b.x2 + 6 + Math.max(...items.map(t => labelWidth(t.text, tag))) <= R;
  const lx = outside ? b.x2 + 5 : b.x2 - 5;
  const sorted = [...items].sort((p, q) => p.y - q.y);
  let prev = -Infinity;
  for (const t of sorted) {
    t.ty = Math.max(top + tag, t.y + tag * 0.36, prev + tag + 1);
    prev = t.ty;
  }
  const over = prev - (bottom - 2);
  if (over > 0) {
    sorted.forEach(t => (t.ty -= over));
  }
  const color0 = (j: number) => SERIES_COLORS[j % SERIES_COLORS.length];
  return [
    ...(c.base === c.dates[r.span.k] ? [<Circle key={'cb' + k} cx={X(r.span.k)} cy={Y(100)} r={3.4} fill={rc.paper} stroke={rc.secondary} strokeWidth={1.6} />] : []),
    ...items.flatMap(t => [
      <Circle key={'ce' + k + ':' + t.j} cx={X(e)} cy={t.y} r={3} fill={color0(t.j)} stroke={rc.paper} strokeWidth={1.2} />,
      label(lx, t.ty, t.text, outside ? 'start' : 'end', color0(t.j), true),
    ]),
  ];
}

function drawCompare(c: CompareChart, w: number, h: number, fontScale: number, clipId: string, full: boolean): ReactElement[] {
  const fr = compareFrame(c, w, h, fontScale, full);
  const { R, top, axisY, main, tick, tag } = fr;
  const n = c.dates.length;
  const X = (i: number) => xAt(i, n, L, R);
  const xs = c.dates.map((_, i) => X(i));
  const Y = main.y;
  const bands = bandsOf(c.dates, c.focus, X, R);
  return [
    ...clipDefs(clipId, bands, h),
    ...bandLayer(bands, top - 3, axisY),
    ...main.ticks.map(t => <Line key={'gy' + t} x1={L} x2={R} y1={Y(t)} y2={Y(t)} stroke={rc.grid} strokeWidth={GRID} />),
    ...timeGrid(c.dates, X, top, axisY, tick),
    <Line key="base" x1={L} x2={R} y1={Y(100)} y2={Y(100)} stroke={rc.bench} strokeOpacity={0.6} strokeDasharray="3,3" />,
    ...emphasis('series', bands, clipId, focus =>
      c.series.map((s, k) => <Path key={s.code} d={linePath(xs, s.values.map(Y))} stroke={SERIES_COLORS[k % SERIES_COLORS.length]} strokeWidth={focus ? 2.2 : 1.5} strokeLinejoin="round" fill="none" />),
    ),
    ...bands.flatMap((b, k) => compareMeasure(c, b, k, X, Y, top, axisY, R, tag)),
    ...c.series.map((s, k) => <Circle key={'end' + s.code} cx={X(n - 1)} cy={Y(s.values[n - 1])} r={2.6} fill={SERIES_COLORS[k % SERIES_COLORS.length]} />),
    ...main.ticks.map(t => yLabel('y' + t, w, Y(t), t.toFixed(main.dp), tick, t === 100 ? rc.secondary : rc.muted)),
    ...timeAxis(c.dates, X, R, axisY, w, tick, bands, pinnedOf(c.dates, c.focus, undefined, X)),
    ...pills(bands, w, top, tag, () => null),
  ];
}

/**
 * 钉住的小图（读讲解时盖在页面顶部的步骤栏上，约 70dp 高）：主图的线（区间外淡、区间里粗）、黄色区间、区间两端的空心点、
 * 标注点、两三个整刻度和横轴（区间起止日、标注日优先）。价格图的区间名和涨跌写在外面的标题行里；对比图每只的区间涨跌
 * 照样写在区间右缘。见 docs/design/ai-lecture-charts.md §2.9。
 */
function drawMini(c: PriceChart | CompareChart, w: number, h: number, fontScale: number, clipId: string): ReactElement[] {
  const tick = TICK * fontScale;
  const tag = FONT * fontScale;
  const top = 6;
  const axisY = h - (tick + 9);
  const n = c.dates.length;
  const lines = c.kind === 'price' ? [c.close] : c.series.map(s => s.values);
  const [lo, hi] = bounds(lines, c.kind === 'compare' ? [100] : []);
  const main = scaleOf(lo, hi, top, axisY - 3, 3);
  const R = w - Math.ceil(Math.max(...main.ticks.map(t => labelWidth(t.toFixed(main.dp), tick)))) - 8;
  const X = (i: number) => xAt(i, n, L, R);
  const xs = c.dates.map((_, i) => X(i));
  const Y = main.y;
  const bands = bandsOf(c.dates, c.focus, X, R);
  const ink = (k: number) => (c.kind === 'price' ? rc.main : SERIES_COLORS[k % SERIES_COLORS.length]);
  const out: ReactElement[] = [
    ...clipDefs(clipId, bands, h),
    ...bandLayer(bands, top - 3, axisY),
    ...main.ticks.map(t => <Line key={'gy' + t} x1={L} x2={R} y1={Y(t)} y2={Y(t)} stroke={rc.grid} strokeWidth={GRID} />),
    ...(c.kind === 'compare' ? [<Line key="base" x1={L} x2={R} y1={Y(100)} y2={Y(100)} stroke={rc.bench} strokeOpacity={0.6} strokeDasharray="3,3" />] : []),
    ...emphasis('mini', bands, clipId, focus =>
      lines.map((v, k) => <Path key={'l' + k} d={linePath(xs, v.map(Y))} stroke={ink(k)} strokeWidth={focus ? 2.2 : 1.4} strokeLinejoin="round" fill="none" />),
    ),
  ];
  if (c.kind === 'price') {
    // 区间两端（前收那天、区间最后一天）：两段首尾相接时交界那天只画一个点
    const ends = new Set((c.focus ?? []).map(f => f.to));
    bands.forEach((b, k) => {
      const st = focusStats(c, b.f);
      if (st) {
        out.push(
          ...(st.k < st.a && !ends.has(st.baseDate) ? [<Circle key={'nb' + k} cx={X(st.k)} cy={Y(st.base)} r={2.8} fill={rc.paper} stroke={rc.main} strokeWidth={1.5} />] : []),
          <Circle key={'ne' + k} cx={X(st.b)} cy={Y(st.last)} r={2.8} fill={rc.paper} stroke={rc.main} strokeWidth={1.5} />,
        );
      }
    });
    for (const m of c.marks ?? []) {
      const i = c.dates.indexOf(m.date);
      if (i >= 0) {
        out.push(<Circle key={'nm' + m.date} cx={X(i)} cy={Y(c.close[i])} r={3} fill={rc.accent} stroke={rc.paper} strokeWidth={1.2} />);
      }
    }
  } else {
    out.push(...bands.flatMap((b, k) => compareMeasure(c, b, k, X, Y, top, axisY, R, tag)));
  }
  out.push(
    ...main.ticks.map(t => yLabel('y' + t, w, Y(t), t.toFixed(main.dp), tick, c.kind === 'compare' && t === 100 ? rc.secondary : rc.muted)),
    ...timeAxis(c.dates, X, R, axisY, w, tick, bands, pinnedOf(c.dates, c.focus, c.kind === 'price' ? c.marks : undefined, X)),
  );
  return out;
}
