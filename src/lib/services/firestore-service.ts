import { 
  Firestore,
  collection, 
  doc, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  getDoc, 
  getDocs, 
  query, 
  where,
  serverTimestamp 
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { AuditLog } from '@/lib/types';

/**
 * Standardized service for OPEC OpsFlow Firestore operations.
 */
export class FirestoreService {
  constructor(private db: Firestore) {}

  /**
   * Logs an action to the audit_logs collection.
   */
  async logAction(userId: string, actionType: AuditLog['actionType'], entityType: string, entityId: string, details: any) {
    const logsRef = collection(this.db, 'audit_logs');
    const logData = {
      userId,
      actionType,
      entityType,
      entityId,
      timestamp: Date.now(),
      details: JSON.stringify(details),
    };

    addDoc(logsRef, logData).catch(err => {
      console.warn('Failed to log audit action:', err);
    });
  }

  /**
   * Generic non-blocking add document.
   */
  async add(path: string, data: any, userId?: string) {
    const colRef = collection(this.db, path);
    return addDoc(colRef, {
      ...data,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).then(async (docRef) => {
      if (userId) {
        await this.logAction(userId, 'CREATE', path, docRef.id, data);
      }
      return docRef;
    }).catch(async (err) => {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path,
        operation: 'create',
        requestResourceData: data
      }));
      throw err;
    });
  }

  /**
   * Generic non-blocking update document.
   */
  async update(path: string, id: string, data: any, userId?: string) {
    const docRef = doc(this.db, path, id);
    return updateDoc(docRef, {
      ...data,
      updatedAt: Date.now(),
    }).then(async () => {
      if (userId) {
        await this.logAction(userId, 'UPDATE', path, id, data);
      }
    }).catch(async (err) => {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: `${path}/${id}`,
        operation: 'update',
        requestResourceData: data
      }));
      throw err;
    });
  }

  /**
   * Generic non-blocking delete document.
   */
  async delete(path: string, id: string, userId?: string) {
    const docRef = doc(this.db, path, id);
    return deleteDoc(docRef).then(async () => {
      if (userId) {
        await this.logAction(userId, 'DELETE', path, id, { deleted: true });
      }
    }).catch(async (err) => {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: `${path}/${id}`,
        operation: 'delete'
      }));
      throw err;
    });
  }
}
