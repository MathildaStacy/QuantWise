/**
 * Pagewise v0.0.15 的 PDF 结构规则在 QuantWise 的三层目录上的适配。
 * 保留所有原文；目录行、图注和过深的标题回到正文。仅作用于新 PDF 导入。
 */
import { parseHeading } from '../../book/assemble';
import type { RawHeading, RawItem } from '../../book/types';
import type { PageHeader } from './mineruAdapter';

const PART =
  /^(?:Part\s+[\dIVXLC]+\b|第\s*[0-9零〇一二三四五六七八九十百]+\s*部(?:分)?)/i;
const LABEL =
  /^(?:(?:chapter|part|appendix)\s+(?:\d+|[IVXLC]+|[A-Z])|第\s*[0-9零〇一二三四五六七八九十百]+\s*(?:章|部分?|篇))$/i;
const APPENDIX = /^(?:附录|appendix)\b|^附录/i;
const END =
  /^(?:bibliography|references|index|glossary|afterword|epilogue|参考文献|参考书目|索引|术语表|后记|注释)$/i;
const CHAPTER_END =
  /^(?:summary|exercises|problems|questions|notes|further reading|references|bibliography|本章小结|小结|习题|思考题|练习|参考文献|延伸阅读)$/i;
const EXERCISES = /^(?:exercises|problems|questions|习题|练习|思考题)$/i;
const CONTENTS = /^(?:(?:table of )?contents|目\s*录)$/i;
const FIGURE =
  /^(?:(?:figure|fig\.|table|algorithm|listing|exhibit|snippet)\s+(?:[A-Z][.-])?\d+(?:[.-]\d+)*\b|[图表]\s*\d+(?:[.-]\d+)*|(?:function|procedure)\s+[A-Z][\w?-]*\s*\()/i;
const clean = (s: string) =>
  s
    .replace(/^P\s+A\s+R\s+T\s+/i, 'Part ')
    .replace(/[\p{Cc}\ue000-\uf8ff]/gu, c =>
      ['\n', '\r', '\t'].includes(c) ? c : '',
    )
    .trim();
const key = (s: string) => clean(s).replace(/\s+/g, '').toLowerCase();
const prose = (item: RawItem): RawItem =>
  item.kind === 'heading'
    ? { kind: 'block', type: 'p', text: item.text, page: item.page }
    : item;
const heading = (text: string, page: number | undefined): RawHeading => ({
  kind: 'heading',
  text,
  page,
  level: 1,
});

/** 多条短行以页码结束才认为是目录；单条带数字的标题不能据此删除。 */
export function pdfTocPages(items: readonly RawItem[]): Set<number> {
  const pages = new Map<
    number,
    { all: number; toc: number; chapters: number }
  >();
  for (const item of items) {
    if (item.page == null || (item.kind === 'block' && item.type !== 'p'))
      continue;
    const n = pages.get(item.page) ?? { all: 0, toc: 0, chapters: 0 };
    for (const text of item.text.split('\n').map(clean)) {
      if (!text || text.length > 120) continue;
      n.all++;
      if (/\p{L}.*(?:\s|[/／])(?:\d{1,4}|[ivxlc]{1,6})\s*$/iu.test(text))
        n.toc++;
      if (/^Chapter\s+\d+\s*:\s*.+,\s*\d+$/i.test(text)) n.chapters++;
    }
    pages.set(item.page, n);
  }
  return new Set(
    [...pages]
      .filter(
        ([, n]) => (n.toc >= 5 || n.chapters >= 3) && n.toc >= n.all * 0.6,
      )
      .map(([p]) => p),
  );
}

/** 用明确的章标和目录标题恢复被 OCR 当成页眉的章首，不把普通运行页眉放进正文。 */
function restoreChapters(
  items: RawItem[],
  headers: readonly PageHeader[],
  toc: Set<number>,
): RawItem[] {
  const titles = new Map<string, string>();
  const printed = new Map<string, number>();
  const partTitles = new Map<string, string>();
  const restoredParts = new Set<string>();
  const anchors: { no: string; page: number }[] = [];
  for (const item of items) {
    if (!toc.has(item.page ?? -1)) continue;
    for (const line of item.text.split('\n')) {
      const text = clean(line)
        .replace(/(?:\s*[/／,，]|\s+(?:\.\s*)*)\s*\d+\s*$/, '')
        .trim();
      if (PART.test(text)) {
        const title = text.replace(
          /^(?:Part\s+[\dIVXLC]+|第\s*[0-9零〇一二三四五六七八九十百]+\s*部(?:分)?)\s*[:：]?\s*/i,
          '',
        );
        if (title) partTitles.set(key(title), text);
      }
      const p = parseHeading(heading(text, item.page));
      if (p.num && p.level === 1 && !titles.has(p.num)) {
        titles.set(p.num, p.title);
        const pageLabel = /[\s/／,，](\d+)\s*$/.exec(line);
        if (pageLabel) printed.set(p.num, Number(pageLabel[1]));
      }
    }
  }
  const byPage = new Map<number, PageHeader[]>();
  for (const h of headers)
    byPage.set(h.page, [...(byPage.get(h.page) ?? []), h]);
  const restored = new Set<string>();
  const result: RawItem[] = [];
  let page: number | undefined;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.page !== page && item.page != null) {
      page = item.page;
      const pageHeaders = byPage.get(page) ?? [];
      const atPage: RawItem[] = [];
      for (let j = i; j < items.length && items[j].page === page; j++)
        atPage.push(items[j]);
      const first = atPage.find(b => b.kind === 'heading');
      // 部分书的 Part 只在章首页眉出现，正文首行只有分部名称。
      const part = pageHeaders
        .map(h => clean(h.text).replace(/^P\s*A\s*R\s*T\s+/i, 'Part '))
        .find(t => PART.test(t));
      if (part && first && LABEL.test(part)) {
        result.push(heading(part + ' ' + first.text, page));
        const index = items.indexOf(first, i);
        items[index] = prose(first);
      }
      if (!toc.has(page)) {
        // 完整章号优先；纯数字页眉必须同时有目录中同章的标题。
        const label = pageHeaders
          .map(h =>
            /(?:Chapter\s+(\d+)\b|第\s*([0-9零〇一二三四五六七八九十百]+)\s*章)/i.exec(
              h.text,
            ),
          )
          .find(Boolean);
        const numericHeader = pageHeaders
          .find(
            h =>
              /^\d+$/.test(h.text.trim()) &&
              ((titles.has(h.text.trim()) &&
                pageHeaders.some(
                  t => key(t.text) === key(titles.get(h.text.trim())!),
                )) ||
                atPage.some(
                  b =>
                    b.kind === 'heading' &&
                    b.text.startsWith(h.text.trim() + '.1 '),
                )),
          )
          ?.text.trim();
        const numbered = label
          ? parseHeading(heading(label[0], page)).num
          : numericHeader;
        const title = numbered ? titles.get(numbered) : undefined;
        const candidate = atPage.find(
          b =>
            b.kind === 'heading' &&
            (title
              ? key(b.text) === key(title)
              : b === first && !parseHeading(b).num),
        );
        const headerTitle =
          title && pageHeaders.some(h => key(h.text) === key(title))
            ? title
            : numericHeader
            ? pageHeaders
                .find(
                  h =>
                    !/^\d+$/.test(h.text.trim()) &&
                    !/check for updates|contents/i.test(h.text),
                )
                ?.text.trim()
            : undefined;
        if (numbered && !restored.has(numbered) && (candidate || headerTitle)) {
          const full = heading(
            'Chapter ' + numbered + ' ' + (candidate?.text ?? headerTitle),
            page,
          );
          if (candidate) items[items.indexOf(candidate, i)] = full;
          else result.push(full);
          restored.add(numbered);
          anchors.push({ no: numbered, page });
        } else if (first && !toc.has(page)) {
          const entry = [...titles].find(
            ([no, titleText]) =>
              !restored.has(no) && key(titleText) === key(first.text),
          );
          if (entry) {
            items[items.indexOf(first, i)] = heading(
              'Chapter ' + entry[0] + ' ' + first.text,
              page,
            );
            restored.add(entry[0]);
            anchors.push({ no: entry[0], page });
          }
        }
      }
    }
    const partTitle = !toc.has(items[i].page ?? -1)
      ? partTitles.get(key(items[i].text))
      : undefined;
    if (partTitle && !restoredParts.has(partTitle)) {
      items[i] = heading(partTitle, items[i].page);
      restoredParts.add(partTitle);
    }
    result.push(items[i]);
  }
  // 扫描书偶有整张图片章首，无法匹配文字。至少三个已匹配章首证明稳定页差后，
  // 才用目录页码补一个标题；正文仍为原图，不凭目录捏造正文内容。
  const offsets = new Map<number, number>();
  for (const anchor of anchors) {
    const label = printed.get(anchor.no);
    if (label != null)
      offsets.set(
        anchor.page - label,
        (offsets.get(anchor.page - label) ?? 0) + 1,
      );
  }
  const best = [...offsets].sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] >= 3 && best[1] >= anchors.length * 0.7) {
    for (const [no, label] of printed) {
      if (restored.has(no)) continue;
      const at = result.findIndex(b => b.page === label + best[0]);
      if (at >= 0 && !toc.has(label + best[0]))
        result.splice(
          at,
          0,
          heading('Chapter ' + no + ' ' + titles.get(no), label + best[0]),
        );
    }
  }
  return result;
}

