/**
 * 对话里的图表卡片：标题、「真实行情」（因子检验的图是「历史回测」）标签、看点、图、点图或按住拖动看某一天的读数（讲解里可以带着这一天去提问）、
 * 重点区间读数、图例、口径、「怎么看」读图说明，「全屏」看大图和数据表。
 * 区间读数和发给 AI 的工具摘要是同一份数（quant/charts.ts 的 focusStats），见 docs/design/ai-lecture-charts.md §2.3。
 * 讲解和助手里一次 factor_test 的三张图合成一张结果卡（FactorResult.tsx），这里的图例、页脚、小表它也用。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Maximize2, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  chartTitle,
  compareFocus,
  dateRange,
  drawnTime,
  factorBasis,
  factorStatsLine,
  fmtSub,
  focusStats,
  groupScale,
  icSummary,
  liveStale,
  md,
  pct,
  shapeRho,
  SUB_NAME,
  type ChartData,
  type CompareChart,
  type FactorStats,
  type Focus,
  type GroupsChart,
  type LabelsChart,
  type PriceChart,
} from '../../quant/charts';
import { beijingNow, type BeijingNow } from '../../market/clock';
import { FACTORS } from '../../quant/factors';
import { eventLine, labelVerdict, MIN_TRAIN, type LabelHit } from '../../quant/labels';
import { UNIVERSE_NAME, type UniverseId } from '../../quant/universe';
import type { RootStackParamList } from '../navigation/types';
import { groupColor, rc, SERIES_COLORS } from '../readTheme';
import { color, num } from '../theme';
import { barLabelsFit, QuantChart } from './QuantChart';
import { howToRead, readout } from './quantDraw';

export interface LegendItem {
  color: string;
  label: string;
  dashed?: boolean;
  /** band：一块浅色（IC 的噪声带）；dot：空心点（书里的数）；note：只有一行说明文字。 */
  kind?: 'band' | 'dot' | 'note';
  /** 用这个字代替色块（元标签图的三角）。 */
  glyph?: string;
}

/** 图例。分组净值图 extremes 时只列最低、最高两组（和图上画的一致）。 */
export function legendOf(c: ChartData, extremes = false): LegendItem[] {
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
    case 'factor': {
      const G = c.groups.length;
      return [
        ...c.groups.flatMap((_, k) => (extremes && k > 0 && k < G - 1 ? [] : [{ color: groupColor(k, G), dashed: k === 0, label: 'Q' + (k + 1) + (k === 0 ? ' 因子最低' : k === G - 1 ? ' 因子最高' : '') }])),
        { color: rc.bench, label: '全池等权基准', dashed: true },
        { color: rc.accent, label: '多空（最高 − 最低）', dashed: true },
      ];
    }
    case 'ic':
      return [
        { color: '#C7533A', label: 'IC > 0' },
        { color: '#3E7C5A', label: 'IC < 0' },
        { color: rc.ink, label: '累计 IC（右侧刻度）', dashed: true },
        ...(c.noise ? [{ color: rc.ink, label: '没有预测力时约 95% 在这里' + (c.stats?.avgStocks ? '（每期 ' + c.stats.avgStocks + ' 只）' : ''), kind: 'band' as const }] : []),
      ];
    case 'groups':
      return c.book && groupScale(c).book
        ? [
            { color: groupColor(c.means.length - 1, c.means.length), label: '本次（' + (groupScale(c).unit === 'monthly' ? '折成月均' : '折成年化') + '）' },
            { color: rc.book, label: '书中 ' + c.book.label + (c.book.merged ? '（' + c.book.merged + '）' : ''), kind: 'dot' },
          ]
        : [];
    case 'labels': {
      const g = c.stats.side === 'both' ? '▲▼' : '▲';
      return [
        { color: rc.main, label: '收盘' },
        { color: rc.maLine, label: 'MA' + c.stats.fast },
        { color: rc.slowLine, label: 'MA' + c.stats.slow, dashed: true },
        { color: color.up, label: '赚了', glyph: g },
        { color: color.down, label: '亏了', glyph: g },
        { color: rc.muted, label: '还没结果', glyph: g },
        { color: rc.muted, label: '实心：次级模型放行 · 空心：没放行 · 淡色：预热', kind: 'note' },
      ];
    }
  }
}

