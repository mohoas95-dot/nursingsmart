import { NextRequest, NextResponse } from 'next/server';
import { readState, writeState, getS3Client } from '../../../lib/s3Storage';

export async function GET() {
  try {
    const { isConfigured, bucket } = getS3Client();
    const { state, source } = await readState();
    const endpoint = process.env.S3_ENDPOINT || '';
    
    return NextResponse.json({
      success: true,
      isConfigured,
      bucket,
      endpoint,
      source,
      state
    });
  } catch (err: any) {
    console.error('API storage read error:', err);
    return NextResponse.json({ success: false, error: 'خطای سرور در خواندن داده' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { isConfigured } = getS3Client();
    const body = await req.json();
    
    // اگر دیتایی فرستاده نشده باشد
    if (!body) {
      return NextResponse.json({ success: false, error: 'درخواست معتبر نیست' }, { status: 400 });
    }

    // استخراج دیتای وضعیت (State) چه داخل شیء state باشد و چه مستقیم فرستاده شده باشد
    let targetState = body.state ? body.state : body;

    if (!targetState || !targetState.departments) {
      return NextResponse.json({ success: false, error: 'ساختار داده نامعتبر است' }, { status: 400 });
    }

    // لغو موقت پاکسازی خودکار برای بازیابی دیتا
    if (Array.isArray(targetState.departments)) {
      // فقط بخش‌هایی که واقعا دیتای معتبر دارند را نگه می‌داریم
      targetState.departments = targetState.departments.filter((dept: any) => {
        return dept && dept.id && targetState.deptData?.[dept.id];
      });
    }

    // ذخیره‌سازی نهایی دیتای واکسینه شده روی S3 ابر آروان
    const success = await writeState(targetState);

    // ارسال پاسخ دقیقاً با ساختار استانداردی که فرانت‌اِند شما طلب می‌کند
    return NextResponse.json({
      success,
      isConfigured,
      state: targetState,
      message: 'تغییرات با موفقیت ثبت و همگام‌سازی شد.'
    });

  } catch (err: any) {
    console.error('API storage write error:', err);
    return NextResponse.json({ success: false, error: 'خطای سرور در ذخیره‌سازی' }, { status: 500 });
  }
}
