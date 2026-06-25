export const JALALI_MONTH_NAMES = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند'
];

export const WEEKDAYS = [
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنج‌شنبه',
  'جمعه'
];

// Helper to check if a Jalali year is a leap year
export function isJalaliLeapYear(jy: number): boolean {
  const r = (jy - 474) % 2820;
  return (((r + 38) * 31) % 128) < 31;
}

// Get number of days in a Jalali month
export function getJalaliMonthDays(year: number, month: number): number {
  if (month >= 1 && month <= 6) return 31;
  if (month >= 7 && month <= 11) return 30;
  if (month === 12) {
    return isJalaliLeapYear(year) ? 30 : 29;
  }
  return 30;
}

// Convert Jalali to Gregorian to get the correct English Date and Day of Week
export function jalaliToGregorian(jy: number, jm: number, jd: number) {
  const jy2 = jy - 979;
  const jm2 = jm - 1;
  const jd2 = jd - 1;

  let jDays = jy2 * 365 + Math.floor(jy2 / 33) * 8 + Math.floor(((jy2 % 33) + 3) / 4);
  for (let i = 0; i < jm2; ++i) {
    jDays += i < 6 ? 31 : 30;
  }
  jDays += jd2;

  let gDays = jDays + 79 * 365 + 19 + Math.floor(79 / 4) - Math.floor(79 / 100) + Math.floor(79 / 400);
  let gy = 1600 + 400 * Math.floor(gDays / 146097);
  gDays %= 146097;

  let leap = true;
  if (gDays >= 36525) {
    gDays--;
    gy += 100 * Math.floor(gDays / 36524);
    gDays %= 36524;
    if (gDays >= 365) {
      gDays++;
    } else {
      leap = false;
    }
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

  return {
    gy,
    gm: gm + 1,
    gd: gDays + 1
  };
}

// Get weekday index (0 = Saturday, 1 = Sunday, ..., 6 = Friday)
export function getJalaliWeekday(jy: number, jm: number, jd: number): number {
  const { gy, gm, gd } = jalaliToGregorian(jy, jm, jd);
  const date = new Date(gy, gm - 1, gd);
  const day = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  
  // Map standard Date.getDay() (0=Sun, 1=Mon, ..., 6=Sat) to (0=Sat, 1=Sun, ..., 6=Fri)
  const map: { [key: number]: number } = {
    6: 0, // Saturday
    0: 1, // Sunday
    1: 2, // Monday
    2: 3, // Tuesday
    3: 4, // Wednesday
    4: 5, // Thursday
    5: 6  // Friday
  };
  return map[day];
}

// Generate the whole month calendar list
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

    calendar.push({
      year,
      month,
      day,
      dayOfWeek,
      isFriday,
      isHoliday,
      holidayTitle
    });
  }

  return calendar;
}

// Format date to string like "1405/03/15"
export function formatJalaliDateString(year: number, month: number, day: number): string {
  const mStr = month < 10 ? `0${month}` : `${month}`;
  const dStr = day < 10 ? `0${day}` : `${day}`;
  return `${year}/${mStr}/${dStr}`;
}
