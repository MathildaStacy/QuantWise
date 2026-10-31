/**
 * MinerU 结果包 → RawItem（QUANTWISE_DESIGN.md §5）。MinerU 的输出格式还在变，格式差异只在这里处理，
 * 之后切章节、编号都交给 book/assemble.ts。只读 content_list（扁平数组，每项有 type 和 page_idx）。
 */
import type { BlockType, RawBlock, RawItem } from '../../book/types';
import { MineruError } from './mineru';

/**
 * 在解压出来的文件里找 content_list。真实结果包里同时有 `<id>_content_list.json`（扁平数组）
 * 和 `<id>_content_list_v2.json`（按页分组的数组的数组，字段也不同），只认前者。
 * 有多个时取目录最浅、路径最短的那个，结果稳定。
 */
export function findContentList(paths: string[]): string | null {
  const hits = paths.filter(p =>
    /(?:^|_)content_list\.json$/.test(p.split(/[\\/]/).pop() ?? ''),
  );
  const depth = (p: string) => p.split(/[\\/]/).length;
  hits.sort(
    (a, b) => depth(a) - depth(b) || a.length - b.length || (a < b ? -1 : 1),
  );
  return hits[0] ?? null;
}

type Row = Record<string, unknown>;
const object = (v: unknown): Row | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 页面杂项：页眉、页脚、页码、边注、页脚注、注音，MinerU 自己生成 Markdown 时也丢掉。 */
const DROPPED = new Set([
  'header',
  'footer',
  'page_number',
  'page_header',
  'page_footer',
  'page_footnote',
  'aside',
  'aside_text',
  'phonetic',
  'discarded',
]);
/** 单独出现的图注 / 表注 / 参考文献 / 目录行，当普通段落。 */
const AS_PARAGRAPH = new Set([
  'ref_text',
  'index',
  'caption',
  'image_caption',
  'table_caption',
  'footnote',
  'image_footnote',
  'table_footnote',
]);

/** image_caption / table_footnote 这类字段：字符串或字符串数组，拼成多行。 */
function lines(...values: unknown[]): string {
  return values
    .flatMap(v => (Array.isArray(v) ? v : [v]))
    .map(v => str(v).trim())
    .filter(Boolean)
    .join('\n');
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
    if (name[0] === '#') {
      const n =
        name[1] === 'x' || name[1] === 'X'
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[name.toLowerCase()] ?? all;
  });
}

/** 表格 HTML → 纯文字：一行一行，格子之间用「 | 」隔开（搜索和讲解上下文用）。 */
export function tableText(html: string): string {
  return html
    .split(/<\/tr\s*>/i)
    .map(row =>
      row
        .split(/<\/t[dh]\s*>/i)
        .map(cell =>
          decode(cell.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''))
            .replace(/\s+/g, ' ')
            .trim(),
        )
        .filter(Boolean)
        .join(' | '),
    )
    .filter(Boolean)
    .join('\n');
}

/** 去掉公式两边的 $$（MinerU 的 equation.text 是「$$\n…\n$$」）。 */
const stripDisplayMath = (s: string) =>
  s
    .trim()
    .replace(/^\$\$\s*/, '')
    .replace(/\s*\$\$$/, '')
    .trim();

/** code_body 偶尔带 Markdown 围栏，去掉；缩进保留。 */
const stripFence = (s: string) =>
  s
    .replace(/^\s*```[^\n]*\n/, '')
    .replace(/\n```\s*$/, '')
    .replace(/\s+$/, '');

/**
 * 列表项开头的符号：「•」「- 」「1. 」「a) 」「(1)」「1、」。拉丁编号和 - * 后面要有空格，
 * 免得把「1.5 倍」「-5%」的开头当成符号。
 */
const LIST_MARK =
  /^(?:[•·●○▪■◆◦‣∙]\s*|[*-]\s+|(\(\d{1,3}\)|（\d{1,3}）|\d{1,3}、)\s*|(\d{1,3}[.)]|[a-zA-Z][.)])\s+)(?=\S)/;
