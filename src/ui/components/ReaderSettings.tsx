import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReaderPreferences } from '../../study/readerPreferences';
import { rc } from '../readTheme';

export function ReaderSettings({ value, onChange, bilingual }: {
  value: ReaderPreferences;
  onChange: (next: ReaderPreferences) => void;
  bilingual: boolean;
}) {
  const choices = <K extends keyof ReaderPreferences>(key: K, label: string, items: [ReaderPreferences[K], string][]) => (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <View style={s.options} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {items.map(([v, title]) => <Pressable key={v} style={[s.option, value[key] === v && s.selected]}
          accessibilityRole="radio" accessibilityLabel={label + '：' + title} accessibilityState={{ checked: value[key] === v }}
          onPress={() => onChange({ ...value, [key]: v })}>
          <Text style={[s.optionText, value[key] === v && s.selectedText]}>{title}</Text>
        </Pressable>)}
      </View>
    </View>
  );
  return <View style={s.panel}>
    {choices('face', '字体', [['serif', '宋体'], ['sans', '黑体']])}
    {choices('size', '字号', [[16, '16'], [18, '18'], [20, '20'], [22, '22']])}
    {choices('leading', '行距', [['normal', '标准'], ['relaxed', '宽松']])}
    {bilingual ? choices('parallel', '对照', [['paragraph', '按段阅读'], ['sentence', '逐句核对']]) : null}
  </View>;
}

const s = StyleSheet.create({
  panel: { paddingHorizontal: 20, paddingBottom: 12, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rc.line },
  row: { flexDirection: 'row', alignItems: 'center', columnGap: 16 },
  label: { fontSize: 13, color: rc.secondary },
  options: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 48, minWidth: 48, flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderRadius: 6 },
  selected: { backgroundColor: rc.soft },
  optionText: { color: rc.secondary, fontSize: 14 },
  selectedText: { color: rc.ink, fontWeight: '600' },
});
