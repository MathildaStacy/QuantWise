import type { Book } from '../../src/book/types';
import type { ImportIo } from '../../src/study/files';
import { sourcePageUri } from '../../src/study/sourcePage';

const book = { format: 'pdf', pages: 20, body: { dir: '/books/b' } } as Book;
const io = () => ({ exists: jest.fn(async () => false), mkdir: jest.fn(), renderPdfPage: jest.fn() });

test('原页用物理页码渲染本地 PDF，已缓存的原页不重新生成', async () => {
  const files = io();
  await expect(sourcePageUri(book, 15, files as unknown as ImportIo)).resolves.toBe('file:///books/b/source-pages/p15.png');
  expect(files.renderPdfPage).toHaveBeenCalledWith('/books/b/source.pdf', 15, '/books/b/source-pages/p15.png');
  files.exists.mockResolvedValue(true);
  files.renderPdfPage.mockClear();
  await sourcePageUri(book, 15, files as unknown as ImportIo);
  expect(files.renderPdfPage).not.toHaveBeenCalled();
});

test('错误页码不渲染；渲染失败不返回一个不存在的原页', async () => {
  const files = io();
  for (const page of [0, -1, 1.5, 21, NaN]) {
    await expect(sourcePageUri(book, page, files as unknown as ImportIo)).rejects.toThrow('页码超出范围');
  }
  expect(files.renderPdfPage).not.toHaveBeenCalled();
  files.renderPdfPage.mockRejectedValue(new Error('渲染失败'));
  await expect(sourcePageUri(book, 2, files as unknown as ImportIo)).rejects.toThrow('渲染失败');
});
