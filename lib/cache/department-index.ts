import 'server-only';
import { readDepartmentSummaries } from '../s3Storage';

/**
 * کش کوتاه‌مدت درون‌حافظه‌ای برای فهرست بخش‌ها.
 *
 * ── چرا لازم است؟ ───────────────────────────────────────────────────────────
 * فهرست بخش‌ها روی مسیر بحرانی صفحهٔ ورود است: هر بازدیدکننده پیش از انتخاب بخش
 * منتظر آن می‌ماند. هدر `Cache-Control` فقط روی کش مرورگر/CDN اثر دارد و برای
 * بازدید اول هر کاربر هیچ کمکی نمی‌کند؛ هر درخواست یک `GetObject` کامل به S3
 * می‌زد.
 *
 * این فهرست داده‌ای است که تقریباً هرگز تغییر نمی‌کند (فقط هنگام ساخت یا حذف
 * بخش)، پس نگهداری ۶۰ ثانیه‌ای آن در حافظه، رفت‌وبرگشت S3 را از مسیر بحرانیِ
 * تقریباً همهٔ بازدیدها حذف می‌کند.
 *
 * ⚠️ محدودیت آگاهانه: کش درون‌پردازه‌ای است. در استقرار چندنمونه‌ای، هر نمونه کش
 * خودش را دارد و ابطال فقط روی همان نمونه اثر می‌گذارد؛ با TTL شصت‌ثانیه‌ای،
 * بدترین حالت واگرایی کوتاه و بی‌ضرر است.
 */

export type DepartmentSummary = { id: string; name: string };

const CACHE_TTL_MS = 60_000;
/** در صورت خطای S3، دادهٔ کمی کهنه بهتر از صفحهٔ ورودِ خراب است. */
const STALE_FALLBACK_MS = 10 * 60_000;

let cache: { data: DepartmentSummary[]; expiresAt: number; fetchedAt: number } | null = null;
let inFlight: Promise<DepartmentSummary[]> | null = null;

/** خواندن فهرست بخش‌ها با کش و حذف هجوم هم‌زمان (cache stampede). */
export async function getDepartmentSummariesCached(): Promise<DepartmentSummary[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.data;

  // درخواست‌های هم‌زمان به همان واکشی در حال اجرا می‌پیوندند؛ اگر ده کاربر
  // هم‌زمان صفحهٔ ورود را باز کنند، فقط یک درخواست به S3 می‌رود.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const departments = await readDepartmentSummaries();
      cache = { data: departments, expiresAt: Date.now() + CACHE_TTL_MS, fetchedAt: Date.now() };
      return departments;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** آخرین نسخهٔ موفق، اگر بیش از حد کهنه نشده باشد (مسیر بازگشت هنگام خطا). */
export function getStaleDepartmentSummaries(): DepartmentSummary[] | null {
  if (cache && Date.now() - cache.fetchedAt < STALE_FALLBACK_MS) return cache.data;
  return null;
}

/** ابطال دستی کش — پس از ساخت یا حذف بخش فراخوانی می‌شود. */
export function invalidateDepartmentCache() {
  cache = null;
}
