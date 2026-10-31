/**
 * 闪卡复习（QUANTWISE_DESIGN.md §6.6）：Leitner 5 个盒子，间隔 1 / 3 / 7 / 15 / 30 天。
 * 记得升一盒；模糊留在原盒、按这一盒的间隔再来；忘了回盒 1，明天再来，并把这张卡的问题加进卡点。
 */
import type { DateStr } from '../engine/calendar';

export const BOX_DAYS = [1, 3, 7, 15, 30] as const;
export const DAILY_LIMIT = 30;

export type Rating = 'again' | 'hard' | 'good';

export function addDays(date: DateStr, n: number): DateStr {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function rateCard(
  box: number,
  rating: Rating,
  today: DateStr,
): { box: number; due: DateStr } {
  const next =
    rating === 'good' ? Math.min(5, box + 1) : rating === 'again' ? 1 : box;
  return { box: next, due: addDays(today, BOX_DAYS[next - 1]) };
}

/** 今天要复习的卡：到期的按到期日、再按盒子从低到高，最多 DAILY_LIMIT 张。 */
export function dueToday<T extends { due: DateStr; box: number }>(
  cards: T[],
  today: DateStr,
  limit = DAILY_LIMIT,
): T[] {
  return cards
    .filter(c => c.due <= today)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.box - b.box))
    .slice(0, limit);
}

/** 两个日期隔了几天（b − a）。 */
export function daysBetween(a: DateStr, b: DateStr): number {
  return Math.round(
    (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000,
  );
}
