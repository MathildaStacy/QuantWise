/** 本地 PDF 原页核对：放大、旋转、相邻页与物理页跳转。不会把原页当成 OCR 文字。 */
import { useEffect, useState } from 'react';
import { Image, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Book } from '../../book/types';
import { sourcePageUri } from '../../study/sourcePage';
import { rc } from '../readTheme';

export function PdfSourceSheet({ book, initialPage, onClose }: { book: Book; initialPage: number; onClose: () => void }) {
  const safe = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(initialPage);
  const [input, setInput] = useState(String(initialPage));
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [asset, setAsset] = useState<{ page: number; uri: string; ratio: number } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    setAsset(null);
    sourcePageUri(book, page).then(uri => {
      Image.getSize(uri, (w, h) => {
        if (active) setAsset({ page, uri, ratio: w / h });
      }, () => { if (active) setError('原页图像读取失败，请重试'); });
    }, e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [book, page, attempt]);
  const go = (n: number) => {
    if (!Number.isInteger(n) || n < 1 || (book.pages != null && n > book.pages)) {
      setError('请输入 1–' + (book.pages ?? '末页') + ' 范围内的 PDF 页码');
      return;
    }
    setPage(n); setInput(String(n)); setZoom(1); setTurn(0); setError('');
    Keyboard.dismiss();
  };
  const control = (label: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[st.button, disabled && st.disabled]}><Text style={st.buttonText}>{label}</Text></Pressable>
  );
  const ratio = asset?.ratio ?? 0.707;
  const w = Math.max(1, width - 24) * zoom;
  const h = w / (turn % 2 ? 1 / ratio : ratio);
  const imageW = turn % 2 ? h : w, imageH = turn % 2 ? w : h;
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <View style={[st.screen, { paddingTop: safe.top, paddingBottom: safe.bottom }]}>
      <View style={st.header}><Text accessibilityRole="header" style={st.title}>PDF 原页 · {page} / {book.pages ?? '—'}</Text>{control('关闭原页', onClose)}</View>
      <View style={st.toolbar}>
        {control('上一页', () => go(page - 1), page <= 1)}
        <TextInput accessibilityLabel="PDF 页码" value={input} onChangeText={setInput} onSubmitEditing={() => go(Number(input))} keyboardType="number-pad" selectTextOnFocus style={st.input} />
        {control('跳转', () => go(Number(input)))}
        {control('下一页', () => go(page + 1), book.pages != null && page >= book.pages)}
      </View>
      <View style={st.toolbar}>
        {control('缩小', () => setZoom(n => Math.max(1, n - 1)), zoom === 1)}
        <Text style={st.info}>{zoom * 100}%</Text>
        {control('放大', () => setZoom(n => Math.min(4, n + 1)), zoom === 4)}
        {control('旋转', () => setTurn(n => (n + 1) % 4))}
      </View>
      <Text style={st.hint}>PDF 物理页码；放大后可横向和纵向拖动。跨页内容可翻页核对。</Text>
      {error ? <View style={st.message}><Text style={st.info}>{error}</Text>{control('重试原页', () => setAttempt(n => n + 1))}</View> : null}
      {!asset && !error ? <Text style={st.message}>正在读取本地原页…</Text> : null}
      {asset?.page === page ? <ScrollView key={page + ':' + turn} style={st.body} contentContainerStyle={st.scroll}>
        <ScrollView horizontal nestedScrollEnabled contentContainerStyle={st.scroll}>
          <View style={{ width: w, height: h }}>
            <Image accessibilityLabel={'PDF 第 ' + page + ' 页原图'} source={{ uri: asset.uri }} resizeMode="contain" onError={() => setError('原页图像显示失败，请重试')} style={[st.image, { width: imageW, height: imageH, left: (w - imageW) / 2, top: (h - imageH) / 2, transform: [{ rotate: turn * 90 + 'deg' }] }]} />
          </View>
        </ScrollView>
      </ScrollView> : null}
    </View>
  </Modal>;
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: rc.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  title: { flex: 1, fontSize: 17, fontWeight: '600', color: rc.ink },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 4 },
  button: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', borderRadius: 8, backgroundColor: rc.soft },
  buttonText: { fontSize: 14, color: rc.main },
  disabled: { opacity: 0.4 },
  input: { minWidth: 52, minHeight: 48, padding: 8, fontSize: 16, textAlign: 'center', color: rc.ink, borderWidth: 1, borderColor: rc.line, borderRadius: 8 },
  info: { fontSize: 14, color: rc.ink },
  hint: { fontSize: 12, lineHeight: 19, color: rc.secondary, paddingHorizontal: 12, paddingVertical: 6 },
  message: { padding: 16, gap: 8, color: rc.secondary },
  body: { flex: 1 },
  image: { position: 'absolute' },
  scroll: { flexGrow: 1, alignItems: 'center' },
});
