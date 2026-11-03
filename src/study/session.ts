/**
 * 伴读运行时（QUANTWISE_DESIGN.md §6、§8）：一个小节一个对话（ai_thread.kind = 'study'）。
 * 精简的工具循环：拼请求 → 调模型（流式）→ 执行工具 → 再请求，最多 6 轮。复用 AI 助手的协议层、服务配置、Key
 * 和消息存法。模型 / 思考 / 搜索按小节对话保存（study/config.ts），长对话按词元预算自动整理（study/compact.ts）；
 * 不做 MCP、操作卡。界面通过 useStudy 读状态。
 */
import { create } from 'zustand';
import { aiKeys, aiTransport, MAX_PAUSE_RESUMES } from '../ai/chat';
import { combineSearch } from '../ai/evidence';
import { external } from '../ai/external';
import { AiError, callModel } from '../ai/http';
import { EMPTY_ANSWER_ERROR } from '../ai/messageText';
import { configBrief, configChanges, needsFreshInformation, sameConfig } from '../ai/models';
import { estimateTokens } from '../ai/prompt';
import { buildRequest } from '../ai/protocol';
import { kimiSearch, SEARCH_TOOL } from '../ai/search';
import { installId, setProviderCache } from '../ai/services';
import type { AiService, ConversationConfig, ModelProgress, Part, StoredMessage, ToolUi } from '../ai/types';
import type { AppCore } from '../app/boot';
import { citeLabel, leavesOf, secLabel } from '../book/book';
import { planSteps, type LessonStep } from '../book/steps';
import type { Book, BookBlock, BookSection } from '../book/types';
import * as aiRepo from '../data/aiRepo';
import * as bookRepo from '../data/bookRepo';
import * as repo from '../data/repos';
import * as studyRepo from '../data/studyRepo';
import { beijingIso } from '../market/clock';
import { commitStudyCompaction, fitToBudget, keepFromOf, lastRequestTokens, STUDY_COMPACT_PROMPT, studyBudget, TURN_TOOL_BUDGET, withSummary } from './compact';
import { resolveStudyService, saveStudyConfig, studyDefaultConfig, STUDY_LAST_CONFIG_KEY, threadStudyConfig } from './config';
import { STUDY_PROMPT, studyContext, studyState } from './prompt';
import { quick, type QuickKind } from './quick';
import { loadReadingState, saveReadingState } from './readingState';
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
  /** 这一节讲解的模型 / 思考 / 搜索（study/config.ts）；lastConfig 是上次发送时的选择（没发送过为 null）。 */
  config: ConversationConfig | null;
  lastConfig: ConversationConfig | null;
  /** 较早讲解整理成的摘要；没整理过为空。 */
  summary: string;
}

interface StudyStore {
  s: StudySession | null;
  busy: string | null;
  error: string | null;
}

export const useStudy = create<StudyStore>(() => ({ s: null, busy: null, error: null }));

let abort: AbortController | null = null;
let openVersion = 0;

export function stopStudy(): void {
  abort?.abort();
}

const patch = (f: (s: StudySession) => Partial<StudySession>) =>
  useStudy.setState(st => (st.s ? { s: { ...st.s, ...f(st.s) } } : st));

const patchSession = (s: StudySession, f: (current: StudySession) => Partial<StudySession>) =>
  patch(current => current.book.id === s.book.id && current.section.id === s.section.id ? f(current) : {});

export const progressNow = (s: StudySession) => studyRepo.progressOf(s.state, s.section.id);

/** 打开一本书的某一节（不给就打开上次的主线小节）；不请求模型。 */
export async function openSection(
  core: AppCore,
  bookId: string,
  sectionId?: string,
  mode?: studyRepo.StudyMode,
): Promise<void> {
  const version = ++openVersion;
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
  const blocks = await bookRepo.sectionBlocks(core.db, bookId, target.id);
  const threadId = await studyRepo.studyThreadId(core.db, bookId, target.id);
  const messages = threadId ? await aiRepo.messages(core.db, threadId) : [];
  const { config, lastConfig } = await threadStudyConfig(core.db, threadId, messages);
  const summary = threadId ? (await aiRepo.thread(core.db, threadId))?.summary ?? '' : '';
  if (version !== openVersion) return;
  await core.db.transaction(async db => {
    const latest = await studyRepo.getState(db, bookId);
    state.sections = latest?.sections ?? state.sections;
    await studyRepo.saveState(db, state);
  });
  if (version !== openVersion) return;
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
    awayDays,
    config,
    lastConfig,
    summary,
  };
  useStudy.setState({ s, error: null });
  await loadExtra(core, s);
}

