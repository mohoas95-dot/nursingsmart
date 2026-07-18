import { NextRequest, NextResponse } from 'next/server';
import { getMonthHolidays, getMonthAllEvents, getMonthEvents } from '@/lib/iranianHolidays';
import { getCurrentJalaliDate, getJalaliMonthDays, getJalaliWeekday, JALALI_MONTH_NAMES, WEEKDAYS, toPersianDigits } from '@/lib/jalali';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');

    const current = getCurrentJalaliDate();
    const year = yearParam ? parseInt(yearParam, 10) : current.year;
    const month = monthParam ? parseInt(monthParam, 10) : current.month;

    // Get holidays and events from our comprehensive data
    const holidays = getMonthHolidays(year, month);
    const allEvents = getMonthAllEvents(year, month);
    const totalDays = getJalaliMonthDays(year, month);
    const firstDayOfWeek = getJalaliWeekday(year, month, 1);

    // Build calendar days
    const days = [];
    for (let d = 1; d <= totalDays; d++) {
      const dayOfWeek = (firstDayOfWeek + d - 1) % 7;
      const isFriday = dayOfWeek === 6;
      const dayEvents = allEvents[d] || [];
      const isHoliday = isFriday || dayEvents.some(e => e.isHoliday);
      const holidayTitle = holidays[d] || (isFriday ? 'جمعه (تعطیل هفتگی)' : undefined);
      const eventTitles = dayEvents.map(e => e.title);

      days.push({
        day: d,
        dayOfWeek,
        dayName: WEEKDAYS[dayOfWeek],
        isFriday,
        isHoliday,
        holidayTitle,
        events: eventTitles,
        isToday: year === current.year && month === current.month && d === current.day
      });
    }

    return NextResponse.json({
      success: true,
      year,
      month,
      monthName: JALALI_MONTH_NAMES[month - 1],
      totalDays,
      firstDayOfWeek,
      holidays,
      days,
      today: current,
      source: 'iranian-calendar-api'
    });
  } catch (err: unknown) {
    console.error('Calendar API error:', err);
    return NextResponse.json({
      success: false,
      error: 'خطا در دریافت اطلاعات تقویم'
    }, { status: 500 });
  }
}
