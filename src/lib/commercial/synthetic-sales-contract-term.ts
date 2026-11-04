import { coerceToGregorianYmd } from '@/lib/date-thai';
import type { MainContract, PurchaseOrder, SalesContractTerm } from '@/lib/types';

/**
 * เมื่อไม่มีเอกสารใน `sales_contract_terms` — ใช้ขอบเขตจากสัญญาหลัก + PO เป็นแหล่งเดียวกับที่ตั้งราคา/ตัวคูณ
 * (in-memory เท่านั้น — ไม่เขียนลง Firestore)
 */
export function syntheticSalesContractTermFromMainContract(
  mainContract: MainContract,
  po: PurchaseOrder,
): SalesContractTerm {
  const effectiveDate = coerceToGregorianYmd(mainContract.startDate) || String(mainContract.startDate || '').slice(0, 10);
  const endDate = coerceToGregorianYmd(mainContract.endDate) || String(mainContract.endDate || '').slice(0, 10);

  return {
    id: mainContract.id,
    customerId: po.customerId,
    mainContractId: mainContract.id,
    purchaseOrderId: po.id,
    title: mainContract.title?.trim() || `สัญญา ${mainContract.contractNumber}`,
    contractNo: mainContract.contractNumber,
    status: 'ACTIVE',
    effectiveDate,
    endDate,
    currency: mainContract.currency || 'THB',
    billingCycle: 'CONTRACT',
    paymentTermsDays: 0,
    vatPercent: mainContract.vatPercent != null ? Number(mainContract.vatPercent) : 7,
    withholdingTaxPercent: 0,
    notes: 'ขอบเขตการขายจากสัญญาหลัก (main_contracts) — การคำนวณวางบิลอ้างอิงสัญญาเท่านั้น',
    createdBy: 'system',
    updatedBy: 'system',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
