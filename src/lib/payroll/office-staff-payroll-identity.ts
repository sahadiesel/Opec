import type { Firestore } from 'firebase/firestore';
import { doc, getDoc } from 'firebase/firestore';
import type { OfficePayrollLine, OfficeStaff } from '@/lib/types';

/** เลขบัตรประชาชนไทยมาตรฐาน 13 หลัก (รองรับการพิมพ์มีขีด/ช่องว่าง) */
export function normalizeThaiNationalIdDigits(raw: string | undefined | null): string {
  return (raw || '').replace(/\D/g, '');
}

/**
 * ข้อมูลตัวตนขั้นต่ำสำหรับงวดเงินเดือนออฟฟิศ + หัก ณ ที่จ่าย (ภงด.1)
 * — เลขบัตรประชาชน 13 หลักใช้เป็นฐานเลขผู้เสียภาษีในฟอร์ม (หรือเลข 13 หลักในฟิลด์ taxId เมื่อไม่กรอกในช่องบัตรประชาชน)
 */
export function validateOfficeStaffIdentityForPayroll(staff: OfficeStaff): string[] {
  const reasons: string[] = [];
  const nid = normalizeThaiNationalIdDigits(staff.nationalId);
  const tid = normalizeThaiNationalIdDigits(staff.taxId);
  const hasPersonalTaxId = nid.length === 13 || tid.length === 13;
  if (!hasPersonalTaxId) {
    reasons.push(
      'ต้องมีเลขบัตรประชาชน 13 หลักในทะเบียน (หรือเลขผู้เสียภาษีบุคคลธรรมดา 13 หลักในฟิลด์เลขภาษี)',
    );
  }
  const addr = (staff.address || '').trim();
  if (addr.length < 5) {
    reasons.push('ต้องระบุที่อยู่ติดต่อในระบบให้ครบ เพื่อใช้ในเอกสารหัก ณ ที่จ่ายและประกอบการจ่าย');
  }
  return reasons;
}

export function assertOfficeStaffListPayrollIdentityComplete(staffList: OfficeStaff[]): void {
  const lines: string[] = [];
  for (const s of staffList) {
    const r = validateOfficeStaffIdentityForPayroll(s);
    if (r.length) lines.push(`${s.fullName} (${s.staffCode}): ${r.join(' · ')}`);
  }
  if (lines.length === 0) return;
  throw new Error(
    `ไม่สามารถดำเนินการได้ — ข้อมูลทะเบียนพนักงานออฟฟิศไม่ครบสำหรับงวดเงินเดือน/หัก ณ ที่จ่าย:\n${lines.join('\n')}`,
  );
}

/** ตรวจจากทะเบียนล่าสุดใน `office_staff` ก่อนบัญชีบันทึกจ่าย (กรณีแก้ทะเบียนหลังคำนวณงวด) */
export async function assertOfficePayrollLinesStaffIdentityComplete(
  firestore: Firestore,
  lines: Pick<OfficePayrollLine, 'staffId'>[],
): Promise<void> {
  const ids = [...new Set(lines.map((l) => l.staffId).filter(Boolean))];
  const staffList: OfficeStaff[] = [];
  for (const sid of ids) {
    const snap = await getDoc(doc(firestore, 'office_staff', sid));
    if (!snap.exists()) {
      throw new Error(`ไม่พบทะเบียนพนักงานออฟฟิศ (office_staff) สำหรับรหัส ${sid} — แก้ข้อมูลก่อนบันทึกจ่าย`);
    }
    const row = snap.data() as OfficeStaff;
    staffList.push({ ...row, id: snap.id });
  }
  assertOfficeStaffListPayrollIdentityComplete(staffList);
}
