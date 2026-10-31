/** 公式渲染桥：App 根部隐藏的 WebView（离线 MathJax）与界面之间的消息通道，加内存 LRU 缓存。移植自 Pagewise services/math。 */

/** 尺寸单位是 MathJax 的 ex，显示时按当前字号换算成 dp。 */
export interface MathRender {
  svg: string;
  width: number;
  height: number;
  baseline: number;
}

export interface MathRenderer {
  render(tex: string, display: boolean): Promise<MathRender>;
}

export interface MathBridge extends MathRenderer {
  /** 宿主 WebView 挂载时登记发送函数，返回注销函数。 */
  attach(send: (payload: string) => void): () => void;
  /** 收到 WebView 的消息（ready、fatal 或某次请求的结果）。 */
  receive(payload: string): void;
  /** WebView 加载失败或进程退出：立即拒绝所有等待中的请求，之后的请求直接失败，直到再次 ready。 */
  fail(): void;
  close(): void;
}

export interface CachedMathRenderer extends MathRenderer {
  close(): void;
}

export class MathRenderError extends Error {
  constructor(
    public readonly reason: 'timeout' | 'unavailable' | 'invalid' | 'closed',
  ) {
    super('公式暂时无法渲染');
    this.name = 'MathRenderError';
  }
}

type Pending = {
  payload: string;
  resolve(value: MathRender): void;
  reject(error: MathRenderError): void;
  timer: ReturnType<typeof setTimeout>;
};

/** 校验 WebView 回传的结果：SVG 字符串、正的有限宽高、基线在 [0, 高] 内。 */
export function validRender(value: unknown): value is MathRender {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const r = value as Partial<MathRender>;
  return (
    typeof r.svg === 'string' &&
    r.svg.trim().startsWith('<svg') &&
    typeof r.width === 'number' &&
    Number.isFinite(r.width) &&
    r.width > 0 &&
    typeof r.height === 'number' &&
    Number.isFinite(r.height) &&
    r.height > 0 &&
    typeof r.baseline === 'number' &&
    Number.isFinite(r.baseline) &&
    r.baseline >= 0 &&
    r.baseline <= r.height
  );
}

/** 请求在 WebView 就绪前排队；每个请求从发起起算 timeoutMs，超时就拒绝。 */
export function createMathBridge(timeoutMs = 3000): MathBridge {
  let send: ((payload: string) => void) | undefined;
  let ready = false;
  let closed = false;
  let failed = false;
  let sequence = 0;
  const pending = new Map<string, Pending>();

  function rejectAll(reason: 'unavailable' | 'closed') {
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(new MathRenderError(reason));
    }
    pending.clear();
  }

  function dispatch(id: string, task: Pending) {
    try {
      send!(task.payload);
    } catch {
      clearTimeout(task.timer);
      pending.delete(id);
      task.reject(new MathRenderError('unavailable'));
    }
  }

  return {
    attach(value) {
      if (closed) {
        return () => {};
      }
      send = value;
      failed = false;
      ready = false;
      return () => {
        if (send === value) {
          send = undefined;
          ready = false;
          rejectAll('unavailable');
        }
      };
    },
    render(tex, display) {
      if (closed || failed) {
        return Promise.reject(
          new MathRenderError(closed ? 'closed' : 'unavailable'),
        );
      }
      const id = String(++sequence);
      return new Promise<MathRender>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new MathRenderError('timeout'));
        }, timeoutMs);
        const task: Pending = {
          payload: JSON.stringify({ id, tex, display }),
          resolve,
          reject,
          timer,
        };
        pending.set(id, task);
        if (ready && send) {
          dispatch(id, task);
        }
      });
    },
    receive(payload) {
      if (closed) {
        return;
      }
      let value: Record<string, unknown>;
      try {
        value = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!value || typeof value !== 'object') {
        return;
      }
      if (value.type === 'fatal') {
        ready = false;
        failed = true;
        rejectAll('unavailable');
        return;
      }
      if (value.type === 'ready') {
        ready = true;
        failed = false;
        if (send) {
          for (const [id, task] of pending) {
            dispatch(id, task);
          }
        }
        return;
      }
      if (typeof value.id !== 'string') {
        return;
      }
      const task = pending.get(value.id);
      if (!task) {
        return;
      }
      pending.delete(value.id);
      clearTimeout(task.timer);
      const result = {
        svg: value.svg,
        width: value.w,
        height: value.h,
        baseline: value.baseline,
      };
      if (value.error || !validRender(result)) {
        task.reject(new MathRenderError('invalid'));
      } else {
        task.resolve(result);
      }
    },
    fail() {
      ready = false;
      failed = true;
      rejectAll('unavailable');
    },
    close() {
      closed = true;
      ready = false;
      send = undefined;
      rejectAll('closed');
    },
  };
}

/** 内存 LRU 缓存：键 = 模式前缀 + TeX；相同公式的并发请求合并成一次。失败不缓存。 */
export function createMathRenderer({
  bridge,
  maxEntries = 300,
}: {
  bridge: MathRenderer;
  maxEntries?: number;
}): CachedMathRenderer {
  const memory = new Map<string, MathRender>();
  const inFlight = new Map<string, Promise<MathRender>>();
  let closed = false;

  function remember(key: string, result: MathRender) {
    memory.delete(key);
    memory.set(key, result);
    if (memory.size > maxEntries) {
      memory.delete(memory.keys().next().value!);
    }
  }

  return {
    render(tex, display) {
      if (closed) {
        return Promise.reject(new MathRenderError('closed'));
      }
      const key = (display ? 'd:' : 'i:') + tex;
      const hit = memory.get(key);
      if (hit) {
        remember(key, hit);
        return Promise.resolve(hit);
      }
      const active = inFlight.get(key);
      if (active) {
        return active;
      }
      const task = (async () => {
        const result = await bridge.render(tex, display);
        if (!validRender(result)) {
          throw new MathRenderError('invalid');
        }
        if (closed) {
          throw new MathRenderError('closed');
        }
        remember(key, result);
        return result;
      })();
      inFlight.set(key, task);
      const forget = () => {
        if (inFlight.get(key) === task) {
          inFlight.delete(key);
        }
      };
      task.then(forget, forget);
      return task;
    },
    close() {
      closed = true;
      memory.clear();
      inFlight.clear();
    },
  };
}

/** 全局唯一的桥和渲染器：MathHost 挂在 App 根部连接 mathBridge，各处的 MathView 默认用 mathRenderer。 */
export const mathBridge = createMathBridge();
export const mathRenderer = createMathRenderer({ bridge: mathBridge });
