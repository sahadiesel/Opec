/**
 * ประเภทหัก ณ ที่จ่ายคู่ค้า (PR → PO → ใบวางบิล / ใบ ม.50 ทวิ)
 * — อัตราแนะนำตามประเภท; บัญชียังแก้ได้ตอนทำจ่าย
 */

import type { VendorBillWhtPresetCategory } from '@/lib/types';

/** ประเภทที่ตั้งบน PR/PO (ไม่รวมค่าขนส่ง — บัญชีเลือกเพิ่มตอนทำจ่ายได้) */
export type SupplierWithholdingCategory = Extract<
  VendorBillWhtPresetCategory,
  'CONTRACT' | 'SERVICE' | 'RENT'
>;

export const SUPPLIER_WHT_CATEGORY_OPTIONS: {
  id: SupplierWithholdingCategory;
  title: string;
  detail: string;
  defaultRate: number;
}[] = [
  { id: 'CONTRACT', title: 'จ้างเหมา', detail: 'หัก ณ ที่จ่าย 3% (ค่าจ้างเหมา)', defaultRate: 3 },
  { id: 'SERVICE', title: 'งานบริการ', detail: 'หัก ณ ที่จ่าย 3% (ค่าบริการ)', defaultRate: 3 },
  { id: 'RENT', title: 'ค่าเช่า', detail: 'หัก ณ ที่จ่าย 5%', defaultRate: 5 },
];

/** เมนูบัญชีบนใบวางบิล — รวมค่าขนส่ง */
export const VENDOR_BILL_WHT_PRESET_OPTIONS: {
  id: VendorBillWhtPresetCategory;
  title: string;
  detail: string;
}[] = [
  { id: 'TRANSPORT_FREIGHT', title: 'ค่าขนส่ง', detail: 'หัก ณ ที่จ่าย 1%' },
  ...SUPPLIER_WHT_CATEGORY_OPTIONS.map(({ id, title, detail }) => ({ id, title, detail })),
];

export function supplierWhtCategoryDefaultRate(category: VendorBillWhtPresetCategory): number {
  switch (category) {
    case 'TRANSPORT_FREIGHT':
      return 1;
    case 'CONTRACT':
    case 'SERVICE':
      return 3;
    case 'RENT':
      return 5;
    default:
      return 0;
  }
}

export function supplierWhtCategoryLabel(category: VendorBillWhtPresetCategory | undefined | null): string {
  if (!category) return '—';
  const hit = VENDOR_BILL_WHT_PRESET_OPTIONS.find((o) => o.id === category);
  return hit?.title ?? category;
}

export function isSupplierWithholdingCategory(
  v: string | undefined | null,
): v is SupplierWithholdingCategory {
  return v === 'CONTRACT' || v === 'SERVICE' || v === 'RENT';
}

/** เดาประเภทจากอัตรา (legacy ที่ไม่มี category) */
export function inferSupplierWhtCategoryFromRate(rate: number): SupplierWithholdingCategory {
  if (Math.abs(rate - 5) < 0.02) return 'RENT';
  return 'SERVICE';
}
