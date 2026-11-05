/**
 * 量化、统计和机器学习术语的中英对照（docs/design/lecture-retrieval-20261104.md §3）：search_book 用它把
 * 「岭回归」扩展成「ridge regression」，英文书用中文搜也能命中；反过来中文书用英文术语搜也一样。
 * 每行是同一个概念的几种写法，第一项中文、其余英文或别名。只放书里常见、意思不含糊的词。
 */
const GROUPS: string[][] = [
  ['动量', 'momentum'],
  ['反转', 'reversal'],
  ['短期反转', 'short-term reversal'],
  ['动量崩溃', 'momentum crash', 'momentum crashes'],
  ['价值因子', 'value factor'],
  ['规模因子', 'size factor', '市值因子'],
  ['小市值', 'small cap', 'small-cap'],
  ['盈利因子', 'profitability factor'],
  ['投资因子', 'investment factor'],
  ['质量因子', 'quality factor'],
  ['低波动', 'low volatility', 'low-volatility'],
  ['特质波动率', 'idiosyncratic volatility', '特质性波动率'],
  ['换手率', 'turnover'],
  ['流动性', 'liquidity'],
  ['因子', 'factor'],
  ['多因子模型', 'multi-factor model', 'multifactor model'],
  ['因子暴露', 'factor exposure', 'factor loading', '因子载荷'],
  ['因子收益率', 'factor return'],
  ['异象', 'anomaly', 'anomalies'],
  ['市场因子', 'market factor'],
  ['超额收益', 'excess return', 'abnormal return'],
  ['阿尔法', 'alpha', 'α'],
  ['贝塔', 'beta', 'β'],
  ['风险溢价', 'risk premium'],
  ['资本资产定价模型', 'capital asset pricing model', 'CAPM'],
  ['三因子模型', 'three-factor model'],
  ['五因子模型', 'five-factor model'],
  ['投资组合排序', 'portfolio sort', 'portfolio sorts', 'sorted portfolios', '排序法'],
  ['单变量排序', 'univariate sort', 'univariate sorts', 'single sort', '单因子排序'],
  ['双重排序', 'double sort', 'double-sorted'],
  ['等权重', 'equal-weighted', 'equally weighted', 'equal weight', '等权'],
  ['市值加权', 'value-weighted', 'value weighted', 'cap-weighted', 'market-cap weighted'],
  ['累计收益率', 'cumulative return', 'cumulative returns', '累计收益', '累积收益率'],
  ['描述性统计', 'descriptive statistics', 'summary statistics'],
  ['多空组合', 'long-short', 'long/short', 'long–short'],
  ['分组回测', 'quantile portfolio', 'decile portfolio', '十分位'],
  ['信息系数', 'information coefficient', 'IC'],
  ['信息比率', 'information ratio'],
  ['夏普比率', 'sharpe ratio'],
  ['最大回撤', 'maximum drawdown', 'max drawdown'],
  ['回撤', 'drawdown'],
  ['波动率', 'volatility'],
  ['协方差矩阵', 'covariance matrix'],
  ['相关系数', 'correlation'],
  ['横截面回归', 'cross-sectional regression', '截面回归'],
  ['时间序列回归', 'time-series regression', '时序回归'],
  ['面板数据', 'panel data'],
  ['标准误', 'standard error', 'standard errors'],
  ['t 值', 't-statistic', 't-stat', 't-value', 't值'],
  ['p 值', 'p-value', 'p值'],
  ['显著性', 'significance', 'significant'],
  ['多重检验', 'multiple testing', 'multiple hypothesis testing', '多重假设检验'],
  ['数据窥探', 'data snooping', 'p-hacking'],
  ['过拟合', 'overfitting', 'overfit'],
  ['回测过拟合', 'backtest overfitting'],
  ['回测', 'backtest', 'backtesting'],
  ['样本外', 'out-of-sample', 'out of sample'],
  ['样本内', 'in-sample', 'in sample'],
  ['幸存者偏差', 'survivorship bias'],
  ['前视偏差', 'look-ahead bias', 'lookahead bias'],
  ['交易成本', 'transaction cost', 'transaction costs'],
  ['市场冲击', 'market impact'],
  ['滑点', 'slippage'],
  ['调仓', 'rebalance', 'rebalancing'],
  ['仓位', 'position sizing', 'bet sizing'],
  ['投资组合优化', 'portfolio optimization'],
  ['均值方差', 'mean-variance', 'mean variance'],
  ['风险平价', 'risk parity'],
  ['层次风险平价', 'hierarchical risk parity', 'HRP'],
  ['因子择时', 'factor timing'],
  ['聪明贝塔', 'smart beta'],
  ['风险模型', 'risk model'],
  ['风格分析', 'style analysis'],
  ['归因', 'attribution'],
  ['收益率', 'return', 'returns'],
  ['对数收益率', 'log return', 'log returns'],
  ['复权', 'adjusted price', 'price adjustment'],
  ['平稳性', 'stationarity', 'stationary'],
  ['分数阶差分', 'fractional differentiation', 'fractionally differentiated', '分数差分'],
  ['三重屏障', 'triple-barrier', 'triple barrier', '三重障碍'],
  ['元标签', 'meta-labeling', 'meta labeling', '元标注'],
  ['样本权重', 'sample weights', 'sample weight'],
  ['唯一性', 'uniqueness'],
  ['清洗', 'purging', 'purged'],
  ['禁区', 'embargo'],
  ['交叉验证', 'cross-validation', 'cross validation'],
  ['k 折交叉验证', 'k-fold', 'k-fold cross-validation'],
  ['特征重要性', 'feature importance'],
  ['结构突变', 'structural break', 'structural breaks'],
  ['熵', 'entropy'],
  ['微观结构', 'microstructure'],
  ['美元K线', 'dollar bars', 'dollar bar'],
  ['成交量K线', 'volume bars'],
  ['线性回归', 'linear regression'],
  ['逻辑回归', 'logistic regression'],
  ['岭回归', 'ridge regression', 'ridge'],
  ['套索回归', 'lasso'],
  ['正则化', 'regularization', 'shrinkage', '收缩'],
  ['偏差方差权衡', 'bias-variance trade-off', 'bias-variance tradeoff', '偏差-方差权衡'],
  ['最小二乘', 'least squares', 'OLS'],
  ['极大似然', 'maximum likelihood'],
  ['主成分分析', 'principal component analysis', 'principal components', 'PCA'],
  ['聚类', 'clustering'],
  ['决策树', 'decision tree', 'decision trees'],
  ['随机森林', 'random forest', 'random forests'],
  ['梯度提升', 'gradient boosting', 'boosting'],
  ['装袋', 'bagging'],
  ['支持向量机', 'support vector machine', 'SVM'],
  ['卷积神经网络', 'convolutional neural network', 'convolutional neural networks', 'CNN', 'CNNs'],
  ['循环神经网络', 'recurrent neural network', 'recurrent neural networks', 'RNN', 'RNNs'],
  ['神经网络', 'neural network', 'neural networks'],
  ['深度学习', 'deep learning'],
  ['自助法', 'bootstrap'],
  ['置信区间', 'confidence interval'],
  ['假设检验', 'hypothesis test', 'hypothesis testing'],
  ['残差', 'residual', 'residuals'],
  ['自相关', 'autocorrelation'],
  ['异方差', 'heteroskedasticity', 'heteroscedasticity'],
  ['广义矩估计', 'generalized method of moments', 'GMM'],
  ['工具变量', 'instrumental variable', 'instrumental variables'],
  ['分类', 'classification'],
  ['训练集', 'training set', 'training data'],
  ['测试集', 'test set', 'test data'],
  ['验证集', 'validation set'],
  ['混淆矩阵', 'confusion matrix'],
  ['精确率', 'precision'],
  ['召回率', 'recall'],
  ['投资者情绪', 'investor sentiment'],
  ['行为金融', 'behavioral finance'],
  ['有效市场', 'efficient market', 'efficient markets'],
  ['套利限制', 'limits to arbitrage'],
  ['处置效应', 'disposition effect'],
  ['过度自信', 'overconfidence'],
  ['做市', 'market making', 'market maker'],
  ['高频', 'high-frequency', 'high frequency'],
  ['阿尔法模型', 'alpha model'],
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const INDEX = new Map<string, string[]>();
for (const g of GROUPS) {
  for (const w of g) {
    const k = norm(w);
    INDEX.set(k, [...new Set([...(INDEX.get(k) ?? []), ...g])]);
  }
}

/** 一个检索词的几种写法（含自己）；词表里没有时只有自己。 */
export function expandTerm(term: string): string[] {
  const own = term.trim();
  const hit = INDEX.get(norm(own));
  return hit ? [own, ...hit.filter(w => norm(w) !== norm(own))] : [own];
}

/** 翻译和讲解里用的一条术语：原文里的写法、这本书的译法、本节第一次出现时写成「中文（English）」。 */
export interface TermHint {
  en: string;
  zh: string;
  first: boolean;
}

// 日常英语里另有常见意思的单词不自动对译（recall「回想」、significant「重要的」），交给模型按上下文译
const LOOSE = new Set(['recall', 'precision', 'significant', 'significance', 'boosting', 'ridge', 'shrinkage', 'factor', 'alpha', 'beta', 'classification', 'residual', 'residuals', 'return', 'returns', 'correlation']);
const HAN = /\p{Script=Han}/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const count = (text: string, w: string) => {
  let n = 0;
  for (let i = w ? text.indexOf(w) : -1; i >= 0; i = text.indexOf(w, i + w.length)) n++;
  return n;
};

/** 中文写法在已有译文里出现了几次；短的写法不把长写法里的那几次算进来（「元标签」不算「元标签法」里的）。 */
function usage(zh: string[], text: string): number[] {
  const raw = zh.map(w => count(text, w));
  return zh.map((w, i) => raw[i] - zh.reduce((n, o, j) => (j !== i && o.length > w.length && o.includes(w) ? n + raw[j] : n), 0));
}

/**
 * 一段英文原文里命中的术语（PM 走查第 5 项：同一节里 meta-labeling 译成「元标签法」「元标签」两种）。
 * 译法：这本书已保存的译文里用过的写法（同一组里用得最多的），没用过时取术语表的第一个中文写法。
 * first：多词术语和缩写（meta-labeling、information coefficient、CAPM）在本节前面的译文里还没出现过时，第一次写成「元标签（meta-labeling）」；
 * 单词术语（momentum、factor）不加括号。公式、代码、网址里的词不算。
 */
export function termHints(text: string, prior: { book: string; section: string }, max = 16): TermHint[] {
  const prose = text.replace(/\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$])*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|`[^`]*`|https?:\/\/\S+/g, ' ');
  const out: (TermHint & { at: number })[] = [];
  for (const g of GROUPS) {
    const zh = g.filter(w => HAN.test(w));
    const en = g.filter(w => !HAN.test(w) && /[A-Za-z]/.test(w) && !LOOSE.has(w.toLowerCase()));
    if (!zh.length || !en.length) {
      continue;
    }
    let hit: { at: number; said: string } | null = null;
    for (const w of en) {
      const upper = w === w.toUpperCase();
      const m = new RegExp('(?<![A-Za-z])' + escape(w).replace(/ /g, '[\\s-]+') + (upper ? '' : '(?:e?s)?') + '(?![A-Za-z])', upper ? '' : 'i').exec(prose);
      if (m && (!hit || m.index < hit.at)) {
        hit = { at: m.index, said: m[0] };
      }
    }
    if (!hit) {
      continue;
    }
    const used = usage(zh, prior.book);
    const best = used.reduce((b, n, i) => (n > used[b] ? i : b), 0);
    const pick = zh[used[best] > 0 ? best : 0];
    const multi = /[\s-]/.test(hit.said) || hit.said === hit.said.toUpperCase();
    out.push({ en: hit.said, zh: pick, first: multi && !prior.section.includes(pick), at: hit.at });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, max).map(t => ({ en: t.en, zh: t.zh, first: t.first }));
}

/** 讲解里附的一行：「术语：meta-labeling = 元标签；triple-barrier = 三重屏障」，讲解的译法和中文对照一致。 */
export const termLine = (hints: TermHint[]) => (hints.length ? '术语（和中文对照同一张术语表）：' + hints.map(h => h.en + ' = ' + h.zh).join('；') : '');

/** 太泛的概念不拿来给讲解步骤起名（「因子」「收益率」在每一步都有）。 */
const GENERIC = new Set(['因子', '收益率', '回测', '阿尔法', '贝塔', '分类', '残差', '相关系数', '显著性', 't 值', 'p 值']);

/**
 * 一段文字讲到的概念（中文写法），按出现次数、再按第一次出现的位置排（PM 走查第 3 项：讲解步骤用关键词起名）。
 * 中英写法都算；长写法里的短写法不另算（「动量崩溃」不算「动量」）。公式、代码、网址不算。
 */
export function topicTerms(text: string, max = 3, min = 1): string[] {
  const prose = text.replace(/\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$])*?\$|`[^`]*`|https?:\/\/\S+/g, ' ');
  const spans: { g: number; at: number; end: number }[] = [];
  GROUPS.forEach((g, gi) => {
    if (!g.some(w => HAN.test(w)) || GENERIC.has(g[0]) || g.some(w => LOOSE.has(w.toLowerCase()))) return;
    for (const w of g) {
      const latin = !HAN.test(w);
      const re = latin
        ? new RegExp('(?<![A-Za-z])' + escape(w).replace(/ /g, '[\\s-]+') + (w === w.toUpperCase() ? '' : '(?:e?s)?') + '(?![A-Za-z])', w === w.toUpperCase() ? 'g' : 'gi')
        : new RegExp(escape(w), 'g');
      for (const m of prose.matchAll(re)) spans.push({ g: gi, at: m.index!, end: m.index! + m[0].length });
    }
  });
  // 被更长的写法盖住的那一次不算（「动量崩溃」里的「动量」），同一组同一位置只算一次
  const kept = spans.filter(a => !spans.some(b => b !== a && b.g !== a.g && b.at <= a.at && b.end >= a.end && b.end - b.at > a.end - a.at));
  const seen = new Set<string>();
  const stat = new Map<number, { n: number; first: number }>();
  for (const a of kept) {
    if (seen.has(a.g + ':' + a.at)) continue;
    seen.add(a.g + ':' + a.at);
    const s0 = stat.get(a.g) ?? { n: 0, first: a.at };
    stat.set(a.g, { n: s0.n + 1, first: Math.min(s0.first, a.at) });
  }
  return [...stat.entries()]
    .filter(([, x]) => x.n >= min)
    .sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)
    .slice(0, max)
    .map(([g]) => GROUPS[g].find(w => HAN.test(w))!);
}
