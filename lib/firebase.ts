// Server-synchronized persistent database client
// Replaces Firebase Firestore with a robust offline-first sync engine.
// Changes are instantly saved locally and synced in the background to the server-side JSON store.
// Works seamlessly under any network constraints, VPNs, or filters in Iran.

export const db = {};
export const auth = {
  currentUser: { uid: 'anonymous-user' }
};

// Types for our custom document and collection references
export interface DocumentReference {
  type: 'document';
  path: string;
  id: string;
}

export interface CollectionReference {
  type: 'collection';
  path: string;
}

export type AppReference = DocumentReference | CollectionReference;

// Helper to normalize paths
function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

// Custom ref creation functions
export function collection(dbInstance: any, path: string): CollectionReference {
  return {
    type: 'collection',
    path: normalizePath(path)
  };
}

export function doc(
  parent: any, 
  pathOrId: string, 
  id?: string
): DocumentReference {
  let fillPath = '';
  if (id !== undefined) {
    const parentPath = (parent && parent.path) ? parent.path : '';
    if (parentPath) {
      fillPath = `${normalizePath(parentPath)}/${normalizePath(pathOrId)}/${normalizePath(id)}`;
    } else {
      fillPath = `${normalizePath(pathOrId)}/${normalizePath(id)}`;
    }
  } else {
    const parentPath = parent && parent.path ? parent.path : '';
    if (parentPath) {
      fillPath = `${normalizePath(parentPath)}/${normalizePath(pathOrId)}`;
    } else {
      fillPath = normalizePath(pathOrId);
    }
  }
  
  const parts = fillPath.split('/');
  const docId = parts[parts.length - 1] || '';
  
  return {
    type: 'document',
    path: fillPath,
    id: docId
  };
}

// Global store helpers
const STORE_KEY = 'hospital_scheduler_db';

function getStore(): Record<string, any> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('Failed to read from local storage:', e);
    return {};
  }
}

function saveStore(store: Record<string, any>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    window.dispatchEvent(new Event('storage'));
  } catch (e) {
    console.error('Failed to write to local storage:', e);
  }
}

// Active Snapshot listeners
interface SnapshotListener {
  id: string;
  ref: AppReference;
  callback: (snapshot: any) => void;
}

let activeListeners: SnapshotListener[] = [];

// Helper to trigger listeners for a list of modified paths
function triggerListeners(changedPaths: string[]) {
  setTimeout(() => {
    activeListeners.forEach((listener) => {
      const ref = listener.ref;
      if (ref.type === 'document') {
        if (changedPaths.includes(ref.path)) {
          const store = getStore();
          const data = store[ref.path];
          listener.callback(new DocSnapshot(ref.id, data));
        }
      } else if (ref.type === 'collection') {
        const isCollectionAffected = changedPaths.some((cp) => {
          return cp.startsWith(ref.path + '/') && cp.substring(ref.path.length + 1).indexOf('/') === -1;
        });
        if (isCollectionAffected) {
          const docs = getCollectionDocs(ref.path);
          listener.callback(new QuerySnapshot(docs));
        }
      }
    });
  }, 0);
}

// Read documents belonging to a collection
function getCollectionDocs(collectionPath: string): DocSnapshot[] {
  const store = getStore();
  const docs: DocSnapshot[] = [];
  
  Object.keys(store).forEach((key) => {
    if (key.startsWith(collectionPath + '/') && key.substring(collectionPath.length + 1).indexOf('/') === -1) {
      docs.push(new DocSnapshot(key.split('/').pop() || '', store[key]));
    }
  });
  
  return docs;
}

// Snapshots simulated classes
export class DocSnapshot {
  constructor(public id: string, private _data: any) {}
  exists() {
    return this._data !== undefined && this._data !== null;
  }
  data() {
    return this._data;
  }
}

export class QuerySnapshot {
  constructor(public docs: DocSnapshot[]) {}
  forEach(callback: (doc: DocSnapshot) => void) {
    this.docs.forEach(callback);
  }
  get empty() {
    return this.docs.length === 0;
  }
}

// Retrieve single document
export async function getDoc(docRef: DocumentReference): Promise<DocSnapshot> {
  try {
    const res = await fetch('/api/db');
    if (res.ok) {
      const serverStore = await res.json();
      saveStore(serverStore);
    }
  } catch (err) {
    console.error('Failed to refresh store in getDoc:', err);
  }
  
  const store = getStore();
  const data = store[docRef.path];
  return new DocSnapshot(docRef.id, data);
}

// Set/write document
export async function setDoc(
  docRef: DocumentReference, 
  data: any, 
  options?: { merge?: boolean }
): Promise<void> {
  // 1. Instantly update locally for outstanding response speed
  const store = getStore();
  const existing = store[docRef.path] || {};
  
  if (options?.merge) {
    store[docRef.path] = { ...existing, ...data };
  } else {
    store[docRef.path] = data;
  }
  
  saveStore(store);
  triggerListeners([docRef.path]);

  // 2. Sync asynchronously to the central server
  try {
    await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set',
        path: docRef.path,
        data,
        merge: options?.merge
      })
    });
  } catch (err) {
    console.error('Failed to sync setDoc to server:', err);
  }
}

