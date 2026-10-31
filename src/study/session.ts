/**
 * 伴读运行时（QUANTWISE_DESIGN.md §6、§8）：一个小节一个对话（ai_thread.kind = 'study'）。
 * 精简的工具循环：拼请求 → 调模型（流式）→ 执行工具 → 再请求，最多 6 轮。复用 AI 助手的协议层、服务配置、Key
 * 和消息存法；不做压缩、联网搜索、MCP、操作卡。界面通过 useStudy 读状态。
 */
import { create } from 'zustand';
import { activeService, aiKeys, aiTransport } from '../ai/chat';
import { AiError, callModel } from '../ai/http';
import { EMPTY_ANSWER_ERROR } from '../ai/messageText';
import { buildRequest } from '../ai/protocol';
import { installId, setProviderCache } from '../ai/services';
import type { AiService, Part, StoredMessage, ToolUi } from '../ai/types';
import type { AppCore } from '../app/boot';
import { citeLabel, leavesOf, secLabel } from '../book/book';
import { planSteps, type LessonStep } from '../book/steps';
import type { Book, BookBlock, BookSection } from '../book/types';
import * as aiRepo from '../data/aiRepo';
import * as bookRepo from '../data/bookRepo';
import * as repo from '../data/repos';
import * as studyRepo from '../data/studyRepo';
import { beijingIso } from '../market/clock';
import { STUDY_PROMPT, studyContext, studyState } from './prompt';
import { quick, type QuickKind } from './quick';
import { runStudyTool, STUDY_TOOL_DEFS } from './tools';

export const MAX_STUDY_ROUNDS = 6;

export interface StudySession {
  book: Book;
  sections: BookSection[];
  section: BookSection;
  blocks: BookBlock[];
  steps: LessonStep[];
  state: studyRepo.StudyState;
  threadId: number | null;
  messages: StoredMessage[];
  /** 读过原文、能被引用的小节（当前小节 + load_section）和块（search_book 命中的「3.1#2」）。 */
  loaded: Set<string>;
  /** 引用要显示页码时用：读过的小节的块。 */
  extra: Record<string, BookBlock[]>;
  /** 距上次打开几天（≥ 1 天时显示续学回顾）。 */
  awayDays: number;
}

interface StudyStore {
  s: StudySession | null;
  busy: string | null;
  error: string | null;
}

export const useStudy = create<StudyStore>(() => ({ s: null, busy: null, error: null }));

let abort: AbortController | null = null;

export function stopStudy(): void {
  abort?.abort();
}

const patch = (f: (s: StudySession) => Partial<StudySession>) =>
  useStudy.setState(st => (st.s ? { s: { ...st.s, ...f(st.s) } } : st));

export const progressNow = (s: StudySession) => studyRepo.progressOf(s.state, s.section.id);

/** 打开一本书的某一节（不给就打开上次的主线小节）；不请求模型。 */
export async function openSection(
  core: AppCore,
  bookId: string,
  sectionId?: string,
  mode?: studyRepo.StudyMode,
): Promise<void> {
  const book = await bookRepo.book(core.db, bookId);
  if (!book) {
    throw new Error('这本书不在书架上了');
  }
  const sections = await bookRepo.sections(core.db, bookId);
  const leaves = leavesOf(sections);
  const now = beijingIso();
  const old = await studyRepo.getState(core.db, bookId);
  const target =
    leaves.find(x => x.id === (sectionId ?? old?.main)) ?? leaves[0];
  if (!target) {
    throw new Error('这本书没有能学的小节');
  }
  const awayDays = old
    ? Math.max(0, Math.round((Date.parse(now.slice(0, 10)) - Date.parse(old.activeAt.slice(0, 10))) / 86400000))
    : 0;
  // 回到同一节接着上次的步骤；换到别的节时从那一节讲到的地方开始，没讲过就从第 1 步
  const step =
    old && old.main === target.id
      ? old.step
      : Math.max(0, old?.sections[target.id]?.taught ?? 0);
  const state: studyRepo.StudyState = {
    bookId,
    main: target.id,
    step,
    mode: mode ?? old?.mode ?? 'lecture',
    activeAt: now,
    sections: old?.sections ?? {},
  };
  await studyRepo.saveState(core.db, state);
  const blocks = await bookRepo.sectionBlocks(core.db, bookId, target.id);
  const threadId = await studyRepo.studyThreadId(core.db, bookId, target.id);
  const messages = threadId ? await aiRepo.messages(core.db, threadId) : [];
  const s: StudySession = {
    book,
    sections,
    section: target,
    blocks,
    steps: planSteps(blocks),
    state,
    threadId,
    messages,
    loaded: loadedOf(target.id, messages),
    extra: {},
    awayDays: messages.length ? 0 : awayDays,
  };
  useStudy.setState({ s, error: null });
  await loadExtra(core, s);
}

