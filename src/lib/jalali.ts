export const JALALI_MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

export const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

export function isJalaliLeapYear(jy: number): boolean {
  const r = (jy - 474) % 2820;
  return (((r + 38) * 31) % 128) < 31;
}

export function getJalaliMonthDays(year: number, month: number): number {
  if (month >= 1 && month <= 6) return 31;
  if (month >= 7 && month <= 11) return 30;
  if (month === 12) return isJalaliLeapYear(year) ? 30 : 29;
  return 30;
}

export function jalaliToGregorian(jy: number, jm: number, jd: number) {
  const jy2 = jy - 979;
  const jm2 = jm - 1;
  const jd2 = jd - 1;

  let jDays = jy2 * 365 + Math.floor(jy2 / 33) * 8 + Math.floor(((jy2 % 33) + 3) / 4);
  for (let i = 0; i < jm2; ++i) jDays += i < 6 ? 31 : 30;
  jDays += jd2;

  let gDays = jDays + 79 * 365 + 19 + Math.floor(79 / 4) - Math.floor(79 / 100) + Math.floor(79 / 400);
  let gy = 1600 + 400 * Math.floor(gDays / 146097);
  gDays %= 146097;

  let leap = true;
  if (gDays >= 36525) {
    gDays--;
    gy += 100 * Math.floor(gDays / 36524);
    gDays %= 36524;
    if (gDays >= 365) gDays++;
    else leap = false;
  }

  gy += 4 * Math.floor(gDays / 1461);
  gDays %= 1461;

  if (gDays >= 366) {
    leap = false;
    gDays--;
    gy += Math.floor(gDays / 365);
    gDays %= 365;
  }

  const gDaysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  while (gDays >= gDaysInMonth[gm]) {
    gDays -= gDaysInMonth[gm];
    gm++;
  }

  return { gy, gm: gm + 1, gd: gDays + 1 };
}

export function gregorianToJalali(gy: number, gm: number, gd: number) {
  const gDaysInMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + gDaysInMonth[gm - 1];
  let jy = -1595 + (33 * Math.floor(days / 12053));
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let jm: number;
  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    const jd = 1 + (days % 31);
    return { jy, jm, jd };
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    const jd = 1 + ((days - 186) % 30);
    return { jy, jm, jd };
  }
}

export function getJalaliWeekday(jy: number, jm: number, jd: number): number {
  const { gy, gm, gd } = jalaliToGregorian(jy, jm, jd);
  const date = new Date(gy, gm - 1, gd);
  const day = date.getDay();
  const map: { [key: number]: number } = { 6: 0, 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 };
  return map[day];
}

export function generateJalaliMonthCalendar(
  year: number,
  month: number,
  customHolidays: { [day: number]: string } = {},
  firstDayOfWeekIndex?: number
): import("./types").JalaliDateInfo[] {
  const totalDays = getJalaliMonthDays(year, month);
  const calendar: import("./types").JalaliDateInfo[] = [];

  for (let day = 1; day <= totalDays; day++) {
    const dayOfWeek = firstDayOfWeekIndex !== undefined
      ? (firstDayOfWeekIndex + day - 1) % 7
      : getJalaliWeekday(year, month, day);
    const isFriday = dayOfWeek === 6;
    const holidayTitle = customHolidays[day] || (isFriday ? 'جمعه (تعطیل هفتگی)' : undefined);
    const isHoliday = isFriday || !!customHolidays[day];

    calendar.push({ year, month, day, dayOfWeek, isFriday, isHoliday, holidayTitle });
  }

  return calendar;
}

export function formatJalaliDateString(year: number, month: number, day: number): string {
  const mStr = month < 10 ? `0${month}` : `${month}`;
  const dStr = day < 10 ? `0${day}` : `${day}`;
  return `${year}/${mStr}/${dStr}`;
}

export function getCurrentJalaliDate(): { year: number; month: number; day: number } {
  try {
    const parts = new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
      year: 'numeric', month: 'numeric', day: 'numeric',
      timeZone: 'Asia/Tehran'
    }).format(new Date()).split('/');
    return {
      year: parseInt(parts[0], 10),
      month: parseInt(parts[1], 10),
      day: parseInt(parts[2], 10)
    };
  } catch {
    return { year: 1404, month: 1, day: 1 };
  }
}

export function toPersianDigits(num: number | string): string {
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(num).replace(/[0-9]/g, (d) => persianDigits[parseInt(d)]);
}
