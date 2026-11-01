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
  | 'realBlock';

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

export function quick(
  kind: QuickKind,
  o: { steps: LessonStep[]; step: number; block?: { label: string; text: string } },
): Quick {
  const st = (k: number) => o.steps[k];
  const name = (k: number) => '第 ' + (k + 1) + ' 步「' + (st(k)?.title ?? '') + '」';
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
      return { kind, label: '用真实行情举例', question: '用真实的 A 股行情给' + name(o.step) + '举个例子：用 plot_chart 画图，数字以工具结果为准。' };
    case 'factor':
      return { kind, label: '这个因子在 A 股有效吗？', question: '这一节讲的因子在 A 股有效吗？用 factor_test 在示例池上检验一次，按结果说结论。' };
    case 'quiz':
      return { kind, label: '考考我', question: '考考我' + name(o.step) + '：用 ask_quiz 出一道题。' };
    case 'finish':
      return { kind, label: '整理本节小结', question: '这一节我懂了，请起草本节小结（propose_section_wrapup）。' };
    case 'explainBlock':
      return { kind, label: '解释一下 ' + o.block!.label, question: '用 200 字以内解释这一段（' + o.block!.label + '）：' + o.block!.text.slice(0, 200) };
    case 'fromBlock':
      return { kind, label: '从 ' + o.block!.label + ' 开始讲', question: '从这一段（' + o.block!.label + '）开始讲' + name(o.step) + '。', step: o.step };
    case 'realBlock':
      return { kind, label: '用真实行情解释 ' + o.block!.label, question: '用真实的 A 股行情解释这一段（' + o.block!.label + '）：' + o.block!.text.slice(0, 200) };
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
