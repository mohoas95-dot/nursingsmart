import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // از آنجا که پکیج دقیق دیتابیس شما در این فایل نیست،
    // برای اینکه پروژه بدون خطا دپلوی شود، یک اسکریپت پویا می‌نویسیم.
    
    // لطفاً خط زیر را نگاه کنید؛ بقیه فایل‌های پروژه شما (مثلاً در پوشه lib) 
    // متغیر اتصال به دیتابیس را چطور ایمپورت کرده‌اند؟ 
    // اگر فایلی به نام db در پروژه دارید، کد زیر آن را فراخوانی می‌کند:
    const { db } = require('@/lib/db'); 

    if (db && typeof db.query === 'function') {
      // اگر دیتابیس شما از نوع SQL معمولی باشد (مثل PostgreSQL یا MySQL):
      await db.query(`DELETE FROM "Department" WHERE name = 'سپهر'`);
    } else if (db && typeof db.department?.deleteMany === 'function') {
      // اگر متغیر دیتابیس نام دیگری داشته باشد:
      await db.department.deleteMany({ where: { name: 'سپهر' } });
    } else {
      throw new Error("متغیر دیتابیس شناسایی نشد. لطفا ساختار lib/db را بررسی کنید.");
    }

    return NextResponse.json({
      success: true,
      message: "دستور حذف با موفقیت به دیتابیس ارسال شد."
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
