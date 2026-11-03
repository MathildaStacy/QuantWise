import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { BookBlock } from '../../src/book/types';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { DEFAULT_READER, loadReaderPreferences, saveReaderPreferences } from '../../src/study/readerPreferences';
import { ReaderAppearance } from '../../src/ui/readerTypography';
import { BlockInline } from '../../src/ui/components/BookInline';
import { TranslatedBlock } from '../../src/ui/components/TranslatedBlock';

test('按段与逐句切换复用同一译文，原文空白和句序完整保留', async () => {
  const pairs = [{ source: 'First sentence.  ', translation: '第一句。' }, { source: '\nNext sentence.', translation: '第二句。' }];
  const b: BookBlock = { seq: 5, no: 2, sectionId: '1', type: 'p', text: pairs.map(p => p.source).join(''), page: 3, mark: null, html: null, image: null };
  let tree!: ReactTestRenderer;
  const render = (sentence: boolean) => <ReaderAppearance.Provider value={{ ...DEFAULT_READER, parallel: sentence ? 'sentence' : 'paragraph' }}><TranslatedBlock b={b} pairs={pairs} /></ReaderAppearance.Provider>;
  try {
    await act(async () => { tree = create(render(false)); });
    expect(tree.root.findAllByType(BlockInline).map(n => n.props.text)).toEqual([b.text, '第一句。第二句。']);
    await act(async () => { tree.update(render(true)); });
    expect(tree.root.findAllByType(BlockInline).map(n => n.props.text)).toEqual([pairs[0].source, '第一句。', pairs[1].source, '第二句。']);
    expect(pairs[0].source).toBe('First sentence.  ');
  } finally { await act(async () => { tree.unmount(); }); }
});

test('阅读外观跨书重开保留，并且不改写阅读位置和译文', async () => {
  const db = openMemoryDb();
  try {
    await migrate(db);
    expect(await loadReaderPreferences(db)).toEqual(DEFAULT_READER);
    const value = { ...DEFAULT_READER, size: 22 as const, leading: 'relaxed' as const, parallel: 'sentence' as const };
    await saveReaderPreferences(db, value);
    expect(await loadReaderPreferences(db)).toEqual(value);
    expect(await db.all('SELECT key FROM settings')).toEqual([{ key: 'readerAppearance' }]);
  } finally { await db.close(); }
});