/** 股票池的短名：「示例池」「中证 1000」。 */
export const poolShort = (c: { universe: string; stats?: FactorStats }) =>
  (UNIVERSE_NAME[c.universe as UniverseId] ?? c.stats?.universe ?? c.universe).replace(/（.*）$/, '');

/** 盘中画的图：写画图时刻、注明之后没有更新（旧图只记了日期）。 */
const liveFoot = (c: PriceChart | CompareChart) =>
  c.live ? (c.drawnAt ? ' · ' + drawnTime(c) + ' 盘中画，之后没有更新' : ' · ' + md(c.live) + ' 为盘中价，之后没有更新') : '';

export function chartFoot(c: ChartData): string {
  switch (c.kind) {
    case 'price':
      return c.code + ' · ' + dateRange(c.dates) + ' · 前复权日线 · 腾讯行情' + liveFoot(c);
    case 'compare':
      return (c.base ? md(c.base) + ' 收盘 = 100' : '起点 = 100') + ' · ' + dateRange(c.dates) + ' · 前复权日线' + liveFoot(c);
    case 'factor':
      return [
        poolShort(c),
        ...(c.stats ? [factorBasis(c.stats)] : []),
        c.dates.length - 1 + ' 期',
        ...(FACTORS[c.factor].approx ? ['近似因子'] : []),
        '当前成分',
      ].join(' · ');
    case 'ic': {
      const s = icSummary(c);
      return s.n + ' 期 · 均值 ' + (s.mean > 0 ? '+' : '') + s.mean.toFixed(3) + '（t ' + s.t.toFixed(2) + '）· 为正 ' + s.positive + '/' + s.n;
    }
    case 'groups':
      return (c.stats ? factorBasis(c.stats) + ' · ' : '') + '从左到右因子值从低到高';
    case 'labels':
      return c.code + ' · 图 ' + dateRange(c.dates) + ' · 统计用 ' + c.stats.from.slice(0, 4) + ' 年起 ' + c.stats.bars + ' 根日线 · 按收盘价 · 不扣成本';
  }
}

/** 第二行：多空和 IC（分组净值图）。 */
export const chartStats = (c: ChartData) => (c.kind === 'factor' && c.stats ? factorStatsLine(c.stats) : null);

/** 「历史回测」还是「真实行情」：因子检验的三张图是按今天的成分回测出来的。 */
export const chartTag = (c: ChartData) => (c.kind === 'price' || c.kind === 'compare' ? '真实行情' : '历史回测');

const dotColor = (l: LegendItem) =>
  l.kind === 'band'
    ? { backgroundColor: l.color, opacity: 0.18, height: 8, width: 14, borderRadius: 1 }
    : l.kind === 'dot'
    ? { backgroundColor: rc.paper, borderColor: l.color, borderWidth: 2, width: 8, height: 8, borderRadius: 4 }
    : { backgroundColor: l.dashed ? 'transparent' : l.color, borderColor: l.color };

export function Legend({ items }: { items: LegendItem[] }) {
  return items.length ? (
    <View style={s.legend}>
      {items.map(l => (
        <View key={l.label} style={s.li}>
          {l.kind === 'note' ? null : l.glyph ? <Text style={[s.glyph, { color: l.color }]}>{l.glyph}</Text> : <View style={[s.dot, l.dashed && s.dash, dotColor(l)]} />}
          <Text style={s.lt}>{l.label}</Text>
        </View>
      ))}
    </View>
  ) : null;
}

