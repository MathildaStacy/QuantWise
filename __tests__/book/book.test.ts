/**
 * 书的核心（QUANTWISE_DESIGN.md §5、§6）：示例教材切章节、Markdown 解析、标题编号、路线图、标记、行内公式、复习。
 */
import { assemble, cnNumber, parseHeading } from '../../src/book/assemble';
import { citeLabel, nextLeaf, sampleBook, secLabel } from '../../src/book/book';
import { ankiCsv, notesMarkdown } from '../../src/book/export';
import { parseMarkdownBook } from '../../src/book/markdown';
import {
  citationsOf,
  htmlTableToMarkdown,
  inlineParts,
  parseStudyText,
  plainStudyText,
  stepNamesIn,
  type CiteCheck,
} from '../../src/book/markup';
import { addDays, dueToday, rateCard } from '../../src/book/review';
import { planSteps, stepOfBlock } from '../../src/book/steps';
import { texToText } from '../../src/book/tex';
import type { RawDoc } from '../../src/book/types';

describe('示例教材', () => {
  const bk = sampleBook();
  const blocksOf = (id: string) => bk.blocks.filter(b => b.sectionId === id);

  it('切出 24 个标题、19 个能学的小节，和原型一致', () => {
    expect(bk.title).toBe('因子投资入门');
    expect(bk.author).toBe('QuantWise 示例教材');
    expect(bk.sections).toHaveLength(24);
    expect(bk.sections.filter(s => s.leaf)).toHaveLength(19);
    expect(bk.sections.map(s => s.id).slice(0, 8)).toEqual([
      'c1', '1', '1.1', '1.2', '1.3', '1.4', '2', '2.1',
    ]);
    const s31 = bk.sections.find(s => s.id === '3.1')!;
    expect(s31).toMatchObject({ parentId: '3', level: 2, no: '3.1', title: '动量因子', leaf: true });
    expect(bk.sections.find(s => s.id === '3')).toMatchObject({ no: '第 3 章', title: '动量与反转', leaf: false });
  });

  it('块的节内序号和类型对得上原文', () => {
    const b = blocksOf('3.1');
    expect(b.map(x => x.type)).toEqual(['p', 'eq', 'p', 'p', 'p']);
    expect(b.map(x => x.no)).toEqual([1, 2, 3, 4, 5]);
    expect(b[1].text).toBe('MOM_{i,t}(n) = \\frac{P_{i,t}}{P_{i,t-n}} - 1');
    expect(blocksOf('2.3').filter(x => x.type === 'li')).toHaveLength(3);
    expect(blocksOf('4.1').filter(x => x.type === 'li').map(x => x.mark)).toEqual(['1.', '2.', '3.']);
    expect(bk.blocks.every((x, i) => x.seq === i)).toBe(true);
  });

  it('3.1 的路线图：4 步，公式跟着它前面的说明', () => {
    const st = planSteps(blocksOf('3.1'));
    expect(st.map(s => [s.from, s.to])).toEqual([[1, 2], [3, 3], [4, 4], [5, 5]]);
    expect(st[0].title).toBe('动量是过去一段时间的累计收益');
    expect(st[1].title).toBe('学术上最常见的是「12-1 月动量」');
    expect(stepOfBlock(st, 2)).toBe(0);
    expect(stepOfBlock(st, 4)).toBe(2);
  });

  it('列表跟着以冒号结尾的引导段，字数太少的一步讲完', () => {
    const st = planSteps(blocksOf('2.3'));
    expect(st[0]).toMatchObject({ from: 1, to: 4 });
    expect(planSteps(blocksOf('c1'))).toHaveLength(1);
  });

  it('引用标签、小节名、下一节', () => {
    const s = bk.sections.find(x => x.id === '3.1')!;
    expect(citeLabel(s, { no: 2, page: null })).toBe('3.1 ¶2');
    expect(citeLabel(s, { no: 2, page: 86 })).toBe('p.86');
    expect(secLabel(s)).toBe('3.1 动量因子');
    expect(nextLeaf(bk.sections, '2.3')?.id).toBe('3.1');
    expect(nextLeaf(bk.sections, '5.2')).toBeNull();
  });
});

