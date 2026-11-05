/**
 * 因子实验室（股票池、因子、调仓、分组、成本 → 统计和三张图，QUANTWISE_DESIGN.md §7）和全屏图（十字线读数、怎么算的）。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { universeEnv } from '../../ai/tools/quant';
import { SAMPLE_BOOK_ID } from '../../book/sample';
import { runFactorTest, SampleError } from '../../quant/backtest';
import { chartTitle, factorCharts } from '../../quant/charts';
import { FACTOR_IDS, FACTORS, type FactorId } from '../../quant/factors';
import { isIndexPool, loadPanel, poolStatus, prepareBars, universeCodes, UNIVERSE_IDS, UNIVERSE_NAME, type IndexPoolId, type PrepareProgress, type UniverseId } from '../../quant/universe';
import { ChartCard, FocusReadout, LabelExtras, Legend, legendOf, Takeaway } from '../charts/ChartCard';
import { PrepareCard, usePoolPrepare } from '../charts/PoolPrepare';
import { QuantChart } from '../charts/QuantChart';
import { LockScroll } from '../charts/scrub';
import { fullHint, howComputed, readout, tableRows } from '../charts/quantDraw';
import { Button, Details, NavBar, Note } from '../components/ui';
import { useAiContext, useCore } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { rc } from '../readTheme';
import { beijingIso } from '../../market/clock';
import { factorConclusion, snapshotQuestion, type FactorSnapshot } from '../../quant/interpret';
import { color, num, PAD } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface Cfg {
  universe: UniverseId;
  factor: FactorId;
  hold: number;
  groups: number;
  costBp: number;
  weight: 'equal' | 'cap';
  /** 控制市值的双重排序：市值分几组（0 = 不控制），条件排序。 */
  control: number;
}

const POOL_LABEL: Record<UniverseId, string> = { sample: '示例池', watch: '自选 + 持仓', hs300: '沪深 300', zz500: '中证 500', zz1000: '中证 1000' };

