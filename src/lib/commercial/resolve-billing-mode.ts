import { doc, getDoc, type Firestore } from 'firebase/firestore';
import type { ContractBillingMode, MainContract, PurchaseOrder } from '@/lib/types';

/** PO override → สัญญาหลัก (จาก map) → default MONTHLY — ใช้กรอง UI โดยไม่รอ async */
export function resolveBillingModeFromMaps(
  po: Pick<PurchaseOrder, 'contractId' | 'billingMode'> | undefined | null,
  contractsById?: Map<string, Pick<MainContract, 'billingMode'>>,
): ContractBillingMode {
  if (!po) return 'MONTHLY';
  if (po.billingMode === 'TRIP' || po.billingMode === 'MONTHLY') return po.billingMode;
  const contractId = String(po.contractId || '').trim();
  if (contractId && contractsById) {
    const mc = contractsById.get(contractId);
    if (mc?.billingMode === 'TRIP' || mc?.billingMode === 'MONTHLY') return mc.billingMode;
  }
  return 'MONTHLY';
}

/** PO override → สัญญาหลัก → default MONTHLY (Guangzhou / legacy) */
export async function resolveBillingMode(
  db: Firestore,
  po: Pick<PurchaseOrder, 'id' | 'contractId' | 'billingMode'>,
): Promise<ContractBillingMode> {
  if (po.billingMode === 'TRIP' || po.billingMode === 'MONTHLY') return po.billingMode;
  const contractId = String(po.contractId || '').trim();
  if (contractId) {
    const snap = await getDoc(doc(db, 'main_contracts', contractId));
    if (snap.exists()) {
      const mc = snap.data() as MainContract;
      if (mc.billingMode === 'TRIP' || mc.billingMode === 'MONTHLY') return mc.billingMode;
    }
  }
  return 'MONTHLY';
}

export function billingModeLabel(mode: ContractBillingMode | undefined): string {
  if (mode === 'TRIP') return 'รอบเดินทาง (M1→D1)';
  return 'รายเดือน (PO+เดือน)';
}

export type PoBillingModeRow = {
  poId: string;
  poCode: string;
  mode: ContractBillingMode;
};

/** ข้อความเตือนก่อนไป Monthly Timesheet / วางบิล — ให้สอดคล้องโหมดสัญญา */
export function buildBillingModeProceedCopy(rows: readonly PoBillingModeRow[]): {
  title: string;
  paragraphs: string[];
  invoiceHref: string;
  invoiceLabel: string;
} {
  if (rows.length === 0) {
    return {
      title: 'ตรวจโหมดวางบิลก่อนดำเนินการ',
      paragraphs: [
        'ยืนยันว่าสรุปเวลาและออก invoice ตรงกับสัญญา/PO',
        'Monthly = ปิดงวด PO+เดือน · Trip = วางบิลตามรอบ M1→D1',
      ],
      invoiceHref: '/accounting/dashboard',
      invoiceLabel: 'ไปศูนย์บัญชี',
    };
  }

  const unique = [...new Set(rows.map((r) => r.mode))];
  const allTrip = unique.length === 1 && unique[0] === 'TRIP';
  const allMonthly = unique.length === 1 && unique[0] === 'MONTHLY';

  if (allTrip) {
    return {
      title: 'PO นี้วางบิลลูกค้าแบบ Trip (M1→D1)',
      paragraphs: [
        'ลงเวลา M1 / D1 / SB ให้ครบตามรอบเดินทาง — ชม. standby ตามที่ลงในแต่ละวัน',
        'Monthly Timesheet ใช้สรุปเวลาและ payroll รายเดือนตามเดิม',
        'หลังปิดงวดแล้ว ออกใบแจ้งหนี้ลูกค้าที่เมนู «ทำใบแจ้งหนี้แบบ Trip» (ไม่ใช่แบบ Monthly)',
      ],
      invoiceHref: '/accounting/trip-billing',
      invoiceLabel: 'ทำใบแจ้งหนี้แบบ Trip',
    };
  }

  if (allMonthly) {
    return {
      title: 'PO นี้วางบิลลูกค้าแบบรายเดือน (PO+เดือน)',
      paragraphs: [
        'สรุปและปิดงวดที่ Monthly Timesheet ตาม PO+เดือน',
        'หลังอนุมัติแล้ว ออกใบแจ้งหนี้ที่เมนู «ทำใบแจ้งหนี้แบบ Monthly»',
        'ไม่ใช้ Trip billing — ไม่ต้องรอครบ D1 ทุกคนในกลุ่ม M1',
      ],
      invoiceHref: '/draft-invoices',
      invoiceLabel: 'ทำใบแจ้งหนี้แบบ Monthly',
    };
  }

  const detail = rows.map((r) => `${r.poCode}: ${billingModeLabel(r.mode)}`).join(' · ');
  return {
    title: 'ชุด PO นี้มีหลายโหมดวางบิล',
    paragraphs: [
      `ตรวจแต่ละ PO ก่อนวางบิล — ${detail}`,
      'Monthly Timesheet ใช้ร่วมกันได้สำหรับสรุปเวลา/payroll',
      'ออก invoice ตามโหมดของแต่ละ PO: Trip → ทำใบแจ้งหนี้แบบ Trip · Monthly → ทำใบแจ้งหนี้แบบ Monthly',
    ],
    invoiceHref: '/accounting/dashboard',
    invoiceLabel: 'ไปศูนย์บัญชี',
  };
}
