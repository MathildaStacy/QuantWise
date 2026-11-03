/**
 * 听讲的对话（QUANTWISE_DESIGN.md §6）：按「一次提问」分组画：你的问题 → 工具步骤 → 讲解和图表（按消息顺序：
 * 图画在调用它的地方、讲这张图的文字之前，见 docs/design/ai-lecture-charts.md §4）→ 检查题 / 小结草稿
 * → 网页来源和用量（默认收起）。回到主线后的岔路折叠成一行，正在进行的岔路左侧紫线；较早整理成摘要的部分上方一条说明。
 * 只画，不请求模型。
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { prettyModel } from '../../ai/models';
import { addUsage, ZERO_USAGE } from '../../ai/prompt';
import type { SearchSource, StoredMessage, ToolUi, Usage } from '../../ai/types';
import { secLabel } from '../../book/book';
import type { ChartData } from '../../quant/charts';
import type { CiteCheck } from '../../book/markup';
import { citeCheck, progressNow, type StudySession } from '../../study/session';
import { MARKET_TOOLS } from '../../study/tools';
import { ChartCard } from '../charts/ChartCard';
import { pinnable, type PinSpot, type TurnInfo } from '../charts/ChartPin';
import { StudyText } from '../components/StudyText';
import { rc } from '../readTheme';
import { usageText } from './AiScreen';

interface Turn {
  first: number;
  question: string | null;
  /** 换了模型 / 思考 / 搜索之后的第一问：「更换模型：从这里起用 GPT-6.1-sol · 思考低」。 */
  divider?: string;
  /** 从原文某一段发起的提问：那一段的出处和开头。 */
  source?: NonNullable<StoredMessage['ui']>['studySource'];
  /** 这一问已经整理进摘要（不再发给模型，界面照常显示）。 */
  compacted: boolean;
  tools: ToolUi[];
  answers: StoredMessage[];
  /** 讲解文字和图按消息顺序：工具结果里的图排在它后面那段讲解之前。 */
  flow: ({ m: StoredMessage } | { id: number; charts: ChartData[] })[];
  /** 检查题和小结草稿要知道在哪条消息上。 */
  cards: { msgId: number; tool: ToolUi }[];
}

export function turnsOf(messages: StoredMessage[]): Turn[] {
  const out: Turn[] = [];
  for (const m of messages) {
    if (m.role === 'user' || !out.length) {
      out.push({ first: m.id, question: m.role === 'user' ? m.ui?.question ?? null : null, divider: m.role === 'user' ? m.ui?.divider : undefined, source: m.role === 'user' ? m.ui?.studySource : undefined, compacted: m.compacted, tools: [], answers: [], flow: [], cards: [] });
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
      const charts = (m.ui?.tools ?? []).flatMap(x => x.charts ?? []);
      if (charts.length) {
        t.flow.push({ id: m.id, charts });
      }
    } else {
      t.answers.push(m);
      t.flow.push({ m });
    }
  }
  return out;
}

/** 每一问讲解里的「真实行情」有没有工具算出的数撑着：这一问或更早成功调用过行情、因子工具才算。 */
export function realChecked(turns: Turn[]): Map<number, boolean> {
  const out = new Map<number, boolean>();
  let ok = false;
  for (const t of turns) {
    ok = ok || t.tools.some(x => !x.error && MARKET_TOOLS.has(x.name));
    out.set(t.first, ok);
  }
  return out;
}

const textOf = (m: StoredMessage) => m.parts.map(p => (p.t === 'text' ? p.text : '')).join('');

/** 每一问的文字（问题 + 讲解）和画了几张图：讲解页决定钉哪张图（ChartPin 的 pinOf）。 */
export function turnInfo(messages: StoredMessage[]): Map<number, TurnInfo> {
  return new Map(
    turnsOf(messages).map(t => [
      t.first,
      { text: [t.question ?? '', ...t.answers.map(textOf)].join('\n'), charts: t.flow.reduce((n, x) => n + ('charts' in x ? x.charts.length : 0), 0) },
    ]),
  );
}