describe('Markdown 和标题', () => {
  it('front matter、表格、代码、图片、多行公式、引用块', () => {
    const doc = parseMarkdownBook(
      [
        '---', 'title: "测试书"', 'author: 某人', '---', '',
        '# Chapter 2: Risk', '', 'Line one', 'continues here.', '',
        '| a | b |', '|---|---|', '| 1 | 2 |', '',
        '```', 'x = 1', '```', '',
        '![图 1](img/a.png)', '', '$$', 'a = b', '+ c', '$$', '', '> 引用一句',
      ].join('\n'),
    );
    expect(doc.title).toBe('测试书');
    expect(doc.items.map(i => (i.kind === 'heading' ? 'h' : i.type))).toEqual(['h', 'p', 'table', 'code', 'img', 'eq', 'p']);
    expect(doc.items[1]).toMatchObject({ text: 'Line one continues here.' });
    expect(doc.items[4]).toMatchObject({ image: 'img/a.png', text: '图 1' });
    expect(doc.items[5]).toMatchObject({ text: 'a = b + c' });
  });

  it('认章节号：中文数字、Chapter、3.1.2、年份不算章', () => {
    expect(cnNumber('十二')).toBe(12);
    expect(cnNumber('二十三')).toBe(23);
    expect(parseHeading({ kind: 'heading', text: '第三章　动量', level: 2 })).toMatchObject({ num: '3', no: '第 3 章', title: '动量', level: 1 });
    expect(parseHeading({ kind: 'heading', text: 'Chapter 2: Risk', level: 1 })).toMatchObject({ num: '2', title: 'Risk' });
    expect(parseHeading({ kind: 'heading', text: '3.1.2 细节', level: 1 })).toMatchObject({ num: '3.1.2', level: 3 });
    expect(parseHeading({ kind: 'heading', text: '2023 年回顾', level: 1 }).num).toBeNull();
    expect(parseHeading({ kind: 'heading', text: '3 动量', level: 2 }).num).toBeNull();
  });

  it('章里没编号的大标题挂到章下面，附录除外；重复编号加后缀；标题前的正文成 c0', () => {
    const doc: RawDoc = {
      title: 'T', author: '', warnings: [],
      items: [
        { kind: 'block', type: 'p', text: '引言' },
        { kind: 'heading', text: '第 1 章 甲', level: 1 },
        { kind: 'heading', text: '1.1 乙', level: 2 },
        { kind: 'block', type: 'p', text: '正文', page: 12 },
        { kind: 'heading', text: '本章小结', level: 1 },
        { kind: 'block', type: 'p', text: '小结' },
        { kind: 'heading', text: '1.1 乙', level: 2 },
        { kind: 'block', type: 'p', text: '重复' },
        { kind: 'heading', text: '附录 A', level: 1 },
        { kind: 'block', type: 'p', text: '附录' },
      ],
    };
    const bk = assemble(doc);
    expect(bk.sections.map(s => [s.id, s.level, s.parentId])).toEqual([
      ['c0', 1, null], ['1', 1, null], ['1.1', 2, '1'], ['c1', 2, '1'], ['1.1-2', 2, '1'], ['c2', 1, null],
    ]);
    expect(bk.sections[2]).toMatchObject({ pageFrom: 12, pageTo: 12, chars: 2 });
  });
});

