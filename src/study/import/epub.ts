/**
 * EPUB 解析（QUANTWISE_DESIGN.md §5）：已解压的 EPUB 目录 → RawDoc（按原书顺序的标题和正文块）。
 *
 * - container.xml → OPF（元数据、manifest、spine）→ 目录（EPUB3 nav，没有时用 EPUB2 NCX）
 * - 标题以目录为准：目录指到的元素就是标题，层级 = 目录深度（最多 3）。目录没列出的 h1–h4，
 *   比目录更深或带编号（「第 3 章」「3.1」「3.1.2」）时也算标题，免得丢小节
 * - 正文 XHTML 用 HTML 模式解析：书里常见 &nbsp; 这类 XML 不认识的实体，HTML 模式才会解码
 * - 切章节、编号都留给 assemble.ts，这里只保证标题文字干净（没有页码、空白已合并）
 */
import { DomUtils, parseDocument } from 'htmlparser2';
import type { AnyNode, Element } from 'domhandler';
import type {
  BlockType,
  RawBlock,
  RawDoc,
  RawHeading,
  RawItem,
} from '../../book/types';

export interface EpubIo {
  readText(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export type EpubErrorCode =
  | 'invalid_archive'
  | 'invalid_metadata'
  | 'unreadable_spine';

export class EpubError extends Error {
  code: EpubErrorCode;
  constructor(code: EpubErrorCode, message: string) {
    super(message);
    this.name = 'EpubError';
    this.code = code;
  }
}

// ---- DOM 小工具 ----

/** OPF / NCX / container 是纯 XML；正文和 nav 是 XHTML，用 HTML 模式（见文件头）。 */
const parseXml = (text: string) =>
  parseDocument(text, { xmlMode: true, decodeEntities: true });
const parseXhtml = (text: string) =>
  parseDocument(text.replace(/\r\n?/g, '\n'), {
    recognizeSelfClosing: true,
    recognizeCDATA: true,
  });

/** 去掉命名空间前缀的小写标签名（dc:title → title，m:math → math）。 */
const tagOf = (node: AnyNode): string =>
  DomUtils.isTag(node) ? node.name.toLowerCase().replace(/^.*:/, '') : '';
const attr = (node: AnyNode, key: string): string =>
  DomUtils.isTag(node) ? node.attribs[key] ?? '' : '';
const kids = (node: AnyNode): AnyNode[] =>
  DomUtils.hasChildren(node) ? node.children : [];
const isTag = (node: AnyNode, ...names: string[]): node is Element =>
  names.includes(tagOf(node));
/** 子树里（含自己）第一个 / 所有 名为 names 的元素。 */
const first = (root: AnyNode, ...names: string[]) =>
  DomUtils.findOne(el => isTag(el, ...names), [root]);
const every = (root: AnyNode, ...names: string[]) =>
  DomUtils.findAll(el => isTag(el, ...names), [root]);
const allText = (node: AnyNode) => DomUtils.textContent(node);

/** 合并空白（含不换行空格、全角空格），去掉零宽字符。 */
const squash = (text: string) =>
  text
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\s\u00a0\u3000]+/g, ' ')
    .trim();
/** 段落文字：每行合并空白，去掉空行（<br> 换行保留）。 */
const lines = (text: string) =>
  text.split('\n').map(squash).filter(Boolean).join('\n');

// ---- 路径 ----

/** 书内链接：相对 EPUB 根的路径 + 锚点（没有锚点时为空串）。 */
interface Link {
  path: string;
  anchor: string;
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** 把 rel 接到 base 所在目录后面，处理 ./ 和 ../；跑出书根时返回 null（不读书外的文件）。 */
function joinPath(baseFile: string, rel: string): string | null {
  const out = baseFile.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '..') {
      if (!out.length) {
        return null;
      }
      out.pop();
    } else if (seg && seg !== '.') {
      out.push(seg);
    }
  }
  return out.join('/');
}

/** 解析 href（相对 baseFile）：去掉 ?query，%20 之类按段解码；外链和 data: 返回 null。 */
function resolveHref(baseFile: string, href: string): Link | null {
  const raw = href.trim();
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return null;
  }
  const hash = raw.indexOf('#');
  const anchor = hash < 0 ? '' : decode(raw.slice(hash + 1));
  const rel = (hash < 0 ? raw : raw.slice(0, hash)).split('?')[0];
  if (!rel) {
    return { path: baseFile, anchor };
  }
  // 以 / 开头的按书根算（有些制作工具这么写）
  const base = rel.startsWith('/') ? '' : baseFile;
  const path = joinPath(base, rel.split('/').map(decode).join('/'));
  return path ? { path, anchor } : null;
}

const inDir = (dir: string, path: string) =>
  dir ? `${dir.replace(/\/+$/, '')}/${path}` : path;

async function readOptional(io: EpubIo, path: string): Promise<string | null> {
  try {
    return await io.readText(path);
  } catch {
    return null;
  }
}

// ---- OPF ----

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string[];
}

interface Pkg {
  opfPath: string;
  title: string;
  author: string;
  manifest: Map<string, ManifestItem>;
  spine: { idref: string; linear: boolean }[];
  /** EPUB2 spine 的 toc 属性（NCX 的 manifest id）。 */
  tocId: string;
}

