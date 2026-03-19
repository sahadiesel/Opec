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

/**
 * Service for managing Daily Timesheets and their workflow transitions.
 */
export class TimesheetService {
  constructor(private db: Firestore) {}

  private getCollection(): CollectionReference {
    return collection(this.db, 'daily_timesheets');
  }

  /**
   * Generates a deterministic ID to enforce uniqueness per worker/assignment/date.
   */
  getTimesheetId(workerId: string, assignmentId: string, date: string): string {
    return `${workerId}_${assignmentId}_${date}`;
  }

  /**
   * Checks if a timesheet is in a status that allows editing.
   */
  canEdit(status: DailyTimesheetStatus): boolean {
    return !['CLIENT_APPROVED', 'LOCKED'].includes(status);
  }

  /**
   * Creates a new daily timesheet.
   */
  async createTimesheet(data: Partial<DailyTimesheet>, user: User) {
    if (!data.workerId || !data.assignmentId || !data.date) {
      throw new Error('Identity fields (worker, assignment, date) are required');
    }

    const id = this.getTimesheetId(data.workerId, data.assignmentId, data.date);
    const docRef = doc(this.getCollection(), id);
    
    // Check if exists
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
    return id;
  }

  /**
   * Updates a timesheet draft.
   */
  async updateDraft(id: string, data: Partial<DailyTimesheet>, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');
    
    const current = snap.data() as DailyTimesheet;
    if (!this.canEdit(current.status)) {
      throw new Error(`Cannot edit timesheet in status: ${current.status}`);
    }

    const updateData = {
      ...data,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    };

    await updateDoc(docRef, updateData);
  }

  /**
   * Transitions a timesheet to SUBMITTED.
   */
  async submitTimesheet(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'SUBMITTED',
      submittedBy: user.displayName,
      submittedAt: Date.now(),
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });
  }

  /**
   * Transitions a timesheet to OPS_REVIEWED.
   */
  async opsReview(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'OPS_REVIEWED',
      opsReviewedBy: user.displayName,
      opsReviewedAt: Date.now(),
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });
  }

  /**
   * Transitions a timesheet to CLIENT_APPROVED.
   * Prevents further destructive edits.
   */
  async clientApprove(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'CLIENT_APPROVED',
      clientApprovedBy: user.displayName,
      clientApprovedAt: Date.now(),
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });
  }

  /**
   * Rejects a timesheet.
   */
  async reject(id: string, reason: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'REJECTED',
      rejectionReason: reason,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });
  }

  /**
   * Requests a correction for a timesheet.
   */
  async requestCorrection(id: string, reason: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'CORRECTION_REQUIRED',
      correctionReason: reason,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });
  }

  /**
   * Transitions a timesheet to LOCKED.
   * Final state for payroll/billing processing.
   */
  async lockTimesheet(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'LOCKED',
      lockedBy: user.displayName,
      lockedAt: Date.now(),
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    });
  }
}
