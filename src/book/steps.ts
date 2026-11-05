/**
 * 本节路线图（QUANTWISE_DESIGN.md §6.1）：在本机把一个小节切成 1–5 步，不调用模型。
 * 先把块分组（公式、列表项、以冒号结尾的引导段不拆开；脚注跟着前文，表格、图、代码跟着单独一段的表题、图注、代码标题，
 * 同一张图的几个分图、被分页切开的代码不拆开），组数 ≤ 5 时一组一步，否则按字数合并。
 * 步骤名（PM 走查第 3 项）：先用图表编号和图注、表题，再从句子里取关键词，不截半句英文；
 * 英文书第一次讲解时模型顺带给中文步骤名，存在进度里（applyNames），不为起名单独发请求。
 */
import { topicTerms } from '../study/glossary';
import { blockNumber, ownNumber, type Numbered } from './blockTitle';
import type { BookBlock } from './types';

export interface LessonStep {
  /** 从 0 开始。 */
  index: number;
  title: string;
  /** 这一步的块（节内序号 no，从 1 开始，连续）。 */
  from: number;
  to: number;
}

const MAX_STEPS = 5;

/** 脚注段：「[1]尽管 Fama……」。 */
const footnote = (b: BookBlock) => b.type === 'p' && /^\s*\[\d+\]/.test(b.text);
/** 单独一段的表题、图注、代码标题：「表3.21 动量和市值独立双重排序月均收益率（%）」「SNIPPET 3.6 …」。 */
const caption = (b: BookBlock) => b.type === 'p' && b.text.length < 120 && /^\s*(表|图|Table|TABLE|Figure|FIGURE|Exhibit|EXHIBIT|Snippet|SNIPPET|Listing|LISTING|代码清单|代码片段)\s*\d/.test(b.text);
const figureCaption = (b: BookBlock) => caption(b) && /^\s*(图|Figure|FIGURE|Exhibit|EXHIBIT)/.test(b.text);
/** 字数太少的小节一步讲完。 */
const ONE_STEP_CHARS = 200;

function groups(blocks: BookBlock[]): BookBlock[][] {
  const out: BookBlock[][] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    const attach =
      prev &&
      (b.type === 'eq' ||
        footnote(b) ||
        ((b.type === 'table' || b.type === 'img' || b.type === 'code') && caption(prev)) ||
        (b.type === 'img' && prev.type === 'img') ||
        (b.type === 'code' && prev.type === 'code') ||
        (figureCaption(b) && prev.type === 'img') ||
        (b.type === 'li' && (prev.type === 'li' || /[：:]$/.test(prev.text))));
    if (attach) {
      last.push(b);
    } else {
      out.push([b]);
    }
  }
  return out;
}

