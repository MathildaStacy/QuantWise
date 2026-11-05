/**
 * 一次因子检验一张结果卡（docs/design/pm-reader-lecture-20261105.md 第 8、13 项）：标题和口径、一行统计（多空和 t 值、IC 和 t 值、
 * IC 为正的期数），下面一张图用「净值 / IC / 各组」切换，默认净值。同一因子、同一股票池只换加权方式的几次检验合成一张卡，
 * 加「等权 / 市值加权」切换（IC 只看排名，两次一样）。讲解和助手里 factor_test 的图都这样排；因子实验室仍是一张张的图卡。
 * 讲解页滚过这张卡、读对照文字时，步骤栏的位置钉一条结果条（ChartPin 的 FactorPin）。
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import {
  factorBasis,
  icSummary,
  monthly,
  pct,
  signed,
  WEIGHT_NAME,
  type ChartData,
  type FactorChart,
  type GroupsChart,
  type IcChart,
} from '../../quant/charts';
import { FACTORS } from '../../quant/factors';
import { mean, stdev } from '../../quant/indicators';
import { rc } from '../readTheme';
import { color, num } from '../theme';
import { ChartFoot, GroupExtras, Legend, legendOf, pickHint, PickText, poolShort } from './ChartCard';
import { QuantChart } from './QuantChart';
import { readout } from './quantDraw';

/** 一次 factor_test 的三张图。 */
export interface FactorRun {
  nav: FactorChart;
  ic?: IcChart;
  groups?: GroupsChart;
}

/** 对话里按顺序排的图：普通图一张一张，因子检验一次一张结果卡（只换加权方式的合成一张）。 */
export type ChartItem = { kind: 'chart'; data: ChartData } | { kind: 'factor'; runs: FactorRun[] };

/** 同一次检验除了加权方式以外的口径：一样的才合成一张卡（旧图没有 stats，不合）。 */
const sameTest = (c: FactorChart) =>
  c.stats
    ? [c.factor, c.universe, c.stats.universe, c.stats.avgStocks ?? '', c.stats.hold, c.stats.groups, c.stats.costBp, c.stats.periods,
        c.stats.control ? c.stats.control.groups + c.stats.control.sort : '', c.dates[0], c.dates[c.dates.length - 1]].join('|')
    : null;

/**
 * 把一问里各处的图排成卡片，返回和 groups（一问里每条工具结果的图）一一对应的卡片：
 * 分组净值图后面紧跟的 IC 图、各组收益图归到这一次检验；同一口径、只换加权方式的检验并进前面那张卡
 * （一种加权只放一次），在自己的位置上不再出现。
 */
export function chartItems(groups: ChartData[][]): ChartItem[][] {
  const cards: Extract<ChartItem, { kind: 'factor' }>[] = [];
  return groups.map(charts => {
    const out: ChartItem[] = [];
    let run: FactorRun | null = null;
    for (const c of charts) {
      if (c.kind === 'factor') {
        const next: FactorRun = { nav: c };
        run = next;
        const key = sameTest(c);
        const twin = key ? cards.find(x => sameTest(x.runs[0].nav) === key && !x.runs.some(r => r.nav.stats?.weight === c.stats?.weight)) : undefined;
        if (twin) {
          twin.runs.push(next);
        } else {
          const card = { kind: 'factor' as const, runs: [next] };
          cards.push(card);
          out.push(card);
        }
        continue;
      }
      if ((c.kind === 'ic' || c.kind === 'groups') && run && run.nav.factor === c.factor && !run[c.kind]) {
        if (c.kind === 'ic') {
          run.ic = c;
        } else {
          run.groups = c;
        }
        continue;
      }
      run = null;
      out.push({ kind: 'chart', data: c });
    }
    return out;
  });
}

/** 多空每期收益的均值和 t 值：新图用检验算好的数，旧图从多空净值现算。 */
function longShortOf(c: FactorChart): { mean: number; t: number } {
  if (c.stats) {
    return { mean: c.stats.longShortMean, t: c.stats.longShortT };
  }
  const r = c.longShort.slice(1).map((v, i) => v / c.longShort[i] - 1);
  const sd = stdev(r);
  return { mean: mean(r), t: sd ? mean(r) / (sd / Math.sqrt(r.length)) : 0 };
}

