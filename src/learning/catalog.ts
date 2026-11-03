import type { Concept, ConceptId, LearningGoal, Question } from './types';

export const GOALS: Record<
  LearningGoal,
  { title: string; description: string }
> = {
  foundation: {
    title: '读懂量化基础',
    description: '先理解收益、风险和书里的公式',
  },
  factor: { title: '理解因子实践', description: '把动量、IC 和交易成本串起来' },
  research: {
    title: '建立研究习惯',
    description: '提出假设，检查偏差，记录证据',
  },
};

/** 原创概念索引；来源指向仓库内置教材的实际章节，不假借外部书籍。 */
export const CONCEPTS: Concept[] = [
  {
    id: 'returns',
    title: '收益与复利',
    english: 'Return & Compounding',
    group: 'foundation',
    definition:
      '收益描述资产在一个期间的变化。跨期累计简单收益要连乘，不能直接相加。',
    formula: '累计收益 = (1 + r₁) × (1 + r₂) × … − 1',
    example:
      '100 元先涨 10% 再跌 10%，变成 100 × 1.1 × 0.9 = 99 元，累计收益为 −1%。',
    pitfall:
      '先涨后跌相同百分比不会回到起点。计算股票收益时还要一致处理分红、拆股和复权。',
    prerequisites: [],
    sectionId: '1.1',
  },
  {
    id: 'drawdown',
    title: '最大回撤',
    english: 'Maximum Drawdown',
    group: 'foundation',
    definition:
      '回撤是净值相对此前最高点的跌幅，最大回撤取整个观察区间最深的一次。这里以正数表达跌幅。',
    formula: '回撤幅度 = 1 − 当前净值 / 此前最高净值',
    example:
      '净值从 100 到 120 再到 90，最高点是 120，最大回撤幅度为 1 − 90/120 = 25%，不是 10%。',
    pitfall: '不能只用期初和期末计算回撤；比较策略需要相同区间。',
    prerequisites: ['returns'],
    sectionId: '1.3',
  },
  {
    id: 'sharpe',
    title: '夏普比率',
    english: 'Sharpe Ratio',
    group: 'foundation',
    definition:
      '衡量每单位收益波动对应的超额收益。收益、无风险收益和波动率必须使用相同周期。',
    formula: '夏普 = (平均收益 − 无风险收益) / 收益标准差',
    example:
      '采用一致的年化口径，收益 12%、无风险收益 2%、波动率 20%，夏普为 (12% − 2%)/20% = 0.5。',
    pitfall: '短样本高夏普不等于稳定有效；波动率为零时这个比值没有定义。',
    prerequisites: ['returns', 'drawdown'],
    sectionId: '1.4',
  },
  {
    id: 'momentum',
    title: '动量因子',
    english: 'Momentum',
    group: 'factor',
    definition:
      '用过去一段时间的表现给股票排序，检验这种排序能否解释未来的相对收益。',
    formula: 'n 日动量 = Pₜ / Pₜ₋ₙ − 1',
    example:
      '20 日前复权价 10 元，今天 11 元，20 日动量为 10%。这只是历史特征，还不是未来收益。',
    pitfall:
      '过去涨得多并不保证以后上涨；形成信号的时点必须早于可执行的交易时点。',
    prerequisites: ['returns'],
    sectionId: '3.1',
  },
  {
    id: 'ic',
    title: '信息系数',
    english: 'IC / Rank IC',
    group: 'factor',
    definition:
      '在同一截面中衡量因子值与之后收益的相关性。Rank IC 比较两者排名。',
    formula: 'Rank IC = corr(rank(因子值), rank(未来收益))',
    example:
      '三只股票的因子排名是 1、2、3，未来收益排名也是 1、2、3，Rank IC 为 1；反序则为 −1。',
    pitfall: 'IC 不是收益率，也不包含交易成本；一天的高 IC 需要更多日期检验。',
    prerequisites: ['momentum'],
    sectionId: '4.2',
  },
  {
    id: 'costs',
    title: '换手与成本',
    english: 'Turnover & Costs',
    group: 'factor',
    definition:
      '策略收益必须扣除实际买卖引起的费用和滑点。成本随交易金额和频率累积。',
    formula:
      '成本比例 ≈ 买入金额/净资产 × 买入费率 + 卖出金额/净资产 × 卖出费率',
    example:
      '资产 10 万元，买入 2 万、卖出 2 万，假设双边费率各 0.1%，合计成本 40 元，占资产 0.04%。',
    pitfall:
      '双边交易不能只扣一边。真实股票佣金、印花税、最低费用和滑点需分别建模。',
    prerequisites: ['returns', 'momentum'],
    sectionId: '4.4',
  },
  {
    id: 'leakage',
    title: '未来信息与幸存者偏差',
    english: 'Look-ahead & Survivorship Bias',
    group: 'research',
    definition:
      '回测只能使用决策当时可获得的信息和当时的可投资对象。未来公告和今天仍存续的股票名单都可能泄露未来。',
    formula: '信息可用时间 ≤ 信号时间 < 执行时间',
    example:
      '3 月 31 日结束的财季，4 月 25 日才公告。4 月 1 日构建策略时不能使用这份财报。',
    pitfall:
      '财报报告期不等于公告日；用今天的成分股回测过去会漏掉退出、退市的股票。',
    prerequisites: ['momentum'],
    sectionId: '4.5',
  },
  {
    id: 'overfit',
    title: '样本外与过拟合',
    english: 'Out-of-sample & Overfitting',
    group: 'research',
    definition:
      '反复挑参数会把历史噪声当规律。事先固定规则，并在未参与选择的数据上验证，才能得到更可信的检验。',
    formula: '训练 / 验证 / 最终测试：按时间顺序隔离',
    example:
      '在 2015–2020 年选参数，2021–2022 年做验证，2023–2025 年留作最终测试；看过最终结果再调参后，那段就不再是未见样本。',
    pitfall:
      '随机打乱时间序列可能泄露相邻信息；试过很多方案后，只报告最好的一个会夸大证据。',
    prerequisites: ['ic', 'leakage'],
    sectionId: '4.5',
  },
];

