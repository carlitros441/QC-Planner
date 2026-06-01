import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp
} from 'firebase/firestore';
import { db } from './firebase';
import type { AuditEntry } from './types';

const requireDb = () => {
  if (!db) throw new Error('Firebase is not configured.');
  return db;
};

export const toDoc = <T>(snapshot: { id: string; data: () => object }) => ({
  id: snapshot.id,
  ...snapshot.data()
}) as T;

export async function listDocs<T>(collectionName: string, orderByField?: string, direction: 'asc' | 'desc' = 'asc') {
  const database = requireDb();
  const ref = collection(database, collectionName);
  const snapshot = orderByField
    ? await getDocs(query(ref, orderBy(orderByField, direction)))
    : await getDocs(ref);
  return snapshot.docs.map(docSnap => toDoc<T>(docSnap));
}

export async function saveDoc<T extends object>(collectionName: string, payload: T, id?: string | null) {
  const database = requireDb();
  const cleanPayload = { ...payload } as Record<string, unknown>;
  delete cleanPayload.id;
  cleanPayload.updated_at = serverTimestamp();

  if (id) {
    await setDoc(doc(database, collectionName, id), cleanPayload, { merge: true });
    return id;
  }

  cleanPayload.created_at = serverTimestamp();
  const ref = await addDoc(collection(database, collectionName), cleanPayload);
  return ref.id;
}

export async function removeDoc(collectionName: string, id: string) {
  await deleteDoc(doc(requireDb(), collectionName, id));
}

export async function getOne<T>(collectionName: string, id: string) {
  const snapshot = await getDoc(doc(requireDb(), collectionName, id));
  return snapshot.exists() ? toDoc<T>(snapshot) : null;
}

export async function addAuditEntry(scheduleId: string, action: string, before: unknown, after: unknown, reason: string, user: string) {
  const database = requireDb();
  const entry: Omit<AuditEntry, 'id'> = {
    schedule_id: scheduleId,
    action,
    before: before || null,
    after: after || null,
    reason,
    user,
    timestamp: serverTimestamp()
  };
  const globalRef = await addDoc(collection(database, 'auditTrail'), entry);
  await setDoc(doc(database, 'schedules', scheduleId, 'auditTrail', globalRef.id), entry);
}

export async function loadAuditTrail(scheduleId: string) {
  const snapshot = await getDocs(query(collection(requireDb(), 'schedules', scheduleId, 'auditTrail'), orderBy('timestamp', 'desc')));
  return snapshot.docs.map(docSnap => toDoc<AuditEntry>(docSnap));
}

export const formatDate = (value?: string) => {
  if (!value) return '';
  return value.split('T')[0];
};

export const addDays = (dateString: string, deltaDays: number) => {
  if (!dateString) return '';
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + Number(deltaDays || 0));
  return date.toISOString().split('T')[0];
};

export const displayTimestamp = (value: unknown) => {
  if (!value) return '';
  if (value instanceof Timestamp) return value.toDate().toLocaleString();
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toLocaleString();
  }
  return String(value);
};