/** 结果条的一行：「12-1 月动量 · 示例池 24 期 · 等权 多空 -0.59%（t -0.45）· IC -0.006（t -0.08）」。 */
export function runLine(r: FactorRun): string {
  const ls = longShortOf(r.nav);
  const ic = r.ic ? icSummary(r.ic) : r.nav.stats ? { mean: r.nav.stats.icMean, t: r.nav.stats.icT } : null;
  return (
    FACTORS[r.nav.factor].name + ' · ' + poolShort(r.nav) + ' ' + (r.nav.dates.length - 1) + ' 期 · ' +
    (r.nav.stats ? WEIGHT_NAME[r.nav.stats.weight] + ' ' : '') + '多空 ' + pct(ls.mean, 2) + '（t ' + ls.t.toFixed(2) + '）' +
    (ic ? '· IC ' + signed(ic.mean, 3) + '（t ' + ic.t.toFixed(2) + '）' : '')
  );
}

type Tab = 'nav' | 'ic' | 'groups';
const TAB_NAME: Record<Tab, string> = { nav: '净值', ic: 'IC', groups: '各组' };
const tone = (v: number) => ({ color: v > 0 ? color.upText : v < 0 ? color.downText : rc.ink });

export function FactorResult({ runs, onBox, onAsk, onSave, hint = true }: {
  runs: FactorRun[];
  /** 讲解页：卡片在这一问里的位置（滚过去之后钉结果条）；卸下时报 null。 */
  onBox?: (box: { y: number; h: number } | null) => void;
  onAsk?: (text: string) => void;
  /** 存进研究手记：当前选中的那次检验。 */
  onSave?: (nav: FactorChart) => void;
  hint?: boolean;
}) {
  const [k, setK] = useState(0);
  const [tab, setTab] = useState<Tab>('nav');
  const [extremes, setExtremes] = useState(true);
  const [pick, setPick] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const boxRef = useRef(onBox);
  boxRef.current = onBox;
  useEffect(() => () => boxRef.current?.(null), []);
  const run = runs[Math.min(k, runs.length - 1)];
  const nav = run.nav;
  const st = nav.stats;
  const tabs: Tab[] = ['nav', ...(run.ic ? ['ic' as const] : []), ...(run.groups ? ['groups' as const] : [])];
  const data: ChartData = tab === 'ic' && run.ic ? run.ic : tab === 'groups' && run.groups ? run.groups : nav;
  const ls = longShortOf(nav);
  const ic = run.ic ? icSummary(run.ic) : null;
  const sameIc = runs.length > 1 && runs.every(r => r.ic && run.ic && r.ic.ic.join() === run.ic.ic.join());
  const inspect = data.kind !== 'groups';
  const choose = (next: () => void) => {
    setPick(null);
    next();
  };
  const hold = st?.hold;
  return (
    <View style={s.card} onLayout={onBox ? e => onBox({ y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }) : undefined}>
      <View style={s.head}>
        <Text style={s.title}>{'因子检验 · ' + FACTORS[nav.factor].name}</Text>
        <Text style={s.tag}>历史回测</Text>
      </View>
      <Text style={s.sub}>
        {[poolShort(nav), ...(st ? [factorBasis(st)] : []), nav.dates.length - 1 + ' 期', nav.dates[0] + ' 至 ' + nav.dates[nav.dates.length - 1]].join(' · ')}
      </Text>
      {runs.length > 1 ? (
        <View style={s.seg} accessibilityRole="tablist">
          {runs.map((r, j) => (
            <Pressable key={j} style={[s.segB, j === k && s.segOn]} onPress={() => choose(() => setK(j))} accessibilityRole="tab" accessibilityState={{ selected: j === k }}>
              <Text style={[s.segT, j === k && s.segTOn]}>{r.nav.stats ? WEIGHT_NAME[r.nav.stats.weight] : '第 ' + (j + 1) + ' 次'}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={s.stats}>
        <View style={s.stat}>
          <Text style={s.statK}>{'多空每期' + (st?.costBp ? '（扣费）' : '')}</Text>
          <Text style={[s.statV, num, tone(ls.mean)]}>{pct(ls.mean, 2)}</Text>
          <Text style={[s.statS, num]}>{'t ' + ls.t.toFixed(2) + (hold && hold !== 20 ? ' · 月均约 ' + pct(monthly(ls.mean, hold), 2) : '')}</Text>
        </View>
        {ic ? (
          <View style={s.stat}>
            <Text style={s.statK}>Rank IC 均值</Text>
            <Text style={[s.statV, num]}>{signed(ic.mean, 3)}</Text>
            <Text style={[s.statS, num]}>{'t ' + ic.t.toFixed(2) + ' · 为正 ' + ic.positive + '/' + ic.n}</Text>
          </View>
        ) : null}
      </View>
      <View style={s.seg} accessibilityRole="tablist">
        {tabs.map(t => (
          <Pressable key={t} style={[s.segB, t === tab && s.segOn]} onPress={() => choose(() => setTab(t))} accessibilityRole="tab" accessibilityState={{ selected: t === tab }} accessibilityLabel={TAB_NAME[t] + (t === 'nav' ? '：分组净值' : t === 'ic' ? '：每期 Rank IC' : '：各组收益')}>
            <Text style={[s.segT, t === tab && s.segTOn]}>{TAB_NAME[t]}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.plot} onLayout={e => setWidth(e.nativeEvent.layout.width - 12)}>
        <QuantChart key={tab + k} data={data} extremes={extremes} pick={pick} onPick={inspect ? setPick : undefined} />
      </View>
      {inspect && (pick != null || hint) ? (
        <View style={s.pick}>
          {pick != null ? (
            <>
              <PickText data={data} i={pick} extremes={extremes} />
              {onAsk ? <Pressable style={s.ask} onPress={() => onAsk('看图中这一期：' + FACTORS[nav.factor].name + (st ? '（' + WEIGHT_NAME[st.weight] + '）' : '') + '，' + readout(data, pick) + '。')} accessibilityRole="button" accessibilityLabel="就这一期提问">
                <Text style={s.link}>问这一期</Text>
              </Pressable> : null}
              <Pressable onPress={() => setPick(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="收起这一期的读数">
                <X size={15} color={rc.muted} />
              </Pressable>
            </>
          ) : (
            <Text style={s.hint}>{pickHint(data)}</Text>
          )}
        </View>
      ) : null}
      {data.kind === 'groups' ? <GroupExtras data={data} width={width} /> : null}
      {tab === 'ic' && sameIc ? <Text style={s.note}>IC 只看排名，等权和市值加权两次一样</Text> : null}
      {tab === 'nav' ? (
        <View style={s.row}>
          <Pressable style={s.btn} onPress={() => setExtremes(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: !extremes }}>
            <Text style={s.link}>{extremes ? '看全部分组' : '只看最高与最低组'}</Text>
          </Pressable>
          {onSave ? <Pressable style={s.btn} onPress={() => onSave(nav)} accessibilityRole="button" accessibilityLabel="把这次检验存进研究手记">
            <Text style={s.link}>存进研究手记</Text>
          </Pressable> : null}
        </View>
      ) : null}
      <Legend items={legendOf(data, extremes)} />
      <ChartFoot
        data={data}
        text={
          data.kind === 'factor'
            ? (FACTORS[nav.factor].approx ? '近似因子 · ' : '') + '当前成分，有幸存者偏差'
            : data.kind === 'groups'
            ? '从左到右因子值从低到高'
            : undefined
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginVertical: 10, borderRadius: 12, backgroundColor: rc.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '600', color: rc.ink },
  tag: { fontSize: 11, color: rc.realInk, backgroundColor: rc.real, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  sub: { paddingHorizontal: 12, paddingTop: 2, fontSize: 12, lineHeight: 18, color: rc.secondary },
  stats: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 8, gap: 12 },
  stat: { flex: 1, gap: 1 },
  statK: { fontSize: 12, color: rc.muted },
  statV: { fontSize: 18, lineHeight: 24, fontWeight: '700', color: rc.ink },
  statS: { fontSize: 12, lineHeight: 18, color: rc.secondary },
  seg: { flexDirection: 'row', marginHorizontal: 12, marginTop: 8, padding: 2, borderRadius: 8, backgroundColor: rc.soft },
  segB: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  segOn: { backgroundColor: rc.paper },
  segT: { fontSize: 13, color: rc.secondary },
  segTOn: { color: rc.ink, fontWeight: '600' },
  plot: { paddingHorizontal: 6, paddingTop: 8 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 2 },
  ask: { minHeight: 48, justifyContent: 'center' },
  hint: { fontSize: 12, lineHeight: 18, color: rc.muted },
  note: { paddingHorizontal: 12, paddingTop: 4, fontSize: 12, lineHeight: 18, color: rc.secondary },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  btn: { minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' },
  link: { fontSize: 12, color: rc.main },
});
