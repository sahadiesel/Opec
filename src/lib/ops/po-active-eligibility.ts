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

/** PO สายสัญญา — อยู่ในสัญญาที่ eligible หรืออยู่ใน po_active_bundles ที่ซิงก์แล้ว */
export function isContractPurchaseOrderEligibleForPoActiveBundle(
  po: PurchaseOrder,
  eligibleContractIds: Set<string>,
  bundlePoIds: Set<string>,
): boolean {
  if ((po.poType || 'contract') !== 'contract') return false;
  if (!isPurchaseOrderActiveForPoActiveWorkflow(po.status)) return false;
  if (bundlePoIds.has(po.id)) return true;
  return Boolean(po.contractId && eligibleContractIds.has(po.contractId));
}
