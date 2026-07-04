
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
  limit,
  type DocumentData,
} from 'firebase/firestore';
import { 
  DailyTimesheet, 
  User, 
  DailyTimesheetStatus, 
  Assignment,
  RateConditionEventType,
  Wave,
  LaborCostContractTerm
} from '@/lib/types';
import { DailyTimesheetSchema } from '@/lib/validations/timesheet-schemas';
import { assertPayrollPermission } from '@/lib/permissions';
import { writeAuditLog } from './audit-service';
import { format, subDays, parseISO, isWithinInterval } from 'date-fns';

/** Firestore rejects `undefined` in set/update payloads — strip those keys. */
function omitUndefinedFields<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    if (out[key as keyof T] === undefined) {
      delete out[key as keyof T];
    }
  }
  return out;
}

/**
 * Resolves the best-matching LaborCostContractTerm for a given PO + date.
 * Returns the term ID or undefined if none found.
 */
export async function resolveLaborCostTermId(
  db: Firestore,
  purchaseOrderId: string,
  timesheetDate: string,
): Promise<string | undefined> {
  if (!purchaseOrderId) return undefined;
  const q = query(
    collection(db, 'labor_cost_contract_terms'),
    where('relatedPurchaseOrderId', '==', purchaseOrderId),
    where('status', '==', 'ACTIVE'),
  );
  const snap = await getDocs(q);
  if (snap.empty) return undefined;

  const terms = snap.docs.map(d => ({ ...d.data(), id: d.id } as LaborCostContractTerm));

  // Prefer the term whose effective range covers the timesheet date
  const dateMatch = terms.find(
    t => t.effectiveDate <= timesheetDate && t.endDate >= timesheetDate,
  );
  if (dateMatch) return dateMatch.id;

  // Fallback: return the first active term
  return terms[0].id;
}

/**
 * Batch-resolves laborCostContractTermId for multiple PO IDs.
 * Avoids redundant queries when creating timesheets for the same PO.
 */
