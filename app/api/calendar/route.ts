import { NextRequest, NextResponse } from 'next/server';
import { jalaaliMonthLength, toGregorian } from 'jalaali-js';
import { iranWeekday } from '../../../lib/calendar/service';

export const dynamic = 'force-dynamic';

interface HolidayRules { holidays: { jalali: [number, number][]; hijri: [number, number][] } }
const cache = new Map<string, { expires: number; value: unknown }>();
const SOURCES = {
  holidays: 'https://raw.githubusercontent.com/ilius/starcal/master/plugins/holidays-iran.json',
  jalali: 'https://raw.githubusercontent.com/ilius/starcal/master/plugins/iran-jalali-data.txt',
  hijri: 'https://raw.githubusercontent.com/ilius/starcal/master/plugins/iran-hijri-data.txt'
};

function parseEvents(text: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const line of text.split('\n')) {
    const match = line.match(/^(\d{2})\/(\d{2})\t(.+)$/);
    if (!match) continue;
    result.set(`${Number(match[1])}/${Number(match[2])}`, match[3].split(' – ').map(value => value.trim()));
  }
  return result;
}

function islamicDate(gy: number, gm: number, gd: number) {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-islamic-nu-latn', {
    timeZone: 'UTC', month: 'numeric', day: 'numeric'
  }).formatToParts(new Date(Date.UTC(gy, gm - 1, gd)));
  return {
    month: Number(parts.find(part => part.type === 'month')?.value),
    day: Number(parts.find(part => part.type === 'day')?.value)
  };
}

async function fetchText(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, cache: 'no-store', headers: { Accept: 'application/json,text/plain' } });
  if (!response.ok) throw new Error(`calendar source ${response.status}`);
  return response.text();
}

export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get('year'));
  const month = Number(request.nextUrl.searchParams.get('month'));
  if (!Number.isInteger(year) || year < 1300 || year > 1500 || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'سال یا ماه نامعتبر است.' }, { status: 400 });
  }

  const key = `${year}-${month}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return NextResponse.json(cached.value);

  try {
    // سه فایل سبک به‌جای ۲۹ تا ۳۱ درخواست روزانه؛ زمان پاسخ از حدود چند دقیقه به چند ثانیه کاهش می‌یابد.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const [rulesText, jalaliText, hijriText] = await Promise.all([
      fetchText(SOURCES.holidays, controller.signal),
      fetchText(SOURCES.jalali, controller.signal),
      fetchText(SOURCES.hijri, controller.signal)
    ]);
    clearTimeout(timeout);

    const rules = JSON.parse(rulesText) as HolidayRules;
    const jalaliEvents = parseEvents(jalaliText);
    const hijriEvents = parseEvents(hijriText);
    const jalaliHolidaySet = new Set(rules.holidays.jalali.map(([m, d]) => `${m}/${d}`));
    const hijriHolidaySet = new Set(rules.holidays.hijri.map(([m, d]) => `${m}/${d}`));
    const holidays: Record<number, string> = {};
    const occasions: Record<number, string[]> = {};
    const dayCount = jalaaliMonthLength(year, month);

    for (let day = 1; day <= dayCount; day++) {
      const gregorian = toGregorian(year, month, day);
      const hijri = islamicDate(gregorian.gy, gregorian.gm, gregorian.gd);
      const jKey = `${month}/${day}`;
      const hKey = `${hijri.month}/${hijri.day}`;
      const events = [...(jalaliEvents.get(jKey) || []), ...(hijriEvents.get(hKey) || [])];
      if (events.length) occasions[day] = [...new Set(events)];
      if (jalaliHolidaySet.has(jKey) || hijriHolidaySet.has(hKey)) {
        holidays[day] = events.join('، ') || 'تعطیل رسمی جمهوری اسلامی ایران';
      }
    }

    const value = {
      year, month, holidays, occasions,
      firstDayOfWeek: iranWeekday(year, month, 1),
      source: 'شورای مرکز تقویم مؤسسه ژئوفیزیک دانشگاه تهران / StarCalendar',
      online: true,
      syncedAt: new Date().toISOString()
    };
    cache.set(key, { expires: Date.now() + 12 * 60 * 60 * 1000, value });
    return NextResponse.json(value, { headers: { 'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=86400' } });
  } catch {
    return NextResponse.json({ error: 'منبع رسمی تقویم در دسترس نیست.' }, { status: 503, headers: { 'Retry-After': '10' } });
  }
}
