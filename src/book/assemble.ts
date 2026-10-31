/**
 * RawDoc → 章节和内容块（QUANTWISE_DESIGN.md §5）：三种解析器共用一套切法，和原型 ui-book.js 一致。
 * 章节号从标题文字里认：「第 3 章」「Chapter 3」→ 章；「3.1」「3.1.2」→ 节 / 小节；没编号的按解析器给的层级挂。
 */
import type {
  AssembledBook,
  BookBlock,
  BookSection,
  RawDoc,
  RawHeading,
} from './types';

const CN = '零一二三四五六七八九';

/** 「十二」「二十三」「九十九」→ 数字；认不出返回 null。 */
export function cnNumber(s: string): number | null {
  if (/^\d+$/.test(s)) {
    return Number(s);
  }
  if (!/^[零一二三四五六七八九十百]+$/.test(s)) {
    return null;
  }
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch === '百') {
      total += (cur || 1) * 100;
      cur = 0;
    } else if (ch === '十') {
      total += (cur || 1) * 10;
      cur = 0;
    } else {
      cur = CN.indexOf(ch);
    }
  }
  return total + cur;
}

/** 书尾这些标题即使没编号也是独立的一章，不挂到最后一章下面。 */
const BACK_MATTER =
  /^(附录|参考文献|索引|后记|致谢|术语表|appendix|references|bibliography|index|glossary)/i;

interface Parsed {
  /** 有编号时的章节号；没有时 null。 */
  num: string | null;
  no: string;
  title: string;
  level: 1 | 2 | 3;
}

const clampLevel = (n: number): 1 | 2 | 3 => (n <= 1 ? 1 : n >= 3 ? 3 : 2);

export function parseHeading(h: RawHeading): Parsed {
  const text = h.text.replace(/\s+/g, ' ').trim();
  let m = /^第\s*([0-9零一二三四五六七八九十百]+)\s*[章篇部]\s*[:：.、]?\s*(.*)$/.exec(
    text,
  );
  const chapter = (n: number | null, rest: string): Parsed | null =>
    n == null
      ? null
      : { num: String(n), no: '第 ' + n + ' 章', title: rest || text, level: 1 };
  if (m) {
    const c = chapter(cnNumber(m[1]), m[2]);
    if (c) {
      return c;
    }
  }
  m = /^chapter\s+(\d+)\s*[:：.、-]?\s*(.*)$/i.exec(text);
  if (m) {
    return chapter(Number(m[1]), m[2])!;
  }
  m = /^(\d{1,2}(?:\.\d{1,3}){1,2})\.?\s+(.+)$/.exec(text);
  if (m) {
    return {
      num: m[1],
      no: m[1],
      title: m[2],
      level: clampLevel(m[1].split('.').length),
    };
  }
  // 「3 动量与反转」只有在解析器也认为是最高一级时才算章，免得把以数字开头的普通标题当成章
  m = /^(\d{1,2})[.、\s]\s*(\D.*)$/.exec(text);
  if (m && h.level <= 1) {
    return chapter(Number(m[1]), m[2])!;
  }
  return { num: null, no: '', title: text, level: clampLevel(h.level) };
}

export function assemble(doc: RawDoc): AssembledBook {
  const sections: (BookSection & { blocks: BookBlock[] })[] = [];
  const blocks: BookBlock[] = [];
  const used = new Set<string>();
  let unnumbered = 0;
  let sawChapter = false;
  let cur: (typeof sections)[number] | null = null;
  const uniq = (id: string) => {
    let out = id;
    for (let k = 2; used.has(out); k++) {
      out = id + '-' + k;
    }
    used.add(out);
    return out;
  };
  const open = (p: Parsed, page: number | null, id?: string) => {
    const parent =
      p.level === 1
        ? null
        : [...sections].reverse().find(s => s.level < p.level) ?? null;
    const sec = {
      id: id ?? uniq(p.num ?? 'c' + ++unnumbered),
      parentId: parent?.id ?? null,
      ord: sections.length,
      level: p.level,
      no: p.no,
      title: p.title,
      leaf: false,
      blockFrom: null,
      blockTo: null,
      pageFrom: page,
      pageTo: page,
      chars: 0,
      blocks: [],
    };
    sections.push(sec);
    return sec;
  };
  for (const it of doc.items) {
    if (it.kind === 'heading') {
      let p = parseHeading(it);
      if (p.num && p.level === 1) {
        sawChapter = true;
      } else if (
        !p.num &&
        p.level === 1 &&
        sawChapter &&
        !BACK_MATTER.test(p.title)
      ) {
        // 书已经按「第 n 章」编号了：章里没编号的大标题（本章小结、习题）挂到这一章下面
        p = { ...p, level: 2 };
      }
      cur = open(p, it.page ?? null);
      continue;
    }
    // 第一个标题之前的正文（前言、版权页之后的引言）单独成一节 c0
    cur ??= open(
      { num: null, no: '', title: doc.title || '正文', level: 1 },
      null,
      uniq('c0'),
    );
    const b: BookBlock = {
      seq: blocks.length,
      sectionId: cur.id,
      no: cur.blocks.length + 1,
      type: it.type,
      text: it.text,
      page: it.page ?? null,
      mark: it.mark ?? null,
      image: it.image ?? null,
      html: it.html ?? null,
    };
    blocks.push(b);
    cur.blocks.push(b);
  }
  for (const s of sections) {
    if (s.blocks.length) {
      s.leaf = true;
      s.blockFrom = s.blocks[0].seq;
      s.blockTo = s.blocks[s.blocks.length - 1].seq;
      s.chars = s.blocks.reduce((n, b) => n + b.text.length, 0);
      const pages = s.blocks.map(b => b.page).filter((p): p is number => p != null);
      if (pages.length) {
        s.pageFrom = Math.min(s.pageFrom ?? Infinity, ...pages);
        s.pageTo = Math.max(...pages);
      }
    }
  }
  return {
    title: doc.title || sections[0]?.title || '未命名',
    author: doc.author,
    sections: sections.map(({ blocks: _b, ...s }) => s),
    blocks,
    warnings: doc.warnings,
  };
}
