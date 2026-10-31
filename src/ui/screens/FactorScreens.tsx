/**
 * 因子实验室（股票池、因子、调仓、分组、成本 → 统计和三张图，QUANTWISE_DESIGN.md §7）和全屏图（十字线读数、怎么算的）。
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { universeEnv } from '../../ai/tools/quant';
import { SAMPLE_BOOK_ID } from '../../book/sample';
import * as quantRepo from '../../data/quantRepo';
import { runFactorTest, SampleError, type TestResult } from '../../quant/backtest';
import { chartTitle, factorCharts } from '../../quant/charts';
import { FACTOR_IDS, FACTORS, type FactorId } from '../../quant/factors';
import { loadPanel, prepareBars, refreshHs300, universeCodes, UNIVERSE_NAME, type PrepareProgress, type UniverseId } from '../../quant/universe';
import { ChartCard } from '../charts/ChartCard';
import { QuantChart } from '../charts/QuantChart';
import { howComputed, readout } from '../charts/quantDraw';
import { AiFab, Button, NavBar, Note } from '../components/ui';
import { useAiContext, useCore } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { rc } from '../readTheme';
import { color, num, PAD } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface Cfg {
  universe: UniverseId;
  factor: FactorId;
  hold: number;
  groups: number;
  costBp: number;
}

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
    universe: (['sample', 'watch', 'hs300'].includes(route.params?.universe ?? '') ? route.params!.universe : 'sample') as UniverseId,
    factor: (FACTOR_IDS.includes(route.params?.factor as FactorId) ? route.params!.factor : 'mom20') as FactorId,
    hold: 20,
    groups: 5,
    costBp: 15,
  });
  const [prog, setProg] = useState<PrepareProgress | null>(null);
  const [res, setRes] = useState<{ r: TestResult; codes: number; from: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const abort = useRef<AbortController | null>(null);
  const env = universeEnv(core);
  const set = (p: Partial<Cfg>) => setCfg(c => ({ ...c, ...p }));

  // 沪深 300 要用户点「准备数据」；示例池和自选打开就自动准备（几只到几十只，几秒钟）
  useEffect(() => {
    let alive = true;
    setRes(null);
    setErr(null);
    (async () => {
      const { codes } = await universeCodes(env, cfg.universe);
      const meta = await quantRepo.qfqMeta(core.db, codes);
      const have = cfg.universe !== 'hs300' || (codes.length >= 250 && meta.size >= codes.length * 0.9);
      if (!alive) {
        return;
      }
      setReady(have);
      if (!have) {
        return;
      }
      if (cfg.universe !== 'hs300') {
        await prepareBars(env, codes.slice(0, 60), p => alive && setProg(p));
      }
      const panel = await loadPanel(core.db, codes);
      try {
        const r = runFactorTest(panel, { factor: cfg.factor, hold: cfg.hold, groups: cfg.groups, costBp: cfg.costBp });
        if (alive) {
          setRes({ r, codes: panel.codes.length, from: panel.dates[0] ?? '' });
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

  const prepareHs300 = async () => {
    abort.current = new AbortController();
    setErr(null);
    try {
      const codes = await refreshHs300(env);
      const p = await prepareBars(env, codes, setProg, abort.current.signal);
      if (p.failed.length) {
        setErr(p.failed.length + ' 只没取到（停牌或接口出错），用其余的继续');
      }
      setCfg(c => ({ ...c }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const f = FACTORS[cfg.factor];
  useAiContext('FactorLab', () => ({
    name: '因子实验室',
    lines: res
      ? [f.name + '，' + UNIVERSE_NAME[cfg.universe] + '，' + res.codes + ' 只，每 ' + cfg.hold + ' 日调仓，' + cfg.groups + ' 组，单边成本万 ' + cfg.costBp, 'Rank IC 均值 ' + res.r.icMean.toFixed(3) + '，t ' + res.r.t.toFixed(2) + '，ICIR ' + res.r.icir.toFixed(2) + '，多空年化 ' + (res.r.longShortAnnual * 100).toFixed(1) + '%，' + res.r.periods + ' 期']
      : [f.name + '，' + UNIVERSE_NAME[cfg.universe] + '，' + (err ?? '计算中')],
    tip: '股票池是当前成分，有幸存者偏差；样本只有约 3 年，结论只当练习。t 值不到 2 不算显著。',
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
      <ScrollView contentContainerStyle={st.pad}>
        <View style={st.card}>
          <Chips label="股票池" items={(['sample', 'watch', 'hs300'] as UniverseId[]).map(u => [u, u === 'sample' ? '示例池' : u === 'watch' ? '自选 + 持仓' : '沪深 300'])} value={cfg.universe} onPick={universe => set({ universe })} />
          <Chips label="因子" items={FACTOR_IDS.map(id => [id, FACTORS[id].name])} value={cfg.factor} onPick={factor => set({ factor })} />
          <Chips label="调仓" items={[5, 10, 20, 60].map(v => [v, '每 ' + v + ' 日'])} value={cfg.hold} onPick={hold => set({ hold })} />
          <Chips label="分组" items={[3, 5, 10].map(v => [v, v + ' 组'])} value={cfg.groups} onPick={groups => set({ groups })} />
          <Chips label="单边成本" items={[0, 15, 30].map(v => [v, v ? '万 ' + v : '不扣'])} value={cfg.costBp} onPick={costBp => set({ costBp })} />
          <Text style={st.k}>{f.formula}{f.approx ? '（用今天的股本往回推，近似）' : ''} · 书里在 {f.section}</Text>
        </View>
        {ready === false ? (
          <View style={st.card}>
            <Text style={st.h}>准备沪深 300 数据</Text>
            <Text style={st.k}>取当前 300 只成分（新浪），每只 750 根前复权日线（腾讯，约 3 年），约 1 分钟、15 MB 流量。之后用到时只补过期的。</Text>
            {prog ? <Text style={[st.k, num]}>已完成 {prog.done} / {prog.total}{prog.failed.length ? '，' + prog.failed.length + ' 只失败' : ''}</Text> : null}
            <View style={st.row}>
              <Button title={prog && prog.done < prog.total ? '下载中…' : '准备数据'} tone="learn" disabled={!!prog && prog.done < prog.total} onPress={prepareHs300} style={st.grow} />
              {prog && prog.done < prog.total ? <Button title="停止" onPress={() => abort.current?.abort()} /> : null}
            </View>
          </View>
        ) : null}
        {err ? <Note tone="warn" style={st.note}>{err}</Note> : null}
        {!r && !err && ready ? <Text style={[st.k, st.padH]}>{prog && prog.done < prog.total ? '准备数据 ' + prog.done + ' / ' + prog.total : '计算中…'}</Text> : null}
        {r && res ? (
          <>
            <View style={st.stats}>
              {stat('Rank IC 均值', sgn(r.icMean, 3), Math.abs(r.icMean) >= 0.03 ? '过了 0.03' : '没到 0.03', Math.abs(r.icMean) < 0.03)}
              {stat('t 值', r.t.toFixed(2), r.periods + ' 期' + (Math.abs(r.t) < 2 ? '，不显著' : ''), Math.abs(r.t) < 2)}
              {stat('ICIR', r.icir.toFixed(2), '年化 ' + r.icirAnnual.toFixed(2))}
              {stat('IC 为正', (r.icPositive * 100).toFixed(0) + '%', '')}
              {stat('多空年化', sgn(r.longShortAnnual * 100, 1) + '%', cfg.costBp ? '已扣费' : '未扣费')}
              {stat('最高组换手', (r.turnover * 100).toFixed(0) + '%', '每期')}
            </View>
            <View style={st.charts}>
              {factorCharts(r, cfg.universe).map(c => (
                <ChartCard key={c.kind} data={c} />
              ))}
            </View>
            <Note style={st.note}>{res.codes} 只、{res.from} 起的前复权日线。股票池用的是当前成分，有幸存者偏差；t 值不到 2 不算显著。口径见《因子投资入门》4.1–4.5。</Note>
            <View style={st.row2}>
              <Button title="让 AI 解读" tone="learn" small style={st.grow} onPress={() => nav.navigate('Study', { bookId: SAMPLE_BOOK_ID, sectionId: f.section, ask: '解读一下因子实验室的结果：' + f.name + '、' + UNIVERSE_NAME[cfg.universe] + '、每 ' + cfg.hold + ' 日调仓、' + cfg.groups + ' 组、单边成本万 ' + cfg.costBp + '。用 factor_test 按同样的参数重跑一次再说结论。' })} />
              <Button title={'书里怎么说（' + f.section + '）'} small style={st.grow} onPress={() => nav.navigate('Study', { bookId: SAMPLE_BOOK_ID, sectionId: f.section, mode: 'read' })} />
            </View>
          </>
        ) : null}
      </ScrollView>
      <AiFab />
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
      <ScrollView contentContainerStyle={st.pad}>
        <View style={st.card}>
          <QuantChart data={c} full onPick={setI} />
          <Text style={[st.readout, num]}>{i == null ? '在图上按住或拖动，看每一天的数' : readout(c, i)}</Text>
        </View>
        <View style={st.card}>
          <Text style={st.h}>怎么算的</Text>
          {howComputed(c).map(x => (
            <Text key={x} style={st.body}>· {x}</Text>
          ))}
        </View>
        {c.kind === 'price' ? <Button title={'打开' + c.name + '个股页'} onPress={() => nav.navigate('Stock', { code: c.code, name: c.name })} style={st.btn} /> : null}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 96 },
  card: { backgroundColor: color.card, marginBottom: 8, paddingHorizontal: PAD, paddingVertical: 10, gap: 6 },
  cfgRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cfgK: { width: 56, fontSize: 13, color: color.ink2, paddingTop: 5 },
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: { borderRadius: 14, backgroundColor: color.bg, paddingHorizontal: 9, paddingVertical: 4 },
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
  padH: { paddingHorizontal: PAD, paddingVertical: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 10, paddingBottom: 8 },
  stat: { width: '31.8%', backgroundColor: color.card, borderRadius: 10, padding: 8 },
  statK: { fontSize: 10, color: color.ink3 },
  statV: { fontSize: 17, fontWeight: '600', color: color.ink },
  weak: { color: color.ink2 },
  charts: { paddingHorizontal: 10 },
  readout: { fontSize: 12, color: color.ink2, minHeight: 36 },
  btn: { marginHorizontal: 12 },
});
