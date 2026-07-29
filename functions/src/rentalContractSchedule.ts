import { FieldPath, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

type RentalContractRow = {
  id: string;
  contractNo: string;
  lessorVendorId: string;
  lessorVendorName: string;
  rentedItemDescription: string;
  monthlyRentAmount: number;
  startDate: string;
  endDate: string;
  paymentDayOfMonth: number;
  withholdingTaxRatePercent: number;
  /** ไม่ระบุ = 0 (สัญญาเก่า) */
  vatRatePercent?: number;
  status: string;
};

const PAGE = 400;

function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function bangkokTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function ymd(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dueDate(contract: RentalContractRow, periodMonth: string): string {
  const [year, month] = periodMonth.split('-').map(Number);
  const monthIndex = month - 1;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  let result = ymd(year, monthIndex, Math.min(lastDay, Math.max(1, contract.paymentDayOfMonth)));
  if (periodMonth === contract.startDate.slice(0, 7) && result < contract.startDate) result = contract.startDate;
  if (periodMonth === contract.endDate.slice(0, 7) && result > contract.endDate) result = contract.endDate;
  return result;
}

function monthsBetween(startYmd: string, endYmd: string): string[] {
  const [sy, sm] = startYmd.slice(0, 7).split('-').map(Number);
  const [ey, em] = endYmd.slice(0, 7).split('-').map(Number);
  const rows: string[] = [];
  let year = sy;
  let month = sm;
  while (year < ey || (year === ey && month <= em)) {
    rows.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      year += 1;
      month = 1;
    }
  }
  return rows;
}

export async function runRentalContractDailyJob(db: Firestore): Promise<{
  contracts: number;
  payablesCreated: number;
  overdueFlipped: number;
  expired: number;
  errors: number;
}> {
  const today = bangkokTodayYmd();
  let contracts = 0;
  let payablesCreated = 0;
  let overdueFlipped = 0;
  let expired = 0;
  let errors = 0;
  let last: QueryDocumentSnapshot | undefined;

  for (;;) {
    let q = db
      .collection('rental_contracts')
      .where('status', '==', 'ACTIVE')
      .orderBy(FieldPath.documentId())
      .limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1];
    contracts += snap.size;

    for (const contractDoc of snap.docs) {
      try {
        const contract = { id: contractDoc.id, ...contractDoc.data() } as RentalContractRow;
        const horizon = today < contract.endDate ? today : contract.endDate;
        if (horizon >= contract.startDate) {
          for (const month of monthsBetween(contract.startDate, horizon)) {
            const due = dueDate(contract, month);
            if (due > today || due < contract.startDate || due > contract.endDate) continue;
            const id = `${contract.id}_${month}`;
            const payableRef = db.collection('rental_payables').doc(id);
            const apRef = db.collection('accounts_payable').doc(id);
            const created = await db.runTransaction(async (tx) => {
              const existing = await tx.get(payableRef);
              if (existing.exists) return false;
              const now = Date.now();
              const base = round2(contract.monthlyRentAmount);
              const vatRate = round2(Math.max(0, Number(contract.vatRatePercent) || 0));
              const vatAmount = round2((base * vatRate) / 100);
              const gross = round2(base + vatAmount);
              const wht = round2((base * contract.withholdingTaxRatePercent) / 100);
              tx.set(payableRef, {
                id,
                contractId: contract.id,
                contractNo: contract.contractNo,
                vendorId: contract.lessorVendorId,
                vendorName: contract.lessorVendorName,
                periodMonth: month,
                dueDate: due,
                description: `ค่าเช่า ${contract.rentedItemDescription} ประจำเดือน ${month}`,
                baseRentAmount: base,
                vatRatePercent: vatRate,
                vatAmount,
                grossAmount: gross,
                withholdingTaxRatePercent: contract.withholdingTaxRatePercent,
                withholdingTaxAmount: wht,
                netPayableAmount: round2(gross - wht),
                status: 'PENDING',
                apEntryId: id,
                createdAt: now,
                updatedAt: now,
              });
              tx.set(apRef, {
                id,
                vendorId: contract.lessorVendorId,
                documentNo: `${contract.contractNo}/${month}`,
                referenceId: id,
                billDate: due,
                dueDate: due,
                debitAmount: gross,
                creditAmount: 0,
                outstandingAmount: gross,
                status: due < today ? 'OVERDUE' : 'OPEN',
                origin: 'RENTAL_CONTRACT',
                rentalPayableId: id,
                rentalContractId: contract.id,
                createdAt: now,
                updatedAt: now,
              });
              return true;
            });
            if (created) payablesCreated += 1;
          }
        }
        if (today > contract.endDate) {
          await contractDoc.ref.update({ status: 'EXPIRED', updatedAt: Date.now() });
          expired += 1;
        }
      } catch {
        errors += 1;
      }
    }
    if (snap.size < PAGE) break;
  }

  // Flip OPEN → OVERDUE for rental AP rows whose dueDate has passed
  let apLast: QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db
      .collection('accounts_payable')
      .where('origin', '==', 'RENTAL_CONTRACT')
      .where('status', '==', 'OPEN')
      .where('dueDate', '<', today)
      .orderBy('dueDate')
      .orderBy(FieldPath.documentId())
      .limit(PAGE);
    if (apLast) q = q.startAfter(apLast);
    const snap = await q.get();
    if (snap.empty) break;
    apLast = snap.docs[snap.docs.length - 1];
    for (const row of snap.docs) {
      try {
        await row.ref.update({ status: 'OVERDUE', updatedAt: Date.now() });
        overdueFlipped += 1;
      } catch {
        errors += 1;
      }
    }
    if (snap.size < PAGE) break;
  }

  return { contracts, payablesCreated, overdueFlipped, expired, errors };
}
