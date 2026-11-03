import { readerAnchorAt, readerAnchorY, type ReaderBlockLayout } from '../../src/study/readerPosition';

const boxes = new Map([[7, { y: 100, height: 650 }]]);
const paragraph: ReaderBlockLayout = { top: 2, parts: [
  { lane: 'source', start: 0, end: 1000, y: 0, height: 300 },
  { lane: 'translation', start: 0, end: 1000, y: 310, height: 250 },
] };
const sentence: ReaderBlockLayout = { top: 2, parts: [
  { lane: 'source', start: 0, end: 400, y: 0, height: 120 },
  { lane: 'translation', start: 0, end: 400, y: 130, height: 100 },
  { lane: 'source', start: 400, end: 1000, y: 250, height: 180 },
  { lane: 'translation', start: 400, end: 1000, y: 440, height: 150 },
] };

test('原文切到对照仍停在原文；逐句模式映射到同一句，不落入译文', () => {
  const original: ReaderBlockLayout = { top: 2, parts: [{ lane: 'source', start: 0, end: 1000, y: 0, height: 300 }] };
  const anchor = readerAnchorAt(boxes, new Map([[7, original]]), 297)!;
  expect(anchor.text?.offset).toBeCloseTo(650);
  expect(readerAnchorY(anchor, boxes.get(7)!, paragraph)).toBeCloseTo(297);
  expect(readerAnchorY(anchor, boxes.get(7)!, sentence)).toBeCloseTo(427);
});

test('译文位置跨分组与字号保留；回到原文时定位到对应内容', () => {
  const anchor = readerAnchorAt(boxes, new Map([[7, paragraph]]), 537)!;
  expect(anchor.text).toEqual({ lane: 'translation', offset: 500 });
  expect(readerAnchorY(anchor, boxes.get(7)!, sentence)).toBe(567);
  const large = { ...paragraph, parts: paragraph.parts.map(p => ({ ...p, y: p.y * 2, height: p.height * 2 })) };
  expect(readerAnchorY(anchor, boxes.get(7)!, large)).toBe(972);
  expect(readerAnchorY(anchor, boxes.get(7)!, { top: 2, parts: [paragraph.parts[0]] })).toBe(252);
});

test('句界归入下一句；旧存档、图表与尚未测量的内容继续使用块锚点', () => {
  const anchor = { id: 7, offset: 0.5, text: { lane: 'source' as const, offset: 400 } };
  expect(readerAnchorY(anchor, boxes.get(7)!, sentence)).toBe(352);
  expect(readerAnchorY({ id: 7, offset: 0.5 }, boxes.get(7)!, sentence)).toBe(425);
  expect(readerAnchorY(anchor, boxes.get(7)!)).toBe(425);
  expect(readerAnchorAt(boxes, new Map(), 425)).toEqual({ id: 7, offset: 0.5 });
});
