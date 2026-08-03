import { NextResponse } from 'next/server';
import { readDepartmentSummaries, StorageUnavailableError } from '../../../../lib/s3Storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const departments = await readDepartmentSummaries();
    return NextResponse.json({ success: true, departments }, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('Public department list read failed:', error);
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
