import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';

/**
 * คำนวณยอดคงเหลือจากยอดยกมา + รายการ cashbook (+ Petty ถ้าเป็นบัญชี Petty)
 * ใช้แก้กรณี currentBalance ในฐานข้อมูลค้าง (เช่น รายการสร้างก่อนมี increment)
 */
export async function computeBankBalanceFromMovements(
  db: Firestore,
  bankAccountId: string,
): Promise<{ computed: number; openingBalance: number }> {
  const bankRef = doc(db, 'bank_accounts', bankAccountId);
  const bankSnap = await getDoc(bankRef);
  if (!bankSnap.exists()) throw new Error('ไม่พบบัญชี');
  const openingBalance = roundMoney2(Number(bankSnap.data()?.openingBalance ?? 0));
  const accountType = String(bankSnap.data()?.accountType ?? '');

  const cbQ = query(collection(db, 'cashbook_entries'), where('bankAccountId', '==', bankAccountId));
  const cbSnap = await getDocs(cbQ);
  let net = 0;
  for (const d of cbSnap.docs) {
    const e = d.data();
    const amt = roundMoney2(Number(e.amount ?? 0));
    net += e.direction === 'IN' ? amt : -amt;
  }

  if (accountType === 'PETTY_CASH') {
    const ptQ = query(collection(db, 'petty_cash_entries'), where('bankAccountId', '==', bankAccountId));
    const ptSnap = await getDocs(ptQ);
    for (const d of ptSnap.docs) {
      const e = d.data();
      const amt = roundMoney2(Number(e.amount ?? 0));
      net += e.direction === 'IN' ? amt : -amt;
    }
  }

  return { computed: roundMoney2(openingBalance + net), openingBalance };
}

/** ถ้ายอดในฐานข้อมูลคลาดจากยอดคำนวณจากรายการ จะอัปเดต currentBalance */
export async function syncBankCurrentBalanceIfDrift(
  db: Firestore,
  bankAccountId: string,
): Promise<{ computed: number; stored: number; corrected: boolean }> {
  const bankRef = doc(db, 'bank_accounts', bankAccountId);
  const bankSnap = await getDoc(bankRef);
  if (!bankSnap.exists()) throw new Error('ไม่พบบัญชี');
  const rawStored = Number(bankSnap.data()?.currentBalance ?? 0);
  const stored = roundMoney2(rawStored);
  const { computed } = await computeBankBalanceFromMovements(db, bankAccountId);
  /** ยอด drift จริง หรือแค่เศษ IEEE ในฐานข้อมูล (เช่น 192276.04999999993 แทน 192276.05) */
  const needsSemanticFix = Math.abs(computed - stored) >= 0.01;
  const needsFloatNormalize =
    !needsSemanticFix &&
    (Math.abs(rawStored - computed) > 1e-6 || Math.abs(rawStored - stored) > 1e-6);
  if (needsSemanticFix || needsFloatNormalize) {
    await updateDoc(bankRef, {
      currentBalance: computed,
      updatedAt: Date.now(),
    });
    return { computed, stored: rawStored, corrected: true };
  }
  return { computed, stored: rawStored, corrected: false };
}
