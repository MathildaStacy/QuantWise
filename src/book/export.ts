/**
 * 笔记导出（QUANTWISE_DESIGN.md §6.6）：一本书一个 Markdown（按章节：摘要、问答、卡点、高亮），
 * 闪卡一个 Anki CSV（正面、背面、标签 = 小节号）。纯函数。
 */
import { secLabel } from './book';
import type { BookSection } from './types';

export interface NoteExport {
  title: string;
  author: string;
  sections: BookSection[];
  notes: { sectionId: string; summary: string; qa: { q: string; a: string; from?: string }[] }[];
  stuck: { sectionId: string; text: string; resolved: boolean }[];
  highlights: { sectionId: string; label: string; text: string }[];
}

/** 原文引用超过两句只留第一句（导出给别人看时不带大段原文）。 */
export function shortQuote(text: string): string {
  const parts = text.split(/(?<=[。！？.!?])/);
  return parts.length > 2 ? parts[0] + '……' : text;
}

export function notesMarkdown(e: NoteExport): string {
  const out = ['# ' + e.title, ...(e.author ? ['', e.author] : []), ''];
  for (const s of e.sections) {
    const n = e.notes.find(x => x.sectionId === s.id);
    const st = e.stuck.filter(x => x.sectionId === s.id);
    const hl = e.highlights.filter(x => x.sectionId === s.id);
    if (!n?.summary && !n?.qa.length && !st.length && !hl.length) {
      continue;
    }
    out.push('#'.repeat(Math.min(4, s.level + 1)) + ' ' + secLabel(s), '');
    if (n?.summary) {
      out.push(n.summary, '');
    }
    for (const q of n?.qa ?? []) {
      out.push('**问：' + q.q + '**' + (q.from ? '（从 ' + q.from + ' 问的）' : ''), '', q.a, '');
    }
    for (const x of st) {
      out.push('- 卡点：' + x.text + (x.resolved ? '（已解决）' : ''));
    }
    for (const h of hl) {
      out.push('> ' + shortQuote(h.text) + '（' + h.label + '）');
    }
    if (st.length || hl.length) {
      out.push('');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);

/** Anki 导入：逗号分隔，正面、背面、标签；标签里的点换成下划线（Anki 标签不能有空格）。 */
export function ankiCsv(cards: { front: string; back: string; sectionId: string }[], book: string): string {
  const tag = (s: string) => (book.replace(/\s+/g, '_') + '::' + s.replace(/\./g, '_')).slice(0, 80);
  return cards.map(c => [c.front, c.back, tag(c.sectionId)].map(csvCell).join(',')).join('\n') + '\n';
}
