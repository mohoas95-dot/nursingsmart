import { NextRequest, NextResponse } from 'next/server';
import { getDoc, setDoc, deleteDoc, listCollection, isS3Configured } from '@/lib/s3';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, path, data, operations } = body;

    if (!action) {
      return NextResponse.json({ error: 'Action is required' }, { status: 400 });
    }

    const s3Status = isS3Configured();

    switch (action) {
      case 'getDoc': {
        if (!path) {
          return NextResponse.json({ error: 'Path is required' }, { status: 400 });
        }
        const result = await getDoc(path);
        return NextResponse.json({ data: result, s3: s3Status });
      }

      case 'setDoc': {
        if (!path || data === undefined) {
          return NextResponse.json({ error: 'Path and data are required' }, { status: 400 });
        }
        await setDoc(path, data);
        return NextResponse.json({ success: true, s3: s3Status });
      }

      case 'deleteDoc': {
        if (!path) {
          return NextResponse.json({ error: 'Path is required' }, { status: 400 });
        }
        await deleteDoc(path);
        return NextResponse.json({ success: true, s3: s3Status });
      }

      case 'listCollection': {
        if (!path) {
          return NextResponse.json({ error: 'Path is required' }, { status: 400 });
        }
        const list = await listCollection(path);
        return NextResponse.json({ data: list, s3: s3Status });
      }

      case 'writeBatch': {
        if (!operations || !Array.isArray(operations)) {
          return NextResponse.json({ error: 'Operations array is required' }, { status: 400 });
        }

        for (const op of operations) {
          if (op.action === 'set' && op.path && op.data !== undefined) {
            await setDoc(op.path, op.data);
          } else if (op.action === 'delete' && op.path) {
            await deleteDoc(op.path);
          }
        }

        return NextResponse.json({ success: true, s3: s3Status });
      }

      case 'getS3ConfigStatus': {
        return NextResponse.json({ configured: s3Status });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    console.error('API Storage Route Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
