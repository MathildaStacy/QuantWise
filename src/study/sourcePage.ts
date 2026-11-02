import type { Book } from '../book/types';
import { importIo } from './importer';
import type { ImportIo } from './files';

/** 物理页码从 1 开始；只读取本地源 PDF，已有原页 PNG 可直接复用。 */
export async function sourcePageUri(book: Pick<Book, 'format' | 'pages' | 'body'>, page: number, io: ImportIo = importIo()): Promise<string> {
  const dir = book.body.dir;
  if (book.format !== 'pdf' || !dir || !Number.isInteger(page) || page < 1 || (book.pages != null && page > book.pages)) {
    throw new Error('PDF 页码超出范围');
  }
  const image = dir + '/source-pages/p' + page + '.png';
  if (!(await io.exists(image))) {
    await io.mkdir(dir + '/source-pages');
    await io.renderPdfPage(dir + '/source.pdf', page, image);
  }
  return 'file://' + image;
}