function listItem(text: string): { mark: string; text: string } {
  const m = LIST_MARK.exec(text);
  if (!m) {
    return { mark: '•', text };
  }
  const mark = m[1] ?? (m[2] ? m[2].replace(/\)$/, '.') : '•');
  return { mark, text: text.slice(m[0].length) };
}

/** img_path 应该是结果包里的相对路径；绝对路径、带「..」或「:」的不收，防止指到书目录外面。 */
function imagePath(value: unknown): string | null | undefined {
  const p = str(value).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p) {
    return undefined;
  }
  if (p.startsWith('/') || p.includes(':') || p.split('/').includes('..')) {
    return null;
  }
  return p;
}

interface Counts {
  noImage: number;
  unsafeImage: number;
  unknown: Set<string>;
}

/** 一行 content_list → 0 到多个 RawItem。 */
function convert(
  row: Row,
  page: number | undefined,
  prefix: string,
  n: Counts,
): RawItem[] {
  const type = str(row.type).toLowerCase();
  const at = page === undefined ? {} : { page };
  const block = (
    t: BlockType,
    text: string,
    extra: Partial<RawBlock> = {},
  ): RawBlock => ({ kind: 'block', type: t, text, ...at, ...extra });
  const para = (text: string) => (text ? [block('p', text)] : []);
  const image = (value: unknown, caption: string): RawItem[] => {
    const p = imagePath(value);
    if (p === null) {
      n.unsafeImage++;
    } else if (p === undefined) {
      n.noImage++;
    }
    return p ? [block('img', caption, { image: prefix + p })] : para(caption);
  };

  if (DROPPED.has(type)) {
    return [];
  }
  // 合成样本里有 type: text + text_format: latex 的公式，一并认
  if (
    type === 'equation' ||
    type === 'interline_equation' ||
    row.text_format === 'latex'
  ) {
    const tex = stripDisplayMath(str(row.latex) || str(row.text));
    return tex ? [block('eq', tex)] : [];
  }
  if (type === 'text' || type === 'title') {
    const text = str(row.text).trim();
    const level =
      typeof row.text_level === 'number'
        ? row.text_level
        : typeof row.level === 'number'
        ? row.level
        : type === 'title'
        ? 1
        : 0;
    if (text && level >= 1) {
      return [{ kind: 'heading', text, level: Math.floor(level), ...at }];
    }
    // 行内公式 MinerU 已经写成 $…$，原样保留
    return para(text);
  }
  if (type === 'image' || type === 'chart') {
    // content 是 VLM 生成的图片描述 / 图表数据，不是原书文字，不收
    const caption =
      type === 'chart'
        ? lines(row.chart_caption, row.chart_footnote)
        : lines(row.image_caption, row.image_footnote);
    return image(row.img_path, caption);
  }
  if (type === 'table') {
    const html = str(row.table_body).trim();
    const caption = lines(row.table_caption);
    const foot = lines(row.table_footnote);
    if (html) {
      return [block('table', lines(caption, tableText(html), foot), { html })];
    }
    // 没认出表格结构时只有截图，当图片；连截图都没有就只留表注（不算缺图）
    return str(row.img_path).trim()
      ? image(row.img_path, lines(caption, foot))
      : para(lines(caption, foot));
  }
  if (type === 'code' || type === 'algorithm') {
    const code = stripFence(str(row.code_body) || str(row.text));
    return [
      ...para(lines(row.code_caption)),
      ...(code.trim() ? [block('code', code)] : []),
      ...para(lines(row.code_footnote)),
    ];
  }
  if (type === 'list' || type === 'list_item') {
    const values = Array.isArray(row.list_items) ? row.list_items : [row.text];
    return values
      .map(v => (str(v) || str(object(v)?.text)).trim())
      .filter(Boolean)
      .map(t => {
        const li = listItem(t);
        return block('li', li.text, { mark: li.mark });
      });
  }
  if (AS_PARAGRAPH.has(type)) {
    return para(str(row.text).trim());
  }
  n.unknown.add(type || '无类型');
  return [];
}

