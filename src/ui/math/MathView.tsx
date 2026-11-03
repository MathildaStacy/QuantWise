/** 独立公式：离线 MathJax 转出的 SVG，居中，太宽就横向滚动；还没出来或渲染失败时显示原始 TeX。 */
import { useEffect, useMemo, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import { aiColor as c } from '../aiTheme';
import { HorizontalReading } from '../components/HorizontalReading';
import { mathRenderer, type MathRender, type MathRenderer } from './bridge';

/** 与 Markdown 正文同一字号；1ex = 正文字号 × 系统字体缩放 × 0.5（Pagewise 同一规则）。 */
const BODY_SIZE = 16;

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/**
 * 公式编号（\tag{1.1}）拿出来写在公式右边：MathJax 给带编号的公式留出整行宽度、公式摆在中间，
 * 窄屏上第一眼只看到空白。\tag* 原样写，\tag 加括号。
 */
export function splitTag(tex: string): { body: string; tag: string | null } {
  const m = /\\tag(\*?)\s*\{([^{}]*)\}/.exec(tex);
  if (!m) {
    return { body: tex, tag: null };
  }
  return { body: (tex.slice(0, m.index) + tex.slice(m.index + m[0].length)).trim(), tag: m[1] ? m[2].trim() : '(' + m[2].trim() + ')' };
}

export function MathView({
  tex,
  renderer = mathRenderer,
  fontSize = BODY_SIZE,
}: {
  tex: string;
  renderer?: MathRenderer;
  fontSize?: number;
}) {
  const { fontScale } = useWindowDimensions();
  const { body, tag } = useMemo(() => splitTag(tex), [tex]);
  const [done, setDone] = useState<{
    tex: string;
    renderer: MathRenderer;
    value: MathRender;
  } | null>(null);

  useEffect(() => {
    let active = true;
    // 失败（含 3 秒超时）时不更新状态，继续显示原文。
    renderer.render(body, true).then(
      value => {
        if (active) {
          setDone({ tex: body, renderer, value });
        }
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [body, renderer]);

  // 公式或渲染器换了以后，旧结果不再使用。
  const result =
    done && done.tex === body && done.renderer === renderer ? done.value : null;
  const xml = useMemo(
    () => result?.svg.replace(/currentColor/g, c.ink),
    [result],
  );
  const ex = fontSize * fontScale * 0.5;

  return (
    <HorizontalReading
      label="公式"
      spoken={'公式：' + tex}
      contentContainerStyle={s.content}
    >
      {result && xml ? (
        <SvgXml
          xml={xml}
          width={result.width * ex}
          height={result.height * ex}
        />
      ) : (
        <Text selectable style={{ ...s.fallback, fontSize: fontSize - 2, lineHeight: fontSize + 6 }}>
          {body}
        </Text>
      )}
      {tag ? <Text style={[s.tag, { fontSize, lineHeight: fontSize * 1.5 }]}>{tag}</Text> : null}
    </HorizontalReading>
  );
}

const s = StyleSheet.create({
  content: { minWidth: '100%', justifyContent: 'center', alignItems: 'center', paddingVertical: 10 },
  tag: { marginLeft: 12, color: c.ink },
  fallback: { fontFamily: mono, fontSize: 14, lineHeight: 22, color: c.ink },
});
