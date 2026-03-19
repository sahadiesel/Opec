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
 * Service for managing Daily Timesheets and their workflow transitions.
 */
export class TimesheetService {
  constructor(private db: Firestore) {}

  private getCollection(): CollectionReference {
    return collection(this.db, 'daily_timesheets');
  }

  getTimesheetId(workerId: string, assignmentId: string, date: string): string {
    return `${workerId}_${assignmentId}_${date}`;
  }

  canEdit(status: DailyTimesheetStatus): boolean {
    return !['CLIENT_APPROVED', 'LOCKED'].includes(status);
  }

  async createTimesheet(data: Partial<DailyTimesheet>, user: User) {
    if (!data.workerId || !data.assignmentId || !data.date) {
      throw new Error('Identity fields (worker, assignment, date) are required');
    }

    const id = this.getTimesheetId(data.workerId, data.assignmentId, data.date);
    const docRef = doc(this.getCollection(), id);
    
    const existing = await getDoc(docRef);
    if (existing.exists()) {
      throw new Error(`Timesheet already exists for this date: ${data.date}`);
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

    await setDoc(docRef, validated);
    
    await writeAuditLog(this.db, user, {
      actionType: 'CREATE',
      entityType: 'DailyTimesheet',
      entityId: id,
      entityLabel: `${validated.workerNameSnapshot} - ${validated.date}`,
      sourceModule: 'operations',
      afterSummary: `Created timesheet for ${validated.date}`
    });

    return id;
  }

  async submitTimesheet(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
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
      sourceModule: 'operations'
    });
  }

  async opsReview(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'OPS_REVIEWED',
      opsReviewedBy: user.displayName,
      opsReviewedAt: Date.now(),
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'REVIEW',
      entityType: 'DailyTimesheet',
      entityId: id,
      sourceModule: 'operations'
    });
  }

  async clientApprove(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'CLIENT_APPROVED',
      clientApprovedBy: user.displayName,
      clientApprovedAt: Date.now(),
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'APPROVE',
      entityType: 'DailyTimesheet',
      entityId: id,
      sourceModule: 'client',
      reasonCode: 'CLIENT_SIGNOFF'
    });
  }

  async reject(id: string, reason: string, user: User) {
    const docRef = doc(this.getCollection(), id);
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
      reasonText: reason,
      sourceModule: 'operations'
    });
  }

  async requestCorrection(id: string, reason: string, user: User) {
    const docRef = doc(this.getCollection(), id);
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
      reasonText: reason,
      sourceModule: 'operations'
    });
  }

  async lockTimesheet(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
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
      sourceModule: 'finance',
      reasonCode: 'PERIOD_CLOSED'
    });
  }
}
