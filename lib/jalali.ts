import { isLeapJalaaliYear, jalaaliMonthLength, toGregorian } from 'jalaali-js';
import type { JalaliDateInfo } from './types';
import { iranWeekday } from './calendar/service';

export const JALALI_MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

export const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

/**
 * API سازگاری برای ماژول‌های solver. محاسبات سنتی حذف شده‌اند و همه تبدیل‌ها
 * توسط jalaali-js، همان موتور Calendar SSOT، انجام می‌شوند.
 */
export const isJalaliLeapYear = (year: number): boolean => isLeapJalaaliYear(year);
export const getJalaliMonthDays = (year: number, month: number): number => jalaaliMonthLength(year, month);
export const jalaliToGregorian = (year: number, month: number, day: number) => toGregorian(year, month, day);
export const getJalaliWeekday = (year: number, month: number, day: number): number => iranWeekday(year, month, day);

/**
 * این تابع فقط adapter الگوریتم زمان‌بندی قدیمی است. تعطیلات و روز آغاز ماه
 * از Calendar Provider وارد می‌شوند و در این فایل هیچ مناسبت hardcode نشده است.
 */
export function generateJalaliMonthCalendar(
  year: number,
  month: number,
  officialHolidays: Record<number, string> = {},
  officialFirstDay?: number
): JalaliDateInfo[] {
  const totalDays = jalaaliMonthLength(year, month);
  const firstDay = officialFirstDay ?? iranWeekday(year, month, 1);
  return Array.from({ length: totalDays }, (_, index) => {
    const day = index + 1;
    const dayOfWeek = (firstDay + index) % 7;
    const isFriday = dayOfWeek === 6;
    const holidayTitle = officialHolidays[day] || (isFriday ? 'جمعه؛ تعطیل هفتگی' : undefined);
    return {
      year, month, day, dayOfWeek, isFriday,
      isHoliday: isFriday || Boolean(officialHolidays[day]),
      holidayTitle
    };
  });
}

export function formatJalaliDateString(year: number, month: number, day: number): string {
  return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}
