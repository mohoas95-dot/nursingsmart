import { NextRequest, NextResponse } from 'next/server';
import { readState, writeState, getS3Client } from '../../../lib/s3Storage';

export async function GET() {
  try {
    const { isConfigured, bucket } = getS3Client();
    const { state, source } = await readState();
    
    // Conceal secret keys, but show endpoints for status transparency
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
    return NextResponse.json({
      success: false,
      error: err.message || 'Internal server error while loading database state'
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { isConfigured } = getS3Client();
    const body = await req.json();
    
    if (!body) {
      return NextResponse.json({ success: false, error: 'درخواست معتبر نیست' }, { status: 400 });
    }

    // ۱. خواندن وضعیت فعلی دیتابیس مستقیم از S3 آروان
    const { state } = await readState();

    if (!state) {
      return NextResponse.json({ success: false, error: 'پایگاه داده لود نشد' }, { status: 500 });
    }

    // ۲. بررسی نوع دیتای ورودی برای جلوگیری از خطای همزمانی یا پریدن بخش‌ها
    if (body.state && body.state.departments) {
      // اگر فرانت‌اِند کل دیتابیس را فرستاده بود، آن را جایگزین کن
      state.departments = body.state.departments;
      if (body.state.deptData) {
        state.deptData = { ...state.deptData, ...body.state.deptData };
      }
    } else if (body.newDepartment) {
      // اگر فرانت‌اِند فقط بخش جدید را فرستاده بود
      const { newDepartment } = body;
      
      // بررسی تکراری نبودن نام بخش جدید
      const isDuplicate = state.departments.some(
        (d: any) => d.name.trim() === newDepartment.name.trim()
      );
      
      if (isDuplicate) {
        return NextResponse.json({
          success: false,
          error: `بخش "${newDepartment.name}" از قبل وجود دارد.`
        }, { status: 400 });
      }

      // اضافه کردن بخش جدید به لیست قبلی‌ها به صورت امن
      state.departments.push(newDepartment);
      
      // ساختن فضای دیتای خالی برای بخش جدید تا پرسنل بتوانند وارد شوند
      if (newDepartment.id) {
        state.deptData[newDepartment.id] = {
          personnel: [],
          requests: [],
          settings_system: {},
          settings_credentials: { username: newDepartment.username, password: newDepartment.password },
          holidays: {},
          firstDayOfWeek: {},
          schedules: {}
        };
      }
    }

    // ۳. ذخیره نهایی و امن روی آروان
    const success = await writeState(state);

    return NextResponse.json({
      success,
      isConfigured,
      message: success 
        ? 'تغییرات با موفقیت و امنیت کامل روی S3 ذخیره شد.' 
        : 'ذخیره‌سازی با خطا مواجه شد.'
    });
  } catch (err: any) {
    console.error('API storage write error:', err);
    return NextResponse.json({
      success: false,
      error: err.message || 'خطای داخلی سرور در ذخیره‌سازی داده'
    }, { status: 500 });
  }
}
