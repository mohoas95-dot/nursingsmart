export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 335];
  let gy2 = (gm > 2) ? (gy + 1) : gy;
  let g_day_no = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  let jy = 979 + 33 * Math.floor(g_day_no / 12053) + 4 * Math.floor((g_day_no % 12053) / 1461);
  g_day_no %= 1461;
  if (g_day_no >= 366) {
    jy += Math.floor((g_day_no - 1) / 365);
    g_day_no = (g_day_no - 1) % 365;
  }
  let jm = (g_day_no < 186) ? (1 + Math.floor(g_day_no / 31)) : (7 + Math.floor((g_day_no - 186) / 30));
  let jd = 1 + ((g_day_no < 186) ? (g_day_no % 31) : ((g_day_no - 186) % 30));
  return [jy, jm, jd];
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  let jy2 = jy - 979;
  let j_day_no = 365 * jy2 + Math.floor(jy2 / 33) * 8 + Math.floor((jy2 % 33 + 3) / 4) + (jm - 1) * (jm < 7 ? 31 : 30) - (jm >= 7 ? 6 : 0) + jd - 1;
  let gy = 1600 + 400 * Math.floor(j_day_no / 146097);
  j_day_no %= 146097;
  let leap = true;
  if (j_day_no >= 36525) {
    j_day_no--;
    gy += 100 * Math.floor(j_day_no / 36524);
    j_day_no %= 36524;
    if (j_day_no >= 365) {
      j_day_no++;
    } else {
      leap = false;
    }
  }
  gy += 4 * Math.floor(j_day_no / 1461);
  j_day_no %= 1461;
  if (j_day_no >= 366) {
    leap = false;
    j_day_no--;
    gy += Math.floor(j_day_no / 365);
    j_day_no %= 365;
  }
  let gd = j_day_no + 1;
  const sal_a = [0, 31, (leap ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1;
  for (gm = 1; gm <= 12; gm++) {
    if (gd <= sal_a[gm]) break;
    gd -= sal_a[gm];
  }
  return [gy, gm, gd];
}

export function isJalaliLeapYear(jy: number): boolean {
  const r = jy % 33;
  return r === 1 || r === 5 || r === 9 || r === 13 || r === 17 || r === 22 || r === 26 || r === 30;
}

export function getJalaliMonthDays(jy: number, jm: number): number {
  if (jm >= 1 && jm <= 6) return 31;
  if (jm >= 7 && jm <= 11) return 30;
  if (jm === 12) {
    return isJalaliLeapYear(jy) ? 30 : 29;
  }
  return 0;
}

export function getWeekdayOfFirstDay(jy: number, jm: number): number {
  // jalaliToGregorian returns [gy, gm, gd]
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, 1);
  const date = new Date(gy, gm - 1, gd);
  // js getDay() returns 0 for Sunday, 1 for Monday, ..., 6 for Saturday.
  // We want Saturday to be 0, Sunday 1, ..., Friday 6.
  const jsDay = date.getDay();
  // jsDay: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  // Our day: Sat=0, Sun=1, Mon=2, Tue=3, Wed=4, Thu=5, Fri=6
  const map: { [key: number]: number } = {
    6: 0, // Saturday
    0: 1, // Sunday
    1: 2, // Monday
    2: 3, // Tuesday
    3: 4, // Wednesday
    4: 5, // Thursday
    5: 6, // Friday
  };
  return map[jsDay];
}

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
