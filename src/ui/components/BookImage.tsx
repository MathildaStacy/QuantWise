import { useState } from 'react';
import { Image, StyleSheet } from 'react-native';

/** 原图只做核对；正文插图按比例显示，引用预览保留紧凑高度。 */
export function BookImage({ uri, label, sourcePage, compact = false }: { uri: string; label: string; sourcePage: boolean; compact?: boolean }) {
  const [ratio, setRatio] = useState(sourcePage ? 0.707 : 1.5);
  return <Image source={{ uri }} accessibilityLabel={label} resizeMode="contain" style={[s.image, compact ? s.small : { aspectRatio: ratio }]} onLoad={({ nativeEvent }) => {
    const { width, height } = nativeEvent.source;
    if (width > 0 && height > 0) setRatio(width / height);
  }} />;
}
const s = StyleSheet.create({ image: { width: '100%' }, small: { height: 140 } });