describe('AI 标记', () => {
  const read = new Set(['3.1']);
  const check: CiteCheck = (sec, no) => (read.has(sec) && no <= 5 ? sec + ' ¶' + no : null);

  it('引用：读过的变按钮，没读过或块不存在的变「未核实」', () => {
    const segs = parseStudyText('动量 [[b:3.1#2]]，反转 [[b:3.2#1]]，越界 [[b:3.1#9]]。', check);
    expect(segs).toEqual([{ t: 'md', text: '动量 [3.1 ¶2](cite:3.1#2)，反转 [未核实](unv:)，越界 [未核实](unv:)。' }]);
    expect(citationsOf('a [[b:3.1#2]] b [[b:3.1#2]] [[b:1.1#7]]')).toEqual([
      { sectionId: '3.1', no: 2 }, { sectionId: '1.1', no: 7 },
    ]);
  });

  it('来源标记、独立公式、行内公式', () => {
    const segs = parseStudyText(
      '先说 $r_t$。\n\n$$\\sigma = \\sqrt{252}$$\n\n[[derive]]推导 $\\frac{a}{b}$[[/derive]]尾巴',
      check,
    );
    expect(segs).toEqual([
      { t: 'md', text: '先说 rₜ。' },
      { t: 'eq', tex: '\\sigma = \\sqrt{252}' },
      { t: 'callout', kind: 'derive', segs: [{ t: 'md', text: '推导 a/b' }] },
      { t: 'md', text: '尾巴' },
    ]);
    expect(parseStudyText('花了 $5 和 $10 元', check)).toEqual([{ t: 'md', text: '花了 $5 和 $10 元' }]);
  });

  it('流式：半截引用先藏起来，没收尾的公式和来源块照常显示', () => {
    expect(parseStudyText('动量 [[b:3.', check, true)).toEqual([{ t: 'md', text: '动量' }]);
    expect(parseStudyText('如下 $$a = ', check, true)).toEqual([
      { t: 'md', text: '如下' }, { t: 'eq', tex: 'a =', open: true },
    ]);
    expect(parseStudyText('[[example]]比如', check, true)).toEqual([
      { t: 'callout', kind: 'example', segs: [{ t: 'md', text: '比如' }] },
    ]);
    expect(plainStudyText('a [[b:3.1#2]] [[real]]b[[/real]]')).toBe('a  b');
  });

  it('步骤名块：不显示，流式时没收尾也藏起来；个数、长度、中文不对就不用', () => {
    expect(parseStudyText('讲完了。\n\n[[steps]]已有方向|标签变成 0 和 1[[/steps]]', check)).toEqual([{ t: 'md', text: '讲完了。' }]);
    expect(parseStudyText('讲完了。\n[[steps]]已有方', check, true)).toEqual([{ t: 'md', text: '讲完了。' }]);
    expect(parseStudyText('讲完了。\n[[steps]]已有方向|标签[[/st', check, true)).toEqual([{ t: 'md', text: '讲完了。' }]);
    expect(plainStudyText('讲完了。[[steps]]a|b[[/steps]]')).toBe('讲完了。');
    expect(stepNamesIn('……\n[[steps]]1. 已有方向，只学下多大|Snippet 3.6 扩展 getEvents[[/steps]]', 2)).toEqual(['已有方向，只学下多大', 'Snippet 3.6 扩展 getEvents']);
    expect(stepNamesIn('[[steps]]3.6 节的标签|标签[[/steps]]', 2)).toEqual(['3.6 节的标签', '标签']);
    expect(stepNamesIn('[[steps]]已有方向|标签[[/steps]]', 3)).toBeNull();
    expect(stepNamesIn('[[steps]]Meta labeling|标签[[/steps]]', 2)).toBeNull();
    expect(stepNamesIn('[[steps]]已有方向|标签', 2)).toBeNull();
  });
});

describe('行内公式和复习', () => {
  it('简单 TeX 转成 Unicode，转不了返回 null', () => {
    expect(texToText('\\sigma_{year} = \\sigma_{day} \\times \\sqrt{252}')).toBe('σ_(year) = σ_(day) × √252');
    expect(texToText('P_{t-1}')).toBe('Pₜ₋₁');
    expect(texToText('\\frac{P_t}{P_{t-1}} - 1')).toBe('Pₜ/Pₜ₋₁ − 1');
    expect(texToText('\\frac{1}{n-1}')).toBe('1/(n−1)');
    expect(texToText('R^2')).toBe('R²');
    // MinerU 在每个记号之间加空格；TeX 不管这些空格
    expect(texToText('0 . 8 \\times 1 2 = 9 . 6')).toBe('0.8 × 12 = 9.6');
    expect(texToText('9 . 6 \\times 0 . 1 5 \\% \\approx 1 . 4 \\%')).toBe('9.6 × 0.15% ≈ 1.4%');
    expect(texToText('I R \\approx I C \\times \\sqrt { B R }')).toBe('IR ≈ IC × √BR');
    expect(texToText('\\sqrt { 1 2 }')).toBe('√12');
    expect(texToText('V O L _ {i, t} = - \\sigma (r _ {i, t - n + 1}, \\dots , r _ {i, t})')).toBe('VOLᵢ,ₜ = −σ(rᵢ,ₜ₋ₙ₊₁, …, rᵢ,ₜ)');
    expect(texToText('I C _ {t} = \\operatorname{corr} (f _ {i, t}, r _ {i, t + 1})')).toBe('ICₜ = corr(fᵢ,ₜ, rᵢ,ₜ₊₁)');
    expect(texToText('\\ln P_t - \\ln P_{t-1}')).toBe('ln Pₜ − ln Pₜ₋₁');
    expect(texToText('r = -0.05')).toBe('r = −0.05');
    expect(texToText('a+b')).toBe('a + b');
    expect(texToText('\\frac{a+b}{2}')).toBe('(a+b)/2');
    expect(texToText('x \\text{ if } y')).toBe('x if y');
    expect(texToText('\\begin{matrix} a \\end{matrix}')).toBeNull();
    expect(texToText('\\frac{a}')).toBeNull();
    expect(texToText('\\Lambda^{1/2}')).toBe('Λ^(1/2)');
    expect(texToText('\\notin')).toBeNull();
    expect(texToText('\\unknown{x}')).toBeNull();
  });

  it('Leitner：升盒、留盒、回盒 1；到期排序和上限', () => {
    expect(rateCard(2, 'good', '2026-11-01')).toEqual({ box: 3, due: '2026-11-08' });
    expect(rateCard(2, 'hard', '2026-11-01')).toEqual({ box: 2, due: '2026-11-04' });
    expect(rateCard(5, 'good', '2026-11-01')).toEqual({ box: 5, due: '2026-12-01' });
    expect(rateCard(4, 'again', '2026-12-31')).toEqual({ box: 1, due: '2027-01-01' });
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    const cards = [
      { id: 1, due: '2026-11-01', box: 3 }, { id: 2, due: '2026-10-30', box: 2 },
      { id: 3, due: '2026-11-01', box: 1 }, { id: 4, due: '2026-11-02', box: 1 },
    ];
    expect(dueToday(cards, '2026-11-01').map(c => c.id)).toEqual([2, 3, 1]);
    expect(dueToday(cards, '2026-11-01', 2)).toHaveLength(2);
  });
});

