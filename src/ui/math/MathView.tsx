/** 独立公式：离线 MathJax 转出的 SVG，居中，太宽就横向滚动；还没出来或渲染失败时显示原始 TeX。 */
import { useEffect, useMemo, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import { aiColor as c } from '../aiTheme';
import { mathRenderer, type MathRender, type MathRenderer } from './bridge';

/** 与 Markdown 正文同一字号；1ex = 正文字号 × 系统字体缩放 × 0.5（Pagewise 同一规则）。 */
const BODY_SIZE = 16;

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export function MathView({
  tex,
  renderer = mathRenderer,
}: {
  tex: string;
  renderer?: MathRenderer;
}) {
  const { fontScale } = useWindowDimensions();
  const [done, setDone] = useState<{
    tex: string;
    renderer: MathRenderer;
    value: MathRender;
  } | null>(null);

  useEffect(() => {
    let active = true;
    // 失败（含 3 秒超时）时不更新状态，继续显示原文。
    renderer.render(tex, true).then(
      value => {
        if (active) {
          setDone({ tex, renderer, value });
        }
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [tex, renderer]);

  // 公式或渲染器换了以后，旧结果不再使用。
  const result =
    done && done.tex === tex && done.renderer === renderer ? done.value : null;
  const xml = useMemo(
    () => result?.svg.replace(/currentColor/g, c.ink),
    [result],
  );
  const ex = BODY_SIZE * fontScale * 0.5;

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      accessible
      accessibilityRole="text"
      accessibilityLabel={'公式：' + tex}
      contentContainerStyle={s.content}
    >
      {result && xml ? (
        <SvgXml
          xml={xml}
          width={result.width * ex}
          height={result.height * ex}
        />
      ) : (
        <Text selectable style={s.fallback}>
          {tex}
        </Text>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { minWidth: '100%', justifyContent: 'center', paddingVertical: 10 },
  fallback: { fontFamily: mono, fontSize: 14, lineHeight: 22, color: c.ink },
});
