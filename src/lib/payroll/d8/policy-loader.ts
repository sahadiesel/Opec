import { collection, getDocs, type Firestore } from 'firebase/firestore';
import { embeddedDefaultPayrollPolicies } from './embedded-policies';
import type { PayrollPolicyRecord } from '@/lib/types';

/** โหลดจาก `payroll_policies` — ถ้าว่างใช้ embedded default; ถ้ามีบางส่วนให้ผสม embedded ที่ยังไม่มีใน DB (เช่น tax สำหรับ worker) */
export async function loadPayrollPoliciesFromFirestore(db: Firestore): Promise<PayrollPolicyRecord[]> {
  const snap = await getDocs(collection(db, 'payroll_policies'));
  if (snap.empty) return embeddedDefaultPayrollPolicies();
  const fromDb = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PayrollPolicyRecord, 'id'>) }));
  const embedded = embeddedDefaultPayrollPolicies();
  const ids = new Set(fromDb.map((p) => p.id));
  const merged = [...fromDb];
  for (const e of embedded) {
    if (!ids.has(e.id)) merged.push(e);
  }
  return merged;
}
