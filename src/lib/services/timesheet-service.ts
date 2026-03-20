
'use client';

import { 
  Firestore, 
  collection, 
  doc, 
  getDoc, 
  updateDoc, 
  setDoc,
  CollectionReference,
  writeBatch,
  query,
  where,
  getDocs,
  limit
} from 'firebase/firestore';
import { 
  DailyTimesheet, 
  User, 
  DailyTimesheetStatus, 
  Assignment,
  RateConditionEventType,
  Wave
} from '@/lib/types';
import { DailyTimesheetSchema } from '@/lib/validations/timesheet-schemas';
import { writeAuditLog } from './audit-service';
import { format, subDays, parseISO, isWithinInterval } from 'date-fns';

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
    return ['DRAFT', 'REJECTED', 'CORRECTION_REQUIRED', 'SUBMITTED', 'OPS_REVIEWED'].includes(status);
  }

  /**
   * Business Control: Defines states that are considered finalized for financial use.
   */
  isFinalized(status: DailyTimesheetStatus): boolean {
    return ['CLIENT_APPROVED', 'LOCKED'].includes(status);
  }

  /**
   * Fetches the active roster for a specific wave on a specific date.
   * Only includes assignments that are active and cover the target date.
   */
  async getWaveRosterForDate(waveId: string, date: string): Promise<Assignment[]> {
    const mobRef = collection(this.db, 'mobilizations');
    const q = query(
      mobRef, 
      where('waveId', '==', waveId),
      where('deploymentStatus', 'in', ['ACTIVE', 'READY_TO_MOB', 'MOBILIZING', 'READY'])
    );
    
    const snap = await getDocs(q);
    const targetDate = parseISO(date);

    return snap.docs
      .map(d => ({ ...d.data(), id: d.id } as Assignment))
      .filter(asgn => {
        const start = parseISO(asgn.startDate);
        const end = parseISO(asgn.endDate);
        return isWithinInterval(targetDate, { start, end });
      });
  }

  /**
   * Generates initial draft objects for an entire Wave roster.
   * Useful for pre-populating the Wave Board UI.
   */
  async generateDraftsForWave(waveId: string, date: string, user: User): Promise<Partial<DailyTimesheet>[]> {
    const roster = await this.getWaveRosterForDate(waveId, date);
    const waveRef = doc(this.db, 'waves', waveId);
    const waveSnap = await getDoc(waveRef);
    const wave = waveSnap.data() as Wave;

    return roster.map(asgn => ({
      date,
      workerId: asgn.workerId,
      assignmentId: asgn.id,
      waveId: asgn.waveId,
      purchaseOrderId: asgn.poId,
      customerId: asgn.customerId,
      projectName: asgn.projectName,
      positionId: asgn.positionId,
      eventType: 'work_day' as RateConditionEventType,
      normalHours: 8,
      status: 'DRAFT',
      workMode: 'OFFSHORE', // Default for Opec
      shiftType: 'DAY'
    }));
  }

  /**
   * Clones activity logs from the previous day for a specific wave.
   * High-productivity feature for static offshore deployments.
   */
  async copyFromPreviousDay(waveId: string, targetDate: string, user: User) {
    const prevDate = format(subDays(parseISO(targetDate), 1), 'yyyy-MM-dd');
    
    const q = query(
      this.getCollection(),
      where('waveId', '==', waveId),
      where('date', '==', prevDate)
    );
    
    const snap = await getDocs(q);
    if (snap.empty) return { copied: 0, msg: 'No source data found for yesterday' };

    const payloads = snap.docs.map(d => {
      const data = d.data() as DailyTimesheet;
      return {
        ...data,
        id: undefined, // Let service generate new ID
        date: targetDate,
        status: 'DRAFT' as DailyTimesheetStatus,
        createdAt: undefined,
        updatedAt: undefined
      };
    });

    return this.bulkUpsertTimesheets(payloads, user);
  }

  /**
   * Validates a batch of timesheets before saving.
   * Checks for assignment validity and potential compliance blockers.
   */
  async validateWaveBatch(timesheets: Partial<DailyTimesheet>[]) {
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const ts of timesheets) {
      if (!ts.date || !ts.workerId || !ts.assignmentId) {
        errors.push('Missing required identity fields in batch item');
        continue;
      }

      // Check assignment validity period
      const asgnRef = doc(this.db, 'mobilizations', ts.assignmentId);
      const asgnSnap = await getDoc(asgnRef);
      if (asgnSnap.exists()) {
        const asgn = asgnSnap.data() as Assignment;
        const targetDate = parseISO(ts.date);
        const start = parseISO(asgn.startDate);
        const end = parseISO(asgn.endDate);
        
        if (!isWithinInterval(targetDate, { start, end })) {
          warnings.push(`Assignment for ${ts.workerNameSnapshot} does not cover ${ts.date}`);
        }
      }
    }

    return { 
      isValid: errors.length === 0, 
      errors, 
      warnings 
    };
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
    
    const existing = await getDoc(docRef);
    if (existing.exists()) {
      throw new Error(`Timesheet record already exists for this identity and date: ${data.date}.`);
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
   * Performs a bulk upsert of timesheets for a Wave.
   * Skips approved/locked records to maintain integrity.
   */
  async bulkUpsertTimesheets(timesheets: Partial<DailyTimesheet>[], user: User) {
    const batch = writeBatch(this.db);
    const results = { created: 0, updated: 0, skipped: 0 };

    for (const ts of timesheets) {
      if (!ts.workerId || !ts.assignmentId || !ts.date) continue;

      const id = this.getTimesheetId(ts.workerId, ts.assignmentId, ts.date);
      const docRef = doc(this.getCollection(), id);
      const existing = await getDoc(docRef);

      if (existing.exists()) {
        const current = existing.data() as DailyTimesheet;
        // Integrity Guard: Skip if already finalized (Client Approved or Locked)
        if (this.isFinalized(current.status)) {
          results.skipped++;
          continue;
        }
        
        batch.update(docRef, {
          ...ts,
          updatedBy: user.displayName,
          updatedAt: Date.now()
        });
        results.updated++;
      } else {
        const validated = DailyTimesheetSchema.parse({
          ...ts,
          id,
          status: 'DRAFT',
          createdBy: user.displayName,
          updatedBy: user.displayName,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        batch.set(docRef, validated);
        results.created++;
      }
    }

    await batch.commit();
    
    await writeAuditLog(this.db, user, {
      actionType: 'BULK_UPSERT',
      entityType: 'DailyTimesheet',
      entityId: 'batch',
      afterSummary: `Bulk processed timesheets: Created ${results.created}, Updated ${results.updated}, Skipped ${results.skipped}`,
      sourceModule: 'operations'
    });

    return results;
  }

  async submitTimesheet(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');
    const current = snap.data() as DailyTimesheet;

    if (!['DRAFT', 'REJECTED', 'CORRECTION_REQUIRED'].includes(current.status)) {
      throw new Error('Invalid Transition: Only drafts or rejected items can be submitted');
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

  async approveTimesheetByClient(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');
    if (snap.data()?.status !== 'OPS_REVIEWED') throw new Error('Client Approval Failed');

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
      afterSummary: 'Client final approval granted'
    });
  }

  async rejectTimesheet(id: string, reason: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');
    
    if (this.isFinalized(snap.data()?.status)) {
      throw new Error('Integrity Violation: Cannot reject a locked record.');
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

  async requestCorrection(id: string, reason: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');

    if (this.isFinalized(snap.data()?.status)) {
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

  async lockTimesheet(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');
    if (snap.data()?.status !== 'CLIENT_APPROVED') throw new Error('Only approved items can be locked');

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
      afterSummary: 'Locked record for final financial processing'
    });
  }
}
