/**
 * 听讲的快捷动作（QUANTWISE_DESIGN.md §6.3）：每个按钮是一句固定的问题；对话里显示按钮上的字，
 * 发给模型的是写清楚要做什么的那句。只有点了按钮或提问才请求模型。
 */
import type { LessonStep } from '../book/steps';

export type QuickKind =
  | 'start'
  | 'next'
  | 'skip'
  | 'again'
  | 'example'
  | 'real'
  | 'factor'
  | 'quiz'
  | 'finish'
  | 'explainBlock'
  | 'fromBlock'
  | 'realBlock'
  | 'replicateBlock';

export interface Quick {
  kind: QuickKind;
  label: string;
  /** 发给模型的问题。 */
  question: string;
  /** 这次要讲第几步（从 0 开始）；不改步骤的动作没有。 */
  step?: number;
}

/** 这一节像不像在讲某个能用价量数据检验的因子：决定要不要出「这个因子在 A 股有效吗？」。 */
export const factorish = (text: string) =>
  /动量|反转|波动|换手|市值|因子|momentum|reversal|volatility|turnover|factor/i.test(text);

/**
 * 这一段是不是横截面的实证结论（分组、多空、t 值、IC、月均收益……）：是的话「用真实行情举例」改成用 factor_test
 * 按书里的口径复现，段落菜单多一个「在 A 股复现这个结论」。单只股票的图证明不了这类结论。
 */
export const empirical = (text: string) =>
  factorish(text) &&
  (/分组|组合|多空|赢家|输家|截面|排序|t\s*-?\s*值|t-stat|信息系数|月均收益|显著|单调|decile|quintile|portfolio|long[-–\s/]short|cross[-\s]section|winners?|losers?|t-value|significan|sort/i.test(text) ||
    /(?<![A-Za-z])(?:Rank )?IC(?![A-Za-z])/.test(text));

/** 发给模型的原文开头：在句末截断，最多 n 字。 */
export function lead(text: string, n = 300): string {
  if (text.length <= n) return text;
  const cut = text.slice(0, n);
  const end = Math.max(...['。', '！', '？', '. ', '; ', '；'].map(p => cut.lastIndexOf(p)));
  return (end > n * 0.4 ? cut.slice(0, end + 1) : cut) + '…';
}

export function quick(
  kind: QuickKind,
  o: { steps: LessonStep[]; step: number; block?: { label: string; id?: string; text: string; sentence?: string } },
): Quick {
  const st = (k: number) => o.steps[k];
  const name = (k: number) => '第 ' + (k + 1) + ' 步「' + (st(k)?.title ?? '') + '」';
  const b = o.block;
  // 「[3.5.3#1]（p.168）」：块号让模型在 <current_section> 里找到这一段，标签是给人看的
  const at = b ? (b.id ? '[' + b.id + ']（' + b.label + '）' : '（' + b.label + '）') : '';
  const said = b ? (b.sentence ? '里的这一句：「' + b.sentence.trim() + '」' : '：' + lead(b.text)) : '';
  const cross = b && empirical(b.sentence ?? b.text);
  switch (kind) {
    case 'start':
      return { kind, label: '开始讲第 ' + (o.step + 1) + ' 步', question: '开始讲' + name(o.step) + '。', step: o.step };
    case 'next':
      return { kind, label: '懂了，继续', question: '懂了，继续讲' + name(o.step + 1) + '。', step: o.step + 1 };
    case 'skip':
      return { kind, label: '下一步熟，跳过', question: name(o.step + 1) + '我熟，跳过，用一句话交代它讲什么，然后讲' + name(o.step + 2) + '。', step: o.step + 2 };
    case 'again':
      return { kind, label: '换个说法', question: '换个角度再讲一次' + name(o.step) + '，别重复原话。' };
    case 'example':
      return { kind, label: '举个例子', question: '给' + name(o.step) + '举个例子。' };
    case 'real':
      return { kind, label: '用真实行情举例', question: '用真实的 A 股行情给' + name(o.step) + '举个例子：用 plot_chart 画图，讲到哪段行情就用 focus 标出那段，数字以工具结果为准。' };
    case 'factor':
      return { kind, label: '这个因子在 A 股有效吗？', question: '这一节讲的因子在 A 股有效吗？用 factor_test 在示例池上检验一次，按结果说结论。' };
    case 'quiz':
      return { kind, label: '考考我', question: '考考我' + name(o.step) + '：用 ask_quiz 出一道题。' };
    case 'finish':
      return { kind, label: '整理本节小结', question: '这一节我懂了，请起草本节小结（propose_section_wrapup）。' };
    case 'explainBlock':
      return b!.sentence
        ? { kind, label: '解释这一句 · ' + b!.label, question: '用 150 字以内解释 ' + at + said + '。结合整段和前后文讲，别展开整段。' }
        : { kind, label: '解释一下 ' + b!.label, question: '用 200 字以内解释这一段 ' + at + said };
    case 'fromBlock':
      return { kind, label: '从 ' + b!.label + ' 开始讲', question: '从这一段 ' + at + ' 开始讲' + name(o.step) + '。', step: o.step };
    case 'realBlock':
      return {
        kind,
        label: '用真实行情解释 ' + b!.label + (b!.sentence ? ' 这一句' : ''),
        question: '用真实的 A 股数据解释 ' + at + said + '\n' + (cross
          ? '这一段说的是股票之间的横截面规律：用 factor_test 按书里的定义（因子、分组、调仓周期、加权）在 A 股跑一次，把结果和书里的数字对照；需要单只股票的例子时再用 plot_chart。'
          : '用 plot_chart 画图，讲到哪段行情就用 focus 标出那段；要找跌得最深、涨得最多或波动最大的一段时用 find。数字以工具结果为准。'),
      };
    case 'replicateBlock':
      return {
        kind,
        label: '在 A 股复现 ' + b!.label,
        question: '在 A 股复现 ' + at + ' 的结论' + (b!.sentence ? '（重点是这一句：「' + b!.sentence.trim() + '」）' : '') + '：先写书里的口径（排序变量、分组数、调仓频率、加权、样本期），用 factor_test 选最接近的参数跑一次（书里有等权和市值加权两种时各跑一次），再把多空每期收益、t 值、IC 和书里的数字逐项对照，说清哪些一致、哪些不同、为什么（股票池、样本期、期数）。',
      };
  }
}

/** 听讲底部的一排快捷动作：第一个是主按钮。 */
export function quickBar(o: {
  steps: LessonStep[];
  step: number;
  taught: number;
  detour: boolean;
  factor: boolean;
}): QuickKind[] {
  if (o.detour) {
    return ['example', 'real'];
  }
  if (o.taught < 0) {
    return ['start'];
  }
  const last = o.step >= o.steps.length - 1;
  return [
    last ? 'finish' : 'next',
    'real',
    ...(o.factor ? (['factor'] as const) : []),
    'quiz',
    'again',
    'example',
    ...(o.step + 2 < o.steps.length ? (['skip'] as const) : []),
  ];
}
