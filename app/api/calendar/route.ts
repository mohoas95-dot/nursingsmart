import { NextRequest, NextResponse } from 'next/server';
import { getJalaliMonthDays, getJalaliWeekday } from '../../../lib/jalali';

export const dynamic = 'force-dynamic';

interface HolidayApiEvent { description?: string; is_holiday?: boolean; additional_description?: string }
interface HolidayApiResponse { is_holiday?: boolean; events?: HolidayApiEvent[] }

const cache = new Map<string, { expires: number; value: unknown }>();

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
  const results = await Promise.all(Array.from({ length: dayCount }, async (_, index) => {
    const day = index + 1;
    try {
      const response = await fetch(`https://holidayapi.ir/jalali/${year}/${month}/${day}`, {
        signal: AbortSignal.timeout(4500),
        headers: { Accept: 'application/json' },
        next: { revalidate: 86400 }
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as HolidayApiResponse;
      const events = (data.events || []).map(event => ({
        title: event.description || event.additional_description || 'مناسبت رسمی',
        isHoliday: Boolean(event.is_holiday)
      }));
      return { day, isHoliday: Boolean(data.is_holiday) || events.some(e => e.isHoliday), events };
    } catch {
      return { day, isHoliday: getJalaliWeekday(year, month, day) === 6, events: [] as { title: string; isHoliday: boolean }[] };
    }
  }));

  const holidays: Record<number, string> = {};
  const occasions: Record<number, string[]> = {};
  for (const item of results) {
    if (item.events.length) occasions[item.day] = item.events.map(e => e.title);
    if (item.isHoliday && getJalaliWeekday(year, month, item.day) !== 6) {
      holidays[item.day] = item.events.map(e => e.title).join('، ') || 'تعطیل رسمی';
    }
  }

  const value = {
    year, month, holidays, occasions,
    firstDayOfWeek: getJalaliWeekday(year, month, 1),
    source: 'holidayapi.ir',
    syncedAt: new Date().toISOString()
  };
  cache.set(key, { expires: Date.now() + 12 * 60 * 60 * 1000, value });
  return NextResponse.json(value, { headers: { 'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=86400' } });
}