async function findOpf(dir: string, io: EpubIo): Promise<string> {
  const text = await readOptional(io, inDir(dir, 'META-INF/container.xml'));
  if (text == null) {
    throw new EpubError('invalid_archive', 'EPUB 缺少 META-INF/container.xml');
  }
  const doc = parseXml(text);
  const roots = every(doc, 'rootfile');
  const root =
    roots.find(
      r => attr(r, 'media-type') === 'application/oebps-package+xml',
    ) ?? roots[0];
  const link = root ? resolveHref('', attr(root, 'full-path')) : null;
  if (!link) {
    throw new EpubError(
      'invalid_archive',
      'container.xml 没有指明内容清单（OPF）',
    );
  }
  return link.path;
}

async function readPackage(dir: string, io: EpubIo): Promise<Pkg> {
  const opfPath = await findOpf(dir, io);
  const text = await readOptional(io, inDir(dir, opfPath));
  if (text == null) {
    throw new EpubError('invalid_archive', `EPUB 缺少内容清单 ${opfPath}`);
  }
  const doc = parseXml(text);
  const pkg = first(doc, 'package');
  const manifestNode = pkg && first(pkg, 'manifest');
  const spineNode = pkg && first(pkg, 'spine');
  if (!pkg || !manifestNode || !spineNode) {
    throw new EpubError(
      'invalid_metadata',
      'EPUB 内容清单缺少 manifest 或 spine',
    );
  }
  const meta = first(pkg, 'metadata') ?? pkg;
  const title =
    every(meta, 'title')
      .map(t => squash(allText(t)))
      .find(Boolean) ?? '';
  const creators = every(meta, 'creator')
    .map(c => squash(allText(c)))
    .filter(Boolean);
  const manifest = new Map<string, ManifestItem>();
  for (const item of every(manifestNode, 'item')) {
    const link = resolveHref(opfPath, attr(item, 'href'));
    if (link && attr(item, 'id')) {
      manifest.set(attr(item, 'id'), {
        id: attr(item, 'id'),
        path: link.path,
        mediaType: attr(item, 'media-type').toLowerCase(),
        properties: attr(item, 'properties').split(/\s+/).filter(Boolean),
      });
    }
  }
  const spine = every(spineNode, 'itemref').map(ref => ({
    idref: attr(ref, 'idref'),
    linear: attr(ref, 'linear').toLowerCase() !== 'no',
  }));
  if (!spine.length) {
    throw new EpubError('invalid_metadata', 'EPUB 没有正文顺序（spine 为空）');
  }
  return {
    opfPath,
    title,
    author: [...new Set(creators)].join('、'),
    manifest,
    spine,
    tocId: attr(spineNode, 'toc'),
  };
}

// ---- 目录 ----

interface TocNode {
  title: string;
  link: Link | null;
  children: TocNode[];
}

/** 目录里的标题去掉点线和页码（「动量因子 ...... 86」「前言 … iv」）。 */
function cleanTitle(text: string): string {
  return squash(
    squash(text).replace(
      /\s*(?:[.·…⋯．。_-]{2,}|…|⋯)\s*(?:\d+|[ivxlcdm]+)$/i,
      '',
    ),
  );
}

/** EPUB3 nav：<nav epub:type="toc"> 里的 ol / li / a（没有链接的 span 也收，如「第一部分」）。 */
function readNav(text: string, navPath: string): TocNode[] {
  const doc = parseXhtml(text);
  const navs = every(doc, 'nav');
  const nav =
    navs.find(
      n =>
        /(^|\s)toc(\s|$)/.test(attr(n, 'epub:type')) ||
        attr(n, 'role') === 'doc-toc',
    ) ?? navs[0];
  const list = nav && first(nav, 'ol', 'ul');
  return list ? navList(list, navPath) : [];
}

function navList(list: Element, navPath: string): TocNode[] {
  return kids(list)
    .filter(li => isTag(li, 'li'))
    .flatMap((li): TocNode[] => {
      const sub: AnyNode[] = kids(li).filter(c => isTag(c, 'ol', 'ul'));
      // 一般是 li 的直接子元素；有的书多包一层 <p> / <div>
      const label =
        kids(li).find(c => isTag(c, 'a', 'span')) ??
        DomUtils.findOne(
          el => isTag(el, 'a'),
          kids(li).filter(c => !sub.includes(c)),
        );
      const children = sub.flatMap(s => navList(s as Element, navPath));
      const title = label ? cleanTitle(allText(label)) : '';
      if (!title) {
        return children;
      }
      const href = label ? attr(label, 'href') : '';
      return [
        { title, link: href ? resolveHref(navPath, href) : null, children },
      ];
    });
}

/** EPUB2 NCX：navMap / navPoint（navLabel/text + content@src）。 */
function readNcx(text: string, ncxPath: string): TocNode[] {
  const map = first(parseXml(text), 'navmap');
  return map ? ncxPoints(map, ncxPath) : [];
}

