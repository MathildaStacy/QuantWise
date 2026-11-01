/**
 * 读书模式（QUANTWISE_DESIGN.md §6.6）：重排显示当前小节的块。讲过的块左侧细线，当前这一步浅色底，
 * 高亮浅黄，问过的段落下面贴便签。点一段出菜单：解释、从这里开始讲、用真实行情举例、高亮。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { citeLabel, secLabel } from '../../book/book';
import type { BookBlock } from '../../book/types';
import { marksOf, toggleHighlight, type Mark } from '../../data/studyRepo';
import { beijingIso } from '../../market/clock';
import type { QuickKind } from '../../study/quick';
import { progressNow, type StudySession } from '../../study/session';
import { AiSheet } from '../components/AiOptions';
import { BookBlockView } from '../components/BookBlock';
import { useCore } from '../hooks';
import { rc, serif } from '../readTheme';
import { anchorAt, anchorY, type ReadingAnchor } from '../../study/readingState';

export function StudyReader({
  s,
  focusSeq,
  onQuick,
  onFinish,
  anchor,
  onAnchor,
}: {
  s: StudySession;
  focusSeq?: number;
  onQuick: (k: QuickKind, b: BookBlock) => void;
  onFinish: () => void;
  anchor?: ReadingAnchor;
  onAnchor?: (anchor: ReadingAnchor) => void;
}) {
  const core = useCore();
  const [marks, setMarks] = useState<Mark[]>([]);
  const [menu, setMenu] = useState<BookBlock | null>(null);
  const [guide, setGuide] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const layouts = useRef(new Map<number, { y: number; height: number }>());
  const restored = useRef(false);
  const initialAnchor = useRef(anchor);
  const contentReady = useRef(false);
  const userMoved = useRef(false);
  const restore = useCallback(() => {
    if (userMoved.current || !contentReady.current) return;
    const seq = focusSeq ?? initialAnchor.current?.id;
    if (seq == null) { restored.current = true; return; }
    const box = layouts.current.get(seq);
    if (!box) return;
    scroll.current?.scrollTo({ y: focusSeq == null && initialAnchor.current ? anchorY(initialAnchor.current, box) : Math.max(0, box.y - 40), animated: false });
    restored.current = true;
  }, [focusSeq]);
  useEffect(() => {
    restored.current = false;
    userMoved.current = false;
    restore();
  }, [restore]);
  const reload = useCallback(() => {
    marksOf(core.db, s.book.id).then(setMarks).catch(() => undefined);
  }, [core, s.book.id]);
  useEffect(reload, [reload, s.messages.length]);
  const p = progressNow(s);
  const cur = s.steps[s.state.step];
  const taughtTo = s.steps[p.taught]?.to ?? 0;
  const hl = new Set(marks.filter(m => m.kind === 'highlight').map(m => m.blockSeq));
  const pins = (seq: number) => marks.filter(m => m.kind === 'pin' && m.blockSeq === seq);
  const pick = (k: QuickKind) => {
    const b = menu!;
    setMenu(null);
    onQuick(k, b);
  };
  const rememberScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // 公式异步改变高度时，程序恢复的滚动事件不能反过来改写原锚点。
    if (!restored.current || !userMoved.current) return;
    const next = anchorAt(layouts.current, e.nativeEvent.contentOffset.y);
    if (next) onAnchor?.(next);
  };
  return (
    <>
      <ScrollView ref={scroll} contentContainerStyle={st.page} scrollEventThrottle={200}
        onScrollBeginDrag={() => { userMoved.current = true; restored.current = true; }}
        onScroll={rememberScroll}
        onScrollEndDrag={rememberScroll}
        onMomentumScrollEnd={rememberScroll}
        onContentSizeChange={() => { contentReady.current = true; restore(); }}>
        <View onLayout={e => { layouts.current.set(-1, e.nativeEvent.layout); restore(); }}>
        <Text style={st.h}>{secLabel(s.section)}</Text>
        <Pressable style={st.guide} onPress={() => setGuide(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: guide }}>
          <Text style={st.guideT}>本节讲什么 · {s.steps.length} 步 {guide ? '▴' : '▾'}</Text>
          {guide ? s.steps.map(x => <Text key={x.index} style={st.guideI}>{x.index + 1}. {x.title}</Text>) : null}
        </Pressable>
        </View>
        {s.blocks.map(b => {
          const isCur = p.taught >= 0 && cur && b.no >= cur.from && b.no <= cur.to;
          return (
            <View
              key={b.seq}
              onLayout={e => {
                layouts.current.set(b.seq, e.nativeEvent.layout);
                restore();
              }}
            >
              <Pressable
                onPress={() => setMenu(b)}
                style={[st.blk, b.no <= taughtTo && st.taught, isCur && st.cur, hl.has(b.seq) && st.hl, b.seq === focusSeq && st.focus]}
                accessibilityRole="button"
                accessibilityLabel={citeLabel(s.section, b) + '：' + b.text.slice(0, 60)}
              >
                <BookBlockView b={b} dir={s.book.body.dir} />
                <Text style={st.no}>¶{b.no}</Text>
              </Pressable>
              {pins(b.seq).map(m => (
                <Text key={m.id} style={st.pin}>已问：{m.text}</Text>
              ))}
            </View>
          );
        })}
        <Pressable style={st.finish} onPress={onFinish} accessibilityRole="button">
          <Text style={st.finishT}>读完这一节</Text>
        </Pressable>
      </ScrollView>
      <AiSheet title={menu ? citeLabel(s.section, menu) : ''} visible={!!menu} onClose={() => setMenu(null)}>
        {menu ? (
          <View>
            <Text style={st.quote} numberOfLines={4}>{menu.text}</Text>
            {(
              [
                ['explainBlock', '解释这一段', '200 字以内，在听讲里答'],
                ['fromBlock', '从这里开始讲', '切到听讲，从这一段所在的那一步讲起'],
                ['realBlock', '用真实行情举例', '画图、算因子，数字都从本地日线现算'],
              ] as [QuickKind, string, string][]
            ).map(([k, l, d]) => (
              <Pressable key={k} style={st.item} onPress={() => pick(k)} accessibilityRole="button">
                <Text style={st.itemT}>{l}</Text>
                <Text style={st.itemD}>{d}</Text>
              </Pressable>
            ))}
            <Pressable
              style={st.item}
              onPress={() => {
                toggleHighlight(core.db, s.book.id, menu.seq, beijingIso()).then(reload);
                setMenu(null);
              }}
              accessibilityRole="button"
            >
              <Text style={st.itemT}>{hl.has(menu.seq) ? '取消高亮' : '高亮'}</Text>
              <Text style={st.itemD}>高亮会出现在笔记里</Text>
            </Pressable>
          </View>
        ) : null}
      </AiSheet>
    </>
  );
}

const st = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 40, backgroundColor: rc.page },
  h: { fontSize: 20, fontWeight: '600', color: rc.ink, marginBottom: 8 },
  guide: { minHeight: 48, justifyContent: 'center', backgroundColor: rc.soft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 12, gap: 3 },
  guideT: { fontSize: 13, color: rc.secondary },
  guideI: { fontSize: 13, color: rc.secondary, lineHeight: 20 },
  blk: { paddingLeft: 10, paddingRight: 24, paddingVertical: 2, marginVertical: 4, borderLeftWidth: 2, borderLeftColor: 'transparent', borderRadius: 2 },
  taught: { borderLeftColor: 'rgba(45,91,168,0.35)' },
  cur: { backgroundColor: rc.mainBg, borderLeftColor: rc.main },
  hl: { backgroundColor: rc.highlight },
  focus: { borderLeftColor: rc.accent },
  no: { position: 'absolute', right: 0, top: 6, fontSize: 10, color: rc.muted },
  pin: { alignSelf: 'flex-start', marginLeft: 12, marginBottom: 8, fontSize: 12, color: rc.detour, backgroundColor: rc.detourBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  finish: { minHeight: 48, justifyContent: 'center', marginTop: 20, backgroundColor: rc.main, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  finishT: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  quote: { marginHorizontal: 16, marginBottom: 8, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: rc.line, fontFamily: serif, fontSize: 14, lineHeight: 23, color: rc.secondary },
  item: { paddingHorizontal: 16, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: rc.line },
  itemT: { fontSize: 15, color: rc.ink },
  itemD: { fontSize: 12, color: rc.muted, marginTop: 2 },
});