/** 从历史里找出读过的小节和块（引用校验用）。 */
export function loadedOf(main: string, messages: StoredMessage[]): Set<string> {
  const out = new Set([main]);
  for (const m of messages) {
    for (const t of m.ui?.tools ?? []) {
      if (t.section && !t.error) {
        out.add(t.section.id);
      }
      for (const c of t.cites ?? []) {
        out.add(c);
      }
    }
  }
  return out;
}

async function loadExtra(core: AppCore, s: StudySession): Promise<void> {
  const want = [...s.loaded].filter(x => !x.includes('#') && x !== s.section.id && !s.extra[x]);
  if (!want.length) {
    return;
  }
  const extra = { ...s.extra };
  for (const id of want) {
    extra[id] = await bookRepo.sectionBlocks(core.db, s.book.id, id);
  }
  patch(() => ({ extra }));
}

/** 引用校验（§6.5）：所在小节读过、或者这个块被 search_book 命中过，并且块存在。 */
export function citeCheck(s: StudySession) {
  return (sectionId: string, no: number): string | null => {
    if (!s.loaded.has(sectionId) && !s.loaded.has(sectionId + '#' + no)) {
      return null;
    }
    const sec = s.sections.find(x => x.id === sectionId);
    const blocks = sectionId === s.section.id ? s.blocks : s.extra[sectionId];
    if (!sec) {
      return null;
    }
    if (blocks) {
      const b = blocks.find(x => x.no === no);
      return b ? citeLabel(sec, b) : null;
    }
    return citeLabel(sec, { no, page: null });
  };
}

// ---------- 请求 ----------

export interface StudyPrefs {
  example: 'real' | 'book' | 'ai';
  quiz: 'step' | 'end' | 'off';
  terms: boolean;
}
export const STUDY_PREFS_KEY = 'studyPrefs';
export const DEFAULT_STUDY_PREFS: StudyPrefs = { example: 'real', quiz: 'step', terms: true };

/** 讲解偏好接在讲解协议后面；改偏好会让伴读的缓存重建一次。 */
export function prefsText(p: StudyPrefs): string {
  const lines = [
    p.example === 'real' ? '举例优先用真实 A 股行情（工具现算）' : p.example === 'book' ? '举例优先用书里的例子' : '可以自己编例子（写在 [[example]] 里）',
    p.quiz === 'step' ? '每一步讲完问一个检查问题' : p.quiz === 'end' ? '中间不出检查题，一节讲完再出' : '不出检查题',
    ...(p.terms ? [] : ['术语不用中英对照']),
  ];
  return '\n\n## 讲解偏好\n' + lines.map(l => '- ' + l).join('\n');
}

async function build(core: AppCore, svc: AiService, threadId: number) {
  const prefs = await repo.getSetting<StudyPrefs>(core.db, STUDY_PREFS_KEY, DEFAULT_STUDY_PREFS);
  return buildRequest({
    service: svc,
    system: STUDY_PROMPT + prefsText({ ...DEFAULT_STUDY_PREFS, ...prefs }),
    context: (await studyRepo.threadContext(core.db, threadId)) || '（没有书的上下文）',
    tools: svc.capabilities?.tools === false ? [] : STUDY_TOOL_DEFS,
    history: (await aiRepo.messages(core.db, threadId)).filter(m => !m.compacted),
    cache: svc.cache === 'auto',
    effort: svc.effort,
    cacheKey: await installId(core.db),
    stream: true,
  });
}

