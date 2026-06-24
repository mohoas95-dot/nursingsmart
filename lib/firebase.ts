export const db = {};
export const auth = {
  currentUser: { uid: 'anonymous-user' }
};

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

function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

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
  let fullPath = '';
  if (id !== undefined) {
    const parentPath = (parent && parent.path) ? parent.path : '';
    if (parentPath) {
      fullPath = `${normalizePath(parentPath)}/${normalizePath(pathOrId)}/${normalizePath(id)}`;
    } else {
      fullPath = `${normalizePath(pathOrId)}/${normalizePath(id)}`;
    }
  } else {
    const parentPath = parent && parent.path ? parent.path : '';
    if (parentPath) {
      fullPath = `${normalizePath(parentPath)}/${normalizePath(pathOrId)}`;
    } else {
      fullPath = normalizePath(pathOrId);
    }
  }
  
  const parts = fullPath.split('/');
  const docId = parts[parts.length - 1] || '';
  
  return {
    type: 'document',
    path: fullPath,
    id: docId
  };
}

// In-memory cache
let storeCache: Record<string, any> = {};
let isFetching = false;
let lastFetchTime = 0;

async function fetchAllDocs(): Promise<Record<string, any>> {
  if (typeof window === 'undefined') return storeCache;
  try {
    const res = await fetch('/api/db');
    if (res.ok) {
      const rows = await res.json();
      const newStore: Record<string, any> = {};
      rows.forEach((row: any) => {
        newStore[row.path] = row.data;
      });
      storeCache = newStore;
      lastFetchTime = Date.now();
    }
  } catch (err) {
    console.error('Failed to fetch from DB API:', err);
  }
  return storeCache;
}

async function syncStore() {
  if (isFetching) return;
  isFetching = true;
  const oldStore = JSON.stringify(storeCache);
  await fetchAllDocs();
  const newStore = JSON.stringify(storeCache);
  
  if (oldStore !== newStore) {
    // Determine changed paths
    const changedPaths: string[] = [];
    const oldKeys = Object.keys(JSON.parse(oldStore || '{}'));
    const newKeys = Object.keys(storeCache);
    
    for (const key of newKeys) {
      if (JSON.stringify(storeCache[key]) !== JSON.stringify(JSON.parse(oldStore || '{}')[key])) {
        changedPaths.push(key);
      }
    }
    for (const key of oldKeys) {
      if (!storeCache.hasOwnProperty(key)) {
        changedPaths.push(key);
      }
    }
    triggerListeners(changedPaths);
  }
  isFetching = false;
}

interface SnapshotListener {
  id: string;
  ref: AppReference;
  callback: (snapshot: any) => void;
}

let activeListeners: SnapshotListener[] = [];

function triggerListeners(changedPaths: string[]) {
  setTimeout(() => {
    activeListeners.forEach((listener) => {
      const ref = listener.ref;
      if (ref.type === 'document') {
        if (changedPaths.includes(ref.path) || changedPaths.length === 0) {
          const data = storeCache[ref.path];
          listener.callback(new DocSnapshot(ref.id, data));
        }
      } else if (ref.type === 'collection') {
        const isCollectionAffected = changedPaths.length === 0 || changedPaths.some((cp) => {
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

function getCollectionDocs(collectionPath: string): DocSnapshot[] {
  const docs: DocSnapshot[] = [];
  Object.keys(storeCache).forEach((key) => {
    if (key.startsWith(collectionPath + '/') && key.substring(collectionPath.length + 1).indexOf('/') === -1) {
      docs.push(new DocSnapshot(key.split('/').pop() || '', storeCache[key]));
    }
  });
  return docs;
}

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

export async function getDoc(docRef: DocumentReference): Promise<DocSnapshot> {
  // Try to use cache if recent, else fetch
  if (Date.now() - lastFetchTime > 2000) {
    await fetchAllDocs();
  }
  const data = storeCache[docRef.path];
  return new DocSnapshot(docRef.id, data);
}

export async function setDoc(
  docRef: DocumentReference, 
  data: any, 
  options?: { merge?: boolean }
): Promise<void> {
  const existing = storeCache[docRef.path] || {};
  let newData = data;
  
  if (options?.merge) {
    newData = { ...existing, ...data };
  }
  
  storeCache[docRef.path] = newData;
  triggerListeners([docRef.path]);

  if (typeof window !== 'undefined') {
    await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{ type: 'set', path: docRef.path, data: newData }]
      })
    });
  }
}

export async function deleteDoc(docRef: DocumentReference): Promise<void> {
  delete storeCache[docRef.path];
  triggerListeners([docRef.path]);

  if (typeof window !== 'undefined') {
    await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{ type: 'delete', path: docRef.path }]
      })
    });
  }
}

export interface WriteBatch {
  set: (docRef: DocumentReference, data: any, options?: { merge?: boolean }) => void;
  delete: (docRef: DocumentReference) => void;
  commit: () => Promise<void>;
}

export function writeBatch(dbInstance?: any): WriteBatch {
  const operations: Array<{
    type: 'set' | 'delete';
    path: string;
    data?: any;
    options?: { merge?: boolean };
  }> = [];

  return {
    set(docRef, data, options) {
      operations.push({ type: 'set', path: docRef.path, data, options });
    },
    delete(docRef) {
      operations.push({ type: 'delete', path: docRef.path });
    },
    async commit() {
      const changedPaths: string[] = [];
      const apiOps: Array<any> = [];
      
      operations.forEach((op) => {
        if (op.type === 'set') {
          const existing = storeCache[op.path] || {};
          let newData = op.data;
          if (op.options?.merge) {
            newData = { ...existing, ...op.data };
          }
          storeCache[op.path] = newData;
          apiOps.push({ type: 'set', path: op.path, data: newData });
          if (!changedPaths.includes(op.path)) changedPaths.push(op.path);
        } else if (op.type === 'delete') {
          delete storeCache[op.path];
          apiOps.push({ type: 'delete', path: op.path });
          if (!changedPaths.includes(op.path)) changedPaths.push(op.path);
        }
      });
      
      triggerListeners(changedPaths);

      if (typeof window !== 'undefined') {
        await fetch('/api/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations: apiOps })
        });
      }
    }
  };
}

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
  const listenerId = Math.random().toString(36).substring(2, 9);
  const listener: SnapshotListener = { id: listenerId, ref, callback };
  activeListeners.push(listener);
  
  // Initial fetch
  if (Object.keys(storeCache).length === 0) {
    syncStore().then(() => {
      triggerListeners([]);
    });
  } else {
    setTimeout(() => {
      if (!activeListeners.some(l => l.id === listenerId)) return;
      if (ref.type === 'document') {
        const data = storeCache[ref.path];
        callback(new DocSnapshot(ref.id, data));
      } else {
        const docs = getCollectionDocs(ref.path);
        callback(new QuerySnapshot(docs));
      }
    }, 0);
  }
  
  return () => {
    activeListeners = activeListeners.filter(l => l.id !== listenerId);
  };
}

// Global poller for real-time updates across clients
if (typeof window !== 'undefined') {
  setInterval(() => {
    if (activeListeners.length > 0) {
      syncStore();
    }
  }, 5000);
  
  // Initial sync on load
  syncStore();
}
