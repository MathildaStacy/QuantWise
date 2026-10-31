/**
 * MinerU 精准解析 API（QUANTWISE_DESIGN.md §5）：申请上传地址 → PUT 上传 → 轮询 → 下载结果包并解压。
 * 网络请求和文件读写从外面注入（MineruRequest / MineruFiles），这里只管协议、超时、取消和错误码。
 * 错误里只放错误码和一句中文，不放响应原文：服务端的报错偶尔会把请求头（Token）原样带回来。
 */

export const MINERU_API_BASE = 'https://mineru.net/api/v4';
/** 官方单文件上限（2026-11 核对）：200 页、200 MB；一次最多申请 50 个上传地址。 */
export const MINERU_MAX_PAGES = 200;
export const MINERU_MAX_BYTES = 200_000_000;
export const MINERU_MAX_FILES = 50;

export type MineruModel = 'vlm' | 'pipeline';
export type MineruState =
  | 'waiting-file'
  | 'pending'
  | 'running'
  | 'converting'
  | 'done'
  | 'failed';
export type MineruErrorKind =
  | 'auth'
  | 'too_large'
  | 'queue_full'
  | 'daily_limit'
  | 'invalid_file'
  | 'service'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'protocol';

const SETTINGS = '「我的 → 解析服务（MinerU）」';

/** 官方错误码 → 类别；没列出的（-60007 模型不可用、-60010 解析失败、-10001 服务异常等）都算 service。 */
const KINDS = new Map<string, MineruErrorKind>([
  ['A0202', 'auth'],
  ['A0211', 'auth'],
  ['missing_token', 'auth'],
  ['-60005', 'too_large'],
  ['-60006', 'too_large'],
  ['-60009', 'queue_full'],
  ['-60018', 'daily_limit'],
  // 文件本身的问题：格式认不出、读不了、空文件、没找到上传的文件、转换 / 拆分失败、读不出页数
  ['-60002', 'invalid_file'],
  ['-60003', 'invalid_file'],
  ['-60004', 'invalid_file'],
  ['-60011', 'invalid_file'],
  ['-60015', 'invalid_file'],
  ['-60020', 'invalid_file'],
  ['-60021', 'invalid_file'],
  // 本地产生的
  ['network', 'network'],
  ['timeout', 'timeout'],
  ['cancelled', 'cancelled'],
  ['protocol', 'protocol'],
  ['bad_request', 'protocol'],
]);

export const mineruErrorKind = (code: string): MineruErrorKind =>
  KINDS.get(code) ?? 'service';

const KIND_MESSAGES: Record<MineruErrorKind, string> = {
  auth: 'MinerU Token 不对，请在' + SETTINGS + '更新',
  too_large: '文件超过 MinerU 的限制（单个文件 200 MB、每次 200 页）',
  queue_full: 'MinerU 提交队列已满，过一分钟再试',
  daily_limit: '今天的 MinerU 解析任务数已到上限，明天再继续',
  invalid_file: 'MinerU 读不了这个文件，请确认它是完好的 PDF',
  service: 'MinerU 服务暂时不可用，请稍后重试',
  network: '连不上 MinerU，请检查网络后重试',
  timeout: 'MinerU 长时间没有响应，请稍后重试',
  cancelled: '已停止',
  protocol: 'MinerU 返回了无法读取的结果，请重试',
};

const CODE_MESSAGES = new Map<string, string>([
  ['missing_token', '请先在' + SETTINGS + '填写 MinerU Token'],
  ['A0211', 'MinerU Token 已过期，请在' + SETTINGS + '更新'],
  ['-60005', '文件超过 200 MB，MinerU 不接收'],
  ['-60006', '页数超过 MinerU 每次 200 页的限制，需要分成更小的片'],
  ['-60010', 'MinerU 没能解析这部分；扫描版 PDF 可以打开 OCR 再试'],
  ['-60012', 'MinerU 找不到这个解析任务（可能已过期），需要重新上传'],
  ['-60013', '这个解析任务不属于当前 Token 的账号，需要重新上传'],
  ['bad_request', '解析请求的参数不对（文件数、data_id、页码范围或模型）'],
]);

/** 只有长得像官方错误码的才写进文字，方便用户反馈；其余一律不带。 */
const OFFICIAL_CODE = /^(?:-?\d{1,6}|A\d{4})$/;

