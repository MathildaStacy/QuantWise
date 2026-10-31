import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Dimensions, ScrollView, Text } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { WebView } from 'react-native-webview';
import {
  createMathBridge,
  createMathRenderer,
  mathBridge,
  mathRenderer,
  type MathRender,
  type MathRenderer,
} from '../../src/ui/math/bridge';
import { MathHost } from '../../src/ui/math/MathHost';
import { MathView } from '../../src/ui/math/MathView';
import { aiColor } from '../../src/ui/aiTheme';

const result: MathRender = {
  svg: '<svg width="4ex" height="2ex" viewBox="0 0 10 5"><path fill="currentColor"/><g stroke="currentColor"/></svg>',
  width: 4,
  height: 2,
  baseline: 1.5,
};
const READY = '{"type":"ready"}';
/** 模拟 WebView 对某次请求的回复。 */
const reply = (id: string, v: Partial<MathRender> = {}) => {
  const m = { ...result, ...v };
  return JSON.stringify({
    id,
    svg: m.svg,
    w: m.width,
    h: m.height,
    baseline: m.baseline,
  });
};
/** 取第 n 次发给 WebView 的请求。 */
const sent = (send: jest.Mock, n = 0) =>
  JSON.parse(send.mock.calls[n][0]) as {
    id: string;
    tex: string;
    display: boolean;
  };

afterEach(() => jest.useRealTimers());

