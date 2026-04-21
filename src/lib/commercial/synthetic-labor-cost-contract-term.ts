import { format } from 'date-fns';
import type { LaborCostContractTerm, MainContract, PurchaseOrder } from '@/lib/types';

/**
 * เมื่อไม่มีเอกสารใน `labor_cost_contract_terms` สำหรับ PO — ใช้ขอบเขตต้นทุนจากสัญญาหลัก + PO
 * (in-memory เท่านั้น — ไม่เขียนลง Firestore)
 * สอดคล้องกับแนว resolveMainContractBillingTerm / synthetic sales term
 */
export function syntheticLaborCostContractTermFromMainContract(
  mainContract: MainContract,
  po: PurchaseOrder | Pick<PurchaseOrder, 'id' | 'customerId'>,
): LaborCostContractTerm {
  const effectiveDate = format(new Date(mainContract.startDate), 'yyyy-MM-dd');
  const endDate = format(new Date(mainContract.endDate), 'yyyy-MM-dd');

  return {
    id: `synth_labor_${mainContract.id}`,
    title:
      mainContract.title?.trim() ||
      `ต้นทุนจากสัญญา ${mainContract.contractNumber}`,
    relatedCustomerId: po.customerId,
    relatedPurchaseOrderId: po.id,
    relatedContractId: mainContract.id,
    scopeType: 'MASTER_CONTRACT',
    status: 'ACTIVE',
    effectiveDate,
    endDate,
    notes:
      'ขอบเขตต้นทุนจากสัญญาหลัก (main_contracts) — wave → PO → contract; ไม่ต้องมีแถว labor_cost_contract_terms แยก',
    createdBy: 'system',
    updatedBy: 'system',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
