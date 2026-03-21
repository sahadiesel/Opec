
'use client';

import { 
  Firestore, 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  CollectionReference 
} from 'firebase/firestore';
import { ExceptionRequest, ExceptionRequestType, User } from '@/lib/types';
import { writeAuditLog } from './audit-service';

/**
 * Service for managing Client-initiated exception requests for post-approval changes.
 */
export class ExceptionRequestService {
  constructor(private db: Firestore) {}

  private getCollection(): CollectionReference {
    return collection(this.db, 'exception_requests');
  }

  /**
   * Creates a new exception request from a client.
   */
  async createRequest(params: {
    type: ExceptionRequestType;
    referenceId: string;
    referenceNo: string;
    reason: string;
    user: User;
  }) {
    if (!params.user.customerId) throw new Error('Unauthorized: Client user must have customerId');

    const requestRef = doc(this.getCollection());
    const now = Date.now();

    const requestData: ExceptionRequest = {
      id: requestRef.id,
      customerId: params.user.customerId,
      requestType: params.type,
      referenceId: params.referenceId,
      referenceNo: params.referenceNo,
      reason: params.reason,
      status: 'PENDING',
      requestedBy: params.user.displayName,
      requestedById: params.user.id,
      requestedAt: now,
      updatedAt: now,
    };

    await setDoc(requestRef, requestData);

    // Audit for OPEC staff
    await writeAuditLog(this.db, params.user, {
      actionType: 'CREATE_EXCEPTION_REQ',
      entityType: 'ExceptionRequest',
      entityId: requestRef.id,
      entityLabel: `${params.type}: ${params.referenceNo}`,
      sourceModule: 'client',
      linkedIds: [params.referenceId, params.user.customerId],
      afterSummary: `Customer requested a post-approval change for ${params.type} ${params.referenceNo}`
    });

    return requestRef.id;
  }

  /**
   * Updates the status of an exception request (Internal use).
   */
  async updateStatus(id: string, status: ExceptionRequest['status'], user: User, internalNotes?: string) {
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status,
      reviewedBy: user.displayName,
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
      internalNotes: internalNotes || null
    });

    await writeAuditLog(this.db, user, {
      actionType: 'REVIEW_EXCEPTION_REQ',
      entityType: 'ExceptionRequest',
      entityId: id,
      sourceModule: user.department === 'hr' ? 'hr' : 'operations',
      afterSummary: `Exception request ${id} updated to ${status}`
    });
  }
}
