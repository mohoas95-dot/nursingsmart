import { NextResponse } from 'next/server';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  collection, 
  getDoc, 
  getDocs, 
  setDoc, 
  deleteDoc, 
  writeBatch,
  query,
  where,
  orderBy,
  limit
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

function getFirebaseDB() {
  if (getApps().length === 0) {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error('firebase-applet-config.json not found');
    }
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const app = initializeApp(firebaseConfig);
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  } else {
    const app = getApp();
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, path: targetPath, data, options, operations, constraints } = body;
    const db = getFirebaseDB();

    if (action === 'getDoc') {
      const docRef = doc(db, targetPath);
      const snap = await getDoc(docRef);
      return NextResponse.json({
        exists: snap.exists(),
        id: snap.id,
        data: snap.exists() ? snap.data() : null
      });
    }

    if (action === 'getDocs') {
      let q: any = collection(db, targetPath);
      if (constraints && Array.isArray(constraints)) {
        const queryConstraints = [];
        for (const c of constraints) {
          if (c.type === 'where') {
            queryConstraints.push(where(c.field, c.op, c.value));
          } else if (c.type === 'orderBy') {
            queryConstraints.push(orderBy(c.field, c.direction));
          } else if (c.type === 'limit') {
            queryConstraints.push(limit(c.value));
          }
        }
        if (queryConstraints.length > 0) {
          q = query(q, ...queryConstraints);
        }
      }

      const snap = await getDocs(q);
      const docs = snap.docs.map(d => ({
        id: d.id,
        data: d.data()
      }));
      return NextResponse.json({ docs });
    }

    if (action === 'setDoc') {
      const docRef = doc(db, targetPath);
      await setDoc(docRef, data, options || {});
      return NextResponse.json({ success: true });
    }

    if (action === 'deleteDoc') {
      const docRef = doc(db, targetPath);
      await deleteDoc(docRef);
      return NextResponse.json({ success: true });
    }

    if (action === 'writeBatch') {
      const batch = writeBatch(db);
      for (const op of operations) {
        if (op.type === 'set') {
          const docRef = doc(db, op.path);
          batch.set(docRef, op.data, op.options || {});
        } else if (op.type === 'delete') {
          const docRef = doc(db, op.path);
          batch.delete(docRef);
        }
      }
      await batch.commit();
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Proxy Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
