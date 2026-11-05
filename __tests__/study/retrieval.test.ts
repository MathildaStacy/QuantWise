/**
 * 讲解的上下文检索（docs/design/lecture-retrieval-20261104.md）：书内检索的拆词、扩展和排序，选段讲解带上的上下文，
 * 没问成的提问不再发给模型，「用真实行情举例」按段落内容选工具，步骤标题，复现结果存进研究手记。
 */
import type { StoredMessage } from '../../src/ai/types';
import { applyNames, planSteps, stepKey } from '../../src/book/steps';
import type { BookBlock, BookSection } from '../../src/book/types';
import { empirical, lead, quick } from '../../src/study/quick';
import { expandTerm } from '../../src/study/glossary';
import { researchFromFactor } from '../../src/study/research';
import { backMatter, bookLanguage, citationLike, conceptsOf, rankBlocks, variantPattern } from '../../src/study/search';
import { isCaptionOf, isEquationOf, refsIn, selectedContext } from '../../src/study/selection';
import { withoutFailedTurns } from '../../src/study/session';

jest.mock('../../src/data/drivers/opSqlite', () => ({ openDeviceDb: () => { throw new Error('测试里不用设备数据库'); } }));
jest.mock('../../src/app/tracker', () => ({ nativeTracker: () => null }));

let seq = 0;
const blk = (sectionId: string, no: number, text: string, type: BookBlock['type'] = 'p', page: number | null = null): BookBlock =>
  ({ seq: seq++, sectionId, no, type, text, page }) as BookBlock;
const sec = (id: string, title: string, leaf = true): BookSection =>
  ({ id, parentId: null, ord: 0, level: 2, no: /^\d/.test(id) ? id : '', title, leaf, blockFrom: 0, blockTo: 0, pageFrom: null, pageTo: null, chars: 0 });

