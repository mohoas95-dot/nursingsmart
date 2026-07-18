import { jalaaliMonthLength, toGregorian } from 'jalaali-js';
import type { JalaliDateInfo } from '../types';

export interface OfficialCalendarPayload {
  year: number;
  month: number;
  holidays: Record<number, string>;
  occasions: Record<number, string[]>;
  source: string;
  online: true;
  syncedAt: string;
}

export interface OfficialMonth {
  year: number;
  month: number;
  days: JalaliDateInfo[];
  holidays: Record<number, string>;
  occasions: Record<number, string[]>;
  firstDayOfWeek: number;
  syncedAt: string;
}

/** تبدیل weekday جاوااسکریپت به ترتیب رسمی ایران: شنبه=۰ ... جمعه=۶ */
export function iranWeekday(year: number, month: number, day: number): number {
  const gregorian = toGregorian(year, month, day);
  return (new Date(Date.UTC(gregorian.gy, gregorian.gm - 1, gregorian.gd)).getUTCDay() + 1) % 7;
}

export function buildOfficialMonth(payload: OfficialCalendarPayload): OfficialMonth {
  const count = jalaaliMonthLength(payload.year, payload.month);
  const days: JalaliDateInfo[] = Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    const dayOfWeek = iranWeekday(payload.year, payload.month, day);
    const isFriday = dayOfWeek === 6;
    const holidayTitle = payload.holidays[day] || (isFriday ? 'جمعه؛ تعطیل هفتگی' : undefined);
    return { year: payload.year, month: payload.month, day, dayOfWeek, isFriday, isHoliday: isFriday || Boolean(payload.holidays[day]), holidayTitle };
  });
  return { ...payload, days, firstDayOfWeek: days[0].dayOfWeek };
}

export async function fetchOfficialMonth(year: number, month: number, signal?: AbortSignal): Promise<OfficialMonth> {
  const response = await fetch(`/api/calendar?year=${year}&month=${month}&provider=bahesab-v1`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('OFFICIAL_CALENDAR_UNAVAILABLE');
  const payload = await response.json() as OfficialCalendarPayload;
  if (!payload.online || payload.year !== year || payload.month !== month) throw new Error('INVALID_OFFICIAL_CALENDAR');
  return buildOfficialMonth(payload);
}
