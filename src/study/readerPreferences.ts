/** Reading presentation is independent of the book text, translation cache and lecture settings. */
import type { Db } from '../data/db';
import { getSetting, setSetting } from '../data/repos';

export interface ReaderPreferences {
  size: 16 | 18 | 20 | 22;
  leading: 'normal' | 'relaxed';
  face: 'serif' | 'sans';
  /** 中文对照的排法：按段（原文后接中文）、逐句、中文为主（只显示译文，段旁「原文」展开英文）。 */
  parallel: 'paragraph' | 'sentence' | 'zh';
}

export const DEFAULT_READER: ReaderPreferences = {
  size: 18, leading: 'normal', face: 'serif', parallel: 'paragraph',
};

export async function loadReaderPreferences(db: Db): Promise<ReaderPreferences> {
  const saved = await getSetting<Partial<ReaderPreferences> | null>(db, 'readerAppearance', null);
  return {
    size: saved?.size && [16, 18, 20, 22].includes(saved.size) ? saved.size : DEFAULT_READER.size,
    leading: saved?.leading === 'relaxed' ? 'relaxed' : 'normal',
    face: saved?.face === 'sans' ? 'sans' : 'serif',
    parallel: saved?.parallel === 'sentence' || saved?.parallel === 'zh' ? saved.parallel : 'paragraph',
  };
}

export const saveReaderPreferences = (db: Db, value: ReaderPreferences) => setSetting(db, 'readerAppearance', value);
