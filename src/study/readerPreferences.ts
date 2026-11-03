/** Reading presentation is independent of the book text, translation cache and lecture settings. */
import type { Db } from '../data/db';
import { getSetting, setSetting } from '../data/repos';

export interface ReaderPreferences {
  size: 16 | 18 | 20 | 22;
  leading: 'normal' | 'relaxed';
  face: 'serif' | 'sans';
  parallel: 'paragraph' | 'sentence';
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
    parallel: saved?.parallel === 'sentence' ? 'sentence' : 'paragraph',
  };
}

export const saveReaderPreferences = (db: Db, value: ReaderPreferences) => setSetting(db, 'readerAppearance', value);
