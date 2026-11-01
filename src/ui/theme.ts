/** 颜色和字号，取值来自原型 docs/design/prototype/shell.html。V1 只做浅色，深色以后补。 */
import type { TextStyle } from 'react-native';
import type { Trend } from './format';

export const color = {
  up: '#E5322D',
  upBg: '#FDECEC',
  down: '#0E9F5B',
  downBg: '#E6F6EE',
  flat: '#A3A8B0',
  upText: '#C92725',
  downText: '#087D46',
  sell: '#2468E0',
  learn: '#2D5BA8',
  learnBg: '#EAF0FA',
  learnLine: '#CDDDF4',
  warn: '#E07800',
  warnBg: '#FFF3E0',
  warnInk: '#8A4B00',
  ink: '#1F2329',
  ink2: '#5C626B',
  ink3: '#666C75',
  line: '#ECEDEF',
  bg: '#F3F4F6',
  card: '#FFFFFF',
  press: '#F7F8FA',
  grid: '#EEF0F2',
  // 图表
  priceLine: '#2B6DE5',
  avgLine: '#F0A030',
  ma5: '#F0A030',
  ma10: '#8A4FD8',
  ma20: '#2B6DE5',
  baseLine: '#C9CDD2',
  // 板块标签
  cyb: '#C2410C',
  cybLine: '#F5C9A9',
  kcb: '#7C3AED',
  kcbLine: '#D7C6FA',
  etf: '#0369A1',
  etfLine: '#B9DDF2',
} as const;

export const trendColor: Record<Trend, string> = {
  up: color.upText,
  down: color.downText,
  flat: color.ink2,
};

/** 数字一律等宽，列表里上下对齐。 */
export const num: TextStyle = { fontVariant: ['tabular-nums'] };

export const PAD = 14;
