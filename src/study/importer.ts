/**
 * 导入一本书（QUANTWISE_DESIGN.md §5）：选文件 → SHA-256（导入过就直接打开）→ 按格式解析 → 写书架。
 * PDF 走 MinerU：按 ≤ 200 页分片（同一个文件 + page_ranges）→ 上传 → 轮询 → 下载结果包 → content_list → 内容块。
 * 每片的任务号和状态写进 book_part，App 被杀后回到解析页接着轮询，不重复上传。
 */
import { errorCodes, isErrorWithCode, keepLocalCopy, pick, types } from '@react-native-documents/picker';
import * as Keychain from 'react-native-keychain';
import { create } from 'zustand';
import type { AppCore } from '../app/boot';
import { assemble } from '../book/assemble';
import * as bookRepo from '../data/bookRepo';
import { beijingIso } from '../market/clock';
import { deviceIo, type ImportIo } from './files';
import { parseEpubDir } from './import/epub';
import {
  createMineruClient,
  MINERU_MAX_BYTES,
  MineruError,
  pageRanges,
  planParts,
  type MineruClient,
  type MineruModel,
} from './import/mineru';
import { adaptContentList, findContentList, mergeParts } from './import/mineruAdapter';
import { preparePdfItems } from './import/pdfStructure';
import { bookIdOf, importMarkdownText, saveImported } from './library';

// ---------- 依赖（测试里替换） ----------

const MINERU_SERVICE = 'quantwise.mineru';

export const mineruToken = {
  async get(): Promise<string | null> {
    const r = await Keychain.getGenericPassword({ service: MINERU_SERVICE });
    return r ? r.password : null;
  },
  async set(token: string): Promise<void> {
    await Keychain.setGenericPassword('mineru', token.trim(), { service: MINERU_SERVICE, storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH });
  },
  async remove(): Promise<void> {
    await Keychain.resetGenericPassword({ service: MINERU_SERVICE });
  },
};

interface Deps {
  io: ImportIo | null;
  mineru: MineruClient | null;
  /** 轮询间隔（毫秒），测试里调成 0。 */
  pollMs: (round: number) => number;
}

const deps: Deps = {
  io: null,
  mineru: null,
  pollMs: round => Math.min(30_000, 2000 * 1.5 ** round),
};

export function setImportDeps(d: Partial<Deps>): void {
  Object.assign(deps, d);
}

export const importIo = () => (deps.io ??= deviceIo());

export function mineruClient(): MineruClient {
  deps.mineru ??= createMineruClient({ getToken: () => mineruToken.get(), files: importIo().mineru });
  return deps.mineru;
}

const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
export const bookDir = (bookId: string) => importIo().root + '/' + bookId;

// ---------- 选文件和本机解析 ----------

export type PickResult =
  | { kind: 'done'; bookId: string; title: string; existed: boolean }
  | { kind: 'pdf'; path: string; name: string; size: number };

