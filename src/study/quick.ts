/**
 * 听讲的快捷动作（QUANTWISE_DESIGN.md §6.3）：每个按钮是一句固定的问题；对话里显示按钮上的字，
 * 发给模型的是写清楚要做什么的那句。只有点了按钮或提问才请求模型。
 */
import type { LessonStep } from '../book/steps';
import type { BlockType } from '../book/types';

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
  | 'replicateBlock'
  | 'linesBlock'
  | 'ioBlock';

export interface Quick {
  kind: QuickKind;
  label: string;
  /** 发给模型的问题。 */
  question: string;
  /** 这次要讲第几步（从 0 开始）；不改步骤的动作没有。 */
  step?: number;
  /** 按钮下面的一行小字：这次会做什么（「用因子检验在 A 股跑一次，和书里的数字对照」）。 */
  hint?: string;
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

/**
 * 这一段讲的是不是打标签的方法（三重屏障、元标签、事件采样、次级模型）：是的话「用真实行情举例」改成 meta_label_test，
 * 在真实日线上跑主信号和标签，不假设一个信号。
 */
export const labeling = (text: string) =>
  /元标签|三重屏障|三隔栏|打标签|标签方法|次级模型|初级模型|事件采样|CUSUM|meta[-\s]?label|triple[-\s]barrier|labeling|labelling|primary model|secondary model|vertical barrier|getEvents|getBins/i.test(text);

/** 这一段讲的是不是一段具体的行情（回撤、暴跌、急涨、波动聚集）：是的话让 plot_chart 用 find 在数据里找，不凭记忆挑月份。 */
export const episodic = (text: string) =>
  /回撤|暴跌|急跌|崩盘|股灾|急涨|暴涨|大涨|反弹|波动聚集|剧烈波动|drawdown|crash|rally|rebound|volatility cluster/i.test(text);

/** 发给模型的原文开头：在句末截断，最多 n 字。 */
export function lead(text: string, n = 300): string {
  if (text.length <= n) return text;
  const cut = text.slice(0, n);
  const end = Math.max(...['。', '！', '？', '. ', '; ', '；'].map(p => cut.lastIndexOf(p)));
  return (end > n * 0.4 ? cut.slice(0, end + 1) : cut) + '…';
}

/**
 * stepText 是当前这一步的原文：底栏的「用真实行情举例」按它分流，和段落菜单同一套判断——
 * 横截面结论走因子检验并和书里的数字对照，讲回撤、暴涨、波动的用 find 找那段行情，别的画图标出讲到的那段。
 */
/** 段落菜单发起时的那一块：label 是页码或「3.1 ¶2」，title 是图表编号（「表 3.19」），caption 是编号后面的图注、表题。 */
export interface QuickBlock {
  label: string;
  id?: string;
  text: string;
  sentence?: string;
  type?: BlockType;
  title?: string;
  caption?: string;
}

/** 图能不能用 A 股数据画一张同类的：讲因子、组合、行情、收益、回撤、波动的图。 */
export const chartable = (caption: string) =>
  factorish(caption) || labeling(caption) || episodic(caption) ||
  /收益|净值|价格|股价|走势|指数|回撤|波动|换手|成交|return|price|index|NAV|cumulative|wealth|drawdown|volatility/i.test(caption);

export function quick(
  kind: QuickKind,
  o: { steps: LessonStep[]; step: number; block?: QuickBlock; stepText?: string },
): Quick {
  const st = (k: number) => o.steps[k];
  const name = (k: number) => '第 ' + (k + 1) + ' 步「' + (st(k)?.title ?? '') + '」';
  const b = o.block;
  // 「[3.5.3#1]（p.168）」：块号让模型在 <current_section> 里找到这一段，标签是给人看的
  const at = b ? (b.id ? '[' + b.id + ']（' + (b.title ? b.title + '，' : '') + b.label + '）' : '（' + b.label + '）') : '';
  // 图、表、代码不贴原文开头（表是一串竖线，原文在 <current_section> 和 <selected_block> 里），写图注、表题
  const shown = b?.type === 'img' || b?.type === 'table' || b?.type === 'code';
  const said = b ? (b.sentence ? '里的这一句：「' + b.sentence.trim() + '」' : shown ? (b.caption ? '（' + b.caption + '）' : '') : '：' + lead(b.text)) : '';
  // 按钮上的名字：有编号写编号（「解释 表 3.19」），没有写「解释这张表 · p.169」
  const named = (what: string) => (b?.title ? ' ' + b.title : what + ' · ' + b!.label);
  const cross = b && empirical(b.sentence ?? b.text);
  const stepCross = !!o.stepText && empirical(o.stepText);
  // 打标签的方法看整段（一句里常常只有「它」）
  const lab = b && labeling(b.text);
  const stepLab = !!o.stepText && labeling(o.stepText);
  const labAsk = '用 meta_label_test 在一只真实的 A 股股票或指数上跑一次：主信号用均线交叉，pt、sl、hold 按书里的写法设，把「全部跟主信号」和「只做次级模型放行的」的次数、命中率、平均收益对照着讲；样本少或差距不到 2 个标准误时说这次说明不了。不要假设一个信号，数字以工具结果为准。';
  const stepEpisode = !!o.stepText && episodic(o.stepText);
  switch (kind) {
    case 'start':
      return { kind, label: '开始讲第 ' + (o.step + 1) + ' 步', question: '开始讲' + name(o.step) + '。', step: o.step };
    case 'next':
      return { kind, label: '懂了，继续', question: '懂了，继续讲' + name(o.step + 1) + '。', step: o.step + 1, hint: '接着讲' + name(o.step + 1) };
    case 'skip':
      return { kind, label: '下一步熟，跳过', question: name(o.step + 1) + '我熟，跳过，用一句话交代它讲什么，然后讲' + name(o.step + 2) + '。', step: o.step + 2, hint: '一句话带过' + name(o.step + 1) + '，接着讲' + name(o.step + 2) };
    case 'again':
      return { kind, label: '换个说法', question: '换个角度再讲一次' + name(o.step) + '，别重复原话。', hint: '换个角度把这一步再讲一次' };
    case 'example':
      return { kind, label: '举个例子', question: '给' + name(o.step) + '举个例子。', hint: '编一个小例子，不用真实行情' };
    case 'real':
      if (stepLab) {
        return { kind, label: '用真实行情举例', hint: '在一只真实证券的日线上跑主信号、三重屏障和元标签，对比加不加次级模型', question: '用真实行情给' + name(o.step) + '举个例子。这一步讲的是打标签的方法：' + labAsk };
      }
      if (stepCross) {
        return { kind, label: '用真实行情举例', hint: '这一步讲的是股票之间的规律：用因子检验在 A 股跑一次，和书里的数字对照', question: '用真实的 A 股数据给' + name(o.step) + '举个例子。这一步说的是股票之间的横截面规律：用 factor_test 按书里的口径（因子、分组、调仓周期、加权，控制了市值的用 control）在 A 股跑一次，把多空每期收益、t 值、IC 和书里的数字对照；单只股票的图证明不了这类结论，需要单只股票的例子时再用 plot_chart。数字以工具结果为准。' };
      }
      if (stepEpisode) {
        return { kind, label: '用真实行情举例', hint: '让工具在真实数据里找出跌得最深、涨得最多或波动最大的一段，画图标出来', question: '用真实的 A 股行情给' + name(o.step) + '举个例子：这一步讲到一段具体行情（回撤、急涨或波动），用 plot_chart 的 find 让工具在数据里找出那段，图上标出来，不凭记忆挑月份；数字以工具结果为准。' };
      }
      return { kind, label: '用真实行情举例', hint: '画一张真实行情图，标出讲到的那段，数字从日线现算', question: '用真实的 A 股行情给' + name(o.step) + '举个例子：用 plot_chart 画图，讲到哪段行情就用 focus 标出那段，数字以工具结果为准。' };
    case 'factor':
      return { kind, label: '这个因子在 A 股有效吗？', hint: '按书里的口径用因子检验跑一次，股票池跟书里的样本走', question: '这一节讲的因子在 A 股有效吗？先写书里的定义和口径，用 factor_test 选最接近的参数检验一次：书里用全市场或中小盘样本时用 universe = zz1000 或 zz500，大盘股用 hs300；数据还没准备时先让用户点「准备数据」，示例池只当示意。按 t 值、IC 和期数说结论。' };
    case 'quiz':
      return { kind, label: '考考我', question: '考考我' + name(o.step) + '：用 ask_quiz 出一道题。', hint: '出一道选择题，答完给解析' };
    case 'finish':
      return { kind, label: '整理本节小结', question: '这一节我懂了，请起草本节小结（propose_section_wrapup）。', hint: '起草摘要、卡点和闪卡，你确认后才保存' };
    case 'explainBlock':
      if (b!.sentence) return { kind, label: '解释这一句 · ' + b!.label, question: '用 150 字以内解释 ' + at + said + '。结合整段和前后文讲，别展开整段。' };
      if (b!.type === 'table') return { kind, label: '解释' + named('这张表'), question: '用 250 字以内解释这张表 ' + at + said + '：先说它比较的是什么（行、列各是什么，单位），再挑两三个最值得看的数说明它们说明了什么、和这一节的结论有什么关系。数字照表里的写，不另算。' };
      if (b!.type === 'img') return { kind, label: '解释' + named('这张图'), question: '用 200 字以内解释这张图 ' + at + said + '：横轴、纵轴、每条线或每组柱子各是什么，最值得看的走势或对比是什么，和这一节的结论有什么关系。你看不到图片，按图注和正文讲；正文没写的具体数值不要编。' };
      if (b!.type === 'eq') return { kind, label: '解释' + named('这个公式'), question: '用 200 字以内解释这个公式 ' + at + '：每个符号是什么，整个式子在算什么，和这一节讲的概念怎么对应；需要时补一个很小的数值例子（写在 [[example]] 里）。' };
      return { kind, label: '解释一下 ' + b!.label, question: '用 200 字以内解释这一段 ' + at + said };
    case 'linesBlock':
      return { kind, label: '逐行讲解' + named('这段代码'), question: '逐行讲解这段代码 ' + at + said + '：每一两行说清在做什么，变量对应书里的哪个概念；最后用两三句话说整段的作用。代码不执行，不编运行结果。' };
    case 'ioBlock':
      return { kind, label: b!.title ? b!.title + ' 的输入输出' : '这段代码的输入输出 · ' + b!.label, question: '说明这段代码 ' + at + said + ' 的输入和输出：参数和返回值各是什么类型、什么形状（例如 pandas 对象的索引和每一列是什么），再用一个很小的手写例子写出输入长什么样、输出长什么样。例子写在 [[example]] 里，不假装运行过。' };
    case 'fromBlock':
      return { kind, label: '从 ' + b!.label + ' 开始讲', question: '从这一段 ' + at + ' 开始讲' + name(o.step) + '。', step: o.step };
    case 'realBlock':
      if (b!.type === 'img') {
        const figCross = empirical((b!.caption ?? '') + '\n' + b!.text);
        return {
          kind,
          label: '用 A 股数据画同类图 · ' + (b!.title ?? b!.label),
          question: '用真实的 A 股数据画一张和 ' + at + said + ' 同类的图。' + (lab
            ? '这张图讲的是打标签的方法：' + labAsk
            : figCross
            ? '书里画的是因子或组合的结果（分组净值、多空累计收益、IC 这类）：用 factor_test 按书里的口径（因子、分组、调仓周期、加权，控制了市值的用 control）在 A 股跑一次，结果卡里的图就是同类的图。'
            : factorish((b!.caption ?? '') + '\n' + b!.text)
            ? '图注讲的是因子：先按图注和正文判断画的是什么。是因子或组合的横截面结果（分组净值、多空累计收益、IC）时用 factor_test 按书里的口径跑一次；是单只证券或指数随时间的走势时用 plot_chart，讲到的区间用 focus 标出。'
            : '书里画的是行情（价格、累计收益、回撤或波动）：用 plot_chart 画同样的维度，讲到的区间用 focus 标出，要找最深回撤、最大涨幅时用 find。') +
            '画完说明和书里的图有哪些口径不同（股票池、样本期、频率）；工具画不出同类的图时直接说明，不硬画。数字以工具结果为准。',
        };
      }
      return {
        kind,
        label: '用真实行情解释 ' + b!.label + (b!.sentence ? ' 这一句' : ''),
        question: '用真实的 A 股数据解释 ' + at + said + '\n' + (lab
          ? '这一段讲的是打标签的方法：' + labAsk
          : cross
          ? '这一段说的是股票之间的横截面规律：用 factor_test 按书里的定义（因子、分组、调仓周期、加权）在 A 股跑一次，把结果和书里的数字对照；需要单只股票的例子时再用 plot_chart。'
          : '用 plot_chart 画图，讲到哪段行情就用 focus 标出那段；要找跌得最深、涨得最多或波动最大的一段时用 find。数字以工具结果为准。'),
      };
    case 'replicateBlock':
      if (b!.type === 'table') {
        return {
          kind,
          label: '在 A 股复现' + named('这张表'),
          question: '在 A 股复现这张表 ' + at + said + '：先写这张表的口径（排序变量、分组数、调仓频率、加权、样本期），用 factor_test 选最接近的参数跑一次，book_table 填 ' + (b!.id ?? '这张表的块号') + '（表里有几个 Panel 或几行时用 book_panel、book_row 选和这次口径对应的那一块）；书里有等权和市值加权两种时各跑一次。再把多空每期收益、t 值、IC 和分组收益的形状与这张表逐项对照，说清哪些一致、哪些不同、为什么（股票池、样本期、期数）。',
        };
      }
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
