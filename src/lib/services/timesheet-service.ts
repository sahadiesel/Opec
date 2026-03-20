
'use client';

import { 
  Firestore, 
  collection, 
  doc, 
  getDoc, 
  updateDoc, 
  setDoc,
  CollectionReference 
} from 'firebase/firestore';
import { DailyTimesheet, User, DailyTimesheetStatus } from '@/lib/types';
import { DailyTimesheetSchema } from '@/lib/validations/timesheet-schemas';
import { writeAuditLog } from './audit-service';

/**
 * Service for managing Daily Timesheets and their refined workflow transitions.
 * Ensures data integrity for downstream payroll and billing calculations.
 */
export class TimesheetService {
  constructor(private db: Firestore) {}

  private getCollection(): CollectionReference {
    return collection(this.db, 'daily_timesheets');
  }

  /**
   * Generates a deterministic ID to enforce uniqueness: worker + assignment + date
   */
  getTimesheetId(workerId: string, assignmentId: string, date: string): string {
    return `${workerId}_${assignmentId}_${date}`;
  }

  /**
   * Business Control: Defines which states allow for direct field modification.
   */
  canEdit(status: DailyTimesheetStatus): boolean {
    return ['DRAFT', 'REJECTED', 'CORRECTION_REQUIRED'].includes(status);
  }

  /**
   * Business Control: Defines states that are considered finalized for financial use.
   */
  isFinalized(status: DailyTimesheetStatus): boolean {
    return ['CLIENT_APPROVED', 'LOCKED'].includes(status);
  }

  /**
   * Creates a new daily timesheet entry.
   * Enforces uniqueness via deterministic ID.
   */
  async createTimesheet(data: Partial<DailyTimesheet>, user: User) {
    if (!data.workerId || !data.assignmentId || !data.date) {
      throw new Error('Identity fields (worker, assignment, date) are required');
    }

    const id = this.getTimesheetId(data.workerId, data.assignmentId, data.date);
    const docRef = doc(this.getCollection(), id);
    
    // Uniqueness check: Prevent silent overwrite of existing daily records
    const existing = await getDoc(docRef);
    if (existing.exists()) {
      throw new Error(`Timesheet record already exists for this identity and date: ${data.date}. Use the update or correction flow instead.`);
    }

    const validated = DailyTimesheetSchema.parse({
      ...data,
      id,
      status: 'DRAFT',
      createdBy: user.displayName,
      updatedBy: user.displayName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // High integrity write: Blocking
    await setDoc(docRef, validated);
    
    await writeAuditLog(this.db, user, {
      actionType: 'CREATE',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      waveId: validated.waveId,
      purchaseOrderId: validated.purchaseOrderId,
      entityLabel: `${validated.workerNameSnapshot} - ${validated.date}`,
      sourceModule: 'operations',
      afterSummary: `Created daily activity log for ${validated.date}`
    });

    return id;
  }

  /**
   * Updates an existing draft or rejected timesheet.
   * Business Rule: Blocks updates if the record is approved or locked.
   */
  async updateTimesheetDraft(id: string, data: Partial<DailyTimesheet>, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    
    if (!snap.exists()) throw new Error('Timesheet not found');
    const current = snap.data() as DailyTimesheet;

    if (!this.canEdit(current.status)) {
      throw new Error(`Integrity Error: Cannot edit timesheet in current status: ${current.status}. To make changes, the record must be rejected or marked for correction.`);
    }

    const updateData = {
      ...data,
      updatedBy: user.displayName,
      updatedAt: Date.now()
    };

    await updateDoc(docRef, updateData);

    await writeAuditLog(this.db, user, {
      actionType: 'UPDATE',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      sourceModule: 'operations',
      changedFields: Object.keys(data),
      afterSummary: 'Updated timesheet draft details'
    });
  }

  /**
   * Submits a timesheet for Operations review.
   */
  async submitTimesheet(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');
    const current = snap.data() as DailyTimesheet;

    if (!['DRAFT', 'REJECTED', 'CORRECTION_REQUIRED'].includes(current.status)) {
      throw new Error('Invalid Transition: Only drafts or rejected items can be submitted for review');
    }

    await updateDoc(docRef, {
      status: 'SUBMITTED',
      submittedBy: user.displayName,
      submittedAt: Date.now(),
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'SUBMIT',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      sourceModule: 'operations',
      afterSummary: 'Submitted daily log for operations review'
    });
  }

  /**
   * Operations internal verification.
   */
  async opsReview(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');
    if (snap.data()?.status !== 'SUBMITTED') throw new Error('Only submitted items can be reviewed by Ops');

    await updateDoc(docRef, {
      status: 'OPS_REVIEWED',
      opsReviewedBy: user.displayName,
      opsReviewedAt: Date.now(),
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'OPS_REVIEW',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      sourceModule: 'operations',
      afterSummary: 'Operations internal verification complete'
    });
  }

  /**
   * Client final sign-off.
   * Business Control: Blocking write ensures the approval state is settled.
   */
  async approveTimesheetByClient(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');
    if (snap.data()?.status !== 'OPS_REVIEWED') throw new Error('Client Approval Failed: Only ops-reviewed items can be approved');

    await updateDoc(docRef, {
      status: 'CLIENT_APPROVED',
      clientApprovedBy: user.displayName,
      clientApprovedAt: Date.now(),
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'CLIENT_APPROVE',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      sourceModule: 'client',
      reasonCode: 'CLIENT_SIGNOFF',
      afterSummary: 'Client final approval granted via portal'
    });
  }

  /**
   * Generic rejection by Ops or Client.
   */
  async rejectTimesheet(id: string, reason: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');
    
    // Cannot reject once locked for financial period
    if (snap.data()?.status === 'LOCKED') {
      throw new Error('Integrity Violation: Cannot reject a record that is already locked for a financial period.');
    }

    await updateDoc(docRef, {
      status: 'REJECTED',
      rejectionReason: reason,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'REJECT',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      reasonText: reason,
      sourceModule: 'operations',
      afterSummary: `Daily activity log rejected: ${reason}`
    });
  }

  /**
   * Request correction from the submitter.
   */
  async requestCorrection(id: string, reason: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');

    if (snap.data()?.status === 'LOCKED') {
      throw new Error('Integrity Violation: Locked records cannot be marked for correction.');
    }

    await updateDoc(docRef, {
      status: 'CORRECTION_REQUIRED',
      correctionReason: reason,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'CORRECTION_REQ',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      reasonText: reason,
      sourceModule: 'operations',
      afterSummary: `Correction requested for daily log: ${reason}`
    });
  }

  /**
   * Locks the timesheet for final payroll processing.
   * Business Control: Mandatory blocking write.
   */
  async lockTimesheet(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');
    if (snap.data()?.status !== 'CLIENT_APPROVED') throw new Error('Only client-approved items can be locked for financial periods');

    await updateDoc(docRef, {
      status: 'LOCKED',
      lockedBy: user.displayName,
      lockedAt: Date.now(),
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'LOCK',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      sourceModule: 'finance',
      reasonCode: 'PERIOD_CLOSED',
      afterSummary: 'Locked record for final financial processing'
    });
  }
}
