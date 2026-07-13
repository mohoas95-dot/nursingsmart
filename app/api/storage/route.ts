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
    
    if (!body || !body.state) {
      return NextResponse.json({
        success: false,
        error: 'Missing required state object in request body'
      }, { status: 400 });
    }

    // ================= [ لکه‌گیری و فیلتر ملایم دیتای ارسالی فرانت‌اِند ] =================
    if (body.state.departments && Array.isArray(body.state.departments)) {
      const seenIds = new Set<string>();
      const seenNames = new Set<string>();

      body.state.departments = body.state.departments.filter((dept: any) => {
        if (!dept || !dept.name || !dept.id) return false;
        
        const normalizedName = dept.name.trim();
        const normalizedId = dept.id.toString().trim();

        // اگر آیدی یا نام تکراری بود (مثل اسپم شدن مهر)، آن را حذف کن
        if (seenIds.has(normalizedId) || seenNames.has(normalizedName)) {
          return false;
        }

        seenIds.add(normalizedId);
        seenNames.add(normalizedName);
        return true;
      });
    }
    // ===================================================================

    // ذخیره مستقیم دیتای فیلتر شده (دقیقاً با همان متد اصلی خودت)
    const success = await writeState(body.state);

    // پاسخ دقیق و استانداردی که فرانت‌اِند برای نشان دادن پیام موفقیت منتظرش است
    return NextResponse.json({
      success,
      isConfigured,
      message: success 
        ? 'Database state saved successfully to Iranian S3 storage.' 
        : 'S3 not configured or write failed, data saved to temporary memory.'
    });

  } catch (err: any) {
    console.error('API storage write error:', err);
    return NextResponse.json({
      success: false,
      error: err.message || 'Internal server error'
    }, { status: 500 });
  }
}
