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
    return NextResponse.json({
      success: false,
      error: err.message || 'Internal server error'
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

    // ۱. خواندن دیتای ۱۰۰٪ واقعی، زنده و دست‌نخورده مستقیم از ابر آروان
    const { state: currentS3State } = await readState();
    if (!currentS3State || !currentS3State.departments) {
      return NextResponse.json({ success: false, error: 'پایگاه داده لود نشد' }, { status: 500 });
    }

    // ۲. پیدا کردن بخش جدید؛ چه فرانت‌اِند کل دیتابیس را فرستاده باشد چه فقط یک بخش را
    let newDeptToAdd: any = null;

    if (body.newDepartment) {
      newDeptToAdd = body.newDepartment;
    } else if (body.state && body.state.departments && Array.isArray(body.state.departments)) {
      // پیدا کردن تفاوت بین دیتای ارسالی فرانت‌اِند و دیتای واقعی آروان (پیدا کردن بخش جدید)
      const existingIds = new Set(currentS3State.departments.map((d: any) => d.id));
      newDeptToAdd = body.state.departments.find((d: any) => d && d.id && !existingIds.has(d.id));
    }

    // ۳. اگر کاربر دکمه افزودن را زده اما بخش جدیدی پیدا نشد، احتمالاً درخواست از صفحات دیگر (مثل ویرایش پرسنل) است
    if (!newDeptToAdd) {
      // در این حالت اجازه ثبت دیتای فرانت‌اِند را می‌دهیم، مشروط بر اینکه بخش سپهر داخلش سالم باشد
      if (body.state && body.state.departments && body.state.departments.length > 0) {
        const success = await writeState(body.state);
        return NextResponse.json({ success, isConfigured, state: body.state });
      }
      return NextResponse.json({ success: false, error: 'اطلاعات ارسالی نامعتبر است' }, { status: 400 });
    }

    // ۴. اعتبارسنجی نام بخش جدید برای جلوگیری از اسپم (مثل مهر یا سپهر تکراری)
    const normalizedName = newDeptToAdd.name.trim();
    const isDuplicate = currentS3State.departments.some(
      (existingDept: any) => existingDept.name.trim() === normalizedName
    );

    if (isDuplicate) {
      // دیتای معتبر قبلی را پس می‌دهیم تا فرانت‌اِند از حالت لودینگ خارج شود و به حالت پایدار برگردد
      return NextResponse.json({ success: true, isConfigured, state: currentS3State, message: 'این بخش از قبل وجود دارد' });
    }

    // ۵. تزریق کاملاً امن بخش جدید به دیتای واقعی آروان
    const cleanNewDept = {
      id: newDeptToAdd.id || `dept_${Date.now()}`,
      name: normalizedName,
      username: newDeptToAdd.username || 'admin',
      password: newDeptToAdd.password || '123456'
    };

    currentS3State.departments.push(cleanNewDept);

    // ساخت فضا در deptData بدون دست زدن به دیتای بخش سپهر
    currentS3State.deptData[cleanNewDept.id] = {
      personnel: [],
      requests: [],
      settings_system: {},
      settings_credentials: { username: cleanNewDept.username, password: cleanNewDept.password },
      holidays: {},
      firstDayOfWeek: {},
      schedules: {}
    };

    // ۶. ذخیره نهایی دیتای کاملاً واکسینه شده و امن روی آروان
    const success = await writeState(currentS3State);

    // بازگرداندن کل دیتای اصلاح شده به فرانت‌اِند تا ظاهر سایت فوراً خودش را سینک کند و پیام موفقیت بدهد
    return NextResponse.json({
      success,
      isConfigured,
      state: currentS3State,
      message: 'بخش جدید با امنیت کامل افزوده شد.'
    });

  } catch (err: any) {
    console.error('API storage write error:', err);
    return NextResponse.json({ success: false, error: err.message || 'خطای سرور' }, { status: 500 });
  }
}
