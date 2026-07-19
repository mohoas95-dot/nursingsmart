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
    return NextResponse.json({
      success: false,
      error: error instanceof StorageUnavailableError
        ? 'فهرست بخش‌ها موقتاً در دسترس نیست.'
        : 'خطا در دریافت فهرست بخش‌ها.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