/** 调一次模型；服务不认缓存 / 思考参数时去掉重发（和 AI 助手 §6.4 一样）。 */
async function call(core: AppCore, svc0: AiService, key: string, threadId: number, signal: AbortSignal, onText: (t: string) => void) {
  let svc = svc0;
  for (let attempt = 0; ; attempt++) {
    const req = await build(core, svc, threadId);
    try {
      return { res: await callModel(svc, key, req, { signal, fetchImpl: aiTransport(), onText }), svc };
    } catch (e) {
      if (!(e instanceof AiError) || !e.compat || attempt >= 2) {
        throw e;
      }
      if (e.compat === 'cache' && svc.cache === 'auto') {
        svc = { ...svc, cache: 'off' };
        await setProviderCache(core.db, svc.id, 'off');
      } else if (e.compat === 'effort' && svc.effort !== 'off') {
        svc = { ...svc, effort: 'off' };
      } else {
        throw e;
      }
    }
  }
}

// ---------- 提问 ----------

export interface StudyAsk {
  /** 对话里显示的文字（快捷动作是按钮上的字）。 */
  label: string;
  /** 发给模型的问题。 */
  question: string;
  /** 这次讲第几步（快捷动作带）；自由提问不改步骤。 */
  step?: number;
  /** 「这步熟，跳过」跳过的步。 */
  skip?: number;
  /** 从读书模式某一段发起的：问答结束后贴一个便签在这一段上。 */
  pinSeq?: number;
}

export function quickAsk(s: StudySession, kind: QuickKind, block?: BookBlock): StudyAsk {
  const step = block ? s.steps.findIndex(x => x.from <= block.no && block.no <= x.to) : s.state.step;
  const q = quick(kind, {
    steps: s.steps,
    step: Math.max(0, step),
    block: block ? { label: citeLabel(s.section, block), text: block.text } : undefined,
  });
  return {
    label: q.label,
    question: q.question,
    step: q.step,
    skip: kind === 'skip' ? s.state.step + 1 : undefined,
    pinSeq: kind === 'explainBlock' ? block?.seq : undefined,
  };
}

async function reload(core: AppCore, threadId: number): Promise<void> {
  const messages = await aiRepo.messages(core.db, threadId);
  const cur = useStudy.getState().s;
  if (!cur || cur.threadId !== threadId) {
    return;
  }
  const loaded = loadedOf(cur.section.id, messages);
  patch(() => ({ messages, loaded }));
  await loadExtra(core, { ...cur, loaded });
}

/** 对话里还没告诉模型的检查题作答、小结确认结果；顺便标成已告诉。 */
async function collectResults(core: AppCore, msgs: StoredMessage[]): Promise<string[]> {
  const out: string[] = [];
  for (const m of msgs) {
    if (m.role !== 'tool' || !m.ui?.tools) {
      continue;
    }
    let changed = false;
    const tools = m.ui.tools.map((t): ToolUi => {
      if (t.quiz && t.quiz.picked >= 0 && !t.quiz.reported) {
        changed = true;
        const right = t.quiz.picked === t.quiz.answer;
        out.push('检查题「' + t.quiz.question + '」：用户选了「' + t.quiz.options[t.quiz.picked] + '」，' + (right ? '答对了' : '答错了（正确是「' + t.quiz.options[t.quiz.answer] + '」）'));
        return { ...t, quiz: { ...t.quiz, reported: true } };
      }
      if (t.wrapup && t.wrapup.status === 'dismissed' && !t.wrapup.reported) {
        changed = true;
        out.push('本节小结草稿：用户没有保存');
        return { ...t, wrapup: { ...t.wrapup, reported: true } };
      }
      return t;
    });
    if (changed) {
      const ui = { ...m.ui, tools };
      await aiRepo.updateMessageUi(core.db, m.id, ui);
      m.ui = ui;
    }
  }
  return out;
}

