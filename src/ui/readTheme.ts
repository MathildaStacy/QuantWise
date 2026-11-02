/**
 * 读书和听讲的配色（QUANTWISE_DESIGN.md §6、原型 shell.html 的 QuantWise 部分）：暖白纸色，
 * 原书用宋体、讲解用黑体；主线墨蓝、岔路紫、高亮浅黄、卡点橙。图表沿用红涨绿跌。
 */
import { Platform } from 'react-native';
import { aiColor } from './aiTheme';

export const rc = {
  ...aiColor,
  main: '#2D5BA8',
  mainBg: '#EAF0FA',
  detour: '#7B4FC4',
  detourBg: '#F2ECFB',
  highlight: '#FFF4C2',
  stuck: '#D9730D',
  stuckBg: '#FDF0E3',
  derive: '#EEF3FB',
  deriveInk: '#2D5BA8',
  example: '#FFF6E6',
  exampleInk: '#A15C00',
  real: '#E8F4F1',
  realInk: '#0F7B76',
  web: '#F1EFF4',
  webInk: '#5B5470',
  grid: '#ECEAE4',
  bench: '#77736A',
} as const;

/** 原书正文：Android 的 serif 是思源宋体 / Noto Serif CJK（系统有就用）。 */
export const serif = Platform.select({ ios: 'Songti SC', default: 'serif' });

/** 分组净值从浅到深：Q1（因子最低）最浅，最高组最深；最深一档不到黑色，5 组时 Q4、Q5 还分得清。 */
export const GROUP_COLORS = ['#6688B3', '#5E80AE', '#5578A8', '#4C70A3', '#43689D', '#3A6097', '#315790', '#284D85', '#1D3F75', '#102E63'];

export const groupColor = (g: number, n: number) =>
  GROUP_COLORS[Math.round((g * 9) / Math.max(1, n - 1))];

/** 对比图的几条线。 */
export const SERIES_COLORS = ['#2D5BA8', '#E08A1E', '#0F7B76', '#A65035', '#7B4FC4'];
