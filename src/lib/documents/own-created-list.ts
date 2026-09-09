import type { AccountsReceivable, User } from '@/lib/types';
import { getEffectiveAccessLevel, isSalesOfficer, isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import {
  documentSharedWithCurrentUser,
  type DocumentShareFields,
} from '@/lib/documents/document-share';

/** ฟิลด์ผู้สร้างที่ใช้ในเอกสารรายการ (ชื่อฟิลด์ไม่เหมือนกันทุกชนิด) */
export type DocumentCreatorFields = DocumentShareFields & {
  createdByUid?: string | null;
  createdById?: string | null;
  requestedByUid?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  requestedByName?: string | null;
};

/**
 * officer (เช่น sales_officer, accounting_officer) เห็นเฉพาะเอกสารที่ตัวเองสร้าง หรือที่ถูกแชร์มาให้
 * manager / admin / viewer เห็นทั้งหมด
 */
export function shouldRestrictListToOwnCreatedDocuments(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user) || isSimpleAdmin(user)) return false;
  if (isSalesOfficer(user)) return true;
  return getEffectiveAccessLevel(user) === 'officer';
}

/** จำกัดรายการฝั่งขาย — ใช้กับลูกหนี้ / ใบสั่งซื้อคลัง ที่บัญชียังต้องเห็นทั้งหมด */
export function shouldRestrictSalesOfficerOwnDocuments(user: User | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user) || isSimpleAdmin(user)) return false;
  return isSalesOfficer(user);
}

export function documentCreatedByCurrentUser(
  user: User | null,
  doc: DocumentCreatorFields,
): boolean {
  if (!user?.id) return false;
  if (doc.createdByUid && doc.createdByUid === user.id) return true;
  if (doc.createdById && doc.createdById === user.id) return true;
  if (doc.requestedByUid && doc.requestedByUid === user.id) return true;
  /** ใบเสนอราคาเก่าเก็บชื่อใน `createdBy` ไม่มี uid */
  const name = (user.displayName || '').trim();
  if (name && !doc.createdByUid && !doc.requestedByUid) {
    if (typeof doc.createdBy === 'string' && doc.createdBy.trim() === name) return true;
    if ((doc.createdByName || '').trim() === name) return true;
  }
  return false;
}

export function officerCanAccessDocument(
  user: User | null,
  doc: DocumentCreatorFields | null | undefined,
): boolean {
  if (!shouldRestrictListToOwnCreatedDocuments(user)) return true;
  if (!doc) return false;
  return documentCreatedByCurrentUser(user, doc) || documentSharedWithCurrentUser(user, doc);
}

export function salesOfficerCanAccessDocument(
  user: User | null,
  doc: DocumentCreatorFields | null | undefined,
): boolean {
  if (!shouldRestrictSalesOfficerOwnDocuments(user)) return true;
  if (!doc) return false;
  return documentCreatedByCurrentUser(user, doc) || documentSharedWithCurrentUser(user, doc);
}

export function documentCreatorDisplayName(doc: DocumentCreatorFields): string {
  const n =
    (doc.createdByName || '').trim() ||
    (doc.requestedByName || '').trim() ||
    (typeof doc.createdBy === 'string' ? doc.createdBy.trim() : '');
  return n || '—';
}

export function filterToOwnCreatedDocuments<T extends DocumentCreatorFields>(
  user: User | null,
  rows: T[] | null | undefined,
): T[] {
  const list = rows ?? [];
  if (!shouldRestrictListToOwnCreatedDocuments(user)) return list;
  return list.filter(
    (row) => documentCreatedByCurrentUser(user, row) || documentSharedWithCurrentUser(user, row),
  );
}

export function filterPurchasesForSalesOfficerBySourcePr<
  T extends { purchaseRequestId?: string | null } & DocumentCreatorFields,
>(
  user: User | null,
  purchases: T[] | null | undefined,
  prById: Map<string, DocumentCreatorFields>,
): T[] {
  const list = purchases ?? [];
  if (!shouldRestrictSalesOfficerOwnDocuments(user)) return list;
  return list.filter((p) => {
    const prId = String(p.purchaseRequestId || '').trim();
    if (prId) {
      const pr = prById.get(prId);
      if (pr) return salesOfficerCanAccessDocument(user, pr);
    }
    const poId = String((p as { id?: string }).id || '').trim();
    if (poId) {
      for (const pr of prById.values()) {
        if (String((pr as { linkedPurchaseId?: string }).linkedPurchaseId || '').trim() === poId) {
          return salesOfficerCanAccessDocument(user, pr);
        }
      }
    }
    if (prId) return false;
    return salesOfficerCanAccessDocument(user, p);
  });
}

export function filterArForSalesOfficerByTaxInvoice<
  T extends Pick<AccountsReceivable, 'referenceType' | 'referenceId' | 'referenceNo'>,
>(
  user: User | null,
  arItems: T[] | null | undefined,
  taxInvoices: readonly DocumentCreatorFields[] | null | undefined,
): T[] {
  const list = arItems ?? [];
  if (!shouldRestrictSalesOfficerOwnDocuments(user)) return list;
  const invoices = taxInvoices ?? [];
  const byId = new Map<string, DocumentCreatorFields>();
  const byNo = new Map<string, DocumentCreatorFields>();
  for (const inv of invoices) {
    const id = String((inv as { id?: string }).id || '').trim();
    if (id) byId.set(id, inv);
    const no = String((inv as { taxInvoiceNo?: string }).taxInvoiceNo || '').trim();
    if (no) byNo.set(no, inv);
  }
  return list.filter((item) => {
    if (item.referenceType !== 'TAX_INVOICE') return false;
    const tax =
      byId.get(String(item.referenceId || '').trim()) ||
      (item.referenceNo ? byNo.get(String(item.referenceNo).trim()) : undefined);
    return tax ? salesOfficerCanAccessDocument(user, tax) : false;
  });
}
