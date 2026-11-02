/**
 * 可选私有验收：读取 Pagewise 已有的真实 MinerU 结果，不上传、不复制书籍到仓库。
 * PAGEWISE_DOWNLOADS_FIXTURES=/path/to/downloads-20261102 npm test -- downloadsPrivate --runInBand
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { assemble } from '../../src/book/assemble';
import type { RawItem } from '../../src/book/types';
import {
  adaptContentList,
  findContentList,
  type PageHeader,
} from '../../src/study/import/mineruAdapter';
import { preparePdfItems } from '../../src/study/import/pdfStructure';

const base = process.env.PAGEWISE_DOWNLOADS_FIXTURES;
const run = base ? describe : describe.skip;
const cases: [string, number, number[]][] = [
  ['islp', 13, []],
  ['hands-on-ml', 19, [181, 326, 520, 594, 663, 784]],
  ['factor', 7, [164]],
  ['blackbox', 13, []],
  ['afml', 22, [114]],
  ['rates', 10, []],
];
run(
  'six full Downloads PDFs through QuantWise production adapter and assembly',
  () => {
    test.each(cases)(
      '%s retains notes, page gaps, chapters and unique block ownership',
      (short, count, gaps) => {
        const d = JSON.parse(
          readFileSync(path.join(base!, `${short}-result.json`), 'utf8'),
        ) as {
          book: { title: string; author?: string };
          parts: { part_no: number; page_from: number; page_to: number }[];
        };
        const items: RawItem[] = [],
          headers: PageHeader[] = [],
          warnings: string[] = [],
          retained: string[] = [];
        for (const part of d.parts) {
          const dir = path.join(base!, 'raw', short, `part-${part.part_no}`);
          const raw = JSON.parse(
            readFileSync(
              path.join(dir, findContentList(readdirSync(dir))!),
              'utf8',
            ),
          ) as { type: string; text?: string }[];
          retained.push(
            ...raw
              .filter(
                b =>
                  ['page_footnote', 'aside_text', 'ref_text'].includes(
                    b.type,
                  ) && b.text?.trim(),
              )
              .map(b => b.text!.trim()),
          );
          const a = adaptContentList(raw, {
            pageFrom: part.page_from,
            pageTo: part.page_to,
            imagePrefix: `part${part.part_no}/`,
          });
          items.push(...a.items);
          headers.push(...a.headers);
          warnings.push(...a.warnings);
        }
        const a = assemble({
          title: d.book.title,
          author: d.book.author ?? '',
          items: preparePdfItems(items, headers),
          warnings,
        });
        const texts = new Set(a.blocks.map(b => b.text));
        expect(retained.filter(t => !texts.has(t))).toEqual([]);
        expect(
          items
            .filter(b => b.kind === 'block' && b.sourcePage)
            .map(b => b.page),
        ).toEqual(gaps);
        const byId = new Map(a.sections.map(s => [s.id, s]));
        const chapters = a.sections.filter(
          s =>
            /^第 \d+ 章$/.test(s.no) &&
            (!s.parentId ||
              /^(?:Part |第.+部分)/i.test(byId.get(s.parentId)!.title)),
        );
        expect(chapters.map(s => Number(/\d+/.exec(s.no)![0]))).toEqual(
          Array.from({ length: count }, (_, i) => i + 1),
        );
        if (short === 'hands-on-ml' || short === 'afml') {
          expect(
            a.sections.filter(
              s => !s.parentId && /^(?:Part |第.+部分)/i.test(s.title),
            ),
          ).toHaveLength(short === 'hands-on-ml' ? 2 : 5);
        }
        const leaves = a.sections.filter(s => s.leaf);
        for (const block of a.blocks) {
          const owners = leaves.filter(
            s => block.seq >= s.blockFrom! && block.seq <= s.blockTo!,
          );
          expect(owners.map(s => s.id)).toEqual([block.sectionId]);
          expect(block.no).toBe(block.seq - owners[0].blockFrom! + 1);
        }
        if (short === 'factor')
          expect(a.blocks.filter(b => b.page! >= 500).length).toBeGreaterThan(
            100,
          );
        if (short === 'islp')
          expect(
            a.sections.find(
              s => s.title === 'Conceptual' && s.parentId === '13.7',
            ),
          ).toBeDefined();
      },
      30000,
    );
  },
);
