/**
 * MinerU 客户端（请求形状、轮询状态、错误码、超时 / 取消、结果包清理）、分片规划和 content_list 适配。
 * 网络和文件都是假的；Token 和响应原文里的「机密」字样不能出现在任何错误文字里。
 */
import {
  createMineruClient,
  MineruError,
  pageRanges,
  planParts,
  type MineruFiles,
  type MineruRequest,
} from '../../src/study/import/mineru';
import {
  adaptContentList,
  findContentList,
  mergeParts,
} from '../../src/study/import/mineruAdapter';

const SECRET = 'fixture-secret-token';

/** MinerU 风格的响应；msg 故意回显 Token，检查它不会漏进错误。 */
const reply = (
  data: unknown = {},
  code: string | number = 0,
  status = 200,
) => ({
  status,
  text: async () => JSON.stringify({ code, msg: 'echo ' + SECRET, data }),
});

type Req = jest.Mock<ReturnType<MineruRequest>, Parameters<MineruRequest>>;
const fakeRequest = (fn: MineruRequest): Req => jest.fn(fn);

function fakeFiles() {
  return {
    put: jest.fn<
      ReturnType<MineruFiles['put']>,
      Parameters<MineruFiles['put']>
    >(async (_url, _path, o) => {
      o.onProgress?.(40, 100);
      o.onProgress?.(100, 100);
      return { status: 200 };
    }),
    download: jest.fn<
      ReturnType<MineruFiles['download']>,
      Parameters<MineruFiles['download']>
    >(async (_url, _dest, o) => {
      o.onProgress?.(100, 100);
      return { status: 200 };
    }),
    unzip: jest.fn<Promise<void>, [string, string]>(async () => undefined),
    mkdir: jest.fn<Promise<void>, [string]>(async () => undefined),
    remove: jest.fn<Promise<void>, [string]>(async () => undefined),
  };
}

const client = (request: MineruRequest, extra: object = {}) =>
  createMineruClient({
    getToken: async () => SECRET,
    files: fakeFiles(),
    request,
    ...extra,
  });

const noLeak = (e: unknown) => {
  expect(String((e as Error).message)).not.toContain(SECRET);
  expect(String((e as Error).message)).not.toContain('echo');
};

describe('planParts / pageRanges', () => {
  it('splits into ≤ 200-page parts, 1-based and inclusive', () => {
    expect(planParts(1)).toEqual([{ partNo: 1, pageFrom: 1, pageTo: 1 }]);
    expect(planParts(200)).toEqual([{ partNo: 1, pageFrom: 1, pageTo: 200 }]);
    expect(planParts(201)).toEqual([
      { partNo: 1, pageFrom: 1, pageTo: 200 },
      { partNo: 2, pageFrom: 201, pageTo: 201 },
    ]);
    const big = planParts(418);
    expect(big).toEqual([
      { partNo: 1, pageFrom: 1, pageTo: 200 },
      { partNo: 2, pageFrom: 201, pageTo: 400 },
      { partNo: 3, pageFrom: 401, pageTo: 418 },
    ]);
    expect(big.map(pageRanges)).toEqual(['1-200', '201-400', '401-418']);
  });

  it('honours a custom max and rejects bad counts', () => {
    expect(planParts(5, 2).map(pageRanges)).toEqual(['1-2', '3-4', '5-5']);
    for (const bad of [0, -3, 1.5, NaN]) {
      expect(() => planParts(bad)).toThrow(RangeError);
    }
    expect(() => planParts(10, 0)).toThrow(RangeError);
  });
});