describe('书内检索：拆词、扩展、排序', () => {
  it('查询拆成概念：空格和 | 分开，词表里的英文短语保持完整，中英互相扩展', () => {
    expect(conceptsOf('动量 崩溃').map(c => c[0])).toEqual(['动量', '崩溃']);
    expect(conceptsOf('ridge regression')).toHaveLength(1);
    expect(conceptsOf('ridge regression')[0]).toContain('岭回归');
    expect(conceptsOf('三重屏障')[0]).toEqual(expect.arrayContaining(['triple-barrier', 'triple barrier']));
    expect(conceptsOf('momentum | reversal').map(c => c[0])).toEqual(['momentum', 'reversal']);
    expect(expandTerm('不在词表里的词')).toEqual(['不在词表里的词']);
  });

  it('英文按词边界、短缩写区分大小写：ridge 不命中 bridge，IC 不命中 price', () => {
    expect('a bridge'.match(variantPattern('ridge'))).toBeNull();
    expect('ridge-regression and Ridge Regression'.match(variantPattern('ridge regression'))).toHaveLength(2);
    expect('price statistic'.match(variantPattern('IC'))).toBeNull();
    expect('Rank IC 均值'.match(variantPattern('IC'))).toHaveLength(1);
  });

  it('专讲这个概念的小节排在前言前面；概念全命中优先；每个小节最多 2 处', () => {
    const sections = [sec('c4', '前言'), sec('1.1', '一个公式'), sec('3.5.3', '动量因子实证'), sec('c8', '参考文献')];
    const candidates = [
      blk('c4', 1, '本书讨论动量、价值等因子。'),
      blk('1.1', 2, '动量是常见的异象之一。'),
      blk('3.5.3', 1, '动量效应在 A 股不显著，更多表现为反转；动量崩溃常出现在市场反弹时。'),
      blk('3.5.3', 2, '动量因子的月均收益率不显著。'),
      blk('3.5.3', 3, '动量组合的描述性统计。'),
      blk('c8', 1, 'Daniel K, Moskowitz T J. Momentum crashes[J]. Journal of Financial Economics, 2016.'),
    ];
    const r = rankBlocks({ concepts: conceptsOf('动量 崩溃'), candidates, sections, total: 3000 });
    expect(r.hits[0].block.sectionId).toBe('3.5.3');
    expect(r.hits[0].block.no).toBe(1);
    expect(r.sections[0].id).toBe('3.5.3');
    expect(r.missing).toEqual([]);
    expect(rankBlocks({ concepts: conceptsOf('动量 量子'), candidates, sections, total: 3000 }).missing).toEqual(['量子']);
    expect(r.hits.filter(h => h.block.sectionId === '3.5.3')).toHaveLength(2);
    // 参考文献条目虽然英文里有 momentum crashes，也排在后面
    expect(r.hits.findIndex(h => h.block.sectionId === 'c8')).toBeGreaterThan(0);
    expect(backMatter('参考文献')).toBe(true);
    expect(backMatter('3.5 动量因子')).toBe(false);
    expect(citationLike(candidates[5].text)).toBe(true);
  });

  it('英文书用中文搜：按词表扩展成英文能命中；只有中文译文命中时标出来', () => {
    const sections = [sec('3.4', 'TRIPLE-BARRIER METHOD'), sec('3.6', 'META-LABELING')];
    const a = blk('3.4', 1, 'The triple-barrier method labels an observation according to the first barrier touched.');
    const b = blk('3.6', 2, 'Suppose that you have a model for setting the side of the bet.');
    const r = rankBlocks({ concepts: conceptsOf('三重屏障'), candidates: [a, b], sections, total: 2000, translations: new Map([[b.seq, '假设你有一个决定下注方向的模型，再用三重屏障打标签。']]) });
    expect(r.hits.map(h => h.block.sectionId)).toEqual(['3.4', '3.6']);
    expect(r.hits[0].viaTranslation).toBeUndefined();
    expect(r.hits[1].viaTranslation).toBe(true);
    expect(bookLanguage([a, b])).toBe('en');
    expect(bookLanguage([blk('1', 1, '动量是过去一段时间的累计收益，用复权价算。')])).toBe('zh');
  });

  it('当前小节的命中降权（已经在上下文里）', () => {
    const sections = [sec('2.1', '排序法'), sec('3.1', '动量因子')];
    const here = blk('3.1', 1, '动量排序。');
    const there = blk('2.1', 1, '动量排序。');
    const r = rankBlocks({ concepts: conceptsOf('动量 排序'), candidates: [here, there], sections, total: 100, currentSection: '3.1' });
    expect(r.hits[0].block.sectionId).toBe('2.1');
  });
});

