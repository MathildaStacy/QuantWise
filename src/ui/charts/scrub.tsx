/**
 * 卡片和全屏图的触摸看数（docs/design/ai-lecture-charts.md §2.6），和个股页的图（ChartInspector）同一套手势：
 * - 点一下：松手那一天出十字线。
 * - 按住一会儿或左右拖动：十字线跟着手指走，手指往哪个方向移都只看横坐标，页面不滚；松手后十字线留着。
 * - 一开始就上下滑：交给页面滚动，不出十字线（按住时先画出来的也收回去）。
 * 两层 View：里层先接住触摸、不拦页面滚动；要跟手时外层抢过来并拦住页面滚动（RN 只在接手那一刻决定拦不拦原生滚动，
 * 所以要换一层来接）。手指移出图外时 locationX 不再以图为准，所以按下时记下图左边在页面里的位置，之后都用 pageX 换算。
 * 外层要等下一次手指移动才接得过来，按住后第一下就移得很快时原生滚动会抢先：图放在 LockScroll 里时，按住到时间那一刻
 * 就把外面的滚动锁上（和个股页 StockScreen 的 scrollEnabled 一个意思）。
 * full：全屏一按下就出十字线、跟着走（专门看图的页面，不怕误触）；上下滑照样滚页面。
 */
import { createContext, useContext, useEffect, useRef, useState, type Ref } from 'react';
import { ScrollView, type GestureResponderEvent, type ScrollViewInstance, type ScrollViewProps } from 'react-native';

const Lock = createContext<(locked: boolean) => void>(() => undefined);

/** 放图表卡片的滚动容器：图上按住或拖动看数时锁住滚动，松手解开。只重画这个容器自己，里面的内容不重画。 */
export function LockScroll({ scrollEnabled = true, ...props }: ScrollViewProps & { ref?: Ref<ScrollViewInstance> }) {
  const [locked, setLocked] = useState(false);
  return (
    <Lock.Provider value={setLocked}>
      <ScrollView {...props} scrollEnabled={scrollEnabled && !locked} />
    </Lock.Provider>
  );
}

/** 按住多久开始跟手：比 Android 判定轻点的 100ms 长，比长按的 400ms 短。 */
export const HOLD_MS = 200;
/** 按住时手指抖动不超过这么多 dp 还算按住。 */
const STILL = 4;
/** 横向拖过这么多 dp、而且明显比竖向多，就开始跟手。 */
const SWIPE = 6;

interface Touch {
  /** 图左边在页面里的横坐标。 */
  origin: number;
  x: number;
  y: number;
  lastX: number;
  /** 按住到时间了：之后往哪个方向移都跟手。 */
  armed: boolean;
  /** 外层接手了，页面不滚。 */
  scrub: boolean;
  /** 按下前的十字线：按住后被页面滚动抢走时还原。 */
  before: number | null;
}

export function useScrub(opts: {
  full: boolean;
  pick: number | null;
  /** 手指在图里的横坐标。 */
  move: (x: number) => void;
  restore: (pick: number | null) => void;
}) {
  const cb = useRef(opts);
  cb.current = opts;
  const t = useRef<Touch | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 手指还在图上：图顶上浮一个读数牌（图下的读数这时被手挡住）
  const [live, setLive] = useState(false);
  // 外面 LockScroll 的开关（不在 LockScroll 里时什么也不做）；放进 ref，卸下时也拿得到
  const scrollLock = useContext(Lock);
  const lockScroll = useRef(scrollLock);
  lockScroll.current = scrollLock;
  const locked = useRef(false);
  const lock = (on: boolean) => {
    if (locked.current !== on) {
      locked.current = on;
      lockScroll.current(on);
    }
  };
  const stopTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const end = () => {
    stopTimer();
    t.current = null;
    setLive(false);
    lock(false);
  };
  useEffect(() => () => {
    stopTimer();
    lock(false);
  }, []);
  const at = (e: GestureResponderEvent) => e.nativeEvent.pageX - (t.current?.origin ?? 0);
  const inner = {
    onStartShouldSetResponder: () => true,
    onResponderGrant: (e: GestureResponderEvent) => {
      const { pageX, pageY, locationX } = e.nativeEvent;
      t.current = { origin: pageX - locationX, x: pageX, y: pageY, lastX: pageX, armed: false, scrub: false, before: cb.current.pick };
      if (cb.current.full) {
        setLive(true);
        cb.current.move(locationX);
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        const s = t.current;
        if (s) {
          s.armed = true;
          lock(true);
          setLive(true);
          cb.current.move(s.lastX - s.origin);
        }
      }, HOLD_MS);
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const s = t.current;
      if (!s) {
        return;
      }
      const { pageX, pageY } = e.nativeEvent;
      s.lastX = pageX;
      if (Math.abs(pageX - s.x) > STILL || Math.abs(pageY - s.y) > STILL) {
        stopTimer();
      }
      if (cb.current.full) {
        cb.current.move(at(e));
      }
    },
    onResponderRelease: (e: GestureResponderEvent) => {
      if (t.current && !t.current.armed && !cb.current.full) {
        cb.current.move(at(e));
      }
      end();
    },
    onResponderTerminate: () => {
      const s = t.current;
      if (s?.scrub) {
        return;
      }
      // 页面滚动抢走了：卡片里按住时先画出来的十字线收回去
      if (s?.armed && !cb.current.full) {
        cb.current.restore(s.before);
      }
      end();
    },
  };
  const outer = {
    onMoveShouldSetResponderCapture: (e: GestureResponderEvent) => {
      const s = t.current;
      if (!s) {
        return false;
      }
      const dx = Math.abs(e.nativeEvent.pageX - s.x);
      const dy = Math.abs(e.nativeEvent.pageY - s.y);
      return s.armed || (dx > SWIPE && dx > dy * 1.2);
    },
    // 返回 true：接手的同时拦住页面滚动
    onResponderGrant: (e: GestureResponderEvent) => {
      if (t.current) {
        t.current.scrub = true;
      }
      stopTimer();
      lock(true);
      setLive(true);
      cb.current.move(at(e));
      return true;
    },
    onResponderMove: (e: GestureResponderEvent) => cb.current.move(at(e)),
    onResponderRelease: end,
    onResponderTerminate: end,
    onResponderTerminationRequest: () => false,
  };
  return { inner, outer, live };
}
