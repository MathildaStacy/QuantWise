/**
 * 听讲的对话（QUANTWISE_DESIGN.md §6）：按「一次提问」分组画：你的问题 → 工具步骤 → 讲解 → 图表 → 检查题 / 小结草稿。
 * 回到主线后的岔路折叠成一行，正在进行的岔路左侧紫线。只画，不请求模型。
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StoredMessage, ToolUi } from '../../ai/types';
import { secLabel } from '../../book/book';
import type { CiteCheck } from '../../book/markup';
import { citeCheck, progressNow, type StudySession } from '../../study/session';
import { ChartCard } from '../charts/ChartCard';
import { StudyText } from '../components/StudyText';
import { rc } from '../readTheme';

interface Turn {
  first: number;
  question: string | null;
  tools: ToolUi[];
  answers: StoredMessage[];
  /** 检查题和小结草稿要知道在哪条消息上。 */
  cards: { msgId: number; tool: ToolUi }[];
}

export function turnsOf(messages: StoredMessage[]): Turn[] {
  const out: Turn[] = [];
  for (const m of messages) {
    if (m.role === 'user' || !out.length) {
      out.push({ first: m.id, question: m.role === 'user' ? m.ui?.question ?? null : null, tools: [], answers: [], cards: [] });
      if (m.role === 'user') {
        continue;
      }
    }
    const t = out[out.length - 1];
    if (m.role === 'tool') {
      for (const x of m.ui?.tools ?? []) {
        t.tools.push(x);
        if (x.quiz || x.wrapup) {
          t.cards.push({ msgId: m.id, tool: x });
        }
      }
    } else {
      t.answers.push(m);
    }
  }
  return out;
}

const textOf = (m: StoredMessage) => m.parts.map(p => (p.t === 'text' ? p.text : '')).join('');

export interface ThreadActions {
  onLink: (href: string) => void;
  onPick: (msgId: number, toolId: string, k: number) => void;
  onWrapup: () => void;
  onStuck: (text: string) => void;
}

export function StudyThread({ s, busy, a, onTurnLayout }: { s: StudySession; busy: string | null; a: ThreadActions; onTurnLayout?: (id: number, box: { y: number; height: number }) => void }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const p = progressNow(s);
  // 引用校验只在读过的小节变了时重建，StudyText 才不会每次重画都重新解析
  const check = useMemo(() => citeCheck(s), [s.loaded, s.extra, s.sections, s.section, s.blocks]); // eslint-disable-line react-hooks/exhaustive-deps
  const folds = p.folds ?? [];
  const turns = turnsOf(s.messages);
  const out: { id: number; node: ReactElement }[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const f = folds.find(x => x.fromMsg === t.first);
    if (f) {
      const inside = turns.filter(x => x.first >= f.fromMsg && x.first <= f.toMsg);
      out.push({ id: f.fromMsg, node:
        <View>
          <Pressable style={st.fold} onPress={() => setOpen(o => ({ ...o, [f.fromMsg]: !o[f.fromMsg] }))} accessibilityRole="button" accessibilityState={{ expanded: !!open[f.fromMsg] }}>
            <Text style={st.foldT} numberOfLines={1}>已解决：{f.title}（{inside.length} 问）</Text>
            <Text style={st.foldS}>岔路 · {f.sectionId} {open[f.fromMsg] ? '▴' : '▾'}</Text>
          </Pressable>
          {open[f.fromMsg] ? inside.map(x => <TurnView key={x.first} t={x} detour a={a} check={check} streaming={false} />) : null}
          <Text style={st.sys}>回到 {secLabel(s.section)}：刚才讲到第 {f.step + 1} 步「{s.steps[f.step]?.title ?? ''}」</Text>
        </View>,
      });
      i += inside.length - 1;
      continue;
    }
    const detour = !!p.detour && t.first >= p.detour.fromMsg;
    out.push({ id: t.first, node: <TurnView t={t} detour={detour} a={a} check={check} streaming={!!busy && i === turns.length - 1} /> });
  }
  return (
    <View>
      {out.map(({ id, node }) => <View key={id} onLayout={e => onTurnLayout?.(id, e.nativeEvent.layout)}>{node}</View>)}
      {busy ? <Text style={st.busy}>{busy}</Text> : null}
    </View>
  );
}