export function conceptById(id: string): Concept | undefined {
  return CONCEPTS.find(c => c.id === id);
}

// ID 带内容版本；题意或正确答案发生变化时新建 ID，历史作答仍可追溯。
export const QUESTIONS: Question[] = [
  {
    id: 'returns-1',
    conceptId: 'returns',
    prompt: '净值先涨 10%，再跌 10%。累计收益是多少？',
    options: ['0%', '−1%', '+1%'],
    answer: 1,
    explanation: '1.1 × 0.9 − 1 = −1%。涨跌的计算基数不同。',
  },
  {
    id: 'returns-2',
    conceptId: 'returns',
    prompt: '两天简单收益分别为 r₁ 和 r₂，正确的累计方式是？',
    options: ['r₁ + r₂', '(r₁ + r₂) / 2', '(1+r₁)(1+r₂) − 1'],
    answer: 2,
    explanation: '简单收益按时间复合；只有对数收益可以跨期直接求和。',
  },
  {
    id: 'drawdown-1',
    conceptId: 'drawdown',
    prompt: '净值依次为 100、120、90、110，最大回撤幅度为？',
    options: ['25%', '10%', '8.33%'],
    answer: 0,
    explanation: '最大跌幅发生在 120 到 90：1 − 90/120 = 25%。',
  },
  {
    id: 'drawdown-2',
    conceptId: 'drawdown',
    prompt: '净值跌去 50% 后，需要上涨多少才能回到原点？',
    options: ['50%', '75%', '100%'],
    answer: 2,
    explanation: '100 跌到 50，再从 50 涨到 100，需要上涨 50/50 = 100%。',
  },
  {
    id: 'sharpe-1',
    conceptId: 'sharpe',
    prompt: '同一年化口径：收益 12%、无风险收益 2%、波动率 20%，夏普是多少？',
    options: ['0.6', '0.5', '5'],
    answer: 1,
    explanation: '(0.12 − 0.02) / 0.20 = 0.5。先扣无风险收益。',
  },
  {
    id: 'sharpe-2',
    conceptId: 'sharpe',
    prompt: '只用一个月样本得到高夏普，最合理的下一步是？',
    options: ['断定策略稳定有效', '忽略交易成本', '检查更长样本和样本外表现'],
    answer: 2,
    explanation:
      '短期估计噪声很大，需要更多样本、成本和样本外证据，不能从单次高夏普推出长期有效。',
  },
  {
    id: 'momentum-1',
    conceptId: 'momentum',
    prompt: '20 日前复权价 10 元，今天 11 元，20 日动量为？',
    options: ['10%', '1%', '11%'],
    answer: 0,
    explanation: '11/10 − 1 = 10%。分子分母需使用一致价格口径。',
  },
  {
    id: 'momentum-2',
    conceptId: 'momentum',
    prompt: '使用今天完整收盘价构建动量信号，哪种执行设定更合理？',
    options: [
      '假设能以今天开盘价买入',
      '在后续可交易时点执行',
      '把未来一周收益加入信号',
    ],
    answer: 1,
    explanation: '收盘后才能知道完整收盘信号，不能追溯到当天开盘执行。',
  },
  {
    id: 'ic-1',
    conceptId: 'ic',
    prompt: '因子排名 1、2、3，未来收益排名 3、2、1，Rank IC 为？',
    options: ['1', '0', '−1'],
    answer: 2,
    explanation: '排名完全反向，秩相关为 −1。',
  },
  {
    id: 'ic-2',
    conceptId: 'ic',
    prompt: '平均 IC 为 0.05，能够直接推出什么？',
    options: [
      '每月收益 5%',
      '因子值与未来收益具有样本内正相关',
      '扣费后一定赚钱',
    ],
    answer: 1,
    explanation:
      'IC 是相关系数，不是收益率；仍需检查稳定性、显著性、成本和执行。',
  },
  {
    id: 'costs-1',
    conceptId: 'costs',
    prompt:
      '资产 10 万，买入 2 万、卖出 2 万，各收 0.1%，不计其他费用，成本是多少？',
    options: ['40 元', '20 元', '200 元'],
    answer: 0,
    explanation: '20000 × 0.001 × 2 = 40 元，买卖两边都需要计入。',
  },
  {
    id: 'costs-2',
    conceptId: 'costs',
    prompt: '两个策略毛收益相同，哪个因素可能让净收益明显不同？',
    options: ['策略名称', '图表颜色', '换手频率与滑点'],
    answer: 2,
    explanation: '交易越频繁，累计费用和滑点可能越高；需要按实际成交金额估算。',
  },
  {
    id: 'leakage-1',
    conceptId: 'leakage',
    prompt: '3 月 31 日财季结束，4 月 25 日公告。4 月 1 日回测能使用该财报吗？',
    options: [
      '可以，报告期已结束',
      '不可以，尚未公告',
      '只要全年数据齐全就可以',
    ],
    answer: 1,
    explanation: '必须按当时可获得的信息建模，报告期不能代替公告时间。',
  },
  {
    id: 'leakage-2',
    conceptId: 'leakage',
    prompt: '用今天的指数成分股回测十年前，最需要检查哪种偏差？',
    options: ['幸存者与成分选择偏差', '四舍五入误差', '时区只影响文字'],
    answer: 0,
    explanation:
      '今天的名单可能排除了退出或退市的股票，不能代表十年前可投资的股票池。',
  },
  {
    id: 'overfit-1',
    conceptId: 'overfit',
    prompt: '看过最终测试集的表现后反复调参，再报告同一测试集，应如何描述？',
    options: [
      '仍是独立样本外验证',
      '已经完美验证',
      '测试集参与了选择，需要新的未见样本',
    ],
    answer: 2,
    explanation: '使用结果调参就让测试集参与了模型选择，它不再是未见数据。',
  },
  {
    id: 'overfit-2',
    conceptId: 'overfit',
    prompt: '试过 100 组参数，只报告最好的结果，主要问题是？',
    options: [
      '参数越多，结论必然越稳',
      '多重尝试放大偶然性，应保留试验记录',
      '只需换一种净值图',
    ],
    answer: 1,
    explanation:
      '多重尝试容易碰巧挑中噪声。保留失败实验和参数搜索范围，使用独立验证。',
  },
];

export const CHECKS = [
  {
    id: 'timing',
    title: '信息与交易时点',
    hint: '数据何时可用？信号产生后在哪个时点执行？',
  },
  {
    id: 'universe',
    title: '历史股票池',
    hint: '是否使用当时成分，如何处理退市、停牌和 ST？',
  },
  {
    id: 'cost',
    title: '费用与成交约束',
    hint: '佣金、税费、滑点、涨跌停和换手如何处理？',
  },
  {
    id: 'holdout',
    title: '样本外与多重尝试',
    hint: '训练与测试区间是什么？试过哪些参数？',
  },
] as const;

export const ORDER: Record<LearningGoal, ConceptId[]> = {
  foundation: CONCEPTS.map(c => c.id),
  factor: [
    'returns',
    'momentum',
    'ic',
    'costs',
    'drawdown',
    'sharpe',
    'leakage',
    'overfit',
  ],
  research: [
    'returns',
    'momentum',
    'leakage',
    'ic',
    'overfit',
    'costs',
    'drawdown',
    'sharpe',
  ],
};