const plain = (s: string) =>
  s
    .replace(/<sup>[^<]*<\/sup>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\$\$?[^$]*\$\$?/g, '')
    .replace(/\*\*|`/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .trim();

const hanCount = (s: string) => (s.match(/\p{Script=Han}/gu) ?? []).length;
const MATH = /\$\$?[^$]+\$\$?/g;
// 公式里的字母不算（中文书里大段 LaTeX 不能让这一步按英文起名）
const zhText = (s: string) => {
  const t = s.replace(MATH, ' ');
  return hanCount(t) >= (t.match(/[A-Za-z]/g) ?? []).length;
};

/** 讲两个因子交叉分组的句子、表题：「动量和市值独立双重排序月均收益率」→「动量 × 市值双重排序」。 */
const FACTOR = '(动量|反转|市值|规模|价值|账面市值比|盈利|投资|换手率?|波动率?|流动性|质量|估值|成长|贝塔|[A-Za-z][A-Za-z\\-]{0,9})';
const PAIR = new RegExp(FACTOR + '\\s*(?:和|与|及|、|×)\\s*' + FACTOR + '[^，。,]{0,8}?双重排序');
/** 句首的连接词、插入语，起名时去掉。 */
const OPENER = /^(?:接下来|下面|首先|其次|再次|然后|最后|此外|另外|同样|同时|因此|所以|于是|总之|综上所述?|具体来说|具体而言|一般来说|通常来说|客观地说|简单地说|换句话说|也就是说|事实上|实际上|显然|当然|幸运的是|不幸的是|遗憾的是|有趣的是|值得注意的是|需要注意的是|需要指出的是|尤其是?|特别是|从[^，。]{0,16}来看|总的来看|正如[^，。]{0,8}?(?:所见|所说|所述|看到的|提到的)|如前所述|如上所述)[，,、：:\s]*/;
/** 「而」「但」后面常是要说的事，去掉连接词照用；「并」「且」「又」开头的分句接着前一句的主语，不单独当名字。 */
const LINK = /^(?:而是|而|但是|但)/;
const CONT = /^[并且又也则即]/;
/** 对读者说话的句子不当步骤名（「熟悉A股市场的读者可能有这样的体会」「从表5.3中的结果可以看到」）。 */
const CHATTY = /读者|我们|大家|你|如下|如图|如表|下文|上文|本书|笔者|本节|本章|可以看到|可以发现|不难发现|前者|后者/;
/** 状语从句开头的分句（「在实际问题中」「当使用等权重构建组合时」「无论采用哪个定价模型」）离开后半句不成话。 */
const SUBORDINATE = /^(?:在|当|如果|若|假如|假设|对于|对|由于|因为|为了|随着|除了|尽管|虽然|即使|通过|根据|按照|基于|无论|不论|不管|只要|只有)/;
/** 接着前一个分句说的半句（「是应该进行全面系统的基本面分析」）。 */
const DANGLING = /^[是的了就都还才乃它其]/;
/** 以「表明」「说明」结尾的半句，后面才是要说的事（「价值因子的有效表明」）。 */
const TRAILING = /(?:表明|说明|显示|认为|指出|发现|意味着|证明|看到|提到|所示|如下)$/;
/** 公式去掉后留下的空位。 */
const GAP = '\u0000';
const EN_OPENER = /^(?:likewise|similarly|next|now|finally|first|second|third|also|however|moreover|furthermore|in addition|then|thus|therefore|so)\b[,\s]*/i;

const pairName = (s: string) => {
  const m = PAIR.exec(s);
  return m ? m[1] + ' × ' + m[2] + '双重排序' : null;
};

/** 图注、表题缩成一个短题目：去掉括号里的单位和说明，太长时取最后一个「的」后面那一截；节名的主题词（「动量因子实证」的「动量因子」）开头的不重复。 */
function shortCaption(text: string, section: string): string {
  let t = text.replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, ' ').trim();
  const pair = pairName(t);
  if (pair) return pair;
  if (t.length > 12) {
    const k = t.lastIndexOf('的');
    if (k >= 0 && t.length - k - 1 >= 3) t = t.slice(k + 1);
  }
  const stem = section.replace(/(?:实证|分析|检验|研究|简介|概述|模型|方法|介绍|应用)$/, '');
  if (stem.length >= 2 && t.startsWith(stem) && t.length - stem.length >= 4 && /^[\p{Script=Han}A-Za-z]/u.test(t.slice(stem.length))) t = t.slice(stem.length);
  return t.length > 16 ? t.slice(0, 15) + '…' : t;
}

const balanced = (x: string) => [['（', '）'], ['(', ')'], ['“', '”'], ['「', '」'], ['《', '》']].every(([a, b]) => x.split(a).length === x.split(b).length);
/** 能单独当步骤名的一截：成句、不对读者说话、不是状语从句或半句、括号配对、没有公式空位、以中文为主。 */
const standalone = (x: string, max: number) =>
  x.length >= 4 && x.length <= max && !CHATTY.test(x) && !SUBORDINATE.test(x) && !DANGLING.test(x) && !CONT.test(x) && !TRAILING.test(x) && balanced(x) && !x.includes(GAP) && hanCount(x) * 2 >= x.length;

/** 去掉句首的连接词、括号里的补充说明和句末的「呢」「吗」。 */
const clean = (x: string) => {
  let t = x.replace(/（[^（）]*）|\([^()]*\)/g, '').trim();
  for (let i = 0; i < 3 && (OPENER.test(t) || LINK.test(t)); i++) t = t.replace(OPENER, '').replace(LINK, '').trim();
  return t.replace(/[呢吗]$/, '');
};

/** 中文句子里能当步骤名的一截：去掉连接词；整句太长时找一个能单独成立的分句，找不到返回 null（再用关键词）。 */
function zhTopic(sentence: string): string | null {
  const s = clean(sentence);
  const pair = pairName(s);
  if (pair) return pair;
  if (standalone(s, 20)) return s;
  for (const c of s.split(/[，,]/)) {
    const x = clean(c);
    if (standalone(x, 18)) return x;
  }
  return null;
}

/** 第一句起不出名字、关键词又和前面的步骤重了时，看这一段后面几句；段中「那」「这」开头的句子指着前文，不用。 */
const laterTopics = (b: BookBlock) =>
  plain(b.text.replace(MATH, GAP))
    .replace(/（[^（）]*）|\([^()]*\)/g, '')
    .split(/[。！？；]/)
    .slice(1, 6)
    .map(zhTopic)
    .filter((x): x is string => !!x && !/^[这那此该]/.test(x));

/** 英文句子在词边界截断，不留半个单词。 */
function cutWords(s: string, n = 28): string {
  let t = s.replace(new RegExp(GAP, 'g'), '').replace(/\s+/g, ' ').replace(EN_OPENER, '').trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (t.length <= n) return t;
  const cut = t.slice(0, n + 1);
  const k = cut.lastIndexOf(' ');
  return (k > 8 ? cut.slice(0, k) : t.slice(0, n)).replace(/[,;:]$/, '') + '…';
}

/** 这一步里的图、表、代码编号（同一张图的几个分图算一个）。 */
function numbersOf(g: BookBlock[], all: BookBlock[]): Numbered[] {
  const out: Numbered[] = [];
  for (const b of g) {
    const n = b.type === 'p' ? (caption(b) ? ownNumber(b) : null) : blockNumber(b, all);
    if (!n || n.kind === 'equation') continue;
    const label = n.label.split(' · ')[0];
    if (!out.some(x => x.label === label)) out.push({ ...n, label });
  }
  return out;
}

/** 「图 3.21」「图 3.22」→「图 3.21–3.22」；最多写两组。 */
function joinNumbers(ns: Numbered[]): string {
  const parsed = ns.map(n => {
    const m = /^(\S+)\s+(\d+)([.\-–])(\d+)$/.exec(n.label);
    return m ? { word: m[1], major: m[2], dot: m[3], minor: Number(m[4]), label: n.label } : { word: '', major: '', dot: '', minor: NaN, label: n.label };
  });
  const out: string[] = [];
  for (let i = 0; i < parsed.length; ) {
    let j = i;
    while (j + 1 < parsed.length && parsed[i].word && parsed[j + 1].word === parsed[i].word && parsed[j + 1].major === parsed[i].major && parsed[j + 1].minor === parsed[j].minor + 1) j++;
    out.push(j > i ? parsed[i].label + '–' + parsed[i].major + parsed[i].dot + parsed[j].minor : parsed[i].label);
    i = j + 1;
  }
  return out.slice(0, 2).join('、');
}

/** 这一步的正文（起名取关键词用）：段落、列表、图注、表题、代码标题，不含脚注和表格里的格子。 */
const proseOf = (g: BookBlock[], all: BookBlock[]) =>
  g.filter(b => !footnote(b)).map(b => (b.type === 'p' || b.type === 'li' || b.type === 'img' ? b.text : b.type === 'table' || b.type === 'code' ? blockNumber(b, all)?.caption ?? '' : '')).join('\n');

/** 英文图注、代码标题里的题目：术语的中文写法，没有时取 getEvents 这类函数名。 */
const enTopic = (text: string, skip: Set<string>) =>
  topicTerms(text, 4).find(t => !skip.has(t)) ?? /\b[a-z]+[A-Z][A-Za-z0-9]*\b/.exec(text)?.[0] ?? '';

function nameStep(g: BookBlock[], all: BookBlock[], section: string, skip: Set<string>, index: number, used: Set<string>): string {
  const lead = g.find(b => !footnote(b) && (b.text.trim() || b.type === 'img')) ?? g[0];
  if (lead.type === 'eq') return '公式';
  const prose = proseOf(g, all);
  const zh = zhText(prose || lead.text);
  const numbered = numbersOf(g, all);
  const nums = joinNumbers(numbered);
  // 长的一步里只出现一次的术语多半是顺带一提，不拿来起名
  const terms = topicTerms(prose, 8, prose.length > 2000 ? 2 : 1).filter(t => !skip.has(t));
  // 和前面某一步的关键词撞了就换下一组（「价值因子、超额收益」不出现两次）
  const pairs = [terms.slice(0, 2), terms.slice(1, 3), terms.slice(0, 1).concat(terms.slice(2, 3)), terms.slice(2, 4)].map(x => x.join('、')).filter(Boolean);
  const keywords = pairs.find(x => !used.has(x)) ?? pairs[0] ?? '';
  const leadNo = lead.type === 'p' ? (caption(lead) ? ownNumber(lead) : null) : lead.type === 'li' ? null : blockNumber(lead, all);
  if (leadNo && leadNo.kind !== 'equation') {
    const topic = zh ? shortCaption(leadNo.caption, section) : enTopic(leadNo.caption, skip);
    return (nums || leadNo.label.split(' · ')[0]) + (topic ? ' ' + topic : '');
  }
  if (lead.type === 'img' || lead.type === 'table' || lead.type === 'code') {
    const what = nums || (lead.type === 'img' ? '图' : lead.type === 'table' ? '表格' : '代码');
    if (keywords) return keywords + ' · ' + what;
    // 没有编号也没有关键词的图（扫描页、无图注的插图）：用后面那一段的意思，再没有就写页码
    const next = g.find(b => b.type === 'p' && !footnote(b) && b !== lead);
    const topic = next && zh ? zhTopic(plain(next.text.replace(MATH, GAP)).split(/[。！？；:：]/)[0]) : null;
    if (topic) return topic + (nums ? ' · ' + nums : '');
    if (nums) return nums;
    const page = lead.page != null ? ' · p.' + lead.page : '';
    return (lead.type === 'img' ? (/原页图像/.test(lead.text) ? '原页' : '插图') : lead.type === 'table' ? '表格' : '代码') + page;
  }
  // 公式换成空位（起名时不选带空位的分句），其余标记去掉；括号里的补充说明先去掉（句号写在括号里时留下句号）
  const sentence = plain(lead.text.replace(MATH, GAP)).replace(/（([^（）]*)）|\(([^()]*)\)/g, (_m, a?: string, b?: string) => (/[。！？.!?]\s*$/.test(a ?? b ?? '') ? '。' : '')).split(zh ? /[。！？；:：]/ : /(?<=[.!?;:])\s|[。！？；：]/)[0].trim();
  if (!zh) {
    if (numbered.length) {
      const topic = enTopic(numbered[0].caption, skip);
      return nums + (topic ? ' ' + topic : '');
    }
    const words = cutWords(sentence);
    // 只有一个术语时常是顺带一提（讲循环神经网络的一步提到一次卷积神经网络），先用原句
    const fresh = keywords && !used.has(keywords) ? keywords : '';
    if (fresh.includes('、')) return fresh;
    if ((words.match(/[A-Za-z]/g) ?? []).length >= 6) return words;
    return fresh || (index === 0 && section && section.length <= 24 ? section : '第 ' + (index + 1) + ' 步');
  }
  // 和前面的步骤重名时依次换：关键词，再看这一段后面几句
  const first = zhTopic(sentence);
  const later = () => laterTopics(lead).find(x => !used.has(x)) ?? null;
  const collided = first ? used.has(first) : !!keywords && used.has(keywords);
  const topic = [first, keywords || null].find(x => x && !used.has(x)) ?? (collided ? later() : null);
  if (topic) return nums && (topic + ' · ' + nums).length <= 22 ? topic + ' · ' + nums : topic;
  if (nums) return nums;
  // 实在没有能用的：整句截短（截在公式空位和英文单词之前）；截出来没几个汉字时，第一步用节名，别的写「第 N 步」
  const fallback = index === 0 && section && section.length <= 18 ? section : '第 ' + (index + 1) + ' 步';
  const head = clean(sentence).split(GAP)[0].replace(/\s+/g, ' ').trim();
  // 截在「的」「地」之后或「和」「与」「、」之前，不把一个词截成两半
  let cut = head;
  if (head.length > 18) {
    cut = head.slice(0, 17);
    const k = Math.max(...['的', '地', '和', '与', '及', '、', '，'].map(c => cut.lastIndexOf(c)));
    cut = k >= 12 ? cut.slice(0, k + (cut[k] === '的' || cut[k] === '地' ? 1 : 0)) : cut.replace(/\s*[A-Za-z][\w-]*$/, '');
  }
  if (hanCount(cut) < 6) return index === 0 && section && section.length <= 18 ? section : later() ?? fallback;
  return cut + (cut.length < clean(sentence).length ? '…' : '');
}

const size = (g: BookBlock[]) => g.reduce((n, b) => n + b.text.length, 0);

export function planSteps(blocks: BookBlock[], section?: { title: string }): LessonStep[] {
  if (!blocks.length) {
    return [];
  }
  let gs = groups(blocks);
  const total = size(blocks);
  if (total < ONE_STEP_CHARS) {
    gs = [blocks];
  } else if (gs.length > MAX_STEPS) {
    // 按字数贪心合并：每步接近 total / 5，最后剩下的都归最后一步
    const target = total / MAX_STEPS;
    const merged: BookBlock[][] = [];
    let acc: BookBlock[] = [];
    for (const g of gs) {
      if (
        acc.length &&
        size(acc) + size(g) / 2 > target &&
        merged.length < MAX_STEPS - 1
      ) {
        merged.push(acc);
        acc = [];
      }
      acc = acc.concat(g);
    }
    merged.push(acc);
    gs = merged;
  }
  // 起名不用节名里的词，也不用大多数步骤都讲到的词（「动量因子实证」每一步都有「动量」）
  const title = section?.title ?? '';
  const skip = new Set(topicTerms(title, 10));
  if (gs.length >= 3) {
    const seen = new Map<string, number>();
    for (const g of gs) for (const t of topicTerms(proseOf(g, blocks), 20)) seen.set(t, (seen.get(t) ?? 0) + 1);
    for (const [t, n] of seen) if (n >= Math.ceil(gs.length * 0.6)) skip.add(t);
  }
  const used = new Set<string>();
  return gs.map((g, i) => {
    const name = nameStep(g, blocks, title, skip, i, used);
    used.add(name);
    return { index: i, title: name, from: g[0].no, to: g[g.length - 1].no };
  });
}

/** 路线图的切法：存下来的步骤名只在切法没变时用。 */
export const stepKey = (steps: LessonStep[]) => steps.map(s => s.from + '-' + s.to).join(',');

/** 换上存下来的步骤名（英文书第一次讲解时模型给的中文名）；路线图的切法变了就不用。 */
export function applyNames(steps: LessonStep[], names?: { key: string; titles: string[] } | null): LessonStep[] {
  if (!names || names.key !== stepKey(steps) || names.titles.length !== steps.length) return steps;
  return steps.map((s, i) => ({ ...s, title: names.titles[i] }));
}

/** 某个块（节内序号）落在哪一步；找不到时返回第 0 步。 */
export function stepOfBlock(steps: LessonStep[], no: number): number {
  return Math.max(
    0,
    steps.findIndex(s => s.from <= no && no <= s.to),
  );
}
