import { NextResponse } from 'next/server';
import { db } from '@/lib/db'; 

export async function GET() {
  try {
    // این شرط دقیقاً فقط ردیف‌هایی که نامشان "سپهر" خالی است را حذف می‌کند
    const result = await db.department.deleteMany({
      where: { 
        name: 'سپهر' 
      }
    });
    
    return NextResponse.json({ 
      success: true,
      message: "پاک‌سازی اسپم‌ها با موفقیت انجام شد", 
      deletedCount: result.count 
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
