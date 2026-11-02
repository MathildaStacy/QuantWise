import { assemble, cnNumber, parseHeading } from '../../src/book/assemble';
import { adaptContentList } from '../../src/study/import/mineruAdapter';
import { preparePdfItems } from '../../src/study/import/pdfStructure';

const h = (text: string, page_idx: number, text_level = 1) => ({
  type: 'text',
  text,
  page_idx,
  text_level,
});
const p = (text: string, page_idx: number) => ({
  type: 'text',
  text,
  page_idx,
});
const book = (rows: unknown[], pageFrom = 1, pageTo = 200) => {
  const adapted = adaptContentList(rows, {
    pageFrom,
    pageTo,
    imagePrefix: 'part1/',
  });
  return assemble({
    title: 'Test',
    author: '',
    warnings: adapted.warnings,
    items: preparePdfItems(adapted.items, adapted.headers),
  });
};

test('nested text, notes and bibliography retain original text while recurring page furniture is removed', () => {
  const a = book([
    h('Chapter 1 Foundations', 0),
    {
      type: 'text',
      lines: [{ spans: [{ content: 'A ' }, { text: '$x$' }] }],
      page_idx: 0,
    },
    {
      type: 'page_footnote',
      content: 'A necessary qualification.',
      page_idx: 0,
    },
    {
      type: 'aside_text',
      lines: [{ spans: [{ content: 'Independent variable' }] }],
      page_idx: 0,
    },
    { type: 'ref_text', text: '[1] A reference.', page_idx: 0 },
    { type: 'header', text: 'Running title', page_idx: 0 },
    { type: 'page_number', text: '1', page_idx: 0 },
  ]);
  expect(a.blocks.map(b => b.text)).toEqual([
    'A $x$',
    'A necessary qualification.',
    'Independent variable',
    '[1] A reference.',
  ]);
});

test.each([false, true])(
  'OCR gaps keep source pages, exclude blank sentinels and preserve %s absolute numbering',
  absolute => {
    const idx = (n: number) => n + (absolute ? 200 : 0);
    const a = adaptContentList(
      [
        { type: 'text', text: '', bbox: [100, 75, 800, 300], page_idx: idx(0) },
        { type: 'text', text: '', bbox: [0, 0, 1000, 1000], page_idx: idx(1) },
        { type: 'text', text: '', bbox: [0, 0, 1, 1], page_idx: idx(2) },
        {
          type: 'header',
          text: 'Possibly misclassified content',
          page_idx: idx(3),
        },
        { type: 'page_number', text: '5', page_idx: idx(4) },
        { type: 'text', text: 'Readable', page_idx: idx(5) },
        {
          type: 'table',
          table_body: '',
          bbox: [100, 80, 900, 900],
          page_idx: idx(5),
        },
      ],
      { pageFrom: 201, pageTo: 400, imagePrefix: '' },
    );
    expect(
      a.items.filter(b => b.kind === 'block' && b.sourcePage).map(b => b.page),
    ).toEqual([201, 204]);
    expect(a.items.map(b => b.page)).toEqual([201, 204, 206]);
    expect(a.warnings).toEqual(['第 201、204 页没有独立的可读内容，请核对原页（可能存在跨页合并）。']);
  },
);

test('contents, snippet captions, numbered prose and adjacent exercise headings do not distort the chapter map', () => {
  const a = book([
    h('Contents', 0),
    p('1 Foundations 3\n1.1 Basics 4\n1.2 More 5\n2 Tools 7\n2.1 Methods 8', 0),
    h('Chapter 1', 2),
    h('Foundations', 2),
    p('Intro', 2),
    h('1.1 Basics', 3),
    p('Body', 3),
    h('SNIPPET 1.1 THE EXAMPLE', 3),
    p('print(x)', 3),
    h('1. Is there a relationship?', 3, 2),
    p('Answer', 3),
    h('1.2 Exercises', 4),
    h('Conceptual', 4),
    p('1.1 This is a question.', 4),
    h('Chapter 2 Tools', 6),
    p('More', 6),
  ]);
  expect(
    a.sections.filter(s => /^第 \d+ 章$/.test(s.no)).map(s => s.id),
  ).toEqual(['1', '2']);
  expect(a.sections.some(s => /SNIPPET|relationship/.test(s.title))).toBe(
    false,
  );
  expect(a.blocks.some(b => b.text === 'SNIPPET 1.1 THE EXAMPLE')).toBe(true);
  expect(a.sections.find(s => s.title === 'Conceptual')?.parentId).toBe('1.2');
  expect(a.blocks.some(b => b.text === '1.1 This is a question.')).toBe(true);
});