/**
 * MinerU content_list → RawItem。pageFrom / pageTo 是这一片在原书 PDF 里的页码范围（含两端），
 * imagePrefix 原样拼在 img_path 前面（要带结尾的「/」）。
 *
 * 页码：page_idx 从 0 开始，但官方没说清用 page_ranges 提交时它从原书第 1 页数还是从片的第 1 页数。
 * 判断方法：pageFrom > 1 且所有 page_idx 都小于片的页数（pageTo - pageFrom + 1）→ 按片内页码算
 * （page = pageFrom + page_idx）；否则按原书页码算（page = page_idx + 1）。planParts 按 200 页切，
 * 第 2 片起原书页码至少是 200，片内页码最多 199，两种情况不会混。算出来落在片外的页另外给警告。
 */
export function adaptContentList(
  json: unknown,
  o: { pageFrom: number; pageTo: number; imagePrefix: string },
): { items: RawItem[]; warnings: string[] } {
  if (
    !Number.isSafeInteger(o.pageFrom) ||
    !Number.isSafeInteger(o.pageTo) ||
    o.pageFrom < 1 ||
    o.pageTo < o.pageFrom
  ) {
    throw new RangeError('页码范围不对：' + o.pageFrom + '–' + o.pageTo);
  }
  if (!Array.isArray(json)) {
    throw new MineruError('protocol');
  }
  const idxOf = (row: Row | null) =>
    row && Number.isSafeInteger(row.page_idx) && (row.page_idx as number) >= 0
      ? (row.page_idx as number)
      : undefined;
  // 没有 page_idx 的行跟着前一行排；按页排序，同页保持原顺序
  let key = 0;
  const rows = json
    .map((value, order) => {
      const row = object(value);
      const idx = idxOf(row);
      key = idx ?? key;
      return { row, idx, key, order };
    })
    .sort((a, b) => a.key - b.key || a.order - b.order);

  const span = o.pageTo - o.pageFrom + 1;
  const known = rows.filter(r => r.idx !== undefined).map(r => r.idx!);
  const relative = o.pageFrom > 1 && known.every(i => i < span);
  const pageOf = (idx: number) => (relative ? o.pageFrom + idx : idx + 1);

  const n: Counts = { noImage: 0, unsafeImage: 0, unknown: new Set() };
  let noPage = 0;
  let outside = 0;
  const items: RawItem[] = [];
  for (const { row, idx } of rows) {
    if (!row) {
      n.unknown.add('非对象');
      continue;
    }
    const page = idx === undefined ? undefined : pageOf(idx);
    const out = convert(row, page, o.imagePrefix, n);
    if (page === undefined) {
      noPage += out.length;
    } else if (page < o.pageFrom || page > o.pageTo) {
      outside += out.length;
    }
    items.push(...out);
  }

  const at = '第 ' + o.pageFrom + '–' + o.pageTo + ' 页：';
  const warnings: string[] = [];
  if (!items.length) {
    warnings.push(at + '没有解析出内容，扫描版 PDF 可以打开 OCR 重新解析');
  }
  if (outside) {
    warnings.push(at + outside + ' 个内容块的页码落在这一片之外，页码可能不准');
  }
  if (noPage) {
    warnings.push(at + noPage + ' 个内容块没有页码');
  }
  if (n.noImage) {
    warnings.push(at + n.noImage + ' 张图在结果包里没有图片文件，只保留了图注');
  }
  if (n.unsafeImage) {
    warnings.push(at + n.unsafeImage + ' 张图的路径不安全，已跳过图片');
  }
  if (n.unknown.size) {
    warnings.push(at + '跳过了不认识的内容类型：' + [...n.unknown].join('、'));
  }
  return { items, warnings };
}

/** 各片的结果按片号顺序接起来（每片内部已按页排好）。 */
export function mergeParts(parts: RawItem[][]): RawItem[] {
  return ([] as RawItem[]).concat(...parts);
}
