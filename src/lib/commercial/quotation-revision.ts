/**
 * เลขที่ใบเสนอราคาแบบ revision — เช่น QT-2026-11-00001 / QT-2026-11-00001R1
 */

import {
  collection,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import type { Quotation } from '@/lib/types/quotation';

/** ท้ายเลขแบบติดกัน เช่น `R1` / `R12` (รูปแบบที่ระบบใช้อยู่) */
const REVISION_SUFFIX_RE = /R(\d+)$/i;

export function parseQuotationBaseNo(quotationNo: string): string {
  return String(quotationNo || '')
    .replace(REVISION_SUFFIX_RE, '')
    .trim();
}

export function formatQuotationRevisionNo(baseNo: string, revisionNo: number): string {
  const base = parseQuotationBaseNo(baseNo);
  if (!base) return '';
  if (revisionNo <= 0) return base;
  return `${base}R${revisionNo}`;
}

export function quotationRevisionNoOf(
  q: Pick<Quotation, 'revisionNo' | 'quotationNo'>,
): number {
  if (typeof q.revisionNo === 'number' && Number.isFinite(q.revisionNo) && q.revisionNo >= 0) {
    return Math.floor(q.revisionNo);
  }
  const m = String(q.quotationNo || '').match(REVISION_SUFFIX_RE);
  if (m) return Math.max(0, parseInt(m[1], 10) || 0);
  return 0;
}

/** ฉบับที่ถูกแทนที่แล้ว — เปิดดูได้อย่างเดียว */
export function isQuotationSuperseded(
  q: Pick<Quotation, 'status' | 'supersededByQuotationId'>,
): boolean {
  if ((q.status || '') === 'revised') return true;
  return !!(q.supersededByQuotationId || '').trim();
}

/** แก้ไขได้เฉพาะฉบับล่าสุดที่ยังไม่ถูกแทนที่ / ปิดสถานะ */
export function isQuotationLatestEditable(
  q: Pick<Quotation, 'status' | 'supersededByQuotationId'>,
): boolean {
  if (q.status === 'revised' || q.status === 'cancelled' || q.status === 'expired' || q.status === 'rejected') {
    return false;
  }
  return !isQuotationSuperseded(q);
}

export function quotationFamilyBaseNo(
  q: Pick<Quotation, 'baseQuotationNo' | 'quotationNo'>,
): string {
  const fromField = (q.baseQuotationNo || '').trim();
  if (fromField) return parseQuotationBaseNo(fromField);
  return parseQuotationBaseNo(q.quotationNo);
}

async function quotationNoExists(db: Firestore, quotationNo: string): Promise<boolean> {
  const snap = await getDocs(
    query(collection(db, 'quotations'), where('quotationNo', '==', quotationNo), limit(1)),
  );
  return !snap.empty;
}

/**
 * หาเลข revision ถัดไปของชุดเดียวกัน — ดูทั้ง family แล้วกันเลขซ้ำ
 */
export async function resolveNextQuotationRevisionNo(
  db: Firestore,
  baseNoInput: string,
  opts?: { atLeastAbove?: number },
): Promise<{ nextRevisionNo: number; revisedNo: string; baseNo: string }> {
  const baseNo = parseQuotationBaseNo(baseNoInput);
  if (!baseNo) {
    throw new Error('เลขที่เอกสารฐานว่างเปล่า');
  }

  let maxRev = Math.max(0, Math.floor(opts?.atLeastAbove ?? 0));

  const byBase = await getDocs(
    query(collection(db, 'quotations'), where('baseQuotationNo', '==', baseNo)),
  );
  byBase.forEach((d) => {
    maxRev = Math.max(maxRev, quotationRevisionNoOf(d.data() as Quotation));
  });

  const byExact = await getDocs(
    query(collection(db, 'quotations'), where('quotationNo', '==', baseNo), limit(10)),
  );
  byExact.forEach((d) => {
    maxRev = Math.max(maxRev, quotationRevisionNoOf(d.data() as Quotation));
  });

  let nextRevisionNo = maxRev + 1;
  let revisedNo = formatQuotationRevisionNo(baseNo, nextRevisionNo);

  // กันเคสมีเลขซ้ำค้างในระบบ (R1 สองใบ) — ขยับต่อจนกว่าจะว่าง
  while (await quotationNoExists(db, revisedNo)) {
    nextRevisionNo += 1;
    revisedNo = formatQuotationRevisionNo(baseNo, nextRevisionNo);
    if (nextRevisionNo > maxRev + 50) {
      throw new Error('ไม่สามารถหาเลข revision ที่ไม่ซ้ำได้');
    }
  }

  return { nextRevisionNo, revisedNo, baseNo };
}
