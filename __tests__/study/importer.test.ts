/**
 * 导入流水线（QUANTWISE_DESIGN.md §5）：内存文件系统 + 假的 MinerU 客户端。
 * Markdown 和 EPUB 本机解析；PDF 分片、上传、轮询、下载、合并成书；可重试的错误不让书失败；同一个文件不重复导入。
 */
import type { AppCore } from '../../src/app/boot';
import * as bookRepo from '../../src/data/bookRepo';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import type { ImportIo } from '../../src/study/files';
import { MineruError, type MineruClient, type MineruResult, type MineruUploadFile } from '../../src/study/import/mineru';
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
  renderPdfPage: jest.fn(async (_pdf, _page, dest) => { files.set(dest, 'png'); }),
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
  useParse.setState({}, true);
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

test('PDF：上传中断后重启，云端还在 waiting-file 的片会重新上传，不会空转排队', async () => {
  const c = await core();
  pages = 393;
  files.set('/cache/interrupted.pdf', 'pdf');
  const upload = jest.spyOn(client, 'upload').mockRejectedValueOnce(new MineruError('network'));
  const query = jest.spyOn(client, 'query');
  const originalQuery = query.getMockImplementation()!;
  let oldQueries = 0;
  query.mockImplementation(async batch => {
    if (batch !== 'batch-1') return originalQuery(batch);
    // 第二次查询抛错，让旧实现确定性退出，而不是让测试真的无限排队。
    if (++oldQueries > 1) throw new MineruError('network');
    return requested[0].map(f => ({ fileName: f.name, dataId: f.dataId, state: 'waiting-file' }));
  });
  try {
    const id = await startPdfImport(c, { path: '/cache/interrupted.pdf', name: 'interrupted.pdf', model: 'vlm', ocr: true });
    await runParse(c, id);
    expect(useParse.getState()[id].stage).toBe('已暂停');
    expect((await bookRepo.parts(c.db, id)).map(p => p.state)).toEqual(['uploading', 'pending']);
    // 旧版会预先将整批标为 uploading；模拟截图中的已有记录。
    for (const p of await bookRepo.parts(c.db, id)) await bookRepo.savePart(c.db, id, { ...p, state: 'uploading' });
    useParse.setState({}, true);
    await runParse(c, id);
    expect(requested).toHaveLength(2);
    expect(requested[1].map(f => f.pageRanges)).toEqual(['1-200', '201-393']);
    expect(uploads).toHaveLength(2);
    expect(oldQueries).toBe(1);
    expect(await bookRepo.book(c.db, id)).toMatchObject({ status: 'ready', error: null });
  } finally {
    upload.mockRestore();
    query.mockRestore();
  }
});

test('PDF：只补传中断的片，保留已接收的片，旧批次的 waiting-file 不覆盖新任务', async () => {
  const c = await core();
  pages = 393;
  files.set('/cache/partial.pdf', 'pdf');
  const upload = jest.spyOn(client, 'upload');
  const originalUpload = upload.getMockImplementation()!;
  upload.mockImplementationOnce(originalUpload).mockRejectedValueOnce(new MineruError('timeout'));
  const query = jest.spyOn(client, 'query');
  let round = 0;
  query.mockImplementation(async batch => {
    if (++round > 6) throw new MineruError('network');
    return requested[Number(batch.split('-')[1]) - 1].map(f =>
      batch === 'batch-1' && f.dataId.endsWith('-p2')
        ? { fileName: f.name, dataId: f.dataId, state: 'waiting-file' }
        : { fileName: f.name, dataId: f.dataId, state: 'done', zipUrl: 'zip:' + f.dataId },
    );
  });
  try {
    const id = await startPdfImport(c, { path: '/cache/partial.pdf', name: 'partial.pdf', model: 'vlm', ocr: true });
    await runParse(c, id);
    await retryParse(c, id);
    expect(requested).toHaveLength(2);
    expect(requested[1].map(f => f.pageRanges)).toEqual(['201-393']);
    expect(uploads).toHaveLength(2);
    expect((await bookRepo.parts(c.db, id)).map(p => [p.batchId, p.state])).toEqual([['batch-1', 'done'], ['batch-2', 'done']]);
    expect(await bookRepo.book(c.db, id)).toMatchObject({ status: 'ready' });
  } finally {
    upload.mockRestore();
    query.mockRestore();
  }
});

