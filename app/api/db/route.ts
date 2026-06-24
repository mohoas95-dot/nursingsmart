import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { INITIAL_PERSONNEL } from '../../../lib/mockData';

const DB_FILE = path.join(process.cwd(), 'hospital_db.json');

// Default initial settings to seed
const INITIAL_SETTINGS = {
  monthlyHours: 176,
  requiredNursesPerShift: {
    morning: 4,
    evening: 4,
    night: 3
  },
  shiftLeadersCount: {
    morning: 1,
    evening: 1,
    night: 1
  },
  consecutiveShiftsLimit: 3,
  weekendDutyLimit: 2,
  nursePerPatientRatio: 5,
  hasEmergencyReserve: true,
  allowPreferencesSync: true,
  allowOvertimeRequest: true,
  activeDepartmentId: 'dep-sepehr',
  departments: [
    { id: 'dep-sepehr', name: 'بخش سپهر' }
  ]
};

// Initial shift requests to seed
const INITIAL_REQUESTS = [
  { id: 'req1', personnelId: 'p2', date: '1405-04-05', shiftType: 'off', status: 'approved', notes: 'درخواست مرخصی سالانه' },
  { id: 'req2', personnelId: 'p3', date: '1405-04-12', shiftType: 'night', status: 'approved', notes: 'درخواست شیفت شب ثابت' }
];

// Helper to seed the default store structure
function getSeedStore(): Record<string, any> {
  const store: Record<string, any> = {};
  
  // Seed system settings
  store['settings/system'] = INITIAL_SETTINGS;
  
  // Seed default login credentials
  store['settings/credentials'] = { username: 'headnurse', password: '123456' };
  
  // Seed personnel
  INITIAL_PERSONNEL.forEach((p, idx) => {
    store[`personnel/${p.id}`] = { ...p, orderIndex: idx };
  });
  
  // Seed requests
  INITIAL_REQUESTS.forEach((r) => {
    store[`requests/${r.id}`] = r;
  });

  return store;
}

// Safely read the JSON database from disk, seeding if necessary
function readDB(): Record<string, any> {
  if (!fs.existsSync(DB_FILE)) {
    const seed = getSeedStore();
    writeDB(seed);
    return seed;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const store = JSON.parse(raw);
    if (!store || Object.keys(store).length === 0) {
      const seed = getSeedStore();
      writeDB(seed);
      return seed;
    }
    return store;
  } catch (err) {
    console.error('Error reading hospital_db.json, returning seeded data:', err);
    const seed = getSeedStore();
    writeDB(seed);
    return seed;
  }
}

// Safely write the JSON database to disk
function writeDB(store: Record<string, any>) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing to hospital_db.json:', err);
  }
}

export async function GET() {
  const store = readDB();
  return NextResponse.json(store);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json({ error: 'Missing action parameter' }, { status: 400 });
    }

    const store = readDB();

    if (action === 'set') {
      const { path: docPath, data, merge } = body;
      if (!docPath) {
        return NextResponse.json({ error: 'Missing path' }, { status: 400 });
      }
      
      const existing = store[docPath] || {};
      if (merge) {
        store[docPath] = { ...existing, ...data };
      } else {
        store[docPath] = data;
      }
      writeDB(store);
      return NextResponse.json({ success: true, store });

    } else if (action === 'delete') {
      const { path: docPath } = body;
      if (!docPath) {
        return NextResponse.json({ error: 'Missing path' }, { status: 400 });
      }

      delete store[docPath];
      writeDB(store);
      return NextResponse.json({ success: true, store });

    } else if (action === 'batch') {
      const { operations } = body;
      if (!Array.isArray(operations)) {
        return NextResponse.json({ error: 'Operations must be an array' }, { status: 400 });
      }

      operations.forEach((op: any) => {
        const { type, path: docPath, data, merge } = op;
        if (!docPath) return;

        if (type === 'set') {
          const existing = store[docPath] || {};
          if (merge) {
            store[docPath] = { ...existing, ...data };
          } else {
            store[docPath] = data;
          }
        } else if (type === 'delete') {
          delete store[docPath];
        }
      });

      writeDB(store);
      return NextResponse.json({ success: true, store });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    console.error('Error in POST /api/db:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
