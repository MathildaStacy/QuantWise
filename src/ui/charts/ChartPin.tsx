/**
 * 图文同屏（docs/design/ai-lecture-charts.md §2.9）：读讲解时图卡滚出了屏幕，把这张图的小图盖在讲解页顶部的步骤栏上；
 * 这一问没画图、讲的是前面那张图时，钉前面那张。标题行写名字和区间涨跌（对比图写图例），有副图时下一行写区间两端的副图值；
 * 点小图或 ⤢ 全屏，× 收起这一问的钉图。钉哪张由 pinOf 算（纯函数）。
 * 因子检验的结果卡滚过去之后钉的是一条结果条（FactorPin）：每次检验一行统计，点一行跳回结果卡。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Maximize2, X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { fmtSub, focusStats, md, pct, SUB_NAME, type ChartData, type CompareChart, type PriceChart } from '../../quant/charts';
import { FACTORS } from '../../quant/factors';
import type { RootStackParamList } from '../navigation/types';
import { rc, SERIES_COLORS } from '../readTheme';
import { color, num } from '../theme';
import { runLine, type FactorRun } from './FactorResult';
import { QuantChart } from './QuantChart';

/**
 * 一张可以钉住的图：在哪一问（turnsOf 的 first），画线区域在这一问里的上沿和高度。
 * 因子检验的结果卡（runs）是整张卡的上沿和高度，钉的是一条结果条，不是图。
 */
export interface PinSpot {
  turn: number;
  y: number;
  h: number;
  data: ChartData;
  runs?: FactorRun[];
}

/** 一问的文字（问题 + 讲解）和这一问画了几张图（含不能钉的因子图）。 */
export interface TurnInfo {
  text: string;
  charts: number;
}

const CHART_WORDS = /图中|图上|上图|图里|这张图|那张图|黄色区间|高亮/;
const squash = (t: string) => t.replace(/\s+/g, '');
/** 名字里相邻的两个汉字（「贵州茅台」→ 贵州、州茅、茅台）：讲解常用简称。 */
const pairs = (name: string) =>
  [...name].slice(0, -1).map((ch, i) => ch + name[i + 1]).filter(p => /^[\u4e00-\u9fff]{2}$/.test(p));

/** 对去掉空白后的文字匹配。 */
const RESULT_WORDS = /多空|RankIC|IC均值|t值|分组|复现|对照/;

/**
 * 讲解文字指的是不是这张图：提到图（0.5）、名字或代码（1）、每提到一个区间名（1）。0 是不相关。
 * 因子检验的结果：提到因子名（1）、提到多空 / IC / 对照这类词（0.5）。
 */
export function relevance(c: ChartData, text: string): number {
  if (c.kind === 'factor') {
    const t = squash(text);
    return (t.includes(squash(FACTORS[c.factor].name)) ? 1 : 0) + (RESULT_WORDS.test(t) ? 0.5 : 0);
  }
  if (!pinnable(c)) {
    return 0;
  }
  const t = squash(text);
  const who = c.kind === 'price' ? [{ code: c.code, name: c.name }] : c.series;
  const named = who.some(x => t.includes(x.code.replace(/^[a-z]+/i, '')) || pairs(x.name).some(p => t.includes(p)));
  const bands = (c.focus ?? []).filter(f => t.includes(squash(f.label))).length;
  return (CHART_WORDS.test(t) ? 0.5 : 0) + (named ? 1 : 0) + bands;
}

/**
 * 钉哪张图。正在读的一问 = 视窗上面三成处那一行所在的一问。
 * - 这一问自己画了图：画线区域已经有六成滚出视窗顶部的，取最靠后的一张；还没滚过去就不钉。
 * - 这一问没画图、讲的是前面的图（模型常直接引用前面那张图的数，不重画）：钉前面最相关的一张（relevance），
 *   一样相关取最近的；不提图、名字、区间名就不钉。
 * 在哪一问收起过钉图，那一问就不再钉。turns 和视窗都以对话顶部为 0。返回钉的图和正在读的那一问（收起时记这一问）。
 */
