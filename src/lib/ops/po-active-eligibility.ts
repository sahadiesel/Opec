import type { MainContract, PurchaseOrder } from '@/lib/types';

/** ค่า status ที่ใช้ใน Firestore query (case-sensitive — รองรับข้อมูลเก่า/ใหม่) */
export const PO_ACTIVE_PURCHASE_ORDER_STATUS_IN = ['active', 'ACTIVE'] as const;

export const PO_ACTIVE_MAIN_CONTRACT_STATUS_IN = ['active', 'ACTIVE', 'revised', 'REVISED'] as const;

export function normalizePoWorkflowStatusToken(status: unknown): string {
  return String(status ?? '')
    .trim()
    .toLowerCase();
}

/** Customer PO ที่ยังใช้งานใน flow PO Active / มอบหมาย / ลงเวลา */
export function isPurchaseOrderActiveForPoActiveWorkflow(status: unknown): boolean {
  return normalizePoWorkflowStatusToken(status) === 'active';
}

/**
 * สัญญาหลักที่ยังผูก PO Active ได้ — รวม `revised` (สัญญาเก่าที่ยังมี PO active ค้าง)
 * ไม่รวม expired / closed
 */
export function isMainContractEligibleForPoActiveWorkflow(status: unknown): boolean {
  const s = normalizePoWorkflowStatusToken(status);
  return s === 'active' || s === 'revised';
}

export function isPoLineActiveForQuota(status: unknown): boolean {
  return normalizePoWorkflowStatusToken(status) === 'active';
}

export function filterPurchaseOrdersForPoActiveWorkflow(list: PurchaseOrder[] | null | undefined): PurchaseOrder[] {
  return (list ?? []).filter((po) => isPurchaseOrderActiveForPoActiveWorkflow(po.status));
}

export function buildEligibleMainContractIdSet(contracts: MainContract[] | null | undefined): Set<string> {
  return new Set(
    (contracts ?? [])
      .filter((c) => isMainContractEligibleForPoActiveWorkflow(c.status))
      .map((c) => c.id)
      .filter(Boolean),
  );
}

/** Customer PO สายสัญญา — มี contractId (ไม่รวม quotation / PO ลอย / WOT) */
export function isContractBasedPurchaseOrder(
  po: Pick<PurchaseOrder, 'poType' | 'contractId' | 'status' | 'quotationId'>,
): boolean {
  if ((po.poType || 'contract') === 'quotation') return false;
  if ((po.quotationId || '').trim()) return false;
  return (
    !!(po.contractId || '').trim() &&
    isPurchaseOrderActiveForPoActiveWorkflow(po.status)
  );
}

export function filterContractBasedPurchaseOrders(
  list: PurchaseOrder[] | null | undefined,
): PurchaseOrder[] {
  return (list ?? []).filter(isContractBasedPurchaseOrder);
}

/** PO สายสัญญาที่ผูกสัญญาหลัก eligible — เกณฑ์เดียวกับคิวโควต้า / Timesheet hub */
export function filterPoActiveWorkflowPurchaseOrders(
  list: PurchaseOrder[] | null | undefined,
  eligibleContractIds: Set<string>,
): PurchaseOrder[] {
  return (list ?? []).filter((po) =>
    isContractPurchaseOrderEligibleForPoActiveBundle(po, eligibleContractIds),
  );
}

/** PO สายสัญญา — ผูกสัญญาหลักที่ยัง eligible สำหรับมอบหมาย / PO Active */
export function isContractPurchaseOrderEligibleForPoActiveBundle(
  po: PurchaseOrder,
  eligibleContractIds: Set<string>,
): boolean {
  if (!isContractBasedPurchaseOrder(po)) return false;
  return eligibleContractIds.has((po.contractId || '').trim());
}