export async function askStudy(core: AppCore, a: StudyAsk): Promise<void> {
  const s0 = useStudy.getState().s;
  if (!s0 || !a.question.trim() || useStudy.getState().busy) {
    return;
  }
  let svc = await activeService(core);
  if (!svc) {
    throw new AiError('auth', '请先在「我的 → 供应商与模型」配置 Key 并启用一个对话模型');
  }
  const key = await aiKeys().get(svc.id);
  if (!key) {
    throw new AiError('auth', '「' + svc.name + '」还没有保存 API Key');
  }
  svc = { ...svc, search: false, mcp: false };
  const now = beijingIso();
  let threadId = s0.threadId;
  if (threadId == null) {
    const notes = await studyRepo.notesOf(core.db, s0.book.id);
    threadId = await studyRepo.createStudyThread(
      core.db,
      { title: secLabel(s0.section), bookId: s0.book.id, sectionId: s0.section.id, context: studyContext(s0.book, s0.sections, notes, s0.section, s0.blocks) },
      now,
    );
  }
  const p = { ...progressNow(s0) };
  const step = a.step == null ? s0.state.step : Math.max(0, Math.min(s0.steps.length - 1, a.step));
  if (a.step != null) {
    p.taught = Math.max(p.taught, step);
  }
  if (a.skip != null && !p.skipped.includes(a.skip)) {
    p.skipped = [...p.skipped, a.skip];
  }
  const state = { ...s0.state, step, activeAt: now, sections: { ...s0.state.sections, [s0.section.id]: p } };
  await studyRepo.saveState(core.db, state);
  const stuck = (await studyRepo.stuckOf(core.db, s0.book.id)).filter(x => !x.resolvedAt).map(x => x.sectionId + '：' + x.text);
  const results = await collectResults(core, await aiRepo.messages(core.db, threadId));
  const ctx =
    studyState({ section: s0.section, steps: s0.steps, step, skipped: p.skipped, stuck, mode: s0.state.mode, today: now.slice(0, 10) }) +
    (results.length ? '\n<action_results>\n' + results.join('\n') + '\n</action_results>' : '');
  const userMsg = await aiRepo.addMessage(
    core.db,
    { threadId, role: 'user', parts: [{ t: 'text', text: ctx }, { t: 'text', text: a.question.trim() }], ui: { question: a.label.trim() } },
    now,
  );
  patch(() => ({ threadId, state, awayDays: 0 }));
  await reload(core, threadId);
  await runLoop(core, svc, key, threadId);
  if (a.pinSeq != null) {
    await studyRepo.addMark(core.db, s0.book.id, { blockSeq: a.pinSeq, kind: 'pin', text: a.label }, beijingIso());
  }
  await maybeDetour(core, threadId, userMsg);
}