/** 点中某一期时的读数。分组净值写成「● Q1 1.044」，颜色和图上的线一样（extremes 时只写最低、最高两组）。 */
export function PickText({ data, i, extremes = false }: { data: ChartData; i: number; extremes?: boolean }) {
  if (data.kind !== 'factor') {
    return <Text style={[s.pickT, num]}>{readout(data, i)}</Text>;
  }
  const G = data.groups.length;
  const items = [
    ...data.groups.flatMap((g, k) => (extremes && k > 0 && k < G - 1 ? [] : [{ color: groupColor(k, G), text: 'Q' + (k + 1) + ' ' + g[i].toFixed(3) }])),
    { color: rc.bench, text: '基准 ' + data.bench[i].toFixed(3) },
    { color: rc.accent, text: '多空 ' + data.longShort[i].toFixed(3) },
  ];
  return (
    <Text style={[s.pickT, num]}>
      {data.dates[i]}
      {items.map(x => (
        <Text key={x.text}>
          {'  '}
          <Text style={{ color: x.color }}>●</Text>
          {' ' + x.text}
        </Text>
      ))}
    </Text>
  );
}

const pp = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2) + '%';

/**
 * 各组收益图下面：和书里的形状对照（两边的秩相关都由 App 算），柱子上写不下数或叠了书里的数时再加一张小表
 * （每 5 组一行：Q1…Q5，本次 / 书中）。
 */
export function GroupExtras({ data, width }: { data: GroupsChart; width: number }) {
  const { fontScale } = useWindowDimensions();
  const g = groupScale(data);
  const n = data.means.length;
  const table = !!data.book || (width > 0 && !barLabelsFit(width, n, fontScale));
  const unit = g.unit === 'monthly' ? '（月均）' : g.unit === 'annual' ? '（年化）' : '（每期）';
  const rows = [
    { name: '本次' + unit, values: g.ours },
    ...(data.book ? [{ name: g.book ? '书中' + unit : '书中（未注明单位）', values: data.book.values }] : []),
  ];
  const chunks = Array.from({ length: Math.ceil(n / 5) }, (_, k) => [k * 5, Math.min(n, k * 5 + 5)] as const);
  return (
    <View style={s.groupBox}>
      {data.book ? (
        <Text style={[s.shape, num]}>
          {'分组收益的形状（秩相关）：书中 ' + data.book.rho.toFixed(3) + '（' + data.book.raw.length + ' 组）· 本次 ' + shapeRho(data.means).toFixed(3) + '（' + n + ' 组）'}
        </Text>
      ) : null}
      {table
        ? chunks.map(([a, b]) => (
            <View key={a} style={s.gt}>
              <View style={s.gtRow}>
                <Text style={[s.gtName, s.gtHead]} />
                {Array.from({ length: b - a }, (_, k) => <Text key={k} style={[s.gtCell, s.gtHead]}>{'Q' + (a + k + 1)}</Text>)}
              </View>
              {rows.map(r => (
                <View key={r.name} style={s.gtRow}>
                  <Text style={s.gtName} numberOfLines={1}>{r.name}</Text>
                  {r.values.slice(a, b).map((v, k) => <Text key={k} style={[s.gtCell, num, tone(v)]}>{pp(v)}</Text>)}
                </View>
              ))}
            </View>
          ))
        : null}
    </View>
  );
}
const tone = (v: number) => ({ color: v > 0 ? color.upText : v < 0 ? color.downText : rc.ink });
const span = (f: Focus) => (f.from === f.to ? md(f.from) : md(f.from) + '–' + md(f.to));

/**
 * 一段重点区间的读数：区间名、日期、交易日数、区间涨跌；收盘从哪到哪；副图从哪到哪；区间最高最低（图上也标着）。
 * 卡片和全屏一样：回答里讲区间最高最低时，卡片上就读得到。
 */
