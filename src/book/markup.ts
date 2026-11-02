/**
 * AI 讲解里的标记（QUANTWISE_DESIGN.md §6.2、§6.5）→ 界面能画的片段：
 * - [[b:3.1#2]] 引用 → 「3.1 ¶2」按钮；所在小节本轮没读过、或块不存在 → 「未核实」
 * - [[derive]] / [[example]] / [[real]] / [[web]] … [[/…]] → 带标签的底色块（web 是联网搜索来的网页资料）
 * - $$…$$ / \[…\] → 独立公式；$…$ → 转成 Unicode 文字（转不了的保留原文、等宽）
 * 其余交给 AShareSim 的 Markdown 组件（段落、列表、表格、加粗）。流式时半截的标记先藏起来。
 */
import { texToText } from './tex';

export type CalloutKind = 'derive' | 'example' | 'real' | 'web';

export type Seg =
  | { t: 'md'; text: string }
  | { t: 'eq'; tex: string; open?: boolean }
  | { t: 'callout'; kind: CalloutKind; segs: Seg[] };

/** 引用能不能用：返回界面上的标签（「3.1 ¶2」「p.86」），不能用返回 null。 */
export type CiteCheck = (sectionId: string, no: number) => string | null;

export const CALLOUT_LABEL: Record<CalloutKind, string> = {
  derive: '补充推导',
  example: 'AI 举例',
  real: '真实行情',
  web: '网页资料',
};

const CITE = /\[\[b:([\w.-]+)[#¶](\d+)\]\]/g;
const CALLOUT = /\[\[(derive|example|real|web)\]\]([\s\S]*?)(\[\[\/\1\]\]|$)/g;

/** 流式输出停在半截标记上（「[[b:3.」「[[der」「$$」）时先去掉，等下一段到了再显示。 */
function trimPartial(s: string): string {
  return s.replace(/\[\[[^\]]{0,20}\]?$/, '').replace(/\[$/, '');
}

/** 引用 → Markdown 链接 cite:3.1#2 / unv:；行内公式 → 文字。 */
function inline(text: string, check: CiteCheck): string {
  const withCites = text.replace(CITE, (_m, sec: string, n: string) => {
    const label = check(sec, Number(n));
    return label ? '[' + label + '](cite:' + sec + '#' + n + ')' : '[未核实](unv:)';
  });
  return withCites
    .replace(/\[\[\/?[a-z]+(?::[^\]]*)?\]\]/g, '')
    .replace(/(^|[^$\\])\$([^$\s](?:[^$]*[^$\s])?)\$(?!\d)/g, (_m, pre, tex) => {
      const t = texToText(tex);
      return pre + (t != null ? t : '`' + tex + '`');
    });
}

function display(text: string, check: CiteCheck, streaming: boolean): Seg[] {
  const out: Seg[] = [];
  const re = /\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g;
  let last = 0;
  const md = (s: string) => {
    const t = inline(s, check).trim();
    if (t) {
      out.push({ t: 'md', text: t });
    }
  };
  for (const m of text.matchAll(re)) {
    md(text.slice(last, m.index));
    out.push({ t: 'eq', tex: (m[1] ?? m[2]).trim() });
    last = m.index! + m[0].length;
  }
  const rest = text.slice(last);
  const open = rest.indexOf('$$');
  if (streaming && open >= 0) {
    // 还没收到结尾的 $$：前面照常显示，公式先显示原文
    md(rest.slice(0, open));
    const tex = rest.slice(open + 2).trim();
    if (tex) {
      out.push({ t: 'eq', tex, open: true });
    }
  } else {
    md(rest);
  }
  return out;
}

export function parseStudyText(
  text: string,
  check: CiteCheck,
  streaming = false,
): Seg[] {
  const src = streaming ? trimPartial(text) : text;
  const out: Seg[] = [];
  let last = 0;
  for (const m of src.matchAll(CALLOUT)) {
    out.push(...display(src.slice(last, m.index), check, streaming));
    const segs = display(m[2], check, streaming && !m[3]);
    if (segs.length) {
      out.push({ t: 'callout', kind: m[1] as CalloutKind, segs });
    }
    last = m.index! + m[0].length;
  }
  out.push(...display(src.slice(last), check, streaming));
  return out;
}

/** 回答里出现过的全部引用（小节号 + 块号），去重，按出现顺序。 */
export function citationsOf(text: string): { sectionId: string; no: number }[] {
  const seen = new Set<string>();
  const out: { sectionId: string; no: number }[] = [];
  for (const m of text.matchAll(CITE)) {
    const k = m[1] + '#' + m[2];
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ sectionId: m[1], no: Number(m[2]) });
    }
  }
  return out;
}

/** 去掉全部标记，给笔记和朗读用。 */
export function plainStudyText(text: string): string {
  return text
    .replace(CITE, '')
    .replace(/\[\[\/?[a-z]+(?::[^\]]*)?\]\]/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

// ---------- 原书正文（读书模式）----------

export type Inline = { t: 'text' | 'bold' | 'math'; v: string };

/** 原书段落里的 **加粗** 和 $行内公式$；简单式子转成文字，复杂式子保留 TeX 交给 MathView。 */
export function inlineParts(text: string): Inline[] {
  // MinerU 在普通段落中保留 HTML 脚注/上下标；只处理这些行内标签，代码块不经过这里。
  text = text.replace(/<(sup|sub)\b[^>]*>([^<]*)<\/\1>/gi, (_all, tag: string, value: string) => {
    const v = decode(value);
    return /^\[[^\]]+\]$/.test(v) ? v : texToText((tag.toLowerCase() === 'sup' ? '^' : '_') + '{' + v + '}') ?? v;
  });
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|(^|[^$\\])\$([^$\s](?:[^$]*[^$\s])?)\$(?!\d)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index! + (m[2]?.length ?? 0);
    if (start > last) {
      out.push({ t: 'text', v: text.slice(last, start) });
    }
    if (m[1] != null) {
      out.push({ t: 'bold', v: m[1] });
    } else {
      const t = texToText(m[3]);
      out.push(t != null ? { t: 'text', v: t } : { t: 'math', v: m[3] });
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) {
    out.push({ t: 'text', v: text.slice(last) });
  }
  return out;
}

const decode = (s: string) =>
  s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** MinerU / EPUB 的 HTML 表格 → Markdown 表格（交给 Markdown 组件画）。合并单元格按普通格子处理。 */
export function htmlTableToMarkdown(html: string): string | null {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(r =>
    [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c =>
      decode(c[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\|/g, '/').replace(/\s+/g, ' ').trim(),
    ),
  ).filter(r => r.length);
  if (!rows.length) {
    return null;
  }
  const n = Math.max(...rows.map(r => r.length));
  const line = (r: string[]) => '| ' + Array.from({ length: n }, (_, i) => r[i] ?? '').join(' | ') + ' |';
  return [line(rows[0]), '|' + ' --- |'.repeat(n), ...rows.slice(1).map(line)].join('\n');
}
