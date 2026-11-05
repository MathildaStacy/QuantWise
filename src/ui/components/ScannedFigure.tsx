import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AiError } from '../../ai/http';
import type { Book, BookBlock } from '../../book/types';
import { canRedraw, loadFigure, type SavedFigure } from '../../study/figures';
import { rc } from '../readTheme';
import { color } from '../theme';
import { BookFigureView } from './BookFigureView';
import { BookImage } from './BookImage';

/** 一张图的重绘状态和动作：段落菜单（「图表操作」）里的「AI 清晰重绘」用（PM 走查第 2 项）。 */
export interface FigureControl {
  busy: boolean;
  needsConfig: boolean;
  /** 已经重绘过或识别失败过：菜单写「重新识别」。 */
  redone: boolean;
  run: () => void;
  stop: () => void;
}

export const ReaderFigures = createContext<{
  book: Book; blocks: BookBlock[]; active: boolean; redraw: (b: BookBlock, signal: AbortSignal) => Promise<SavedFigure>; onConfigure?: () => void;
  /** 能重绘的图按块序号登记在这里，菜单打开时读当前状态。 */
  controls?: Map<number, () => FigureControl>;
} | null>(null);

/** 书里的插图：原图或 AI 重绘的图，图注紧贴在图下面；重绘的状态（识别中、对照原图、失败）写在图注下面。 */
export function ScannedFigure({ b, uri, compact, caption }: { b: BookBlock; uri: string; compact: boolean; caption?: ReactNode }) {
  const reader = useContext(ReaderFigures);
  // The translated caption preview passes text=""; cache identity always uses the unmodified source block.
  const source = reader?.blocks.find(x => x.seq === b.seq) ?? b;
  const [saved, setSaved] = useState<SavedFigure | null>(null);
  const [original, setOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsConfig, setNeedsConfig] = useState(false);
  const task = useRef<AbortController | null>(null);
  const eligible = !!reader?.book.body.dir && canRedraw(source) && !compact;
  const book = reader?.book;
  useEffect(() => {
    let active = true;
    setSaved(null); setOriginal(false); setError(''); setNeedsConfig(false);
    if (eligible && book) loadFigure(book, source).then(value => { if (active) setSaved(value); })
      .catch(() => { if (active) setError('重绘结果读取失败，可以重新识别'); });
    return () => { active = false; task.current?.abort(); };
  }, [eligible, book, source]);
  useEffect(() => { if (!reader?.active) task.current?.abort(); }, [reader?.active]);
  const run = async () => {
    if (!reader || !reader.active || task.current) return;
    const controller = new AbortController();
    task.current = controller;
    setBusy(true); setError(''); setNeedsConfig(false);
    try {
      const value = await reader.redraw(source, controller.signal);
      if (!controller.signal.aborted) { setSaved(value); setOriginal(false); }
    } catch (e) {
      if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); setNeedsConfig(e instanceof AiError && e.code === 'auth'); }
    } finally { if (task.current === controller) task.current = null; setBusy(false); }
  };
  const control = useRef<FigureControl | null>(null);
  control.current = {
    busy, needsConfig, redone: !!saved || !!error,
    run: () => { if (needsConfig && reader?.onConfigure) reader.onConfigure(); else run().catch(() => undefined); },
    stop: () => task.current?.abort(),
  };
  const controls = reader?.controls;
  useEffect(() => {
    if (!eligible || !controls) return;
    const get = () => control.current!;
    controls.set(source.seq, get);
    return () => { if (controls.get(source.seq) === get) controls.delete(source.seq); };
  }, [eligible, controls, source.seq]);
  const figure = saved?.figure;
  const rendered = figure && figure.kind !== 'unsupported' && !original;
  const status = busy || error || figure;
  return <View style={st.figure}>
    {rendered ? <BookFigureView figure={figure} sourceCaption={source.text} /> : <BookImage uri={uri} label={b.text || '书中插图'} sourcePage={b.image?.startsWith('source-pages/') ?? false} compact={compact} />}
    {caption}
    {eligible && status ? <View style={st.actions}>
      {busy ? <>
        <Text style={st.status} accessibilityLiveRegion="polite">正在识别图表，完成后会保存在本机…</Text>
        <Pressable style={st.button} accessibilityRole="button" onPress={e => { e.stopPropagation(); task.current?.abort(); }}><Text style={st.buttonText}>停止识别</Text></Pressable>
      </> : figure && figure.kind !== 'unsupported' ? <>
        <Text style={st.status}>{original ? '扫描原图' : figure.kind === 'chart' ? 'AI 近似重绘 · 读图估值' : figure.kind === 'table' ? 'AI 识别表格 · 待核对' : 'AI 重绘结构图'}</Text>
        <Pressable style={st.button} accessibilityRole="button" onPress={e => { e.stopPropagation(); setOriginal(v => !v); }}><Text style={st.buttonText}>{original ? '查看重绘' : '对照原图'}</Text></Pressable>
      </> : figure?.kind === 'unsupported' ? <Text style={st.status}>暂时保留原图：{figure.reason}</Text> : null}
      {error && !busy ? <>
        <Text style={st.error} accessibilityRole="alert">{error}</Text>
        {needsConfig && reader?.onConfigure ? <Pressable style={st.button} accessibilityRole="button" onPress={e => { e.stopPropagation(); reader.onConfigure?.(); }}><Text style={st.buttonText}>配置 AI</Text></Pressable> : null}
      </> : null}
    </View> : null}
  </View>;
}

const st = StyleSheet.create({
  figure: { gap: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 16, marginTop: -4 },
  status: { color: rc.secondary, fontSize: 12, lineHeight: 20, flexShrink: 1 },
  button: { minHeight: 48, justifyContent: 'center' },
  buttonText: { fontSize: 13, color: rc.main, fontWeight: '500' },
  error: { color: color.upText, fontSize: 13, lineHeight: 20 },
});