export function preparePdfItems(
  raw: readonly RawItem[],
  headers: readonly PageHeader[] = [],
): RawItem[] {
  const toc = pdfTocPages(raw);
  const items = restoreChapters(
    raw.map(item => ({ ...item })),
    headers,
    toc,
  );
  const childNumbers = new Set(
    items
      .filter(b => !toc.has(b.page ?? -1))
      .flatMap(b => /^(\d+)\.1(?:\s|\.)/.exec(b.text.trim())?.[1] ?? []),
  );
  const out: RawItem[] = [];
  const seenChapters = new Set<string>();
  let part = false,
    appendix = false,
    end = false,
    chapter = 0,
    context = 0,
    exercises = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (
      item.kind === 'block' &&
      (item.type !== 'p' || !item.headingCandidate)
    ) {
      out.push(item);
      continue;
    }
    let text = clean(item.text);
    const next = items[i + 1];
    const joined =
      LABEL.test(text) &&
      next &&
      next.page === item.page &&
      (next.kind === 'heading' ||
        (next.type === 'p' && next.headingCandidate)) &&
      next.text.trim().length <= 100 &&
      !!next.text.trim() &&
      !LABEL.test(next.text) &&
      !/[.:;。：；]\s*$/.test(next.text);
    const partPage =
      PART.test(text) &&
      (joined ||
        headers.some(h => h.page === item.page && PART.test(clean(h.text))));
    if (toc.has(item.page ?? -1) && !partPage && !CONTENTS.test(text)) {
      out.push(prose(item));
      continue;
    }
    if (/^\d+[.)、]\s+/.test(text)) {
      out.push(prose(item));
      continue;
    }
    if (FIGURE.test(text)) {
      out.push(prose(item));
      continue;
    }
    if (joined) {
      text += ' ' + clean(next.text);
      i++;
    }
    const parsed = parseHeading({
      ...heading(text, item.page),
      level: item.kind === 'heading' ? item.level : 1,
    });
    // MinerU 可能把所有章首都标成二级；后续有 n.1 才将裸数字恢复成章。
    const bare = /^(\d+)\s+\S/.exec(text);
    const p =
      bare && childNumbers.has(bare[1])
        ? parseHeading(heading(text, item.page))
        : parsed;
    const explicit =
      /^(?:chapter\s+\d+\b|第\s*[0-9零〇一二三四五六七八九十百]+\s*章)/i.test(
        text,
      );
    const isPart = PART.test(text),
      isAppendix = APPENDIX.test(text);
    const bodyHeading =
      item.kind === 'block' &&
      (joined ||
        (p.num &&
          (p.level > 1 || explicit) &&
          !exercises &&
          text.length <= (p.level > 1 ? 100 : 40) &&
          !/[.:;。：；]\s*$/.test(text) &&
          !text.includes('\n')));
    if (
      (item.kind !== 'heading' && !bodyHeading) ||
      /[:;：；]\s*$/.test(text) ||
      (/[.。]\s*$/.test(text) && text.length > 50)
    ) {
      out.push(prose(item));
      if (joined) out.push(prose(next));
      continue;
    }
    // 习题中的 1. / 2. 或数字开头问题不新开章；明确的 Chapter 标记仍可离开习题。
    if (
      p.num &&
      p.level === 1 &&
      !explicit &&
      (/^\d+[.、]/.test(text) || (exercises && !childNumbers.has(p.num)))
    ) {
      out.push(prose(item));
      continue;
    }
    if (
      p.num &&
      p.level === 1 &&
      seenChapters.has(p.num) &&
      !appendix &&
      !end
    ) {
      out.push(prose(item));
      continue;
    }
    let level: number;
    if (isPart) {
      part = true;
      appendix = false;
      end = false;
      chapter = 0;
      context = 0;
      level = 1;
    } else if (isAppendix) {
      part = false;
      appendix = true;
      end = false;
      chapter = 0;
      context = 1;
      level = 1;
    } else if (
      END.test(text) &&
      (text === '注释' ||
        !items
          .slice(i + 1)
          .some(b => /^(?:Chapter\s+\d+|第\s*\S+\s*章)/i.test(b.text)))
    ) {
      part = false;
      appendix = false;
      end = true;
      chapter = 0;
      context = 0;
      level = 1;
    } else if (p.num && p.level === 1) {
      level = appendix || end || part ? 2 : 1;
      chapter = level;
      context = level;
      if (!appendix && !end) seenChapters.add(p.num);
    } else if (p.num) {
      level =
        p.level +
        (appendix && /^[A-Z]\./.test(p.num) ? 0 : chapter ? chapter - 1 : 0);
      context = level;
    } else if (CHAPTER_END.test(text) && chapter) {
      level = chapter + 1;
      context = level;
    } else if (chapter) {
      level = Math.max(chapter + 1, context + 1);
    } else {
      level = appendix ? Math.max(2, p.level) : p.level;
    }
    exercises =
      EXERCISES.test(p.title) ||
      (exercises && !p.num && !isPart && !isAppendix);
    if (level > 3) {
      out.push({
        kind: 'block',
        type: 'p',
        text: '**' + text + '**',
        page: item.page,
      });
      continue;
    }
    out.push({
      ...heading(text, item.page),
      level: p.num ? 1 : item.kind === 'heading' ? item.level : 1,
      sectionLevel: level as 1 | 2 | 3,
    });
  }
  return out;
}
