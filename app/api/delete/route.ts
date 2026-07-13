import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // از دیتابیس مستقیمِ اِج نِکست‌جی‌اس استفاده می‌کنیم تا به هیچ فایلی در پروژه‌ات نیاز نباشه
    // این کد یک درخواست مستقیم به دیتابیس شما می‌فرسته
    
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error("متغیر DATABASE_URL در تنطیمات ورسل یافت نشد.");
    }

    // اتصال مستقیم به کلاینت پیش‌فرض
    const { Client } = require('pg'); 
    const client = new Client({ connectionString: dbUrl });
    
    await client.connect();
    
    // اجرای کوئری حذف دقیق ردیف‌های "سپهر" (بدون آسیب به بخش پیش‌فرض)
    const res = await client.query(`DELETE FROM "Department" WHERE name = 'سپهر'`);
    
    await client.end();

    return NextResponse.json({
      success: true,
      message: "پاک‌سازی با موفقیت انجام شد",
      deletedCount: res.rowCount
    });

  } catch (err: any) {
    // اگر نام جدول به جای حروف بزرگ، کوچک بود (department)
    try {
      const dbUrl = process.env.DATABASE_URL;
      const { Client } = require('pg');
      const client = new Client({ connectionString: dbUrl });
      await client.connect();
      const res = await client.query(`DELETE FROM department WHERE name = 'سپهر'`);
      await client.end();
      return NextResponse.json({ success: true, message: "پاک‌سازی انجام شد (جدول کوچک)", deletedCount: res.rowCount });
    } catch (secondErr: any) {
      return NextResponse.json({
        success: false,
        error: "خطا در فرآیند حذف",
        details: err.message
      }, { status: 500 });
    }
  }
}
