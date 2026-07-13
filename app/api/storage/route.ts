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

    // ۱. همیشه آخرین دیتای معتبر و زنده را مستقیم از آروان می‌خوانیم
    const { state: currentState } = await readState();
    if (!currentState) {
      return NextResponse.json({ success: false, error: 'پایگاه داده لود نشد' }, { status: 500 });
    }

    // ۲. استخراج لیست بخش‌های جدید ارسالی از فرانت‌اِند
    let incomingDepartments = [];
    if (body.state && body.state.departments) {
      incomingDepartments = body.state.departments;
    } else if (body.newDepartment) {
      incomingDepartments = [body.newDepartment];
    }

    // ۳. ادغام هوشمند: فقط بخش‌هایی که واقعاً جدید هستند و تکراری نیستند را اضافه کن
    incomingDepartments.forEach((incomingDept: any) => {
      if (!incomingDept || !incomingDept.name) return;

      const isDuplicate = currentState.departments.some(
        (existingDept: any) => existingDept.name.trim() === incomingDept.name.trim() || existingDept.id === incomingDept.id
      );

      // اگر تکراری نبود، آن را به دیتابیس واقعی آروان متصل کن
      if (!isDuplicate) {
        currentState.departments.push(incomingDept);
        
        // ایجاد کلید ساختار داده برای بخش جدید در صورت عدم وجود
        const deptId = incomingDept.id || `dept_${Date.now()}`;
        if (!currentState.deptData[deptId]) {
          currentState.deptData[deptId] = {
            personnel: [],
            requests: [],
            settings_system: {},
            settings_credentials: { username: incomingDept.username || 'admin', password: incomingDept.password || '123456' },
            holidays: {},
            firstDayOfWeek: {},
            schedules: {}
          };
        }
      }
    });

    // ۴. ذخیره نهایی دیتای کاملاً اصلاح‌شده و امن
    const success = await writeState(currentState);

    return NextResponse.json({
      success,
      isConfigured,
      state: currentState, // دیتای اصلاح شده را به فرانت‌اِند برمی‌گردانیم تا سینک شود
      message: 'دیتابیس با موفقیت همگام‌سازی و محافظت شد.'
    });

  } catch (err: any) {
    console.error('API storage write error:', err);
    return NextResponse.json({
      success: false,
      error: err.message || 'خطای سرور'
    }, { status: 500 });
  }
}
