// تقویم تعطیلات رسمی و مناسبت‌های ایران - داده‌های ثابت شمسی
// این داده‌ها از تقویم رسمی ایران استخراج شده‌اند

export interface IranianEvent {
  month: number;
  day: number;
  title: string;
  isHoliday: boolean;
}

// تعطیلات و مناسبت‌های ثابت شمسی (هر ساله تکرار می‌شوند)
export const FIXED_SOLAR_EVENTS: IranianEvent[] = [
  // فروردین
  { month: 1, day: 1, title: 'عید نوروز', isHoliday: true },
  { month: 1, day: 2, title: 'عید نوروز', isHoliday: true },
  { month: 1, day: 3, title: 'عید نوروز', isHoliday: true },
  { month: 1, day: 4, title: 'عید نوروز', isHoliday: true },
  { month: 1, day: 12, title: 'روز جمهوری اسلامی ایران', isHoliday: true },
  { month: 1, day: 13, title: 'روز طبیعت (سیزده‌بدر)', isHoliday: true },
  // اردیبهشت
  { month: 2, day: 1, title: 'روز کارگر', isHoliday: false },
  { month: 2, day: 2, title: 'روز معلم', isHoliday: false },
  { month: 2, day: 15, title: 'روز ارتش', isHoliday: false },
  // خرداد
  { month: 3, day: 14, title: 'رحلت حضرت امام خمینی (ره)', isHoliday: true },
  { month: 3, day: 15, title: 'قیام خونین ۱۵ خرداد', isHoliday: true },
  // شهریور
  { month: 6, day: 31, title: 'روز بزرگداشت ابوعلی سینا و روز پزشک', isHoliday: false },
  // مهر
  { month: 7, day: 8, title: 'روز بزرگداشت مولانا', isHoliday: false },
  { month: 7, day: 13, title: 'روز نیروی انتظامی', isHoliday: false },
  // آبان
  { month: 8, day: 13, title: 'روز دانش‌آموز', isHoliday: false },
  // آذر
  { month: 9, day: 7, title: 'روز دانشجو', isHoliday: false },
  // بهمن
  { month: 11, day: 22, title: 'پیروزی انقلاب اسلامی', isHoliday: true },
  // اسفند
  { month: 12, day: 29, title: 'روز ملی شدن صنعت نفت', isHoliday: true },
];

// تعطیلات قمری (متغیر هر سال) - بر اساس سال شمسی مشخص
// این داده‌ها باید هر ساله به‌روزرسانی شوند
export interface YearlyLunarEvents {
  [year: number]: IranianEvent[];
}

