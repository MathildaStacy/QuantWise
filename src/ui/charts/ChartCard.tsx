/**
 * 对话里的图表卡片：标题、「真实行情」标签、看点、图、点图或按住拖动看某一天的读数（讲解里可以带着这一天去提问）、重点区间读数、图例、口径、
 * 「怎么看」读图说明，「全屏」看大图和数据表。
 * 区间读数和发给 AI 的工具摘要是同一份数（quant/charts.ts 的 focusStats），见 docs/design/ai-lecture-charts.md §2.3。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Maximize2, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  chartTitle,
  compareFocus,
  dateRange,
  fmtSub,
  focusStats,
  md,
  pct,
  SUB_NAME,
  type ChartData,
  type CompareChart,
  type Focus,
  type PriceChart,
} from '../../quant/charts';
import { FACTORS } from '../../quant/factors';
import { UNIVERSE_NAME, type UniverseId } from '../../quant/universe';
import type { RootStackParamList } from '../navigation/types';
import { groupColor, rc, SERIES_COLORS } from '../readTheme';
import { color, num } from '../theme';
import { QuantChart } from './QuantChart';
import { howToRead, readout } from './quantDraw';

export function legendOf(c: ChartData): { color: string; label: string; dashed?: boolean }[] {
  switch (c.kind) {
    case 'price':
      // 副图在图里自带名字，图例只说主图的线
      return [
        { color: rc.main, label: '收盘（前复权，元）' },
        ...(c.ma ? [{ color: rc.maLine, label: 'MA' + c.ma.n }] : []),
        ...(c.band ? [{ color: rc.bandLine, label: '布林带', dashed: true }] : []),
      ];
    case 'compare':
      return c.series.map((s, k) => ({ color: SERIES_COLORS[k % SERIES_COLORS.length], label: s.name }));
    case 'factor':
      return [
        ...c.groups.map((_, k) => ({ color: groupColor(k, c.groups.length), dashed: k === 0, label: 'Q' + (k + 1) + (k === 0 ? ' 因子最低' : k === c.groups.length - 1 ? ' 因子最高' : '') })),
        { color: rc.bench, label: '等权基准', dashed: true },
        { color: rc.accent, label: '多空', dashed: true },
      ];
    case 'ic':
      return [
        { color: '#C7533A', label: 'IC > 0' },
        { color: '#3E7C5A', label: 'IC < 0' },
        { color: rc.ink, label: '累计 IC', dashed: true },
      ];
    case 'groups':
      return [];
  }
}

export function chartFoot(c: ChartData): string {
  switch (c.kind) {
    case 'price':
      return c.code + ' · ' + dateRange(c.dates) + ' · 前复权日线 · 腾讯行情';
    case 'compare':
      return (c.base ? md(c.base) + ' 收盘 = 100' : '起点 = 100') + ' · ' + dateRange(c.dates) + ' · 前复权日线';
    case 'factor':
      return (UNIVERSE_NAME[c.universe as UniverseId] ?? c.universe) + ' · ' + (c.dates.length - 1) + ' 期 · ' + (FACTORS[c.factor].approx ? '近似因子 · ' : '') + '当前成分';
    case 'ic': {
      const m = c.ic.reduce((a, b) => a + b, 0) / Math.max(1, c.ic.length);
      return c.ic.length + ' 期 · 均值 ' + (m > 0 ? '+' : '') + m.toFixed(3);
    }
    case 'groups':
      return '从左到右因子值从低到高';
  }
}

const dotColor = (l: { color: string; dashed?: boolean }) => ({ backgroundColor: l.dashed ? 'transparent' : l.color, borderColor: l.color });
const tone = (v: number) => ({ color: v > 0 ? color.upText : v < 0 ? color.downText : rc.ink });
const span = (f: Focus) => (f.from === f.to ? md(f.from) : md(f.from) + '–' + md(f.to));

/** 一段重点区间的读数：区间名、日期、交易日数、区间涨跌；收盘从哪到哪；副图从哪到哪。full 时加区间最高最低。 */
function PriceFocus({ c, f, full }: { c: PriceChart; f: Focus; full: boolean }) {
  const st = focusStats(c, f);
  if (!st) {
    return null;
  }
  const sub = c.sub && st.sub?.from != null && st.sub.to != null ? SUB_NAME[c.sub.kind] + ' ' + fmtSub(c.sub.kind, st.sub.from) + ' → ' + fmtSub(c.sub.kind, st.sub.to) : null;
  return (
    <View style={s.focus}>
      <View style={s.focusHead}>
        <Text style={s.focusT}>{st.label + ' · ' + span(f) + ' · ' + st.days + ' 个交易日'}</Text>
        <Text style={[s.focusV, num, tone(st.change)]}>{pct(st.change, 2)}</Text>
      </View>
      <Text style={[s.focusL, num]}>
        {(st.k < st.a ? '收盘 ' : '首日收盘 ') + st.base.toFixed(2) + '（' + md(st.baseDate) + (st.k < st.a ? '' : '，图里最早一天') + '）→ ' + st.last.toFixed(2) + '（' + md(st.to) + '）'}
      </Text>
      {sub ? <Text style={[s.focusL, num]}>{sub}</Text> : null}
      {full ? (
        <Text style={[s.focusL, num]}>
          {'区间最高收盘 ' + st.hi.toFixed(2) + '（' + md(st.hiDate) + '）· 最低 ' + st.lo.toFixed(2) + '（' + md(st.loDate) + '）'}
        </Text>
      ) : null}
    </View>
  );
}