type TurnBox = { y: number; height: number };

/** 一问（或折叠起来的岔路）在对话里的位置：量出来报给外面；卸下时（岔路折叠起来）报 null，外面不留过期的位置。 */
function Slot({ id, report, children }: { id: number; report?: (id: number, box: TurnBox | null) => void; children: ReactElement }) {
  const ref = useRef(report);
  ref.current = report;
  useEffect(() => () => ref.current?.(id, null), [id]);
  return <View onLayout={e => report?.(id, e.nativeEvent.layout)}>{children}</View>;
}

export interface ThreadActions {
  onLink: (href: string) => void;
  onPick: (msgId: number, toolId: string, k: number) => void;
  onWrapup: () => void;
  onStuck: (text: string) => void;
  /** 「开启搜索并重问」（搜索关着、问的是最新资料时）。 */
  onSearch?: (question: string) => void;
  /** 点「较早的 n 问已整理成摘要」。 */
  onSummary?: () => void;
  /** 用户展开详情前暂停跟随，避免内容增高把当前回答推走。 */
  onDisclosure?: () => void;
  /** 图上点中某一天后「问这一天」：把这一天的读数带到输入框。 */
  onAskChart?: (text: string) => void;
}

export function StudyThread({ s, busy, a, onTurnLayout, onChartBox }: {
  s: StudySession;
  busy: string | null;
  a: ThreadActions;
  onTurnLayout?: (id: number, box: TurnBox | null) => void;
  /** 价格图和对比图的画线区域在它那一问里的位置（讲解页滚过去之后钉小图用）；图卸下时报 null。折叠的岔路里的图不报。 */
  onChartBox?: (key: string, spot: PinSpot | null) => void;
}) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const p = progressNow(s);
  // 引用校验只在读过的小节变了时重建，StudyText 才不会每次重画都重新解析
  const check = useMemo(() => citeCheck(s), [s.loaded, s.extra, s.sections, s.section, s.blocks]); // eslint-disable-line react-hooks/exhaustive-deps
  const folds = p.folds ?? [];
  const turns = turnsOf(s.messages);
  const checked = realChecked(turns);
  const out: { id: number; node: ReactElement }[] = [];
  const compacted = turns.filter(t => t.compacted && t.question != null).length;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (compacted && !t.compacted && (i === 0 || turns[i - 1].compacted)) {
      out.push({ id: -1000 - t.first, node:
        <Pressable onPress={a.onSummary} disabled={!a.onSummary} accessibilityRole="button" style={st.compact}>
          <Text style={st.compactT}>较早的 {compacted} 问已整理成摘要（保留进度、卡点和检查题结果）{a.onSummary ? ' · 查看摘要' : ''}</Text>
        </Pressable>,
      });
    }
    const f = folds.find(x => x.fromMsg === t.first);
    if (f) {
      const inside = turns.filter(x => x.first >= f.fromMsg && x.first <= f.toMsg);
      out.push({ id: f.fromMsg, node:
        <View>
          <Pressable style={st.fold} onPress={() => { a.onDisclosure?.(); setOpen(o => ({ ...o, [f.fromMsg]: !o[f.fromMsg] })); }} accessibilityRole="button" accessibilityState={{ expanded: !!open[f.fromMsg] }}>
            <Text style={st.foldT} numberOfLines={1}>已解决：{f.title}（{inside.length} 问）</Text>
            <Text style={st.foldS}>岔路 · {f.sectionId} {open[f.fromMsg] ? '▴' : '▾'}</Text>
          </Pressable>
          {open[f.fromMsg] ? inside.map(x => <TurnView key={x.first} t={x} detour a={a} check={check} streaming={false} realOk={!!checked.get(x.first)} />) : null}
          <Text style={st.sys}>回到 {secLabel(s.section)}：刚才讲到第 {f.step + 1} 步「{s.steps[f.step]?.title ?? ''}」</Text>
        </View>,
      });
      i += inside.length - 1;
      continue;
    }
    const detour = !!p.detour && t.first >= p.detour.fromMsg;
    out.push({ id: t.first, node: <TurnView t={t} detour={detour} a={a} check={check} streaming={!!busy && i === turns.length - 1} realOk={!!checked.get(t.first)} onChartBox={onChartBox} /> });
  }
  return (
    <View>
      {out.map(({ id, node }) => <Slot key={id} id={id} report={onTurnLayout}>{node}</Slot>)}
    </View>
  );
}

