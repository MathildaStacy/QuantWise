/** Book-only type roles. Keep the shared lecture/chart theme independent. */
import { createContext, useContext } from 'react';
import { Platform, type TextStyle } from 'react-native';
import { DEFAULT_READER, type ReaderPreferences } from '../study/readerPreferences';
import { rc, serif } from './readTheme';

export const ReaderAppearance = createContext<ReaderPreferences>(DEFAULT_READER);

export function useBookTypography() {
  const prefs = useContext(ReaderAppearance);
  const fontFamily = prefs.face === 'serif' ? serif : Platform.select({ ios: 'System', default: 'sans-serif' });
  const body: TextStyle = {
    fontFamily,
    fontSize: prefs.size,
    lineHeight: Math.round(prefs.size * (prefs.leading === 'relaxed' ? 1.95 : 1.7)),
    color: rc.ink,
  };
  return {
    prefs,
    body,
    title: { ...body, fontSize: prefs.size + 6, lineHeight: Math.round((prefs.size + 6) * 1.4), fontWeight: '600' } as TextStyle,
    caption: { ...body, fontSize: prefs.size - 3, lineHeight: Math.round((prefs.size - 3) * 1.6), color: rc.secondary } as TextStyle,
    translation: { ...body, color: '#4D4A44' } as TextStyle,
  };
}
