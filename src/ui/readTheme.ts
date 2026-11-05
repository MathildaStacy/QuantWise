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
  // 行情图的重点区间（docs/design/ai-lecture-charts.md §2.6）：和读书高亮同一族的浅黄底，琥珀色边线
  focus: '#FFF1BF',
  focusEdge: '#D19A12',
  focusTag: '#FCE4A0',
  focusInk: '#6B4A00',
  /** 均线：紫色，在白底和黄色区间上都看得清。 */
  maLine: '#7B4FC4',
  bandLine: '#8FA8D0',
  /** 各组收益图上书里的数（空心点）：暗琥珀色，和蓝色的柱子、锈红的多空分得开。 */
  book: '#9A6400',
  /** 元标签图的慢均线：橙色虚线，和紫色的快线分得开。 */
  slowLine: '#E08A1E',
} as const;

/** 原书正文：Android 的 serif 是思源宋体 / Noto Serif CJK（系统有就用）。 */
export const serif = Platform.select({ ios: 'Songti SC', default: 'serif' });

/**
 * 分组净值从浅到深：Q1（因子最低）最浅，最高组最深。深浅拉开（浅端仍有 3:1 以上的对比度），
 * 中间几组的色相也从青蓝慢慢转到靛蓝，5 组时 Q2、Q3、Q4 分得开；默认只画最高、最低两组。
 */
export const GROUP_COLORS = ['#4A98BC', '#448BB8', '#407EB3', '#3D70AC', '#3A63A4', '#38569B', '#374990', '#363D84', '#353177', '#34266A'];

export const groupColor = (g: number, n: number) =>
  GROUP_COLORS[Math.round((g * 9) / Math.max(1, n - 1))];

/** 对比图的几条线。 */
export const SERIES_COLORS = ['#2D5BA8', '#E08A1E', '#0F7B76', '#A65035', '#7B4FC4'];
