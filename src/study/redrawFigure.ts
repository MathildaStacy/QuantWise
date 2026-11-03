import { aiKeys, aiTransport } from '../ai/chat';
import { AiError, callModel } from '../ai/http';
import type { AppCore } from '../app/boot';
import type { Book, BookBlock, BookSection } from '../book/types';
import { parseFigure } from '../book/figure';
import { beijingIso } from '../market/clock';
import { sectionStudyService } from './config';
import { figureRequest } from './figureRequest';
import { figureIo, figurePaths, loadFigure, type FigureIo, type SavedFigure } from './figures';

export async function redrawFigure(core: AppCore, book: Book, section: BookSection, b: BookBlock, blocks: BookBlock[], signal: AbortSignal,
  io: FigureIo = figureIo, force = false): Promise<SavedFigure> {
  const stopped = () => { if (signal.aborted) throw new AiError('cancelled', '已停止重绘'); };
  stopped();
  const p = figurePaths(book, b);
  if (!force) { const cached = await loadFigure(book, b, io); stopped(); if (cached) return cached; }
  const service = await sectionStudyService(core.db, book.id, section.id);
  if (!service) throw new AiError('auth', '请先在「供应商与模型」启用一个支持图片的 AI 模型');
  const key = await aiKeys().get(service.id);
  if (!key) throw new AiError('auth', '「' + service.name + '」还没有保存 API Key');
  if (!await io.exists(p.image)) throw new Error('原图文件不存在，请重新导入书籍');
  if (await io.size(p.image) > 8 * 1024 * 1024) throw new Error('这张原图超过 8 MB，暂不支持重绘');
  const imageHash = await io.hash(p.image);
  const base64 = await io.read(p.image, 'base64');
  stopped();
  const index = blocks.findIndex(x => x.seq === b.seq);
  const context = JSON.stringify({ book: book.title, section: section.title, caption: b.text,
    nearby: index < 0 ? [] : blocks.slice(Math.max(0, index - 2), index + 3).filter(x => x.seq !== b.seq).map(x => x.text.slice(0, 2000)) });
  const mime = /\.png$/i.test(b.image!) ? 'image/png' : /\.webp$/i.test(b.image!) ? 'image/webp' : 'image/jpeg';
  const { parsed } = await callModel(service, key, figureRequest(service, { base64, mime }, context), { signal, fetchImpl: aiTransport() });
  stopped();
  const figure = parseFigure(parsed.parts.filter(x => x.t === 'text').map(x => x.text).join(''));
  const result: SavedFigure = { version: 1, image: b.image!, imageHash, caption: b.text, figure, model: service.model, updatedAt: beijingIso() };
  if (!await io.exists(p.image) || await io.hash(p.image) !== imageHash) throw new Error('原图已更新，请重新打开本节');
  stopped();
  await io.mkdir(p.dir);
  await io.write(p.cache, JSON.stringify(result));
  return result;
}
