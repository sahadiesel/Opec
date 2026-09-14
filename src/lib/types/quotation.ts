/** Domain types: quotation (from master types.ts split). */

export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'cancelled' | 'revised';

/** ลูกค้า portal เห็นได้หลัง OPEC กดส่งให้ลูกค้าเท่านั้น — ไม่รวม draft/revised */

export const QUOTATION_PORTAL_VISIBLE_STATUSES: QuotationStatus[] = [
  'sent',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
];

export interface Quotation {
  id: string;
  quotationNo: string;
  baseQuotationNo?: string;
  revisionNo?: number;
  revisedFromQuotationId?: string;
  supersededByQuotationId?: string;
  customerId: string;
  customerNameSnapshot?: string;
  issueDate: string;
  validUntilDate: string;
  currency: string;
  status: QuotationStatus;
  projectTitle: string;
  referenceNo?: string;
  contactPerson?: string;
  billingAddressSnapshot?: string;
  notes?: string;
  internalNotes?: string;
  subtotal: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  grandTotal: number;
  createdAt: number;
  createdBy: string;
  createdByUid?: string;
  updatedAt: number;
  updatedBy: string;
  /** แชร์ให้ officer ที่ระบุ — ดูได้แม้ไม่ได้เป็นผู้สร้าง */
  sharedWith?: { uid: string; displayName: string; roleKey?: string }[];
  sharedWithUids?: string[];
  /** ลูกค้า (portal) ตอบรับ/ปฏิเสธ — คู่กับ status accepted|rejected */
  portalDecisionAt?: number;
  portalDecisionByUid?: string;
  portalDecisionByName?: string;
  portalDecisionSource?: 'CLIENT_PORTAL';
  /** ลูกค้าแจ้งขอแก้ไข/ต่อรอง (portal) — คู่กับ customerRevisionRequestNote */
  customerRevisionRequestedAt?: number;
  customerRevisionRequestNote?: string;
  customerRevisionIssueId?: string;
}

export interface QuotationLine {
  id: string;
  quotationId: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  remarks?: string;
  displayOrder: number;
}