test('parts, chapter bibliography and appendix answers stay in their own hierarchy', () => {
  const a = book([
    p('P A R T 1', 0),
    h('Models', 0),
    h('Chapter 1 Basics', 1),
    p('Opening', 1),
    h('1.1 Models', 1),
    p('Body', 1),
    h('1.1.1 Details', 1),
    p('Detail', 1),
    h('Bibliography', 2),
    p('Reference one', 2),
    h('Chapter 2 Risk', 3),
    p('Body two', 3),
    h('Appendix A Answers', 4),
    h('Chapter 1 Basics', 4),
    p('Solution one', 4),
    h('A.1 Additional details', 5),
    p('Appendix details', 5),
    h('References', 6),
    p('Book references', 6),
  ]);
  const part = a.sections.find(s => s.title === 'Part 1 Models')!;
  expect(a.sections.find(s => s.id === '1')?.parentId).toBe(part.id);
  expect(a.sections.find(s => s.id === '2')?.parentId).toBe(part.id);
  expect(a.sections.find(s => s.title === 'Bibliography')?.parentId).toBe('1');
  expect(a.blocks.some(b => b.text === '**1.1.1 Details**')).toBe(true);
  const appendix = a.sections.find(s => s.title === 'Appendix A Answers')!;
  expect(a.sections.find(s => s.id === '1-2')?.parentId).toBe(appendix.id);
  expect(a.sections.find(s => s.id === 'A.1')?.parentId).toBe(appendix.id);
  expect(a.sections.find(s => s.title === 'References')?.parentId).toBeNull();
});

test('a chapter misclassified as a header is recovered only with chapter evidence, never repeated', () => {
  const a = book([
    h('2.1 An Overview of Classification', 20, 2),
    p('Body', 20),
    { type: 'header', text: '2', page_idx: 20 },
    { type: 'header', text: 'Classification', page_idx: 20 },
    h('2.2 Other methods', 21, 2),
    p('Continued', 21),
    { type: 'header', text: '2', page_idx: 21 },
    { type: 'header', text: 'Classification', page_idx: 21 },
  ]);
  expect(a.sections.map(s => s.id)).toEqual(['2', '2.1', '2.2']);
  expect(a.sections[0].title).toBe('Classification');
  expect(a.blocks.map(b => b.text)).toEqual(['Body', 'Continued']);
});

test('a missing image-only chapter uses a consistent printed-page offset, inconsistent offsets are not guessed', () => {
  const rows = [
    h('Contents', 0),
    p(
      'Chapter 1 Start /1\nChapter 2 Next /11\nChapter 3 Third /21\nChapter 4 Last /31\n4.1 End /32',
      0,
    ),
    h('Start', 5),
    p('A', 5),
    h('Next', 15),
    p('B', 15),
    h('Third', 25),
    p('C', 25),
    { type: 'image', img_path: 'chapter4.png', page_idx: 35 },
    p('D', 35),
  ];
  expect(
    book(rows)
      .sections.filter(s => /^第 \d+ 章$/.test(s.no))
      .map(s => [s.id, s.pageFrom]),
  ).toEqual([
    ['1', 6],
    ['2', 16],
    ['3', 26],
    ['4', 36],
  ]);
  expect(
    book(
      rows.map(r => (r.page_idx === 25 ? { ...r, page_idx: 26 } : r)),
    ).sections.some(s => s.id === '4'),
  ).toBe(false);
});

test('appendix subsection numbers and Chinese zero survive heading parsing', () => {
  expect(
    parseHeading({ kind: 'heading', text: 'A.1.2Details', level: 1 }),
  ).toMatchObject({ num: 'A.1.2', level: 3, title: 'Details' });
  expect(cnNumber('一百〇二')).toBe(102);
});

test('gap insertion keeps items without page_idx next to their preceding page', () => {
  const r = adaptContentList([
    p('First', 0),
    { type: 'text', text: '', bbox: [100, 100, 900, 900], page_idx: 1 },
    p('Third', 2),
    { type: 'text', text: 'Continuation without page index' },
  ], { pageFrom: 1, pageTo: 3, imagePrefix: '' });
  expect(r.items.map(b => b.text)).toEqual(['First', '此页未生成独立的可读内容。', 'Third', 'Continuation without page index']);
});
