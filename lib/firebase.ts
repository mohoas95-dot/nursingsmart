import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase only once to avoid duplicate app errors in Next.js hot-reloads
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Enable immediate anonymous authentication behind the scenes to satisfy security roles
if (typeof window !== 'undefined') {
  signInAnonymously(auth).catch((err) => {
    console.error('Anonymous auth failed:', err);
  });
}
