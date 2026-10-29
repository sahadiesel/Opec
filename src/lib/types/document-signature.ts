/** ลายเซ็นผู้มีอำนาจลงนามที่ผูกกับเอกสาร (snapshot ตอนแนบหรืออนุมัติ) */
export type AuthorizedSignatoryStatus = 'ATTACHED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export type AuthorizedSignatoryMark = {
  status: AuthorizedSignatoryStatus;
  signerUid?: string;
  signerName?: string;
  /** URL รูปที่ครอบในกรอบ 35×15 มม. แล้ว — ใส่บนเอกสารเมื่อผู้ใช้เลือกพิมพ์ลายเซ็น */
  signatureImageUrl?: string;
  requestId?: string;
  updatedAt?: number;
};

export type DocumentSignatureSourceCollection = 'tax_invoices' | 'commercial_invoices' | 'quotations';

export type DocumentSignatureRequest = {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  sourceCollection: DocumentSignatureSourceCollection;
  sourceId: string;
  documentNo: string;
  documentLabel: string;
  requestedByUid: string;
  requestedByName: string;
  requestedAt: number;
  decidedByUid?: string;
  decidedByName?: string;
  decidedAt?: number;
};

/** สิ่งที่ผู้ใช้เลือกใส่ตอนพิมพ์ — ไม่บันทึกลงเอกสาร */
export type DocumentPrintMarks = {
  /** ช่องซ้าย — ลายเซ็นของผู้จัดเตรียมเอกสาร จากโปรไฟล์ผู้ใช้ */
  preparerSignatureImageUrl?: string;
  /** ช่องกลาง — ลายเซ็นผู้มีอำนาจที่แนบหรืออนุมัติแล้ว */
  authorizedSignatureImageUrl?: string;
  /** วางทับช่องผู้มีอำนาจลงนาม */
  stampImageUrl?: string;
};

export function authorizedSignatureReady(mark: AuthorizedSignatoryMark | null | undefined): boolean {
  if (!mark) return false;
  if (mark.status !== 'ATTACHED' && mark.status !== 'APPROVED') return false;
  return Boolean((mark.signatureImageUrl || '').trim());
}
