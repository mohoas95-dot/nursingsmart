// Since we are replacing Firebase, we define a lightweight client-side persistent engine
// that works completely offline in the browser, bypassing all filters, restrictions, and VPN requirements in Iran.

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

// Helper to normalize paths (remove leading/trailing slashes)
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
  let fullPath = '';
  if (id !== undefined) {
    // Called as doc(db, colPath, docId) or doc(colRef, docId)
    const parentPath = typeof parent === 'string' ? parent : (parent.path || '');
    fullPath = `${normalizePath(parentPath)}/${normalizePath(pathOrId)}`;
  } else {
    // Called as doc(db, docPath)
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
    // Trigger storage event manually for the same tab listeners
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
  activeListeners.forEach((listener) => {
    const ref = listener.ref;
    if (ref.type === 'document') {
      // Trigger if this document's path is one of the changed paths
      if (changedPaths.includes(ref.path)) {
        const store = getStore();
        const data = store[ref.path];
        listener.callback(new DocSnapshot(ref.id, data));
      }
    } else if (ref.type === 'collection') {
      // Trigger if any changed path belongs to this collection
      const isCollectionAffected = changedPaths.some((cp) => {
        return cp.startsWith(ref.path + '/') && cp.substring(ref.path.length + 1).indexOf('/') === -1;
      });
      if (isCollectionAffected) {
        const docs = getCollectionDocs(ref.path);
        listener.callback(new QuerySnapshot(docs));
      }
    }
  });
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
  const store = getStore();
  const existing = store[docRef.path] || {};
  
  if (options?.merge) {
    store[docRef.path] = { ...existing, ...data };
  } else {
    store[docRef.path] = data;
  }
  
  saveStore(store);
  triggerListeners([docRef.path]);
}

// Delete document
export async function deleteDoc(docRef: DocumentReference): Promise<void> {
  const store = getStore();
  delete store[docRef.path];
  saveStore(store);
  triggerListeners([docRef.path]);
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
      
      operations.forEach((op) => {
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
      
      saveStore(store);
      triggerListeners(changedPaths);
    }
  };
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
  const listenerId = Math.random().toString(36).substring(2, 9);
  
  const listener: SnapshotListener = {
    id: listenerId,
    ref,
    callback
  };
  
  activeListeners.push(listener);
  
  // Immediately execute the callback with the current state (async to simulate firestore)
  setTimeout(() => {
    // Ensure the listener is still active before executing
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
  window.addEventListener('storage', () => {
    // When localStorage changes, trigger all active listeners with the new values
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
  });
}
