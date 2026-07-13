import { NextResponse } from 'next/server';
import { readState, writeState } from '@/lib/s3Storage';

export async function GET() {
  try {
    // ۱. خواندن دیتای فعلی از صندوقچه آروان
    const { state } = await readState();

    if (!state || !state.departments) {
      throw new Error("دیتای معتبری یافت نشد.");
    }

    // ۲. فیلتر کردن بخش‌ها: فقط ردیف‌هایی که نامشان "سپهر" خالی است حذف می‌شوند
    // بخش اصلی یعنی "بخش سپهر" دست‌نخورده باقی می‌ماند
    const cleanDepartments = state.departments.filter(
      (dept) => dept.name !== 'سپهر'
    );

    // محاسبه تعداد آیتم‌های حذف شده برای گزارش به شما
    const deletedCount = state.departments.length - cleanDepartments.length;

    // ۳. جایگذاری بخش‌های تمیز شده در ساختار اصلی (بدون دست زدن به پرسنل و شیفت‌ها)
    state.departments = cleanDepartments;

    // ۴. ذخیره مجدد فایل اصلاح‌شده در صندوقچه آروان
    await writeState(state);

    return NextResponse.json({
      success: true,
      message: "پاک‌سازی اسپم‌ها با موفقیت انجام شد. اطلاعات پرسنل و شیفت‌ها کاملاً حفظ شد.",
      deletedCount: deletedCount
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: "خطا در پردازش فایل",
      details: err?.message || err
    }, { status: 500 });
  }
}
 
