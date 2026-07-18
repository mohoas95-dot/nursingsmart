import { NextRequest, NextResponse } from 'next/server';
import { getJalaliMonthDays, getJalaliWeekday } from '../../../lib/jalali';

export const dynamic = 'force-dynamic';

interface HolidayApiEvent { description?: string; is_holiday?: boolean; additional_description?: string }
interface HolidayApiResponse { is_holiday?: boolean; events?: HolidayApiEvent[] }
interface CalendarDay { day: number; isHoliday: boolean; events: { title: string; isHoliday: boolean }[]; online: boolean }

const cache = new Map<string, { expires: number; value: unknown }>();

async function fetchDay(year: number, month: number, day: number): Promise<CalendarDay> {
  // درخواست‌های محدود و نوبتی؛ ارسال هم‌زمان ۳۰ درخواست توسط سرویس رسمی rate-limit می‌شد.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`https://holidayapi.ir/jalali/${year}/${month}/${day}`, {
        signal: AbortSignal.timeout(12000),
        headers: { Accept: 'application/json', 'User-Agent': 'NursingSmart-Calendar/1.0' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as HolidayApiResponse;
      const events = (data.events || []).map(event => ({
        title: event.description || event.additional_description || 'مناسبت رسمی',
        isHoliday: Boolean(event.is_holiday)
      }));
      return { day, isHoliday: Boolean(data.is_holiday) || events.some(e => e.isHoliday), events, online: true };
    } catch {
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 350));
    }
  }
  return { day, isHoliday: false, events: [], online: false };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const year = Number(params.get('year'));
  const month = Number(params.get('month'));
  if (!Number.isInteger(year) || year < 1300 || year > 1500 || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'سال یا ماه نامعتبر است.' }, { status: 400 });
  }

  const key = `${year}-${month}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return NextResponse.json(cached.value);

  const dayCount = getJalaliMonthDays(year, month);
  const results: CalendarDay[] = [];
  // حداکثر چهار اتصال هم‌زمان برای جلوگیری از پاسخ ناقص سرویس تقویم رسمی.
  for (let start = 1; start <= dayCount; start += 4) {
    const batch = Array.from({ length: Math.min(4, dayCount - start + 1) }, (_, i) => fetchDay(year, month, start + i));
    results.push(...await Promise.all(batch));
  }

  const successfulDays = results.filter(item => item.online).length;
  if (successfulDays !== dayCount) {
    return NextResponse.json({
      error: 'دریافت کامل ماه از سرویس تقویم رسمی ممکن نشد.',
      receivedDays: successfulDays,
      expectedDays: dayCount
    }, { status: 503, headers: { 'Retry-After': '20' } });
  }

  const holidays: Record<number, string> = {};
  const occasions: Record<number, string[]> = {};
  for (const item of results) {
    if (item.events.length) occasions[item.day] = item.events.map(e => e.title);
    if (item.isHoliday && getJalaliWeekday(year, month, item.day) !== 6) {
      holidays[item.day] = item.events.filter(e => e.isHoliday).map(e => e.title).join('، ') || 'تعطیل رسمی';
    }
  }

  const value = {
    year, month, holidays, occasions,
    firstDayOfWeek: getJalaliWeekday(year, month, 1),
    source: 'holidayapi.ir', online: true,
    syncedAt: new Date().toISOString()
  };
  cache.set(key, { expires: Date.now() + 12 * 60 * 60 * 1000, value });
  return NextResponse.json(value, { headers: { 'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=86400' } });
}
