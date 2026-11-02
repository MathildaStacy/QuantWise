/**
 * 导入用到的文件操作（QUANTWISE_DESIGN.md §5、§10）：接口在这里，设备实现用 react-native-blob-util、
 * react-native-zip-archive 和 DocumentStore.pdfPageCount。测试换成内存实现。
 */
import BlobUtil from 'react-native-blob-util';
import { unzip } from 'react-native-zip-archive';
import DocumentStore from '../native/NativeDocumentStore';
import type { MineruFiles } from './import/mineru';

export interface ImportIo {
  /** 书目录的根（App 私有目录）。 */
  root: string;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  readText(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  /** 目录下全部文件（递归），相对 dir 的路径。 */
  list(dir: string): Promise<string[]>;
  unzip(zip: string, dest: string): Promise<void>;
  sha256(path: string): Promise<string>;
  size(path: string): Promise<number>;
  pdfPages(path: string): Promise<number>;
  renderPdfPage(path: string, page: number, destination: string): Promise<void>;
  mineru: MineruFiles;
}

const cancelled = () => Object.assign(new Error('已停止'), { name: 'AbortError' });

async function transfer(
  start: () => ReturnType<typeof BlobUtil.fetch>,
  o: { signal?: AbortSignal; onProgress?: (a: number, b: number) => void },
  upload: boolean,
): Promise<{ status: number }> {
  if (o.signal?.aborted) {
    throw cancelled();
  }
  const task = start();
  const abort = () => task.cancel();
  o.signal?.addEventListener('abort', abort);
  if (o.onProgress) {
    (upload ? task.uploadProgress : task.progress).call(task, { interval: 250 }, (a: number | string, b: number | string) => o.onProgress!(Number(a), Number(b)));
  }
  try {
    const res = await task;
    return { status: res.info().status };
  } catch (e) {
    if (o.signal?.aborted) {
      throw cancelled();
    }
    throw e;
  } finally {
    o.signal?.removeEventListener('abort', abort);
  }
}

const plainPath = (p: string) => p.replace(/^file:\/\//, '');

/** 设备实现（只在 App 里用；测试用 setImportIo 换掉）。 */
export function deviceIo(): ImportIo {
  const fs = BlobUtil.fs;
  const list = async (dir: string, prefix = ''): Promise<string[]> => {
    const out: string[] = [];
    for (const name of await fs.ls(dir)) {
      const full = dir + '/' + name;
      if (await fs.isDir(full)) {
        out.push(...(await list(full, prefix + name + '/')));
      } else {
        out.push(prefix + name);
      }
    }
    return out;
  };
  const mkdir = async (p: string) => {
    if (!(await fs.exists(p))) {
      await fs.mkdir(p);
    }
  };
  const remove = async (p: string) => {
    if (await fs.exists(p)) {
      await fs.unlink(p);
    }
  };
  return {
    root: fs.dirs.DocumentDir + '/books',
    mkdir,
    remove,
    copy: async (a, b) => {
      await remove(b);
      await fs.cp(plainPath(a), b);
    },
    readText: p => fs.readFile(plainPath(p), 'utf8'),
    exists: p => fs.exists(plainPath(p)),
    list,
    unzip: async (zip, dest) => {
      await mkdir(dest);
      await unzip(plainPath(zip), dest, 'UTF-8');
    },
    sha256: p => fs.hash(plainPath(p), 'sha256'),
    size: async p => Number((await fs.stat(plainPath(p))).size),
    pdfPages: async p => {
      if (!DocumentStore) {
        throw new Error('这台设备读不了 PDF 页数');
      }
      return DocumentStore.pdfPageCount(plainPath(p));
    },
    renderPdfPage: async (p, page, destination) => {
      if (!DocumentStore) throw new Error('这台设备不能渲染 PDF 原页');
      await DocumentStore.renderPdfPage(plainPath(p), page, plainPath(destination));
    },
    mineru: {
      put: (url, path, o) => transfer(() => BlobUtil.fetch('PUT', url, {}, BlobUtil.wrap(plainPath(path))), o, true),
      download: (url, dest, o) => transfer(() => BlobUtil.config({ path: dest }).fetch('GET', url, {}), o, false),
      unzip: async (zip, dest) => {
        await mkdir(dest);
        await unzip(zip, dest, 'UTF-8');
      },
      mkdir,
      remove,
    },
  };
}