/** 从历史里找出读过的小节和块（引用校验用）。 */
export function loadedOf(main: string, messages: StoredMessage[]): Set<string> {
  const out = new Set([main]);
  for (const m of messages) {
    for (const t of m.ui?.tools ?? []) {
      // 长小节只读了一段时，读到的块在 cites 里
      if (t.section && !t.error && !t.section.partial) {
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
  patchSession(s, () => ({ extra }));
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

/** 讲解的工具：固定 16 个；Kimi 开了搜索时多一个客户端搜索工具（和 AI 助手一样放在最前面）。 */
export function studyTools(svc: AiService) {
  return [...(svc.search && svc.providerKind === 'moonshot' ? [SEARCH_TOOL] : []), ...(svc.capabilities?.tools === false ? [] : STUDY_TOOL_DEFS)];
}

/** 拼请求：工具 → 讲解协议 → 书的地图和当前原文（+ 讲解摘要）→ 没整理的历史 → extra（整理时的那句话）。 */
async function build(core: AppCore, svc: AiService, threadId: number, extra?: Part[], noTools = false) {
  const prefs = await repo.getSetting<StudyPrefs>(core.db, STUDY_PREFS_KEY, DEFAULT_STUDY_PREFS);
  const history = (await aiRepo.messages(core.db, threadId)).filter(m => !m.compacted);
  if (extra) {
    history.push({ id: -1, threadId, role: 'user', parts: extra, raw: null, ui: null, compacted: false, createdAt: '' });
  }
  return buildRequest({
    service: svc,
    system: STUDY_PROMPT + prefsText({ ...DEFAULT_STUDY_PREFS, ...prefs }),
    context: withSummary((await studyRepo.threadContext(core.db, threadId)) || '（没有书的上下文）', (await aiRepo.thread(core.db, threadId))?.summary ?? ''),
    tools: studyTools(svc),
    history,
    cache: svc.cache === 'auto',
    effort: svc.effort,
    // 讲解和助手的前缀不同，分开路由（OpenAI prompt_cache_key）
    cacheKey: (await installId(core.db)) + '-study',
    noTools,
    stream: true,
  });
}

/** 调一次模型；服务不认缓存 / 思考参数时去掉重发（和 AI 助手 §6.4 一样，不能关思考的模型不降级）。 */
async function call(
  core: AppCore, svc0: AiService, key: string, threadId: number, signal: AbortSignal,
  opts: { onText?: (t: string) => void; extra?: Part[]; noTools?: boolean } = {},
) {
  let svc = svc0;
  for (let attempt = 0; ; attempt++) {
    const req = await build(core, svc, threadId, opts.extra, opts.noTools);
    try {
      return { res: await callModel(svc, key, req, { signal, fetchImpl: aiTransport(), onText: opts.onText }), svc };
    } catch (e) {
      if (!(e instanceof AiError) || !e.compat || attempt >= 2) {
        throw e;
      }
      if (e.compat === 'cache' && svc.cache === 'auto') {
        svc = { ...svc, cache: 'off' };
        await setProviderCache(core.db, svc.id, 'off');
      } else if (e.compat === 'effort' && svc.effort !== 'off' && (!svc.capabilities || svc.capabilities.thinking?.includes('off'))) {
        svc = { ...svc, effort: 'off' };
      } else {
        throw e;
      }
    }
  }
}

/** 下一次请求大约多大：上一次回答报告的用量和按请求体估算的较大者。 */
async function requestSize(core: AppCore, svc: AiService, threadId: number): Promise<number> {
  const measured = lastRequestTokens(await aiRepo.messages(core.db, threadId)) ?? 0;
  return Math.max(measured, estimateTokens(JSON.stringify((await build(core, svc, threadId)).body)));
}

/**
 * 自动整理（docs/design/ai-study-options.md §4.4）：上一次请求超过整理线（force 时不看线）就把除最近
 * 几问以外的讲解整理成摘要。整理请求沿用同一前缀；模型没给出文字时再要一次，还不行就放弃（不影响讲解）。
 */
async function compactStudy(core: AppCore, svc0: AiService, key: string, threadId: number, signal: AbortSignal, force = false): Promise<boolean> {
  const msgs = await aiRepo.messages(core.db, threadId);
  const keepFrom = keepFromOf(msgs);
  if (keepFrom == null || signal.aborted || (!force && (lastRequestTokens(msgs) ?? 0) < studyBudget(svc0).compactAt)) {
    return false;
  }
  useStudy.setState({ busy: '这一节聊得比较长，先整理较早的讲解…' });
  let svc = svc0;
  let text = '';
  for (let i = 0; i < 2 && !text && !signal.aborted; i++) {
    const r = await call(core, svc, key, threadId, signal, { extra: [{ t: 'text', text: STUDY_COMPACT_PROMPT }], noTools: true });
    svc = r.svc;
    text = r.res.parsed.parts.map(x => (x.t === 'text' ? x.text : '')).join('').trim();
  }
  if (!text || signal.aborted) {
    return false;
  }
  await commitStudyCompaction(core.db, threadId, keepFrom, text, beijingIso());
  const summary = (await aiRepo.thread(core.db, threadId))?.summary ?? '';
  patch(cur => (cur.threadId === threadId ? { summary } : {}));
  await reload(core, threadId);
  return true;
}

/** 回到讲解页时：还没有配置、或配置的模型已停用（刚去配了供应商），重新取一次。 */
export async function refreshStudyConfig(core: AppCore): Promise<void> {
  const s = useStudy.getState().s;
  if (!s || (s.config && (await resolveStudyService(core.db, s.config)))) {
    return;
  }
  const { config } = await threadStudyConfig(core.db, s.threadId, s.messages);
  patchSession(s, () => ({ config }));
}

/** 改这一节的模型 / 思考 / 搜索：存进对话，并记成讲解最近一次选择。回答进行中不能改。 */
export async function selectStudyConfig(core: AppCore, next: ConversationConfig): Promise<void> {
  const s = useStudy.getState().s;
  if (!s || useStudy.getState().busy) {
    return;
  }
  const config = await saveStudyConfig(core.db, s.threadId, next, beijingIso());
  patchSession(s, () => ({ config }));
}

/** 改了配置、还没发送时：下次要重建多少缓存（上一次请求的输入量），可以改回。 */
export function studyRebuild(s: StudySession): { reason: string; tokens: number; previous: ConversationConfig } | null {
  if (!s.config || !s.lastConfig || sameConfig(s.config, s.lastConfig)) {
    return null;
  }
  return { reason: configChanges(s.lastConfig, s.config), tokens: lastRequestTokens(s.messages) ?? 0, previous: s.lastConfig };
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
  /** 实验快照解读只能解释已有数据，不开放重新计算的工具。 */
  snapshot?: boolean;
  /** 从读书模式某一段发起的：对话里在问题上方显示这一段。 */
  source?: NonNullable<StoredMessage['ui']>['studySource'];
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
    ...(block ? { source: { sectionId: s.section.id, no: block.no, seq: block.seq, label: citeLabel(s.section, block), text: block.text.slice(0, 320) } } : {}),
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

export async function askStudy(core: AppCore, a: StudyAsk): Promise<boolean> {
  const s0 = useStudy.getState().s;
  if (!s0 || !a.question.trim() || useStudy.getState().busy) {
    return false;
  }
  useStudy.setState({ busy: '准备讲解…', error: null });
  const controller = new AbortController();
  abort = controller;
  try {
  await saveReadingState(core.db, s0.book.id, s0.section.id, { pending: a });
  const cfg = s0.config;
  let svc = await resolveStudyService(core.db, cfg);
  if (!svc || !cfg) {
    throw new AiError('auth', '请先在「我的 → 供应商与模型」配置 Key 并启用一个对话模型');
  }
  const key = await aiKeys().get(svc.id);
  if (!key) {
    throw new AiError('auth', '「' + svc.name + '」还没有保存 API Key');
  }
  // 实验快照只解释屏幕上同一次结果：这一次不搜索；工具定义照常发送（前缀和缓存不变），执行时拒绝
  if (a.snapshot) {
    svc = { ...svc, search: false };
  }
  const now = beijingIso();
  let threadId = s0.threadId;
  if (threadId == null) {
    const notes = await studyRepo.notesOf(core.db, s0.book.id);
    threadId = await studyRepo.createStudyThread(
      core.db,
      { title: secLabel(s0.section), bookId: s0.book.id, sectionId: s0.section.id, context: studyContext(s0.book, s0.sections, notes, s0.section, s0.blocks) },
      now,
    );
  } else if (!controller.signal.aborted && (await requestSize(core, svc, threadId)) >= studyBudget(svc).hardAt) {
    // 上一次请求已经接近上下文上限：先整理较早的讲解再问
    await compactStudy(core, svc, key, threadId, controller.signal, true).catch(() => false);
    useStudy.setState({ busy: '准备讲解…' });
  }
  const lastCfg = (await aiRepo.thread(core.db, threadId))?.lastConfig ?? null;
  const divider = lastCfg && !sameConfig(lastCfg, cfg) ? configChanges(lastCfg, cfg) + '：从这里起用 ' + configBrief(cfg) : undefined;
  const p = { ...progressNow(s0) };
  const step = a.step == null ? s0.state.step : Math.max(0, Math.min(s0.steps.length - 1, a.step));
  if (a.skip != null && !p.skipped.includes(a.skip)) {
    p.skipped = [...p.skipped, a.skip];
  }
  const stuck = (await studyRepo.stuckOf(core.db, s0.book.id)).filter(x => !x.resolvedAt).map(x => x.sectionId + '：' + x.text);
  const results = await collectResults(core, await aiRepo.messages(core.db, threadId));
  const ctx =
    studyState({ section: s0.section, steps: s0.steps, step, skipped: p.skipped, stuck, mode: s0.state.mode, today: now.slice(0, 10) }) +
    (results.length ? '\n<action_results>\n' + results.join('\n') + '\n</action_results>' : '');
  const userMsg = await aiRepo.addMessage(
    core.db,
    { threadId, role: 'user', parts: [{ t: 'text', text: ctx }, { t: 'text', text: a.question.trim() }], ui: { question: a.label.trim(), ...(a.source ? { studySource: a.source } : {}), ...(divider ? { divider } : {}) } },
    now,
  );
  await aiRepo.updateThread(core.db, threadId, { config: cfg, lastConfig: cfg }, now);
  await repo.setSetting(core.db, STUDY_LAST_CONFIG_KEY, cfg);
  patchSession(s0, () => ({ threadId, awayDays: 0, config: cfg, lastConfig: cfg }));
  await reload(core, threadId);
  const loop = await runLoop(core, svc, key, threadId, s0, controller.signal, { snapshot: !!a.snapshot, question: a.question.trim(), config: cfg });
  const success = loop.ok;
  if (success) {
    const committed = await core.db.transaction(async db => {
      const latest = (await studyRepo.getState(db, s0.book.id)) ?? s0.state;
      const progress = studyRepo.progressOf(latest, s0.section.id);
      const state = { ...latest, step: latest.main === s0.section.id ? step : latest.step, activeAt: now, sections: { ...latest.sections, [s0.section.id]: { ...progress, skipped: [...new Set([...progress.skipped, ...p.skipped])], taught: a.step == null ? progress.taught : Math.max(progress.taught, step) } } };
      await studyRepo.saveState(db, state);
      const reading = await loadReadingState(db, s0.book.id, s0.section.id);
      await saveReadingState(db, s0.book.id, s0.section.id, { pending: null, ...(reading.draft?.trim() === a.question.trim() ? { draft: '' } : {}) });
      return state;
    });
    patch(current => current.book.id === s0.book.id ? { state: committed } : {});
  }
  if (success && a.pinSeq != null) {
    await studyRepo.addMark(core.db, s0.book.id, { blockSeq: a.pinSeq, kind: 'pin', text: a.label }, beijingIso());
  }
  await maybeDetour(core, threadId, userMsg);
  if (!controller.signal.aborted) {
    // 回答刚结束，缓存是热的：这时整理最便宜
    await compactStudy(core, loop.svc, key, threadId, controller.signal).catch(() => false);
  }
  return success;
  } finally {
    if (abort === controller) abort = null;
    useStudy.setState({ busy: null });
  }
}

async function runLoop(
  core: AppCore, svc0: AiService, key: string, threadId: number, session: StudySession, signal: AbortSignal,
  opts: { snapshot: boolean; question: string; config: ConversationConfig },
): Promise<{ ok: boolean; svc: AiService }> {
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
  // 一问之内工具结果的预算（§4.5）：取「每问上限」和「离应急线还剩多少」的较小者；超出时截断，不改历史
  const budget = { left: TURN_TOOL_BUDGET };
  let searchHistory: ModelProgress['search'];
  let pauses = 0;
  useStudy.setState({ busy: '思考中…', error: null });
  try {
    for (let round = 0; ; round++) {
      if (signal.aborted) throw new Error('已停止');
      partial = '';
      const r = await call(core, svc, key, threadId, signal, { onText: paint });
      svc = r.svc;
      const parsed = r.res.parsed;
      const u = parsed.usage;
      const used = u.input + u.cacheRead + u.cacheWrite + u.output;
      if (used) {
        budget.left = Math.min(budget.left, Math.max(0, studyBudget(svc).hardAt - used));
      }
      const search = combineSearch(searchHistory, parsed.search);
      // 服务端搜索跑太久暂停了：原样存下，下一次请求以这条回答结尾，服务端会接着跑（§13.1）
      const paused = parsed.stop === 'pause' && pauses < MAX_PAUSE_RESUMES;
      const calls = parsed.stop === 'tool' ? parsed.parts.filter((x): x is Extract<Part, { t: 'call' }> => x.t === 'call') : [];
      const incomplete = parsed.stop !== 'tool' && parsed.stop !== 'pause' && parsed.parts.some(x => x.t === 'call');
      const empty = !paused && !calls.length && !parsed.parts.some(x => x.t === 'text' && x.text.trim());
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
            config: opts.config,
            thinking: parsed.thinking,
            search,
            searchOffer: !svc.search && !opts.snapshot && !calls.length && !paused && needsFreshInformation(opts.question) ? opts.question : undefined,
            error: paused
              ? undefined
              : parsed.stop === 'pause'
              ? '联网搜索暂停了 ' + MAX_PAUSE_RESUMES + ' 次仍没有完成，可以换个问法再问'
              : parsed.stop === 'max_tokens'
              ? TRUNCATED_ERROR
              : parsed.stop === 'refusal'
              ? '模型拒绝回答'
              : empty
              ? EMPTY_ANSWER_ERROR
              : undefined,
          },
        },
        beijingIso(),
      );
      await reload(core, threadId);
      if (search) {
        searchHistory = { ...search, citations: [] };
      }
      if (paused && !signal.aborted) {
        pauses++;
        round--; // 暂停不算工具轮数
        useStudy.setState({ busy: '联网搜索还在进行…' });
        continue;
      }
      if (!calls.length) {
        const ok = !empty && !incomplete && parsed.stop !== 'max_tokens' && parsed.stop !== 'refusal' && parsed.stop !== 'pause' && !signal.aborted;
        if (!ok) useStudy.setState({ error: signal.aborted ? '已停止，讲解进度未推进' : '这次讲解未完成，可以重试' });
        return { ok, svc };
      }
      const over = round >= MAX_STUDY_ROUNDS;
      const s = session;
      const results: Part[] = [];
      const uis: ToolUi[] = [];
      for (const c of calls) {
        if (over || signal.aborted) {
          results.push({ t: 'result', id: c.id, name: c.name, output: over ? '已到工具调用上限，没有执行' : '用户停止了，没有执行' });
          uis.push({ id: c.id, name: c.name, label: c.name + '（没有执行）', error: true });
          continue;
        }
        if (!budget.left) {
          results.push({ t: 'result', id: c.id, name: c.name, output: '上下文快满了，没有执行这个工具。请根据已经读到的内容直接回答。' });
          uis.push({ id: c.id, name: c.name, label: c.name + '（读取已达上限，没有执行）', error: true });
          continue;
        }
        useStudy.setState({ busy: '正在调用 ' + c.name + '…' });
        let out: { output: string; ui: ToolUi };
        if (c.name === SEARCH_TOOL.name && svc.providerKind === 'moonshot' && svc.search && !opts.snapshot) {
          const k = await kimiTool(svc, key, c, signal);
          searchHistory = k.search ? combineSearch(searchHistory, k.search) : searchHistory;
          out = k;
        } else if (svc.capabilities?.tools === false) {
          out = { output: '当前模型未启用 App 工具，未执行', ui: { id: c.id, name: c.name, label: '模型不支持 App 工具', error: true } };
        } else {
          out = await runStudyTool({ core, threadId, bookId: s.book.id, sectionId: s.section.id, sections: s.sections, signal, snapshot: opts.snapshot }, c.id, c.name, c.args);
        }
        const fit = fitToBudget(out.output, budget);
        results.push({ t: 'result', id: c.id, name: c.name, output: fit.output });
        uis.push(fit.clipped ? { ...out.ui, label: out.ui.label + '（内容太长，只发送了一部分）' } : out.ui);
      }
      await aiRepo.addMessage(core.db, { threadId, role: 'tool', parts: results, ui: { tools: uis } }, beijingIso());
      await reload(core, threadId);
      if (over || signal.aborted) {
        await aiRepo.addMessage(core.db, { threadId, role: 'assistant', parts: [], ui: { error: signal.aborted ? '已停止' : '工具调用超过 ' + MAX_STUDY_ROUNDS + ' 轮，已停止' } }, beijingIso());
        useStudy.setState({ error: signal.aborted ? '已停止，讲解进度未推进' : '工具调用达到上限，可以重试' });
        return { ok: false, svc };
      }
      useStudy.setState({ busy: '思考中…' });
    }
  } catch (e) {
    const msg = signal.aborted ? '已停止，已收到的内容已保留' : e instanceof Error ? e.message : String(e);
    useStudy.setState({ error: msg });
    await aiRepo.addMessage(core.db, { threadId, role: 'assistant', parts: partial ? [{ t: 'text', text: partial }] : [], ui: { error: msg, config: opts.config } }, beijingIso());
    return { ok: false, svc };
  } finally {
    await reload(core, threadId);
  }
}

/** 回答停在输出上限时的提示；界面据此给「接着讲」。 */
export const TRUNCATED_ERROR = '回答太长被截断了（输出上限）';

type KimiOut = { output: string; ui: ToolUi; search?: NonNullable<ModelProgress['search']> };

/** Kimi 的联网搜索是客户端工具：调它的搜索接口，结果作为普通工具结果回给模型（和 AI 助手一样）。 */
async function kimiTool(svc: AiService, key: string, c: { id: string; name: string; args: string }, signal: AbortSignal): Promise<KimiOut> {
  try {
    const found = await kimiSearch(svc, key, c.args, signal, aiTransport());
    return { output: found.output, ui: { id: c.id, name: c.name, label: '联网搜索：' + (found.search.queries[0] ?? '') }, search: found.search };
  } catch (e) {
    return {
      output: external({ source: 'Kimi 联网搜索' }, JSON.stringify({ error: e instanceof Error ? e.message : String(e) })),
      ui: { id: c.id, name: c.name, label: '联网搜索失败', error: true },
    };
  }
}

// ---------- 讲解记录：新开一轮、删除 ----------

/**
 * 离开这一轮对话：岔路和折叠记的是这轮的消息 id，一起清掉（讲到第几步、跳过、已学完不变）；打开着这一节时，
 * 会话换成「还没有对话」（配置保留，下次提问新建对话、重新拍书的地图快照）。
 */
async function leaveThread(core: AppCore, threadId: number, f: () => Promise<void>) {
  if (useStudy.getState().busy && useStudy.getState().s?.threadId === threadId) {
    throw new Error('正在讲解，结束后再操作');
  }
  const at = await studyRepo.studyThreadSection(core.db, threadId);
  await f();
  // 新的一轮按新对话的默认（讲解最近一次选择，搜索关），和重新打开这一节时一致
  const config = await studyDefaultConfig(core.db);
  const state = await core.db.transaction(async db => {
    const latest = at && (await studyRepo.getState(db, at.bookId));
    if (!at || !latest?.sections[at.sectionId]) return latest ?? null;
    const updated = { ...latest, sections: { ...latest.sections, [at.sectionId]: { ...latest.sections[at.sectionId], detour: null, folds: [] } } };
    await studyRepo.saveState(db, updated);
    return updated;
  });
  useStudy.setState(st =>
    st.s?.threadId === threadId
      ? { s: { ...st.s, threadId: null, messages: [], loaded: new Set([st.s.section.id]), extra: {}, config, lastConfig: null, summary: '', ...(state ? { state } : {}) } }
      : st.s && state && st.s.book.id === state.bookId ? { s: { ...st.s, state } } : st,
  );
}

/** 新开一轮：当前对话归档（只读可看），学习进度、笔记、闪卡、卡点不变。 */
export async function newStudyRound(core: AppCore, threadId: number): Promise<void> {
  await leaveThread(core, threadId, () => studyRepo.archiveStudyThread(core.db, threadId, beijingIso()));
}

/** 删除讲解对话和消息；学习进度、笔记、闪卡和卡点保留。 */
export async function deleteStudyThread(core: AppCore, threadId: number): Promise<void> {
  await leaveThread(core, threadId, () => aiRepo.deleteThread(core.db, threadId));
}

// ---------- 岔路（§6.5）：只改显示和笔记，发给模型的历史不变 ----------

async function saveProgress(core: AppCore, f: (p: studyRepo.SectionProgress) => studyRepo.SectionProgress) {
  const s = useStudy.getState().s;
  if (!s) {
    return;
  }
  const state = await core.db.transaction(async db => {
    const latest = (await studyRepo.getState(db, s.book.id)) ?? s.state;
    const updated = { ...latest, sections: { ...latest.sections, [s.section.id]: f(studyRepo.progressOf(latest, s.section.id)) } };
    await studyRepo.saveState(db, updated);
    return updated;
  });
  patchSession(s, () => ({ state }));
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
  const state = await core.db.transaction(async db => {
    const latest = (await studyRepo.getState(db, s.book.id)) ?? s.state;
    const updated = { ...latest, mode };
    await studyRepo.saveState(db, updated);
    return updated;
  });
  patchSession(s, () => ({ state }));
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
  let state = s.state;
  let updatedMessage: StoredMessage | undefined;
  await core.db.transaction(async db => {
    const latest = (await studyRepo.getState(db, s.book.id)) ?? s.state;
    const p = studyRepo.progressOf(latest, s.section.id);
    state = { ...latest, sections: { ...latest.sections, [s.section.id]: { ...p, done: true } } };
    const fingerprint = JSON.stringify(d);
    const reading = await loadReadingState(db, s.book.id, s.section.id);
    if (reading.savedWrap === fingerprint) return;
    await studyRepo.saveSummary(db, s.book.id, s.section.id, d.summary.trim(), now);
    await studyRepo.addCards(db, s.book.id, s.section.id, d.cards.filter(c => c.on && c.front.trim()), tomorrow, now);
    for (const x of d.stuck) await studyRepo.addStuck(db, s.book.id, s.section.id, x, now);
    if (d.from) {
      const m = s.messages.find(x => x.id === d.from!.msgId);
      if (m?.ui?.tools) {
        const ui = { ...m.ui, tools: m.ui.tools.map(t => t.id === d.from!.toolId && t.wrapup ? { ...t, wrapup: { ...t.wrapup, status: 'saved' as const } } : t) };
        await aiRepo.updateMessageUi(db, m.id, ui);
        updatedMessage = { ...m, ui };
      }
    }
    await studyRepo.saveState(db, state);
    await saveReadingState(db, s.book.id, s.section.id, { wrap: null, savedWrap: fingerprint });
  });
  patchSession(s, x => ({ state, messages: updatedMessage ? x.messages.map(m => m.id === updatedMessage!.id ? updatedMessage! : m) : x.messages }));
  const leaves = leavesOf(s.sections);
  return leaves[leaves.findIndex(x => x.id === s.section.id) + 1] ?? null;
}

export async function dismissWrapup(core: AppCore, d: WrapDraft) {
  if (d.from) {
    await patchTool(core, d.from.msgId, d.from.toolId, t => (t.wrapup ? { ...t, wrapup: { ...t.wrapup, status: 'dismissed' } } : t));
  }
}

