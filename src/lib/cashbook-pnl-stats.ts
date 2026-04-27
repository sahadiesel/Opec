import type { BankAccount, BankAccountType, CashbookEntry } from '@/lib/types';

const DEPOSIT_TYPES: ReadonlySet<BankAccountType> = new Set(['SAVINGS', 'CURRENT', 'CASH']);

function isDeposit(t: BankAccountType | undefined): boolean {
  return t != null && DEPOSIT_TYPES.has(t);
}

function isPetty(t: BankAccountType | undefined): boolean {
  return t === 'PETTY_CASH';
}

/**
 * สรุป รายรับ–รายจ่าย ตามงบการเงิน/งานบัญชี — แยกจาก "การเคลื่อนไหว" รวม ๆ
 * - ไม่นับ โอนระหว่างบัญชีฝาก ธ-ธ เป็น ร/ร
 * - โอนเข้า Petty: ฝั่ง ธ-ธ จ่ายออก นับเป็น รจ.; ฝั่ง Petty รับเข้า ไม่นับเป็น ร/ร
 * - โอนกลับจาก Petty เข้าธนาคาร: ฝั่ง ธ-รับ เข้า นับเป็น ร/ร; ฝั่ง Petty จ่าย ไม่นับเป็น รจ.
 * - ร/ร: รับจากลูกค้า, รวม โอนเข้า ธ-ฝ จาก Petty
 * - รจ.: จ่ายเจ้าหนี้, เงินเดือน, ภาษี, ฯลฯ และ โอนออกจาก ธ-ฝ ไป Petty
 */
export function cashbookPnlFromEntries(
  entries: readonly CashbookEntry[] | null | undefined,
  accounts: readonly BankAccount[] | null | undefined,
): { pnlIn: number; pnlOut: number; net: number } {
  if (!entries?.length) {
    return { pnlIn: 0, pnlOut: 0, net: 0 };
  }
  const byId = new Map(accounts?.map((a) => [a.id, a]) ?? []);
  const getType = (id: string): BankAccountType | undefined => byId.get(id)?.accountType;

  const byRef = new Map<string, CashbookEntry[]>();
  for (const e of entries) {
    if (e.entryType !== 'TRANSFER' || !e.referenceId?.trim()) continue;
    const r = e.referenceId.trim();
    if (!byRef.has(r)) byRef.set(r, []);
    byRef.get(r)!.push(e);
  }

  const used = new Set<string>();
  let pnlIn = 0;
  let pnlOut = 0;

  for (const list of byRef.values()) {
    if (list.length !== 2) continue;
    const [a, b] = list;
    if (a.direction === b.direction) continue;
    const outE = a.direction === 'OUT' ? a : b;
    const inE = a.direction === 'IN' ? a : b;
    const fromT = getType(outE.bankAccountId);
    const toT = getType(inE.bankAccountId);

    if (isDeposit(fromT) && isPetty(toT)) {
      pnlOut += Number(outE.amount) || 0;
      used.add(a.id);
      used.add(b.id);
      continue;
    }
    if (isPetty(fromT) && isDeposit(toT)) {
      pnlIn += Number(inE.amount) || 0;
      used.add(a.id);
      used.add(b.id);
    }
  }

  for (const e of entries) {
    if (used.has(e.id)) continue;
    if (e.entryType === 'TRANSFER' || e.entryType === 'PETTY_CASH') {
      continue;
    }
    const amt = Number(e.amount) || 0;
    if (e.direction === 'IN' && e.entryType === 'CUSTOMER_RECEIPT') {
      pnlIn += amt;
    } else if (e.direction === 'OUT' && (e.entryType === 'SUPPLIER_PAYMENT' || e.entryType === 'PAYROLL' || e.entryType === 'TAX' || e.entryType === 'OTHER')) {
      pnlOut += amt;
    }
  }

  return { pnlIn, pnlOut, net: pnlIn - pnlOut };
}
