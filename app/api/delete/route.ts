import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

// ساخت مستقیم نمونه دیتابیس برای جلوگیری از خطای import
const prisma = new PrismaClient();

export async function GET() {
  try {
    // حذف ردیف‌هایی که نام آن‌ها دقیقاً "سپهر" خالی است
    // توجه: اگر نام جدول شما در prisma به صورت کوچک (department) است، خط زیر را به prisma.department تغییر دهید
    const result = await prisma.department.deleteMany({
      where: {
        name: 'سپهر'
      }
    });

    return NextResponse.json({
      success: true,
      message: "پاک‌سازی با موفقیت انجام شد",
      deletedCount: result.count
    });
  } catch (err: any) {
    return NextResponse.json(
      { 
        success: false, 
        error: "خطا در فرآیند حذف", 
        details: err?.message || err 
      }, 
      { status: 500 }
    );
  } finally {
    // قطع اتصال پس از اتمام کار جهت جلوگیری از باز ماندن Connection pool
    await prisma.$disconnect();
  }
}
