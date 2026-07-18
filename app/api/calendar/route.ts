import { NextRequest, NextResponse } from 'next/server';
import { jalaaliMonthLength, toGregorian } from 'jalaali-js';
import { iranWeekday } from '../../../lib/calendar/service';

export const dynamic = 'force-dynamic';

interface HolidayRules { holidays: { jalali: [number, number][]; hijri: [number, number][] } }
const cache = new Map<string, { expires: number; value: unknown }>();
const SOURCES = {
  holidays: 'https://raw.githubusercontent.com/ilius/starcal/master/plugins/holidays-iran.json',
  jalali: 'https://raw.githubusercontent.com/ilius/starcal/master/plugins/iran-jalali-data.txt',
  hijri: 'https://raw.githubusercontent.com/ilius/starcal/master/plugins/iran-hijri-data.txt',
  bahesab: 'https://www.bahesab.ir/time/calendar/'
};

const MONTH_NAMES = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

function englishDigits(value: string) {
  return value.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

/** استخراج مناسبت همان سال از منبع به‌روز معرفی‌شده؛ «تعطیل» معیار رسمی بودن است. */
function parseBahesab(html: string, year: number, month: number) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&laquo;|&#171;/g, '«').replace(/&raquo;|&#187;/g, '»')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&zwnj;|&#8204;/g, '‌')
    .replace(/\s+/g, ' ');
  const monthName = MONTH_NAMES[month - 1];
  const marker = `مناسبتهای ${monthName} ${year}`;
  const normalized = englishDigits(text);
  const start = normalized.indexOf(marker);
  if (start < 0) return null;
  const nextMonth = month === 12 ? '' : `مناسبتهای ${MONTH_NAMES[month]} ${year}`;
  const end = nextMonth ? normalized.indexOf(nextMonth, start + marker.length) : -1;
  const section = normalized.slice(start + marker.length, end > start ? end : undefined);
  const occasions: Record<number, string[]> = {};
  const holidays: Record<number, string> = {};
  const dayPattern = new RegExp(`(\\d{1,2}) ${monthName} (.*?)(?= \\d{1,2} ${monthName} |$)`, 'g');
  for (const match of section.matchAll(dayPattern)) {
    const day = Number(match[1]);
    if (day < 1 || day > 31) continue;
    const titles = match[2].split(/\s+-\s+/).map(title => title.trim()).filter(Boolean);
    occasions[day] = titles.map(title => title.replace(/\s*«تعطیل»\s*/g, '').trim());
    const official = titles.filter(title => title.includes('«تعطیل»'));
    if (official.length) holidays[day] = official.map(title => title.replace(/\s*«تعطیل»\s*/g, '').trim()).join('، ');
  }
  return Object.keys(occasions).length ? { occasions, holidays } : null;
}

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
    // منابع به‌صورت موازی دریافت می‌شوند؛ باحساب مرجع اصلی تاریخ‌های قمری متغیر است.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const [rulesText, jalaliText, hijriText, bahesabText] = await Promise.all([
      fetchText(SOURCES.holidays, controller.signal),
      fetchText(SOURCES.jalali, controller.signal),
      fetchText(SOURCES.hijri, controller.signal),
      fetchText(SOURCES.bahesab, controller.signal).catch(() => null)
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

    // برای سالی که باحساب منتشر کرده، داده آن جایگزین تبدیل تقریبی قمری Intl می‌شود؛ علت اختلاف یک‌روزه همین تبدیل بود.
    const bahesabMonth = bahesabText ? parseBahesab(bahesabText, year, month) : null;
    const finalHolidays = bahesabMonth?.holidays || holidays;
    const finalOccasions = bahesabMonth?.occasions || occasions;

    const value = {
      year, month, holidays: finalHolidays, occasions: finalOccasions,
      firstDayOfWeek: iranWeekday(year, month, 1),
      source: bahesabMonth ? 'bahesab.ir/time/calendar' : 'شورای مرکز تقویم مؤسسه ژئوفیزیک دانشگاه تهران / StarCalendar',
      online: true,
      syncedAt: new Date().toISOString()
    };
    cache.set(key, { expires: Date.now() + 12 * 60 * 60 * 1000, value });
    return NextResponse.json(value, { headers: { 'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=86400' } });
  } catch {
    return NextResponse.json({ error: 'منبع رسمی تقویم در دسترس نیست.' }, { status: 503, headers: { 'Retry-After': '10' } });
  }
}