function PriceFocus({ c, f }: { c: PriceChart; f: Focus }) {
  const st = focusStats(c, f);
  if (!st) {
    return null;
  }
  const b = c.bench?.changes[(c.focus ?? []).indexOf(f)];
  const excess = b != null ? (st.change - b) * 100 : null;
  const sub = c.sub && st.sub?.from != null && st.sub.to != null ? SUB_NAME[c.sub.kind] + ' ' + fmtSub(c.sub.kind, st.sub.from) + ' → ' + fmtSub(c.sub.kind, st.sub.to) : null;
  return (
    <View style={s.focus}>
      <View style={s.focusHead}>
        <Text style={s.focusT}>{st.label + ' · ' + span(f) + ' · ' + st.days + ' 个交易日'}</Text>
        <Text style={[s.focusV, num, tone(st.change)]}>{pct(st.change, 2)}</Text>
      </View>
      <Text style={[s.focusL, num]}>
        {(st.k < st.a ? '收盘 ' : '首日收盘 ') + st.base.toFixed(2) + '（' + md(st.baseDate) + (st.k < st.a ? '' : '，图里最早一天') + '）→ ' + st.last.toFixed(2) + '（' + md(st.to) + (c.live === st.to ? (c.drawnAt ? ' ' + c.drawnAt.slice(11, 16) : '') + '，盘中' : '') + '）'}
      </Text>
      {sub ? <Text style={[s.focusL, num]}>{sub}</Text> : null}
      {b != null && excess != null ? (
        <Text style={[s.focusL, num]}>
          {'同期' + c.bench!.name + ' '}<Text style={tone(b)}>{pct(b, 2)}</Text>{' · 超额 '}<Text style={tone(excess)}>{(excess >= 0 ? '+' : '') + excess.toFixed(2) + ' 个百分点'}</Text>
        </Text>
      ) : null}
      <Text style={[s.focusL, num]}>
        {'区间最高收盘 ' + st.hi.toFixed(2) + '（' + md(st.hiDate) + '）· 最低 ' + st.lo.toFixed(2) + '（' + md(st.loDate) + '）'}
      </Text>
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
export function FocusReadout({ data }: { data: ChartData }) {
  if (data.kind === 'price' && data.focus?.length) {
    return <View style={s.focusBox}>{data.focus.map(f => <PriceFocus key={f.from + f.to} c={data} f={f} />)}</View>;
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

/** 图下的操作提示：一问只写一次（hint），点中某一天后写读数。 */
export const pickHint = (c: ChartData) =>
  c.kind === 'labels' ? '点图上的三角，看那一次信号的三道屏障' : '点一下或按住拖动，看' + (c.kind === 'ic' ? '每一期' : '每一天') + '的数';

/**
 * 元标签图下面：「全部跟主信号」和「只做次级模型放行的」两行对比（次数、命中率、平均每次），一句结论；
 * 没点图时再写一行框出的那次（最近一次）信号。
 */
export function LabelExtras({ data, pick }: { data: LabelsChart; pick: number | null }) {
  const st = data.stats;
  const last = data.events[data.events.length - 1];
  const rate = (h: LabelHit) => (h.n ? ((h.hits / h.n) * 100).toFixed(1) + '%' : '—');
  const rows = [
    { name: '全部跟主信号', h: st.all },
    { name: '只做放行的', h: st.taken },
  ];
  return (
    <View style={s.groupBox}>
      {st.all.n ? (
        <View style={s.gt}>
          <View style={s.gtRow}>
            <Text style={[s.ltName, s.gtHead]}>{'比较期 ' + st.all.n + ' 次（预热 ' + st.warm + ' 次不算）'}</Text>
            <Text style={[s.gtCell, s.gtHead]}>次数</Text>
            <Text style={[s.gtCell, s.gtHead]}>命中率</Text>
            <Text style={[s.gtCell, s.gtHead]}>平均每次</Text>
          </View>
          {rows.map(r => (
            <View key={r.name} style={s.gtRow}>
              <Text style={s.ltName}>{r.name}</Text>
              <Text style={[s.gtCell, num]}>{r.h.n}</Text>
              <Text style={[s.gtCell, num]}>{rate(r.h)}</Text>
              <Text style={[s.gtCell, num, tone(r.h.mean)]}>{r.h.n ? pct(r.h.mean, 2) : '—'}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={s.shape}>{st.all.n ? labelVerdict(st) : '已出结果的信号只有 ' + st.done + ' 次，不够训练次级模型（至少 ' + MIN_TRAIN + ' 次）：这次只看三重屏障的标签'}</Text>
      {pick == null && last ? <Text style={[s.focusL, num]}>{'框出的是最近一次：' + eventLine(data, last)}</Text> : null}
    </View>
  );
}

/** 页脚：口径、「怎么看」和「全屏」；展开「怎么看」时下面列出读图说明。 */
export function ChartFoot({ data, text }: { data: ChartData; text?: string }) {
  const [guide, setGuide] = useState(false);
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <>
      <View style={s.foot}>
        <Text style={s.ft}>{text ?? chartFoot(data)}</Text>
        <Pressable onPress={() => setGuide(v => !v)} accessibilityRole="button" accessibilityLabel="怎么看这张图" accessibilityState={{ expanded: guide }} style={s.full}>
          <Text style={s.fullT}>怎么看</Text>
        </Pressable>
        <Pressable onPress={() => nav.navigate('ChartFull', { chart: data })} hitSlop={8} accessibilityRole="button" accessibilityLabel="全屏查看图表" style={s.full}>
          <Maximize2 size={13} color={rc.main} />
          <Text style={s.fullT}>全屏</Text>
        </Pressable>
      </View>
      {guide ? <View style={s.guide}>
        {howToRead(data).map(line => <Text key={line} style={s.guideT}>{'· ' + line}</Text>)}
      </View> : null}
    </>
  );
}

export function ChartCard({ data, onBox, onAsk, onSave, onRedraw, now, hint = true }: {
  data: ChartData;
  onBox?: (box: { y: number; h: number } | null) => void;
  /** 讲解里：把点中的那一天（图名 + 读数）带到输入框，接着写问题。 */
  onAsk?: (text: string) => void;
  /** 讲解里的因子检验：存进研究手记（书里的结论、检验口径和结果预先填好）。 */
  onSave?: () => void;
  /** 盘中画的图收盘后或隔天再看：「用最新行情重画」，让 AI 用同样的参数再画一张（新图在新的一问里，这张不改）。 */
  onRedraw?: (c: PriceChart | CompareChart) => void;
  /** 现在的北京时间（测试用），默认取当前时刻。 */
  now?: BeijingNow;
  /** 「点一下或按住拖动」的提示：一问只在第一张能点的图下写。 */
  hint?: boolean;
}) {
  // 分组净值默认只画最高组、最低组、多空和基准；「看全部分组」画出每一组
  const [extremes, setExtremes] = useState(true);
  // 点一下或按住拖动看某一天：十字线画在卡片里，读数写在图下（拖动时图顶另有读数牌），不用跳全屏（各组收益图没有日期，不点）
  const [pick, setPick] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const inspect = data.kind !== 'groups';
  // 讲解页要知道画线区域在哪（滚过去之后钉一张小图，ChartPin）：卡片在外面的位置 + 图在卡片里的位置；卸下时报 null
  const at = useRef({ card: -1, plot: -1, h: 0 });
  const boxRef = useRef(onBox);
  boxRef.current = onBox;
  useEffect(() => () => boxRef.current?.(null), []);
  const report = () => at.current.card >= 0 && at.current.plot >= 0 && boxRef.current?.({ y: at.current.card + at.current.plot, h: at.current.h });
  const stats = chartStats(data);
  const unit = data.kind === 'labels' ? '一次信号' : '一天';
  const stale = onRedraw && (data.kind === 'price' || data.kind === 'compare') && liveStale(data, now ?? beijingNow()) ? data : null;
  return (
    <View style={s.card} onLayout={onBox ? e => { at.current.card = e.nativeEvent.layout.y; report(); } : undefined}>
      <View style={s.head}>
        <Text style={s.title}>
          {chartTitle(data)}
        </Text>
        <Text style={s.tag}>{chartTag(data)}</Text>
      </View>
      {stats ? <Text style={[s.statsT, num]}>{stats}</Text> : null}
      <Takeaway data={data} />
      <View style={s.plot} onLayout={e => {
        setWidth(e.nativeEvent.layout.width - 12);
        if (onBox) { at.current.plot = e.nativeEvent.layout.y; at.current.h = e.nativeEvent.layout.height; report(); }
      }}>
        <QuantChart data={data} extremes={extremes} pick={pick} onPick={inspect ? setPick : undefined} />
      </View>
      {inspect && (pick != null || hint) ? (
        <View style={s.pick}>
          {pick != null ? (
            <>
              <PickText data={data} i={pick} extremes={extremes} />
              {onAsk ? <Pressable style={s.ask} onPress={() => onAsk('看图中这' + unit + '：' + chartTitle(data) + '，' + readout(data, pick) + '。')} accessibilityRole="button" accessibilityLabel={'就这' + unit + '提问'}>
                <Text style={s.fullT}>{'问这' + unit}</Text>
              </Pressable> : null}
              <Pressable onPress={() => setPick(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel={'收起这' + unit + '的读数'}>
                <X size={15} color={rc.muted} />
              </Pressable>
            </>
          ) : (
            <Text style={s.hint}>{pickHint(data)}</Text>
          )}
        </View>
      ) : null}
      {data.kind === 'groups' ? <GroupExtras data={data} width={width} /> : null}
      {data.kind === 'labels' ? <LabelExtras data={data} pick={pick} /> : null}
      {data.kind === 'factor' ? <View style={s.factorRow}>
        <Pressable style={s.focusBtn} onPress={() => setExtremes(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: !extremes }}><Text style={s.fullT}>{extremes ? '看全部分组' : '只看最高与最低组'}</Text></Pressable>
        {onSave ? <Pressable style={s.focusBtn} onPress={onSave} accessibilityRole="button" accessibilityLabel="把这次检验存进研究手记"><Text style={s.fullT}>存进研究手记</Text></Pressable> : null}
      </View> : null}
      <FocusReadout data={data} />
      <Legend items={legendOf(data, extremes)} />
      {stale ? (
        <View style={s.factorRow}>
          <Pressable style={s.focusBtn} onPress={() => onRedraw!(stale)} accessibilityRole="button" accessibilityLabel="用最新行情重画这张图">
            <Text style={s.fullT}>用最新行情重画</Text>
          </Pressable>
        </View>
      ) : null}
      <ChartFoot data={data} />
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
  li: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  dot: { width: 10, height: 3, borderRadius: 2, borderWidth: 0 },
  dash: { height: 0, borderTopWidth: 2, borderStyle: 'dashed' },
  lt: { fontSize: 12, color: rc.secondary },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 2, paddingBottom: 4, gap: 8 },
  ft: { flex: 1, fontSize: 12, color: rc.muted },
  focusBtn: { minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' },
  factorRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  full: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', gap: 3 },
  fullT: { fontSize: 12, color: rc.main },
  statsT: { paddingHorizontal: 12, fontSize: 12, lineHeight: 18, color: rc.secondary },
  groupBox: { paddingHorizontal: 12, paddingTop: 4, gap: 6 },
  shape: { fontSize: 12, lineHeight: 18, color: rc.ink },
  gt: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: rc.line },
  gtRow: { flexDirection: 'row', alignItems: 'center', minHeight: 22, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rc.line },
  gtName: { width: 76, fontSize: 11, color: rc.secondary },
  ltName: { flex: 2.2, fontSize: 11, color: rc.secondary },
  glyph: { fontSize: 11, lineHeight: 14 },
  gtHead: { color: rc.muted, fontSize: 11 },
  gtCell: { flex: 1, fontSize: 12, textAlign: 'right' },
});