function CompareFocus({ c, f }: { c: CompareChart; f: Focus }) {
  const r = compareFocus(c, f);
  if (!r) {
    return null;
  }
  return (
    <View style={s.focus}>
      <Text style={s.focusT}>{f.label + ' · ' + span(f) + ' · ' + (r.span.b - r.span.a + 1) + ' 个交易日'}</Text>
      <Text style={[s.focusL, num]}>
        {r.series.map((x, k) => (
          <Text key={x.name}>
            {(k ? ' · ' : '') + x.name + ' '}
            <Text style={tone(x.change)}>{pct(x.change, 2)}</Text>
          </Text>
        ))}
      </Text>
    </View>
  );
}

/** 图下面的区间读数（卡片和全屏共用）。 */
export function FocusReadout({ data, full = false }: { data: ChartData; full?: boolean }) {
  if (data.kind === 'price' && data.focus?.length) {
    return <View style={s.focusBox}>{data.focus.map(f => <PriceFocus key={f.from + f.to} c={data} f={f} full={full} />)}</View>;
  }
  if (data.kind === 'compare' && data.focus?.length) {
    return <View style={s.focusBox}>{data.focus.map(f => <CompareFocus key={f.from + f.to} c={data} f={f} />)}</View>;
  }
  return null;
}

/** AI 写的一句看点（和图上的真实数据分开：前面一个「看点」小字）。 */
export function Takeaway({ data }: { data: ChartData }) {
  const t = data.kind === 'price' || data.kind === 'compare' ? data.takeaway : undefined;
  return t ? (
    <Text style={s.take}>
      <Text style={s.takeK}>看点  </Text>
      {t}
    </Text>
  ) : null;
}

