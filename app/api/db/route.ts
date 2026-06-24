import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../src/db/index.ts';
import { documents } from '../../../src/db/schema.ts';
import { eq, inArray, like } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const path = url.searchParams.get('path');
  const isCollection = url.searchParams.get('isCollection') === 'true';

  try {
    if (path) {
      if (isCollection) {
        // Return all documents starting with path/ and no deeper subcollections
        // Actually, we can just use `like` and filter in memory for exact depth to be safe
        const allDocs = await db.select().from(documents).where(like(documents.path, `${path}/%`));
        const filtered = allDocs.filter(d => {
           const remainder = d.path.substring(path.length + 1);
           return remainder.indexOf('/') === -1;
        });
        return NextResponse.json(filtered);
      } else {
        const doc = await db.select().from(documents).where(eq(documents.path, path)).limit(1);
        if (doc.length > 0) {
          return NextResponse.json(doc[0]);
        }
        return NextResponse.json(null);
      }
    } else {
      // Return all documents
      const allDocs = await db.select().from(documents);
      return NextResponse.json(allDocs);
    }
  } catch (error: any) {
    console.error('DB GET Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { operations } = body; 
    // operations: Array<{ type: 'set' | 'delete', path: string, data?: any }>

    // We can run this in a transaction
    await db.transaction(async (tx) => {
      for (const op of operations) {
        if (op.type === 'set') {
          // upsert
          await tx.insert(documents).values({
            path: op.path,
            data: op.data,
            updatedAt: new Date(),
          }).onConflictDoUpdate({
            target: documents.path,
            set: {
              data: op.data,
              updatedAt: new Date(),
            }
          });
        } else if (op.type === 'delete') {
          await tx.delete(documents).where(eq(documents.path, op.path));
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DB POST Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
