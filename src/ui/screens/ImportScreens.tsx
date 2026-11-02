/**
 * PDF 解析设置（页数、分片、模型、上传确认）、解析进度、MinerU Token、讲解偏好（QUANTWISE_DESIGN.md §5、§6.2）。
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as bookRepo from '../../data/bookRepo';
import * as repo from '../../data/repos';
import { mineruClient, mineruToken, planPdf, retryParse, runParse, startPdfImport, useParse, type PdfPlan } from '../../study/importer';
import type { MineruModel } from '../../study/import/mineru';
import { DEFAULT_STUDY_PREFS, STUDY_PREFS_KEY, type StudyPrefs } from '../../study/session';
import { Button, NavBar, Note } from '../components/ui';
import { useCore } from '../hooks';
import type { RootScreenProps, RootStackParamList } from '../navigation/types';
import { rc } from '../readTheme';
import { color, num, PAD } from '../theme';
import { toast } from '../toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function Radio({ on, title, sub, onPress }: { on: boolean; title: string; sub?: string; onPress: () => void }) {
  return (
    <Pressable style={st.radioRow} onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }}>
      <View style={[st.radio, on && st.radioOn]} />
      <View style={st.grow}>
        <Text style={st.body}>{title}</Text>
        {sub ? <Text style={st.k}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

export function ImportBookScreen({ route }: RootScreenProps<'ImportBook'>) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const { path, name, size } = route.params;
  const [plan, setPlan] = useState<PdfPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [model, setModel] = useState<MineruModel>('vlm');
  const [ocr, setOcr] = useState(true);
  const [token, setToken] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    planPdf(path).then(setPlan).catch(e => setErr(e instanceof Error ? e.message : String(e)));
  }, [path]);
  useFocusEffect(useCallback(() => {
    let active = true;
    mineruToken.get().then(t => active && setToken(!!t)).catch(() => active && setToken(false));
    return () => { active = false; };
  }, []));
  const start = async () => {
    setBusy(true);
    try {
      const id = await startPdfImport(core, { path, name, model, ocr });
      nav.replace('ParseProgress', { bookId: id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <View style={st.page}>
      <NavBar title="解析设置" back />
      <ScrollView contentContainerStyle={st.pad}>
        <View style={st.card}>
          <Text style={st.h}>{name}</Text>
          <Text style={[st.k, num]}>{(size / 1e6).toFixed(1)} MB{plan ? ' · ' + plan.pages + ' 页 · 分 ' + plan.parts.length + ' 片（每片 ≤ 200 页）' : ' · 读取页数…'}</Text>
          {plan && plan.parts.length > 1 ? <Text style={st.k}>{plan.parts.map(p => p.pageFrom + '–' + p.pageTo).join('、')}：同一个文件按页码范围提交，会上传 {plan.parts.length} 次</Text> : null}
        </View>
        <View style={st.card}>
          <Text style={st.h}>解析模型</Text>
          <Radio on={model === 'vlm'} title="vlm（默认）" sub="公式、表格和复杂排版更准" onPress={() => setModel('vlm')} />
          <Radio on={model === 'pipeline'} title="pipeline" sub="更快，适合文字为主的书" onPress={() => setModel('pipeline')} />
          <View style={st.switchRow}>
            <View style={st.grow}>
              <Text style={st.body}>OCR 文字识别</Text>
              <Text style={st.k}>{ocr ? '推荐开启，减少公式、负号和变量的识别错误' : '已关闭，文字层中的公式和符号可能遗漏'}</Text>
            </View>
            <Switch accessibilityLabel="OCR 文字识别" value={ocr} onValueChange={setOcr} />
          </View>
        </View>
        {token === false ? (
          <Note tone="warn" style={st.note}>还没有 MinerU Token。先去「我的 → 解析服务（MinerU）」填写。</Note>
        ) : null}
        {plan?.blocked ? <Note tone="warn" style={st.note}>{plan.blocked}</Note> : null}
        {err ? <Note tone="warn" style={st.note}>{err}</Note> : null}
        <Note style={st.note}>确认后，这本书会上传到 MinerU 服务器解析（每个账号每天 1000 页高优先级，超出后排队变慢）。结果（Markdown、内容块、图片）存在本机，之后阅读、讲解、搜索都不再联网解析。</Note>
        <View style={st.row}>
          {token === false ? <Button title="填写 Token" onPress={() => nav.navigate('MineruSettings')} style={st.grow} /> : null}
          <Button title={busy ? '准备中…' : '上传并解析'} tone="learn" disabled={!plan || !!plan.blocked || !token || busy} onPress={start} style={st.grow} />
        </View>
      </ScrollView>
    </View>
  );
}

const PART_STATE: Record<bookRepo.PartState, string> = { pending: '等待上传', uploading: '上传中', parsing: 'MinerU 解析中', done: '完成', failed: '失败' };

export function ParseProgressScreen({ route }: RootScreenProps<'ParseProgress'>) {
  const core = useCore();
  const nav = useNavigation<Nav>();
  const { bookId } = route.params;
  const prog = useParse(x => x[bookId]);
  const [parts, setParts] = useState<bookRepo.BookPart[]>([]);
  const [book, setBook] = useState<Awaited<ReturnType<typeof bookRepo.book>>>(null);
  useEffect(() => {
    runParse(core, bookId).catch(() => undefined);
    let alive = true;
    const tick = async () => {
      const [b, p] = await Promise.all([bookRepo.book(core.db, bookId), bookRepo.parts(core.db, bookId)]);
      if (alive) {
        setBook(b);
        setParts(p);
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [core, bookId]);
  const done = book?.status === 'ready';
  const failed = book?.status === 'failed';
  const pauseError = prog?.error || book?.error;
  const paused = !done && !failed && !!pauseError;
  return (
    <View style={st.page}>
      <NavBar title="解析进度" back />
      <ScrollView contentContainerStyle={st.pad}>
        <View style={st.card}>
          <Text style={st.h}>{book?.title ?? ''}</Text>
          <View style={st.track}>
            <View style={[st.fill, { width: Math.round((done ? 1 : prog?.done ?? 0) * 100) + '%' }]} />
          </View>
          <Text style={st.k}>{done ? '完成 · ' + (book?.pages ?? 0) + ' 页 · ' + (book?.body.leaves ?? 0) + ' 个小节' : failed ? '失败：' + (book?.error ?? '') : (paused ? '已暂停' : prog?.stage || '排队中') + ' · 可以离开这个页面，回来接着看'}</Text>
        </View>
        <View style={st.card}>
          {parts.map(p => (
            <View key={p.partNo} style={st.partRow}>
              <Text style={[st.body, num]}>第 {p.partNo} 片 · p.{p.pageFrom}–{p.pageTo}</Text>
              <Text style={[st.k, p.state === 'failed' && st.bad]}>{PART_STATE[p.state]}{p.error ? '：' + p.error : ''}</Text>
            </View>
          ))}
        </View>
        {paused ? <Note tone="warn" style={st.note}>{pauseError}</Note> : null}
        <View style={st.row}>
          {done ? <Button title="看书的地图" tone="learn" onPress={() => nav.replace('BookMap', { bookId })} style={st.grow} /> : null}
          {failed ? <Button title="重试失败的片" tone="learn" onPress={() => retryParse(core, bookId).catch(e => toast.show(String(e), 'bad'))} style={st.grow} /> : null}
          {paused ? <Button title="继续" tone="learn" onPress={() => runParse(core, bookId)} style={st.grow} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

export function MineruSettingsScreen() {
  const [saved, setSaved] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const reload = () => mineruToken.get().then(t => setSaved(t ? t.slice(-4) : null)).catch(() => setSaved(null));
  useEffect(() => {
    reload();
  }, []);
  const save = async () => {
    if (!input.trim()) {
      return;
    }
    await mineruToken.set(input.trim());
    setInput('');
    setMsg('已保存');
    reload();
  };
  const test = async () => {
    setMsg('测试中…');
    const r = await mineruClient().test();
    setMsg(r.ok ? '连接正常（' + r.latencyMs + ' ms）' : '不通：' + (r.error?.message ?? ''));
  };
  return (
    <View style={st.page}>
      <NavBar title="解析服务（MinerU）" back />
      <ScrollView contentContainerStyle={st.pad} keyboardShouldPersistTaps="handled">
        <View style={st.card}>
          <Text style={st.body}>Token：{saved ? '已保存，末 4 位 ' + saved : '还没有'}</Text>
          <TextInput value={input} onChangeText={setInput} placeholder="粘贴 MinerU 的 API Token" placeholderTextColor={color.ink3} secureTextEntry autoCapitalize="none" style={st.input} />
          <View style={st.row0}>
            <Button title="保存" tone="learn" small disabled={!input.trim()} onPress={save} style={st.grow} />
            <Button title="测试连接" small disabled={!saved} onPress={test} style={st.grow} />
            {saved ? <Button title="删除" small onPress={() => mineruToken.remove().then(reload)} style={st.grow} /> : null}
          </View>
          {msg ? <Text style={st.k}>{msg}</Text> : null}
        </View>
        <Note style={st.note}>Token 在 mineru.net 的「API 管理」申请，存在 Android Keystore，不写进日志和导出文件。单文件 ≤ 200 MB、≤ 200 页（App 会自动按页分片）；每天 1000 页高优先级，用完排队变慢、不拦截。</Note>
      </ScrollView>
    </View>
  );
}

export function StudyPrefsScreen() {
  const core = useCore();
  const [p, setP] = useState<StudyPrefs>(DEFAULT_STUDY_PREFS);
  useEffect(() => {
    repo.getSetting<StudyPrefs>(core.db, STUDY_PREFS_KEY, DEFAULT_STUDY_PREFS).then(v => setP({ ...DEFAULT_STUDY_PREFS, ...v }));
  }, [core]);
  const set = (patch: Partial<StudyPrefs>) => {
    const next = { ...p, ...patch };
    setP(next);
    repo.setSetting(core.db, STUDY_PREFS_KEY, next);
  };
  return (
    <View style={st.page}>
      <NavBar title="讲解偏好" back />
      <ScrollView contentContainerStyle={st.pad}>
        <View style={st.card}>
          <Text style={st.h}>举例</Text>
          <Radio on={p.example === 'real'} title="优先用真实 A 股行情" sub="讲到能用价量数据说明的概念时，AI 调用画图和因子工具现算" onPress={() => set({ example: 'real' })} />
          <Radio on={p.example === 'book'} title="优先用书里的例子" onPress={() => set({ example: 'book' })} />
          <Radio on={p.example === 'ai'} title="可以自己编例子" sub="编的例子标「AI 举例」" onPress={() => set({ example: 'ai' })} />
        </View>
        <View style={st.card}>
          <Text style={st.h}>检查题</Text>
          <Radio on={p.quiz === 'step'} title="每一步讲完问一个" onPress={() => set({ quiz: 'step' })} />
          <Radio on={p.quiz === 'end'} title="一节讲完再问" onPress={() => set({ quiz: 'end' })} />
          <Radio on={p.quiz === 'off'} title="不出题" onPress={() => set({ quiz: 'off' })} />
        </View>
        <View style={[st.card, st.switchRow]}>
          <Text style={[st.body, st.grow]}>术语第一次出现时中英对照</Text>
          <Switch value={p.terms} onValueChange={terms => set({ terms })} />
        </View>
        <Note style={st.note}>讲解模型用 AI 助手当前选的模型（「我的 → 供应商与模型」）。改偏好后，伴读的缓存会重建一次。</Note>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  pad: { paddingBottom: 40 },
  card: { backgroundColor: color.card, marginBottom: 8, paddingHorizontal: PAD, paddingVertical: 10, gap: 6 },
  h: { fontSize: 15, fontWeight: '600', color: color.ink },
  body: { fontSize: 14, color: color.ink },
  k: { fontSize: 12, color: color.ink3, lineHeight: 18 },
  bad: { color: color.up },
  grow: { flex: 1 },
  note: { marginHorizontal: 10, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingTop: 4 },
  row0: { flexDirection: 'row', gap: 8 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#C5CAD0' },
  radioOn: { borderWidth: 5, borderColor: rc.main },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  track: { height: 4, borderRadius: 2, backgroundColor: color.line, overflow: 'hidden', marginVertical: 4 },
  fill: { height: 4, backgroundColor: rc.main },
  partRow: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, gap: 2 },
  input: { height: 40, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line, paddingHorizontal: 10, fontSize: 14, color: color.ink },
});
