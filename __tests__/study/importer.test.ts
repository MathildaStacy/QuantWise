/**
 * 导入流水线（QUANTWISE_DESIGN.md §5）：内存文件系统 + 假的 MinerU 客户端。
 * Markdown 和 EPUB 本机解析；PDF 分片、上传、轮询、下载、合并成书；可重试的错误不让书失败；同一个文件不重复导入。
 */
import type { AppCore } from '../../src/app/boot';
import * as bookRepo from '../../src/data/bookRepo';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import type { ImportIo } from '../../src/study/files';
import { MineruError, type MineruClient, type MineruUploadFile } from '../../src/study/import/mineru';
import { importFile, planPdf, retryParse, runParse, setImportDeps, startPdfImport, useParse } from '../../src/study/importer';

const files = new Map<string, string>();
const zips = new Map<string, Record<string, string>>();
let pages = 418;

const io: ImportIo = {
  root: '/docs/books',
  mkdir: async () => undefined,
  remove: async p => {
    files.delete(p);
  },
  copy: async (a, b) => {
    files.set(b, files.get(a) ?? '');
  },
  readText: async p => {
    if (!files.has(p)) {
      throw new Error('没有文件 ' + p);
    }
    return files.get(p)!;
  },
  exists: async p => files.has(p),
  list: async dir => [...files.keys()].filter(k => k.startsWith(dir + '/')).map(k => k.slice(dir.length + 1)),
  unzip: async (zip, dest) => {
    for (const [k, v] of Object.entries(zips.get(zip) ?? {})) {
      files.set(dest + '/' + k, v);
    }
  },
  sha256: async p => 'sha-' + (files.get(p) ?? p).length + '-' + p.length,
  size: async p => (files.get(p) ?? '').length,
  pdfPages: async () => pages,
  mineru: {} as ImportIo['mineru'],
};

let requested: MineruUploadFile[][] = [];
let uploads: string[] = [];
let queries = 0;
let failQuery: Error | null = null;
const contentList = (from: number, title: string) =>
  JSON.stringify([
    { type: 'text', text: title, text_level: 1, page_idx: 0 },
    { type: 'text', text: '正文 $x$ 第 ' + from + ' 页', page_idx: 0 },
    { type: 'equation', text: '$$a = b$$', page_idx: 1 },
  ]);
const client: MineruClient = {
  requestUpload: async f => {
    requested.push(f);
    return { batchId: 'batch-' + requested.length, urls: f.map((_, i) => 'https://up/' + i) };
  },
  upload: async url => {
    uploads.push(url);
  },
  query: async batchId => {
    if (failQuery) {
      throw failQuery;
    }
    queries++;
    const sent = requested[Number(batchId.split('-')[1]) - 1];
    return sent.map(f => (queries < 2 ? { fileName: f.name, dataId: f.dataId, state: 'running' as const, progress: { extractedPages: 10, totalPages: 200 } } : { fileName: f.name, dataId: f.dataId, state: 'done' as const, zipUrl: 'zip:' + f.dataId }));
  },
  download: async (zipUrl, dest) => {
    const n = Number(/-p(\d+)$/.exec(zipUrl)![1]);
    files.set(dest + '/abc/abc_content_list.json', contentList(1 + (n - 1) * 200, '第 ' + n + ' 章 第' + n + '片'));
    return dest;
  },
  test: async () => ({ ok: true, latencyMs: 1 }),
};

async function core() {
  const db = openMemoryDb();
  await migrate(db);
  setImportDeps({ io, mineru: client, pollMs: () => 0 });
  files.clear();
  requested = [];
  uploads = [];
  queries = 0;
  failQuery = null;
  pages = 418;
  return { db } as AppCore;
}

test('Markdown：导入、同一个文件第二次直接打开', async () => {
  const c = await core();
  files.set('/cache/a.md', '# 第一章 测试\n\n## 1.1 小节\n\n正文。\n');
  const r = await importFile(c, '/cache/a.md', 'a.md');
  expect(r).toMatchObject({ kind: 'done', existed: false });
  files.set('/cache/a.md', '# 第一章 测试\n\n## 1.1 小节\n\n正文。\n');
  expect(await importFile(c, '/cache/a.md', 'a.md')).toMatchObject({ kind: 'done', existed: true });
  expect(await bookRepo.books(c.db)).toHaveLength(1);
});