describe('MinerU client: upload request and transfer', () => {
  const parts = planParts(418).map(p => ({
    name: 'book.pdf',
    dataId: 'book-1.p' + p.partNo,
    ocr: false,
    pageRanges: pageRanges(p),
  }));

  it('posts one entry per part with page_ranges and data_id, URLs matched by index', async () => {
    let token = SECRET;
    const getToken = jest.fn(async () => token);
    const request = fakeRequest(async url =>
      url.endsWith('/file-urls/batch')
        ? reply({ batch_id: 'b-1', file_urls: ['u1', 'u2', 'u3'] })
        : reply({ extract_result: [] }),
    );
    const c = createMineruClient({ getToken, files: fakeFiles(), request });
    expect(await c.requestUpload(parts, 'vlm')).toEqual({
      batchId: 'b-1',
      urls: ['u1', 'u2', 'u3'],
    });
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://mineru.net/api/v4/file-urls/batch');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer ' + SECRET);
    expect(JSON.parse(init.body!)).toEqual({
      files: [
        {
          name: 'book.pdf',
          data_id: 'book-1.p1',
          is_ocr: false,
          page_ranges: '1-200',
        },
        {
          name: 'book.pdf',
          data_id: 'book-1.p2',
          is_ocr: false,
          page_ranges: '201-400',
        },
        {
          name: 'book.pdf',
          data_id: 'book-1.p3',
          is_ocr: false,
          page_ranges: '401-418',
        },
      ],
      model_version: 'vlm',
      enable_formula: true,
      enable_table: true,
      language: 'ch',
    });
    // Token 每次重新取
    token = 'fixture-new-token';
    await c.query('batch /1');
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toBe(
      'https://mineru.net/api/v4/extract-results/batch/batch%20%2F1',
    );
    expect(request.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer fixture-new-token',
    );
    expect(request.mock.calls[1][1].body).toBeUndefined();
  });

  it('omits page_ranges when not given and rejects bad input before any IO', async () => {
    const request = fakeRequest(async () =>
      reply({ batch_id: 'b', file_urls: ['u'] }),
    );
    const c = client(request);
    await c.requestUpload(
      [{ name: 'a.pdf', dataId: 'a', ocr: true }],
      'pipeline',
    );
    expect(JSON.parse(request.mock.calls[0][1].body!).files).toEqual([
      { name: 'a.pdf', data_id: 'a', is_ocr: true },
    ]);
    request.mockClear();
    const file = { name: 'a.pdf', dataId: 'a', ocr: false };
    for (const files of [
      [],
      Array.from({ length: 51 }, () => file),
      [{ ...file, dataId: 'book:1' }],
      [{ ...file, dataId: 'x'.repeat(129) }],
      [{ ...file, name: ' ' }],
      [{ ...file, pageRanges: '1-200; drop' }],
    ]) {
      await expect(c.requestUpload(files, 'vlm')).rejects.toMatchObject({
        code: 'bad_request',
        kind: 'protocol',
      });
    }
    await expect(
      c.requestUpload([file], 'other' as never),
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a URL list that does not match the files', async () => {
    const c = client(async () =>
      reply({ batch_id: 'b', file_urls: ['only-one'] }),
    );
    await expect(c.requestUpload(parts, 'vlm')).rejects.toMatchObject({
      code: 'protocol',
    });
  });

  it('asks for a token before any network IO', async () => {
    const request = fakeRequest(async () => reply({}));
    for (const getToken of [
      async () => null,
      async () => '  ',
      async () => {
        throw new Error('keystore ' + SECRET);
      },
    ]) {
      const c = createMineruClient({ getToken, files: fakeFiles(), request });
      const e = await c.query('b').catch(x => x);
      expect(e).toMatchObject({ code: 'missing_token', kind: 'auth' });
      expect(e.message).toContain('「我的 → 解析服务（MinerU）」');
      noLeak(e);
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('PUTs the file with progress, without a token, and maps upload status errors', async () => {
    const files = fakeFiles();
    const getToken = jest.fn(async () => SECRET);
    const c = createMineruClient({ getToken, files });
    const progress = jest.fn();
    await c.upload('https://oss.test/put', '/books/a.pdf', progress);
    expect(files.put).toHaveBeenCalledWith(
      'https://oss.test/put',
      '/books/a.pdf',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(progress).toHaveBeenLastCalledWith(100, 100);
    expect(getToken).not.toHaveBeenCalled();
    // 签名地址的 403 不是 Token 问题
    files.put.mockResolvedValueOnce({ status: 403 });
    const e = await c.upload('u', 'p').catch(x => x);
    expect(e).toBeInstanceOf(MineruError);
    expect(e).toMatchObject({
      code: 'upload_403',
      kind: 'service',
      status: 403,
    });
    expect(e.message).toContain('上传');
    files.put.mockResolvedValueOnce({ status: 504 });
    await expect(c.upload('u', 'p')).rejects.toMatchObject({ kind: 'timeout' });
    files.put.mockRejectedValueOnce(new Error('socket closed ' + SECRET));
    const net = await c.upload('u', 'p').catch(x => x);
    expect(net).toMatchObject({ kind: 'network' });
    noLeak(net);
  });
});

describe('MinerU client: polling', () => {
  it('reads every state, page progress and the zip URL', async () => {
    const c = client(async () =>
      reply({
        extract_result: [
          { file_name: 'a.pdf', data_id: 'p1', state: 'waiting-file' },
          {
            file_name: 'a.pdf',
            data_id: 'p2',
            state: 'pending',
            extract_progress: { extracted_pages: 0, total_pages: 0 },
          },
          {
            file_name: 'a.pdf',
            data_id: 'p3',
            state: 'running',
            extract_progress: {
              extracted_pages: 37,
              total_pages: 200,
              start_time: '2026-11-02 10:00:00',
            },
          },
          { file_name: 'a.pdf', state: 'converting' },
          {
            file_name: 'a.pdf',
            data_id: 'p5',
            state: 'done',
            full_zip_url: 'https://cdn.test/r.zip',
          },
        ],
      }),
    );
    const rows = await c.query('b');
    expect(rows.map(r => r.state)).toEqual([
      'waiting-file',
      'pending',
      'running',
      'converting',
      'done',
    ]);
    expect(rows[0]).toEqual({
      fileName: 'a.pdf',
      dataId: 'p1',
      state: 'waiting-file',
    });
    expect(rows[1].progress).toBeUndefined();
    expect(rows[2].progress).toEqual({ extractedPages: 37, totalPages: 200 });
    expect(rows[3].dataId).toBeUndefined();
    expect(rows[4]).toMatchObject({
      dataId: 'p5',
      zipUrl: 'https://cdn.test/r.zip',
    });
  });

  it('turns a failed state into a MineruError without the server text', async () => {
    const c = client(async () =>
      reply({
        extract_result: [
          {
            file_name: 'a',
            state: 'failed',
            err_code: -60005,
            err_msg: 'too big ' + SECRET,
          },
          {
            file_name: 'b',
            state: 'failed',
            err_msg: 'A0211 token expired ' + SECRET,
          },
          {
            file_name: 'c',
            state: 'failed',
            err_msg: '每日解析任务数量已达上限 -60018',
          },
          {
            file_name: 'd',
            state: 'failed',
            err_msg: 'something odd ' + SECRET,
          },
        ],
      }),
    );
    const rows = await c.query('b');
    expect(rows[0].error).toMatchObject({ code: '-60005', kind: 'too_large' });
    expect(rows[1].error).toMatchObject({ code: 'A0211', kind: 'auth' });
    expect(rows[1].error!.message).toContain('过期');
    expect(rows[2].error).toMatchObject({
      code: '-60018',
      kind: 'daily_limit',
    });
    expect(rows[3].error).toMatchObject({ code: '-60010', kind: 'service' });
    rows.forEach(r => noLeak(r.error));
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });

  it('treats malformed rows as protocol errors', async () => {
    for (const data of [
      { extract_result: [{ file_name: 'a', state: 'done' }] },
      { extract_result: [{ file_name: 'a', state: 'exploded' }] },
      { extract_result: [{ state: 'running' }] },
      { extract_result: 'nope' },
    ]) {
      await expect(
        client(async () => reply(data)).query('b'),
      ).rejects.toMatchObject({
        code: 'protocol',
      });
    }
    await expect(client(async () => reply()).query('  ')).rejects.toMatchObject(
      {
        code: 'bad_request',
      },
    );
  });
});

describe('MinerU client: errors', () => {
  it.each([
    ['A0202', 'auth'],
    ['A0211', 'auth'],
    ['-60005', 'too_large'],
    ['-60006', 'too_large'],
    ['-60009', 'queue_full'],
    ['-60018', 'daily_limit'],
    ...[
      '-60002',
      '-60003',
      '-60004',
      '-60011',
      '-60015',
      '-60020',
      '-60021',
    ].map(c => [c, 'invalid_file']),
    ...['-60007', '-60008', '-60010', '-60012', '-10001', '-500'].map(c => [
      c,
      'service',
    ]),
  ])('maps business code %s to %s', async (code, kind) => {
    const e = await client(async () => reply({}, code))
      .query('b')
      .catch(x => x);
    expect(e).toBeInstanceOf(MineruError);
    expect(e).toMatchObject({ code, kind });
    noLeak(e);
  });

  it('writes Chinese messages that point at the settings page', async () => {
    const expired = await client(async () => reply({}, 'A0211'))
      .query('b')
      .catch(x => x);
    expect(expired.message).toBe(
      'MinerU Token 已过期，请在「我的 → 解析服务（MinerU）」更新',
    );
    const wrong = await client(async () => reply({}, 'A0202'))
      .query('b')
      .catch(x => x);
    expect(wrong.message).toContain('「我的 → 解析服务（MinerU）」');
    const daily = await client(async () => reply({}, -60018))
      .query('b')
      .catch(x => x);
    expect(daily.message).toContain('明天');
    // 服务端给的业务码不像官方错误码时不原样带出
    const odd = await client(async () => reply({}, SECRET))
      .query('b')
      .catch(x => x);
    expect(odd).toMatchObject({ code: 'unknown', kind: 'service' });
    noLeak(odd);
  });

  it('maps HTTP failures without codes and never keeps the body', async () => {
    const html = (status: number) => async () => ({
      status,
      text: async () => '<html>' + SECRET + '</html>',
    });
    const auth = await client(html(401))
      .query('b')
      .catch(x => x);
    expect(auth).toMatchObject({ code: 'A0202', kind: 'auth', status: 401 });
    noLeak(auth);
    const down = await client(html(503))
      .query('b')
      .catch(x => x);
    expect(down).toMatchObject({
      code: 'http_503',
      kind: 'service',
      status: 503,
    });
    expect(down.message).toContain('503');
    noLeak(down);
    await expect(client(html(504)).query('b')).rejects.toMatchObject({
      kind: 'timeout',
    });
    // 200 但不是 JSON / 没有 data
    await expect(client(html(200)).query('b')).rejects.toMatchObject({
      code: 'protocol',
    });
    await expect(
      client(async () => ({
        status: 200,
        text: async () => '{"code":0}',
      })).query('b'),
    ).rejects.toMatchObject({ code: 'protocol' });
    const net = await client(async () => {
      throw new TypeError('Network request failed ' + SECRET);
    })
      .query('b')
      .catch(x => x);
    expect(net).toMatchObject({ code: 'network', kind: 'network' });
    noLeak(net);
  });
});

describe('MinerU client: timeout and cancel', () => {
  afterEach(() => jest.useRealTimers());

  it('times out an API call even if the transport never settles', async () => {
    jest.useFakeTimers();
    const request = fakeRequest(() => new Promise(() => {}));
    const pending = client(request, { timeoutMs: 100 })
      .query('b')
      .catch(x => x);
    await jest.advanceTimersByTimeAsync(100);
    const e = await pending;
    expect(e).toMatchObject({ code: 'timeout', kind: 'timeout' });
    // 底层收到了 abort
    expect(request.mock.calls[0][1].signal?.aborted).toBe(true);
  });

  it('restarts the transfer timer on progress so slow uploads survive', async () => {
    jest.useFakeTimers();
    const files = fakeFiles();
    let report!: (n: number) => void;
    let finish!: () => void;
    files.put.mockImplementation(
      (_u, _p, o) =>
        new Promise(resolve => {
          report = n => o.onProgress?.(n, 100);
          finish = () => resolve({ status: 200 });
        }),
    );
    const c = createMineruClient({
      getToken: async () => SECRET,
      files,
      transferTimeoutMs: 1000,
    });
    const pending = c.upload('u', 'p').then(
      () => 'ok',
      e => e,
    );
    await jest.advanceTimersByTimeAsync(900);
    report(30);
    await jest.advanceTimersByTimeAsync(900);
    report(60);
    await jest.advanceTimersByTimeAsync(900);
    finish();
    expect(await pending).toBe('ok');
    // 没有进度就按时放弃
    files.put.mockImplementation(() => new Promise(() => {}));
    const stuck = c.upload('u', 'p').catch(x => x);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await stuck).toMatchObject({ code: 'timeout' });
  });

  it('cancels before IO and while a transfer ignores the signal', async () => {
    const files = fakeFiles();
    const request = fakeRequest(async () => reply({}));
    const c = createMineruClient({
      getToken: async () => SECRET,
      files,
      request,
    });
    const stopped = new AbortController();
    stopped.abort();
    await expect(c.query('b', stopped.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    await expect(
      c.upload('u', 'p', undefined, stopped.signal),
    ).rejects.toMatchObject({
      code: 'cancelled',
    });
    await expect(
      c.requestUpload(
        [{ name: 'a.pdf', dataId: 'a', ocr: false }],
        'vlm',
        stopped.signal,
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(request).not.toHaveBeenCalled();
    expect(files.put).not.toHaveBeenCalled();
    // 进行中：底层不理 signal，也要马上返回「已停止」
    let started!: () => void;
    const begun = new Promise<void>(r => (started = r));
    files.put.mockImplementation(() => {
      started();
      return new Promise(() => {});
    });
    const live = new AbortController();
    const pending = c.upload('u', 'p', undefined, live.signal).catch(x => x);
    await begun;
    live.abort();
    const e = await pending;
    expect(e).toMatchObject({
      code: 'cancelled',
      kind: 'cancelled',
      message: '已停止',
    });
    expect(files.put.mock.calls[0][2].signal?.aborted).toBe(true);
  });
});

describe('MinerU client: download', () => {
  it('downloads next to destDir, unzips and removes the zip', async () => {
    const files = fakeFiles();
    const c = createMineruClient({ getToken: async () => null, files });
    const progress = jest.fn();
    expect(
      await c.download('https://cdn.test/r.zip', '/books/b1/part1/', progress),
    ).toBe('/books/b1/part1/');
    expect(files.mkdir).toHaveBeenCalledWith('/books/b1/part1/');
    expect(files.download).toHaveBeenCalledWith(
      'https://cdn.test/r.zip',
      '/books/b1/part1.zip',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(progress).toHaveBeenLastCalledWith(100, 100);
    expect(files.unzip).toHaveBeenCalledWith(
      '/books/b1/part1.zip',
      '/books/b1/part1/',
    );
    expect(files.remove).toHaveBeenCalledWith('/books/b1/part1.zip');
  });

  it('removes the zip after HTTP, unzip and cancel failures', async () => {
    const files = fakeFiles();
    const c = createMineruClient({ getToken: async () => null, files });
    files.download.mockResolvedValueOnce({ status: 404 });
    await expect(c.download('u', '/r')).rejects.toMatchObject({
      code: 'download_404',
      kind: 'service',
    });
    expect(files.unzip).not.toHaveBeenCalled();
    files.unzip.mockRejectedValueOnce(new Error('bad zip'));
    await expect(c.download('u', '/r')).rejects.toMatchObject({
      code: 'protocol',
    });
    // 删除本身失败也不盖掉原来的错误
    files.unzip.mockRejectedValueOnce(new Error('bad zip'));
    files.remove.mockRejectedValueOnce(new Error('busy'));
    await expect(c.download('u', '/r')).rejects.toMatchObject({
      code: 'protocol',
    });
    const live = new AbortController();
    files.download.mockImplementationOnce(async () => {
      live.abort();
      return { status: 200 };
    });
    await expect(
      c.download('u', '/r', undefined, live.signal),
    ).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(files.remove).toHaveBeenCalledTimes(4);
    expect(files.remove.mock.calls.every(([p]) => p === '/r.zip')).toBe(true);
  });
});

describe('MinerU client: test()', () => {
  it('treats "authenticated but missing batch" (HTTP 200 + -60012) as ok', async () => {
    let clock = 1000;
    const request = fakeRequest(async () => {
      clock += 182;
      return reply({}, -60012);
    });
    const c = client(request, { now: () => clock });
    expect(await c.test()).toEqual({ ok: true, latencyMs: 182 });
    expect(request.mock.calls[0][0]).toBe(
      'https://mineru.net/api/v4/extract-results/batch/00000000-0000-4000-8000-000000000000',
    );
    request.mockResolvedValueOnce(reply({ extract_result: [] }));
    expect(await c.test()).toMatchObject({ ok: true });
  });

  it('reports auth, HTTP, protocol and network failures', async () => {
    const request = fakeRequest(async () => reply({}, 'A0211'));
    const c = client(request);
    expect(await c.test()).toMatchObject({
      ok: false,
      error: { code: 'A0211', kind: 'auth' },
    });
    // -60012 只在 HTTP 200 时算通过
    request.mockResolvedValueOnce(reply({}, -60012, 503));
    expect(await c.test()).toMatchObject({
      ok: false,
      error: { code: '-60012' },
    });
    request.mockResolvedValueOnce({
      status: 200,
      text: async () => 'not json',
    });
    expect(await c.test()).toMatchObject({
      ok: false,
      error: { code: 'protocol' },
    });
    request.mockRejectedValueOnce(new Error('offline'));
    expect(await c.test()).toMatchObject({
      ok: false,
      error: { kind: 'network' },
    });
    const none = createMineruClient({
      getToken: async () => null,
      files: fakeFiles(),
      request,
    });
    expect(await none.test()).toMatchObject({
      ok: false,
      error: { code: 'missing_token' },
    });
  });
});

describe('findContentList', () => {
  it('prefers the flat content list over v2, model and layout files', () => {
    const pkg = [
      'full.md',
      'abc_model.json',
      'abc_content_list_v2.json',
      'abc_content_list.json',
      'layout.json',
      'images/x.jpg',
    ];
    expect(findContentList(pkg)).toBe('abc_content_list.json');
    expect(findContentList(['abc_content_list_v2.json', 'full.md'])).toBeNull();
    expect(findContentList([])).toBeNull();
    expect(findContentList(['a_content_list.json.bak'])).toBeNull();
    expect(findContentList(['/d/content_list.json'])).toBe(
      '/d/content_list.json',
    );
    expect(findContentList(['out\\a_content_list.json'])).toBe(
      'out\\a_content_list.json',
    );
    expect(
      findContentList([
        '/d/auto/x_content_list.json',
        '/d/x_content_list.json',
      ]),
    ).toBe('/d/x_content_list.json');
  });
});

const PRIMER = [
  { type: 'header', text: '因子投资入门', page_idx: 0 },
  { type: 'text', text: '第 3 章 动量与反转', text_level: 1, page_idx: 0 },
  {
    type: 'text',
    text: '3.1 动量因子',
    text_level: 2,
    page_idx: 0,
    bbox: [1, 2, 3, 4],
  },
  {
    type: 'text',
    text: '过去 12 个月的收益 $r_{t-12,t-1}$ 越高，未来越可能继续上涨。',
    page_idx: 0,
  },
  {
    type: 'equation',
    text: '$$\nM_t = \\frac{P_{t-1}}{P_{t-12}} - 1\n$$',
    text_format: 'latex',
    img_path: 'images/eq.jpg',
    page_idx: 0,
  },
  { type: 'page_number', text: '45', page_idx: 0 },
  {
    type: 'image',
    img_path: 'images/abc.jpg',
    image_caption: ['图 3-1 动量组合净值'],
    image_footnote: ['数据为示意'],
    content: 'VLM 生成的描述',
    page_idx: 1,
  },
  {
    type: 'table',
    img_path: 'images/t1.jpg',
    table_caption: ['表 3-1 分组收益'],
    table_footnote: [],
    table_body:
      '<table><tr><th>组</th><th>年化</th></tr><tr><td>Q1</td><td>4.2%</td></tr>' +
      '<tr><td>Q5 &amp; Q1<br/></td><td>12.8%</td></tr></table>',
    page_idx: 1,
  },
  {
    type: 'list',
    sub_type: 'text',
    list_items: ['1. 计算过去收益', '2) 排序分组', '- 等权持有'],
    page_idx: 1,
  },
  { type: 'footer', text: '版权所有', page_idx: 1 },
  { type: 'aside_text', text: '旁注', page_idx: 1 },
  {
    type: 'code',
    sub_type: 'code',
    code_caption: ['代码 3-1'],
    code_body: '```python\nmom = close.pct_change(12)\n    .shift(1)\n```',
    page_idx: 2,
  },
  { type: 'page_footnote', text: '① 页脚注', page_idx: 2 },
  { type: 'discarded', text: '水印', page_idx: 2 },
  { type: 'ref_text', text: '[1] Jegadeesh & Titman (1993)', page_idx: 2 },
  { type: 'text', text: '   ', page_idx: 2 },
  {
    type: 'chart',
    img_path: 'images/c.jpg',
    chart_caption: ['图 3-2'],
    content: '| a | b |',
    page_idx: 2,
  },
  { type: 'hologram', text: '???', page_idx: 2 },
];

describe('adaptContentList', () => {
  const opts = { pageFrom: 1, pageTo: 3, imagePrefix: 'books/b1/p1/' };

  it('maps headings, inline math, equations, images, tables, lists and code', () => {
    const { items, warnings } = adaptContentList(PRIMER, opts);
    expect(items).toEqual([
      { kind: 'heading', text: '第 3 章 动量与反转', level: 1, page: 1 },
      { kind: 'heading', text: '3.1 动量因子', level: 2, page: 1 },
      {
        kind: 'block',
        type: 'p',
        text: '过去 12 个月的收益 $r_{t-12,t-1}$ 越高，未来越可能继续上涨。',
        page: 1,
      },
      {
        kind: 'block',
        type: 'eq',
        text: 'M_t = \\frac{P_{t-1}}{P_{t-12}} - 1',
        page: 1,
      },
      {
        kind: 'block',
        type: 'img',
        text: '图 3-1 动量组合净值\n数据为示意',
        image: 'books/b1/p1/images/abc.jpg',
        page: 2,
      },
      {
        kind: 'block',
        type: 'table',
        text: '表 3-1 分组收益\n组 | 年化\nQ1 | 4.2%\nQ5 & Q1 | 12.8%',
        html: PRIMER[7].table_body,
        page: 2,
      },
      { kind: 'block', type: 'li', text: '计算过去收益', mark: '1.', page: 2 },
      { kind: 'block', type: 'li', text: '排序分组', mark: '2.', page: 2 },
      { kind: 'block', type: 'li', text: '等权持有', mark: '•', page: 2 },
      { kind: 'block', type: 'p', text: '代码 3-1', page: 3 },
      {
        kind: 'block',
        type: 'code',
        text: 'mom = close.pct_change(12)\n    .shift(1)',
        page: 3,
      },
      {
        kind: 'block',
        type: 'p',
        text: '[1] Jegadeesh & Titman (1993)',
        page: 3,
      },
      {
        kind: 'block',
        type: 'img',
        text: '图 3-2',
        image: 'books/b1/p1/images/c.jpg',
        page: 3,
      },
    ]);
    // 页眉、页脚、页码、边注、页脚注、discarded 不进正文，也不报警
    expect(JSON.stringify(items)).not.toMatch(
      /因子投资入门|版权所有|旁注|页脚注|水印|VLM/,
    );
    expect(warnings).toEqual(['第 1–3 页：跳过了不认识的内容类型：hologram']);
  });

  it('prefers a latex field and reads list marks without eating numbers', () => {
    const { items } = adaptContentList(
      [
        { type: 'equation', latex: 'x^2', text: '$$y$$', page_idx: 0 },
        { type: 'interline_equation', text: '$$ $$', page_idx: 0 },
        { type: 'title', text: 'Introduction', page_idx: 0 },
        { type: 'text', text: '普通段落', text_level: 0, page_idx: 0 },
        {
          type: 'list',
          list_items: [
            '1.5 倍杠杆',
            '-5% 的回撤',
            '(1) 第一步',
            '1、步骤',
            { text: '• 圆点' },
            '',
          ],
          page_idx: 0,
        },
      ],
      { pageFrom: 1, pageTo: 1, imagePrefix: '' },
    );
    expect(
      items.map(i => (i.kind === 'heading' ? 'h' + i.level : i.type)),
    ).toEqual(['eq', 'h1', 'p', 'li', 'li', 'li', 'li', 'li']);
    expect(items[0]).toMatchObject({ text: 'x^2' });
    expect(
      items.slice(3).map(i => [i.kind === 'block' && i.mark, i.text]),
    ).toEqual([
      ['•', '1.5 倍杠杆'],
      ['•', '-5% 的回撤'],
      ['(1)', '第一步'],
      ['1、', '步骤'],
      ['•', '圆点'],
    ]);
  });
});

describe('adaptContentList: page numbers', () => {
  const pagesOf = (idx: number[], pageFrom: number, pageTo: number) => {
    const r = adaptContentList(
      idx.map(i => ({ type: 'text', text: 'p' + i, page_idx: i })),
      { pageFrom, pageTo, imagePrefix: '' },
    );
    return { pages: r.items.map(i => i.page), warnings: r.warnings };
  };

  it('treats page_idx as part-relative when every index fits inside the part', () => {
    expect(pagesOf([0, 1, 199], 201, 400)).toEqual({
      pages: [201, 202, 400],
      warnings: [],
    });
    expect(pagesOf([0, 17], 401, 418).pages).toEqual([401, 418]);
  });

  it('treats page_idx as absolute otherwise', () => {
    expect(pagesOf([200, 201, 399], 201, 400)).toEqual({
      pages: [201, 202, 400],
      warnings: [],
    });
    // 第一片两种算法一样
    expect(pagesOf([0, 199], 1, 200).pages).toEqual([1, 200]);
  });

  it('warns when a computed page falls outside the part', () => {
    // 399 不在 0..199 里 → 按原书算：p.1、p.400；p.1 落在 201–400 之外
    const r = pagesOf([0, 399], 201, 400);
    expect(r.pages).toEqual([1, 400]);
    expect(r.warnings).toEqual([
      '第 201–400 页：1 个内容块的页码落在这一片之外，页码可能不准',
    ]);
    expect(pagesOf([0, 5], 1, 3).warnings[0]).toContain(
      '1 个内容块的页码落在这一片之外',
    );
  });

  it('sorts by page_idx keeping order within a page, and keeps rows without page_idx', () => {
    const r = adaptContentList(
      [
        { type: 'text', text: 'b', page_idx: 1 },
        { type: 'text', text: 'a1', page_idx: 0 },
        { type: 'text', text: 'a2', page_idx: 0 },
        { type: 'text', text: 'loose' },
        { type: 'text', text: 'c', page_idx: 2 },
      ],
      { pageFrom: 1, pageTo: 3, imagePrefix: '' },
    );
    // 没有 page_idx 的行跟着它前面那一行（a2）排
    expect(r.items.map(i => [i.text, i.page])).toEqual([
      ['a1', 1],
      ['a2', 1],
      ['loose', undefined],
      ['b', 2],
      ['c', 3],
    ]);
    expect(r.items[2]).not.toHaveProperty('page');
    expect(r.warnings).toEqual(['第 1–3 页：1 个内容块没有页码']);
  });
});

describe('adaptContentList: bad input', () => {
  const o = { pageFrom: 1, pageTo: 1, imagePrefix: 'x/' };

  it('skips unsafe or missing image paths but keeps the caption', () => {
    const r = adaptContentList(
      [
        {
          type: 'image',
          img_path: '../secret.png',
          image_caption: ['图 A'],
          page_idx: 0,
        },
        { type: 'image', img_path: '/etc/passwd', page_idx: 0 },
        { type: 'image', img_path: 'https://evil.test/x.png', page_idx: 0 },
        { type: 'image', image_caption: ['图 B'], page_idx: 0 },
        { type: 'image', img_path: './images\\ok.jpg', page_idx: 0 },
        { type: 'table', table_caption: ['表 C'], page_idx: 0 },
        {
          type: 'table',
          img_path: 'images/t.jpg',
          table_caption: ['表 D'],
          page_idx: 0,
        },
      ],
      o,
    );
    expect(r.items).toEqual([
      { kind: 'block', type: 'p', text: '图 A', page: 1 },
      { kind: 'block', type: 'p', text: '图 B', page: 1 },
      {
        kind: 'block',
        type: 'img',
        text: '',
        image: 'x/images/ok.jpg',
        page: 1,
      },
      { kind: 'block', type: 'p', text: '表 C', page: 1 },
      {
        kind: 'block',
        type: 'img',
        text: '表 D',
        image: 'x/images/t.jpg',
        page: 1,
      },
    ]);
    expect(r.warnings).toEqual([
      '第 1–1 页：1 张图在结果包里没有图片文件，只保留了图注',
      '第 1–1 页：3 张图的路径不安全，已跳过图片',
    ]);
  });

  it('warns on an empty part, rejects non-arrays and bad ranges', () => {
    expect(adaptContentList([], o).warnings).toEqual([
      '第 1–1 页：没有解析出内容，扫描版 PDF 可以打开 OCR 重新解析',
    ]);
    const r = adaptContentList(
      [null, 3, { type: 'text', text: 'ok', page_idx: 0 }],
      o,
    );
    expect(r.items).toHaveLength(1);
    expect(r.warnings).toEqual(['第 1–1 页：跳过了不认识的内容类型：非对象']);
    for (const bad of [{}, 'x', null]) {
      expect(() => adaptContentList(bad, o)).toThrow(MineruError);
    }
    expect(() =>
      adaptContentList([], { ...o, pageFrom: 5, pageTo: 4 }),
    ).toThrow(RangeError);
    expect(() => adaptContentList([], { ...o, pageFrom: 0 })).toThrow(
      RangeError,
    );
  });
});

/**
 * Pagewise 的合成结果包（Pagewise/fixtures/mineru-synthetic/sample_content_list.json，CC0，
 * 内容是自编的）：去掉 bbox 后原样抄过来，仓库之间不互相引用文件。
 */
const PAGEWISE_SYNTHETIC = [
  { type: 'text', text: '1.1 第二页', text_level: 2, page_idx: 1 },
  { type: 'header', text: '合成教材页眉', page_idx: 0 },
  { type: 'text', text: '第 1 章 搜索玩具世界', text_level: 1, page_idx: 0 },
  {
    type: 'text',
    text: '这段由项目作者编写，机器人从起点走到终点。',
    page_idx: 0,
  },
  { type: 'text', text: '点坐标段落', page_idx: 0 },
  { type: 'list_item', text: '起点是 A。', page_idx: 0 },
  { type: 'list_item', text: '终点是 B。', page_idx: 0 },
  {
    type: 'image',
    img_path: 'images/route.svg',
    image_caption: ['图 1：机器人走向目标。'],
    image_footnote: ['示意图为本项目自绘。'],
    page_idx: 0,
  },
  { type: 'caption', text: '箭头表示可走的方向。', page_idx: 0 },
  {
    type: 'table',
    table_body:
      '<table><tr><th>节点</th><th>代价</th></tr><tr><td>A</td><td>2 &amp; 3</td></tr></table>',
    table_caption: ['表 1：自编代价。'],
    page_idx: 0,
  },
  { type: 'code', code_body: 'cost = left + right', page_idx: 0 },
  { type: 'page_number', text: '1', page_idx: 0 },
  { type: 'text', text: 'f(n)=g(n)+h(n)', text_format: 'latex', page_idx: 1 },
  {
    type: 'text',
    text: '像素坐标段落。',
    coordinate_system: 'pixels',
    page_idx: 1,
  },
  { type: 'footer', text: '合成页脚', page_idx: 1 },
  { type: 'text', text: '   ', page_idx: 1 },
  { type: 'page_number', text: '2', page_idx: 1 },
  { type: 'footer', text: '空白页', page_idx: 2 },
  { type: 'text', text: '最后一页使用相对坐标。', page_idx: 3 },
];

describe('adaptContentList: Pagewise synthetic package', () => {
  it('adapts a 4-page part submitted as pages 13–16', () => {
    const { items, warnings } = adaptContentList(PAGEWISE_SYNTHETIC, {
      pageFrom: 13,
      pageTo: 16,
      imagePrefix: 'r/',
    });
    expect(warnings).toEqual([]);
    expect(
      items.map(i => [i.kind === 'heading' ? 'h' + i.level : i.type, i.page]),
    ).toEqual([
      ['h1', 13],
      ['p', 13],
      ['p', 13],
      ['li', 13],
      ['li', 13],
      ['img', 13],
      ['p', 13],
      ['table', 13],
      ['code', 13],
      ['h2', 14],
      ['eq', 14],
      ['p', 14],
      ['p', 16],
    ]);
    expect(items[5]).toMatchObject({
      image: 'r/images/route.svg',
      text: '图 1：机器人走向目标。\n示意图为本项目自绘。',
    });
    expect(items[7]).toMatchObject({
      text: '表 1：自编代价。\n节点 | 代价\nA | 2 & 3',
    });
    expect(items[10]).toMatchObject({ text: 'f(n)=g(n)+h(n)' });
    expect(JSON.stringify(items)).not.toMatch(/页眉|页脚|空白页/);
  });
});

describe('mergeParts', () => {
  it('concatenates parts in order', () => {
    const a = adaptContentList([{ type: 'text', text: 'a', page_idx: 0 }], {
      pageFrom: 1,
      pageTo: 200,
      imagePrefix: '',
    }).items;
    const b = adaptContentList([{ type: 'text', text: 'b', page_idx: 0 }], {
      pageFrom: 201,
      pageTo: 400,
      imagePrefix: '',
    }).items;
    expect(mergeParts([a, b, []]).map(i => [i.text, i.page])).toEqual([
      ['a', 1],
      ['b', 201],
    ]);
    expect(mergeParts([])).toEqual([]);
  });
});