function Chips<T extends string | number>({ label, items, value, onPick }: { label: string; items: [T, string][]; value: T; onPick: (v: T) => void }) {
  return (
    <View style={st.cfgRow}>
      <Text style={st.cfgK}>{label}</Text>
      <View style={st.chips}>
        {items.map(([v, l]) => (
          <Pressable key={String(v)} onPress={() => onPick(v)} style={[st.chip, v === value && st.chipOn]} accessibilityRole="radio" accessibilityState={{ checked: v === value }}>
            <Text style={[st.chipT, v === value && st.white]}>{l}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function FactorLabScreen({ route }: RootScreenProps<'FactorLab'>) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const [cfg, setCfg] = useState<Cfg>({
    universe: (UNIVERSE_IDS.includes(route.params?.universe as UniverseId) ? route.params!.universe : 'sample') as UniverseId,
    factor: (FACTOR_IDS.includes(route.params?.factor as FactorId) ? route.params!.factor : 'mom20') as FactorId,
    hold: 20,
    groups: 5,
    costBp: 15,
    weight: 'equal',
    control: 0,
  });
  const [draft, setDraft] = useState(cfg);
  const [paramsOpen, setParamsOpen] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(cfg);
  const [prog, setProg] = useState<PrepareProgress | null>(null);
  const [res, setRes] = useState<FactorSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  /** 指数池的数据过期或只有约 3 年：照常算，下面提示可以更新。 */
  const [stale, setStale] = useState(false);
  const env = universeEnv(core);
  const set = (p: Partial<Cfg>) => setDraft(c => ({ ...c, ...p }));
  const pool = usePoolPrepare(core, () => setCfg(c => ({ ...c })));

  // 指数池要用户点「准备数据」；示例池和自选打开就自动准备（几只到几十只，几秒钟）
  useEffect(() => {
    let alive = true;
    setRes(null);
    setProg(null);
    setReady(null);
    setStale(false);
    setErr(null);
    (async () => {
      if (cfg.control && cfg.factor === 'size') {
        throw new Error('小市值因子本身就是按市值排序，不能再控制市值');
      }
      const index = isIndexPool(cfg.universe) ? await poolStatus(env, cfg.universe) : null;
      const codes = index ? index.codes : (await universeCodes(env, cfg.universe)).codes;
      const have = !index || index.ready;
      if (!alive) {
        return;
      }
      setReady(have);
      setStale(!!index && index.stale > index.codes.length * 0.1);
      if (!have) {
        return;
      }
      if (!index) {
        await prepareBars(env, codes.slice(0, 60), p => alive && setProg(p));
      }
      const panel = await loadPanel(core.db, index ? codes : codes.slice(0, 60));
      try {
        const r = runFactorTest(panel, {
          factor: cfg.factor, hold: cfg.hold, groups: cfg.groups, costBp: cfg.costBp,
          ...(cfg.weight === 'cap' ? { weight: 'cap' as const } : {}),
          ...(cfg.control ? { control: { by: 'size' as const, groups: cfg.control, sort: 'conditional' as const } } : {}),
        });
        if (alive) {
          setRes({ r, universe: cfg.universe, computedAt: beijingIso(), codes: panel.codes.length, from: panel.dates[0] ?? '' });
        }
      } catch (e) {
        if (alive) {
          setErr(e instanceof SampleError ? e.message : e instanceof Error ? e.message : String(e));
        }
      }
    })().catch(e => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // env 每次渲染都新建，按配置重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, cfg]);

  const f = FACTORS[cfg.factor];
  const how = (cfg.weight === 'cap' ? '市值加权' : '等权') + (cfg.control ? ' · 先按市值分 ' + cfg.control + ' 组' : '');
  useAiContext('FactorLab', () => ({
    name: '因子实验室',
    lines: res
      ? [f.name + '，' + UNIVERSE_NAME[cfg.universe] + '，' + res.codes + ' 只，每 ' + cfg.hold + ' 日调仓，' + cfg.groups + ' 组，' + how + '，单边成本万 ' + cfg.costBp, 'Rank IC 均值 ' + res.r.icMean.toFixed(3) + '，t ' + res.r.t.toFixed(2) + '，ICIR ' + res.r.icir.toFixed(2) + '，多空年化 ' + (res.r.longShortAnnual * 100).toFixed(1) + '%，' + res.r.periods + ' 期']
      : [f.name + '，' + UNIVERSE_NAME[cfg.universe] + '，' + (err ?? '计算中')],
    tip: '股票池是当前成分，有幸存者偏差；本地约 5 年日线，期数远少于书里的样本，结论只当练习。t 值不到 2 不算显著。',
  }));
  const stat = (k: string, v: string, d: string, weak = false) => (
    <View key={k} style={st.stat}>
      <Text style={st.statK}>{k}</Text>
      <Text style={[st.statV, num, weak && st.weak]}>{v}</Text>
      <Text style={st.statK}>{d}</Text>
    </View>
  );
  const r = res?.r;
  const sgn = (v: number, d: number) => (v > 0 ? '+' : '') + v.toFixed(d);
  return (
    <View style={st.page}>
      <NavBar title="因子实验室" back />
      <LockScroll contentContainerStyle={st.pad}>
        <View style={st.card}>
          <Text style={st.h}>{f.name}</Text><Text style={st.k}>{UNIVERSE_NAME[cfg.universe]} · 每 {cfg.hold} 日调仓 · {cfg.groups} 组 · {how} · 单边成本 {cfg.costBp}bp</Text>
          <Button title={paramsOpen ? '收起参数' : '调整参数'} onPress={() => setParamsOpen(v => !v)} />
          {paramsOpen ? <>
          <Chips label="股票池" items={UNIVERSE_IDS.map(u => [u, POOL_LABEL[u]])} value={draft.universe} onPick={universe => set({ universe })} />
          <Chips label="因子" items={FACTOR_IDS.map(id => [id, FACTORS[id].name])} value={draft.factor} onPick={factor => set({ factor, ...(factor === 'size' ? { control: 0 } : {}) })} />
          <Chips label="调仓" items={[5, 10, 20, 60].map(v => [v, '每 ' + v + ' 日'])} value={draft.hold} onPick={hold => set({ hold })} />
          <Chips label="分组" items={[3, 5, 10].map(v => [v, v + ' 组'])} value={draft.groups} onPick={groups => set({ groups })} />
          <Chips label="加权" items={[['equal', '等权'], ['cap', '市值加权']] as ['equal' | 'cap', string][]} value={draft.weight} onPick={weight => set({ weight })} />
          {draft.factor === 'size' ? null : <Chips label="控制市值" items={[0, 2, 3, 5].map(v => [v, v ? '先分 ' + v + ' 组' : '不控制'])} value={draft.control} onPick={control => set({ control })} />}
          <Chips label="单边成本" items={[0, 15, 30].map(v => [v, v ? '万 ' + v : '不扣'])} value={draft.costBp} onPick={costBp => set({ costBp })} />
          <Button title="应用参数并计算" tone="learn" onPress={() => { setCfg({ ...draft }); setParamsOpen(false); }} />
          <Button title="取消修改" onPress={() => { setDraft(cfg); setParamsOpen(false); }} />
          </> : null}
          <Text style={st.k}>{f.formula}{f.approx ? '（用今天的股本往回推，近似）' : ''} · 书里在 {f.section}</Text>
        </View>
        {changed ? <Note style={st.note}>参数已更改，下面仍是上次结果。应用参数后重新计算。</Note> : null}
        {isIndexPool(cfg.universe) && (ready === false || stale) ? (
          <View style={st.padX}>
            <PrepareCard pool={cfg.universe} pending={ready === false} prep={pool.prep} onStart={() => { pool.start(cfg.universe as IndexPoolId).catch(e => setErr(e instanceof Error ? e.message : String(e))); }} onStop={pool.stop} />
          </View>
        ) : null}
        {err ? <Note tone="warn" style={st.note}>{err}</Note> : null}
        {!r && !err && ready ? <Text style={[st.k, st.padH]}>{prog && prog.done < prog.total ? '准备数据 ' + prog.done + ' / ' + prog.total : '计算中…'}</Text> : null}
        {r && res ? (
          <>
            <View style={st.card}>
              <Text style={st.headline}>{Math.abs(r.t) < 2 ? '先看证据，再下结论' : '有样本内证据，仍需验证'}</Text>
              <Text style={st.conclusion}>{factorConclusion(r)}</Text>
              <Text style={st.k}>{res.codes} 只当前成分 · {r.periods} 期 · {r.dates[0]} 至 {r.dates[r.dates.length - 1]}</Text>
              <Text style={st.k}>计算于 {res.computedAt.replace('T', ' ').slice(0, 19)} · 当前成分存在幸存者偏差</Text>
              <Button title="解释这次结果" tone="learn" onPress={() => nav.navigate('Study', { bookId: SAMPLE_BOOK_ID, sectionId: f.section, ask: snapshotQuestion(res), askLabel: '解释这次' + f.name + '实验结果', askSnapshot: true })} />
            </View>
            <View style={st.stats}>
              {stat('Rank IC 均值', sgn(r.icMean, 3), '排序关系，不等于收益', Math.abs(r.icMean) < 0.03)}
              {stat('t 值', r.t.toFixed(2), r.periods + ' 期' + (Math.abs(r.t) < 2 ? '，不显著' : ''), Math.abs(r.t) < 2)}
              {stat('ICIR', r.icir.toFixed(2), '年化 ' + r.icirAnnual.toFixed(2))}
              {stat('IC 为正', (r.icPositive * 100).toFixed(0) + '%', '')}
              {stat('多空年化', sgn(r.longShortAnnual * 100, 1) + '%', cfg.costBp ? '已扣费' : '未扣费')}
              {stat('最高组换手', (r.turnover * 100).toFixed(0) + '%', '每期')}
            </View>
            <View style={st.charts}>
              <ChartCard data={factorCharts(r, cfg.universe)[0]} />
              <Details title="更多图表：IC 与各组收益">
                {factorCharts(r, cfg.universe).slice(1).map(c => <ChartCard key={c.kind} data={c} />)}
              </Details>
            </View>
            <Note style={st.note}>{res.codes} 只、{res.from} 起的前复权日线。股票池用的是当前成分，有幸存者偏差；t 值不到 2 不算显著。口径见《因子投资入门》4.1–4.5。</Note>
            <View style={st.row2}>
              <Button title={'书里怎么说（' + f.section + '）'} small style={st.grow} onPress={() => nav.navigate('Study', { bookId: SAMPLE_BOOK_ID, sectionId: f.section, mode: 'read' })} />
            </View>
          </>
        ) : null}
      </LockScroll>
    </View>
  );
}

export function ChartFullScreen({ route }: RootScreenProps<'ChartFull'>) {
  const nav = useNavigation<Nav>();
  const c = route.params.chart;
  const [i, setI] = useState<number | null>(null);
  return (
    <View style={st.page}>
      <NavBar title={chartTitle(c)} back />
      <LockScroll contentContainerStyle={st.pad}>
        <View style={st.card}>
          <Takeaway data={c} />
          <QuantChart data={c} full onPick={setI} />
          <Text style={[st.readout, num]}>{i == null ? fullHint(c) : readout(c, i)}</Text>
          <FocusReadout data={c} full />
          {c.kind === 'labels' ? (
            <>
              <LabelExtras data={c} pick={i} />
              <Legend items={legendOf(c)} />
            </>
          ) : null}
          {/* 区间里的行前面一条竖线，和图上的黄色区间对应；元标签图每次信号一行 */}
          <Details title="查看数据表">{tableRows(c).map((r, index) => <Text key={index} selectable style={[st.body, num, r.focus && st.inFocus]}>{(r.focus ? '▍' : '') + r.text}</Text>)}</Details>
        </View>
        <View style={st.card}>
          <Text style={st.h}>怎么算的</Text>
          {howComputed(c).map(x => (
            <Text key={x} style={st.body}>· {x}</Text>
          ))}
        </View>
        {c.kind === 'price' ? <Button title={'打开' + c.name + '个股页'} onPress={() => nav.navigate('Stock', { code: c.code, name: c.name })} style={st.btn} /> : null}
      </LockScroll>
    </View>
  );
}

const st = StyleSheet.create({
  headline: { fontSize: 22, lineHeight: 32, color: rc.ink, fontWeight: '600' },
  conclusion: { fontSize: 16, lineHeight: 27, color: rc.ink, marginVertical: 8 },
  page: { flex: 1, backgroundColor: rc.page },
  pad: { paddingBottom: 96 },
  card: { backgroundColor: color.card, marginBottom: 8, paddingHorizontal: PAD, paddingVertical: 10, gap: 6 },
  cfgRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cfgK: { width: 56, fontSize: 13, color: color.ink2, paddingTop: 5 },
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: { minHeight: 48, justifyContent: 'center', borderRadius: 14, backgroundColor: color.bg, paddingHorizontal: 9, paddingVertical: 4 },
  chipOn: { backgroundColor: rc.main },
  chipT: { fontSize: 12, color: color.ink2 },
  white: { color: '#FFFFFF' },
  k: { fontSize: 12, color: color.ink3, lineHeight: 18 },
  h: { fontSize: 15, fontWeight: '600', color: color.ink },
  body: { fontSize: 13, color: color.ink2, lineHeight: 21 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  row2: { flexDirection: 'row', gap: 8, paddingHorizontal: 10 },
  grow: { flex: 1 },
  note: { marginHorizontal: 10, marginBottom: 8 },
  padX: { paddingHorizontal: 10 },
  padH: { paddingHorizontal: PAD, paddingVertical: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 10, paddingBottom: 8 },
  stat: { width: '48%', backgroundColor: color.card, borderRadius: 10, padding: 8 },
  statK: { fontSize: 12, color: color.ink3 },
  statV: { fontSize: 17, fontWeight: '600', color: color.ink },
  weak: { color: color.ink2 },
  charts: { paddingHorizontal: 10 },
  readout: { fontSize: 12, color: color.ink2, minHeight: 36 },
  inFocus: { color: rc.focusInk },
  btn: { marginHorizontal: 12 },
});