/** 选一个文件并导入；PDF 只复制进来，返回给解析设置页。用户取消返回 null。 */
export async function pickAndImport(core: AppCore): Promise<PickResult | null> {
  let picked;
  try {
    [picked] = await pick({ type: [types.pdf, 'application/epub+zip', types.plainText, 'text/markdown', 'text/x-markdown', types.allFiles] });
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) {
      return null;
    }
    throw e;
  }
  const name = picked.name ?? 'book';
  const ext = extOf(name);
  if (!['pdf', 'epub', 'md', 'markdown', 'txt'].includes(ext)) {
    throw new Error('只支持 PDF、EPUB 和 Markdown（.md / .txt）');
  }
  // Picker 为每次复制创建独立目录；磁盘上用短 ASCII 名，原书名只用于显示和元数据。
  const [copy] = await keepLocalCopy({ files: [{ uri: picked.uri, fileName: 'source.' + ext }], destination: 'cachesDirectory' });
  if (copy.status !== 'success') {
    throw new Error('读不了这个文件：' + copy.copyError);
  }
  // localUri 是编码后的 file:// URI，文件 I/O 接收真实路径；只在 URI 边界解码一次。
  const path = decodeURIComponent(copy.localUri.replace(/^file:\/\//, ''));
  return importFile(core, path, name);
}

export async function importFile(core: AppCore, path: string, name: string): Promise<PickResult> {
  const io = importIo();
  const sha = await io.sha256(path);
  const dup = await bookRepo.bookBySha(core.db, sha);
  if (dup && dup.status !== 'failed') {
    await io.remove(path).catch(() => undefined);
    return { kind: 'done', bookId: dup.id, title: dup.title, existed: true };
  }
  const ext = extOf(name);
  const now = beijingIso();
  if (ext === 'pdf') {
    return { kind: 'pdf', path, name, size: await io.size(path) };
  }
  if (ext === 'epub') {
    const dir = bookDir(bookIdOf(sha));
    await io.mkdir(dir);
    await io.unzip(path, dir + '/epub');
    const doc = await parseEpubDir(dir + '/epub', io);
    const a = assemble({ ...doc, title: doc.title || name.replace(/\.\w+$/, '') });
    const r = await saveImported(core.db, { a: { ...a, blocks: a.blocks.map(b => (b.image ? { ...b, image: 'epub/' + b.image } : b)) }, format: 'epub', sha256: sha, fileName: name, dir }, now);
    await io.remove(path).catch(() => undefined);
    return { kind: 'done', bookId: r.bookId, title: a.title, existed: r.existed };
  }
  const r = await importMarkdownText(core.db, await io.readText(path), name, sha, now);
  await io.remove(path).catch(() => undefined);
  return { kind: 'done', bookId: r.bookId, title: name.replace(/\.\w+$/, ''), existed: r.existed };
}

// ---------- PDF ----------

export interface PdfPlan {
  pages: number;
  size: number;
  parts: { partNo: number; pageFrom: number; pageTo: number }[];
  /** 超过 MinerU 的单文件大小限制时的说明（不能解析）。 */
  blocked: string | null;
}

export async function planPdf(path: string): Promise<PdfPlan> {
  const io = importIo();
  const [pages, size] = await Promise.all([io.pdfPages(path), io.size(path)]);
  return {
    pages,
    size,
    parts: planParts(pages),
    blocked: size > MINERU_MAX_BYTES ? '文件 ' + (size / 1e6).toFixed(0) + ' MB，超过 MinerU 单文件 200 MB 的限制，V1 还不能解析' : null,
  };
}

/** 用户确认上传后：建书（解析中）和分片记录，开始后台解析，返回书 id。 */
export async function startPdfImport(
  core: AppCore,
  o: { path: string; name: string; model: MineruModel; ocr: boolean },
): Promise<string> {
  const io = importIo();
  const sha = await io.sha256(o.path);
  const id = bookIdOf(sha);
  const dir = bookDir(id);
  const plan = await planPdf(o.path);
  if (plan.blocked) {
    throw new Error(plan.blocked);
  }
  await io.mkdir(dir);
  await io.copy(o.path, dir + '/source.pdf');
  await io.remove(o.path).catch(() => undefined);
  const now = beijingIso();
  if (!(await bookRepo.book(core.db, id))) {
    await bookRepo.createBook(
      core.db,
      { id, title: o.name.replace(/\.pdf$/i, ''), author: '', format: 'pdf', source: 'import', sha256: sha, pages: plan.pages, status: 'parsing', error: null, body: { fileName: o.name, dir, model: o.model, ocr: o.ocr } },
      now,
    );
  }
  for (const p of plan.parts) {
    await bookRepo.savePart(core.db, id, { ...p, dataId: id + '-p' + p.partNo, batchId: null, state: 'pending', error: null, updatedAt: now });
  }
  runParse(core, id).catch(() => undefined);
  return id;
}

export interface ParseProgress {
  stage: string;
  /** 0–1。 */
  done: number;
  error: string | null;
}

export const useParse = create<Record<string, ParseProgress>>(() => ({}));
const NO_PROGRESS: ParseProgress = { stage: '', done: 0, error: null };
const setProgress = (id: string, p: Partial<ParseProgress>) =>
  useParse.setState(s => ({ [id]: { ...NO_PROGRESS, ...s[id], ...p } }));

const running = new Map<string, Promise<void>>();

/** 开始或接着解析（同一本书同时只跑一个）。解析页打开时、启动时都可以调。 */
export function runParse(core: AppCore, bookId: string): Promise<void> {
  const cur = running.get(bookId);
  if (cur) {
    return cur;
  }
  const job = parseQueue(core, bookId).finally(() => running.delete(bookId));
  running.set(bookId, job);
  return job;
}

/** 失败的片重来：清掉任务号，从上传开始。 */
export async function retryParse(core: AppCore, bookId: string): Promise<void> {
  const now = beijingIso();
  for (const p of await bookRepo.parts(core.db, bookId)) {
    if (p.state === 'failed') {
      await bookRepo.savePart(core.db, bookId, { ...p, state: 'pending', batchId: null, error: null, updatedAt: now });
    }
  }
  await bookRepo.updateBook(core.db, bookId, { status: 'parsing', error: null }, now);
  await runParse(core, bookId);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** 网络、账号或配额错误保留任务并持久化暂停原因，解决后继续轮询。 */
const RETRIABLE = new Set(['network', 'timeout', 'queue_full', 'service', 'cancelled', 'auth', 'daily_limit']);

async function parseQueue(core: AppCore, bookId: string): Promise<void> {
  const book = await bookRepo.book(core.db, bookId);
  if (!book || book.status === 'ready') {
    return;
  }
  const io = importIo();
  const client = mineruClient();
  const dir = book.body.dir ?? bookDir(bookId);
  const model = book.body.model ?? 'vlm';
  const save = (p: bookRepo.BookPart, patch: Partial<bookRepo.BookPart>) =>
    bookRepo.savePart(core.db, bookId, { ...p, ...patch, updatedAt: beijingIso() });
  setProgress(bookId, { error: null });
  try {
    await bookRepo.updateBook(core.db, bookId, { status: 'parsing', error: null }, beijingIso());
    let parts = await bookRepo.parts(core.db, bookId);
    const total = parts.length;
    // 1. 还没申请上传地址的片：一次申请，逐个上传（同一个文件 + 不同的 page_ranges）
    const pending = parts.filter(p => p.state === 'pending' || (p.state === 'uploading' && !p.batchId));
    if (pending.length) {
      setProgress(bookId, { stage: '申请上传地址', done: 0.02 });
      const { batchId, urls } = await client.requestUpload(
        pending.map(p => ({ name: book.body.fileName ?? 'book.pdf', dataId: p.dataId, ocr: !!book.body.ocr, pageRanges: total > 1 ? pageRanges(p) : undefined })),
        model,
      );
      for (const p of pending) {
        await save(p, { batchId, state: 'uploading' });
      }
      for (let i = 0; i < pending.length; i++) {
        setProgress(bookId, { stage: '上传第 ' + pending[i].partNo + ' / ' + total + ' 片', done: 0.05 + (0.25 * i) / pending.length });
        await client.upload(urls[i], dir + '/source.pdf', (sent, all) =>
          setProgress(bookId, { done: 0.05 + (0.25 * (i + (all ? sent / all : 0))) / pending.length }),
        );
        await save({ ...pending[i], batchId }, { state: 'parsing' });
      }
      parts = await bookRepo.parts(core.db, bookId);
    }
    // 2. 轮询，完成的片下载结果包
    for (let round = 0; parts.some(p => p.state !== 'done' && p.state !== 'failed'); round++) {
      const batches = [...new Set(parts.filter(p => p.batchId && p.state !== 'done').map(p => p.batchId!))];
      for (const b of batches) {
        for (const r of await client.query(b)) {
          const p = parts.find(x => x.dataId === r.dataId);
          if (!p || p.state === 'done') {
            continue;
          }
          if (r.state === 'failed') {
            if (r.error && ['auth', 'daily_limit'].includes(r.error.kind)) throw r.error;
            await save(p, { state: 'failed', error: r.error?.message ?? 'MinerU 解析失败' });
          } else if (r.state === 'done' && r.zipUrl) {
            setProgress(bookId, { stage: '下载第 ' + p.partNo + ' 片的结果' });
            await client.download(r.zipUrl, dir + '/part' + p.partNo);
            await save(p, { state: 'done', error: null });
          } else if (r.progress) {
            setProgress(bookId, { stage: 'MinerU 解析中（第 ' + p.partNo + ' 片 ' + r.progress.extractedPages + ' / ' + r.progress.totalPages + ' 页）' });
          }
        }
      }
      parts = await bookRepo.parts(core.db, bookId);
      const done = parts.filter(p => p.state === 'done').length;
      setProgress(bookId, { done: 0.3 + (0.6 * done) / total });
      if (parts.some(p => p.state === 'failed')) {
        const f = parts.find(p => p.state === 'failed')!;
        throw new Error('第 ' + f.partNo + ' 片解析失败：' + (f.error ?? ''));
      }
      if (parts.every(p => p.state === 'done')) {
        break;
      }
      setProgress(bookId, { stage: parts.some(p => p.state === 'parsing') ? 'MinerU 解析中' : '排队中' });
      await sleep(deps.pollMs(round));
    }
    // 3. 合并各片，切章节、建块
    setProgress(bookId, { stage: '切章节、写入书架', done: 0.92 });
    const items = [];
    const headers = [];
    const warnings: string[] = [];
    for (const p of parts) {
      const files = await io.list(dir + '/part' + p.partNo);
      const cl = findContentList(files);
      if (!cl) {
        throw new Error('第 ' + p.partNo + ' 片的结果包里没有 content_list');
      }
      const r = adaptContentList(JSON.parse(await io.readText(dir + '/part' + p.partNo + '/' + cl)), {
        pageFrom: p.pageFrom,
        pageTo: p.pageTo,
        imagePrefix: 'part' + p.partNo + '/' + cl.replace(/[^/]*$/, ''),
      });
      // 没有独立内容的检测页保留原页图像。渲染失败时不声称已补齐；完成的云端分片留给重试。
      for (const item of r.items) {
        if (item.kind !== 'block' || !item.sourcePage || item.page == null) continue;
        const image = 'source-pages/p' + item.page + '.png';
        await io.mkdir(dir + '/source-pages');
        await io.renderPdfPage(dir + '/source.pdf', item.page, dir + '/' + image);
        item.image = image;
        item.text = '此页未生成独立的可读内容，已保留原页图像。';
      }
      items.push(r.items);
      headers.push(...r.headers);
      warnings.push(...r.warnings);
    }
    const a = assemble({ title: book.title, author: book.author, items: preparePdfItems(mergeParts(items), headers), warnings });
    if (!a.sections.some(s => s.leaf)) {
      throw new Error('解析结果里没有正文');
    }
    await bookRepo.saveContent(core.db, bookId, { ...a, title: book.title }, beijingIso());
    setProgress(bookId, { stage: '完成', done: 1 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const retriable = e instanceof MineruError && RETRIABLE.has(e.kind);
    await bookRepo.updateBook(core.db, bookId, { status: retriable ? 'parsing' : 'failed', error: msg }, beijingIso());
    setProgress(bookId, { error: msg, stage: retriable ? '已暂停' : '失败' });
  }
}

/** 启动时接着解析还没完成的 PDF。 */
export async function resumeParses(core: AppCore): Promise<void> {
  for (const b of await bookRepo.books(core.db)) {
    if (b.format === 'pdf' && b.status === 'parsing') {
      runParse(core, b.id).catch(() => undefined);
    }
  }
}
