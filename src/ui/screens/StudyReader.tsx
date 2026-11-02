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
import { PdfSourceSheet } from '../components/PdfSourceSheet';
import { useCore } from '../hooks';
import { rc, serif } from '../readTheme';
import { anchorAt, anchorY, type ReadingAnchor } from '../../study/readingState';
import { canTranslate } from '../../study/translation';
import { useTranslation } from '../../study/useTranslation';
import { TranslatedBlock } from '../components/TranslatedBlock';
import { color } from '../theme';

export function StudyReader({
  s,
  focusSeq,
  onQuick,
  onFinish,
  anchor,
  onAnchor,
  translation = false,
  onTranslation,
  active = true,
  onConfigure,
}: {
  s: StudySession;
  focusSeq?: number;
  onQuick: (k: QuickKind, b: BookBlock) => void;
  onFinish: () => void;
  anchor?: ReadingAnchor;
  onAnchor?: (anchor: ReadingAnchor) => void;
  translation?: boolean;
  onTranslation?: (enabled: boolean) => void;
  active?: boolean;
  onConfigure?: () => void;
}) {
  const core = useCore();
  const bilingual = translation;
  const tr = useTranslation(core, s.book, s.section, s.blocks, active);
  const stopTranslation = tr.stop;
  useEffect(() => { if (!bilingual) stopTranslation(); }, [bilingual, stopTranslation]);
  const eligible = s.blocks.filter(canTranslate);
  const done = eligible.filter(b => tr.entries[b.seq]).length;
  const showTranslation = (enabled: boolean) => {
    onTranslation?.(enabled);
    if (!enabled) tr.stop();
  };
  const [marks, setMarks] = useState<Mark[]>([]);
  const [menu, setMenu] = useState<BookBlock | null>(null);
  const [guide, setGuide] = useState(false);
  const [sourcePage, setSourcePage] = useState<number | null>(null);
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
      {bilingual ? <View style={st.translationBar}>
          <View style={st.translationActions}>
            <Text style={st.translationStatus} accessibilityLiveRegion="polite">{tr.loading ? '正在读取译文…' : eligible.length ?
              (tr.busy ? '翻译中 · ' : tr.stopped ? '已停止 · ' : 'AI 译文 · ') + done + '/' + eligible.length + ' 段' : '本节没有需要翻译的外文段落'}</Text>
            {eligible.length > 0 && !tr.loading && (tr.busy || done < eligible.length || tr.error) ? <Pressable
              style={st.translationButton} accessibilityRole="button" onPress={() => {
                if (tr.busy) tr.stop();
                else if (tr.needsConfig && onConfigure) onConfigure();
                else if (tr.error) tr.retry();
                else tr.run();
              }}><Text style={st.translationButtonText}>{tr.busy ? '停止翻译' : tr.needsConfig ? '配置 AI' : tr.error ? '重试翻译' : done ? '继续翻译' : '翻译本节'}</Text></Pressable> : null}
          </View>
          {tr.error ? <Text accessibilityRole="alert" style={st.translationError}>{tr.error}</Text> : null}
      </View> : null}
      <ScrollView ref={scroll} contentContainerStyle={st.page} scrollEventThrottle={200}
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        onScrollBeginDrag={() => { userMoved.current = true; restored.current = true; }}
        onScroll={rememberScroll}
        onScrollEndDrag={rememberScroll}
        onMomentumScrollEnd={rememberScroll}
        onContentSizeChange={() => { contentReady.current = true; restore(); }}>
        <View onLayout={e => { layouts.current.set(-1, e.nativeEvent.layout); restore(); }}>
        <Text style={st.h}>{secLabel(s.section)}</Text>
        {s.book.format === 'pdf' && s.book.body.dir ? <Pressable style={st.guide} accessibilityRole="button" onPress={() => setSourcePage(s.blocks.find(b => b.seq === focusSeq)?.page ?? s.section.pageFrom ?? 1)}><Text style={st.guideT}>查看 PDF 原页</Text></Pressable> : null}
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
                accessibilityLabel={citeLabel(s.section, b) + '：' + (bilingual && tr.entries[b.seq]
                  ? tr.entries[b.seq].pairs.map(pair => '原文：' + pair.source + '译文：' + pair.translation).join('\n')
                  : b.text)}
              >
                {bilingual && tr.entries[b.seq] ? <TranslatedBlock b={b} pairs={tr.entries[b.seq].pairs} dir={s.book.body.dir} /> : <BookBlockView b={b} dir={s.book.body.dir} />}
                {bilingual && tr.current === b.seq ? <Text style={st.translating}>正在翻译这一段…</Text> : null}
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
            {canTranslate(menu) ? <Pressable style={st.item} accessibilityRole="button" disabled={tr.busy || tr.loading}
              accessibilityState={{ disabled: tr.busy || tr.loading }} onPress={() => {
                const b = menu;
                setMenu(null);
                showTranslation(true);
                tr.run([b]);
              }}><Text style={st.itemT}>{tr.entries[menu.seq] ? '查看中文译文' : tr.busy ? '正在翻译，请稍候' : '翻译这一段'}</Text><Text style={st.itemD}>简体中文，逐句对照原文</Text></Pressable> : null}
            {s.book.format === 'pdf' && s.book.body.dir && menu.page != null ? <Pressable style={st.item} accessibilityRole="button" onPress={() => { setSourcePage(menu.page); setMenu(null); }}><Text style={st.itemT}>查看 PDF 第 {menu.page} 页</Text><Text style={st.itemD}>放大核对公式、图表和跨页内容</Text></Pressable> : null}
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
      {sourcePage != null ? <PdfSourceSheet book={s.book} initialPage={sourcePage} onClose={() => setSourcePage(null)} /> : null}
    </>
  );
}

const st = StyleSheet.create({
  translationBar: { backgroundColor: rc.page, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rc.line },
  translationActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12 },
  translationStatus: { color: rc.secondary, fontSize: 13, lineHeight: 22, paddingVertical: 8, flexShrink: 1 },
  translationButton: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 },
  translationButtonText: { fontSize: 15, color: rc.main, fontWeight: '600' },
  translationError: { color: color.upText, fontSize: 13, lineHeight: 21, paddingBottom: 8 },
  translating: { color: rc.main, fontSize: 13, lineHeight: 22, paddingVertical: 6 },
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