test('PDF：上传响应丢失但云端已接收，恢复时不重复上传', async () => {
  const c = await core();
  pages = 50;
  files.set('/cache/accepted.pdf', 'pdf');
  const upload = jest.spyOn(client, 'upload').mockRejectedValueOnce(new MineruError('network'));
  try {
    const id = await startPdfImport(c, { path: '/cache/accepted.pdf', name: 'accepted.pdf', model: 'vlm', ocr: false });
    await runParse(c, id);
    await runParse(c, id);
    expect(requested).toHaveLength(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(await bookRepo.book(c.db, id)).toMatchObject({ status: 'ready' });
  } finally {
    upload.mockRestore();
  }
});

test('PDF：进度使用云端真实状态，保留解析页数，不把等待接收和排队显示成解析', async () => {
  const c = await core();
  pages = 50;
  files.set('/cache/states.pdf', 'pdf');
  const states: MineruResult['state'][] = ['waiting-file', 'pending', 'running', 'converting', 'done'];
  const seen: { state: string; stage: string }[] = [];
  const query = jest.spyOn(client, 'query').mockImplementation(async () => {
    const f = requested[0][0];
    const id = f.dataId.replace(/-p1$/, '');
    if (states.length < 5) seen.push({ state: (await bookRepo.parts(c.db, id))[0].state, stage: useParse.getState()[id].stage });
    const state = states.shift()!;
    return [{ fileName: f.name, dataId: f.dataId, state, ...(state === 'running' ? { progress: { extractedPages: 12, totalPages: 50 } } : {}), ...(state === 'done' ? { zipUrl: 'zip:' + f.dataId } : {}) }];
  });
  try {
    const id = await startPdfImport(c, { path: '/cache/states.pdf', name: 'states.pdf', model: 'vlm', ocr: true });
    await runParse(c, id);
    expect(seen).toEqual([
      { state: 'uploaded', stage: '等待 MinerU 确认上传' },
      { state: 'queued', stage: 'MinerU 排队中' },
      { state: 'parsing', stage: 'MinerU 解析中（第 1 片 12 / 50 页）' },
      { state: 'converting', stage: 'MinerU 正在生成解析结果' },
    ]);
    expect(await bookRepo.book(c.db, id)).toMatchObject({ status: 'ready' });
  } finally {
    query.mockRestore();
  }
});

test('PDF：云端一直未确认上传时暂停，继续后补传，不会永久等待', async () => {
  const c = await core();
  pages = 50;
  files.set('/cache/unconfirmed.pdf', 'pdf');
  let time = Date.now();
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => time);
  const query = jest.spyOn(client, 'query');
  const originalQuery = query.getMockImplementation()!;
  let waitingQueries = 0;
  query.mockImplementation(async batch => {
    if (batch !== 'batch-1') return originalQuery(batch);
    if (++waitingQueries > 4) throw new MineruError('network');
    time += 61_000;
    return requested[0].map(f => ({ fileName: f.name, dataId: f.dataId, state: 'waiting-file' }));
  });
  try {
    const id = await startPdfImport(c, { path: '/cache/unconfirmed.pdf', name: 'unconfirmed.pdf', model: 'vlm', ocr: true });
    await runParse(c, id);
    expect(waitingQueries).toBe(2);
    expect(await bookRepo.book(c.db, id)).toMatchObject({ status: 'parsing', error: expect.stringContaining('未确认收到文件') });
    expect(useParse.getState()[id].stage).toBe('已暂停');
    useParse.setState({}, true);
    await runParse(c, id);
    expect(requested).toHaveLength(2);
    expect(await bookRepo.book(c.db, id)).toMatchObject({ status: 'ready', error: null });
  } finally {
    clock.mockRestore();
    query.mockRestore();
  }
});