function ncxPoints(parent: AnyNode, ncxPath: string): TocNode[] {
  return kids(parent)
    .filter(c => isTag(c, 'navpoint'))
    .flatMap((point): TocNode[] => {
      const label = kids(point).find(c => isTag(c, 'navlabel'));
      const content = kids(point).find(c => isTag(c, 'content'));
      const children = ncxPoints(point, ncxPath);
      const title = label ? cleanTitle(allText(label)) : '';
      if (!title) {
        return children;
      }
      const src = content ? attr(content, 'src') : '';
      return [
        { title, link: src ? resolveHref(ncxPath, src) : null, children },
      ];
    });
}

async function readToc(
  dir: string,
  io: EpubIo,
  pkg: Pkg,
  warnings: string[],
): Promise<TocNode[]> {
  const items = [...pkg.manifest.values()];
  const nav = items.find(i => i.properties.includes('nav'));
  if (nav) {
    const text = await readOptional(io, inDir(dir, nav.path));
    const toc = text == null ? [] : readNav(text, nav.path);
    if (text == null) {
      warnings.push(`目录文件读不出来：${nav.path}`);
    }
    if (toc.length) {
      return toc;
    }
  }
  const ncx =
    pkg.manifest.get(pkg.tocId) ??
    items.find(i => i.mediaType === 'application/x-dtbncx+xml');
  if (!ncx) {
    return [];
  }
  const text = await readOptional(io, inDir(dir, ncx.path));
  if (text == null) {
    warnings.push(`目录文件读不出来：${ncx.path}`);
    return [];
  }
  return readNcx(text, ncx.path);
}

/** 目录里的一项，落到正文的某个位置（文件 + 锚点）。 */
interface Target {
  /** 目录顺序，同一位置有多项时按它排。 */
  ord: number;
  title: string;
  /** 目录深度 1..3（更深的算 3）。 */
  level: number;
  /** 这一项子树里最深的层级：正文里没进目录的标题要比它深才算小节。 */
  deep: number;
  path: string;
  anchor: string;
  used: boolean;
}

const keyOf = (path: string, anchor: string) => `${path}#${anchor}`;

/** 没有链接的项（「第一部分」）挂到它第一个有链接的后代的位置。 */
function firstLink(node: TocNode): Link | null {
  if (node.link) {
    return node.link;
  }
  for (const c of node.children) {
    const link = firstLink(c);
    if (link) {
      return link;
    }
  }
  return null;
}

const depthOf = (node: TocNode, level: number): number =>
  Math.max(level, ...node.children.map(c => depthOf(c, level + 1)));

function flattenToc(toc: TocNode[]): Target[] {
  const out: Target[] = [];
  const visit = (node: TocNode, level: number) => {
    const link = firstLink(node);
    if (link) {
      out.push({
        ord: out.length,
        title: node.title,
        level: Math.min(level, 3),
        deep: Math.min(depthOf(node, level), 3),
        path: link.path,
        anchor: link.anchor,
        used: false,
      });
    }
    node.children.forEach(c => visit(c, level + 1));
  };
  toc.forEach(n => visit(n, 1));
  return out;
}

// ---- 标题判断 ----

const CN_NUM = '[0-9０-９一二三四五六七八九十百千零〇两]+';
/** 「第 3 章」「第三篇」「Chapter 3」「Part II」：章一级。 */
const CHAPTER_RE = new RegExp(
  `^(?:第\\s*${CN_NUM}\\s*[章篇部讲卷回]|(?:chapter|part)\\s+(?:\\d+|[ivxlc]+)\\b)`,
  'i',
);
/** 「第 2 节」：节一级。 */
const SECTION_RE = new RegExp(`^第\\s*${CN_NUM}\\s*节`);
/** 「3.1 动量因子」「3.1.2」「3.1. 标题」：几段数字就是几级；后面不能紧跟数字（排除 3.14159）。 */
const DOTTED_RE = /^(\d+(?:\.\d+)+)\.?(?=\s|[^\d.]|$)/;

/** 标题文字自带的编号层级（1 章 / 2 节 / 3 小节）；没有编号返回 null。 */
function numberDepth(text: string): number | null {
  if (CHAPTER_RE.test(text)) {
    return 1;
  }
  if (SECTION_RE.test(text)) {
    return 2;
  }
  const m = DOTTED_RE.exec(text);
  return m ? Math.min(m[1].split('.').length, 3) : null;
}