export function pinOf(
  spots: ReadonlyMap<string, PinSpot>,
  turns: ReadonlyMap<number, { y: number; height: number }>,
  view: { top: number; height: number },
  closed: ReadonlySet<number>,
  info: (turn: number) => TurnInfo | undefined = () => undefined,
): { key: string; reading: number } | null {
  const line = view.top + view.height * 0.3;
  let reading: number | null = null;
  for (const [id, t] of turns) {
    if (t.y <= line && line < t.y + t.height) {
      reading = id;
    }
  }
  if (reading == null || closed.has(reading)) {
    return null;
  }
  const list = [...spots]
    .flatMap(([key, p]) => {
      const t = turns.get(p.turn);
      return t && p.h > 0 ? [{ key, p, y: t.y + p.y }] : [];
    })
    .sort((a, b) => a.y - b.y);
  const past = (x: { p: PinSpot; y: number }) => x.y + x.p.h * 0.6 < view.top;
  const own = list.filter(x => x.p.turn === reading);
  const about = info(reading);
  let key: string | null = null;
  if (own.length || about?.charts) {
    key = own.filter(past).pop()?.key ?? null;
  } else if (about) {
    const top = turns.get(reading)!.y;
    let best = 0;
    for (const x of list) {
      const score = x.y < top && past(x) ? relevance(x.p.data, about.text) : 0;
      if (score > 0 && score >= best) {
        best = score;
        key = x.key;
      }
    }
  }
  return key == null ? null : { key, reading };
}

export const pinnable = (c: ChartData): c is PriceChart | CompareChart => c.kind === 'price' || c.kind === 'compare';

const tone = (v: number) => ({ color: v > 0 ? color.upText : v < 0 ? color.downText : rc.ink });

/** 标题行：价格图「贵州茅台 [九月 -3.15%] [十月 +10.60%]」，对比图「● 贵州茅台 ● 五粮液 [九月]」（每只的涨跌写在图里）。 */
function headOf(c: PriceChart | CompareChart): ReactNode[] {
  const chips = (c.focus ?? []).map(f => {
    const st = c.kind === 'price' ? focusStats(c, f) : null;
    return (
      <Text key={f.from + f.to}>
        {'  '}
        <Text style={s.chip}>
          {' ' + f.label + ' '}
          {st ? <Text style={[num, tone(st.change)]}>{pct(st.change, 2) + ' '}</Text> : null}
        </Text>
      </Text>
    );
  });
  if (c.kind === 'compare') {
    return [
      ...c.series.map((x, k) => (
        <Text key={x.code}>
          {k ? '  ' : ''}
          <Text style={{ color: SERIES_COLORS[k % SERIES_COLORS.length] }}>●</Text>
          {' ' + x.name}
        </Text>
      )),
      ...chips,
    ];
  }
  return [<Text key="name" style={s.name}>{c.name}</Text>, ...chips];
}

/**
 * 有副图时标题下一行写区间两端的副图值（小图里不画副图）：「20 日动量 9/30 -2.5% → 10/30 +7.2%」，和卡片的区间读数同一份数；
 * 两段首尾相接时接着写「8/31 … → 9/30 … → 10/30 …」。成交量不写。
 */
function subOf(c: PriceChart): ReactNode[] | null {
  const kind = c.sub?.kind;
  if (!kind || kind === 'volume') {
    return null;
  }
  const val = (v: number) => <Text style={[num, kind === 'mom20' || kind === 'mom60' ? tone(v) : s.subV]}>{fmtSub(kind, v)}</Text>;
  const out: ReactNode[] = [];
  let end: string | null = null;
  for (const f of c.focus ?? []) {
    const st = focusStats(c, f);
    if (st?.sub?.from == null || st.sub.to == null) {
      continue;
    }
    out.push(
      <Text key={f.from + f.to}>
        {st.baseDate === end ? null : <>{(out.length ? '  ·  ' : '') + md(st.baseDate) + ' '}{val(st.sub.from)}</>}
        {' → ' + md(st.to) + ' '}
        {val(st.sub.to)}
      </Text>,
    );
    end = st.to;
  }
  return out.length ? [<Text key="k">{SUB_NAME[kind] + '  '}</Text>, ...out] : null;
}

