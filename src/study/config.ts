/**
 * 讲解对话自己的模型 / 思考 / 搜索（docs/design/ai-study-options.md §2）：按小节对话保存在 ai_thread.config，
 * 新小节沿用「讲解最近一次选择」（搜索不继承），和 AI 助手的对话配置分开，助手里换模型不影响讲解的缓存。
 */
import { normaliseConfig, resolvedService } from '../ai/models';
import { defaultConversationConfig, loadProviders } from '../ai/services';
import type { AiProvider, AiService, ConversationConfig, StoredMessage } from '../ai/types';
import * as aiRepo from '../data/aiRepo';
import type { Db } from '../data/db';
import * as repo from '../data/repos';
import * as studyRepo from '../data/studyRepo';

export const STUDY_LAST_CONFIG_KEY = 'studyLastConfig';

const usable = (providers: AiProvider[], c: ConversationConfig | null | undefined): c is ConversationConfig =>
  !!resolvedService(providers, c);

/** 新小节的默认：讲解最近一次选择；从没选过时取助手的最近选择。搜索默认关，讲解里没有外部工具。 */
export async function studyDefaultConfig(db: Db, providers?: AiProvider[]): Promise<ConversationConfig | null> {
  const ps = providers ?? (await loadProviders(db));
  const last = await repo.getSetting<ConversationConfig | null>(db, STUDY_LAST_CONFIG_KEY, null);
  const base = usable(ps, last) ? last : await defaultConversationConfig(db);
  return base ? normaliseConfig({ ...base, search: false, mcp: false }, ps) : null;
}

/** 旧版本的讲解对话没有配置：按最后一次回答的服务和模型认领（模型还启用时）。 */
export function claimConfig(messages: StoredMessage[], providers: AiProvider[], fallback: ConversationConfig | null): ConversationConfig | null {
  const raw = [...messages].reverse().find(m => m.role === 'assistant' && m.raw)?.raw;
  const p = raw && providers.find(x => (raw.providerId ? x.id === raw.providerId : x.protocol === raw.protocol) && x.models.some(m => m.id === raw.model && m.enabled));
  const claimed = p && raw ? normaliseConfig({ providerId: p.id, model: raw.model, effort: fallback?.effort ?? 'low', search: false }, providers) : null;
  return usable(providers, claimed) ? claimed : fallback;
}

/** 一个讲解对话现在的配置（没有对话时是新小节的默认）。 */
export async function threadStudyConfig(
  db: Db,
  threadId: number | null,
  messages: StoredMessage[],
): Promise<{ config: ConversationConfig | null; lastConfig: ConversationConfig | null }> {
  const providers = await loadProviders(db);
  const fallback = await studyDefaultConfig(db, providers);
  const thread = threadId != null ? await aiRepo.thread(db, threadId) : null;
  const saved = thread?.config;
  const config = usable(providers, saved) ? normaliseConfig({ ...saved, mcp: false }, providers) : claimConfig(messages, providers, fallback);
  return { config, lastConfig: thread?.lastConfig ?? null };
}

/** 保存这一节的选择，并记成讲解最近一次选择。 */
export async function saveStudyConfig(db: Db, threadId: number | null, next: ConversationConfig, now: string): Promise<ConversationConfig> {
  const providers = await loadProviders(db);
  const cfg = normaliseConfig({ ...next, mcp: false }, providers);
  if (!usable(providers, cfg)) {
    throw new Error('模型已停用或删除，请重新选择');
  }
  if (threadId != null) {
    await aiRepo.updateThread(db, threadId, { config: cfg }, now);
  }
  await repo.setSetting(db, STUDY_LAST_CONFIG_KEY, cfg);
  return cfg;
}

export async function resolveStudyService(db: Db, cfg: ConversationConfig | null): Promise<AiService | null> {
  const providers = await loadProviders(db);
  return cfg ? resolvedService(providers, normaliseConfig({ ...cfg, mcp: false }, providers)) : null;
}

/** 翻译用这一节讲解的模型；这一节还没有讲解对话时用讲解最近一次选择。 */
export async function sectionStudyService(db: Db, bookId: string, sectionId: string): Promise<AiService | null> {
  const threadId = await studyRepo.studyThreadId(db, bookId, sectionId);
  const msgs = threadId != null ? await aiRepo.messages(db, threadId) : [];
  const { config } = await threadStudyConfig(db, threadId, msgs);
  return resolveStudyService(db, config);
}
