/**
 * 伴读的工具（QUANTWISE_DESIGN.md §6.4、§8）：读书 6 个 + 行情与因子 3 个 + 只读行情 7 个，按名字排序，固定不变。
 * 读书工具在这里执行；行情和因子交给 AI 助手同一套实现（ai/tools）。没有下单、转账、改设置、记忆这类工具。
 */
import type { ToolDef } from '../ai/protocol';
import { TOOL_DEFS } from '../ai/tools/defs';
import { runTool } from '../ai/tools/index';
import { QUANT_TOOL_DEFS } from '../ai/tools/quantDefs';
import type { ToolUi } from '../ai/types';
import type { AppCore } from '../app/boot';
import { secLabel } from '../book/book';
import type { BookSection } from '../book/types';
import * as bookRepo from '../data/bookRepo';
import * as studyRepo from '../data/studyRepo';
import { beijingIso } from '../market/clock';
import { estimateTokens } from '../ai/prompt';
import { blockText, sectionText } from './prompt';
import { searchBook, variantPattern } from './search';

/** load_section 一次最多返回多少词元（docs/design/ai-study-options.md §4.3）。 */
export const LOAD_SECTION_TOKENS = 6000;
/** search_book 每个命中块保留命中处前后多少字。 */
const SNIPPET_CHARS = 200;

/** 命中处前后的原文；整块不长时原样返回。 */
export function snippetOf(text: string, query: string, around = SNIPPET_CHARS): string {
  if (text.length <= around * 2 + 40) return text;
  const at = Math.max(0, text.toLowerCase().indexOf(query.toLowerCase()));
  const from = Math.max(0, at - around);
  const to = Math.min(text.length, at + query.length + around);
  return (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '');
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const BOOK_TOOLS: ToolDef[] = [
  {
    name: 'ask_quiz',
    description: '出一道选择题让用户点选（检查这一步懂没懂）。answer 是正确选项的下标（从 0 开始），explain 是对错之后显示的解释（带引用）。作答结果在下一次提问的 <action_results> 里。',
    schema: obj(
      {
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' }, description: '3–4 个选项' },
        answer: { type: 'integer' },
        explain: { type: 'string' },
      },
      ['question', 'options', 'answer', 'explain'],
    ),
  },
  {
    name: 'get_notes',
    description: '某一节的学习记录：摘要、问答、卡点。',
    schema: obj({ section_id: { type: 'string' } }, ['section_id']),
  },
  {
    name: 'load_section',
    description: '读一个小节的原文（带块号），之后可以引用读到的块。很长的小节分段返回，末尾写明从哪个块号继续（from）。用户问到另一个话题时 detour 传 true，界面会显示岔路。',
    schema: obj(
      {
        id: { type: 'string', description: '小节号，见 <book_map>，例如 4.2' },
        detour: { type: 'boolean' },
        from: { type: 'integer', description: '从第几个块开始读（接着上一次没读完的地方）' },
      },
      ['id'],
    ),
  },
  {
    name: 'mark_stuck',
    description: '记一个卡点（用户同意记成卡点时才调用）。',
    schema: obj({ text: { type: 'string', description: '一句话写清没懂的点' } }, ['text']),
  },
  {
    name: 'propose_section_wrapup',
    description: '讲完这一节、用户说懂了时起草本节小结：summary 不超过 120 字，stuck 是卡点，cards 是 3–5 张闪卡。用户确认后 App 才保存。',
    schema: obj(
      {
        summary: { type: 'string' },
        stuck: { type: 'array', items: { type: 'string' } },
        cards: { type: 'array', items: obj({ front: { type: 'string' }, back: { type: 'string' } }, ['front', 'back']) },
      },
      ['summary', 'cards'],
    ),
  },
  {
    name: 'search_book',
    description: '在这本书里检索，按相关度返回最多 8 个块（块号、所在小节、命中处前后的原文），先列最相关的小节。query 写 1–4 个关键词或同义词，空格或 | 分开（例如「动量 崩溃」「momentum | reversal」），用书的语言写，App 会按中英术语表扩展。这些块之后可以引用；要看整块或上下文时再 load_section。',
    schema: obj({ query: { type: 'string', description: '关键词，空格或 | 分开' } }, ['query']),
  },
];

/** 伴读里能用的只读行情工具（复用 AI 助手的定义和实现）。 */
export const MARKET_READ_TOOLS = ['get_benchmark', 'get_company_profile', 'get_financials', 'get_kline', 'get_quote', 'query_local_db', 'screen'];

export const STUDY_TOOL_DEFS: ToolDef[] = [
  ...BOOK_TOOLS,
  ...QUANT_TOOL_DEFS,
  ...TOOL_DEFS.filter(t => MARKET_READ_TOOLS.includes(t.name)),
].sort((a, b) => (a.name < b.name ? -1 : 1));

const STUDY_TOOL_NAMES = new Set(STUDY_TOOL_DEFS.map(t => t.name));

/** 能拿到真实行情、因子数据的工具：讲解里的「真实行情」要有它们算出的数撑着。 */
export const MARKET_TOOLS: ReadonlySet<string> = new Set([...QUANT_TOOL_DEFS.map(t => t.name), ...MARKET_READ_TOOLS]);

export interface StudyToolEnv {
  core: AppCore;
  threadId: number;
  bookId: string;
  /** 当前（主线）小节。 */
  sectionId: string;
  sections: BookSection[];
  signal?: AbortSignal;
  /** 实验快照解读：只解释已经给出的结果，不执行任何工具（工具定义照常发送，缓存不变）。 */
  snapshot?: boolean;
  /** 书的正文语言：英文书用中文搜不到时提示换英文术语。 */
  language?: 'en' | 'zh';
}

export async function runStudyTool(
  env: StudyToolEnv,
  id: string,
  name: string,
  argsJson: string,
): Promise<{ output: string; ui: ToolUi }> {
  if (!STUDY_TOOL_NAMES.has(name)) {
    return { output: '伴读里没有这个工具：' + name, ui: { id, name, label: name + '（伴读里不能用）', error: true } };
  }
  if (env.snapshot) {
    return { output: '这次只解释已经给出的实验结果，不调用工具、不重新计算。请直接根据给出的结果回答。', ui: { id, name, label: name + '（只解读已有结果，没有执行）', error: true } };
  }
  if (!BOOK_TOOLS.some(t => t.name === name)) {
    // 行情、因子：和 AI 助手同一套实现；伴读不写记忆、不出操作卡
    return runTool({ core: env.core, threadId: env.threadId, memoryMode: 'off', nextCardNo: () => 0, signal: env.signal }, id, name, argsJson);
  }
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson || '{}') ?? {};
  } catch {
    return { output: '参数不是合法的 JSON', ui: { id, name, label: name + '：参数错误', error: true } };
  }
  try {
    return await bookTool(env, id, name, args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { output: '工具执行出错：' + msg, ui: { id, name, label: name + ' 出错：' + msg, error: true } };
  }
}