describe('公式桥 createMathBridge', () => {
  test('ready 之前排队不发，ready 后按序发出，乱序回复各归各的请求', async () => {
    const bridge = createMathBridge();
    const send = jest.fn();
    bridge.attach(send);
    const one = bridge.render('x', false);
    const two = bridge.render('y', true);
    expect(send).not.toHaveBeenCalled();
    for (const noise of [
      '不是 JSON',
      'null',
      '42',
      '{}',
      '{"id":3}',
      reply('?'),
    ]) {
      bridge.receive(noise);
    }
    bridge.receive(READY);
    expect(send).toHaveBeenCalledTimes(2);
    const first = sent(send, 0);
    const second = sent(send, 1);
    expect(first).toMatchObject({ tex: 'x', display: false });
    expect(second).toMatchObject({ tex: 'y', display: true });
    bridge.receive(reply(second.id, { width: 8 }));
    bridge.receive(reply(first.id));
    await expect(two).resolves.toEqual({ ...result, width: 8 });
    await expect(one).resolves.toEqual(result);
    bridge.close();
  });

  test('ready 之后的请求立即发出，收到回复后 resolve', async () => {
    const bridge = createMathBridge();
    const send = jest.fn();
    bridge.attach(send);
    bridge.receive(READY);
    const p = bridge.render('\\frac{a}{b}', true);
    expect(send).toHaveBeenCalledTimes(1);
    bridge.receive(reply(sent(send).id));
    await expect(p).resolves.toEqual(result);
    bridge.close();
  });

  test('默认 3 秒超时：2999ms 时还在等，3000ms 拒绝为 timeout，迟到的回复被忽略', async () => {
    jest.useFakeTimers();
    const bridge = createMathBridge();
    const send = jest.fn();
    bridge.attach(send);
    bridge.receive(READY);
    let settled = false;
    const outcome = bridge.render('x', false).then(
      () => 'ok',
      e => {
        settled = true;
        return e;
      },
    );
    jest.advanceTimersByTime(2999);
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    expect(await outcome).toMatchObject({ reason: 'timeout' });
    expect(() => bridge.receive(reply(sent(send).id))).not.toThrow();
    bridge.close();
  });

  test('WebView 一直不就绪时排队的请求同样在 3 秒后超时，且不留定时器', async () => {
    jest.useFakeTimers();
    const bridge = createMathBridge();
    bridge.attach(jest.fn());
    const outcome = bridge.render('x', false).catch(e => e);
    jest.advanceTimersByTime(3000);
    expect(await outcome).toMatchObject({ reason: 'timeout' });
    expect(jest.getTimerCount()).toBe(0);
    bridge.close();
  });

  test('可自定义超时时间', async () => {
    jest.useFakeTimers();
    const bridge = createMathBridge(500);
    bridge.attach(jest.fn());
    const outcome = bridge.render('x', false).catch(e => e);
    jest.advanceTimersByTime(500);
    expect(await outcome).toMatchObject({ reason: 'timeout' });
    bridge.close();
  });

  test('error 回复（TeX 有语法错误）拒绝为 invalid', async () => {
    const bridge = createMathBridge();
    const send = jest.fn();
    bridge.attach(send);
    bridge.receive(READY);
    const p = bridge.render('\\frac{', true);
    bridge.receive(JSON.stringify({ id: sent(send).id, error: 'render' }));
    await expect(p).rejects.toMatchObject({
      reason: 'invalid',
      message: '公式暂时无法渲染',
    });
    bridge.close();
  });

  test.each([
    ['不是 SVG', { svg: 'plain text' }],
    ['宽度为 0', { width: 0 }],
    ['高度为负', { height: -1 }],
    ['基线为负', { baseline: -1 }],
    ['基线大于高度', { baseline: 99 }],
    ['基线是 NaN', { baseline: NaN }],
  ])('结果不合格（%s）拒绝为 invalid', async (_name, partial) => {
    const bridge = createMathBridge();
    const send = jest.fn();
    bridge.attach(send);
    bridge.receive(READY);
    const p = bridge.render('x', true);
    bridge.receive(reply(sent(send).id, partial));
    await expect(p).rejects.toMatchObject({ reason: 'invalid' });
    bridge.close();
  });

  test('fail()：拒绝等待中的请求，之后的请求直接失败，WebView 再次 ready 后恢复', async () => {
    const bridge = createMathBridge();
    const send = jest.fn();
    bridge.attach(send);
    bridge.receive(READY);
    const waiting = bridge.render('a', false);
    bridge.fail();
    await expect(waiting).rejects.toMatchObject({ reason: 'unavailable' });
    expect(send).toHaveBeenCalledTimes(1);
    // 失败后不发给 WebView，直接拒绝。
    await expect(bridge.render('b', false)).rejects.toMatchObject({
      reason: 'unavailable',
    });
    expect(send).toHaveBeenCalledTimes(1);
    // WebView 重新加载完成。
    bridge.receive(READY);
    const again = bridge.render('c', false);
    expect(send).toHaveBeenCalledTimes(2);
    bridge.receive(reply(sent(send, 1).id));
    await expect(again).resolves.toEqual(result);
    bridge.close();
  });

  test('fatal 消息（MathJax 没起来）与 fail() 相同', async () => {
    const bridge = createMathBridge();
    bridge.attach(jest.fn());
    const waiting = bridge.render('a', false);
    bridge.receive('{"type":"fatal"}');
    await expect(waiting).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(bridge.render('b', false)).rejects.toMatchObject({
      reason: 'unavailable',
    });
    bridge.close();
  });

  test('宿主卸载（注销）立即拒绝等待中的请求；新宿主挂上并 ready 后可继续使用', async () => {
    const bridge = createMathBridge();
    const detach = bridge.attach(jest.fn());
    const waiting = bridge.render('a', false);
    detach();
    await expect(waiting).rejects.toMatchObject({ reason: 'unavailable' });
    const send = jest.fn();
    bridge.attach(send);
    detach(); // 旧宿主迟到的注销不影响新宿主
    bridge.receive(READY);
    const next = bridge.render('b', false);
    bridge.receive(reply(sent(send).id));
    await expect(next).resolves.toEqual(result);
    bridge.close();
  });

  test('发送函数抛错时立即拒绝为 unavailable，不等超时', async () => {
    const bridge = createMathBridge();
    bridge.attach(() => {
      throw new Error('host lost');
    });
    bridge.receive(READY);
    await expect(bridge.render('x', false)).rejects.toMatchObject({
      reason: 'unavailable',
    });
    bridge.close();
  });

  test('close() 拒绝等待中的请求为 closed，之后的请求和消息都被忽略', async () => {
    const bridge = createMathBridge();
    const send = jest.fn();
    bridge.attach(send);
    const waiting = bridge.render('a', false);
    bridge.close();
    await expect(waiting).rejects.toMatchObject({ reason: 'closed' });
    await expect(bridge.render('b', false)).rejects.toMatchObject({
      reason: 'closed',
    });
    bridge.attach(send)();
    bridge.receive(READY);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('渲染器 createMathRenderer（内存 LRU）', () => {
  test('缓存命中不再向 WebView 发第二次', async () => {
    const bridge = createMathBridge();
    const send = jest.fn();
    bridge.attach(send);
    bridge.receive(READY);
    const renderer = createMathRenderer({ bridge });
    const first = renderer.render('x^2', true);
    bridge.receive(reply(sent(send).id));
    await expect(first).resolves.toEqual(result);
    await expect(renderer.render('x^2', true)).resolves.toEqual(result);
    expect(send).toHaveBeenCalledTimes(1);
    bridge.close();
  });

  test('键区分行内和独立两种模式', async () => {
    const inner = { render: jest.fn().mockResolvedValue(result) };
    const renderer = createMathRenderer({ bridge: inner });
    await renderer.render('x', true);
    await renderer.render('x', false);
    expect(inner.render).toHaveBeenCalledTimes(2);
    await renderer.render('x', true);
    await renderer.render('x', false);
    expect(inner.render).toHaveBeenCalledTimes(2);
  });

  test('同一公式的并发请求合并成一次', async () => {
    const inner = { render: jest.fn().mockResolvedValue(result) };
    const renderer = createMathRenderer({ bridge: inner });
    const a = renderer.render('x', true);
    const b = renderer.render('x', true);
    expect(a).toBe(b);
    await a;
    expect(inner.render).toHaveBeenCalledTimes(1);
  });

  test('失败不缓存，下次重新请求', async () => {
    const inner = {
      render: jest
        .fn()
        .mockRejectedValueOnce(new Error('bad TeX'))
        .mockResolvedValueOnce(result),
    };
    const renderer = createMathRenderer({ bridge: inner });
    await expect(renderer.render('x', true)).rejects.toThrow('bad TeX');
    await expect(renderer.render('x', true)).resolves.toEqual(result);
    expect(inner.render).toHaveBeenCalledTimes(2);
  });

  test('桥返回不合格的结果时拒绝，且不缓存', async () => {
    const inner = {
      render: jest.fn().mockResolvedValue({ ...result, svg: 'oops' }),
    };
    const renderer = createMathRenderer({ bridge: inner });
    await expect(renderer.render('x', true)).rejects.toMatchObject({
      reason: 'invalid',
    });
    await expect(renderer.render('x', true)).rejects.toMatchObject({
      reason: 'invalid',
    });
    expect(inner.render).toHaveBeenCalledTimes(2);
  });

  test('默认容量 300 条，命中会刷新新旧顺序，淘汰最久没用的', async () => {
    const inner = { render: jest.fn().mockResolvedValue(result) };
    const renderer = createMathRenderer({ bridge: inner });
    for (let i = 0; i < 300; i++) {
      await renderer.render('f' + i, true);
    }
    await renderer.render('f0', true); // 命中，f0 变成最新
    await renderer.render('f300', true); // 第 301 条，淘汰最旧的 f1
    expect(inner.render).toHaveBeenCalledTimes(301);
    await renderer.render('f0', true);
    expect(inner.render).toHaveBeenCalledTimes(301);
    await renderer.render('f1', true);
    expect(inner.render).toHaveBeenCalledTimes(302);
  });

  test('close() 清空缓存，之后的请求拒绝为 closed', async () => {
    const inner = { render: jest.fn().mockResolvedValue(result) };
    const renderer = createMathRenderer({ bridge: inner });
    await renderer.render('x', true);
    renderer.close();
    await expect(renderer.render('x', true)).rejects.toMatchObject({
      reason: 'closed',
    });
  });
});

describe('隐藏宿主 MathHost', () => {
  let tree: ReactTestRenderer | undefined;
  afterEach(async () => {
    if (tree) {
      await act(async () => tree!.unmount());
    }
    tree = undefined;
    jest.clearAllMocks();
  });

  test('加载离线页面，限制只能访问 math 资源，消息和加载错误接到单例桥上', async () => {
    await act(async () => {
      tree = create(<MathHost />);
    });
    const host = tree!.root.findByType(WebView);
    expect(host.props.source).toEqual({
      uri: 'file:///android_asset/math/index.html',
    });
    expect(host.props.style).toMatchObject({ width: 0, height: 0 });
    expect(host.props.allowUniversalAccessFromFileURLs).toBe(false);
    expect(host.props.domStorageEnabled).toBe(false);
    expect(host.props.mixedContentMode).toBe('never');
    expect(host.props.originWhitelist).toEqual(['file://*']);
    const allow = host.props.onShouldStartLoadWithRequest;
    expect(allow({ url: 'https://cdn.example.com/mathjax.js' })).toBe(false);
    expect(allow({ url: 'file:///data/user/0/x/secret' })).toBe(false);
    expect(allow({ url: 'file:///android_asset/math/index.html' })).toBe(true);
    expect(allow({ url: 'about:blank' })).toBe(true);

    const post = jest.requireMock('react-native-webview')
      .__postMessage as jest.Mock;
    host.props.onMessage({ nativeEvent: { data: READY } });
    const p = mathBridge.render('x', true);
    expect(JSON.parse(post.mock.calls[0][0])).toMatchObject({
      tex: 'x',
      display: true,
    });
    host.props.onMessage({
      nativeEvent: { data: reply(JSON.parse(post.mock.calls[0][0]).id) },
    });
    await expect(p).resolves.toEqual(result);

    for (const name of [
      'onError',
      'onHttpError',
      'onContentProcessDidTerminate',
      'onRenderProcessGone',
    ]) {
      host.props[name]();
      await expect(mathBridge.render('x', true)).rejects.toMatchObject({
        reason: 'unavailable',
      });
      host.props.onMessage({ nativeEvent: { data: READY } });
    }
  });

  test('卸载时立即拒绝还在等待的请求', async () => {
    await act(async () => {
      tree = create(<MathHost />);
    });
    const waiting = mathBridge.render('x', true).catch(e => e);
    await act(async () => tree!.unmount());
    tree = undefined;
    expect(await waiting).toMatchObject({ reason: 'unavailable' });
  });
});

describe('公式视图 MathView', () => {
  let tree: ReactTestRenderer | undefined;
  afterEach(async () => {
    if (tree) {
      await act(async () => tree!.unmount());
    }
    tree = undefined;
  });
  const fake = (render: MathRenderer['render']): MathRenderer => ({ render });
  const fallback = (tex: string) =>
    tree!.root.findAllByType(Text).filter(n => n.props.children === tex);
  const fontScale = () => Dimensions.get('window').fontScale;

  test('先显示等宽、可选中的原始 TeX，渲染出来后换成 SVG', async () => {
    let finish!: (v: MathRender) => void;
    const renderer = fake(
      jest.fn(
        () =>
          new Promise<MathRender>(resolve => {
            finish = resolve;
          }),
      ),
    );
    await act(async () => {
      tree = create(<MathView tex="E=mc^2" renderer={renderer} />);
    });
    expect(renderer.render).toHaveBeenCalledWith('E=mc^2', true);
    expect(tree!.root.findAllByType(SvgXml)).toHaveLength(0);
    const text = fallback('E=mc^2');
    expect(text).toHaveLength(1);
    expect(text[0].props.selectable).toBe(true);
    expect(text[0].props.style).toMatchObject({
      // Jest 里 Platform.OS 是 ios（Menlo）；Android 上是 monospace，与 Markdown 代码块一致。
      fontFamily: expect.stringMatching(/^(Menlo|monospace)$/),
      color: aiColor.ink,
    });

    await act(async () => finish(result));
    expect(tree!.root.findAllByType(SvgXml)).toHaveLength(1);
    expect(fallback('E=mc^2')).toHaveLength(0);
  });

  test('SVG 的 currentColor 换成 aiColor.ink，尺寸 = ex × 正文 16 × 字体缩放 × 0.5', async () => {
    const renderer = fake(jest.fn().mockResolvedValue(result));
    await act(async () => {
      tree = create(<MathView tex="x" renderer={renderer} />);
    });
    const svg = tree!.root.findByType(SvgXml);
    expect(svg.props.xml).not.toContain('currentColor');
    expect(svg.props.xml).toContain(`fill="${aiColor.ink}"`);
    expect(svg.props.xml).toContain(`stroke="${aiColor.ink}"`);
    const ex = 16 * fontScale() * 0.5;
    expect(svg.props.width).toBe(result.width * ex);
    expect(svg.props.height).toBe(result.height * ex);
  });

  test('系统字体缩放变化时 SVG 随之放大', async () => {
    const renderer = fake(jest.fn().mockResolvedValue(result));
    const before = Dimensions.get('window');
    await act(async () => {
      tree = create(<MathView tex="x" renderer={renderer} />);
    });
    const w1 = tree!.root.findByType(SvgXml).props.width as number;
    await act(async () => {
      // 测试环境里 Dimensions.set 只在内部使用，这里用它模拟用户调大系统字体。
      (Dimensions as unknown as { set(v: object): void }).set({
        window: { ...before, fontScale: before.fontScale * 1.5 },
        screen: Dimensions.get('screen'),
      });
    });
    const w2 = tree!.root.findByType(SvgXml).props.width as number;
    expect(w2).toBeCloseTo(w1 * 1.5);
    await act(async () => {
      (Dimensions as unknown as { set(v: object): void }).set({
        window: before,
        screen: Dimensions.get('screen'),
      });
    });
  });

  test('居中；比容器宽时横向滚动；整体读作“公式：” + TeX', async () => {
    const renderer = fake(jest.fn().mockResolvedValue(result));
    await act(async () => {
      tree = create(<MathView tex={'\\sqrt{x}'} renderer={renderer} />);
    });
    const scroll = tree!.root.findByType(ScrollView);
    expect(scroll.props.horizontal).toBe(true);
    expect(scroll.props.accessible).toBe(true);
    expect(scroll.props.accessibilityLabel).toBe('公式：\\sqrt{x}');
    expect(scroll.props.contentContainerStyle).toMatchObject({
      minWidth: '100%',
      justifyContent: 'center',
    });
  });

  test('渲染失败（含超时）时一直显示原始 TeX', async () => {
    const renderer = fake(jest.fn().mockRejectedValue(new Error('timeout')));
    await act(async () => {
      tree = create(<MathView tex={'\\frac{a}{b}'} renderer={renderer} />);
    });
    expect(tree!.root.findAllByType(SvgXml)).toHaveLength(0);
    expect(fallback('\\frac{a}{b}')).toHaveLength(1);
    expect(tree!.root.findByType(ScrollView).props.accessibilityLabel).toBe(
      '公式：\\frac{a}{b}',
    );
  });

  test('公式换了以后不显示旧结果，旧请求迟到的结果被丢弃', async () => {
    const resolvers: Record<string, (v: MathRender) => void> = {};
    const renderer = fake(
      jest.fn(
        (tex: string) =>
          new Promise<MathRender>(resolve => {
            resolvers[tex] = resolve;
          }),
      ),
    );
    await act(async () => {
      tree = create(<MathView tex="a" renderer={renderer} />);
    });
    await act(async () => resolvers.a({ ...result, svg: '<svg>a</svg>' }));
    expect(tree!.root.findByType(SvgXml).props.xml).toBe('<svg>a</svg>');

    await act(async () =>
      tree!.update(<MathView tex="b" renderer={renderer} />),
    );
    expect(tree!.root.findAllByType(SvgXml)).toHaveLength(0);
    expect(fallback('b')).toHaveLength(1);

    await act(async () =>
      tree!.update(<MathView tex="c" renderer={renderer} />),
    );
    await act(async () => resolvers.b({ ...result, svg: '<svg>b</svg>' }));
    expect(tree!.root.findAllByType(SvgXml)).toHaveLength(0);
    await act(async () => resolvers.c({ ...result, svg: '<svg>c</svg>' }));
    expect(tree!.root.findByType(SvgXml).props.xml).toBe('<svg>c</svg>');
  });

  test('不传 renderer 时使用全局单例 mathRenderer', async () => {
    const spy = jest.spyOn(mathRenderer, 'render').mockResolvedValue(result);
    await act(async () => {
      tree = create(<MathView tex="y" />);
    });
    expect(spy).toHaveBeenCalledWith('y', true);
    expect(tree!.root.findAllByType(SvgXml)).toHaveLength(1);
    spy.mockRestore();
  });
});
