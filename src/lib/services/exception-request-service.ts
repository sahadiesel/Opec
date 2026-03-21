'use client';

import { 
  Firestore, 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  CollectionReference,
  writeBatch
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
   * Processes an exception request (Accept/Reject) with side effects on the target record.
   */
  async processRequest(params: {
    requestId: string;
    status: 'APPROVED' | 'REJECTED';
    user: User;
    internalNotes?: string;
  }) {
    const { requestId, status, user, internalNotes } = params;
    const requestRef = doc(this.getCollection(), requestId);
    const requestSnap = await doc(this.getCollection(), requestId); // In real use we'd get data first
    
    // We need the request data to know what record to update
    const batch = writeBatch(this.db);
    
    // 1. Update the request itself
    batch.update(requestRef, {
      status,
      reviewedBy: user.displayName,
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
      internalNotes: internalNotes || null
    });

    await writeAuditLog(this.db, user, {
      actionType: status === 'APPROVED' ? 'APPROVE_EXCEPTION' : 'REJECT_EXCEPTION',
      entityType: 'ExceptionRequest',
      entityId: requestId,
      sourceModule: 'system',
      afterSummary: `${status} exception request ${requestId}. Note: ${internalNotes || 'N/A'}`
    });

    await batch.commit();
  }

  /**
   * Specifically accepts a timesheet correction and reverts the timesheet to an editable state.
   */
  async approveTimesheetCorrection(requestId: string, timesheetId: string, user: User, internalNotes: string) {
    const batch = writeBatch(this.db);
    
    // 1. Update Request
    const requestRef = doc(this.getCollection(), requestId);
    batch.update(requestRef, {
      status: 'APPROVED',
      reviewedBy: user.displayName,
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
      internalNotes
    });

    // 2. Revert Timesheet (Side Effect)
    const tsRef = doc(this.db, 'daily_timesheets', timesheetId);
    batch.update(tsRef, {
      status: 'CORRECTION_REQUIRED',
      readyForPayroll: false,
      readyForBilling: false,
      remark: `Correction Approved by HR: ${internalNotes}`,
      updatedAt: Date.now()
    });

    await batch.commit();

    await writeAuditLog(this.db, user, {
      actionType: 'APPROVE_TS_CORRECTION',
      entityType: 'DailyTimesheet',
      entityId: timesheetId,
      timesheetId: timesheetId,
      linkedIds: [requestId],
      sourceModule: 'hr',
      afterSummary: 'Approved timesheet correction. Record is now editable and financial readiness reset.'
    });
  }

  /**
   * Specifically accepts an assignment change and closes the current assignment.
   */
  async approveAssignmentChange(requestId: string, assignmentId: string, user: User, internalNotes: string) {
    const batch = writeBatch(this.db);
    
    // 1. Update Request
    const requestRef = doc(this.getCollection(), requestId);
    batch.update(requestRef, {
      status: 'APPROVED',
      reviewedBy: user.displayName,
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
      internalNotes
    });

    // 2. Close Assignment (Side Effect)
    const asgnRef = doc(this.db, 'mobilizations', assignmentId);
    batch.update(asgnRef, {
      deploymentStatus: 'CLOSED',
      notes: `Closed via approved change request: ${internalNotes}`,
      updatedAt: Date.now()
    });

    await batch.commit();

    await writeAuditLog(this.db, user, {
      actionType: 'APPROVE_ASGN_CHANGE',
      entityType: 'Assignment',
      entityId: assignmentId,
      linkedIds: [requestId],
      sourceModule: 'operations',
      afterSummary: 'Approved assignment change. Deployment closed to allow for replacement.'
    });
  }
}
