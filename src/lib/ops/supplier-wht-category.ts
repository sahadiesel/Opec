/**
 * ประเภทหัก ณ ที่จ่าย — เพทเทิร์นเดียวกันทั้งฝั่งใบกำกับภาษีขาย และฝั่งคู่ค้า (PR → PO → ใบวางบิล / ม.50 ทวิ)
 * อัตราตามประเภทงานบริการมาตรฐาน
 */

import type { VendorBillWhtPresetCategory } from '@/lib/types';

/** ประเภทที่เลือกได้บน UI (ไม่รวม CONTRACT ซึ่งเป็นค่าเก่า) */
export type SupplierWithholdingCategory = Exclude<VendorBillWhtPresetCategory, 'CONTRACT'>;

export type WhtIncomeCategoryOption = {
  id: SupplierWithholdingCategory;
  title: string;
  detail: string;
  defaultRate: number;
};

/**
 * รายการมาตรฐานเดียว — ใช้ทั้งสร้างใบกำกับภาษี / PR / PO / ใบวางบิล
 * ลำดับตามอัตราหัก ณ ที่จ่ายแยกตามประเภทงานบริการ
 */
export const WHT_INCOME_CATEGORY_OPTIONS: WhtIncomeCategoryOption[] = [
  {
    id: 'SERVICE',
    title: 'ค่าบริการทั่วไป / ค่าจ้างทำของ',
    detail: 'หัก ณ ที่จ่าย 3% — เช่น ซ่อมแซม ออกแบบ ก่อสร้าง จัดหาแรงงาน',
    defaultRate: 3,
  },
  {
    id: 'TRANSPORT_FREIGHT',
    title: 'ค่าขนส่ง',
    detail: 'หัก ณ ที่จ่าย 1% — ผู้รับต้องเป็นผู้ประกอบการขนส่งที่จดทะเบียน',
    defaultRate: 1,
  },
  {
    id: 'ADVERTISING',
    title: 'ค่าโฆษณา',
    detail: 'หัก ณ ที่จ่าย 2%',
    defaultRate: 2,
  },
  {
    id: 'RENT',
    title: 'ค่าเช่าทรัพย์สิน',
    detail: 'หัก ณ ที่จ่าย 5% — เช่น เช่ารถ เครื่องจักร พื้นที่/อาคาร',
    defaultRate: 5,
  },
  {
    id: 'COMMISSION',
    title: 'ค่านายหน้า / ค่าคอมมิชชั่น',
    detail: 'นิติบุคคล 3% · บุคคลธรรมดาคิดตามอัตราก้าวหน้า (แก้ % ได้ตอนทำจ่าย)',
    defaultRate: 3,
  },
];

/** alias — เมนู PR / PO */
export const SUPPLIER_WHT_CATEGORY_OPTIONS = WHT_INCOME_CATEGORY_OPTIONS;

/** alias — เมนูบัญชีบนใบวางบิล และหน้าสร้างใบกำกับภาษี */
export const VENDOR_BILL_WHT_PRESET_OPTIONS = WHT_INCOME_CATEGORY_OPTIONS.map(
  ({ id, title, detail }) => ({ id, title, detail }),
);

export function supplierWhtCategoryDefaultRate(category: VendorBillWhtPresetCategory): number {
  switch (category) {
    case 'TRANSPORT_FREIGHT':
      return 1;
    case 'ADVERTISING':
      return 2;
    case 'CONTRACT':
    case 'SERVICE':
    case 'COMMISSION':
      return 3;
    case 'RENT':
      return 5;
    default:
      return 0;
  }
}

export function supplierWhtCategoryLabel(category: VendorBillWhtPresetCategory | undefined | null): string {
  if (!category) return '—';
  if (category === 'CONTRACT') {
    return 'ค่าบริการทั่วไป / ค่าจ้างทำของ';
  }
  const hit = WHT_INCOME_CATEGORY_OPTIONS.find((o) => o.id === category);
  return hit?.title ?? category;
}

export function isSupplierWithholdingCategory(
  v: string | undefined | null,
): v is SupplierWithholdingCategory {
  return (
    v === 'SERVICE' ||
    v === 'TRANSPORT_FREIGHT' ||
    v === 'ADVERTISING' ||
    v === 'RENT' ||
    v === 'COMMISSION'
  );
}

export function isVendorWhtPresetCategory(
  v: string | undefined | null,
): v is VendorBillWhtPresetCategory {
  return isSupplierWithholdingCategory(v) || v === 'CONTRACT';
}

/** เดาประเภทจากอัตรา (legacy ที่ไม่มี category) — ค่าเริ่มบริการทั่วไป 3% */
export function inferSupplierWhtCategoryFromRate(rate: number): SupplierWithholdingCategory {
  if (Math.abs(rate - 1) < 0.02) return 'TRANSPORT_FREIGHT';
  if (Math.abs(rate - 2) < 0.02) return 'ADVERTISING';
  if (Math.abs(rate - 5) < 0.02) return 'RENT';
  return 'SERVICE';
}

/** เดาเมนูหัก ณ ที่จ่ายจากอัตราที่บันทึกไว้ */
export function inferVendorWhtPresetFromRate(rate: number): VendorBillWhtPresetCategory {
  return inferSupplierWhtCategoryFromRate(rate);
}

/** map ค่าเก่า CONTRACT → SERVICE สำหรับเลือกใน UI */
export function normalizeVendorWhtPresetCategory(
  category: VendorBillWhtPresetCategory | undefined | null,
): SupplierWithholdingCategory {
  if (!category || category === 'CONTRACT') return 'SERVICE';
  if (isSupplierWithholdingCategory(category)) return category;
  return 'SERVICE';
}