export async function resolveLaborCostTermIds(
  db: Firestore,
  purchaseOrderIds: string[],
  timesheetDate: string,
): Promise<Map<string, string>> {
  const unique = [...new Set(purchaseOrderIds.filter(Boolean))];
  const result = new Map<string, string>();
  for (const poId of unique) {
    const termId = await resolveLaborCostTermId(db, poId, timesheetDate);
    if (termId) result.set(poId, termId);
  }
  return result;
}

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

    // Pre-resolve laborCostContractTermIds for all new timesheets that don't have one
    const needsResolve = timesheets.filter(ts => !ts.laborCostContractTermId && ts.purchaseOrderId && ts.date);
    const poIds = needsResolve.map(ts => ts.purchaseOrderId!);
    const sampleDate = timesheets[0]?.date || format(new Date(), 'yyyy-MM-dd');
    const costTermMap = poIds.length > 0
      ? await resolveLaborCostTermIds(this.db, poIds, sampleDate)
      : new Map<string, string>();

    for (const ts of timesheets) {
      if (!ts.workerId || !ts.assignmentId || !ts.date) continue;

      // Auto-fill laborCostContractTermId when resolvable; never assign undefined (Firestore error)
      if (!ts.laborCostContractTermId && ts.purchaseOrderId) {
        const resolved = costTermMap.get(ts.purchaseOrderId);
        if (resolved) {
          ts.laborCostContractTermId = resolved;
        }
      }
      const tsRecord = ts as Record<string, unknown>;
      if (tsRecord.laborCostContractTermId === undefined) {
        delete tsRecord.laborCostContractTermId;
      }

      const id = this.getTimesheetId(ts.workerId, ts.assignmentId, ts.date);
      const docRef = doc(this.getCollection(), id);
      const existingSnap = await getDoc(docRef);

      if (existingSnap.exists()) {
        const current = existingSnap.data() as DailyTimesheet;
        if (this.isFinalized(current.status)) {
          results.skipped++;
          continue;
        }
        
        batch.update(
          docRef,
          omitUndefinedFields({
            ...ts,
            updatedAt: Date.now(),
          } as Record<string, unknown>) as DocumentData,
        );
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
        batch.set(docRef, omitUndefinedFields({ ...validated } as Record<string, unknown>) as DocumentData);
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
      reasonText: reason,
      timesheetId: id,
      sourceModule: 'operations',
      afterSummary: 'Finalized timesheet flagged for correction. Financial readiness reset.'
    });
  }

  /**
   * แก้ชม. OT/ปกติบนใบงานที่ปิดงวดแล้ว (VERIFIED_PAPER / CLIENT_APPROVED ฯลฯ) — อนุญาต OT = 0
   * ไม่แตะใบงานที่ LOCKED ในชุดจ่าย payroll
   */
  async correctClosedPeriodTimesheetHours(
    id: string,
    user: User,
    input: { ot15Hours: number; normalHours?: number; reason: string },
  ): Promise<void> {
    assertPayrollPermission(user, 'timesheet', 'edit');
    const docRef = doc(this.getCollection(), id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('ไม่พบใบงาน');
    const current = snap.data() as DailyTimesheet;
    if (current.status === 'LOCKED') {
      throw new Error('ใบงานถูกล็อกในชุดจ่าย payroll — ลบชุดจ่าย (System Admin) ก่อนแก้ OT');
    }
    const reason = String(input.reason || '').trim();
    if (!reason) throw new Error('กรุณาระบุเหตุผลการแก้ไข');

    const ot15 = Math.min(24, Math.max(0, Number(input.ot15Hours) || 0));
    const patch: Record<string, unknown> = {
      ot15Hours: ot15,
      ot20Hours: 0,
      ot30Hours: 0,
      readyForPayroll: false,
      readyForBilling: false,
      updatedAt: Date.now(),
    };
    if (input.normalHours !== undefined) {
      patch.normalHours = Math.min(24, Math.max(0, Number(input.normalHours) || 0));
    }
    const priorRemark = String(current.remark || '').trim();
    patch.remark = priorRemark ? `${priorRemark} · แก้ OT: ${reason}` : `แก้ OT: ${reason}`;

    await updateDoc(docRef, patch);
    await writeAuditLog(this.db, user, {
      actionType: 'UPDATE',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      reasonText: reason,
      sourceModule: 'operations',
      afterSummary: `Closed-period correction: OT15=${ot15}h (was ${current.ot15Hours ?? 0}h)`,
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
      readyForBilling: true,
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
      afterSummary: 'Operations reviewed and internally approved for payroll and billing'
    });
  }

  async markAsClientApproved(id: string, user: User) {
    const docRef = doc(this.getCollection(), id);
    await updateDoc(docRef, {
      status: 'CLIENT_APPROVED',
      readyForPayroll: true,
      readyForBilling: true,
      approvalSource: 'PORTAL',
      clientApprovedBy: user.displayName,
      clientApprovedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await writeAuditLog(this.db, user, {
      actionType: 'CLIENT_APPROVE',
      entityType: 'DailyTimesheet',
      entityId: id,
      timesheetId: id,
      sourceModule: 'client_portal',
      afterSummary: 'Client approved timesheet via portal for payroll and billing'
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

    // Pre-resolve cost terms for rows missing laborCostContractTermId
    const poIds = snap.docs
      .map(d => (d.data() as DailyTimesheet).purchaseOrderId)
      .filter(Boolean);
    const costTermMap = poIds.length > 0
      ? await resolveLaborCostTermIds(this.db, poIds, targetDate)
      : new Map<string, string>();

    const batch = writeBatch(this.db);
    let created = 0;
    for (const d of snap.docs) {
      const ts = d.data() as DailyTimesheet;
      const id = this.getTimesheetId(ts.workerId, ts.assignmentId, targetDate);
      const docRef = doc(this.getCollection(), id);
      const existing = await getDoc(docRef);
      if (existing.exists()) continue;
      const { id: _omit, ...rest } = ts;

      const costTermId =
        rest.laborCostContractTermId || costTermMap.get(rest.purchaseOrderId);

      try {
        const payload = DailyTimesheetSchema.parse({
          ...rest,
          id,
          date: targetDate,
          ...(costTermId ? { laborCostContractTermId: costTermId } : {}),
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
