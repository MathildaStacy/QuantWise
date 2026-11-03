/**
 * 听讲的两个弹层：原文预览（点引用：这一块和前后各一块，可以「在读书模式打开」）、
 * 「AI 现在看到了什么」（每一层的内容和 token 估算，QUANTWISE_DESIGN.md §6.3）。
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EFFORT_NAME, prettyModel } from '../../ai/models';
import { estimateTokens } from '../../ai/prompt';
import type { AiService } from '../../ai/types';
import { secLabel } from '../../book/book';
import { threadContext } from '../../data/studyRepo';
import { lastRequestTokens, studyBudget } from '../../study/compact';
import { resolveStudyService } from '../../study/config';
import { STUDY_PROMPT } from '../../study/prompt';
import { progressNow, type StudySession } from '../../study/session';
import { STUDY_TOOL_DEFS } from '../../study/tools';
import { AiSheet } from '../components/AiOptions';
import { BookBlockView } from '../components/BookBlock';
import { PdfSourceSheet } from '../components/PdfSourceSheet';
import { useCore } from '../hooks';
import { rc } from '../readTheme';

export interface CiteTarget {
  sectionId: string;
  no: number;
}

export function CiteSheet({ target, s, onClose, onOpen }: { target: CiteTarget | null; s: StudySession; onClose: () => void; onOpen: (t: CiteTarget) => void }) {
  const [sourcePage, setSourcePage] = useState<number | null>(null);
  const [nearby, setNearby] = useState(false);
  useEffect(() => { setNearby(false); setSourcePage(null); }, [target?.sectionId, target?.no]);
  const sec = target ? s.sections.find(x => x.id === target.sectionId) : null;
  const blocks = target ? (target.sectionId === s.section.id ? s.blocks : s.extra[target.sectionId] ?? []) : [];
  const i = target ? blocks.findIndex(b => b.no === target.no) : -1;
  return (
    <><AiSheet title={sec ? '原文 · ' + secLabel(sec) + ' ¶' + target!.no : '原文'} visible={!!target && sourcePage == null} onClose={onClose}>
      <ScrollView key={target?.sectionId + ':' + target?.no} style={st.body}>
        {i < 0 ? <Text style={st.muted}>这一块还没加载</Text> : null}
        {i >= 0 ? <View style={[st.b, st.on]}><BookBlockView b={blocks[i]} dir={s.book.body.dir} compact /></View> : null}
        {i >= 0 && (i > 0 || i + 1 < blocks.length) ? <>
          <Pressable style={st.disclosure} accessibilityRole="button" accessibilityState={{ expanded: nearby }} onPress={() => setNearby(v => !v)}>
            <Text style={st.btnT}>{nearby ? '收起前后文' : '查看前后文'}</Text>
            {nearby ? <ChevronUp size={18} color={rc.secondary} /> : <ChevronDown size={18} color={rc.secondary} />}
          </Pressable>
          {nearby ? [blocks[i - 1], blocks[i + 1]].map((b, n) => b ? <View key={b.seq} style={st.b}>
            <Text style={st.muted}>{n === 0 ? '前一段' : '后一段'}</Text><BookBlockView b={b} dir={s.book.body.dir} compact />
          </View> : null) : null}
        </> : null}
      </ScrollView>
      <View style={st.actions}>
      {i >= 0 && s.book.format === 'pdf' && s.book.body.dir && blocks[i].page != null ? <Pressable style={st.btn} accessibilityRole="button" onPress={() => setSourcePage(blocks[i].page)}><Text style={st.btnT}>查看 PDF 第 {blocks[i].page} 页</Text></Pressable> : null}
      <Pressable style={st.btn} disabled={i < 0} accessibilityState={{ disabled: i < 0 }} onPress={() => target && onOpen(target)} accessibilityRole="button">
        <Text style={st.btnT}>在读书模式打开</Text>
      </Pressable>
      </View>
    </AiSheet>{sourcePage != null ? <PdfSourceSheet book={s.book} initialPage={sourcePage} onClose={() => setSourcePage(null)} /> : null}</>
  );
}

const k = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

export function ContextSheet({ visible, s, onClose }: { visible: boolean; s: StudySession; onClose: () => void }) {
  const core = useCore();
  const [ctx, setCtx] = useState<string | null>(null);
  const [svc, setSvc] = useState<AiService | null>(null);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setCtx(null); setSvc(null); setDetails(false);
    if (s.threadId) threadContext(core.db, s.threadId).then(value => { if (alive) setCtx(value); }).catch(() => undefined);
    resolveStudyService(core.db, s.config).then(value => { if (alive) setSvc(value); }).catch(() => undefined);
    return () => { alive = false; };
  }, [visible, s.threadId, s.config, core]);
  const boundary = ctx?.indexOf('<current_section>') ?? -1;
  const map = ctx && boundary >= 0 ? ctx.slice(0, boundary) : '';
  const cur = ctx && boundary >= 0 ? ctx.slice(boundary) : s.blocks.map(b => b.text).join('\n');
  const loaded = [...s.loaded].filter(x => !x.includes('#') && x !== s.section.id);
  const loadedNames = loaded.map(id => s.sections.find(x => x.id === id)).filter(x => x != null).map(secLabel);
  const live = s.messages.filter(m => !m.compacted);
  const history = live.reduce((n, m) => n + m.parts.reduce((a, p) => a + (p.t === 'text' ? p.text : p.t === 'call' ? p.args : p.output).length, 0), 0);
  const budget = svc ? studyBudget(svc) : null;
  const lastSize = lastRequestTokens(s.messages);
  const rows: [string, string, number, boolean][] = [
    ['工具定义', STUDY_TOOL_DEFS.length + ' 项读书与行情工具', estimateTokens(JSON.stringify(STUDY_TOOL_DEFS)), true],
    ['讲解规则', '讲解顺序、原文引用、来源标记和举例方式', estimateTokens(STUDY_PROMPT), true],
    ['书的地图', ctx ? s.sections.length + ' 个标题和已学小节摘要，会话开始时保存' : '第一次提问时保存', estimateTokens(map), true],
    ['当前原文', s.blocks.length + ' 个原文块', estimateTokens(cur), true],
    ...(s.summary ? [['讲解摘要', '较早的讲解已整理，后续从摘要接着讲', estimateTokens(s.summary), true] as [string, string, number, boolean]] : []),
    ['对话记录', live.length + ' 条，含工具结果', Math.round(history * 0.8), false],
    ['学习进度', '当前步骤' + (progressNow(s).skipped.length ? '、已跳过的步骤' : '') + '和未解决的卡点', 150, false],
  ];
  return (
    <AiSheet title="AI 现在看到了什么" visible={visible} onClose={onClose}>
      <ScrollView style={st.body}>
        <View style={st.contextItem}><Text style={st.rowT}>当前原文</Text><Text style={st.contextText}>{secLabel(s.section)}</Text><Text style={st.rowD}>本节全部 {s.blocks.length} 个原文块</Text></View>
        <View style={st.contextItem}><Text style={st.rowT}>其他已读小节</Text><Text style={st.contextText}>{loadedNames.length ? loadedNames.join('、') : '还没有读过其他完整小节'}</Text></View>
        <View style={st.contextItem}><Text style={st.rowT}>讲解进度</Text><Text style={st.contextText}>第 {s.state.step + 1} / {s.steps.length} 步 · {s.steps[s.state.step]?.title}</Text><Text style={st.rowD}>{live.length} 条对话记录，含工具结果{live.length < s.messages.length ? '；较早内容已整理成摘要' : ''}</Text></View>
        {s.config ? <View style={st.contextItem}><Text style={st.rowT}>模型与偏好</Text><Text style={st.contextText}>{prettyModel(s.config.model)} · 思考{EFFORT_NAME[s.config.effort]} · 搜索{s.config.search ? '开' : '关'}</Text></View> : null}
        {s.summary ? <View style={st.summary}><Text style={st.rowT}>讲解摘要</Text><Text style={st.contextText}>{s.summary}</Text></View> : null}
        <Pressable style={st.disclosure} accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails(v => !v)}>
          <Text style={st.btnT}>请求与用量明细</Text>{details ? <ChevronUp size={18} color={rc.secondary} /> : <ChevronDown size={18} color={rc.secondary} />}
        </Pressable>
        {details ? <>
        <Text style={st.muted}>以下词元数量为估算，缓存是否命中以供应商返回为准。</Text>
        {rows.map(([t, d, n, c]) => (
          <View key={t} style={st.row}>
            <View style={st.grow}>
              <Text style={st.rowT}>
                {t}
                {c ? <Text style={st.cache}>  固定上下文</Text> : null}
              </Text>
              <Text style={st.rowD}>{d}</Text>
            </View>
            <Text style={st.n}>{n ? k(n) : '—'}</Text>
          </View>
        ))}
        {budget ? (
          <Text style={st.muted}>
            {'上一次请求约 ' + (lastSize != null ? k(lastSize) : '—') + ' 词元；超过 ' + k(budget.compactAt) + ' 时回答后整理较早讲解，接近 ' + k(budget.hardAt) + ' 时先整理再问。'}
          </Text>
        ) : null}
        <Text style={st.muted}>引用来自当前原文与工具读到的内容，未读到的引用会标「未核实」。更换模型、思考强度或搜索设置后，下次提问会重建上下文。</Text>
        </> : null}
      </ScrollView>
    </AiSheet>
  );
}

const st = StyleSheet.create({
  body: { flexShrink: 1, paddingHorizontal: 16 },
  b: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6 },
  on: { backgroundColor: rc.highlight },
  actions: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  btn: { minHeight: 48, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: rc.line, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' },
  btnT: { fontSize: 15, color: rc.ink },
  disclosure: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  contextItem: { paddingVertical: 12, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rc.line },
  contextText: { fontSize: 15, lineHeight: 24, color: rc.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rc.line },
  grow: { flex: 1 },
  rowT: { fontSize: 14, fontWeight: '600', color: rc.ink },
  cache: { fontSize: 11, fontWeight: '400', color: rc.realInk },
  rowD: { fontSize: 12, color: rc.muted, marginTop: 2, lineHeight: 18 },
  n: { fontSize: 13, color: rc.secondary, fontVariant: ['tabular-nums'] },
  muted: { fontSize: 12, color: rc.muted, lineHeight: 18, paddingVertical: 10 },
  summary: { padding: 10, borderRadius: 8, backgroundColor: rc.soft, gap: 4 },
});