test('EPUB：解压后本机解析，图片路径加上 epub/', async () => {
  const c = await core();
  files.set('/cache/b.epub', 'zipbytes');
  zips.set('/cache/b.epub', {
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/c.opf"/></rootfiles></container>',
    'OEBPS/c.opf': '<package><metadata><dc:title>书名</dc:title><dc:creator>作者</dc:creator></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>',
    'OEBPS/a.xhtml': '<html><body><h1>第 1 章 开始</h1><p>第一段</p><img src="i.png" alt="图一"/></body></html>',
    'OEBPS/i.png': 'png',
  });
  const r = await importFile(c, '/cache/b.epub', 'b.epub');
  expect(r).toMatchObject({ kind: 'done', title: '书名' });
  const id = (r as { bookId: string }).bookId;
  const blocks = await bookRepo.sectionBlocks(c.db, id, '1');
  expect(blocks.map(b => b.type)).toEqual(['p', 'img']);
  expect(blocks[1].image).toBe('epub/OEBPS/i.png');
});

test('PDF：418 页分 3 片、一次申请、逐片上传、轮询、合并成书，页码按原书', async () => {
  const c = await core();
  files.set('/cache/q.pdf', 'pdf-bytes');
  const plan = await planPdf('/cache/q.pdf');
  expect(plan.parts.map(p => [p.pageFrom, p.pageTo])).toEqual([[1, 200], [201, 400], [401, 418]]);
  expect(plan.blocked).toBeNull();
  const id = await startPdfImport(c, { path: '/cache/q.pdf', name: 'q.pdf', model: 'vlm', ocr: false });
  await runParse(c, id);
  expect(requested[0].map(f => f.pageRanges)).toEqual(['1-200', '201-400', '401-418']);
  expect(new Set(requested[0].map(f => f.dataId)).size).toBe(3);
  expect(uploads).toHaveLength(3);
  const book = await bookRepo.book(c.db, id);
  expect(book).toMatchObject({ status: 'ready', pages: 418, format: 'pdf' });
  const secs = await bookRepo.sections(c.db, id);
  expect(secs.filter(s => s.level === 1).map(s => s.no)).toEqual(['第 1 章', '第 2 章', '第 3 章']);
  const b2 = await bookRepo.sectionBlocks(c.db, id, '2');
  expect(b2.map(b => b.page)).toEqual([201, 202]);
  expect(useParse.getState()[id]).toMatchObject({ done: 1, error: null });
});

test('PDF：网络错误暂停（书还是解析中），再继续不重复上传；文件太大拦下', async () => {
  const c = await core();
  pages = 120;
  files.set('/cache/r.pdf', 'pdf');
  const id = await startPdfImport(c, { path: '/cache/r.pdf', name: 'r.pdf', model: 'pipeline', ocr: true });
  failQuery = new MineruError('network');
  await runParse(c, id);
  expect((await bookRepo.book(c.db, id))?.status).toBe('parsing');
  expect(useParse.getState()[id]).toMatchObject({ stage: '已暂停' });
  expect(requested[0]).toEqual([expect.objectContaining({ ocr: true, pageRanges: undefined })]);
  failQuery = null;
  await runParse(c, id);
  expect(requested).toHaveLength(1);
  expect((await bookRepo.book(c.db, id))?.status).toBe('ready');
  files.set('/cache/big.pdf', 'x'.repeat(200_000_001));
  expect((await planPdf('/cache/big.pdf')).blocked).toContain('200 MB');
});

test('PDF：MinerU 说这一片解析失败 → 书失败；重试从上传开始', async () => {
  const c = await core();
  pages = 50;
  files.set('/cache/f.pdf', 'pdf');
  const orig = client.query;
  client.query = async () => [{ fileName: 'f.pdf', dataId: requested[requested.length - 1][0].dataId, state: 'failed', error: new MineruError('-60002') }];
  const id = await startPdfImport(c, { path: '/cache/f.pdf', name: 'f.pdf', model: 'vlm', ocr: false });
  await runParse(c, id);
  expect((await bookRepo.book(c.db, id))?.status).toBe('failed');
  client.query = orig;
  await retryParse(c, id);
  expect(requested).toHaveLength(2);
  expect((await bookRepo.book(c.db, id))?.status).toBe('ready');
});
