'use client';

import { 
  Firestore, 
  collection, 
  doc, 
  setDoc,
  updateDoc,
  CollectionReference 
} from 'firebase/firestore';
import { WorkerWaveAcceptance, User } from '@/lib/types';
import { WorkerWaveAcceptanceSchema } from '@/lib/validations/acceptance-schemas';

/**
 * Service for managing Client-side Worker Acceptance for Waves.
 */
export class WorkerWaveAcceptanceService {
  constructor(private db: Firestore) {}

  private getCollection(): CollectionReference {
    return collection(this.db, 'worker_wave_acceptances');
  }

  /**
   * Initializes a pending acceptance record.
   * Usually called by Operations when submitting a candidate to a client.
   */
  async createPendingAcceptance(data: Partial<WorkerWaveAcceptance>, user: User) {
    const id = data.id || `${data.waveId}_${data.assignmentId}`;
    const docRef = doc(this.getCollection(), id);
    
    const validated = WorkerWaveAcceptanceSchema.parse({
      ...data,
      id,
      status: 'pending',
      createdBy: user.displayName,
      updatedBy: user.displayName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await setDoc(docRef, validated);
    return id;
  }

  /**
   * Client accepts the worker for the wave.
   */
  async acceptWorkerForWave(id: string, user: User, remark?: string) {
    const docRef = doc(this.getCollection(), id);
    const now = new Date().toISOString().split('T')[0];
    
    await updateDoc(docRef, {
      status: 'accepted',
      remark: remark || null,
      approvedDate: now,
      customerPortalUserId: user.id,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });
  }

  /**
   * Client rejects the worker for the wave.
   */
  async rejectWorkerForWave(id: string, user: User, remark: string) {
    const docRef = doc(this.getCollection(), id);
    
    await updateDoc(docRef, {
      status: 'rejected',
      remark,
      customerPortalUserId: user.id,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });
  }

  /**
   * Client requests a replacement for the worker.
   */
  async requestReplacementForWave(id: string, user: User, remark: string) {
    const docRef = doc(this.getCollection(), id);
    
    await updateDoc(docRef, {
      status: 'replacement_requested',
      remark,
      customerPortalUserId: user.id,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });
  }
}
