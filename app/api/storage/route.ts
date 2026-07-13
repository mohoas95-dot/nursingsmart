Import { NextRequest, NextResponse } from 'next/server';
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
    
    if (!body || !body.state) {
      return NextResponse.json({
        success: false,
        error: 'Missing required state object in request body'
      }, { status: 400 });
    }

    const success = await writeState(body.state);

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
      error: err.message || 'Internal server error while writing database state'
    }, { status: 500 });
  }
}
