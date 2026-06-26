// S3-compatible Iranian Object Storage Backend Client for Next.js
const activeListeners = new Set<any>();

async function callStorageAPI(action: string, payload: any) {
  const res = await fetch('/api/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error ${res.status}`);
  }
  return await res.json();
}

function triggerImmediatePoll(changedPath: string) {
  activeListeners.forEach((listener) => {
    // If the listener's path matches the changed path or is a parent/child, trigger it
    if (
      listener.ref.path === changedPath ||
      changedPath.startsWith(listener.ref.path + '/') ||
      listener.ref.path.startsWith(changedPath + '/')
    ) {
      listener.triggerPoll();
    }
  });
}

export const db = { isS3Mock: true };

export function collection(...args: any[]): any {
  const parts = args.filter((x) => typeof x === 'string' || typeof x === 'number');
  return { type: 'collection', path: parts.join('/') };
}

export function doc(...args: any[]): any {
  if (args[0] && args[0].type === 'collection') {
    const subPath = args.slice(1).filter((x) => typeof x === 'string' || typeof x === 'number').join('/');
    return { type: 'document', path: `${args[0].path}/${subPath}` };
  }
  const parts = args.filter((x) => typeof x === 'string' || typeof x === 'number');
  return { type: 'document', path: parts.join('/') };
}

export async function getDoc(docRef: any): Promise<any> {
  const result = await callStorageAPI('getDoc', { path: docRef.path });
  const data = result.data;
  return {
    exists: () => data !== null && data !== undefined,
    data: () => data,
    id: docRef.path.split('/').pop() || '',
  };
}

export async function setDoc(docRef: any, data: any, options?: any): Promise<void> {
  await callStorageAPI('setDoc', {
    path: docRef.path,
    data,
    merge: !!(options && options.merge),
  });
  // Trigger immediate poll update for matching listeners
  triggerImmediatePoll(docRef.path);
}

export async function deleteDoc(docRef: any): Promise<void> {
  await callStorageAPI('deleteDoc', { path: docRef.path });
  // Trigger immediate poll update for matching listeners
  triggerImmediatePoll(docRef.path);
}

export function writeBatch(dbInstance: any): any {
  const operations: Array<{ action: 'set' | 'delete'; path: string; data?: any; merge?: boolean }> = [];
  return {
    set: (docRef: any, data: any, options?: any) => {
      operations.push({
        action: 'set',
        path: docRef.path,
        data,
        merge: !!(options && options.merge),
      });
    },
    delete: (docRef: any) => {
      operations.push({
        action: 'delete',
        path: docRef.path,
      });
    },
    commit: async () => {
      await callStorageAPI('writeBatch', { operations });
      // Trigger update for all modified paths
      for (const op of operations) {
        triggerImmediatePoll(op.path);
      }
    },
  };
}

export function onSnapshot(ref: any, callback: (snapshot: any) => void): () => void {
  let active = true;
  let lastDataStr = '';
  let timeoutId: NodeJS.Timeout | null = null;

  const poll = async () => {
    if (!active) return;
    try {
      if (ref.type === 'collection') {
        const result = await callStorageAPI('listCollection', { path: ref.path });
        const data = result.data || [];
        const dataStr = JSON.stringify(data);
        if (dataStr !== lastDataStr) {
          lastDataStr = dataStr;
          const snapshot = {
            forEach: (cb: (doc: any) => void) => {
              data.forEach((item: any) => {
                cb({
                  id: item.id || '',
                  data: () => item,
                });
              });
            },
            docs: data.map((item: any) => ({
              id: item.id || '',
              data: () => item,
            })),
          };
          callback(snapshot);
        }
      } else {
        const result = await callStorageAPI('getDoc', { path: ref.path });
        const data = result.data;
        const dataStr = JSON.stringify(data);
        if (dataStr !== lastDataStr) {
          lastDataStr = dataStr;
          const docSnap = {
            exists: () => data !== null && data !== undefined,
            data: () => data,
            id: ref.path.split('/').pop() || '',
          };
          callback(docSnap);
        }
      }
    } catch (err) {
      console.error(`onSnapshot polling error for ${ref.path}:`, err);
    }

    if (active) {
      timeoutId = setTimeout(poll, 4000); // Poll every 4 seconds
    }
  };

  const listener = {
    ref,
    triggerPoll: () => {
      if (timeoutId) clearTimeout(timeoutId);
      poll();
    },
  };

  activeListeners.add(listener);

  // Run the first poll immediately
  poll();

  return () => {
    active = false;
    if (timeoutId) clearTimeout(timeoutId);
    activeListeners.delete(listener);
  };
}
