
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
import { assertPayrollPermission } from '@/lib/permissions';
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
   * Finalized financial records are strictly read-only.
   */
  canEdit(status: DailyTimesheetStatus): boolean {
    const finalizedStatuses: DailyTimesheetStatus[] = ['CLIENT_APPROVED', 'VERIFIED_PAPER', 'LOCKED'];
    return !finalizedStatuses.includes(status);
  }

  /**
   * Business Control: Defines states that are considered finalized for financial use.
   */
  isFinalized(status: DailyTimesheetStatus): boolean {
    return ['CLIENT_APPROVED', 'VERIFIED_PAPER', 'LOCKED'].includes(status);
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
      where('deploymentStatus', 'in', ['ACTIVE', 'READY_TO_MOB', 'MOBILIZING'])
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
   * Performs a bulk upsert of timesheets for a Wave.
   * Safeguard: Strictly skips any record already finalized or locked.
   */
  async bulkUpsertTimesheets(timesheets: Partial<DailyTimesheet>[], user: User) {
    assertPayrollPermission(user, 'timesheet', 'edit');
    const batch = writeBatch(this.db);
    const results = { created: 0, updated: 0, skipped: 0 };

    for (const ts of timesheets) {
      if (!ts.workerId || !ts.assignmentId || !ts.date) continue;

      const id = this.getTimesheetId(ts.workerId, ts.assignmentId, ts.date);
      const docRef = doc(this.getCollection(), id);
      const existingSnap = await getDoc(docRef);

      if (existingSnap.exists()) {
        const current = existingSnap.data() as DailyTimesheet;
        // SILENT EDIT PREVENTION: Check if already finalized
        if (this.isFinalized(current.status)) {
          results.skipped++;
          continue;
        }
        
        batch.update(docRef, {
          ...ts,
          updatedAt: Date.now()
        });
        results.updated++;
      } else {
        const validated = DailyTimesheetSchema.parse({
          ...ts,
          id,
          status: ts.status || 'DRAFT',
          readyForPayroll: ts.readyForPayroll ?? false,
          readyForBilling: ts.readyForBilling ?? false,
          officeEnteredBy: user.displayName,
          officeEnteredAt: Date.now(),
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

  /**
   * Controlled Correction Flow:
   * Moves a finalized record back to CORRECTION_REQUIRED and resets readiness.
   * This prevents silent overwrites of billed/paid data.
   */
  async requestCorrection(id: string, user: User, reason: string) {
    assertPayrollPermission(user, 'timesheet', 'verify');
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    
    const current = snap.data() as DailyTimesheet;
    if (current.status === 'LOCKED') {
      throw new Error('Cannot request correction for record locked in Payroll Batch.');
    }

    await updateDoc(docRef, {
      status: 'CORRECTION_REQUIRED',
      readyForPayroll: false,
      readyForBilling: false,
      remark: `Correction Request: ${reason}`,
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'CORRECTION_REQ',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      reasonText: reason,
      sourceModule: 'operations',
      afterSummary: 'Finalized timesheet flagged for correction. Financial readiness reset.'
    });
  }

  async submitTimesheet(id: string, user: User) {
    assertPayrollPermission(user, 'timesheet', 'submit');
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'SUBMITTED',
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'SUBMIT',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      sourceModule: 'operations',
      afterSummary: 'Submitted daily log for internal review'
    });
  }

  async markAsReviewed(id: string, user: User) {
    assertPayrollPermission(user, 'timesheet', 'verify');
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'OPS_REVIEWED',
      readyForPayroll: true,
      managerApprovedBy: user.displayName,
      managerApprovedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'OPS_REVIEW',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      sourceModule: 'operations',
      afterSummary: 'Operations reviewed and internally approved for payroll'
    });
  }

  async markAsVerifiedPaper(id: string, user: User) {
    assertPayrollPermission(user, 'timesheet', 'verify');
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'VERIFIED_PAPER',
      readyForPayroll: true,
      readyForBilling: true,
      approvalSource: 'PAPER',
      sourceType: 'PAPER',
      evidenceConfirmedBy: user.displayName,
      evidenceConfirmedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'VERIFY_PAPER',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      sourceModule: 'operations',
      afterSummary: 'Verified client signature from paper evidence for payroll and billing'
    });
  }

  /**
   * Copy previous calendar day’s timesheets for the same wave into targetDate (draft only).
   */
  async copyFromPreviousDay(
    waveId: string,
    targetDate: string,
    user: User
  ): Promise<{ created: number; updated: number }> {
    assertPayrollPermission(user, 'timesheet', 'edit');
    const prev = format(subDays(parseISO(targetDate), 1), 'yyyy-MM-dd');
    const q = query(
      this.getCollection(),
      where('waveId', '==', waveId),
      where('date', '==', prev)
    );
    const snap = await getDocs(q);
    const batch = writeBatch(this.db);
    let created = 0;
    for (const d of snap.docs) {
      const ts = d.data() as DailyTimesheet;
      const id = this.getTimesheetId(ts.workerId, ts.assignmentId, targetDate);
      const docRef = doc(this.getCollection(), id);
      const existing = await getDoc(docRef);
      if (existing.exists()) continue;
      const { id: _omit, ...rest } = ts;
      try {
        const payload = DailyTimesheetSchema.parse({
          ...rest,
          id,
          date: targetDate,
          status: 'DRAFT',
          readyForPayroll: false,
          readyForBilling: false,
          officeEnteredBy: user.displayName,
          officeEnteredAt: Date.now(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        batch.set(docRef, payload);
        created++;
      } catch {
        /* skip rows that fail schema (legacy / partial docs) */
      }
    }
    await batch.commit();
    return { created, updated: 0 };
  }
}
