/**
 * เลขที่ใบแจ้งหนี้เชิงพาณิชย์แบบ revision — เช่น DFI-2026-08-0006 / DFI-2026-08-0006 R1
 */

import type { CommercialInvoice } from '@/lib/types';

const REVISION_SUFFIX_RE = /\s+R(\d+)$/i;

/** ตัดท้าย ` R1` / ` R12` ออกเหลือเลขฐาน */
export function parseCommercialInvoiceBaseNo(invoiceNo: string): string {
  return String(invoiceNo || '')
    .replace(REVISION_SUFFIX_RE, '')
    .trim();
}

export function formatCommercialInvoiceRevisionNo(baseNo: string, revisionNo: number): string {
  const base = parseCommercialInvoiceBaseNo(baseNo);
  if (!base) return '';
  if (revisionNo <= 0) return base;
  return `${base} R${revisionNo}`;
}

export function commercialInvoiceRevisionNoOf(inv: Pick<CommercialInvoice, 'revisionNo' | 'invoiceNo'>): number {
  if (typeof inv.revisionNo === 'number' && Number.isFinite(inv.revisionNo) && inv.revisionNo >= 0) {
    return Math.floor(inv.revisionNo);
  }
  const m = String(inv.invoiceNo || '').match(REVISION_SUFFIX_RE);
  if (m) return Math.max(0, parseInt(m[1], 10) || 0);
  return 0;
}

/** รุ่นที่ถูกแทนที่แล้ว — เปิดดูได้อย่างเดียว */
export function isCommercialInvoiceSuperseded(
  inv: Pick<CommercialInvoice, 'supersededByInvoiceId'>,
): boolean {
  return !!(inv.supersededByInvoiceId || '').trim();
}

/** แก้ไข/ส่งลูกค้า/แนบไฟล์ได้เฉพาะรุ่นล่าสุดที่ยังไม่ VOID */
export function isCommercialInvoiceLatestEditable(
  inv: Pick<CommercialInvoice, 'status' | 'supersededByInvoiceId'>,
): boolean {
  if (inv.status === 'VOID') return false;
  return !isCommercialInvoiceSuperseded(inv);
}
