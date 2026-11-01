/** 不联网、不需要 Key 的内置概念体验；与原书、实验和伴读共用入口。 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SAMPLE_BOOK_ID } from '../../book/sample';
import { completeStudyIntro } from '../../study/intro';
import { Button, Details, NavBar } from '../components/ui';
import { useCore } from '../hooks';
import type { RootStackParamList } from '../navigation/types';
import { rc, serif } from '../readTheme';
import { toast } from '../toast';

export function StudyIntroScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const core = useCore();
  const safe = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const choose = async (n: number) => {
    if (saving) return;
    if (n !== 1) { setAnswer(n); return; }
    setSaving(true);
    try {
      await completeStudyIntro(core.db);
      setAnswer(1);
    } catch (e) { toast.show('体验记录保存失败：' + String(e), 'bad'); }
    finally { setSaving(false); }
  };
  return <View style={s.page}>
    <NavBar title="动量入门" sub="内置体验 · 无需连接 AI" back />
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: 24 + safe.bottom }]}>
      <Text style={s.meta}>第 {step + 1} / 3 步</Text>
      {step === 0 ? <>
        <Text style={s.title}>动量，先看过去的涨幅</Text>
        <Text style={s.quote}>动量是过去一段时间的累计收益。</Text>
        <Text style={s.meta}>《因子投资入门》3.1 · 内置教材</Text>
        <Text style={s.body}>把同一天的股票放在一起比较：过去涨得更多的，动量排名更高。</Text>
        <Text style={s.body}>这描述的是过去，还不是对未来收益的保证。</Text>
        <Button title="看一个例子" tone="learn" onPress={() => setStep(1)} />
      </> : step === 1 ? <>
        <Text style={s.title}>比较的是相对排名</Text>
        <View style={s.example}><Text style={s.meta}>教学例子 · 非实际行情</Text><Text style={s.body}>过去 20 天，A 涨了 8%，B 涨了 3%。在同一天，A 的动量排名在 B 前面。</Text></View>
        <Text style={s.body}>之后两只都可能下跌。排名更高，并不等于一定赚钱。</Text>
        <Details title="动量怎么算？"><Text style={s.body}>当前复权价格 ÷ n 个交易日前复权价格 − 1。</Text></Details>
        <Button title="判断一下" tone="learn" onPress={() => setStep(2)} />
      </> : <>
        <Text style={s.title}>排名高，就一定赚钱吗？</Text>
        <Text style={s.body}>A 的过去 20 天涨幅高于 B，能否确定 A 之后会上涨？</Text>
        <Button disabled={saving} title="能，涨得多就会继续上涨" onPress={() => choose(0)} />
        <Button disabled={saving} title="不能，过去的排名不保证未来上涨" onPress={() => choose(1)} />
        {answer != null ? <Text style={[s.body, s.feedback]} accessibilityLiveRegion="polite">{answer === 1 ? '对。还要检验新样本中的收益关系，并考虑交易成本。' : '再想一步：排名描述的是过去。你可以重新选择。'}</Text> : null}
        {answer === 1 ? <>
          <Button title="看真实因子实验" tone="learn" onPress={() => nav.navigate('FactorLab', { factor: 'mom20' })} />
          <Button title="保存本节小结" onPress={() => nav.navigate('Study', { bookId: SAMPLE_BOOK_ID, sectionId: '3.1', mode: 'read', wrapup: true })} />
          <Button title="进入 AI 讲解，自由追问" onPress={() => nav.navigate('Study', { bookId: SAMPLE_BOOK_ID, sectionId: '3.1', mode: 'lecture' })} />
        </> : null}
      </>}
      <Button title="直接读原文" onPress={() => nav.navigate('Study', { bookId: SAMPLE_BOOK_ID, sectionId: '3.1', mode: 'read' })} />
      {step > 0 ? <Button title="上一步" onPress={() => setStep(v => v - 1)} /> : null}
    </ScrollView>
  </View>;
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: rc.page },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 24, lineHeight: 34, fontWeight: '600', color: rc.ink },
  body: { fontSize: 16, lineHeight: 27, color: rc.ink },
  meta: { fontSize: 13, lineHeight: 20, color: rc.secondary },
  quote: { fontFamily: serif, fontSize: 21, lineHeight: 35, color: rc.ink, paddingVertical: 12 },
  example: { padding: 16, borderRadius: 12, backgroundColor: rc.example, gap: 8 },
  feedback: { color: rc.realInk, backgroundColor: rc.real, padding: 14, borderRadius: 12 },
});