describe('原书正文', () => {
  it('MinerU 的脚注 HTML 不泄漏到正文，保留脚注号和上下标', () => {
    expect(inlineParts('正文<sup>[1]</sup>，x<sup>2</sup> 和 r<sub>t</sub>。')).toEqual([
      { t: 'text', v: '正文[1]，x² 和 rₜ。' },
    ]);
  });
  it('行内：加粗、公式转文字、转不了的保留原文', () => {
    expect(inlineParts('**动量**是 $P_t$，矩阵 $\\begin{matrix}a\\end{matrix}$。')).toEqual([
      { t: 'bold', v: '动量' }, { t: 'text', v: '是 ' }, { t: 'text', v: 'Pₜ' }, { t: 'text', v: '，矩阵 ' },
      { t: 'math', v: '\\begin{matrix}a\\end{matrix}' }, { t: 'text', v: '。' },
    ]);
  });

  it('HTML 表格转 Markdown 表格', () => {
    expect(htmlTableToMarkdown('<table><tr><th>因子</th><th>IC</th></tr><tr><td>动量 &amp; 反转</td><td>0.03<br/>（月）</td></tr><tr><td>x</td></tr></table>')).toBe(
      '| 因子 | IC |\n| --- | --- |\n| 动量 & 反转 | 0.03 （月） |\n| x |  |',
    );
    expect(htmlTableToMarkdown('<p>没有表</p>')).toBeNull();
  });
});

describe('笔记导出', () => {
  it('Markdown 按章节，跳过空小节，长引用只留第一句；Anki CSV 转义', () => {
    const bk = sampleBook();
    const md = notesMarkdown({
      title: bk.title,
      author: bk.author,
      sections: bk.sections,
      notes: [{ sectionId: '3.1', summary: '动量 = 累计收益', qa: [{ q: 'IC 是什么', a: '相关系数', from: '3.1' }] }],
      stuck: [{ sectionId: '2.2', text: '1.4826', resolved: true }],
      highlights: [{ sectionId: '3.1', label: '3.1 ¶3', text: '第一句。第二句。第三句。' }],
    });
    expect(md).toBe(
      '# 因子投资入门\n\nQuantWise 示例教材\n\n### 2.2 因子暴露与标准化\n\n- 卡点：1.4826（已解决）\n\n### 3.1 动量因子\n\n动量 = 累计收益\n\n**问：IC 是什么**（从 3.1 问的）\n\n相关系数\n\n> 第一句。……（3.1 ¶3）\n',
    );
    expect(ankiCsv([{ front: 'a, "b"', back: 'c\nd', sectionId: '3.1' }], '因子 投资')).toBe('"a, ""b""","c\nd",因子_投资::3_1\n');
  });
});