/** 结果条的几行：钉的这张结果卡，加上同一问里在它前面的结果卡（跑了两次就两行），每次检验一行。 */
export function factorRows(spots: ReadonlyMap<string, PinSpot>, key: string): { key: string; run: FactorRun }[] {
  const at = spots.get(key);
  if (!at?.runs) {
    return [];
  }
  return [...spots]
    .filter(([, p]) => p.runs && p.turn === at.turn && p.y <= at.y)
    .sort((a, b) => a[1].y - b[1].y)
    .flatMap(([k, p]) => p.runs!.map(run => ({ key: k, run })));
}

/** 读对照文字时钉在步骤栏位置的结果条：每次检验一行统计，点一行跳回那张结果卡，× 收起这一问的结果条。 */
export function FactorPin({ rows, style, onJump, onClose }: { rows: { key: string; run: FactorRun }[]; style?: StyleProp<ViewStyle>; onJump: (key: string) => void; onClose: () => void }) {
  return (
    <View style={[s.pin, style]}>
      <View style={s.rows}>
        {rows.map(r => (
          <Pressable key={r.key + (r.run.nav.stats?.weight ?? '')} style={s.row} onPress={() => onJump(r.key)} accessibilityRole="button" accessibilityLabel={runLine(r.run) + '，点一下回到结果卡'}>
            <Text style={[s.rowT, num]} numberOfLines={2}>{runLine(r.run)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.side}>
        <Pressable style={s.btn} onPress={onClose} accessibilityRole="button" accessibilityLabel="收起钉住的结果">
          <X size={16} color={rc.muted} />
        </Pressable>
      </View>
    </View>
  );
}

export function ChartPin({ data, style, onClose }: { data: PriceChart | CompareChart; style?: StyleProp<ViewStyle>; onClose: () => void }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { fontScale } = useWindowDimensions();
  const open = () => nav.navigate('ChartFull', { chart: data });
  const sub = data.kind === 'price' ? subOf(data) : null;
  return (
    <View style={[s.pin, style]}>
      <View style={s.body}>
        <Text style={s.head} numberOfLines={1}>
          {headOf(data)}
        </Text>
        {sub ? (
          <Text style={s.head} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
        <Pressable style={[s.plot, { minHeight: 46 + 20 * Math.max(1, fontScale) }]} onPress={open} accessibilityRole="button" accessibilityLabel={(data.kind === 'price' ? data.name : data.series.map(x => x.name).join(' / ')) + ' 的图，钉在这里对照讲解，点开全屏'}>
          <QuantChart data={data} mini />
        </Pressable>
      </View>
      <View style={s.side}>
        <Pressable style={s.btn} onPress={open} accessibilityRole="button" accessibilityLabel="全屏查看图表">
          <Maximize2 size={15} color={rc.main} />
        </Pressable>
        <Pressable style={s.btn} onPress={onClose} accessibilityRole="button" accessibilityLabel="收起钉住的图">
          <X size={16} color={rc.muted} />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pin: {
    flexDirection: 'row',
    backgroundColor: rc.paper,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: rc.line,
    elevation: 3,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  body: { flex: 1, paddingLeft: 10, paddingTop: 4 },
  head: { fontSize: 12, lineHeight: 18, color: rc.secondary },
  name: { fontWeight: '600', color: rc.ink },
  chip: { backgroundColor: rc.focusTag, color: rc.focusInk, fontWeight: '600' },
  subV: { color: rc.ink },
  plot: { flex: 1 },
  side: { width: 40, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: rc.line },
  btn: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  rows: { flex: 1 },
  row: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 4 },
  rowT: { fontSize: 12, lineHeight: 18, color: rc.ink },
});