function TurnView({ t, detour, a, check, streaming, realOk, onChartBox }: { t: Turn; detour: boolean; a: ThreadActions; check: CiteCheck; streaming: boolean; realOk: boolean; onChartBox?: (key: string, spot: PinSpot | null) => void }) {
  const offer = t.answers.map(m => m.ui?.searchOffer).find(Boolean);
  return (
    <View style={detour && st.detour}>
      {t.divider ? <Text style={st.sys}>{t.divider}</Text> : null}
      {t.question ? (
        <View style={st.uRow}>
          {t.source ? <Pressable style={st.sourceQuote} accessibilityRole="button" accessibilityLabel={'查看提问原文 ' + t.source.label}
            onPress={() => a.onLink('cite:' + t.source!.sectionId + '#' + t.source!.no)}>
            <Text style={st.sourceLabel}>{'提问原文 · ' + t.source.label}</Text>
            <Text style={st.sourceExcerpt} numberOfLines={3}>{t.source.text}</Text>
          </Pressable> : null}
          <Text style={st.u}>{t.question}</Text>
        </View>
      ) : null}
      <ToolRecords tools={t.tools} onDisclosure={a.onDisclosure} />
      {t.flow.map(x => {
        if ('charts' in x) {
          return x.charts.map((c, k) => {
            const key = x.id + ':' + k;
            const box = onChartBox && pinnable(c) ? (b: { y: number; h: number } | null) => onChartBox(key, b && { turn: t.first, ...b, data: c }) : undefined;
            return <ChartCard key={'c' + key} data={c} onBox={box} onAsk={a.onAskChart} />;
          });
        }
        const m = x.m;
        const text = textOf(m);
        return (
          <View key={m.id}>
            {text.trim() ? <StudyText text={text} check={check} onLink={a.onLink} streaming={streaming && m.id === -1} realChecked={realOk} /> : null}
            {m.ui?.error ? <Text style={st.err}>{m.ui.error}</Text> : null}
          </View>
        );
      })}
      {t.cards.map(({ msgId, tool }) => (tool.quiz ? <Quiz key={tool.id} msgId={msgId} tool={tool} a={a} check={check} /> : <Wrap key={tool.id} tool={tool} a={a} />))}
      {offer && a.onSearch && !streaming ? (
        <Pressable onPress={() => a.onSearch!(offer)} style={st.small} accessibilityRole="button">
          <Text style={st.smallT}>开启搜索并重问</Text>
        </Pressable>
      ) : null}
      {streaming ? null : <TurnFooter answers={t.answers} onLink={a.onLink} onDisclosure={a.onDisclosure} />}
    </View>
  );
}

function ToolRecords({ tools, onDisclosure }: { tools: ToolUi[]; onDisclosure?: () => void }) {
  const [open, setOpen] = useState(false);
  const done = tools.filter(x => !x.error);
  if (!tools.length) return null;
  return <View style={st.tools}>
    {tools.filter(x => x.error).map(x => <Text key={x.id} style={[st.tool, st.toolErr]} accessibilityRole="alert">执行失败 · {x.label}</Text>)}
    {done.length ? <>
      <Pressable style={st.toolToggle} accessibilityRole="button" accessibilityLabel={'工具记录，' + done.length + ' 项成功'} accessibilityState={{ expanded: open }}
        onPress={() => { onDisclosure?.(); setOpen(v => !v); }}>
        <Text style={st.tool}>工具记录 · {done.length} 项成功</Text>
        {open ? <ChevronUp size={16} color={rc.secondary} /> : <ChevronDown size={16} color={rc.secondary} />}
      </Pressable>
      {open ? done.map(x => <Text key={x.id} style={st.tool}>{x.label}</Text>) : null}
    </> : null}
  </View>;
}

