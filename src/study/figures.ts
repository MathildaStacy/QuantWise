import BlobUtil from 'react-native-blob-util';
import type { Book, BookBlock } from '../book/types';
import { parseFigure, type BookFigure } from '../book/figure';

export interface SavedFigure { version: 1; image: string; imageHash: string; caption: string; model: string; updatedAt: string; figure: BookFigure }
export interface FigureIo {
  exists(path: string): Promise<boolean>;
  read(path: string, encoding: 'utf8' | 'base64'): Promise<string>;
  write(path: string, text: string): Promise<void>;
  hash(path: string): Promise<string>;
  size(path: string): Promise<number>;
  mkdir(path: string): Promise<void>;
}
export const figureIo: FigureIo = {
  exists: p => BlobUtil.fs.exists(p),
  read: (p, encoding) => BlobUtil.fs.readFile(p, encoding),
  write: async (p, text) => { await BlobUtil.fs.writeFile(p, text, 'utf8'); },
  hash: p => BlobUtil.fs.hash(p, 'sha256'),
  size: async p => Number((await BlobUtil.fs.stat(p)).size),
  mkdir: async p => { if (!await BlobUtil.fs.exists(p)) await BlobUtil.fs.mkdir(p); },
};

export function canRedraw(b: BookBlock): boolean {
  return b.type === 'img' && !!b.image && !b.image.startsWith('source-pages/') &&
    !b.image.startsWith('/') && !/[\\:]/.test(b.image) && !b.image.split('/').includes('..') && /\.(png|jpe?g|webp)$/i.test(b.image);
}
export const figurePaths = (book: Pick<Book, 'body'>, b: BookBlock) => {
  if (!book.body.dir || !canRedraw(b)) throw new Error('这张图片暂不支持清晰重绘');
  return { image: book.body.dir + '/' + b.image, dir: book.body.dir + '/redrawn', cache: book.body.dir + '/redrawn/' + b.seq + '.json' };
};

export async function loadFigure(book: Pick<Book, 'body'>, b: BookBlock, io: FigureIo = figureIo): Promise<SavedFigure | null> {
  const p = figurePaths(book, b);
  if (!await io.exists(p.cache) || !await io.exists(p.image)) return null;
  let saved: SavedFigure;
  try {
    saved = JSON.parse(await io.read(p.cache, 'utf8'));
    if (saved.version !== 1 || saved.image !== b.image || saved.caption !== b.text || typeof saved.model !== 'string') return null;
    saved.figure = parseFigure(JSON.stringify(saved.figure));
  } catch { return null; }
  return saved.imageHash === await io.hash(p.image) ? saved : null;
}
