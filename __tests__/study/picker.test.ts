/** Picker → real local file → import: URI encoding and storage names must not become file paths. */
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { keepLocalCopy, pick, type DocumentPickerResponse } from '@react-native-documents/picker';
import type { AppCore } from '../../src/app/boot';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import * as bookRepo from '../../src/data/bookRepo';
import { deviceIo } from '../../src/study/files';
import { pickAndImport, setImportDeps } from '../../src/study/importer';

let core: AppCore;
let root: string;
let selection: DocumentPickerResponse;
let content: string;
let copiedPaths: string[];
const hash = jest.fn(async (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex'));

beforeEach(async () => {
  const db = openMemoryDb();
  await migrate(db);
  core = { db } as AppCore;
  root = mkdtempSync(join(tmpdir(), 'quantwise-picker-'));
  // Literal %20 must survive one URI decode; an app's container path can itself contain spaces.
  root = join(root, '中文 cache %20');
  mkdirSync(root);
  copiedPaths = [];
  content = '%PDF-1.7\nlocal test payload';
  selection = {
    uri: 'content://test.provider/document/primary%3ADownload%2Fbook.pdf', name: 'book.pdf',
    type: 'application/pdf', nativeType: 'application/pdf', size: content.length,
    error: null, isVirtual: false, convertibleToMimeTypes: null, hasRequestedType: true,
  };
  jest.mocked(pick).mockImplementation(async () => [selection]);
  // Match native FileOperations: each copy gets its own directory, and localUri is URL-encoded.
  jest.mocked(keepLocalCopy).mockImplementation(async options => {
    const dir = mkdtempSync(join(root, 'copy-'));
    const path = join(dir, options.files[0].fileName);
    writeFileSync(path, content);
    copiedPaths.push(path);
    return [{ status: 'success', sourceUri: options.files[0].uri, localUri: pathToFileURL(path).href }];
  });
  hash.mockClear();
  setImportDeps({ io: {
    ...deviceIo(), root: join(root, 'books'), sha256: hash,
    size: async path => statSync(path).size,
    readText: async path => readFileSync(path, 'utf8'),
    remove: async path => { rmSync(path); },
  } });
});
afterEach(async () => {
  await core.db.close();
  rmSync(join(root, '..'), { recursive: true, force: true });
  setImportDeps({ io: null });
  jest.mocked(pick).mockReset();
  jest.mocked(keepLocalCopy).mockReset();
});

test.each([
  '因子投资_方法与实践 -- Unknown -- db1a53aa884675758995101731322473 -- Anna’s Archive.pdf',
  '[量化] 打开量化投资的黑箱_pdf -- [量化] 打开量化投资的黑箱_pdf -- 94ccfdffded2bdf9998f4b5d529533ac -- Anna’s Archive (1).pdf',
  '收益 100% + #1 %20.PDF',
  '中文'.repeat(100) + '.pdf',
])('selected PDF %s can be hashed/read without changing its display name', async name => {
  selection.name = name;
  const result = await pickAndImport(core);
  expect(result).toEqual({ kind: 'pdf', path: copiedPaths[0], name, size: Buffer.byteLength(content) });
  expect(hash).toHaveBeenCalledWith(copiedPaths[0]);
  expect(keepLocalCopy).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.objectContaining({ uri: selection.uri })] }));
  expect(readFileSync(copiedPaths[0], 'utf8')).toBe(content);
});

test('two same-named selections keep separate local files before PDF upload confirmation', async () => {
  selection.name = '同名书.pdf';
  const first = await pickAndImport(core);
  content = '%PDF-1.7\nsecond book';
  const second = await pickAndImport(core);
  expect(first?.kind).toBe('pdf');
  expect(second?.kind).toBe('pdf');
  expect(copiedPaths[0]).not.toBe(copiedPaths[1]);
  expect(readFileSync(copiedPaths[0], 'utf8')).toBe('%PDF-1.7\nlocal test payload');
  expect(readFileSync(copiedPaths[1], 'utf8')).toBe(content);
});

test('Chinese Markdown imports retain the original filename and remove only the cached copy', async () => {
  selection.name = '收益 100% #1.md';
  content = '# Chapter 1 Return\n\nReal content.';
  const result = await pickAndImport(core);
  expect(result?.kind).toBe('done');
  if (result?.kind !== 'done') throw new Error('Expected an imported book');
  expect((await bookRepo.book(core.db, result.bookId))?.body.fileName).toBe(selection.name);
  expect((await bookRepo.sectionBlocks(core.db, result.bookId, '1'))[0].text).toBe('Real content.');
  expect(() => statSync(copiedPaths[0])).toThrow();
});