export function ChartCard({ data, onBox, onAsk }: {
  data: ChartData;
  onBox?: (box: { y: number; h: number } | null) => void;
  /** 讲解里：把点中的那一天（图名 + 读数）带到输入框，接着写问题。 */
  onAsk?: (text: string) => void;
}) {
  const [extremes, setExtremes] = useState(false);
  const [guide, setGuide] = useState(false);
  // 点一下或按住拖动看某一天：十字线画在卡片里，读数写在图下（拖动时图顶另有读数牌），不用跳全屏（各组收益图没有日期，不点）
  const [pick, setPick] = useState<number | null>(null);
  const inspect = data.kind !== 'groups';
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const open = () => nav.navigate('ChartFull', { chart: data });
  // 讲解页要知道画线区域在哪（滚过去之后钉一张小图，ChartPin）：卡片在外面的位置 + 图在卡片里的位置；卸下时报 null
  const at = useRef({ card: -1, plot: -1, h: 0 });
  const boxRef = useRef(onBox);
  boxRef.current = onBox;
  useEffect(() => () => boxRef.current?.(null), []);
  const report = () => at.current.card >= 0 && at.current.plot >= 0 && boxRef.current?.({ y: at.current.card + at.current.plot, h: at.current.h });
  return (
    <View style={s.card} onLayout={onBox ? e => { at.current.card = e.nativeEvent.layout.y; report(); } : undefined}>
      <View style={s.head}>
        <Text style={s.title}>
          {chartTitle(data)}
        </Text>
        <Text style={s.tag}>真实行情</Text>
      </View>
      <Takeaway data={data} />
      <View style={s.plot} onLayout={onBox ? e => { at.current.plot = e.nativeEvent.layout.y; at.current.h = e.nativeEvent.layout.height; report(); } : undefined}>
        <QuantChart data={data} extremes={extremes} pick={pick} onPick={inspect ? setPick : undefined} />
      </View>
      {inspect ? (
        <View style={s.pick}>
          {pick != null ? (
            <>
              <Text style={[s.pickT, num]}>{readout(data, pick)}</Text>
              {onAsk ? <Pressable style={s.ask} onPress={() => onAsk('看图中这一天：' + chartTitle(data) + '，' + readout(data, pick) + '。')} accessibilityRole="button" accessibilityLabel="就这一天提问">
                <Text style={s.fullT}>问这一天</Text>
              </Pressable> : null}
              <Pressable onPress={() => setPick(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="收起这一天的读数">
                <X size={15} color={rc.muted} />
              </Pressable>
            </>
          ) : (
            <Text style={s.hint}>点一下或按住拖动，看每一天的数</Text>
          )}
        </View>
      ) : null}
      {data.kind === 'factor' ? <Pressable style={s.focusBtn} onPress={() => setExtremes(v => !v)} accessibilityRole="button" accessibilityState={{ selected: extremes }}><Text style={s.fullT}>{extremes ? '显示全部分组' : '只看最高与最低组'}</Text></Pressable> : null}
      <FocusReadout data={data} />
      <View style={s.legend}>
        {legendOf(data).filter(l => !extremes || data.kind !== 'factor' || !/^Q\d/.test(l.label) || l.label.startsWith('Q1 ') || l.label.startsWith('Q' + data.groups.length + ' ')).map(l => (
          <View key={l.label} style={s.li}>
            <View style={[s.dot, dotColor(l), l.dashed && s.dash]} />
            <Text style={s.lt}>{l.label}</Text>
          </View>
        ))}
      </View>
      <View style={s.foot}>
        <Text style={s.ft}>
          {chartFoot(data)}
        </Text>
        <Pressable onPress={() => setGuide(v => !v)} accessibilityRole="button" accessibilityLabel="怎么看这张图" accessibilityState={{ expanded: guide }} style={s.full}>
          <Text style={s.fullT}>怎么看</Text>
        </Pressable>
        <Pressable onPress={open} hitSlop={8} accessibilityRole="button" accessibilityLabel="全屏查看图表" style={s.full}>
          <Maximize2 size={13} color={rc.main} />
          <Text style={s.fullT}>全屏</Text>
        </Pressable>
      </View>
      {guide ? <View style={s.guide}>
        {howToRead(data).map(line => <Text key={line} style={s.guideT}>{'· ' + line}</Text>)}
      </View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginVertical: 10, borderRadius: 12, backgroundColor: rc.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2, gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '600', color: rc.ink },
  tag: { fontSize: 11, color: rc.realInk, backgroundColor: rc.real, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  take: { paddingHorizontal: 12, paddingTop: 2, fontSize: 14, lineHeight: 21, color: rc.ink },
  takeK: { fontSize: 12, color: rc.focusInk, fontWeight: '600' },
  plot: { paddingHorizontal: 6, paddingTop: 6 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 2 },
  pickT: { flex: 1, fontSize: 12, lineHeight: 18, color: rc.ink },
  ask: { minHeight: 48, justifyContent: 'center' },
  guide: { paddingHorizontal: 12, paddingBottom: 10, gap: 4 },
  guideT: { fontSize: 13, lineHeight: 20, color: rc.secondary },
  hint: { fontSize: 12, lineHeight: 18, color: rc.muted },
  focusBox: { paddingHorizontal: 12, paddingTop: 6, gap: 8 },
  focus: { borderLeftWidth: 3, borderLeftColor: rc.focusEdge, paddingLeft: 8, gap: 1 },
  focusHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  focusT: { flex: 1, fontSize: 13, lineHeight: 20, fontWeight: '600', color: rc.ink },
  focusV: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  focusL: { fontSize: 12, lineHeight: 18, color: rc.secondary },
  legend: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingTop: 8, gap: 10, rowGap: 2 },
  li: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 10, height: 3, borderRadius: 2, borderWidth: 0 },
  dash: { height: 0, borderTopWidth: 2, borderStyle: 'dashed' },
  lt: { fontSize: 12, color: rc.secondary },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 2, paddingBottom: 4, gap: 8 },
  ft: { flex: 1, fontSize: 12, color: rc.muted },
  focusBtn: { minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' },
  full: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', gap: 3 },
  fullT: { fontSize: 12, color: rc.main },
});
