import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  getDocs, 
  collection, 
  setDoc, 
  deleteDoc, 
  writeBatch 
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

// Load Firebase Config dynamically from the root directory
const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Initialize Firebase only once server-side to avoid duplicate app errors
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'getDoc') {
      const { path } = body;
      const docRef = doc(db, path);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return NextResponse.json({ exists: true, data: docSnap.data() });
      } else {
        return NextResponse.json({ exists: false, data: null });
      }
    } 
    
    if (action === 'getDocs') {
      const { path } = body;
      const colRef = collection(db, path);
      const querySnap = await getDocs(colRef);
      const docsData = querySnap.docs.map(d => ({
        id: d.id,
        data: d.data()
      }));
      return NextResponse.json({ docs: docsData });
    }

    if (action === 'setDoc') {
      const { path, data, options } = body;
      const docRef = doc(db, path);
      if (options && options.merge) {
        await setDoc(docRef, data, { merge: true });
      } else {
        await setDoc(docRef, data);
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'deleteDoc') {
      const { path } = body;
      const docRef = doc(db, path);
      await deleteDoc(docRef);
      return NextResponse.json({ success: true });
    }

    if (action === 'batch') {
      const { operations } = body;
      const batch = writeBatch(db);
      
      for (const op of operations) {
        const { type, path, data, options } = op;
        const docRef = doc(db, path);
        if (type === 'set') {
          if (options && options.merge) {
            batch.set(docRef, data, { merge: true });
          } else {
            batch.set(docRef, data);
          }
        } else if (type === 'delete') {
          batch.delete(docRef);
        }
      }
      
      await batch.commit();
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    console.error('Firebase proxy server-side error:', error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}
