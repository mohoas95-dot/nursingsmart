// Client-side Firestore Proxy to route all requests through the local /api/proxy endpoint
// This avoids direct client-side Firebase connections which are filtered/blocked in Iran.

export const db = { type: 'db' };

export const auth = {
  currentUser: null,
  onAuthStateChanged: (callback: (user: any) => void) => {
    // Immediately trigger with null as we use server-side operations without client auth
    setTimeout(() => callback(null), 0);
    return () => {};
  }
};

export function collection(parent: any, path: string) {
  let finalPath = path;
  if (parent && parent.type === 'document') {
    finalPath = `${parent.path}/${path}`;
  }
  return { type: 'collection', path: finalPath };
}

export function doc(first: any, second?: string, third?: string) {
  let finalPath = '';
  if (first && first.type === 'collection') {
    finalPath = second ? `${first.path}/${second}` : first.path;
  } else {
    // first is db
    if (third) {
      finalPath = `${second}/${third}`;
    } else {
      finalPath = second || '';
    }
  }
  return {
    type: 'document',
    path: finalPath,
    get id() { return finalPath.split('/').pop() || ''; }
  };
}

export async function getDoc(docRef: any) {
  try {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getDoc', path: docRef.path })
    });
    if (!res.ok) {
      throw new Error(`getDoc failed with status ${res.status}`);
    }
    const result = await res.json();
    return {
      exists: () => !!result.exists,
      data: () => result.data,
      id: docRef.id
    };
  } catch (err) {
    console.error('getDoc proxy error:', err);
    throw err;
  }
}

export async function getDocs(colRef: any) {
  try {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getDocs', path: colRef.path })
    });
    if (!res.ok) {
      throw new Error(`getDocs failed with status ${res.status}`);
    }
    const result = await res.json();
    const docs = (result.docs || []).map((d: any) => ({
      id: d.id,
      data: () => d.data,
      exists: () => true
    }));
    return {
      docs,
      forEach: (cb: any) => docs.forEach(cb),
      empty: docs.length === 0,
      size: docs.length
    };
  } catch (err) {
    console.error('getDocs proxy error:', err);
    throw err;
  }
}

export async function setDoc(docRef: any, data: any, options?: any) {
  try {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setDoc', path: docRef.path, data, options })
    });
    if (!res.ok) {
      throw new Error(`setDoc failed with status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error('setDoc proxy error:', err);
    throw err;
  }
}

export async function deleteDoc(docRef: any) {
  try {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteDoc', path: docRef.path })
    });
    if (!res.ok) {
      throw new Error(`deleteDoc failed with status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error('deleteDoc proxy error:', err);
    throw err;
  }
}

export function writeBatch(database?: any) {
  const operations: any[] = [];
  return {
    set: (docRef: any, data: any, options?: any) => {
      operations.push({ type: 'set', path: docRef.path, data, options });
    },
    delete: (docRef: any) => {
      operations.push({ type: 'delete', path: docRef.path });
    },
    commit: async () => {
      try {
        const res = await fetch('/api/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'batch', operations })
        });
        if (!res.ok) {
          throw new Error(`Batch commit failed with status ${res.status}`);
        }
        return await res.json();
      } catch (err) {
        console.error('batch.commit proxy error:', err);
        throw err;
      }
    }
  };
}

export function onSnapshot(ref: any, onNext: (snap: any) => void, onError?: (err: any) => void) {
  let active = true;
  let lastDataStr = '';
  let intervalId: any = null;

  const poll = async () => {
    if (!active) return;
    try {
      if (ref.type === 'document') {
        const snap = await getDoc(ref);
        if (!active) return;
        const currentDataStr = JSON.stringify({ exists: snap.exists(), data: snap.data() });
        if (currentDataStr !== lastDataStr) {
          lastDataStr = currentDataStr;
          onNext(snap);
        }
      } else {
        const querySnap = await getDocs(ref);
        if (!active) return;
        const currentDataStr = JSON.stringify(querySnap.docs.map(d => ({ id: d.id, data: d.data() })));
        if (currentDataStr !== lastDataStr) {
          lastDataStr = currentDataStr;
          onNext(querySnap);
        }
      }
    } catch (err) {
      console.error(`onSnapshot polling error for ${ref.path}:`, err);
      if (onError) onError(err);
    }
  };

  // Run first poll immediately
  poll();

  // Polling every 4 seconds to maintain good sync speed without overloading server
  intervalId = setInterval(poll, 4000);

  return () => {
    active = false;
    if (intervalId) {
      clearInterval(intervalId);
    }
  };
}
