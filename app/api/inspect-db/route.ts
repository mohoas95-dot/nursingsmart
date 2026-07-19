import { NextResponse } from 'next/server';
import { readState } from '../../../lib/s3Storage';

export async function GET() {
  try {
    const { client, bucket, isConfigured } = require('../../../lib/s3Storage').getS3Client();
    if (!isConfigured) return NextResponse.json({ error: 'S3 not configured' });
    
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: 'hospital-personnel-db.json',
      })
    );
    const dataString = await response.Body.transformToString();
    const state = JSON.parse(dataString);
    
    return NextResponse.json({
      departments: state.departments,
      deptDataKeys: Object.keys(state.deptData || {}),
      deptPersonnelCounts: Object.fromEntries(
        Object.entries(state.deptData || {}).map(([k, v]: [string, any]) => [k, v.personnel?.length || 0])
      ),
      rawState: state // BE CAREFUL with size, but we need to see it
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message });
  }
}
