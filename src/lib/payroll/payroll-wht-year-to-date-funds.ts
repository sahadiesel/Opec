/**
 * เงินสะสมกองทุนประกันสังคม / กองทุนสงเคราะห์ลูกจ้าง สะสมทั้งปีปฏิทิน — ใช้แสดงในหนังสือรับรอง 50 ทวิ
 * (สำหรับให้พนักงาน/ลูกจ้างนำไปยื่นแบบ ภ.ง.ด. 90/91)
 */

import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { OfficePayrollLine, PayrollBatch, PayrollBatchLine } from '@/lib/types';

const PAID_OR_LOCKED_BATCH_STATUSES = new Set(['PAID', 'LOCKED']);
const PAID_OR_LOCKED_RUN_STATUSES = new Set(['PAID', 'LOCKED']);

export type YearToDateStatutoryFunds = {
  sso: number;
  assistanceFund: number;
};

function round2(n: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function yearFromYmd(ymd: string | undefined | null): number | null {
  if (!ymd) return null;
  const y = Number(String(ymd).slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? y : null;
}

/**
 * รวม ปสง. (ฝั่งลูกจ้าง) + กองทุนสงเคราะห์ลูกจ้างของ "ลูกจ้าง" คนหนึ่ง ตั้งแต่ต้นปีปฏิทินถึงงวดปัจจุบัน
 * — อ่านจากทุก `payroll_batches` ที่สถานะ PAID/LOCKED และงวดปีตรงกับ `calendarYearCe`
 *   (เทียบปีจาก periodEndDate ก่อน แล้วจึง periodStartDate)
 * — `currentBatchId` (ถ้าระบุ) จะถูกนับรวมเสมอแม้ batch นั้นยังไม่ PAID/LOCKED (เช่นกำลังดูตัวอย่างก่อนอนุมัติ)
 */
export async function loadWorkerYearToDateStatutoryFunds(
  db: Firestore,
  workerId: string,
  calendarYearCe: number,
  currentBatchId?: string,
): Promise<YearToDateStatutoryFunds> {
  const out: YearToDateStatutoryFunds = { sso: 0, assistanceFund: 0 };
  if (!db || !workerId.trim() || !Number.isFinite(calendarYearCe)) return out;

  const batchSnap = await getDocs(collection(db, 'payroll_batches'));
  const eligibleBatchIds: string[] = [];
  for (const bd of batchSnap.docs) {
    const batch = bd.data() as PayrollBatch;
    const eligible = PAID_OR_LOCKED_BATCH_STATUSES.has(batch.status) || bd.id === currentBatchId;
    if (eligible) eligibleBatchIds.push(bd.id);
  }

  await Promise.all(
    eligibleBatchIds.map(async (batchId) => {
      const lineSnap = await getDocs(
        query(collection(db, 'payroll_batches', batchId, 'lines'), where('workerId', '==', workerId)),
      );
      lineSnap.forEach((ld) => {
        const line = ld.data() as PayrollBatchLine;
        const year = yearFromYmd(line.periodEndDate) ?? yearFromYmd(line.periodStartDate);
        if (year !== calendarYearCe) return;
        const dedMap = line.deductionsBreakdown || line.d8Snapshot?.deductions || {};
        out.sso += Number(dedMap.social_security) || 0;
        out.assistanceFund += Number(dedMap.employee_assistance_fund) || 0;
      });
    }),
  );

  out.sso = round2(out.sso);
  out.assistanceFund = round2(out.assistanceFund);
  return out;
}

/**
 * รวม ปสง. + กองทุนสงเคราะห์ลูกจ้างของ "พนักงานออฟฟิศ / ผู้บริหาร" คนหนึ่ง ตั้งแต่ต้นปีปฏิทินถึงงวดปัจจุบัน
 * — อ่านจากทุก run ใน `runsCollection` (ค่าเริ่มต้น `office_payroll_runs`) ที่สถานะ PAID/LOCKED
 */
export async function loadOfficeYearToDateStatutoryFunds(
  db: Firestore,
  staffId: string,
  calendarYearCe: number,
  currentRunId?: string,
  runsCollection: string = 'office_payroll_runs',
): Promise<YearToDateStatutoryFunds> {
  const out: YearToDateStatutoryFunds = { sso: 0, assistanceFund: 0 };
  if (!db || !staffId.trim() || !Number.isFinite(calendarYearCe)) return out;

  const runSnap = await getDocs(collection(db, runsCollection));
  const eligibleRunIds: string[] = [];
  for (const rd of runSnap.docs) {
    const run = rd.data() as { status?: string; payrollPeriodEnd?: string; payrollMonth?: string };
    const statusOk = PAID_OR_LOCKED_RUN_STATUSES.has(String(run.status)) || rd.id === currentRunId;
    if (!statusOk) continue;
    const year =
      yearFromYmd(run.payrollPeriodEnd) ?? yearFromYmd(run.payrollMonth ? `${run.payrollMonth}-01` : undefined);
    if (year !== calendarYearCe) continue;
    eligibleRunIds.push(rd.id);
  }

  await Promise.all(
    eligibleRunIds.map(async (runId) => {
      const lineSnap = await getDocs(
        query(collection(db, runsCollection, runId, 'lines'), where('staffId', '==', staffId)),
      );
      lineSnap.forEach((ld) => {
        const line = ld.data() as OfficePayrollLine;
        out.sso += Number(line.socialSecurity) || 0;
        out.assistanceFund += Number(line.d8Snapshot?.deductions?.employee_assistance_fund) || 0;
      });
    }),
  );

  out.sso = round2(out.sso);
  out.assistanceFund = round2(out.assistanceFund);
  return out;
}
