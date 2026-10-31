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
  grid: '#ECEAE4',
  bench: '#9A968D',
} as const;

/** 原书正文：Android 的 serif 是思源宋体 / Noto Serif CJK（系统有就用）。 */
export const serif = Platform.select({ ios: 'Songti SC', default: 'serif' });

/** 分组净值从浅到深：Q1（因子最低）最浅，最高组最深。 */
export const GROUP_COLORS = ['#C9D6EA', '#9DB4D8', '#6F90C4', '#456CAD', '#1F4A8F', '#0F3170', '#082356', '#041640', '#020E2D', '#01081C'];

export const groupColor = (g: number, n: number) =>
  GROUP_COLORS[Math.round((g * 9) / Math.max(1, n - 1))];

/** 对比图的几条线。 */
export const SERIES_COLORS = ['#2D5BA8', '#E08A1E', '#0F7B76', '#A65035', '#7B4FC4'];
