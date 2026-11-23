import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';
import type { BankAccountType } from '@/lib/types';

/** บัญชีกระแสรายวัน — ใช้วงเงิน OD ได้ */
export function isCurrentBankAccount(type: BankAccountType | string | undefined | null): boolean {
  return String(type ?? '').trim().toUpperCase() === 'CURRENT';
}

export function hasConfiguredOdLimit(odLimit: number | undefined | null): boolean {
  return odLimit != null && Number.isFinite(Number(odLimit)) && Number(odLimit) > 0;
}

/**
 * เงินสดที่นับได้ของบัญชีนี้
 * บัญชีกระแสรายวันที่มีวงเงิน OD นับเฉพาะส่วนเกิน (ยอดปัจจุบัน − วงเงิน) และไม่ติดลบ
 * บัญชีอื่นใช้ยอดปัจจุบันทั้งจำนวน
 */
export function cashOnHandExcludingOd(account: {
  accountType?: BankAccountType | string | null;
  currentBalance?: number | null;
  odLimit?: number | null;
}): number {
  const balance = roundMoney2(Number(account.currentBalance) || 0);
  if (!isCurrentBankAccount(account.accountType) || !hasConfiguredOdLimit(account.odLimit)) {
    return balance;
  }
  return Math.max(0, computeOdBalanceDelta(balance, account.odLimit));
}

/** ยอดเงินปัจจุบัน − วงเงิน OD */
export function computeOdBalanceDelta(
  currentBalance: number | undefined | null,
  odLimit: number | undefined | null,
): number {
  return roundMoney2(Number(currentBalance ?? 0) - Number(odLimit ?? 0));
}

export function formatSignedBahtDelta(n: number): string {
  const abs = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n < 0) return `-฿ ${abs}`;
  return `฿ ${abs}`;
}
