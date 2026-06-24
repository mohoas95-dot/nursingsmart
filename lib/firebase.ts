import type { DocumentData } from 'firebase/firestore';

export interface MockDocumentSnapshot<T = DocumentData> {
  id: string;
  exists(): boolean;
  data(): T | undefined;
}

export interface MockQueryDocumentSnapshot<T = DocumentData> {
  id: string;
  data(): T;
}

export interface MockQuerySnapshot<T = DocumentData> {
  docs: MockQueryDocumentSnapshot<T>[];
  empty: boolean;
  size: number;
  forEach(callback: (result: MockQueryDocumentSnapshot<T>) => void): void;
}

export class MockDocumentReference {
  constructor(public db: any, public path: string) {}
  get id(): string {
    const parts = this.path.split('/');
    return parts[parts.length - 1];
  }
}

export class MockCollectionReference {
  constructor(public db: any, public path: string) {}
  get id(): string {
    const parts = this.path.split('/');
    return parts[parts.length - 1];
  }
}

export class MockQuery {
  constructor(public reference: MockCollectionReference, public constraints: any[] = []) {}
  get path(): string {
    return this.reference.path;
  }
}

export const db = { type: 'firestore-proxy-db' };

export const auth = {
  currentUser: null
};

export async function signInAnonymously() {
  return { user: { uid: 'anonymous-proxy-user' } };
}

export function doc(
  first: any,
  second?: string,
  third?: string
): MockDocumentReference {
  if (typeof first === 'string') {
    return new MockDocumentReference(null, first);
  }
  if (first instanceof MockCollectionReference) {
    const path = first.path + '/' + second;
    return new MockDocumentReference(first.db, path);
  }
  if (third) {
    const path = second + '/' + third;
    return new MockDocumentReference(first, path);
  }
  return new MockDocumentReference(first, second!);
}

export function collection(
  first: any,
  second: string
): MockCollectionReference {
  if (first instanceof MockDocumentReference) {
    return new MockCollectionReference(first.db, first.path + '/' + second);
  }
  return new MockCollectionReference(first, second);
}

export function query(reference: MockCollectionReference, ...constraints: any[]): MockQuery {
  return new MockQuery(reference, constraints);
}

export function where(field: string, op: string, value: any) {
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
  return { type: 'orderBy', field, direction };
}

export function limit(value: number) {
  return { type: 'limit', value };
}

export async function getDoc(docRef: MockDocumentReference): Promise<MockDocumentSnapshot> {
  const res = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'getDoc',
      path: docRef.path
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch document');
  }
  const result = await res.json();
  return {
    id: result.id,
    exists: () => result.exists,
    data: () => result.data
  };
}

export async function getDocs(target: MockCollectionReference | MockQuery): Promise<MockQuerySnapshot> {
  const path = target instanceof MockQuery ? target.reference.path : target.path;
  const constraints = target instanceof MockQuery ? target.constraints : [];

  const res = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'getDocs',
      path,
      constraints
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch collection');
  }
  const result = await res.json();
  const docs = result.docs.map((d: any) => ({
    id: d.id,
    data: () => d.data
  }));
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: (callback: (result: MockQueryDocumentSnapshot) => void) => {
      docs.forEach(callback);
    }
  };
}

export async function setDoc(
  docRef: MockDocumentReference,
  data: any,
  options?: any
): Promise<void> {
  const res = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'setDoc',
      path: docRef.path,
      data,
      options
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to set document');
  }
}

export async function deleteDoc(docRef: MockDocumentReference): Promise<void> {
  const res = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'deleteDoc',
      path: docRef.path
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to delete document');
  }
}

export class MockWriteBatch {
  private operations: any[] = [];
  constructor(public db: any) {}

  set(docRef: MockDocumentReference, data: any, options?: any) {
    this.operations.push({
      type: 'set',
      path: docRef.path,
      data,
      options
    });
    return this;
  }

  delete(docRef: MockDocumentReference) {
    this.operations.push({
      type: 'delete',
      path: docRef.path
    });
    return this;
  }

  async commit(): Promise<void> {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'writeBatch',
        operations: this.operations
      })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to commit batch');
    }
  }
}

export function writeBatch(db: any): MockWriteBatch {
  return new MockWriteBatch(db);
}

export function onSnapshot(
  ref: MockCollectionReference | MockQuery | MockDocumentReference,
  onNext: (snapshot: any) => void,
  onError?: (err: any) => void
): () => void {
  let active = true;
  let intervalId: any = null;

  async function poll() {
    try {
      if (ref instanceof MockCollectionReference || ref instanceof MockQuery) {
        const snap = await getDocs(ref);
        if (active) onNext(snap);
      } else {
        const snap = await getDoc(ref);
        if (active) onNext(snap);
      }
    } catch (err) {
      if (active && onError) {
        onError(err);
      }
    }
  }

  poll();

  intervalId = setInterval(() => {
    if (active) poll();
  }, 7000);

  return () => {
    active = false;
    if (intervalId) {
      clearInterval(intervalId);
    }
  };
}