function messageOf(code: string, kind: MineruErrorKind, status?: number) {
  const fixed = CODE_MESSAGES.get(code);
  if (fixed) {
    return fixed;
  }
  const http = status ? '（HTTP ' + status + '）' : '';
  if (code.startsWith('upload_')) {
    return '上传文件失败' + http + '，上传地址可能已过期，请重试';
  }
  if (code.startsWith('download_')) {
    return '下载解析结果失败' + http + '，结果链接可能已过期，请重试';
  }
  if (code.startsWith('http_')) {
    return 'MinerU 服务暂时不可用' + http + '，请稍后重试';
  }
  if (kind === 'service' && OFFICIAL_CODE.test(code)) {
    return KIND_MESSAGES.service + '（错误码 ' + code + '）';
  }
  return KIND_MESSAGES[kind];
}

export class MineruError extends Error {
  readonly kind: MineruErrorKind;
  constructor(readonly code: string, readonly status?: number) {
    const kind = mineruErrorKind(code);
    super(messageOf(code, kind, status));
    this.name = 'MineruError';
    this.kind = kind;
  }
}

export interface MineruFiles {
  /** 把本地文件 PUT 到签名地址：不带 Content-Type（官方要求），也不带 Token。 */
  put(
    url: string,
    path: string,
    o: {
      signal?: AbortSignal;
      onProgress?: (sent: number, total: number) => void;
    },
  ): Promise<{ status: number }>;
  download(
    url: string,
    dest: string,
    o: {
      signal?: AbortSignal;
      onProgress?: (got: number, total: number) => void;
    },
  ): Promise<{ status: number }>;
  unzip(zip: string, destDir: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export type MineruRequest = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface MineruUploadFile {
  name: string;
  /** 字母、数字、_ - .，最长 128 个字符（官方限制）。 */
  dataId: string;
  ocr: boolean;
  /** 例如「1-200」；不填就是整个文件。 */
  pageRanges?: string;
}

export interface MineruResult {
  fileName: string;
  dataId?: string;
  state: MineruState;
  /** 只在 running 时有意义；总页数还是 0 时不给。 */
  progress?: { extractedPages: number; totalPages: number };
  zipUrl?: string;
  error?: MineruError;
}

export interface MineruClient {
  requestUpload(
    files: MineruUploadFile[],
    model: MineruModel,
    signal?: AbortSignal,
  ): Promise<{ batchId: string; urls: string[] }>;
  upload(
    url: string,
    path: string,
    onProgress?: (sent: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  query(batchId: string, signal?: AbortSignal): Promise<MineruResult[]>;
  download(
    zipUrl: string,
    destDir: string,
    onProgress?: (got: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<string>;
  test(
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; latencyMs: number; error?: MineruError }>;
}

export interface MineruClientOptions {
  getToken(): Promise<string | null>;
  files: MineruFiles;
  request?: MineruRequest;
  baseUrl?: string;
  /** 单次 API 请求的总时限，默认 45 秒。 */
  timeoutMs?: number;
  /** 上传 / 下载多久没有进度算超时，默认 10 分钟（不报进度的实现就等于总时限）。 */
  transferTimeoutMs?: number;
  now?(): number;
}

export interface PartPlan {
  partNo: number;
  pageFrom: number;
  pageTo: number;
}

/**
 * 把 pages 页的书按 ≤ max 页切片（页码从 1 开始，含两端）。片的边界只由页数决定，
 * App 被杀后重新规划得到同样的片号和页码范围，book_part 里的记录还能对上。
 */
export function planParts(
  pages: number,
  max: number = MINERU_MAX_PAGES,
): PartPlan[] {
  if (!Number.isSafeInteger(pages) || pages < 1) {
    throw new RangeError('页数必须是正整数：' + pages);
  }
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new RangeError('每片页数必须是正整数：' + max);
  }
  const parts: PartPlan[] = [];
  for (let from = 1; from <= pages; from += max) {
    parts.push({
      partNo: parts.length + 1,
      pageFrom: from,
      pageTo: Math.min(from + max - 1, pages),
    });
  }
  return parts;
}

/** MinerU 的 page_ranges 写法：「1-200」。 */
export const pageRanges = (p: PartPlan): string => p.pageFrom + '-' + p.pageTo;

type Json = Record<string, unknown>;
const object = (v: unknown): Json | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const count = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0
    ? Math.floor(v)
    : undefined;
const ok = (status: number) => status >= 200 && status < 300;

const STATES = new Set<string>([
  'waiting-file',
  'pending',
  'running',
  'converting',
  'done',
  'failed',
]);
/** data_id 的官方字符集；page_ranges 只认数字、逗号和减号（「1-200」「2,4-6」「2--2」）。 */
const DATA_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const PAGE_RANGES = /^\d+(?:-{1,2}\d+)?(?:,\d+(?:-{1,2}\d+)?)*$/;
/** 查一个不存在的批次：Token 有效时官方回 HTTP 200 + -60012（任务不存在），无效时回 A0202 / A0211。 */
const PROBE_BATCH = '00000000-0000-4000-8000-000000000000';

/** 业务码也来自响应：不像官方错误码的一律换掉，免得把服务端回显的内容带出去。 */
const safeCode = (v: unknown): string => {
  const s = String(v);
  return /^(?:-?\d{1,6}|[A-Z]\d{4})$/.test(s) ? s : 'unknown';
};

const badFile = (f: MineruUploadFile) =>
  !f.name.trim() ||
  !DATA_ID.test(f.dataId) ||
  typeof f.ocr !== 'boolean' ||
  (f.pageRanges !== undefined && !PAGE_RANGES.test(f.pageRanges));

/** API 的 401 / 403 是 Token 问题；签名地址（上传 / 下载）没有 Token，403 多半是地址过期。 */
const apiHttpError = (status: number) =>
  new MineruError(
    status === 401 || status === 403
      ? 'A0202'
      : status === 408 || status === 504
      ? 'timeout'
      : 'http_' + status,
    status,
  );
const transferError = (prefix: 'upload' | 'download', status: number) =>
  new MineruError(
    status === 408 || status === 504 ? 'timeout' : prefix + '_' + status,
    status,
  );

/**
 * 给一次网络操作加上取消和超时。用 Promise.race：底层不理 signal 时也能按时返回。
 * touch() 重新计时：上传 / 下载每收到一次进度就调用，慢网络传大文件不会被总时限截断。
 */
async function guarded<T>(
  signal: AbortSignal | undefined,
  ms: number,
  task: (active: AbortSignal, touch: () => void) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) {
    throw new MineruError('cancelled');
  }
  const ctl = new AbortController();
  let timedOut = false;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopError = () => new MineruError(timedOut ? 'timeout' : 'cancelled');
  const touch = () => {
    clearTimeout(timer);
    if (!finished) {
      timer = setTimeout(() => {
        timedOut = true;
        ctl.abort();
      }, ms);
    }
  };
  const forward = () => ctl.abort();
  let onStop = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    onStop = () => reject(stopError());
    ctl.signal.addEventListener('abort', onStop);
  });
  signal?.addEventListener('abort', forward);
  touch();
  try {
    return await Promise.race([task(ctl.signal, touch), stopped]);
  } catch (e) {
    if (ctl.signal.aborted) {
      throw stopError();
    }
    throw e instanceof MineruError ? e : new MineruError('network');
  } finally {
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
    ctl.signal.removeEventListener('abort', onStop);
  }
}

/** 先看业务码（MinerU 出错时 HTTP 也可能是 200），再看 HTTP 状态，最后检查 data 的形状。 */
function readEnvelope(status: number, body: string): Json {
  let json: Json | null = null;
  try {
    json = object(JSON.parse(body));
  } catch {
    // 网关出错时常常回 HTML，按状态码处理
  }
  const code = json?.code ?? null;
  if (code !== null && String(code) !== '0') {
    throw new MineruError(safeCode(code), status);
  }
  if (!ok(status)) {
    throw apiHttpError(status);
  }
  const data = object(json?.data);
  if (code === null || !data) {
    throw new MineruError('protocol', status);
  }
  return data;
}

/** 失败行可能带 err_code / code，也可能只在 err_msg 里写了错误码；都没有就按「解析失败」。 */
function failureCode(row: Json): string {
  const code = row.err_code ?? row.code ?? null;
  if (code !== null && String(code) !== '0') {
    return safeCode(code);
  }
  return (
    /A0202|A0211|-600\d{2}|-1000\d/.exec(str(row.err_msg))?.[0] ?? '-60010'
  );
}

/** err_msg 是服务端原文，只从里面认错误码，不放进 MineruResult。 */
function readResult(value: unknown): MineruResult {
  const row = object(value);
  const state = str(row?.state);
  const fileName = str(row?.file_name);
  const zipUrl = str(row?.full_zip_url);
  if (
    !row ||
    !STATES.has(state) ||
    !fileName ||
    (state === 'done' && !zipUrl)
  ) {
    throw new MineruError('protocol');
  }
  const progress = object(row.extract_progress);
  const extracted = count(progress?.extracted_pages);
  const total = count(progress?.total_pages);
  const dataId = str(row.data_id);
  return {
    fileName,
    ...(dataId ? { dataId } : {}),
    state: state as MineruState,
    ...(extracted !== undefined && total
      ? {
          progress: {
            extractedPages: Math.min(extracted, total),
            totalPages: total,
          },
        }
      : {}),
    ...(zipUrl ? { zipUrl } : {}),
    ...(state === 'failed' ? { error: new MineruError(failureCode(row)) } : {}),
  };
}

const defaultRequest: MineruRequest = (url, init) =>
  fetch(url, init as RequestInit);

export function createMineruClient(o: MineruClientOptions): MineruClient {
  const request = o.request ?? defaultRequest;
  const base = (o.baseUrl ?? MINERU_API_BASE).replace(/\/+$/, '');
  const now = o.now ?? Date.now;
  const timeoutMs = o.timeoutMs ?? 45_000;
  const transferMs = o.transferTimeoutMs ?? 600_000;

  /** 每次调用都重新取 Token：设置里换了 Token 马上生效，JS 里也不长期留副本。 */
  const api = (
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ) =>
    guarded(signal, timeoutMs, async active => {
      const token = (await o.getToken().catch(() => null))?.trim();
      if (active.aborted) {
        throw new MineruError('cancelled');
      }
      if (!token) {
        throw new MineruError('missing_token');
      }
      const res = await request(base + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: active,
      });
      return readEnvelope(res.status, await res.text());
    });

  const transfer = (
    onProgress: ((done: number, total: number) => void) | undefined,
    touch: () => void,
  ) => {
    return (done: number, total: number) => {
      touch();
      onProgress?.(done, total);
    };
  };

  return {
    async requestUpload(files, model, signal) {
      if (
        !files.length ||
        files.length > MINERU_MAX_FILES ||
        files.some(badFile) ||
        (model !== 'vlm' && model !== 'pipeline')
      ) {
        throw new MineruError('bad_request');
      }
      const data = await api(
        'POST',
        '/file-urls/batch',
        {
          files: files.map(f => ({
            name: f.name,
            data_id: f.dataId,
            is_ocr: f.ocr,
            ...(f.pageRanges ? { page_ranges: f.pageRanges } : {}),
          })),
          model_version: model,
          enable_formula: true,
          enable_table: true,
          language: 'ch',
        },
        signal,
      );
      const batchId = str(data.batch_id);
      const urls = data.file_urls;
      // 上传地址按下标和 files 一一对应
      if (
        !batchId ||
        !Array.isArray(urls) ||
        urls.length !== files.length ||
        !urls.every(u => str(u))
      ) {
        throw new MineruError('protocol');
      }
      return { batchId, urls: urls as string[] };
    },

    async upload(url, path, onProgress, signal) {
      if (!url || !path) {
        throw new MineruError('bad_request');
      }
      await guarded(signal, transferMs, async (active, touch) => {
        const res = await o.files.put(url, path, {
          signal: active,
          onProgress: transfer(onProgress, touch),
        });
        if (!ok(res.status)) {
          throw transferError('upload', res.status);
        }
      });
    },

    async query(batchId, signal) {
      const id = batchId.trim();
      if (!id) {
        throw new MineruError('bad_request');
      }
      const data = await api(
        'GET',
        '/extract-results/batch/' + encodeURIComponent(id),
        undefined,
        signal,
      );
      if (!Array.isArray(data.extract_result)) {
        throw new MineruError('protocol');
      }
      return data.extract_result.map(readResult);
    },

    async download(zipUrl, destDir, onProgress, signal) {
      const zip = destDir.replace(/\/+$/, '') + '.zip';
      try {
        await guarded(signal, transferMs, async (active, touch) => {
          await o.files.mkdir(destDir);
          if (active.aborted) {
            throw new MineruError('cancelled');
          }
          const res = await o.files.download(zipUrl, zip, {
            signal: active,
            onProgress: transfer(onProgress, touch),
          });
          if (!ok(res.status)) {
            throw transferError('download', res.status);
          }
          if (active.aborted) {
            throw new MineruError('cancelled');
          }
          touch();
          try {
            await o.files.unzip(zip, destDir);
          } catch {
            throw new MineruError('protocol');
          }
        });
        return destDir;
      } finally {
        // 结果包只是中转：成功、失败、取消都删掉；解压出来的目录留给导入
        try {
          await o.files.remove(zip);
        } catch {
          // 删不掉也不影响结果
        }
      }
    },

    async test(signal) {
      const start = now();
      const latency = () => Math.max(0, now() - start);
      try {
        await api(
          'GET',
          '/extract-results/batch/' + PROBE_BATCH,
          undefined,
          signal,
        );
        return { ok: true, latencyMs: latency() };
      } catch (e) {
        const error = e instanceof MineruError ? e : new MineruError('network');
        if (error.code === '-60012' && error.status === 200) {
          return { ok: true, latencyMs: latency() };
        }
        return { ok: false, latencyMs: latency(), error };
      }
    },
  };
}