async function runLoop(core: AppCore, svc0: AiService, key: string, threadId: number): Promise<void> {
  abort = new AbortController();
  const signal = abort.signal;
  let svc = svc0;
  let partial = '';
  let last = 0;
  const paint = (text: string) => {
    partial = text;
    if (Date.now() - last < 40) {
      return;
    }
    last = Date.now();
    const live: StoredMessage = { id: -1, threadId, role: 'assistant', parts: [{ t: 'text', text }], raw: null, ui: null, compacted: false, createdAt: '' };
    useStudy.setState(st =>
      st.s?.threadId === threadId ? { busy: '正在讲…', s: { ...st.s, messages: [...st.s.messages.filter(m => m.id !== -1), live] } } : st,
    );
  };
  useStudy.setState({ busy: '思考中…', error: null });
  try {
    for (let round = 0; ; round++) {
      partial = '';
      const r = await call(core, svc, key, threadId, signal, paint);
      svc = r.svc;
      const parsed = r.res.parsed;
      const calls = parsed.stop === 'tool' ? parsed.parts.filter((x): x is Extract<Part, { t: 'call' }> => x.t === 'call') : [];
      const incomplete = parsed.stop !== 'tool' && parsed.parts.some(x => x.t === 'call');
      const empty = !calls.length && !parsed.parts.some(x => x.t === 'text' && x.text.trim());
      await aiRepo.addMessage(
        core.db,
        {
          threadId,
          role: 'assistant',
          parts: incomplete ? parsed.parts.filter(x => x.t !== 'call') : parsed.parts,
          raw: incomplete ? null : parsed.raw,
          ui: {
            usage: parsed.usage,
            service: svc.name + ' · ' + svc.model,
            price: svc.price,
            thinking: parsed.thinking,
            error: parsed.stop === 'max_tokens' ? '回答太长被截断了（输出上限）' : parsed.stop === 'refusal' ? '模型拒绝回答' : empty ? EMPTY_ANSWER_ERROR : undefined,
          },
        },
        beijingIso(),
      );
      await reload(core, threadId);
      if (!calls.length) {
        break;
      }
      const over = round >= MAX_STUDY_ROUNDS;
      const s = useStudy.getState().s!;
      const results: Part[] = [];
      const uis: ToolUi[] = [];
      for (const c of calls) {
        if (over || signal.aborted) {
          results.push({ t: 'result', id: c.id, name: c.name, output: over ? '已到工具调用上限，没有执行' : '用户停止了，没有执行' });
          uis.push({ id: c.id, name: c.name, label: c.name + '（没有执行）', error: true });
          continue;
        }
        useStudy.setState({ busy: '正在调用 ' + c.name + '…' });
        const out = await runStudyTool({ core, threadId, bookId: s.book.id, sectionId: s.section.id, sections: s.sections, signal }, c.id, c.name, c.args);
        results.push({ t: 'result', id: c.id, name: c.name, output: out.output });
        uis.push(out.ui);
      }
      await aiRepo.addMessage(core.db, { threadId, role: 'tool', parts: results, ui: { tools: uis } }, beijingIso());
      await reload(core, threadId);
      if (over || signal.aborted) {
        await aiRepo.addMessage(core.db, { threadId, role: 'assistant', parts: [], ui: { error: signal.aborted ? '已停止' : '工具调用超过 ' + MAX_STUDY_ROUNDS + ' 轮，已停止' } }, beijingIso());
        break;
      }
      useStudy.setState({ busy: '思考中…' });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await aiRepo.addMessage(core.db, { threadId, role: 'assistant', parts: partial ? [{ t: 'text', text: partial }] : [], ui: { error: msg } }, beijingIso());
  } finally {
    abort = null;
    useStudy.setState({ busy: null });
    await reload(core, threadId);
  }
}

// ---------- 岔路（§6.5）：只改显示和笔记，发给模型的历史不变 ----------

async function saveProgress(core: AppCore, f: (p: studyRepo.SectionProgress) => studyRepo.SectionProgress) {
  const s = useStudy.getState().s;
  if (!s) {
    return;
  }
  const state = { ...s.state, sections: { ...s.state.sections, [s.section.id]: f(progressNow(s)) } };
  await studyRepo.saveState(core.db, state);
  patch(() => ({ state }));
}

/** 这一轮里 load_section 带了 detour：从这次提问开始算岔路。已经在岔路上时不变。 */
async function maybeDetour(core: AppCore, threadId: number, fromMsg: number) {
  const s = useStudy.getState().s;
  if (!s || progressNow(s).detour) {
    return;
  }
  const hit = s.messages
    .filter(m => m.id >= fromMsg && m.role === 'tool')
    .flatMap(m => m.ui?.tools ?? [])
    .find(t => t.section?.detour && !t.error);
  if (hit && s.threadId === threadId) {
    await saveProgress(core, p => ({ ...p, detour: { sectionId: hit.section!.id, fromMsg } }));
  }
}

/** 回到主线：岔路折叠成一行，问题和最后一段回答记进被问那一节的笔记。不请求模型。 */
export async function backToMain(core: AppCore): Promise<void> {
  const s = useStudy.getState().s;
  const d = s && progressNow(s).detour;
  if (!s || !d) {
    return;
  }
  const part = s.messages.filter(m => m.id >= d.fromMsg && m.id > 0);
  const q = part.find(m => m.role === 'user')?.ui?.question ?? secLabel(s.sections.find(x => x.id === d.sectionId) ?? { no: '', title: d.sectionId });
  const answer = [...part].reverse().find(m => m.role === 'assistant' && m.parts.some(x => x.t === 'text' && x.text.trim()));
  const text = answer?.parts.map(x => (x.t === 'text' ? x.text : '')).join('') ?? '';
  const now = beijingIso();
  if (text) {
    await studyRepo.addQa(core.db, s.book.id, d.sectionId, { q, a: stripMarks(text).slice(0, 300), from: s.section.id }, now);
  }
  const toMsg = part.length ? part[part.length - 1].id : d.fromMsg;
  await saveProgress(core, p => ({ ...p, detour: null, folds: [...(p.folds ?? []), { sectionId: d.sectionId, fromMsg: d.fromMsg, toMsg, title: q, step: s.state.step }] }));
}

const stripMarks = (t: string) =>
  t.replace(/\[\[b:[^\]]*\]\]/g, '').replace(/\[\[\/?[a-z]+\]\]/g, '').replace(/\$\$?/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

// ---------- 检查题、卡点、小结、模式 ----------

async function patchTool(core: AppCore, msgId: number, toolId: string, f: (t: ToolUi) => ToolUi) {
  const s = useStudy.getState().s;
  const m = s?.messages.find(x => x.id === msgId);
  if (!s || !m?.ui?.tools) {
    return;
  }
  const ui = { ...m.ui, tools: m.ui.tools.map(t => (t.id === toolId ? f(t) : t)) };
  await aiRepo.updateMessageUi(core.db, msgId, ui);
  patch(x => ({ messages: x.messages.map(y => (y.id === msgId ? { ...y, ui } : y)) }));
}

/** 选一个选项（只能选一次）；结果在下一次提问时告诉模型。 */
export async function pickQuiz(core: AppCore, msgId: number, toolId: string, k: number) {
  await patchTool(core, msgId, toolId, t => (t.quiz && t.quiz.picked < 0 ? { ...t, quiz: { ...t.quiz, picked: k } } : t));
}

export async function markStuck(core: AppCore, text: string) {
  const s = useStudy.getState().s;
  if (s && text.trim()) {
    await studyRepo.addStuck(core.db, s.book.id, s.section.id, text.trim().slice(0, 120), beijingIso());
  }
}

export async function setStudyMode(core: AppCore, mode: studyRepo.StudyMode) {
  const s = useStudy.getState().s;
  if (!s || s.state.mode === mode) {
    return;
  }
  const state = { ...s.state, mode };
  await studyRepo.saveState(core.db, state);
  patch(() => ({ state }));
}

// ---------- 本节小结（§6.6） ----------

export interface WrapDraft {
  /** 来自哪次 propose_section_wrapup；没有配置 AI 或模型没起草时为 null（本机草稿）。 */
  from: { msgId: number; toolId: string } | null;
  summary: string;
  stuck: string[];
  cards: { front: string; back: string; on: boolean }[];
  skipped: number[];
}

/** 最近一份没处理的草稿；没有时用本节第一段做摘要（不请求模型）。 */
export function wrapDraft(s: StudySession): WrapDraft {
  for (let i = s.messages.length - 1; i >= 0; i--) {
    const m = s.messages[i];
    const t = m.ui?.tools?.find(x => x.wrapup?.status === 'pending');
    if (t?.wrapup) {
      return {
        from: { msgId: m.id, toolId: t.id },
        summary: t.wrapup.summary,
        stuck: t.wrapup.stuck,
        cards: t.wrapup.cards.map(c => ({ ...c, on: true })),
        skipped: progressNow(s).skipped,
      };
    }
  }
  const first = s.blocks.find(b => b.type === 'p');
  return {
    from: null,
    summary: first ? stripMarks(first.text).slice(0, 120) : '',
    stuck: [],
    cards: [],
    skipped: progressNow(s).skipped,
  };
}

/** 保存小结：摘要、勾上的闪卡（明天第一次复习）、卡点；这一节标成已学，返回下一节。 */
export async function saveWrapup(core: AppCore, d: WrapDraft): Promise<BookSection | null> {
  const s = useStudy.getState().s;
  if (!s) {
    return null;
  }
  const now = beijingIso();
  const tomorrow = new Date(Date.parse(now.slice(0, 10) + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  await studyRepo.saveSummary(core.db, s.book.id, s.section.id, d.summary.trim(), now);
  await studyRepo.addCards(core.db, s.book.id, s.section.id, d.cards.filter(c => c.on && c.front.trim()), tomorrow, now);
  for (const x of d.stuck) {
    await studyRepo.addStuck(core.db, s.book.id, s.section.id, x, now);
  }
  if (d.from) {
    await patchTool(core, d.from.msgId, d.from.toolId, t => (t.wrapup ? { ...t, wrapup: { ...t.wrapup, status: 'saved' } } : t));
  }
  await saveProgress(core, p => ({ ...p, done: true, taught: Math.max(p.taught, s.steps.length - 1) }));
  const leaves = leavesOf(s.sections);
  return leaves[leaves.findIndex(x => x.id === s.section.id) + 1] ?? null;
}

export async function dismissWrapup(core: AppCore, d: WrapDraft) {
  if (d.from) {
    await patchTool(core, d.from.msgId, d.from.toolId, t => (t.wrapup ? { ...t, wrapup: { ...t.wrapup, status: 'dismissed' } } : t));
  }
}

