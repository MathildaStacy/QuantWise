import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ReaderPreferences } from '../../study/readerPreferences';
import { rc } from '../readTheme';
import { useBookTypography } from '../readerTypography';
import { AiSheet } from './AiOptions';

export function ReaderSettings({ value, onChange, bilingual, onClose }: {
  value: ReaderPreferences;
  onChange: (next: ReaderPreferences) => void;
  bilingual: boolean;
  onClose: () => void;
}) {
  const { body, translation } = useBookTypography();
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
  return <AiSheet title="阅读排版" visible onClose={onClose}>
    <ScrollView style={s.scroll} contentContainerStyle={s.panel}>
      <View style={s.preview}>
        {bilingual ? <Text style={body}>Read at your own pace.</Text> : null}
        <Text style={bilingual ? translation : body}>以适合你的节奏，读懂每一页。</Text>
      </View>
    {choices('face', '字体', [['serif', '宋体'], ['sans', '黑体']])}
    {choices('size', '字号', [[16, '16'], [18, '18'], [20, '20'], [22, '22']])}
    {choices('leading', '行距', [['normal', '标准'], ['relaxed', '宽松']])}
    {bilingual ? choices('parallel', '对照', [['paragraph', '按段阅读'], ['sentence', '逐句核对'], ['zh', '中文为主']]) : null}
    </ScrollView>
    <Pressable style={s.done} accessibilityRole="button" onPress={onClose}><Text style={s.doneText}>完成</Text></Pressable>
  </AiSheet>;
}

const s = StyleSheet.create({
  scroll: { flexShrink: 1 },
  panel: { paddingHorizontal: 20, paddingBottom: 12, gap: 8 },
  preview: { paddingVertical: 16, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rc.line, marginBottom: 8 },
  done: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginHorizontal: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: rc.line },
  doneText: { fontSize: 15, fontWeight: '600', color: rc.main },
  row: { flexDirection: 'row', alignItems: 'center', columnGap: 16 },
  label: { fontSize: 13, color: rc.secondary },
  options: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 48, minWidth: 48, flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderRadius: 6 },
  selected: { backgroundColor: rc.soft },
  optionText: { color: rc.secondary, fontSize: 14 },
  selectedText: { color: rc.ink, fontWeight: '600' },
});
