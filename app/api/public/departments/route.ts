import { NextResponse } from 'next/server';
import { StorageUnavailableError } from '../../../../lib/s3Storage';
import {
  getDepartmentSummariesCached,
  getStaleDepartmentSummaries,
} from '../../../../lib/cache/department-index';

export const dynamic = 'force-dynamic';

/**
 * فهرست عمومی بخش‌ها برای صفحهٔ ورود.
 *
 * خواندن از کش کوتاه‌مدت انجام می‌شود (به `lib/cache/department-index.ts` نگاه
 * کنید): این مسیر روی مسیر بحرانی اولین بازدید است و پیش‌تر هر بار یک
 * `GetObject` کامل به S3 می‌زد.
 */
export async function GET() {
  try {
    const departments = await getDepartmentSummariesCached();
    return NextResponse.json({ success: true, departments }, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('Public department list read failed:', error);

    // بازگشت به آخرین نسخهٔ موفق: صفحهٔ ورود با یک اختلال گذرای S3 کاملاً از
    // کار نمی‌افتد و کاربر همچنان می‌تواند بخش خود را انتخاب کند.
    const stale = getStaleDepartmentSummaries();
    if (stale) {
      return NextResponse.json({ success: true, departments: stale, stale: true }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    // این فهرست در صفحهٔ ورود لازم است؛ اعلام گذرا بودن خطا به کلاینت اجازه
    // می‌دهد خودکار تلاش مجدد کند و کاربر پشت یک پیام خطا گیر نکند.
    return NextResponse.json({
      success: false,
      error: error instanceof StorageUnavailableError
        ? 'فهرست بخش‌ها موقتاً در دسترس نیست.'
        : 'خطا در دریافت فهرست بخش‌ها.',
      retryable: true,
    }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3' } });
  }
}