describe('选段讲解的上下文', () => {
  it('段里提到的图、表、公式、代码片段、小节都找出来', () => {
    const refs = refsIn('实证期内动量变量的数据覆盖度如图3.20所示，描述性统计见表3.19，方法见第2.2.4节和式（2.3）。See Table 4.1, Figure 3-2 and Snippet 3.1 in Section 3.6.');
    expect(refs.map(r => r.kind + ':' + r.key)).toEqual(['figure:3.20', 'table:3.19', 'section:2.2.4', 'equation:2.3', 'table:4.1', 'figure:3.2']);
    expect(refsIn('Snippet 3.1 in Section 3.6')).toEqual([
      { kind: 'snippet', key: '3.1', said: 'Snippet 3.1' },
      { kind: 'section', key: '3.6', said: 'Section 3.6' },
    ]);
  });

  it('图注、表题只认开头；带编号的公式认 \\tag 和末尾编号', () => {
    expect(isCaptionOf({ type: 'img', text: '图3.20 剔除黑名单、异常值后动量变量数据覆盖度' }, 'figure', '3.20')).toBe(true);
    expect(isCaptionOf({ type: 'img', text: 'Panel B: 动量多空组合\n图3.21 双重排序构建的动量因子累计收益率' }, 'figure', '3.21')).toBe(true);
    expect(isCaptionOf({ type: 'p', text: '如图3.20所示，覆盖度在 2010 年后提高。' }, 'figure', '3.20')).toBe(false);
    expect(isCaptionOf({ type: 'img', text: '图3.201 别的图' }, 'figure', '3.20')).toBe(false);
    expect(isEquationOf({ type: 'eq', text: 'R_i = \\alpha + \\beta f \\tag{2.3}' }, '2.3')).toBe(true);
    expect(isEquationOf({ type: 'eq', text: 'R_i = a (2.3)' }, '2.3')).toBe(true);
    expect(isEquationOf({ type: 'p', text: '(2.3)' }, '2.3')).toBe(false);
  });

  it('<selected_block>：块号、前后块、点选的一句、本节和别的小节的引用、对照译文', () => {
    const section = sec('3.5.3', '动量因子实证');
    const blocks = [blk('3.5.3', 1, '如图3.20所示，见表3.19和第2.2.4节。', 'p', 168), blk('3.5.3', 2, '图3.20 覆盖度', 'img', 169)];
    const other = blk('3.1.4', 7, '表3.19 动量分组的描述性统计', 'p', 140);
    const table = blk('3.1.4', 8, 'Low | High\n-26% | 92%', 'table', 140);
    const { text, cites } = selectedContext({
      section,
      blocks,
      block: blocks[0],
      sentence: '见表3.19和第2.2.4节。',
      sections: [section, sec('2.2.4', 'Fama-MacBeth回归'), sec('3.1.4', '因子构造流程')],
      resolved: [
        { ref: { kind: 'figure', key: '3.20', said: '图3.20' }, blocks: [blocks[1]] },
        { ref: { kind: 'table', key: '3.19', said: '表3.19' }, blocks: [other, table] },
        { ref: { kind: 'section', key: '2.2.4', said: '第2.2.4节' }, blocks: [], section: sec('2.2.4', 'Fama-MacBeth回归') },
      ],
      translation: '如图 3.20 所示……',
    });
    expect(text).toContain('[3.5.3#1]（p.168）');
    expect(text).toContain('前一块 无，后一块 [3.5.3#2]');
    expect(text).toContain('只讲这一句');
    expect(text).toContain('「图3.20」在本节 [3.5.3#2]');
    expect(text).toContain('[3.1.4#8 p.140] (表) Low | High');
    expect(text).toContain('「第2.2.4节」是 2.2.4 Fama-MacBeth回归');
    expect(text).toContain('译文是：「如图 3.20 所示……」');
    expect(cites).toEqual(['3.1.4#7', '3.1.4#8']);
    // 中文段不附术语行
    expect(text).not.toContain('术语（');
  });

  it('外文段：附上命中的术语，讲解和中文对照用同一张术语表；对照译文里用过的写法优先', () => {
    const section = sec('3.6', 'Meta-Labeling');
    const blocks = [blk('3.6', 1, 'Suppose that you have a model for setting the side of the bet. I call this problem meta-labeling, and the triple-barrier method labels each event.', 'p', 50)];
    const base = { section, blocks, block: blocks[0], sections: [section], resolved: [] };
    expect(selectedContext(base).text).toContain('术语（和中文对照同一张术语表）：meta-labeling = 元标签；triple-barrier = 三重屏障。讲解里第一次提到时写「中文（English）」');
    expect(selectedContext({ ...base, translation: '我把这个问题称为元标注（meta-labeling）……' }).text).toContain('meta-labeling = 元标注');
  });
});