const hostOf = (url: string) => /^https?:\/\/([^/]+)/.exec(url)?.[1]?.replace(/^www\./, '') ?? url;

/** 一问的网页来源和用量：默认收起成一行，点开看明细（只显示接口实际返回的数据）。 */
function TurnFooter({ answers, onLink, onDisclosure }: { answers: StoredMessage[]; onLink: (href: string) => void; onDisclosure?: () => void }) {
  const [open, setOpen] = useState(false);
  const sources: SearchSource[] = [];
  let usage: Usage | null = null;
  for (const m of answers) {
    for (const x of m.ui?.search?.sources ?? []) {
      if (!sources.some(y => y.url === x.url)) sources.push(x);
    }
    if (m.ui?.usage) usage = addUsage(usage ?? ZERO_USAGE, m.ui.usage);
  }
  const last = [...answers].reverse().find(m => m.ui?.service);
  if (!usage && !sources.length) return null;
  const model = last?.ui?.config ? prettyModel(last.ui.config.model) : last?.ui?.service?.split(' · ').pop() ?? '';
  return (
    <View style={st.footer}>
      <Pressable onPress={() => { onDisclosure?.(); setOpen(v => !v); }} style={st.footerRow} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={st.meta} numberOfLines={1}>
          {[model, sources.length ? '来源 ' + sources.length + ' 个' : '', '用量'].filter(Boolean).join(' · ')} {open ? '▴' : '▾'}
        </Text>
      </Pressable>
      {open ? (
        <View style={st.footerIn}>
          {sources.map((x, k) => (
            <Pressable key={x.url} onPress={() => onLink(x.url)} accessibilityRole="link" style={st.source}>
              <Text style={st.sourceT} numberOfLines={2}>{k + 1}. {x.title || hostOf(x.url)}</Text>
              <Text style={st.meta} numberOfLines={1}>{hostOf(x.url)}</Text>
            </Pressable>
          ))}
          {usage ? <Text style={st.meta}>{usageText(usage, { price: last?.ui?.price ?? null })}</Text> : null}
        </View>
      ) : null}
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
  toolToggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8 },
  tool: { fontSize: 12, color: rc.muted, lineHeight: 18 },
  toolErr: { color: '#B5462F' },
  err: { fontSize: 13, color: '#B5462F', marginVertical: 6 },
  sys: { textAlign: 'center', fontSize: 12, color: rc.muted, marginVertical: 10 },
  sourceQuote: { maxWidth: '85%', alignSelf: 'flex-end', minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, gap: 4, borderLeftWidth: 1, borderLeftColor: rc.line, marginBottom: 6 },
  sourceLabel: { fontSize: 12, lineHeight: 20, color: rc.main },
  sourceExcerpt: { fontSize: 13, lineHeight: 21, color: rc.secondary },
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
  compact: { minHeight: 48, justifyContent: 'center', marginVertical: 6, paddingHorizontal: 12, borderRadius: 10, backgroundColor: rc.soft },
  compactT: { fontSize: 12, lineHeight: 18, color: rc.secondary, textAlign: 'center' },
  footer: { marginTop: 2, marginBottom: 6 },
  footerRow: { minHeight: 48, justifyContent: 'center' },
  footerIn: { gap: 6, paddingBottom: 4 },
  source: { minHeight: 48, justifyContent: 'center', paddingVertical: 4 },
  sourceT: { fontSize: 13, lineHeight: 19, color: rc.ink },
});
