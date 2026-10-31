/**
 * 书的数据结构（QUANTWISE_DESIGN.md §4、§5）。解析器（Markdown / EPUB / MinerU）只产出 RawDoc：
 * 按原书顺序排好的「标题」和「正文块」；切章节、编号、算字数都在 assemble.ts 里统一做。
 */

export type BookFormat = 'pdf' | 'epub' | 'md';
export type BookStatus = 'parsing' | 'ready' | 'failed';

/** 正文块：段落、独立公式（LaTeX）、列表项、图、表（HTML）、代码。 */
export type BlockType = 'p' | 'eq' | 'li' | 'img' | 'table' | 'code';

export interface RawBlock {
  kind: 'block';
  type: BlockType;
  /** p / li / code：文字（行内公式写成 $…$）；eq：LaTeX；img：图注；table：表格的纯文字（搜索和上下文用）。 */
  text: string;
  /** 原书页码（从 1 开始，只有 PDF 有）。 */
  page?: number;
  /** li：列表符号（「•」或「1.」）。 */
  mark?: string;
  /** img：相对书目录的图片路径。 */
  image?: string;
  /** table：MinerU / EPUB 给的 HTML。 */
  html?: string;
}

export interface RawHeading {
  kind: 'heading';
  /** 标题原文，例如「第 3 章 动量与反转」「3.1 动量因子」「Introduction」。 */
  text: string;
  /** 解析器给的层级：Markdown 的 # 个数、EPUB 目录深度、MinerU 的 text_level。1 最高。 */
  level: number;
  page?: number;
}

export type RawItem = RawHeading | RawBlock;

export interface RawDoc {
  title: string;
  author: string;
  items: RawItem[];
  /** 解析时遇到、但不影响阅读的问题（缺图、目录对不上等），存进 book.body 给界面看。 */
  warnings: string[];
}

export interface BookSection {
  /** 章节号：「3」「3.1」「3.1.2」；没编号的标题是「c1」「c2」…；第一个标题之前的正文是「c0」。 */
  id: string;
  parentId: string | null;
  /** 全书顺序，从 0 开始。 */
  ord: number;
  /** 1 章 / 2 节 / 3 小节。 */
  level: 1 | 2 | 3;
  /** 显示用的编号：「第 3 章」「3.1」；没编号时为空。 */
  no: string;
  title: string;
  /** 有自己的正文块（能学）。章首有引言时，章本身也是一个可学的单元。 */
  leaf: boolean;
  /** 自己的正文块范围（全书序号，含两端）；没有正文时为 null。 */
  blockFrom: number | null;
  blockTo: number | null;
  pageFrom: number | null;
  pageTo: number | null;
  chars: number;
}

export interface BookBlock {
  /** 全书顺序，从 0 开始。 */
  seq: number;
  sectionId: string;
  /** 节内序号，从 1 开始：引用写成 [[b:3.1#2]]，显示「3.1 ¶2」。 */
  no: number;
  type: BlockType;
  text: string;
  page: number | null;
  mark: string | null;
  image: string | null;
  html: string | null;
}

export interface AssembledBook {
  title: string;
  author: string;
  sections: BookSection[];
  blocks: BookBlock[];
  warnings: string[];
}

export interface Book {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  source: 'sample' | 'import';
  sha256: string;
  pages: number | null;
  status: BookStatus;
  error: string | null;
  body: BookBody;
  createdAt: string;
  updatedAt: string;
}

/** book.body：解析参数和过程信息。 */
export interface BookBody {
  /** 导入时的文件名。 */
  fileName?: string;
  /** App 私有目录里的书目录（图片、解析结果都在下面）。 */
  dir?: string;
  /** PDF：MinerU 解析模型。 */
  model?: 'vlm' | 'pipeline';
  warnings?: string[];
  sections?: number;
  leaves?: number;
}