describe('没问成的提问不再发给模型', () => {
  const msg = (id: number, role: StoredMessage['role'], text: string, error?: string): StoredMessage =>
    ({ id, threadId: 1, role, parts: text ? [{ t: 'text', text }] : [], raw: null, ui: error ? { error } : null, compacted: false, createdAt: '' });

  it('去掉后面又问过的失败轮，<action_results> 挪到下一问；最后一问（正在问的）保留', () => {
    const history = [
      msg(1, 'user', '<study_state>a</study_state>'), msg(2, 'assistant', ''), msg(3, 'assistant', 'ok'),
      msg(4, 'user', '<study_state>b</study_state>\n<action_results>\n检查题：答对了\n</action_results>'), msg(5, 'assistant', '', '401'),
      msg(6, 'user', '<study_state>c</study_state>'), msg(7, 'assistant', '', '401'),
      msg(8, 'user', '<study_state>d</study_state>'),
    ];
    const out = withoutFailedTurns(history);
    expect(out.map(m => m.id)).toEqual([1, 2, 3, 8]);
    expect(out[3].parts[0]).toEqual({ t: 'text', text: '<action_results>\n检查题：答对了\n</action_results>' });
    // 停止时收到了一半的文字不算没问成
    expect(withoutFailedTurns([msg(1, 'user', 'q'), msg(2, 'assistant', '半句', '已停止'), msg(3, 'user', 'q2')]).map(m => m.id)).toEqual([1, 2, 3]);
  });
});

describe('「用真实行情举例」按段落内容选工具', () => {
  const steps = [{ index: 0, title: '动量', from: 1, to: 3 }];
  const cross = '无论使用哪个时间周期计算动量都无法出现显著的动量效应，赢家组合跑输了输家组合（t-值为-0.14）。';
  const price = '动量是过去一段时间的累计收益，涨得多的股票动量高。';

  it('横截面结论走 factor_test 并对照书里的数字；价格走势走 plot_chart；块号写进问题', () => {
    expect(empirical(cross)).toBe(true);
    expect(empirical(price)).toBe(false);
    expect(empirical('The statistic shows the price.')).toBe(false);
    const a = quick('realBlock', { steps, step: 0, block: { label: 'p.168', id: '3.5.3#1', text: cross } });
    expect(a.question).toContain('[3.5.3#1]（p.168）');
    expect(a.question).toContain('factor_test');
    expect(a.question).not.toContain('用 plot_chart 画图');
    const b = quick('realBlock', { steps, step: 0, block: { label: '3.1 ¶1', id: '3.1#1', text: price } });
    expect(b.question).toContain('用 plot_chart 画图');
    expect(b.question).toContain('find');
    const r = quick('replicateBlock', { steps, step: 0, block: { label: 'p.168', id: '3.5.3#1', text: cross } });
    expect(r.label).toBe('在 A 股复现 p.168');
    expect(r.question).toContain('等权和市值加权');
    expect(r.question).toContain('t 值');
  });

  it('底栏的「用真实行情举例」按这一步的原文分流，和段落菜单一致；按钮下的小字写明这次会做什么', () => {
    const a = quick('real', { steps, step: 0, stepText: cross });
    expect(a.question).toContain('factor_test');
    expect(a.question).toContain('control');
    expect(a.question).not.toContain('用 plot_chart 画图');
    expect(a.hint).toContain('用因子检验在 A 股跑一次');
    // 动量组合的回撤是多空组合的事：先看横截面，走因子检验（多空净值能看到那次回撤）
    expect(quick('real', { steps, step: 0, stepText: '动量组合在市场急转弯时会出现很深的回撤，比如熊市末期反弹。' }).question).toContain('factor_test');
    const dd = '2015 年股灾时，指数从高点回撤近一半，随后出现剧烈反弹。';
    expect(empirical(dd)).toBe(false);
    const e = quick('real', { steps, step: 0, stepText: dd });
    expect(e.question).toContain('find');
    expect(e.question).toContain('不凭记忆挑月份');
    expect(e.hint).toContain('让工具在真实数据里找出');
    const p = quick('real', { steps, step: 0, stepText: price });
    expect(p.question).toContain('用 plot_chart 画图，讲到哪段行情就用 focus 标出那段');
    expect(p.hint).toContain('画一张真实行情图');
    // 不给这一步的原文时照旧画图
    expect(quick('real', { steps, step: 0 }).question).toContain('用 plot_chart 画图');
    // 「这个因子在 A 股有效吗？」不写死示例池
    const f = quick('factor', { steps, step: 0 });
    expect(f.question).not.toContain('在示例池上检验');
    expect(f.question).toContain('zz1000');
    expect(f.hint).toBeTruthy();
    expect(quick('next', { steps: [...steps, { index: 1, title: '反转', from: 4, to: 5 }], step: 0 }).hint).toBe('接着讲第 2 步「反转」');
  });

  it('只问一句：标签写「解释这一句」，问题带这一句；原文开头在句末截断', () => {
    const q = quick('explainBlock', { steps, step: 0, block: { label: 'p.168', id: '3.5.3#1', text: cross, sentence: '赢家组合跑输了输家组合。' } });
    expect(q.label).toBe('解释这一句 · p.168');
    expect(q.question).toContain('「赢家组合跑输了输家组合。」');
    expect(lead('长'.repeat(200) + '。' + '短'.repeat(300), 300)).toBe('长'.repeat(200) + '。…');
    // 第一句太短时不在那里截，直接截到上限
    expect(lead('第一句话。' + '长'.repeat(400), 300)).toHaveLength(301);
    expect(lead('短', 300)).toBe('短');
  });
});