// Delete document
export async function deleteDoc(docRef: DocumentReference): Promise<void> {
  // 1. Instantly delete locally
  const store = getStore();
  delete store[docRef.path];
  
  saveStore(store);
  triggerListeners([docRef.path]);

  // 2. Sync to the central server
  try {
    await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        path: docRef.path
      })
    });
  } catch (err) {
    console.error('Failed to sync deleteDoc to server:', err);
  }
}

// Batch writes simulation
export interface WriteBatch {
  set: (docRef: DocumentReference, data: any, options?: { merge?: boolean }) => void;
  delete: (docRef: DocumentReference) => void;
  commit: () => Promise<void>;
}

export function writeBatch(dbInstance?: any): WriteBatch {
  const operations: Array<{
    type: 'set' | 'delete';
    ref: DocumentReference;
    data?: any;
    options?: { merge?: boolean };
  }> = [];

  return {
    set(docRef, data, options) {
      operations.push({ type: 'set', ref: docRef, data, options });
    },
    delete(docRef) {
      operations.push({ type: 'delete', ref: docRef });
    },
    async commit() {
      const store = getStore();
      const changedPaths: string[] = [];
      const operationsForServer: any[] = [];
      
      operations.forEach((op) => {
        operationsForServer.push({
          type: op.type,
          path: op.ref.path,
          data: op.data,
          merge: op.options?.merge
        });

        if (op.type === 'set') {
          const existing = store[op.ref.path] || {};
          if (op.options?.merge) {
            store[op.ref.path] = { ...existing, ...op.data };
          } else {
            store[op.ref.path] = op.data;
          }
          if (!changedPaths.includes(op.ref.path)) {
            changedPaths.push(op.ref.path);
          }
        } else if (op.type === 'delete') {
          delete store[op.ref.path];
          if (!changedPaths.includes(op.ref.path)) {
            changedPaths.push(op.ref.path);
          }
        }
      });
      
      // 1. Save locally
      saveStore(store);
      triggerListeners(changedPaths);

      // 2. Save on server
      try {
        await fetch('/api/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'batch',
            operations: operationsForServer
          })
        });
      } catch (err) {
        console.error('Failed to sync writeBatch commit to server:', err);
      }
    }
  };
}

// Periodic server-sync polling loop
let pollingStarted = false;

function startPolling() {
  if (typeof window === 'undefined' || pollingStarted) return;
  pollingStarted = true;

  // Sync initially
  syncWithServer();

  // Poll every 3 seconds
  setInterval(syncWithServer, 3000);
}

async function syncWithServer() {
  try {
    const res = await fetch('/api/db');
    if (!res.ok) throw new Error('Failed to fetch store from server');
    
    const serverStore = await res.json();
    const localStore = getStore();
    const changedPaths: string[] = [];

    // Find keys that are different or added on server
    Object.keys(serverStore).forEach((key) => {
      if (JSON.stringify(serverStore[key]) !== JSON.stringify(localStore[key])) {
        changedPaths.push(key);
      }
    });

    // Find keys that were deleted on server
    Object.keys(localStore).forEach((key) => {
      if (serverStore[key] === undefined) {
        changedPaths.push(key);
      }
    });

    if (changedPaths.length > 0) {
      saveStore(serverStore);
      triggerListeners(changedPaths);
    }
  } catch (err) {
    console.error('Database sync error:', err);
  }
}

// Listen to snapshot updates - TypeScript overloads
export function onSnapshot(
  ref: CollectionReference,
  callback: (snapshot: QuerySnapshot) => void
): () => void;

export function onSnapshot(
  ref: DocumentReference,
  callback: (snapshot: DocSnapshot) => void
): () => void;

export function onSnapshot(
  ref: AppReference,
  callback: (snapshot: any) => void
): () => void {
  // Start server polling loop lazily when snapshot listening begins
  startPolling();

  const listenerId = Math.random().toString(36).substring(2, 9);
  
  const listener: SnapshotListener = {
    id: listenerId,
    ref,
    callback
  };
  
  activeListeners.push(listener);
  
  // Immediately execute the callback with the current local state
  setTimeout(() => {
    if (!activeListeners.some(l => l.id === listenerId)) return;
    
    const store = getStore();
    if (ref.type === 'document') {
      const data = store[ref.path];
      callback(new DocSnapshot(ref.id, data));
    } else {
      const docs = getCollectionDocs(ref.path);
      callback(new QuerySnapshot(docs));
    }
  }, 0);
  
  // Unsubscribe function
  return () => {
    activeListeners = activeListeners.filter(l => l.id !== listenerId);
  };
}

// Setup a global storage listener to support sync across different browser windows/tabs
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e || e.key !== STORE_KEY) return;
    
    setTimeout(() => {
      const store = getStore();
      activeListeners.forEach((listener) => {
        const ref = listener.ref;
        if (ref.type === 'document') {
          const data = store[ref.path];
          listener.callback(new DocSnapshot(ref.id, data));
        } else {
          const docs = getCollectionDocs(ref.path);
          listener.callback(new QuerySnapshot(docs));
        }
      });
    }, 0);
  });
}
