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
import { writeAuditLog } from './audit-service';

/**
 * Service for managing Client-side Worker Acceptance for Waves.
 * Handles the logic for customers to approve or request changes to their workforce.
 */
export class WorkerWaveAcceptanceService {
  constructor(private db: Firestore) {}

  private getCollection(): CollectionReference {
    return collection(this.db, 'worker_wave_acceptances');
  }

  /**
   * Initializes a pending acceptance record for a worker assigned to a wave.
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

    // High integrity write for commercial records
    await setDoc(docRef, validated);
    
    await writeAuditLog(this.db, user, {
      actionType: 'SUBMIT_CANDIDATE',
      entityType: 'WorkerWaveAcceptance',
      entityId: id,
      waveId: validated.waveId,
      linkedIds: [validated.waveId, validated.workerId],
      sourceModule: 'operations',
      afterSummary: 'Submitted candidate for client review'
    });

    return id;
  }

  /**
   * Finalizes the acceptance of a worker by the customer.
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

    await writeAuditLog(this.db, user, {
      actionType: 'ACCEPT',
      entityType: 'WorkerWaveAcceptance',
      entityId: id,
      reasonText: remark,
      sourceModule: 'client',
      afterSummary: 'Client accepted candidate for deployment'
    });
  }

  /**
   * Records a client's decision to reject a proposed worker.
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

    await writeAuditLog(this.db, user, {
      actionType: 'REJECT',
      entityType: 'WorkerWaveAcceptance',
      entityId: id,
      reasonText: remark,
      sourceModule: 'client',
      afterSummary: 'Client rejected candidate during review'
    });
  }

  /**
   * Records a request from the client to provide a different person for the role.
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

    await writeAuditLog(this.db, user, {
      actionType: 'REPLACEMENT_REQ',
      entityType: 'WorkerWaveAcceptance',
      entityId: id,
      reasonText: remark,
      sourceModule: 'client',
      afterSummary: 'Client requested personnel replacement'
    });
  }
}
