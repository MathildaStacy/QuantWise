import { anchorAt, anchorY, type ReadingAnchor } from './readingState';

export interface ReaderTextPart {
  start: number;
  end: number;
  lane: 'source' | 'translation';
  y: number;
  height: number;
}

export interface ReaderBlockLayout {
  top: number;
  parts: ReaderTextPart[];
}

type Boxes = Map<number, { y: number; height: number }>;
type TextLayouts = Map<number, ReaderBlockLayout>;

/** Store the source-text position even when the viewport is inside its translation. */
export function readerAnchorAt(boxes: Boxes, texts: TextLayouts, y: number): ReadingAnchor | undefined {
  const anchor = anchorAt(boxes, y);
  if (!anchor) return;
  const block = texts.get(anchor.id);
  const relative = y - boxes.get(anchor.id)!.y - (block?.top ?? 0);
  const part = block?.parts.filter(p => p.y <= relative + 1).sort((a, b) => b.y - a.y)[0];
  if (!part || part.end <= part.start) return anchor;
  const fraction = Math.max(0, Math.min(1, (relative - part.y) / Math.max(1, part.height)));
  return { ...anchor, text: { lane: part.lane, offset: part.start + (part.end - part.start) * fraction } };
}

export function readerAnchorY(anchor: ReadingAnchor, box: { y: number; height: number }, block?: ReaderBlockLayout): number {
  if (!anchor.text || !block?.parts.length) return anchorY(anchor, box);
  const { offset, lane } = anchor.text;
  const containing = block.parts.filter(p => p.start <= offset && (p.end > offset || p.end === offset && p.end === Math.max(...block.parts.map(x => x.end))));
  const part = containing.find(p => p.lane === lane) ?? containing.find(p => p.lane === 'source');
  if (!part) return anchorY(anchor, box);
  const fraction = Math.max(0, Math.min(1, (offset - part.start) / Math.max(1, part.end - part.start)));
  return Math.max(0, box.y + block.top + part.y + part.height * fraction);
}