/** 比较标题用：去掉空白和标点、小写。 */
const keyText = (s: string) =>
  s
    .toLowerCase()
    .replace(
      /[\s.,:;!?'"()[\]{}<>\-–—_·•、，。：；！？“”‘’（）《》【】「」『』…]+/g,
      '',
    );

/** 目录标题和正文标题是不是同一个（一方包含另一方，且长度别差太多）。 */
function sameTitle(a: string, b: string): boolean {
  const x = keyText(a);
  const y = keyText(b);
  if (!x || !y) {
    return false;
  }
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.includes(short) && short.length * 3 >= long.length;
}

/** 正文标题的编号比目录项更深（目录项「第 3 章」，正文「3.1 …」）：说明它是子小节，不是这一项本身。 */
function deeperThan(tocTitle: string, text: string): boolean {
  const own = numberDepth(text);
  return own != null && own > (numberDepth(tocTitle) ?? 1);
}

/** 正文标题比目录写得全（目录「第 3 章」，正文「第 3 章 动量与反转」）时用正文的。 */
function retitle(heading: RawHeading, text: string) {
  const a = keyText(heading.text);
  const b = keyText(text);
  if (b.length > a.length && b.includes(a) && text.length <= 80) {
    heading.text = text;
  }
}

// ---- 行内文字 ----

const words = (s: string) => new Set(s.split(' '));
const SKIP_TAGS = words(
  'head script style nav template noscript video audio iframe canvas button input select textarea rt rp',
);

/** 自己就是一块（或会切开段落）的元素；其余当行内。 */
const BLOCK_TAGS = words(
  'p div section article main aside header footer blockquote figure figcaption ' +
    'h1 h2 h3 h4 h5 h6 hgroup ul ol li dl dt dd pre table img svg hr address center details summary',
);

const typesOf = (el: Element) => `${attr(el, 'epub:type')} ${attr(el, 'role')}`;

/** 不读的元素：head / script / nav 等，分页标记，脚注浮框。 */
function skipped(el: Element): boolean {
  if (SKIP_TAGS.has(tagOf(el)) || 'hidden' in el.attribs) {
    return true;
  }
  const types = typesOf(el);
  return (
    /(^|\s)(doc-)?pagebreak(\s|$)/.test(types) ||
    (isTag(el, 'aside') &&
      /(^|\s)(doc-)?(foot|end|rear)notes?(\s|$)/.test(types))
  );
}

const isDisplayMath = (el: Element) =>
  isTag(el, 'math') &&
  (attr(el, 'display') === 'block' || attr(el, 'mode') === 'display');
const isBlock = (el: Element) => BLOCK_TAGS.has(tagOf(el)) || isDisplayMath(el);
const hasBlock = (el: Element) =>
  DomUtils.existsOne(c => isBlock(c) && !skipped(c), kids(el));

/** 脚注引用（标题里不要）：epub:type="noteref"，或包着链接的 <sup>。 */
const isNoteRef = (el: Element) =>
  /(^|\s)(doc-)?noteref(\s|$)/.test(typesOf(el)) ||
  (isTag(el, 'sup') && !!first(el, 'a'));

/** MathML 的可见文字（不含 annotation 里的源码）。 */
const mathText = (n: AnyNode): string =>
  DomUtils.isText(n)
    ? n.data
    : isTag(n, 'annotation', 'annotation-xml')
    ? ''
    : kids(n).map(mathText).join('');

/** MathML → TeX：优先 application/x-tex 注解（一定是 TeX），再 alttext，都没有用可见文字。 */
function texOf(math: Element): string {
  const note = DomUtils.findOne(
    el => isTag(el, 'annotation') && /tex/i.test(attr(el, 'encoding')),
    [math],
  );
  const tex = squash(
    (note && allText(note)) || attr(math, 'alttext') || mathText(math),
  );
  const m = /^(?:\$\$?|\\\(|\\\[)([\s\S]*?)(?:\$\$?|\\\)|\\\])$/.exec(tex);
  return m ? m[1].trim() : tex;
}

const wrapBold = (s: string) => {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  return m && m[2] ? `${m[1]}**${m[2]}**${m[3]}` : s;
};

/**
 * 行内文字。rich：段落 / 列表项用，<b> → **…**，<br> → 换行，图片另成一块所以不出字；
 * plain：标题、表格单元格、图注用，不加粗、<br> 当空格、图片用 alt、去掉脚注号。
 */
function inline(n: AnyNode, mode: 'rich' | 'plain', inBold = false): string {
  // 源码里的换行只是排版，和空格一样；真正的换行只来自 <br>
  if (DomUtils.isText(n)) {
    return n.data.replace(/\s+/g, ' ');
  }
  if (DomUtils.isCDATA(n)) {
    return allText(n).replace(/\s+/g, ' ');
  }
  if (!DomUtils.isTag(n) || skipped(n)) {
    return '';
  }
  const tag = tagOf(n);
  if (tag === 'br') {
    return mode === 'rich' ? '\n' : ' ';
  }
  if (tag === 'math') {
    const tex = texOf(n);
    return tex ? `$${tex}$` : '';
  }
  if (tag === 'img' || tag === 'svg') {
    return mode === 'plain' && tag === 'img' ? attr(n, 'alt') : '';
  }
  if (mode === 'plain' && isNoteRef(n)) {
    return '';
  }
  const bold = mode === 'rich' && !inBold && (tag === 'b' || tag === 'strong');
  const inner = kids(n)
    .map(c => inline(c, mode, inBold || bold))
    .join('');
  if (bold) {
    return wrapBold(inner);
  }
  // 单元格里的 <p> 之间留个空格，免得字粘在一起
  return BLOCK_TAGS.has(tag) ? ` ${inner} ` : inner;
}

/** <pre> 的文字：保留换行和缩进，<br> 换行。 */
const preText = (n: AnyNode): string =>
  DomUtils.isText(n)
    ? n.data
    : isTag(n, 'br')
    ? '\n'
    : DomUtils.isTag(n) && skipped(n)
    ? ''
    : kids(n).map(preText).join('');

/** 一段只有一个公式（前后最多标点和式号「(3.1)」）时，返回这个公式和式号。 */
function soleMath(run: AnyNode[]): { math: Element; tag: string } | null {
  const maths = run.flatMap(n => every(n, 'math'));
  if (maths.length !== 1) {
    return null;
  }
  const rest = (n: AnyNode): string =>
    n === maths[0]
      ? ''
      : DomUtils.isText(n)
      ? n.data
      : DomUtils.isTag(n) && skipped(n)
      ? ''
      : kids(n).map(rest).join('');
  const m =
    /^[\s,.;:，。；：、]*(?:[(（]\s*(\d+(?:[.-]\d+)*)\s*[)）])?[\s,.;:，。；：、]*$/.exec(
      run.map(rest).join(''),
    );
  return m ? { math: maths[0], tag: m[1] ?? '' } : null;
}

const closestFigure = (n: AnyNode) => {
  let p = n.parent;
  while (p && !isTag(p, 'figure')) {
    p = p.parent;
  }
  return p;
};

// ---- 正文遍历 ----

/** 当前所在的目录项：没进目录的标题按它定层级。 */
interface Scope {
  level: number;
  deep: number;
  title: string;
  /** 这一项在正文里对应 h 几（还没见到时为 null）。 */
  rank: number | null;
}

/** 刚发出、还在等正文里那个标题的目录项（锚点在外层 section 上，或指向文件开头）。 */
interface Pending {
  scope: Scope;
  heading: RawHeading;
}

class Walker {
  readonly items: RawItem[] = [];
  readonly warnings: string[] = [];
  /** 等确认文件存在的图。 */
  readonly images: { block: RawBlock; path: string }[] = [];
  readonly walked = new Set<string>();
  private readonly targets: Target[];
  private readonly byKey = new Map<string, Target[]>();
  private readonly byPath = new Map<string, Target[]>();
  private scope: Scope;
  /** 全书的「h 几 − 目录层级」：目录项自己没对上标题时用它估。 */
  private offset: number | null = null;
  private path = '';
  private ids = new Set<string>();
  private pending: Pending[] = [];
  /** 上一个目录标题之后还没出过正文块。 */
  private fresh = false;
  private run: AnyNode[] = [];
  /** 正在读的 <li> 的符号：它的第一段文字成为 'li'。 */
  private mark: string | null = null;
  private readonly consumed = new Set<AnyNode>();
  private readonly captions = new Map<AnyNode, string>();
  private readonly once = new Set<string>();

  constructor(targets: Target[]) {
    this.targets = targets;
    for (const t of targets) {
      const key = keyOf(t.path, t.anchor);
      this.byKey.set(key, [...(this.byKey.get(key) ?? []), t]);
      this.byPath.set(t.path, [...(this.byPath.get(t.path) ?? []), t]);
    }
    const deep = Math.max(0, ...targets.map(t => t.level));
    this.scope = { level: 0, deep, title: '', rank: null };
  }

  get hasToc() {
    return this.targets.length > 0;
  }

  get matched() {
    return this.targets.some(t => t.used);
  }

  walkFile(path: string, text: string) {
    this.walked.add(path);
    this.path = path;
    this.pending = [];
    this.fresh = false;
    this.run = [];
    this.mark = null;
    this.consumed.clear();
    this.captions.clear();
    const doc = parseXhtml(text);
    const body = first(doc, 'body') ?? doc;
    const own = this.byPath.get(path) ?? [];
    this.ids = new Set(own.map(t => t.anchor).filter(Boolean));
    // 不带锚点的目录项（和指向 <body> 的）在文件开头
    this.emitTargets([
      ...(this.byKey.get(keyOf(path, '')) ?? []),
      ...(DomUtils.isTag(body) ? this.targetsAt(body, 'self') : []),
    ]);
    this.flow(kids(body));
    this.flush();
  }

  /** 目录里没用上的项：锚点在已读的文件里找不到，或指向书里没有的文件。 */
  report(manifestPaths: Set<string>): string[] {
    const lost = this.targets.filter(
      t =>
        !t.used &&
        (this.walked.has(t.path) ? !!t.anchor : !manifestPaths.has(t.path)),
    );
    const shown = lost
      .slice(0, 5)
      .map(t => `「${t.title}」→ ${t.path}${t.anchor ? `#${t.anchor}` : ''}`);
    return lost.length
      ? [
          `目录有 ${lost.length} 项在正文里找不到位置：${shown.join('；')}${
            lost.length > 5 ? ' 等' : ''
          }`,
        ]
      : [];
  }

  /**
   * el 上（deep 时连同行内子孙）被目录指到、还没用过的项。
   * self：容器，子元素会再走一遍；inline：标题、段落这种只含行内的；all：表格、pre 这种不再往下走的。
   */
  private targetsAt(el: Element, deep: 'self' | 'inline' | 'all'): Target[] {
    if (!this.ids.size) {
      return [];
    }
    const out: Target[] = [];
    const visit = (n: Element) => {
      for (const name of ['id', 'xml:id', ...(isTag(n, 'a') ? ['name'] : [])]) {
        const v = attr(n, name);
        if (v && this.ids.has(v)) {
          out.push(
            ...(this.byKey.get(keyOf(this.path, v)) ?? []).filter(t => !t.used),
          );
        }
      }
      if (deep !== 'self') {
        kids(n).forEach(c => {
          if (DomUtils.isTag(c) && (deep === 'all' || !isBlock(c))) {
            visit(c);
          }
        });
      }
    };
    visit(el);
    return out;
  }

  /** 目录项按目录顺序变成标题；最后一项成为当前目录项，等正文里那个标题。 */
  private emitTargets(found: Target[]): boolean {
    const list = [...new Set(found)]
      .filter(t => !t.used)
      .sort((a, b) => a.ord - b.ord);
    if (!list.length) {
      return false;
    }
    this.flush();
    for (const t of list) {
      t.used = true;
      const heading: RawHeading = {
        kind: 'heading',
        text: t.title,
        level: t.level,
      };
      this.items.push(heading);
      this.scope = { level: t.level, deep: t.deep, title: t.title, rank: null };
      this.pending.push({ scope: this.scope, heading });
    }
    this.fresh = true;
    return true;
  }

  /** 目录项对上了正文的 h 几：记下来，没进目录的标题按它定层级。 */
  private learn(scope: Scope, rank: number) {
    scope.rank = rank;
    if (this.offset == null) {
      this.offset = rank - scope.level;
    }
  }

  private heading(el: Element) {
    const rank = Number(tagOf(el).slice(1));
    const text = cleanTitle(inline(el, 'plain'));
    if (this.emitTargets(this.targetsAt(el, 'inline'))) {
      const last = this.pending[this.pending.length - 1];
      this.learn(last.scope, rank);
      if (text) {
        retitle(last.heading, text);
      }
      this.pending = [];
    } else if (text && !this.absorb(text, rank)) {
      const level = this.levelOf(text, rank);
      this.flush();
      if (level == null) {
        this.push('p', wrapBold(text));
      } else {
        this.items.push({ kind: 'heading', text, level });
        this.pending = [];
      }
    }
    // 有的书用图片做章名
    every(el, 'img').forEach(img =>
      this.picture(img, attr(img, 'src'), attr(img, 'alt')),
    );
  }

  /**
   * 目录刚发出的标题在正文里又出现一次（锚点在外层 section 上，或指向文件开头）：
   * 同名就不再重复；文件开头、和目录写法不一样（「CHAPTER II.」对「Chapter 2」）的留成加粗段落。
   */
  private absorb(text: string, rank: number): boolean {
    const hit = this.pending.findIndex(p => sameTitle(p.scope.title, text));
    if (hit >= 0) {
      const p = this.pending[hit];
      this.learn(p.scope, rank);
      retitle(p.heading, text);
      this.pending = this.pending.slice(hit + 1);
      return true;
    }
    const p = this.pending[0];
    if (!p || !this.fresh || deeperThan(p.scope.title, text)) {
      return false;
    }
    if (p.scope.rank == null) {
      p.scope.rank = rank;
    }
    this.pending = this.pending.slice(1);
    this.flush();
    this.push('p', wrapBold(text));
    return true;
  }

  /**
   * 没进目录的 h1–h4 的层级；返回 null 表示不算标题（当加粗段落）。
   * 没有目录：h1–h3 按标签。有目录：带编号的按编号算，否则按标签和所在目录项的差；
   * 都不能高过所在目录项；不带编号的还要比这一项子树里目录列到的最深一级更深，且不超过 3 级。
   */
  private levelOf(text: string, rank: number): number | null {
    if (rank > 4) {
      return null;
    }
    if (!this.hasToc) {
      return rank <= 3 ? rank : null;
    }
    const s = this.scope;
    const own = numberDepth(text);
    if (own != null) {
      const base = numberDepth(s.title) ?? s.level;
      return Math.min(Math.max(s.level + own - base, s.level, 1), 3);
    }
    const level = s.level + rank - (s.rank ?? s.level + (this.offset ?? 0));
    // 比 3 级还深的不带编号标题留在上一级小节里（压成 3 级会变成它的兄弟）
    if (level <= s.deep || level <= s.level || level > 3) {
      return null;
    }
    return level;
  }

  private flow(nodes: AnyNode[]) {
    nodes.forEach(n => this.node(n));
  }

  /** 行内节点攒成一段，遇到块级元素先把攒的那段发出去。 */
  private node(n: AnyNode) {
    if (DomUtils.isText(n) || DomUtils.isCDATA(n)) {
      this.run.push(n);
      return;
    }
    if (!DomUtils.isTag(n) || this.consumed.has(n)) {
      return;
    }
    if (skipped(n)) {
      // 分页标记上的 id 也可能被目录指到
      this.emitTargets(this.targetsAt(n, 'self'));
      return;
    }
    if (isBlock(n)) {
      this.flush();
      this.block(n);
    } else if (hasBlock(n)) {
      // <a><img/></a>、包着 <div> 的 <span>：拆开走
      this.emitTargets(this.targetsAt(n, 'self'));
      this.flow(kids(n));
    } else {
      this.emitTargets(this.targetsAt(n, 'inline'));
      this.run.push(n);
    }
  }

  private block(el: Element) {
    const tag = tagOf(el);
    if (/^h[1-6]$/.test(tag)) {
      this.heading(el);
      return;
    }
    const leaf = ['pre', 'table', 'img', 'svg', 'math'].includes(tag);
    this.emitTargets(this.targetsAt(el, leaf ? 'all' : 'self'));
    switch (tag) {
      case 'ul':
      case 'ol':
        this.list(el);
        break;
      case 'li':
        this.item(el, '•');
        break;
      case 'pre':
        this.code(el);
        break;
      case 'table':
        this.table(el);
        break;
      case 'img':
        this.picture(el, attr(el, 'src'), attr(el, 'alt'));
        break;
      case 'svg':
        this.svg(el);
        break;
      case 'math':
        this.equation(texOf(el));
        break;
      case 'figure':
        this.figure(el);
        break;
      case 'hr':
        break;
      default:
        // p / div / section / blockquote …：里面的段落各自成块
        this.flow(kids(el));
        this.flush();
    }
  }

  /** 把攒着的行内节点发成一段：只有一个公式时是 'eq'，在 <li> 里时是 'li'。 */
  private flush() {
    const run = this.run;
    this.run = [];
    if (!run.length) {
      return;
    }
    const sole = this.mark == null ? soleMath(run) : null;
    if (sole) {
      const tex = texOf(sole.math);
      this.equation(sole.tag ? `${tex} \\tag{${sole.tag}}` : tex);
      return;
    }
    const text = lines(run.map(n => inline(n, 'rich')).join(''))
      .replace(/\*\*(\s*)\*\*/g, '$1')
      .trim();
    if (!text) {
      return;
    }
    if (this.mark != null) {
      this.push('li', text, { mark: this.mark });
      this.mark = null;
    } else {
      this.push('p', text);
    }
  }

  private push(type: BlockType, text: string, extra: Partial<RawBlock> = {}) {
    const block: RawBlock = { kind: 'block', type, text, ...extra };
    this.items.push(block);
    // 章名前的花饰图不算正文：后面的章名仍可能是目录那一项
    if (type !== 'img') {
      this.fresh = false;
    }
    return block;
  }

  private equation(tex: string) {
    if (tex) {
      this.push('eq', tex);
    }
  }

  /** <ul> 每项「•」，<ol> 从 start 开始数（<li value> 可以改号）；嵌套的列表按顺序摊平。 */
  private list(el: Element) {
    const ordered = isTag(el, 'ol');
    let n = Number.parseInt(attr(el, 'start'), 10);
    n = Number.isFinite(n) ? n : 1;
    for (const c of kids(el)) {
      if (!isTag(c, 'li') || skipped(c)) {
        this.node(c);
        continue;
      }
      const value = Number.parseInt(attr(c, 'value'), 10);
      if (ordered && Number.isFinite(value)) {
        n = value;
      }
      this.emitTargets(this.targetsAt(c, 'self'));
      this.item(c, ordered ? `${n}.` : '•');
      n++;
    }
  }

  /** 一个 <li>：第一段文字是这一项，后面的段落、嵌套列表、图各自成块。 */
  private item(el: Element, mark: string) {
    this.flush();
    this.mark = mark;
    for (const c of kids(el)) {
      if (DomUtils.isTag(c) && isBlock(c)) {
        this.flush();
      }
      // 这一项还没出字就先遇到嵌套列表：读完嵌套列表后，后面的字仍算这一项
      const keep: string | null = isTag(c, 'ul', 'ol') ? this.mark : null;
      this.node(c);
      if (keep != null) {
        this.mark = keep;
      }
    }
    this.flush();
    this.mark = null;
  }

  private code(el: Element) {
    const text = preText(el)
      .replace(/^(?:[ \t]*\n)+/, '')
      .replace(/\s+$/, '');
    if (text) {
      this.push('code', text);
    }
  }

  /** 表格：html 原样保留；text 每行单元格用「 | 」连、行之间换行。没有单元格的排版用表格当容器读。 */
  private table(el: Element) {
    const rows = every(el, 'tr')
      .map(tr =>
        kids(tr)
          .filter(c => isTag(c, 'td', 'th'))
          .map(c => squash(inline(c, 'plain'))),
      )
      .filter(cells => cells.some(Boolean))
      .map(cells => cells.join(' | '));
    if (!rows.length) {
      this.flow(kids(el));
      this.flush();
      return;
    }
    this.push('table', rows.join('\n'), {
      html: DomUtils.getOuterHTML(el, { encodeEntities: 'utf8' }),
    });
  }

  /** 图：image 是相对书根的路径（文件在不在最后统一查）；text 用图注，没有图注用 alt。 */
  private picture(el: Element, src: string, alt: string) {
    const text = squash(this.captions.get(el) || alt);
    if (!src.trim()) {
      if (text) {
        this.push('img', text);
      }
      return;
    }
    const link = resolveHref(this.path, src);
    if (!link) {
      this.warn(`图片读不出来：${src.slice(0, 80)}（${this.path}）`);
      if (text) {
        this.push('img', text);
      }
      return;
    }
    this.images.push({
      block: this.push('img', text, { image: link.path }),
      path: link.path,
    });
  }

  /** <svg><image xlink:href> 当图；纯矢量图没有文件可存，跳过并提示一次。 */
  private svg(el: Element) {
    const image = first(el, 'image');
    const href = image ? attr(image, 'xlink:href') || attr(image, 'href') : '';
    if (!href) {
      this.warn(`有矢量图（SVG）没有导入（${this.path}）`);
      return;
    }
    const title = first(el, 'title');
    this.picture(el, href, (title && allText(title)) || attr(el, 'aria-label'));
  }

  /** <figure>：figcaption 当图的说明，不再单独成段；没有图的 figure 照常读。 */
  private figure(el: Element) {
    const own = (n: AnyNode) => closestFigure(n) === el;
    const cap = DomUtils.findOne(
      c => isTag(c, 'figcaption') && own(c),
      kids(el),
    );
    const pic = DomUtils.findOne(
      c => isTag(c, 'img', 'svg') && own(c),
      kids(el),
    );
    if (cap && pic) {
      const text = squash(inline(cap, 'plain'));
      if (text) {
        this.captions.set(pic, text);
      }
      this.consumed.add(cap);
    }
    this.flow(kids(el));
    this.flush();
  }

  private warn(message: string) {
    if (!this.once.has(message)) {
      this.once.add(message);
      this.warnings.push(message);
    }
  }
}

// ---- 入口 ----

const isXhtml = (item: ManifestItem) =>
  /^(application\/xhtml\+xml|text\/html|application\/xml|text\/x-oeb1-document)$/.test(
    item.mediaType,
  ) || /\.x?html?$/i.test(item.path);

/** 按 spine 顺序读正文文件；linear="no" 的跳过，读不出来的跳过并提示。 */
async function readSpine(
  dir: string,
  io: EpubIo,
  pkg: Pkg,
  warnings: string[],
): Promise<{ path: string; text: string }[]> {
  const linear = pkg.spine.filter(s => s.linear);
  // 全标成 linear="no" 的坏书：只能都读
  const refs = linear.length ? linear : pkg.spine;
  const seen = new Set<string>();
  const out: { path: string; text: string }[] = [];
  for (const ref of refs) {
    const item = pkg.manifest.get(ref.idref);
    if (!item) {
      warnings.push(`正文顺序里的 ${ref.idref} 不在 manifest 里，已跳过`);
      continue;
    }
    if (!isXhtml(item) || seen.has(item.path)) {
      continue;
    }
    seen.add(item.path);
    const text = await readOptional(io, inDir(dir, item.path));
    if (text == null) {
      warnings.push(`正文文件读不出来，已跳过：${item.path}`);
    } else {
      out.push({ path: item.path, text });
    }
  }
  if (!out.length) {
    throw new EpubError('unreadable_spine', 'EPUB 没有读得出来的正文文件');
  }
  return out;
}

/** 图片文件不在的：去掉 image 并提示；连图注也没有的图块删掉。 */
async function checkImages(
  dir: string,
  io: EpubIo,
  walker: Walker,
): Promise<RawItem[]> {
  const known = new Map<string, boolean>();
  const gone = new Set<RawItem>();
  for (const { block, path } of walker.images) {
    let ok = known.get(path);
    if (ok == null) {
      ok = await io.exists(inDir(dir, path)).catch(() => false);
      known.set(path, ok);
      if (!ok) {
        walker.warnings.push(`缺图：${path}`);
      }
    }
    if (!ok) {
      delete block.image;
      if (!block.text) {
        gone.add(block);
      }
    }
  }
  return walker.items.filter(i => !gone.has(i));
}

/** dir = an already-unzipped EPUB. Image paths in the result are relative to dir (e.g. 'OEBPS/images/f1.png'). */
export async function parseEpubDir(dir: string, io: EpubIo): Promise<RawDoc> {
  const pkg = await readPackage(dir, io);
  const warnings: string[] = [];
  const targets = flattenToc(await readToc(dir, io, pkg, warnings));
  const files = await readSpine(dir, io, pkg, warnings);
  let walker = new Walker(targets);
  files.forEach(f => walker.walkFile(f.path, f.text));
  const manifestPaths = new Set([...pkg.manifest.values()].map(i => i.path));
  if (walker.hasToc && !walker.matched) {
    // 目录一项都对不上正文（链接全坏）：当没有目录，按 h1–h3 分
    warnings.push('目录和正文对不上，改用正文里的 h1–h3 当标题');
    walker = new Walker([]);
    files.forEach(f => walker.walkFile(f.path, f.text));
  } else {
    warnings.push(...walker.report(manifestPaths));
  }
  // checkImages 会往 walker.warnings 里加缺图，所以放在它后面合并
  const items = await checkImages(dir, io, walker);
  warnings.push(...walker.warnings);
  if (!items.some(i => i.kind === 'block')) {
    throw new EpubError('unreadable_spine', 'EPUB 里没有读得出来的正文');
  }
  const heading = items.find((i): i is RawHeading => i.kind === 'heading');
  return {
    // 都没有时留空，由调用方用文件名
    title: pkg.title || heading?.text || '',
    author: pkg.author || '未知作者',
    items,
    warnings,
  };
}
