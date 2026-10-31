/**
 * 本节路线图（QUANTWISE_DESIGN.md §6.1）：在本机把一个小节切成 1–5 步，不调用模型。
 * 先把块分组（公式、列表项、以冒号结尾的引导段不拆开），组数 ≤ 5 时一组一步，否则按字数合并。
 */
import type { BookBlock } from './types';

export interface LessonStep {
  /** 从 0 开始。 */
  index: number;
  title: string;
  /** 这一步的块（节内序号 no，从 1 开始，连续）。 */
  from: number;
  to: number;
}

const MAX_STEPS = 5;
/** 字数太少的小节一步讲完。 */
const ONE_STEP_CHARS = 200;

function groups(blocks: BookBlock[]): BookBlock[][] {
  const out: BookBlock[][] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    const attach =
      prev &&
      (b.type === 'eq' ||
        (b.type === 'li' && (prev.type === 'li' || /[：:]$/.test(prev.text))));
    if (attach) {
      last.push(b);
    } else {
      out.push([b]);
    }
  }
  return out;
}

const plain = (s: string) =>
  s
    .replace(/\$\$?[^$]*\$\$?/g, '')
    .replace(/\*\*|`/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .trim();

/** 步骤标题：这一步第一段的第一个短句，最多 18 个字。 */
export function stepTitle(b: BookBlock, index: number): string {
  if (b.type === 'eq') {
    return '公式';
  }
  if (b.type === 'img') {
    return plain(b.text).slice(0, 18) || '图';
  }
  if (b.type === 'table') {
    return '表格';
  }
  const first = plain(b.text).split(/[。！？；:：]/)[0].trim();
  if (!first) {
    return '第 ' + (index + 1) + ' 步';
  }
  if (first.length <= 18) {
    return first;
  }
  // 太长时先试着截到第一个逗号，截出来太短（「在美股」）就直接截断
  const clause = first.split(/[，,]/)[0];
  return clause.length >= 4 && clause.length <= 18
    ? clause
    : first.slice(0, 17) + '…';
}

const size = (g: BookBlock[]) => g.reduce((n, b) => n + b.text.length, 0);

export function planSteps(blocks: BookBlock[]): LessonStep[] {
  if (!blocks.length) {
    return [];
  }
  let gs = groups(blocks);
  const total = size(blocks);
  if (total < ONE_STEP_CHARS) {
    gs = [blocks];
  } else if (gs.length > MAX_STEPS) {
    // 按字数贪心合并：每步接近 total / 5，最后剩下的都归最后一步
    const target = total / MAX_STEPS;
    const merged: BookBlock[][] = [];
    let acc: BookBlock[] = [];
    for (const g of gs) {
      if (
        acc.length &&
        size(acc) + size(g) / 2 > target &&
        merged.length < MAX_STEPS - 1
      ) {
        merged.push(acc);
        acc = [];
      }
      acc = acc.concat(g);
    }
    merged.push(acc);
    gs = merged;
  }
  return gs.map((g, i) => ({
    index: i,
    title: stepTitle(g[0], i),
    from: g[0].no,
    to: g[g.length - 1].no,
  }));
}

/** 某个块（节内序号）落在哪一步；找不到时返回第 0 步。 */
export function stepOfBlock(steps: LessonStep[], no: number): number {
  return Math.max(
    0,
    steps.findIndex(s => s.from <= no && no <= s.to),
  );
}