export const LUNAR_EVENTS_BY_YEAR: YearlyLunarEvents = {
  1403: [
    // تاسوعا و عاشورا
    { month: 4, day: 26, title: 'تاسوعای حسینی', isHoliday: true },
    { month: 4, day: 27, title: 'عاشورای حسینی', isHoliday: true },
    // اربعین
    { month: 6, day: 7, title: 'اربعین حسینی', isHoliday: true },
    // رحلت پیامبر و شهادت امام حسن
    { month: 6, day: 15, title: 'رحلت حضرت رسول اکرم (ص) و شهادت امام حسن مجتبی (ع)', isHoliday: true },
    // شهادت امام رضا
    { month: 6, day: 17, title: 'شهادت امام رضا (ع)', isHoliday: true },
    // میلاد پیامبر
    { month: 6, day: 25, title: 'میلاد حضرت رسول اکرم (ص) و میلاد امام جعفر صادق (ع)', isHoliday: true },
    // شهادت حضرت فاطمه
    { month: 9, day: 13, title: 'شهادت حضرت فاطمه زهرا (س)', isHoliday: true },
    // مبعث
    { month: 11, day: 10, title: 'مبعث حضرت رسول اکرم (ص)', isHoliday: true },
    // شب و نیمه شعبان
    { month: 11, day: 25, title: 'ولادت حضرت قائم (عج)', isHoliday: true },
    // شهادت امام علی
    { month: 12, day: 25, title: 'شهادت حضرت علی (ع)', isHoliday: true },
    // عید فطر
    { month: 1, day: 13, title: 'عید سعید فطر', isHoliday: true },
    { month: 1, day: 14, title: 'عید سعید فطر', isHoliday: true },
    // عید قربان
    { month: 3, day: 27, title: 'عید سعید قربان', isHoliday: true },
    // عید غدیر
    { month: 4, day: 4, title: 'عید سعید غدیر خم', isHoliday: true },
  ],
  1404: [
    // تاسوعا و عاشورا
    { month: 4, day: 15, title: 'تاسوعای حسینی', isHoliday: true },
    { month: 4, day: 16, title: 'عاشورای حسینی', isHoliday: true },
    // اربعین
    { month: 5, day: 26, title: 'اربعین حسینی', isHoliday: true },
    // رحلت پیامبر و شهادت امام حسن
    { month: 6, day: 4, title: 'رحلت حضرت رسول اکرم (ص) و شهادت امام حسن مجتبی (ع)', isHoliday: true },
    // شهادت امام رضا
    { month: 6, day: 6, title: 'شهادت امام رضا (ع)', isHoliday: true },
    // میلاد پیامبر
    { month: 6, day: 14, title: 'میلاد حضرت رسول اکرم (ص) و میلاد امام جعفر صادق (ع)', isHoliday: true },
    // شهادت حضرت فاطمه
    { month: 9, day: 2, title: 'شهادت حضرت فاطمه زهرا (س)', isHoliday: true },
    // مبعث
    { month: 10, day: 29, title: 'مبعث حضرت رسول اکرم (ص)', isHoliday: true },
    // ولادت حضرت قائم
    { month: 11, day: 15, title: 'ولادت حضرت قائم (عج)', isHoliday: true },
    // شهادت امام علی
    { month: 12, day: 14, title: 'شهادت حضرت علی (ع)', isHoliday: true },
    // عید فطر
    { month: 12, day: 20, title: 'عید سعید فطر', isHoliday: true },
    { month: 12, day: 21, title: 'عید سعید فطر', isHoliday: true },
    // عید قربان - سال بعدی اما ممکن است در اسفند باشد
  ],
  1405: [
    // تعطیلات قمری ۱۴۰۵
    { month: 1, day: 4, title: 'عید سعید قربان', isHoliday: true },
    { month: 1, day: 12, title: 'عید سعید غدیر خم', isHoliday: true },
    { month: 2, day: 2, title: 'تاسوعای حسینی', isHoliday: true },
    { month: 2, day: 3, title: 'عاشورای حسینی', isHoliday: true },
    { month: 3, day: 12, title: 'اربعین حسینی', isHoliday: true },
    { month: 3, day: 14, title: 'رحلت حضرت امام خمینی (ره)', isHoliday: true },
    { month: 3, day: 15, title: 'قیام خونین ۱۵ خرداد', isHoliday: true },
    { month: 3, day: 20, title: 'رحلت حضرت رسول اکرم (ص)', isHoliday: true },
    { month: 3, day: 22, title: 'شهادت امام رضا (ع)', isHoliday: true },
    { month: 3, day: 31, title: 'میلاد حضرت رسول اکرم (ص)', isHoliday: true },
    { month: 6, day: 19, title: 'شهادت حضرت فاطمه زهرا (س)', isHoliday: true },
    { month: 8, day: 15, title: 'مبعث حضرت رسول اکرم (ص)', isHoliday: true },
    { month: 9, day: 1, title: 'ولادت حضرت قائم (عج)', isHoliday: true },
    { month: 9, day: 30, title: 'شهادت حضرت علی (ع)', isHoliday: true },
    { month: 10, day: 7, title: 'عید سعید فطر', isHoliday: true },
    { month: 10, day: 8, title: 'عید سعید فطر', isHoliday: true },
    { month: 11, day: 22, title: 'پیروزی انقلاب اسلامی', isHoliday: true },
    { month: 12, day: 13, title: 'عید سعید قربان', isHoliday: true },
    { month: 12, day: 21, title: 'عید سعید غدیر خم', isHoliday: true },
    { month: 12, day: 29, title: 'روز ملی شدن صنعت نفت', isHoliday: true },
  ],
};

/**
 * دریافت تمامی تعطیلات و مناسبت‌ها برای یک ماه مشخص
 */
export function getMonthEvents(year: number, month: number): IranianEvent[] {
  const events: IranianEvent[] = [];

  // اضافه کردن مناسبت‌های ثابت شمسی
  FIXED_SOLAR_EVENTS.forEach(e => {
    if (e.month === month) {
      events.push(e);
    }
  });

  // اضافه کردن مناسبت‌های قمری سال
  const lunarEvents = LUNAR_EVENTS_BY_YEAR[year];
  if (lunarEvents) {
    lunarEvents.forEach(e => {
      if (e.month === month) {
        events.push(e);
      }
    });
  }

  return events;
}

/**
 * دریافت تعطیلات رسمی یک ماه به صورت دیکشنری
 */
export function getMonthHolidays(year: number, month: number): { [day: number]: string } {
  const holidays: { [day: number]: string } = {};
  const events = getMonthEvents(year, month);

  events.forEach(e => {
    if (e.isHoliday) {
      if (holidays[e.day]) {
        holidays[e.day] += ' / ' + e.title;
      } else {
        holidays[e.day] = e.title;
      }
    }
  });

  return holidays;
}

/**
 * دریافت تمامی مناسبت‌ها (تعطیل و غیرتعطیل) یک ماه
 */
export function getMonthAllEvents(year: number, month: number): { [day: number]: { title: string; isHoliday: boolean }[] } {
  const result: { [day: number]: { title: string; isHoliday: boolean }[] } = {};
  const events = getMonthEvents(year, month);

  events.forEach(e => {
    if (!result[e.day]) {
      result[e.day] = [];
    }
    result[e.day].push({ title: e.title, isHoliday: e.isHoliday });
  });

  return result;
}
