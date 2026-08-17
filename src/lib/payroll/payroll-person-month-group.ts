/**
 * รวมรายการ ปกส. / ภงด. ต่อคนต่อเดือนงวดเงินเดือน
 * — แสดงหลายชุดจ่ายเป็นแถวคู่กัน แต่ยอดนำส่งใช้สลิปล่าสุด (และเพดาน ปกส. รายเดือน)
 */

import {
  DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT,
  statutorySocialSecurityMonthlyCeilingBaht,
} from '@/lib/hr/pit-thailand';
import { roundSocialSecurityBahtUp } from '@/lib/payroll/d8/deductions-from-policy';

export function monthlyEmployeeSsoCeilingBaht(ymOrAsOf: string): number {
  const asOf = /^\d{4}-\d{2}$/.test(ymOrAsOf.trim())
    ? `${ymOrAsOf.trim()}-01`
    : String(ymOrAsOf || '').slice(0, 10) || '2026-01-01';
  const ceiling = statutorySocialSecurityMonthlyCeilingBaht(asOf);
  const rate = DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT / 100;
  return roundSocialSecurityBahtUp(ceiling * rate);
}

export type PersonMonthSortable = {
  rowKey: string;
  personId: string;
  periodYm: string;
  paymentYmd: string;
  recencyMs: number;
  /** ยอดบนบรรทัด (ปกส. ลูกจ้าง หรือ ภงด. ตามบริบท) */
  lineAmount: number;
};

/**
 * ยอด ปกส. ฝั่งลูกจ้างสำหรับนำส่งทั้งเดือน — ยึดสลิปที่มี ปกส. ล่าสุด แล้วจำกัดเพดานเดือน
 * (ไม่บวกยอดทุกชุดจ่ายในเดือน ซึ่งจะเกินเพดาน เช่น 875+300)
 */
export function resolveSharedMonthlyEmployeeSso(
  members: readonly PersonMonthSortable[],
  periodYm: string,
): number {
  if (!members.length) return 0;
  const sorted = sortPersonMonthMembers(members);
  const latestWithSso = sorted.find((m) => m.lineAmount > 0.005) ?? sorted[0];
  const raw = roundSocialSecurityBahtUp(Number(latestWithSso?.lineAmount) || 0);
  const cap = monthlyEmployeeSsoCeilingBaht(periodYm || latestWithSso?.paymentYmd || '');
  return Math.min(raw, cap);
}

/** รวมยอด ภงด. ที่หักในเดือน (ทุกชุดจ่าย) — ใช้เป็นยอดนำส่งรวมหนึ่งช่อง */
export function resolveSharedMonthlyWithholdSum(members: readonly PersonMonthSortable[]): number {
  return members.reduce((s, m) => s + Math.max(0, Number(m.lineAmount) || 0), 0);
}

export function personMonthGroupKey(kind: string, personId: string, periodYm: string): string {
  return `${kind}::${personId}::${periodYm}`;
}

export function sortPersonMonthMembers<T extends PersonMonthSortable>(members: readonly T[]): T[] {
  return [...members].sort((a, b) => {
    const payCmp = String(b.paymentYmd || '').localeCompare(String(a.paymentYmd || ''));
    if (payCmp !== 0) return payCmp;
    return (b.recencyMs || 0) - (a.recencyMs || 0);
  });
}

export type AnnotatedPersonMonthRow<T> = T & {
  groupKey: string;
  isGroupLeader: boolean;
  groupSize: number;
  /** ยอดนำส่งที่แสดงบน leader (follower = 0) */
  sharedAmount: number;
  memberRowKeys: string[];
};

/**
 * จัดกลุ่มแถวตามคน+เดือน เรียงให้สมาชิกกลุ่มอยู่ติดกัน — leader = สลิปใหม่สุด
 */
export function annotatePersonMonthGroups<T extends PersonMonthSortable>(
  rows: readonly T[],
  kind: string,
  resolveSharedAmount: (members: readonly T[], periodYm: string) => number,
): AnnotatedPersonMonthRow<T>[] {
  const byGroup = new Map<string, T[]>();
  for (const r of rows) {
    const ym = (r.periodYm || '').trim().slice(0, 7) || 'unknown';
    const pid = (r.personId || '').trim() || r.rowKey;
    const key = personMonthGroupKey(kind, pid, ym);
    const arr = byGroup.get(key) ?? [];
    arr.push(r);
    byGroup.set(key, arr);
  }

  const out: AnnotatedPersonMonthRow<T>[] = [];
  const groupKeys = Array.from(byGroup.keys()).sort((a, b) => a.localeCompare(b, 'th'));

  for (const gKey of groupKeys) {
    const members = sortPersonMonthMembers(byGroup.get(gKey) ?? []);
    const periodYm = (members[0]?.periodYm || '').trim().slice(0, 7);
    const sharedAmount = resolveSharedAmount(members, periodYm);
    const memberRowKeys = members.map((m) => m.rowKey);
    const leaderKey = members[0]?.rowKey;

    for (const m of members) {
      const isLeader = m.rowKey === leaderKey;
      out.push({
        ...m,
        groupKey: gKey,
        isGroupLeader: isLeader,
        groupSize: members.length,
        sharedAmount: isLeader ? sharedAmount : 0,
        memberRowKeys,
      });
    }
  }

  return out;
}
