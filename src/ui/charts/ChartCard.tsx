/** 对话里的图表卡片：标题、「真实行情」标签、图、图例、口径，点「全屏」看十字线读数。 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Maximize2 } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { chartTitle, SUB_NAME, type ChartData } from '../../quant/charts';
import { FACTORS } from '../../quant/factors';
import { UNIVERSE_NAME, type UniverseId } from '../../quant/universe';
import type { RootStackParamList } from '../navigation/types';
import { groupColor, rc, SERIES_COLORS } from '../readTheme';
import { color } from '../theme';
import { QuantChart } from './QuantChart';

export function legendOf(c: ChartData): { color: string; label: string; dashed?: boolean }[] {
  switch (c.kind) {
    case 'price':
      return [
        { color: rc.main, label: '收盘（前复权）' },
        ...(c.ma ? [{ color: '#E08A1E', label: 'MA' + c.ma.n }] : []),
        ...(c.band ? [{ color: '#9DB4D8', label: '布林带', dashed: true }] : []),
        ...(c.sub ? [{ color: c.sub.kind.startsWith('mom') ? color.up : '#9DB4D8', label: SUB_NAME[c.sub.kind] + '（下）' }] : []),
      ];
    case 'compare':
      return c.series.map((s, k) => ({ color: SERIES_COLORS[k % SERIES_COLORS.length], label: s.name }));
    case 'factor':
      return [
        ...c.groups.map((_, k) => ({ color: groupColor(k, c.groups.length), label: 'Q' + (k + 1) + (k === 0 ? ' 因子最低' : k === c.groups.length - 1 ? ' 因子最高' : '') })),
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
      return c.code + ' · 前复权日线 · 腾讯行情';
    case 'compare':
      return '起点 = 100 · 前复权日线';
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

export function ChartCard({ data }: { data: ChartData }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title} numberOfLines={1}>
          {chartTitle(data)}
        </Text>
        <Text style={s.tag}>真实行情</Text>
      </View>
      <QuantChart data={data} />
      <View style={s.legend}>
        {legendOf(data).map(l => (
          <View key={l.label} style={s.li}>
            <View style={[s.dot, dotColor(l), l.dashed && s.dash]} />
            <Text style={s.lt}>{l.label}</Text>
          </View>
        ))}
      </View>
      <View style={s.foot}>
        <Text style={s.ft} numberOfLines={1}>
          {chartFoot(data)}
        </Text>
        <Pressable onPress={() => nav.navigate('ChartFull', { chart: data })} hitSlop={8} accessibilityRole="button" accessibilityLabel="全屏查看图表" style={s.full}>
          <Maximize2 size={13} color={rc.main} />
          <Text style={s.fullT}>全屏</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginVertical: 10, borderRadius: 12, backgroundColor: rc.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2, gap: 8 },
  title: { flex: 1, fontSize: 13, fontWeight: '600', color: rc.ink },
  tag: { fontSize: 10, color: rc.realInk, backgroundColor: rc.real, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 10, rowGap: 2 },
  li: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 10, height: 3, borderRadius: 2, borderWidth: 0 },
  dash: { height: 0, borderTopWidth: 2, borderStyle: 'dashed' },
  lt: { fontSize: 11, color: rc.secondary },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 8 },
  ft: { flex: 1, fontSize: 11, color: rc.muted },
  full: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  fullT: { fontSize: 12, color: rc.main },
});