function TurnView({ t, detour, a, check, streaming }: { t: Turn; detour: boolean; a: ThreadActions; check: CiteCheck; streaming: boolean }) {
  const charts = t.tools.flatMap(x => x.charts ?? []);
  return (
    <View style={detour && st.detour}>
      {t.question ? (
        <View style={st.uRow}>
          <Text style={st.u}>{t.question}</Text>
        </View>
      ) : null}
      {t.tools.length ? (
        <View style={st.tools}>
          {t.tools.map(x => (
            <Text key={x.id} style={[st.tool, x.error && st.toolErr]} numberOfLines={2}>
              ↳ {x.label}
            </Text>
          ))}
        </View>
      ) : null}
      {t.answers.map(m => {
        const text = textOf(m);
        return (
          <View key={m.id}>
            {text.trim() ? <StudyText text={text} check={check} onLink={a.onLink} streaming={streaming && m.id === -1} /> : null}
            {m.ui?.error ? <Text style={st.err}>{m.ui.error}</Text> : null}
          </View>
        );
      })}
      {charts.map((c, k) => (
        <ChartCard key={k} data={c} />
      ))}
      {t.cards.map(({ msgId, tool }) => (tool.quiz ? <Quiz key={tool.id} msgId={msgId} tool={tool} a={a} check={check} /> : <Wrap key={tool.id} tool={tool} a={a} />))}
    </View>
  );
}

function Quiz({ msgId, tool, a, check }: { msgId: number; tool: ToolUi; a: ThreadActions; check: CiteCheck }) {
  const q = tool.quiz!;
  const picked = q.picked >= 0;
  return (
    <View style={st.card}>
      <Text style={st.q}>{q.question}</Text>
      {q.options.map((o, k) => (
        <Pressable
          key={k}
          onPress={() => !picked && a.onPick(msgId, tool.id, k)}
          style={[st.opt, picked && k === q.answer && st.right, picked && k === q.picked && k !== q.answer && st.wrong]}
          accessibilityRole="radio"
          accessibilityState={{ checked: q.picked === k, disabled: picked }}
        >
          <Text style={st.optT}>{o}</Text>
        </Pressable>
      ))}
      {picked ? <>
        <Text style={st.explain}>{q.picked === q.answer ? '答对了。' : '不对。'}</Text>
        <StudyText text={q.explain} check={check} onLink={a.onLink} />
      </> : null}
      {picked && q.picked !== q.answer ? (
        <Pressable onPress={() => a.onStuck(q.question)} style={st.small} accessibilityRole="button">
          <Text style={st.smallT}>记成卡点</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Wrap({ tool, a }: { tool: ToolUi; a: ThreadActions }) {
  const w = tool.wrapup!;
  return (
    <View style={st.card}>
      <Text style={st.q}>本节小结草稿</Text>
      <Text style={st.explain}>{w.summary}</Text>
      <Text style={st.meta}>{w.cards.length} 张闪卡 · {w.stuck.length} 个卡点</Text>
      {w.status === 'pending' ? (
        <Pressable onPress={a.onWrapup} style={[st.small, st.primary]} accessibilityRole="button">
          <Text style={[st.smallT, st.white]}>去确认</Text>
        </Pressable>
      ) : (
        <Text style={st.meta}>{w.status === 'saved' ? '已保存' : '没有保存'}</Text>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  detour: { borderLeftWidth: 2, borderLeftColor: rc.detour, paddingLeft: 10 },
  uRow: { alignItems: 'flex-end', marginTop: 14, marginBottom: 6 },
  u: { backgroundColor: rc.user, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, maxWidth: '85%', fontSize: 15, lineHeight: 24, color: rc.ink, overflow: 'hidden' },
  tools: { marginVertical: 6, gap: 2 },
  tool: { fontSize: 12, color: rc.muted, lineHeight: 18 },
  toolErr: { color: '#B5462F' },
  err: { fontSize: 13, color: '#B5462F', marginVertical: 6 },
  sys: { textAlign: 'center', fontSize: 12, color: rc.muted, marginVertical: 10 },
  busy: { fontSize: 13, color: rc.accent, marginVertical: 10 },
  fold: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginVertical: 10, padding: 10, borderRadius: 10, backgroundColor: rc.detourBg },
  foldT: { flex: 1, fontSize: 13, color: rc.detour },
  foldS: { fontSize: 11, color: rc.detour },
  card: { marginVertical: 10, padding: 12, borderRadius: 12, backgroundColor: rc.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: rc.line, gap: 6 },
  q: { fontSize: 14, fontWeight: '600', color: rc.ink, lineHeight: 22 },
  opt: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: rc.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 },
  optT: { fontSize: 14, color: rc.ink },
  right: { borderColor: '#0F7B76', backgroundColor: rc.real },
  wrong: { borderColor: rc.stuck, backgroundColor: rc.stuckBg },
  explain: { fontSize: 13, color: rc.secondary, lineHeight: 21 },
  meta: { fontSize: 12, color: rc.muted },
  small: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', borderRadius: 14, borderWidth: 1, borderColor: rc.line, paddingHorizontal: 12, paddingVertical: 5 },
  smallT: { fontSize: 12, color: rc.secondary },
  primary: { backgroundColor: rc.main, borderColor: rc.main },
  white: { color: '#FFFFFF' },
});