describe('步骤标题和分组', () => {
  it('脚注跟着前文、表格跟着单独一段的表题；图表那一步用图注、表题作标题', () => {
    const blocks = [
      blk('x', 1, '第一段讲动量的定义，篇幅比较长。'.repeat(8)),
      blk('x', 2, '表3.21 动量和市值独立双重排序'),
      blk('x', 3, 'Low | High\n1 | 2', 'table'),
      blk('x', 4, '图3.22 双重排序构建的动量因子累计收益率', 'img'),
      blk('x', 5, '第二段讲结果，篇幅也比较长。'.repeat(8)),
      blk('x', 6, '[1]尽管Fama在一文中考虑了动量因子。'),
      blk('x', 7, '[2]在原文中作者使用J和K。'),
    ];
    const steps = planSteps(blocks);
    expect(steps.map(s => [s.from, s.to])).toEqual([[1, 1], [2, 3], [4, 4], [5, 7]]);
    expect(steps[1].title).toBe('表 3.21 动量 × 市值双重排序');
    expect(steps[2].title).toBe('图 3.22 动量因子累计收益率');
    expect(planSteps([blk('y', 1, 'Low | High', 'table')])[0].title).toBe('表格');
    expect(planSteps([blk('y', 1, '表3.1 收益率\nLow | High', 'table')])[0].title).toBe('表 3.1 收益率');
  });

  it('步骤名（PM 走查第 3 项）：跳过对读者说的半句和状语从句，取双重排序，合并分图编号，英文不截半个词', () => {
    const one = (text: string, title = '动量因子实证') => planSteps([blk('z', 1, text)], sec('3.5.3', title))[0].title;
    expect(one('熟悉A股市场的读者可能有这样的体会，无论使用哪个时间周期计算动量都无法出现显著的动量效应，而更多时候表现出的是反转效应，即前期涨幅高（低）的股票未来的收益率低（高）。')).toBe('更多时候表现出的是反转效应');
    expect(one('接下来，关注动量和市值进行双重排序的检验结果。无论采用等权重还是市值加权，赢家组的收益率都低于输家组。')).toBe('动量 × 市值双重排序');
    // 括号里的句号还算断句，两句不连成一句
    expect(one('此外，他们指出一些神经元作用于图片的水平方向，而另一些神经元作用于其他方向（两个神经元可能有相同的接受野，但是作用于不同方向。）他们也注意到有些神经元有比较大的接受野。', '视觉皮层的架构')).toBe('另一些神经元作用于其他方向');
    const figure = planSteps([
      blk('f', 1, '', 'img'),
      blk('f', 2, 'Panel B: 动量多空组合（等权重）\n图3.21 双重排序构建的动量因子累计收益率（等权重）', 'img'),
      blk('f', 3, 'Panel A: 动量最强组和动量最弱组（市值加权）', 'img'),
      blk('f', 4, 'Panel B: 动量多空组合（市值加权）\n图3.22 双重排序构建的动量因子累计收益率（市值加权）', 'img'),
    ], sec('3.5.3', '动量因子实证'));
    expect(figure.map(x => x.title)).toEqual(['图 3.21–3.22 累计收益率']);
    expect(one('Suppose that you have a model for setting the side of the bet (long or short). You just need to learn the size of that bet.', 'META-LABELING')).toBe('Suppose that you have a…');
    const code = planSteps([
      blk('c', 1, 'SNIPPET 3.6 EXPANDING getEvents TO INCORPORATE META-LABELING'),
      blk('c', 2, 'def getEvents(close, tEvents, ptSl, trgt, minRet, numThreads, t1=False, side=None):\n    return events', 'code'),
    ], sec('3.6', 'META-LABELING'));
    expect(code.map(x => x.title)).toEqual(['Snippet 3.6 getEvents']);
  });

  it('存下来的步骤名只在路线图切法没变时用', () => {
    const st = planSteps([blk('k', 1, '第一段讲动量的定义，篇幅比较长。'.repeat(8)), blk('k', 2, '第二段讲结果，篇幅也比较长。'.repeat(8))]);
    expect(stepKey(st)).toBe('1-1,2-2');
    expect(applyNames(st, { key: '1-1,2-2', titles: ['动量的定义', '结果'] }).map(x => x.title)).toEqual(['动量的定义', '结果']);
    expect(applyNames(st, { key: '1-2', titles: ['整节'] })).toBe(st);
    expect(applyNames(st, null)).toBe(st);
  });
});

