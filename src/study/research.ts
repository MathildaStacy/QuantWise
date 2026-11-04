/**
 * 讲解里的因子检验存进研究手记（docs/design/lecture-retrieval-20261104.md §4.6）：书里的结论当假设，检验口径当方法，
 * IC 和多空的 t 值当证据，来源写书和小节；结论留给用户自己写（附上 AI 讲解的要点作参考）。存之前在编辑页确认。
 */
import { secLabel } from '../book/book';
import type { Book, BookSection } from '../book/types';
import { emptyResearch } from '../learning/progress';
import type { ResearchDraft } from '../learning/types';
import { pct, type ChartData } from '../quant/charts';
import { FACTORS } from '../quant/factors';

const plain = (t: string) =>
  t.replace(/\[\[b:[^\]]*\]\]/g, '').replace(/\[\[\/?[a-z]+\]\]/g, '').replace(/\$\$?/g, '').replace(/\*\*|`|^#+\s*/gm, '').replace(/\s+/g, ' ').trim();

export function researchFromFactor(o: {
  chart: Extract<ChartData, { kind: 'factor' }>;
  book: Pick<Book, 'id' | 'title'>;
  section: BookSection;
  /** 书里的说法：提问原文（从某一段发起时）或问题。 */
  claim: string;
  /** 这一问 AI 的讲解文字。 */
  answer?: string;
}): ResearchDraft {
  const { chart: c } = o;
  const f = FACTORS[c.factor];
  const st = c.stats;
  const from = c.dates[0];
  const to = c.dates[c.dates.length - 1];
  const sig = (t: number) => (Math.abs(t) >= 2 ? '|t| ≥ 2' : '|t| < 2，不显著');
  const draft = emptyResearch();
  return {
    ...draft,
    title: ('复现：' + f.name + ' · ' + secLabel(o.section)).slice(0, 60),
    hypothesis: '书中说（《' + o.book.title + '》' + secLabel(o.section) + '）：' + plain(o.claim).slice(0, 400),
    method:
      '因子 ' + f.name + '（' + f.formula + (f.approx ? '，近似' : '') + '）；' +
      (st ? '股票池 ' + st.universe + '；每 ' + st.hold + ' 个交易日调仓，从低到高分 ' + st.groups + ' 组' + (st.weight === 'cap' ? '按市值加权' : '等权') + '；单边成本' + (st.costBp ? '万 ' + st.costBp : '不扣') + '；' : '') +
      '前复权日线 ' + from + ' 到 ' + to + (st ? '，' + st.periods + ' 期' : '') + '（因读 factor_test）',
    evidence: st
      ? 'Rank IC 均值 ' + (st.icMean > 0 ? '+' : '') + st.icMean.toFixed(3) + '（t ' + st.icT.toFixed(2) + '，' + sig(st.icT) + '）；多空每期平均 ' + pct(st.longShortMean, 2) + '（t ' + st.longShortT.toFixed(2) + '，' + sig(st.longShortT) + '），年化 ' + pct(st.longShortAnnual)
      : '见讲解里的分组净值图（' + from + ' 到 ' + to + '）',
    conclusion: o.answer ? 'AI 讲解要点（改成你自己的判断）：' + plain(o.answer).slice(0, 300) : '',
    source: { bookId: o.book.id, sectionId: o.section.id, bookTitle: o.book.title, sectionTitle: secLabel(o.section) },
    checks: {
      ...draft.checks,
      timing: '调仓日收盘计算因子，按调仓日收盘价成交',
      universe: st ? st.universe + '：当前成分，有幸存者偏差' : '',
      cost: st ? (st.costBp ? '单边万 ' + st.costBp : '没扣交易成本') : '',
    },
  };
}
