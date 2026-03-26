import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  serverTimestamp,
  orderBy,
  limit
} from 'firebase/firestore';
import { db } from './firebase-config';
import { AuditLog } from './types';

export const dbService = {
  async getAll<T>(collectionName: string): Promise<T[]> {
    const colRef = collection(db, collectionName);
    const snapshot = await getDocs(colRef);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T));
  },

  async getById<T>(collectionName: string, id: string): Promise<T | null> {
    const docRef = doc(db, collectionName, id);
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
      return { id: snapshot.id, ...snapshot.data() } as T;
    }
    return null;
  },

  async create<T>(collectionName: string, data: any, userId: string, userName: string): Promise<string> {
    const colRef = collection(db, collectionName);
    const docRef = await addDoc(colRef, {
      ...data,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await this.logAudit({
      actionType: 'CREATE',
      entityType: collectionName,
      entityId: docRef.id,
      actorUserId: userId,
      actorName: userName,
      actorRole: 'system',
      afterSummary: typeof data === 'object' ? JSON.stringify(data).slice(0, 500) : String(data),
      eventAt: Date.now(),
    });

    return docRef.id;
  },

  async update(collectionName: string, id: string, data: any, userId: string, userName: string): Promise<void> {
    const docRef = doc(db, collectionName, id);
    await updateDoc(docRef, {
      ...data,
      updatedAt: Date.now(),
    });

    await this.logAudit({
      actionType: 'UPDATE',
      entityType: collectionName,
      entityId: id,
      actorUserId: userId,
      actorName: userName,
      actorRole: 'system',
      afterSummary: typeof data === 'object' ? JSON.stringify(data).slice(0, 500) : String(data),
      eventAt: Date.now(),
    });
  },

  async delete(collectionName: string, id: string, userId: string, userName: string): Promise<void> {
    const docRef = doc(db, collectionName, id);
    await deleteDoc(docRef);

    await this.logAudit({
      actionType: 'DELETE',
      entityType: collectionName,
      entityId: id,
      actorUserId: userId,
      actorName: userName,
      actorRole: 'system',
      eventAt: Date.now(),
    });
  },

  async logAudit(log: Omit<AuditLog, 'id'>) {
    const colRef = collection(db, 'audit_logs');
    await addDoc(colRef, log);
  },

  async getByQuery<T>(collectionName: string, field: string, value: any): Promise<T[]> {
    const colRef = collection(db, collectionName);
    const q = query(colRef, where(field, '==', value));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T));
  }
};