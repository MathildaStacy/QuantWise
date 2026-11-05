/**
 * 指数池（沪深 300、中证 500、中证 1000）的「准备数据」：取当前成分、每只约 5 年前复权日线，进度可停。
 * 讲解里 factor_test 说数据没准备时这条结果下面出这张卡，准备好后接着重做那次检验；因子实验室共用同一张卡。
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { universeEnv } from '../../ai/tools/quant';
import type { AppCore } from '../../app/boot';
import { INDEX_POOLS, poolStatus, prepareBars, refreshIndex, type IndexPoolId } from '../../quant/universe';
import { rc } from '../readTheme';
import { num } from '../theme';

export interface PrepState {
  pool: IndexPoolId;
  done: number;
  total: number;
  running: boolean;
  error?: string;
}

/** 准备一个指数池；准备好（成分取全、九成以上有日线）后调 onReady。离开页面时停下。 */
export function usePoolPrepare(core: AppCore, onReady: (pool: IndexPoolId, codes: number) => void) {
  const [prep, setPrep] = useState<PrepState | null>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => () => abort.current?.abort(), []);
  const start = async (pool: IndexPoolId) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await run(pool);
    } finally {
      busy.current = false;
    }
  };
  const run = async (pool: IndexPoolId) => {
    const ctl = new AbortController();
    abort.current = ctl;
    setPrep({ pool, done: 0, total: INDEX_POOLS[pool].size, running: true });
    const env = universeEnv(core);
    try {
      const codes = await refreshIndex(env, pool);
      const p = await prepareBars(env, codes, x => setPrep({ pool, done: x.done, total: x.total, running: true }), ctl.signal);
      if (ctl.signal.aborted) {
        setPrep({ pool, done: p.done, total: p.total, running: false, error: '已停下，已取到的留着，下次只补没取到的' });
        return;
      }
      const st = await poolStatus(env, pool);
      if (p.halted || !st.ready) {
        setPrep({ pool, done: p.done, total: p.total, running: false, error: p.halted ?? p.failed.length + ' 只没取到，数据还不够用，过几分钟再试' });
        return;
      }
      setPrep({ pool, done: p.total, total: p.total, running: false, ...(p.failed.length ? { error: p.failed.length + ' 只没取到（停牌或接口出错），用其余的继续' } : {}) });
      ready.current(pool, st.codes.length);
    } catch (e) {
      setPrep({ pool, done: 0, total: INDEX_POOLS[pool].size, running: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
  return { prep, start, stop: () => abort.current?.abort() };
}

/** pending：还没准备（没算）；否则是数据过期或只有约 3 年，可以更新。 */
export function PrepareCard({ pool, pending, prep, onStart, onStop, after }: {
  pool: IndexPoolId;
  pending: boolean;
  prep: PrepState | null;
  onStart: () => void;
  onStop: () => void;
  /** 按钮上「准备数据」后面的话，例如「并重做这次检验」。 */
  after?: string;
}) {
  const p = INDEX_POOLS[pool];
  const mine = prep?.pool === pool ? prep : null;
  const running = !!mine?.running;
  // 要写 accessibilityLabel：Android 上没有它时 busy 变回 false 不会清掉读屏文字，按钮会一直读「busy」。
  const label = running ? '下载中…' : (pending ? '准备数据' : '更新数据') + (after ?? '');
  return (
    <View style={st.card}>
      <Text style={st.h}>{pending ? '准备' + p.short + ' 数据' : p.short + ' 的数据较旧'}</Text>
      <Text style={st.k}>
        {(pending ? '' : '本地数据过期或只有约 3 年，这次先用了已有的。') + '取当前 ' + p.size + ' 只成分（' + p.source + '），每只约 5 年前复权日线（腾讯），约 ' + p.minutes + ' 分钟、' + p.mb + ' MB 流量，建议连 Wi-Fi。之后用到时只补过期的。'}
      </Text>
      {mine && (running || mine.done > 0) ? <Text style={[st.k, num]}>已完成 {mine.done} / {mine.total}</Text> : null}
      {mine?.error ? <Text style={st.err}>{mine.error}</Text> : null}
      <View style={st.row}>
        <Pressable onPress={onStart} disabled={running} style={[st.btn, st.main, running && st.off]} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: running, busy: running }}>
          <Text style={st.mainT}>{label}</Text>
        </Pressable>
        {running ? (
          <Pressable onPress={onStop} style={st.btn} accessibilityRole="button">
            <Text style={st.btnT}>停止</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginVertical: 10, padding: 12, borderRadius: 12, backgroundColor: rc.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, gap: 6 },
  h: { fontSize: 14, fontWeight: '600', color: rc.ink, lineHeight: 22 },
  k: { fontSize: 12, lineHeight: 18, color: rc.secondary },
  err: { fontSize: 12, lineHeight: 18, color: '#B5462F' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  btn: { minHeight: 48, justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: rc.line, paddingHorizontal: 14, paddingVertical: 5 },
  btnT: { fontSize: 13, color: rc.secondary },
  main: { backgroundColor: rc.main, borderColor: rc.main },
  mainT: { fontSize: 13, color: '#FFFFFF', fontWeight: '600' },
  off: { opacity: 0.6 },
});
