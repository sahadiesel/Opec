/**
 * แก้ใบเสร็จรับเงินเดิมที่ยอดถูกหัก ณ ที่จ่ายออกจากยอดรวม (รวม VAT)
 *
 * Auth: GOOGLE_APPLICATION_CREDENTIALS หรือ FIREBASE_SERVICE_ACCOUNT_PATH
 *
 * Usage:
 *   npx tsx scripts/fix-money-receipt-wht-amounts.ts --dry-run
 *   npx tsx scripts/fix-money-receipt-wht-amounts.ts --receipt-no=MR-2026-05-00004
 *   npx tsx scripts/fix-money-receipt-wht-amounts.ts --receipt-no=MR-2026-05-00004 --apply
 *   npx tsx scripts/fix-money-receipt-wht-amounts.ts --apply --include-cashbook
 */

import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  applyMoneyReceiptWhtFix,
  scanMoneyReceiptWhtFixes,
} from '../src/lib/migrations/fix-money-receipt-wht-amounts';
import { resolveFirebaseProjectId } from './resolve-firebase-project-id';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length) || undefined;
  return undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const dryRun = hasFlag('dry-run') || !hasFlag('apply');
  const includeCashbook = hasFlag('include-cashbook');
  const receiptId = argValue('receipt-id');
  const receiptNo = argValue('receipt-no');

  if (!getApps().length) {
    const projectId = resolveFirebaseProjectId();
    try {
      initializeApp({
        credential: applicationDefault(),
        ...(projectId ? { projectId } : {}),
      });
    } catch {
      initializeApp(projectId ? { projectId } : undefined);
    }
  }

  const db = getFirestore();
  const { plans, skipped } = await scanMoneyReceiptWhtFixes(db, { receiptId, receiptNo });

  console.log(`\n=== ใบเสร็จที่ต้องแก้: ${plans.length} ===`);
  for (const p of plans) {
    console.log(
      [
        p.receiptNo,
        `(id ${p.receiptId})`,
        `INV ${p.taxInvoiceNo}`,
        `${p.currentAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        '→',
        `${p.expectedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        `(+${p.delta.toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
        p.cashbookAmount != null ? `cashbook ${p.cashbookAmount.toFixed(2)}` : '',
        p.arEntryId ? `AR credit ${p.arCreditBefore?.toFixed(2)} / debit ${p.arDebit?.toFixed(2)}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    );
  }

  if (skipped.length > 0) {
    console.log(`\n=== ข้าม: ${skipped.length} ===`);
    for (const s of skipped.slice(0, 20)) {
      console.log(`${s.receiptNo} (${s.receiptId}): ${s.reason}`);
    }
    if (skipped.length > 20) console.log(`… และอีก ${skipped.length - 20} รายการ`);
  }

  if (dryRun) {
    console.log('\n[dry-run] ใส่ --apply เพื่อบันทึก (cashbook/ธนาคารไม่ถูกแตะ เว้นแต่ใส่ --include-cashbook)');
    return;
  }

  if (plans.length === 0) {
    console.log('\nไม่มีรายการที่แก้');
    return;
  }

  console.log(`\n=== apply (${includeCashbook ? 'รวม cashbook' : 'เอกสาร+AR เท่านั้น'}) ===`);
  for (const plan of plans) {
    const result = await applyMoneyReceiptWhtFix(db, plan, {
      includeCashbook,
      actorName: 'migration:fix-money-receipt-wht-amounts',
    });
    console.log(
      `OK ${result.receiptNo}: ${result.fromAmount.toFixed(2)} → ${result.toAmount.toFixed(2)}` +
        (result.arUpdated ? ' | AR updated' : '') +
        (result.cashbookUpdated ? ' | cashbook updated' : ''),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
