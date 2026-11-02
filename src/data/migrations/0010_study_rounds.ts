/** 讲解「新开一轮」（docs/design/ai-study-options.md §3）：旧的一轮归档成只读，同一小节下一次提问新建对话。 */
export const m0010: string[] = ['ALTER TABLE ai_thread ADD COLUMN archived_at TEXT'];
