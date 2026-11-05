/**
 * 术语提示（PM 走查第 5 项）：一段英文原文命中哪些术语、这本书沿用哪个译法、本节第一次出现时写成「中文（English）」。
 */
import { expandTerm, termHints, termLine } from '../../src/study/glossary';

const none = { book: '', section: '' };

test('多词术语和缩写第一次出现时加英文括号；单词术语不加；公式、代码里的词不算', () => {
  const text = 'I call this problem meta-labeling. We apply the triple-barrier method and report the information coefficient (IC) and CAPM alpha; momentum is a factor. See `ridge regression` and $\\beta$.';
  const hints = termHints(text, none);
  const by = (en: string) => hints.find(h => h.en.toLowerCase() === en.toLowerCase());
  expect(by('meta-labeling')).toEqual({ en: 'meta-labeling', zh: '元标签', first: true });
  expect(by('triple-barrier')).toEqual({ en: 'triple-barrier', zh: '三重屏障', first: true });
  expect(by('information coefficient')?.zh).toBe('信息系数');
  expect(by('CAPM')).toEqual({ en: 'CAPM', zh: '资本资产定价模型', first: true });
  expect(by('momentum')).toEqual({ en: 'momentum', zh: '动量', first: false });
  // 日常词另有意思的不自动对译；反引号代码里的岭回归、公式里的 beta 不算
  expect(by('factor')).toBeUndefined();
  expect(by('alpha')).toBeUndefined();
  expect(by('ridge regression')).toBeUndefined();
  // 按在原文里出现的先后排
  expect(hints.map(h => h.en)[0]).toBe('meta-labeling');
});

test('缩写按大小写严格匹配：句中的 ic 不当成 IC；复数、空格和连字符都认', () => {
  expect(termHints('Basic ideas', none).map(h => h.en)).toEqual([]);
  expect(termHints('Two decision trees and the Sharpe ratios', none).map(h => h.en)).toEqual(['decision trees', 'Sharpe ratios']);
  expect(termHints('a meta labeling step', none)[0]).toMatchObject({ en: 'meta labeling', zh: '元标签' });
  expect(termHints('out of sample', none)[0]).toMatchObject({ zh: '样本外', first: true });
});

test('沿用这本书已有译文的写法；本节前面出现过就不再加括号', () => {
  // 本书以前把 size factor 译成「市值因子」三次、「规模因子」一次：沿用「市值因子」
  const book = '市值因子很重要。市值因子……市值因子。规模因子。';
  expect(termHints('The size factor earns a premium.', { book, section: '' })[0]).toEqual({ en: 'size factor', zh: '市值因子', first: true });
  // 本节前面的译文里已经有「元标签」：这次不加括号
  expect(termHints('Meta-labeling helps.', { book: '', section: '……元标签（meta-labeling）……' })[0]).toEqual({ en: 'Meta-labeling', zh: '元标签', first: false });
  // 只在术语表的几种写法里挑：以前写过不在表里的「元标签法」，仍取「元标签」；「元标注」用得更多时沿用「元标注」
  expect(termHints('Meta-labeling helps.', { book: '元标签法。元标签法。', section: '' })[0].zh).toBe('元标签');
  expect(termHints('Meta-labeling helps.', { book: '元标签法。元标注。元标注。', section: '' })[0].zh).toBe('元标注');
});

test('混淆矩阵的四个格子、主模型和次级模型有固定译法：同一节里 false positive 不再一会儿「假阳性」一会儿「假正例」', () => {
  const text = 'Binary classification problems present a trade-off between type-I errors (false positives) and type-II errors (false negatives).';
  expect(termHints(text, none).map(h => h.en + ' = ' + h.zh)).toEqual(['false positives = 假阳性', 'false negatives = 假阴性']);
  expect(termHints('the true positive rate', none)[0]).toEqual({ en: 'true positive', zh: '真阳性', first: true });
  // 这本书以前用的是「假正例」：沿用
  expect(termHints('by filtering out the false positives', { book: '假正例。真正例还是假正例。', section: '' })[0].zh).toBe('假正例');
  expect(expandTerm('假阳性')).toContain('false positive');
  // 主模型、次级模型同理：本书以前「主模型」用得多，就不再出「初级模型」
  expect(termHints('the buy recommendations of a primary model and a secondary model', { book: '主模型。主模型。初级模型。', section: '' }).map(h => h.zh)).toEqual(['主模型', '次级模型']);
});

test('讲解里的那一行和中文对照同一张术语表；没有命中时为空', () => {
  expect(termLine(termHints('meta-labeling and the triple barrier', none))).toBe('术语（和中文对照同一张术语表）：meta-labeling = 元标签；triple barrier = 三重屏障');
  expect(termLine([])).toBe('');
  // 检索用的扩展不变
  expect(expandTerm('元标签')).toContain('meta-labeling');
});
