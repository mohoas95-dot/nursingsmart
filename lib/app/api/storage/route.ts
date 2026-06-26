import { NextRequest, NextResponse } from 'next/server';
import { getDoc, setDoc, deleteDoc, listCollection, isS3Configured } from '@/lib/s3';
import { INITIAL_DEPARTMENTS, INITIAL_PERSONNEL, INITIAL_SETTINGS, INITIAL_REQUESTS } from '@/lib/mockData';

// Seed database with beautiful initial data if it's empty
async function seedDatabaseIfNeeded() {
  try {
    const departments = await listCollection('departments');
    if (departments.length === 0) {
      console.log('Seeding initial database...');
      
      // 1. Create departments
      for (const dept of INITIAL_DEPARTMENTS) {
        await setDoc(`departments/${dept.id}`, {
          id: dept.id,
          name: dept.name,
        });

        // 2. Set default system settings for each dept
        await setDoc(`departments/${dept.id}/settings/system`, INITIAL_SETTINGS);

        // 3. Set default head nurse credentials
        await setDoc(`departments/${dept.id}/settings/credentials`, {
          username: dept.managerUsername || `${dept.id}_head`,
          password: dept.managerPassword || '123',
        });

        // 4. Sepehr specific mock personnel and requests
        if (dept.id === 'sepehr') {
          for (const person of INITIAL_PERSONNEL) {
            await setDoc(`departments/sepehr/personnel/${person.id}`, person);
          }
          for (const req of INITIAL_REQUESTS) {
            await setDoc(`departments/sepehr/requests/${req.id}`, req);
          }
        } else {
          // Add head nurse as a personnel in Bavand
          await setDoc(`departments/bavand/personnel/head`, {
            id: 'head',
            firstName: 'سارا',
            lastName: 'بهرامی',
            conscript: false,
            contractType: 'official',
            role: 'head_nurse',
            gender: 'female',
            active: true,
            targetWorkHours: 160,
            phone: '09129999999',
            email: 's.bahrami@gmail.com',
            orderIndex: 0
          });
        }
      }
      console.log('Database seeding completed successfully.');
    }
  } catch (err) {
    console.error('Error during database seeding:', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    // Seed on first request if empty
    await seedDatabaseIfNeeded();

    const body = await req.json();
    const { action, path, data, operations, merge } = body;

    if (!action) {
      return NextResponse.json({ error: 'Action is required' }, { status: 400 });
    }

    const s3Status = isS3Configured();

    switch (action) {
      case 'getDoc': {
        if (!path) return NextResponse.json({ error: 'Path is required' }, { status: 400 });
        const result = await getDoc(path);
        return NextResponse.json({ data: result, s3: s3Status });
      }

      case 'setDoc': {
        if (!path || data === undefined) return NextResponse.json({ error: 'Path and data are required' }, { status: 400 });
        
        let finalData = data;
        if (merge) {
          const existing = await getDoc(path);
          if (existing) {
            finalData = { ...existing, ...data };
          }
        }
        
        await setDoc(path, finalData);
        return NextResponse.json({ success: true, s3: s3Status });
      }

      case 'deleteDoc': {
        if (!path) return NextResponse.json({ error: 'Path is required' }, { status: 400 });
        await deleteDoc(path);
        return NextResponse.json({ success: true, s3: s3Status });
      }

      case 'listCollection': {
        if (!path) return NextResponse.json({ error: 'Path is required' }, { status: 400 });
        const list = await listCollection(path);
        return NextResponse.json({ data: list, s3: s3Status });
      }

      case 'writeBatch': {
        if (!operations || !Array.isArray(operations)) {
          return NextResponse.json({ error: 'Operations array is required' }, { status: 400 });
        }
        
        for (const op of operations) {
          if (op.action === 'set') {
            let finalData = op.data;
            if (op.merge) {
              const existing = await getDoc(op.path);
              if (existing) {
                finalData = { ...existing, ...op.data };
              }
            }
            await setDoc(op.path, finalData);
          } else if (op.action === 'delete') {
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
