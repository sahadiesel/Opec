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
 * Prioritizes Wave-based bulk operations for high-volume manpower management.
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
   */
  async generateDraftsForWave(waveId: string, date: string): Promise<Partial<DailyTimesheet>[]> {
    const roster = await this.getWaveRosterForDate(waveId, date);
    
    return roster.map(asgn => ({
      date,
      workerId: asgn.workerId,
      assignmentId: asgn.id,
      waveId: asgn.waveId,
      purchaseOrderId: asgn.poId,
      contractId: asgn.contractId,
      customerId: asgn.customerId,
      projectName: asgn.projectName,
      positionId: asgn.positionId,
      eventType: 'work_day' as RateConditionEventType,
      normalHours: 8,
      status: 'DRAFT',
      workMode: asgn.workMode, // Derived from assignment context
      shiftType: 'DAY'
    }));
  }

  /**
   * Clones activity logs from the previous day for a specific wave.
   */
  async copyFromPreviousDay(waveId: string, targetDate: string, user: User) {
    const prevDate = format(subDays(parseISO(targetDate), 1), 'yyyy-MM-dd');
    
    const q = query(
      this.getCollection(),
      where('waveId', '==', waveId),
      where('date', '==', prevDate)
    );
    
    const snap = await getDocs(q);
    if (snap.empty) return { created: 0, updated: 0, skipped: 0, msg: 'No source data found for yesterday' };

    const payloads = snap.docs.map(d => {
      const data = d.data() as DailyTimesheet;
      return {
        ...data,
        id: undefined, 
        date: targetDate,
        status: 'DRAFT' as DailyTimesheetStatus,
        createdAt: undefined,
        updatedAt: undefined
      };
    });

    return this.bulkUpsertTimesheets(payloads, user);
  }

  /**
   * Performs a bulk upsert of timesheets for a Wave.
   * Safeguard: Strictly skips any record already approved by client or locked.
   */
  async bulkUpsertTimesheets(timesheets: Partial<DailyTimesheet>[], user: User) {
    const batch = writeBatch(this.db);
    const results = { created: 0, updated: 0, skipped: 0 };

    for (const ts of timesheets) {
      if (!ts.workerId || !ts.assignmentId || !ts.date) continue;

      const id = this.getTimesheetId(ts.workerId, ts.assignmentId, ts.date);
      const docRef = doc(this.getCollection(), id);
      const existingSnap = await getDoc(docRef);

      if (existingSnap.exists()) {
        const current = existingSnap.data() as DailyTimesheet;
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
      afterSummary: `Wave bulk upsert: ${results.created} new, ${results.updated} updated, ${results.skipped} skipped.`,
      sourceModule: 'operations'
    });

    return results;
  }

  async submitTimesheet(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');
    
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
      afterSummary: 'Submitted daily log for review'
    });
  }

  async approveTimesheetByClient(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');

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
      afterSummary: 'Client approved daily log'
    });
  }

  async requestCorrection(id: string, reason: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Timesheet not found');

    // Rule: Cannot silently correct locked financial data
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
      afterSummary: `Correction requested: ${reason}`
    });
  }
}