test.each(['A0211', '-60018'])('PDF account error %s persists a pause and resumes the accepted batch', async code => {
  const c = await core();
  pages = 50;
  files.set('/cache/account.pdf', 'pdf');
  failQuery = new MineruError(code);
  const id = await startPdfImport(c, { path: '/cache/account.pdf', name: 'account.pdf', model: 'vlm', ocr: false });
  await runParse(c, id);
  expect(await bookRepo.book(c.db, id)).toMatchObject({ status: 'parsing', error: failQuery.message });
  const before = await bookRepo.parts(c.db, id);
  expect(before[0]).toMatchObject({ state: 'uploaded', batchId: 'batch-1' });
  useParse.setState({}, true); // App 重启，不能只靠内存显示暂停原因
  expect((await bookRepo.book(c.db, id))?.error).toBe(failQuery.message);
  failQuery = null;
  await runParse(c, id);
  expect(requested).toHaveLength(1);
  expect(uploads).toHaveLength(1);
  expect(await bookRepo.book(c.db, id)).toMatchObject({ status: 'ready', error: null });
});

test('PDF OCR gap renders the original page before saving, and a render failure retries without reupload', async () => {
  const c = await core();
  pages = 3;
  files.set('/cache/gap.pdf', 'pdf');
  const download = client.download;
  const render = jest.spyOn(io, 'renderPdfPage');
  render.mockRejectedValueOnce(new Error('原页图像生成失败'));
  client.download = async (_url, dest) => {
    files.set(dest + '/book_content_list.json', JSON.stringify([
      { type: 'text', text: 'Chapter 1 Gap', text_level: 1, page_idx: 0 },
      { type: 'text', text: 'Intro', page_idx: 0 },
      { type: 'text', text: '', bbox: [100, 100, 800, 900], page_idx: 1 },
    ]));
    return dest;
  };
  try {
    const id = await startPdfImport(c, { path: '/cache/gap.pdf', name: 'gap.pdf', model: 'vlm', ocr: false });
    await runParse(c, id);
    expect((await bookRepo.book(c.db, id))?.status).toBe('failed');
    expect((await bookRepo.parts(c.db, id))[0].state).toBe('done');
    await retryParse(c, id);
    const b = await bookRepo.book(c.db, id);
    expect(b?.status).toBe('ready');
    expect(uploads).toHaveLength(1);
    const blocks = await bookRepo.sectionBlocks(c.db, id, '1');
    expect(blocks[1]).toMatchObject({ page: 2, type: 'img', image: 'source-pages/p2.png', text: '此页未生成独立的可读内容，已保留原页图像。' });
    expect(files.has(b!.body.dir + '/source-pages/p2.png')).toBe(true);
    expect(b?.body.warnings?.[0]).toContain('第 2 页没有独立的可读内容');
  } finally {
    client.download = download;
    render.mockRestore();
  }
});

test('an account failure inside a batch row keeps the accepted task available to resume', async () => {
  const c = await core();
  pages = 50;
  files.set('/cache/row.pdf', 'pdf');
  const query = client.query;
  client.query = async () => [{ fileName: 'row.pdf', dataId: requested[0][0].dataId, state: 'failed', error: new MineruError('A0211') }];
  try {
    const id = await startPdfImport(c, { path: '/cache/row.pdf', name: 'row.pdf', model: 'vlm', ocr: false });
    await runParse(c, id);
    expect(await bookRepo.book(c.db, id)).toMatchObject({ status: 'parsing', error: expect.stringContaining('过期') });
    expect((await bookRepo.parts(c.db, id))[0]).toMatchObject({ state: 'uploaded', batchId: 'batch-1' });
    client.query = query;
    await runParse(c, id);
    expect(uploads).toHaveLength(1);
    expect((await bookRepo.book(c.db, id))?.status).toBe('ready');
  } finally {
    client.query = query;
  }
});
