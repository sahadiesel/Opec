import { collection, getDocs, type Firestore } from 'firebase/firestore';
import { embeddedDefaultPayrollPolicies } from './embedded-policies';
import type { PayrollPolicyRecord } from '@/lib/types';

/** โหลดจาก `payroll_policies` — ถ้าว่างใช้ embedded default (ไม่ย้อนกระทบ batch เก่าเพราะ snapshot เก็บ policy id แล้ว) */
export async function loadPayrollPoliciesFromFirestore(db: Firestore): Promise<PayrollPolicyRecord[]> {
  const snap = await getDocs(collection(db, 'payroll_policies'));
  if (snap.empty) return embeddedDefaultPayrollPolicies();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PayrollPolicyRecord, 'id'>) }));
}
