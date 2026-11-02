/**
 * 讲解的上下文预算和自动整理（docs/design/ai-study-options.md §4）。
 *
 * - 整理线 compactAt：回答结束后输入超过它，就把较早的讲解整理成摘要（这时缓存是热的，整理请求便宜）。
 * - 应急线 hardAt：超过它会撑爆上下文。提问前超过就先整理；一问之内工具结果按剩余预算截断，不改历史。
 * 整理请求沿用这一节的工具、system 和历史，只在末尾追加一句（protocol.ts 的 noTools 按协议处理）。
 */
import { retireBefore } from '../ai/compact';
import { estimateTokens } from '../ai/prompt';
import { MAX_OUTPUT_TOKENS } from '../ai/protocol';
import type { AiService, StoredMessage } from '../ai/types';
import * as aiRepo from '../data/aiRepo';
import type { Db } from '../data/db';

/** 整理后保留最近几问的原文。 */
export const KEEP_STUDY_TURNS = 3;
/** 一问之内工具结果合计最多多少词元。 */
export const TURN_TOOL_BUDGET = 30_000;
/** 上下文长度没标注时按 128K 估。 */
export const DEFAULT_WINDOW = 128_000;

export function studyBudget(svc: Pick<AiService, 'capabilities'>) {
  const window = svc.capabilities?.context ?? DEFAULT_WINDOW;
  return {
    window,
    compactAt: Math.min(Math.round(window * 0.5), 80_000),
    hardAt: Math.round(window * 0.8) - MAX_OUTPUT_TOKENS,
  };
}

export const STUDY_COMPACT_PROMPT =
  '（App 自动发送）这一节聊得比较长了。请把上面除最近 ' +
  KEEP_STUDY_TURNS +
  ' 问以外的较早讲解整理成摘要，供之后继续讲这一节时参考。保留：讲到第几步、跳过了哪几步、用户说懂了的地方；检查题的对错和答错的知识点；没解决的卡点；岔路问过什么、结论是什么；工具算出的结论（写明数据日期、股票池和参数，不保留逐日数字）；读过哪些其他小节和块号。不保留网页原文、图表数据点和寒暄。只输出摘要正文，不写引用标记，不要调用任何工具（包括联网搜索）。';

/** 摘要放进断点 2（书的地图和当前原文之后）。 */
export function withSummary(snapshot: string, summary: string): string {
  return summary
    ? snapshot + '\n<lecture_summary>\n较早讲解的摘要（App 自动整理；要引用其他小节的块，先用 load_section 重新读取）：\n' + summary + '\n</lecture_summary>'
    : snapshot;
}

/** 最近一次回答的实际输入量加上它的输出（下一次请求至少这么大）；没有用量时为 null。 */
export function lastRequestTokens(messages: StoredMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const u = m.compacted ? null : m.ui?.usage;
    if (m.role === 'assistant' && u && (u.input || u.cacheRead || u.cacheWrite)) {
      return u.input + u.cacheRead + u.cacheWrite + u.output;
    }
  }
  return null;
}

/** 从哪条提问开始保留原文；问得还不够多时为 null。 */
export function keepFromOf(messages: StoredMessage[], keep = KEEP_STUDY_TURNS): number | null {
  const users = messages.filter(m => m.role === 'user' && !m.compacted);
  return users.length > keep ? users[users.length - keep].id : null;
}

/** 把整理结果写回：摘要追加，较早的消息标成已整理，compactedCount 记整理过的提问数。 */
export async function commitStudyCompaction(db: Db, threadId: number, keepFrom: number, text: string, now: string): Promise<void> {
  const thread = await aiRepo.thread(db, threadId);
  if (!thread) return;
  const before = (await aiRepo.messages(db, threadId)).filter(m => m.role === 'user' && !m.compacted && m.id < keepFrom).length;
  await db.transaction(async tx => {
    await retireBefore(tx, threadId, keepFrom);
    await aiRepo.updateThread(tx, threadId, { summary: thread.summary ? thread.summary + '\n\n' + text : text, compactedCount: thread.compactedCount + before }, now);
  });
}

/**
 * 一问之内的工具结果预算：超出时截断这一条结果，用完后不再执行工具（不改历史，不影响缓存和思考块）。
 * 返回要发给模型的结果和是否被截断。
 */
export function fitToBudget(output: string, budget: { left: number }): { output: string; clipped: boolean } {
  const n = estimateTokens(output);
  if (n <= budget.left) {
    budget.left -= n;
    return { output, clipped: false };
  }
  if (budget.left < 500) {
    budget.left = 0;
    return { output: '上下文快满了，这个工具的结果没有发送。请根据已经读到的内容直接回答。', clipped: true };
  }
  const keep = Math.floor((output.length * budget.left) / n);
  budget.left = 0;
  return { output: output.slice(0, keep) + '\n（结果太长，后面的部分省略了：这一问读取的内容已接近上限。请根据已有内容回答。）', clipped: true };
}