describe('复现结果存进研究手记', () => {
  it('书里的说法当假设，口径当方法，IC 和多空的 t 值当证据，来源写书和小节', () => {
    const d = researchFromFactor({
      chart: {
        kind: 'factor', factor: 'mom12_1', universe: 'sample', dates: ['2024-11-01', '2026-10-30'], groups: [], bench: [], longShort: [],
        stats: { universe: '示例池', hold: 20, groups: 10, weight: 'cap', costBp: 0, periods: 24, icMean: -0.012, icT: -0.4, longShortMean: 0.0035, longShortT: 0.82, longShortAnnual: 0.041 },
      },
      book: { id: 'b1', title: '因子投资：方法与实践' },
      section: sec('3.5.3', '动量因子实证'),
      claim: '[[b:3.5.3#1]] 无论使用哪个时间周期计算动量都无法出现显著的动量效应',
      answer: '**结论**：这次复现说明不了 [[b:3.5.3#6]]',
    });
    expect(d.title).toBe('复现：12-1 月动量 · 3.5.3 动量因子实证');
    expect(d.hypothesis).toBe('书中说（《因子投资：方法与实践》3.5.3 动量因子实证）：无论使用哪个时间周期计算动量都无法出现显著的动量效应');
    expect(d.method).toContain('分 10 组按市值加权');
    expect(d.method).toContain('24 期');
    expect(d.evidence).toBe('Rank IC 均值 -0.012（t -0.40，|t| < 2，不显著）；多空每期平均 +0.35%（t 0.82，|t| < 2，不显著），年化 +4.1%');
    expect(d.conclusion).toBe('AI 讲解要点（改成你自己的判断）：结论：这次复现说明不了');
    expect(d.source).toEqual({ bookId: 'b1', sectionId: '3.5.3', bookTitle: '因子投资：方法与实践', sectionTitle: '3.5.3 动量因子实证' });
    expect(d.checks.universe).toContain('幸存者偏差');
  });
});
