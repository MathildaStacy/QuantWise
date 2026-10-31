/**
 * Markdown → RawDoc（QUANTWISE_DESIGN.md §5）：标题、段落、$$公式$$、列表、代码、表格、图片。
 * 开头可以有 front matter（title / author）。表格保留 Markdown 原文，显示时直接交给 Markdown 组件。
 */
import type { RawBlock, RawDoc, RawItem } from './types';

/** 中文行和中文行直接接上；英文、数字结尾的行之间补一个空格。 */
function joinLines(lines: string[]): string {
  return lines.reduce(
    (a, l) =>
      a && /[A-Za-z0-9,.;:)]$/.test(a) && /^[A-Za-z0-9(]/.test(l)
        ? a + ' ' + l
        : a + l,
    '',
  );
}

export function parseMarkdownBook(md: string, fallbackTitle = ''): RawDoc {
  const text = md.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const meta: Record<string, string> = {};
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (fm) {
    for (const l of fm[1].split('\n')) {
      const m = /^(\w+):\s*(.+)$/.exec(l);
      if (m) {
        meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  const lines = (fm ? text.slice(fm[0].length) : text).split('\n');
  const items: RawItem[] = [];
  let para: string[] = [];
  const push = (b: Omit<RawBlock, 'kind'>) => items.push({ kind: 'block', ...b });
  const flush = () => {
    if (para.length) {
      push({ type: 'p', text: joinLines(para) });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (/^```/.test(line)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) {
        code.push(lines[i]);
      }
      push({ type: 'code', text: code.join('\n') });
      continue;
    }
    if (/^\$\$/.test(line)) {
      flush();
      const rest = line.slice(2);
      if (/\$\$$/.test(rest) && rest.length > 2) {
        push({ type: 'eq', text: rest.slice(0, -2).trim() });
        continue;
      }
      const tex = [rest];
      for (i++; i < lines.length && !/\$\$\s*$/.test(lines[i]); i++) {
        tex.push(lines[i]);
      }
      if (i < lines.length) {
        tex.push(lines[i].replace(/\$\$\s*$/, ''));
      }
      push({ type: 'eq', text: tex.join(' ').replace(/\s+/g, ' ').trim() });
      continue;
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (h) {
      flush();
      items.push({ kind: 'heading', text: h[2], level: h[1].length });
      continue;
    }
    if (/^\|.*\|$/.test(line)) {
      flush();
      const rows = [line];
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) {
        rows.push(lines[++i].trim());
      }
      push({ type: 'table', text: rows.join('\n') });
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)$/.exec(line);
    if (img) {
      flush();
      push({ type: 'img', text: img[1], image: img[2] });
      continue;
    }
    const li = /^([-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (li) {
      flush();
      push({
        type: 'li',
        text: li[2],
        mark: /\d/.test(li[1]) ? li[1].replace(')', '.') : '•',
      });
      continue;
    }
    if (!line || /^(-{3,}|\*{3,}|_{3,})$/.test(line) || /^<!--.*-->$/.test(line)) {
      flush();
      continue;
    }
    para.push(line.replace(/^>\s?/, ''));
  }
  flush();
  return {
    title: meta.title || fallbackTitle,
    author: meta.author || '',
    items,
    warnings: [],
  };
}
