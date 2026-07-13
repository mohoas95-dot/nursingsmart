import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // ترفند جدید: از متغیر سراسری یا مسیرهای احتمالی دیگر دیتابیس استفاده می‌کنیم
    let db: any;

    try {
      // شانس اول: بررسی اینکه آیا متغیر دیتابیس در ریشه اصلی یا پوشه‌های دیگر پروژه اکسپورت شده؟
      db = require('@/prisma')?.prisma || require('@/prisma')?.db || globalThis.prisma;
    } catch {
      db = null;
    }

    // اگر دیتابیس پیدا نشد، از آبجکت سراسری برنامه کمک می‌گیریم
    const database = db || (global as any).prisma || (global as any).db;

    if (!database) {
      throw new Error("تیم فنی: متغیر دیتابیس شما در مسیرهای پیش‌فرض پیدا نشد. لطفاً نام فایل اصلی اتصال دیتابیس خود را چک کنید.");
    }

    // اجرای دستور حذف دقیق اسپم‌ها
    const result = await database.department.deleteMany({
      where: { name: 'سپهر' }
    });

    return NextResponse.json({
      success: true,
      message: "پاک‌سازی اسپم‌ها بالاخره با موفقیت انجام شد",
      deletedCount: result.count
    });

  } catch (err: any) {
    return NextResponse.json(
      { 
        success: false, 
        error: "خطای سیستمی", 
        details: err?.message || err 
      }, 
      { status: 500 }
    );
  }
}
