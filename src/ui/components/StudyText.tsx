/**
 * 伴读讲解的正文（QUANTWISE_DESIGN.md §6.5）：引用按钮、「未核实」、补充推导 / AI 举例 / 真实行情 / 网页资料底色块、独立公式。
 * 段落、列表、表格交给 Markdown 组件。
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CALLOUT_LABEL, parseStudyText, type CiteCheck, type Seg } from '../../book/markup';
import { MathView } from '../math/MathView';
import { rc } from '../readTheme';
import { color } from '../theme';
import { Markdown } from './Markdown';

const CALLOUT_STYLE = {
  derive: { bg: rc.derive, ink: rc.deriveInk },
  example: { bg: rc.example, ink: rc.exampleInk },
  real: { bg: rc.real, ink: rc.realInk },
  web: { bg: rc.web, ink: rc.webInk },
} as const;

/** 对话里还没有行情工具算出的数据时，「真实行情」块里的数字是模型自己写的：换成提醒样式。 */
const UNCHECKED = { bg: color.warnBg, ink: color.warnInk, label: '行情未核对' };

function Segs({ segs, onLink, realChecked }: { segs: Seg[]; onLink: (href: string) => void; realChecked: boolean }) {
  return (
    <>
      {segs.map((g, i) =>
        g.t === 'md' ? (
          <Markdown key={i} text={g.text} onLink={onLink} />
        ) : g.t === 'eq' ? (
          <View key={i} style={s.eq}>
            {g.open ? <Text style={s.raw}>{g.tex}</Text> : <MathView tex={g.tex} />}
          </View>
        ) : g.kind === 'real' && !realChecked ? (
          <View key={i} style={[s.callout, { backgroundColor: UNCHECKED.bg }]} accessibilityLabel={UNCHECKED.label}>
            <Text style={[s.tag, { color: UNCHECKED.ink }]}>{UNCHECKED.label}</Text>
            <Segs segs={g.segs} onLink={onLink} realChecked={realChecked} />
            <Text style={[s.note, { color: UNCHECKED.ink }]}>这段数字没有经过行情工具计算，可能不准；点「用真实行情举例」让 AI 现算并画图。</Text>
          </View>
        ) : (
          <View key={i} style={[s.callout, { backgroundColor: CALLOUT_STYLE[g.kind].bg }]} accessibilityLabel={CALLOUT_LABEL[g.kind]}>
            <Text style={[s.tag, { color: CALLOUT_STYLE[g.kind].ink }]}>{CALLOUT_LABEL[g.kind]}</Text>
            <Segs segs={g.segs} onLink={onLink} realChecked={realChecked} />
          </View>
        ),
      )}
    </>
  );
}

export function StudyText({
  text,
  check,
  onLink,
  streaming = false,
  realChecked = true,
}: {
  text: string;
  check: CiteCheck;
  onLink: (href: string) => void;
  streaming?: boolean;
  /** 这段讲解之前（含这一问）有没有成功调用过行情、因子工具；没有时「真实行情」标成未核对。 */
  realChecked?: boolean;
}) {
  const segs = useMemo(() => parseStudyText(text, check, streaming), [text, check, streaming]);
  return (
    <View>
      <Segs segs={segs} onLink={onLink} realChecked={realChecked} />
    </View>
  );
}

const s = StyleSheet.create({
  eq: { marginVertical: 8 },
  raw: { fontFamily: 'monospace', fontSize: 14, color: rc.secondary, textAlign: 'center' },
  callout: { borderRadius: 10, paddingHorizontal: 12, paddingTop: 22, paddingBottom: 4, marginVertical: 8 },
  tag: { position: 'absolute', top: 6, left: 12, fontSize: 11, fontWeight: '600' },
  note: { fontSize: 12, lineHeight: 18, paddingBottom: 6 },
});