async function bookTool(
  env: StudyToolEnv,
  id: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ output: string; ui: ToolUi }> {
  const { core, bookId } = env;
  const now = beijingIso();
  const ui = (label: string, extra: Partial<ToolUi> = {}): ToolUi => ({ id, name, label, ...extra });
  switch (name) {
    case 'load_section': {
      const sid = String(args.id ?? '').trim();
      const s = env.sections.find(x => x.id === sid);
      if (!s) {
        throw new Error('没有小节「' + sid + '」，小节号见 <book_map>');
      }
      const kids = env.sections.filter(x => x.parentId === s.id);
      const all = await bookRepo.sectionBlocks(core.db, bookId, s.id);
      const from = typeof args.from === 'number' && Number.isInteger(args.from) ? args.from : null;
      const page = pageOf(all.filter(b => from == null || b.no >= from), s.id);
      const rest = all.filter(b => b.no > (page[page.length - 1]?.no ?? Infinity));
      const text = all.length
        ? sectionText(s, page) + (rest.length ? '\n（这一节还有 ' + rest.length + ' 个块没读，从 [' + s.id + '#' + rest[0].no + '] 开始；需要时 load_section(id: "' + s.id + '", from: ' + rest[0].no + ') 接着读）' : '')
        : '## ' + secLabel(s) + '\n（这一级没有正文，下面的小节：' + kids.map(k => k.id + ' ' + k.title).join('、') + '）';
      const detour = args.detour === true && s.id !== env.sectionId;
      const partial = page.length < all.length;
      const range = partial && page.length ? '¶' + page[0].no + '–' + page[page.length - 1].no + '，共 ' : '';
      return {
        output: text,
        ui: ui('读取 ' + secLabel(s) + '（' + range + all.length + ' 个块）', {
          section: { id: s.id, detour, ...(partial ? { partial: true } : {}) },
          ...(partial ? { cites: page.map(b => s.id + '#' + b.no) } : {}),
        }),
      };
    }
    case 'search_book': {
      const q = String(args.query ?? '').trim();
      const r = await searchBook(core.db, bookId, q, env.sections, env.sectionId);
      const title = (sid: string) => secLabel(env.sections.find(x => x.id === sid) ?? { no: '', title: sid });
      const expanded = r.concepts.flatMap(c => c.slice(1));
      const head = [
        ...(expanded.length ? ['（也按 ' + expanded.slice(0, 8).join('、') + ' 搜了）'] : []),
        ...(r.missing.length && r.hits.length ? ['（书里没有出现：' + r.missing.join('、') + '，下面只按其余关键词排的）'] : []),
        ...(r.sections.length ? ['最相关的小节：' + r.sections.slice(0, 4).map(x => title(x.id) + '（' + x.count + ' 处）').join('、')] : []),
      ];
      const lines = r.hits.map(h => {
        const at = h.matched.map(v => variantPattern(v).exec(h.block.text)?.[0]).find(Boolean) ?? '';
        return blockText(h.block.sectionId, { ...h.block, text: snippetOf(h.block.text, at) }) + '（' + title(h.block.sectionId) + (h.block.sectionId === env.sectionId ? '，当前小节，已在上下文里' : '') + (h.viaTranslation ? '，命中的是已保存的中文译文' : '') + '）';
      });
      const out = r.hits.length
        ? [...head, ...lines].join('\n')
        : '没有找到「' + q + '」。' + (/\p{Script=Han}/u.test(q) && env.language === 'en' ? '这本书是英文的，换成英文术语再搜（例如书里的原词）。' : '换个说法或拆成更短的关键词再搜。');
      return { output: out, ui: ui('在书里搜「' + q + '」：' + r.hits.length + ' 处', { cites: r.hits.map(h => h.block.sectionId + '#' + h.block.no) }) };
    }
    case 'get_notes': {
      const sid = String(args.section_id ?? '');
      const n = await studyRepo.noteOf(core.db, bookId, sid);
      const stuck = (await studyRepo.stuckOf(core.db, bookId)).filter(x => x.sectionId === sid);
      const out = [
        '摘要：' + (n?.summary || '（还没有）'),
        ...(n?.qa ?? []).map(x => '问：' + x.q + '\n答：' + x.a),
        ...stuck.map(x => '卡点：' + x.text + (x.resolvedAt ? '（已解决）' : '')),
      ].join('\n');
      return { output: out, ui: ui('读取 ' + sid + ' 的学习记录') };
    }
    case 'mark_stuck': {
      const text = String(args.text ?? '').trim().slice(0, 120);
      if (!text) {
        throw new Error('卡点内容是空的');
      }
      await studyRepo.addStuck(core.db, bookId, env.sectionId, text, now);
      return { output: '已记成卡点：' + text, ui: ui('记了一个卡点：' + text) };
    }
    case 'ask_quiz': {
      const options = Array.isArray(args.options) ? args.options.map(String).slice(0, 5) : [];
      const answer = Number(args.answer);
      if (options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
        throw new Error('选项至少 2 个，answer 是正确选项的下标');
      }
      const quiz = { question: String(args.question ?? ''), options, answer, explain: String(args.explain ?? ''), picked: -1 };
      return { output: '题目已显示，等用户作答', ui: ui('出了一道题', { quiz }) };
    }
    case 'propose_section_wrapup': {
      const cards = Array.isArray(args.cards)
        ? (args.cards as { front?: unknown; back?: unknown }[]).filter(c => c?.front && c?.back).slice(0, 6).map(c => ({ front: String(c.front), back: String(c.back) }))
        : [];
      const wrapup = {
        summary: String(args.summary ?? '').slice(0, 300),
        stuck: Array.isArray(args.stuck) ? args.stuck.map(String).slice(0, 5) : [],
        cards,
        status: 'pending' as const,
      };
      return { output: '小结草稿已显示，等用户确认（' + cards.length + ' 张闪卡）', ui: ui('起草了本节小结', { wrapup }) };
    }
  }
  throw new Error('没有这个工具：' + name);
}

/** 从头取块，直到 LOAD_SECTION_TOKENS；至少一块。 */
function pageOf<B extends Parameters<typeof blockText>[1]>(blocks: B[], sectionId: string): B[] {
  const out: B[] = [];
  let used = 0;
  for (const b of blocks) {
    const n = estimateTokens(blockText(sectionId, b));
    if (out.length && used + n > LOAD_SECTION_TOKENS) break;
    out.push(b);
    used += n;
  }
  return out;
}
