/**
 * 听讲的两个弹层：原文预览（点引用：这一块和前后各一块，可以「在读书模式打开」）、
 * 「AI 现在看到了什么」（每一层的内容和 token 估算，QUANTWISE_DESIGN.md §6.3）。
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { estimateTokens } from '../../ai/prompt';
import { secLabel } from '../../book/book';
import { threadContext } from '../../data/studyRepo';
import { STUDY_PROMPT } from '../../study/prompt';
import { progressNow, type StudySession } from '../../study/session';
import { STUDY_TOOL_DEFS } from '../../study/tools';
import { AiSheet } from '../components/AiOptions';
import { BookBlockView } from '../components/BookBlock';
import { useCore } from '../hooks';
import { rc } from '../readTheme';

export interface CiteTarget {
  sectionId: string;
  no: number;
}

export function CiteSheet({ target, s, onClose, onOpen }: { target: CiteTarget | null; s: StudySession; onClose: () => void; onOpen: (t: CiteTarget) => void }) {
  const sec = target ? s.sections.find(x => x.id === target.sectionId) : null;
  const blocks = target ? (target.sectionId === s.section.id ? s.blocks : s.extra[target.sectionId] ?? []) : [];
  const i = target ? blocks.findIndex(b => b.no === target.no) : -1;
  return (
    <AiSheet title={sec ? '原文 · ' + secLabel(sec) + ' ¶' + target!.no : '原文'} visible={!!target} onClose={onClose}>
      <ScrollView style={st.body}>
        {i < 0 ? <Text style={st.muted}>这一块还没加载</Text> : null}
        {blocks.slice(Math.max(0, i - 1), i + 2).map(b => (
          <View key={b.seq} style={[st.b, b.no === target?.no && st.on]}>
            <BookBlockView b={b} dir={s.book.body.dir} compact />
          </View>
        ))}
      </ScrollView>
      <Pressable style={st.btn} onPress={() => target && onOpen(target)} accessibilityRole="button">
        <Text style={st.btnT}>在读书模式打开</Text>
      </Pressable>
    </AiSheet>
  );
}

const k = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

export function ContextSheet({ visible, s, onClose }: { visible: boolean; s: StudySession; onClose: () => void }) {
  const core = useCore();
  const [ctx, setCtx] = useState<string | null>(null);
  useEffect(() => {
    if (visible && s.threadId) {
      threadContext(core.db, s.threadId).then(setCtx).catch(() => undefined);
    }
  }, [visible, s.threadId, core]);
  const map = ctx ? ctx.slice(0, ctx.indexOf('<current_section>')) : '';
  const cur = ctx ? ctx.slice(ctx.indexOf('<current_section>')) : s.blocks.map(b => b.text).join('\n');
  const loaded = [...s.loaded].filter(x => !x.includes('#') && x !== s.section.id);
  const history = s.messages.reduce((n, m) => n + m.parts.reduce((a, p) => a + (p.t === 'text' ? p.text : p.t === 'call' ? p.args : p.output).length, 0), 0);
  const rows: [string, string, number, boolean][] = [
    ['工具定义', STUDY_TOOL_DEFS.length + ' 个：读书 6、行情与因子 3、只读行情 7；没有下单、转账', estimateTokens(JSON.stringify(STUDY_TOOL_DEFS)), true],
    ['1 讲解规则', '讲解顺序、引用和来源标记、只引用读过的原文、举例优先用真实行情', estimateTokens(STUDY_PROMPT), true],
    ['2 书的地图', ctx ? s.sections.length + ' 个标题 + 已学小节的摘要（这一节的对话开始时拍的快照）' : '第一次提问时拍快照', estimateTokens(map), true],
    ['3 当前原文', secLabel(s.section) + ' 全部 ' + s.blocks.length + ' 个块', estimateTokens(cur), true],
    ['4 读过的其他小节', loaded.length ? loaded.join('、') : '还没有', 0, false],
    ['5 对话', s.messages.length + ' 条（含工具结果）', Math.round(history * 0.8), false],
    ['6 这次附带', '<study_state>：现在讲第 ' + (s.state.step + 1) + ' 步' + (progressNow(s).skipped.length ? '、跳过的步' : '') + '、没解决的卡点', 150, false],
  ];
  return (
    <AiSheet title="AI 现在看到了什么" visible={visible} onClose={onClose}>
      <ScrollView style={st.body}>
        {rows.map(([t, d, n, c]) => (
          <View key={t} style={st.row}>
            <View style={st.grow}>
              <Text style={st.rowT}>
                {t}
                {c ? <Text style={st.cache}>  缓存</Text> : null}
              </Text>
              <Text style={st.rowD}>{d}</Text>
            </View>
            <Text style={st.n}>{n ? k(n) : '—'}</Text>
          </View>
        ))}
        <Text style={st.muted}>只有当前原文和 load_section / search_book 读到的块能被引用，引用到别处的标「未核实」。缓存断点在第 3 层之后，同一节反复问很省。</Text>
      </ScrollView>
    </AiSheet>
  );
}

const st = StyleSheet.create({
  body: { maxHeight: 460, paddingHorizontal: 16 },
  b: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6, opacity: 0.6 },
  on: { backgroundColor: rc.highlight, opacity: 1 },
  btn: { margin: 16, borderRadius: 10, borderWidth: 1, borderColor: rc.line, paddingVertical: 10, alignItems: 'center' },
  btnT: { fontSize: 15, color: rc.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rc.line },
  grow: { flex: 1 },
  rowT: { fontSize: 14, fontWeight: '600', color: rc.ink },
  cache: { fontSize: 11, fontWeight: '400', color: rc.realInk },
  rowD: { fontSize: 12, color: rc.muted, marginTop: 2, lineHeight: 18 },
  n: { fontSize: 13, color: rc.secondary, fontVariant: ['tabular-nums'] },
  muted: { fontSize: 12, color: rc.muted, lineHeight: 18, paddingVertical: 10 },
});
