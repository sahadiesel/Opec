'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Building2, Eye, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { formatPayrollYearMonthMmYyyyThaiBE, formatYmdLocalThaiBE, htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { useFirebaseApp, useFirestore } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import type {
  BankAccount,
  PaymentMethod,
  RentalContract,
  RentalPayable,
  User,
  Vendor,
  VendorBillSupportingDocumentLink,
} from '@/lib/types';
import {
  payRentalPayable,
  resolveContractVatRatePercent,
  updateRentalPayableSupportingDocuments,
} from '@/lib/services/rental-contract-service';
import {
  uploadRentalPayablePaymentProof,
  validateRentalPayablePaymentProof,
} from '@/lib/storage/rental-payable-payment-proofs';
import { resolveVendorBankAccounts, vendorBankAccountLabel } from '@/lib/vendors/vendor-bank-accounts';

type SupportingFormRow = { attached: boolean; documentNo: string; documentDate: string };

function supportingFromLink(link?: VendorBillSupportingDocumentLink): SupportingFormRow {
  return {
    attached: !!link?.attached,
    documentNo: link?.documentNo ?? '',
    documentDate: link?.documentDate ?? '',
  };
}

function supportingToFirestore(row: SupportingFormRow): VendorBillSupportingDocumentLink {
  if (!row.attached) return { attached: false };
  return {
    attached: true,
    documentNo: row.documentNo.trim(),
    documentDate: row.documentDate.trim(),
  };
}

function validateSupportingRow(label: string, row: SupportingFormRow): string | null {
  if (!row.attached) return null;
  if (!row.documentNo.trim() || !row.documentDate.trim()) {
    return `${label}: ต้องระบุเลขที่และวันที่เมื่อติ๊กแนบเอกสาร`;
  }
  return null;
}

function money(value: number): string {
  return Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SupportingDocFields({
  title,
  value,
  onChange,
  hint,
}: {
  title: string;
  value: SupportingFormRow;
  onChange: (next: SupportingFormRow) => void;
  hint?: string;
}) {
  return (
    <div className="rounded-md border px-3 py-2 space-y-2">
      <div className="flex items-start gap-2">
        <Checkbox
          checked={value.attached}
          onCheckedChange={(c) => onChange({ ...value, attached: !!c })}
          id={`sup-${title}`}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={`sup-${title}`} className="text-sm font-medium leading-none cursor-pointer">
            {title}
          </Label>
          {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
      {value.attached ? (
        <div className="grid gap-2 sm:grid-cols-2 pl-6">
          <div className="space-y-1">
            <Label className="text-xs">เลขที่</Label>
            <Input
              value={value.documentNo}
              onChange={(e) => onChange({ ...value, documentNo: e.target.value })}
              placeholder="เลขที่เอกสาร"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">วันที่</Label>
            <Input
              type="date"
              value={value.documentDate}
              onChange={(e) => onChange({ ...value, documentDate: e.target.value })}
            />
          </div>
        </div>
      ) : (
        <p className="pl-6 text-xs text-muted-foreground">ไม่แนบ — อ้างอิงเฉพาะสัญญาเช่าภายในระบบ</p>
      )}
    </div>
  );
}

function SupportingDocReadOnly({
  title,
  link,
}: {
  title: string;
  link?: VendorBillSupportingDocumentLink;
}) {
  if (!link?.attached) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{title}:</span> ไม่แนบ — อ้างอิงเฉพาะสัญญาเช่าภายในระบบ
      </p>
    );
  }
  return (
    <p className="text-sm">
      <span className="font-medium">{title}:</span> เลขที่{' '}
      <span className="font-mono font-semibold">{link.documentNo?.trim() || '—'}</span>
      {' · '}วันที่ {link.documentDate?.trim() ? formatYmdLocalThaiBE(link.documentDate) : '—'}
    </p>
  );
}

export function RentalPayablePayoutDialog({
  open,
  onOpenChange,
  contract,
  payable,
  vendor,
  banks,
  currentUser,
  canPay,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: RentalContract;
  payable: RentalPayable | null;
  vendor: Vendor | null;
  banks: BankAccount[] | null;
  currentUser: User;
  canPay: boolean;
}) {
  const firestore = useFirestore();
  const firebaseApp = useFirebaseApp();
  const { toast } = useToast();
  const paymentProofInputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [bankId, setBankId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('TRANSFER');
  const [entryDate, setEntryDate] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
  );
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [payeeBankId, setPayeeBankId] = useState('');
  const [supportingDelivery, setSupportingDelivery] = useState<SupportingFormRow>({
    attached: false,
    documentNo: '',
    documentDate: '',
  });
  const [supportingTaxInv, setSupportingTaxInv] = useState<SupportingFormRow>({
    attached: false,
    documentNo: '',
    documentDate: '',
  });
  const [supportingReceipt, setSupportingReceipt] = useState<SupportingFormRow>({
    attached: false,
    documentNo: '',
    documentDate: '',
  });

  const payeeBanks = useMemo(() => resolveVendorBankAccounts(vendor), [vendor]);
  const selectedPayee = useMemo(
    () => payeeBanks.find((b) => b.id === payeeBankId) ?? payeeBanks.find((b) => b.isPrimary) ?? payeeBanks[0] ?? null,
    [payeeBanks, payeeBankId],
  );

  useEffect(() => {
    if (!open || !payable) return;
    setBankId('');
    setPaymentMethod('TRANSFER');
    setEntryDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }));
    setPaymentProofFile(null);
    if (paymentProofInputRef.current) paymentProofInputRef.current.value = '';
    const banksList = resolveVendorBankAccounts(vendor);
    const primary = banksList.find((b) => b.isPrimary) ?? banksList[0];
    setPayeeBankId(primary?.id || '');
    setSupportingDelivery(supportingFromLink(payable.supportingDeliveryNote));
    setSupportingTaxInv(supportingFromLink(payable.supportingTaxInvoice));
    setSupportingReceipt(supportingFromLink(payable.supportingMoneyReceipt));
  }, [open, payable?.id, vendor?.id]);

  if (!payable) return null;

  const baseRent =
    payable.baseRentAmount != null && Number.isFinite(Number(payable.baseRentAmount))
      ? Number(payable.baseRentAmount)
      : Math.max(0, Number(payable.grossAmount || 0) - (Number(payable.vatAmount) || 0));
  const vatAmount =
    payable.vatAmount != null && Number.isFinite(Number(payable.vatAmount))
      ? Number(payable.vatAmount)
      : Math.max(0, Number(payable.grossAmount || 0) - baseRent);
  const vatRate = resolveContractVatRatePercent({
    vatRatePercent: payable.vatRatePercent ?? contract.vatRatePercent,
  });
  const isPending = payable.status === 'PENDING' && !payable.cashbookEntryId;
  const isPaid = payable.status === 'PAID' || !!payable.cashbookEntryId;

  const handlePay = async () => {
    if (!firestore || !vendor || !canPay || !isPending) return;
    if (!bankId || !entryDate) {
      toast({ variant: 'destructive', title: 'กรุณาเลือกบัญชีและวันที่ทำรายการ' });
      return;
    }
    if (!paymentProofFile) {
      toast({ variant: 'destructive', title: 'กรุณาแนบหลักฐานโอนเงิน' });
      return;
    }
    const proofErr = validateRentalPayablePaymentProof(paymentProofFile);
    if (proofErr) {
      toast({ variant: 'destructive', title: proofErr });
      return;
    }
    for (const [label, row] of [
      ['ใบส่งของ', supportingDelivery],
      ['ใบกำกับภาษี', supportingTaxInv],
      ['ใบเสร็จรับเงิน (คู่ค้า)', supportingReceipt],
    ] as const) {
      const err = validateSupportingRow(label, row);
      if (err) {
        toast({ variant: 'destructive', title: err });
        return;
      }
    }

    setBusy(true);
    try {
      const proof = await uploadRentalPayablePaymentProof(
        firebaseApp,
        payable.id,
        currentUser.id,
        paymentProofFile,
      );
      const result = await payRentalPayable(firestore, currentUser, {
        contract,
        payable,
        vendor,
        bankAccountId: bankId,
        paymentMethod,
        entryDate,
        paymentProofUrl: proof.downloadUrl,
        paymentProofFileName: proof.fileName,
        vendorPayeeBankAccountId: selectedPayee?.id,
        vendorPayeeBankName: selectedPayee?.bankName,
        vendorPayeeBankAccountName: selectedPayee?.bankAccountName,
        vendorPayeeBankAccountNumber: selectedPayee?.bankAccountNumber,
        supportingDeliveryNote: supportingToFirestore(supportingDelivery),
        supportingTaxInvoice: supportingToFirestore(supportingTaxInv),
        supportingMoneyReceipt: supportingToFirestore(supportingReceipt),
      });
      toast({
        title: 'บันทึกทำจ่ายแล้ว',
        description: `${result.cashbookEntryNo}${
          result.whtCertificateId ? ' · ออกหนังสือหัก ณ ที่จ่ายแล้ว' : ''
        }`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'ทำจ่ายไม่สำเร็จ',
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSupporting = async () => {
    if (!firestore || !payable) return;
    for (const [label, row] of [
      ['ใบส่งของ', supportingDelivery],
      ['ใบกำกับภาษี', supportingTaxInv],
      ['ใบเสร็จรับเงิน (คู่ค้า)', supportingReceipt],
    ] as const) {
      const err = validateSupportingRow(label, row);
      if (err) {
        toast({ variant: 'destructive', title: err });
        return;
      }
    }
    setBusy(true);
    try {
      await updateRentalPayableSupportingDocuments(firestore, currentUser, payable, {
        supportingDeliveryNote: supportingToFirestore(supportingDelivery),
        supportingTaxInvoice: supportingToFirestore(supportingTaxInv),
        supportingMoneyReceipt: supportingToFirestore(supportingReceipt),
      });
      toast({ title: 'บันทึกเอกสารประกอบแล้ว' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isPending ? 'ทำจ่ายค่าเช่า' : 'รายละเอียดการจ่ายค่าเช่า'} {formatPayrollYearMonthMmYyyyThaiBE(payable.periodMonth)}
          </DialogTitle>
          <DialogDescription>
            รูปแบบเดียวกับใบวางบิล — บันทึก cashbook · หลักฐานโอน · หัก ณ ที่จ่าย · เอกสารประกอบ (ใบเสร็จ)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* แผนงวดชำระ — รอบเดือนนี้ = 1 งวด */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">แผนงวดชำระในรอบนี้</h3>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 px-3 font-medium">งวด</th>
                    <th className="py-2 px-3 font-medium">ชื่อ</th>
                    <th className="py-2 px-3 font-medium text-right">ยอด (รวม VAT)</th>
                    <th className="py-2 px-3 font-medium">สถานะ</th>
                    <th className="py-2 px-3 font-medium">Cashbook</th>
                    <th className="py-2 px-3 font-medium">หลักฐานจ่าย</th>
                    <th className="py-2 px-3 font-medium">หัก ณ ที่จ่าย</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-muted/60">
                    <td className="py-2 px-3 font-mono">1</td>
                    <td className="py-2 px-3">งวด {formatPayrollYearMonthMmYyyyThaiBE(payable.periodMonth)}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold">
                      ฿{money(payable.grossAmount)}
                    </td>
                    <td className="py-2 px-3">
                      {isPaid ? (
                        <Badge className="bg-green-600">จ่ายแล้ว</Badge>
                      ) : payable.status === 'VOID' ? (
                        <Badge variant="destructive">ยกเลิก</Badge>
                      ) : (
                        <Badge variant="outline">รอจ่าย</Badge>
                      )}
                    </td>
                    <td className="py-2 px-3 font-mono text-xs">
                      {payable.cashbookEntryNo || '—'}
                    </td>
                    <td className="py-2 px-3">
                      {payable.paymentProofUrl ? (
                        <a
                          href={payable.paymentProofUrl}
                          className="text-primary font-semibold underline text-xs"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {payable.paymentProofFileName || 'เปิดไฟล์'}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {payable.whtCertificateDocumentId ? (
                        <Button type="button" variant="secondary" size="sm" className="h-8 gap-1.5 px-2.5" asChild>
                          <Link href={`/accounting/wht-certificates/${payable.whtCertificateDocumentId}`}>
                            <Eye className="h-3.5 w-3.5" />
                            พรีวิว / พิมพ์
                          </Link>
                        </Button>
                      ) : payable.withholdingTaxAmount > 0.005 && isPending ? (
                        <span className="text-xs text-muted-foreground">ออกเมื่อบันทึกจ่าย</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* อ้างอิงสัญญา + VAT / WHT */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">อ้างอิงสัญญาและยอดในรอบนี้</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border bg-muted/20 px-3 py-2">
                <p className="text-muted-foreground text-xs font-medium mb-1">เลขที่สัญญา</p>
                <p className="font-mono font-semibold text-base">{contract.contractNo}</p>
                <p className="text-xs text-muted-foreground mt-1">{contract.lessorVendorName}</p>
              </div>
              <div className="rounded-md border bg-muted/20 px-3 py-2">
                <p className="text-muted-foreground text-xs font-medium mb-1">งวด / ครบกำหนด</p>
                <p className="font-mono font-semibold text-base">{formatPayrollYearMonthMmYyyyThaiBE(payable.periodMonth)}</p>
                <p className="text-xs text-muted-foreground mt-1">ครบกำหนด {formatYmdLocalThaiBE(payable.dueDate)}</p>
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">การแสดงภาษีมูลค่าเพิ่ม</p>
              <p className="font-medium">
                {vatRate > 0
                  ? `มีภาษีมูลค่าเพิ่ม ${vatRate}% (แยกภาษี — ยอดรวม = ก่อนภาษี + VAT)`
                  : 'ไม่มีภาษีมูลค่าเพิ่มในยอดอ้างอิงนี้ / ยอดก่อนภาษี'}
              </p>
            </div>

            <div className="rounded-md border px-3 py-2 space-y-1.5 font-mono text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground font-sans text-xs sm:text-sm">ยอดก่อนภาษี</span>
                <span>฿{money(baseRent)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground font-sans text-xs sm:text-sm">ภาษีมูลค่าเพิ่ม</span>
                <span>฿{money(vatAmount)}</span>
              </div>
              <div className="flex justify-between gap-2 font-bold border-t pt-1.5 font-sans">
                <span>รวมในรอบนี้ (ก่อนหัก ณ ที่จ่าย)</span>
                <span className="font-mono">฿{money(payable.grossAmount)}</span>
              </div>
            </div>

            {payable.withholdingTaxAmount > 0.005 ? (
              <div className="rounded-md border border-violet-200/80 bg-violet-50/30 px-3 py-2 space-y-1 dark:bg-violet-950/20">
                <p className="text-xs font-semibold text-violet-950 dark:text-violet-100">หัก ณ ที่จ่าย (ผู้รับเงิน)</p>
                <p className="text-sm">
                  อัตรา {payable.withholdingTaxRatePercent}% · ค่าเช่า · ฐานก่อนภาษี ฿{money(baseRent)} · หัก ณ ที่จ่าย ฿
                  {money(payable.withholdingTaxAmount)}
                </p>
                <p className="font-bold text-base">
                  สุทธิที่โอนให้คู่ค้า (หลังหัก ณ ที่จ่าย) ฿{money(payable.netPayableAmount)}
                </p>
              </div>
            ) : (
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                ไม่มีการหัก ณ ที่จ่ายในรอบนี้ — สุทธิโอนเท่ากับยอดรวม ฿{money(payable.grossAmount)}
              </div>
            )}
          </section>

          {/* เอกสารประกอบ */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">เอกสารประกอบที่บันทึกไว้</h3>
            {isPending || isPaid ? (
              <div className="space-y-2">
                <SupportingDocFields
                  title="1. ใบส่งของ"
                  value={supportingDelivery}
                  onChange={setSupportingDelivery}
                  hint="ถ้าไม่มี ให้ไม่ติ๊ก — อ้างอิงสัญญาเช่า"
                />
                <SupportingDocFields
                  title="2. ใบกำกับภาษี"
                  value={supportingTaxInv}
                  onChange={setSupportingTaxInv}
                />
                <SupportingDocFields
                  title="3. ใบเสร็จรับเงิน (คู่ค้า)"
                  value={supportingReceipt}
                  onChange={setSupportingReceipt}
                  hint="บันทึกเลขที่/วันที่ใบเสร็จจากผู้ให้เช่า"
                />
                {isPaid ? (
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void handleSaveSupporting()}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึกเอกสารประกอบ'}
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-1">
                <SupportingDocReadOnly title="1. ใบส่งของ" link={payable.supportingDeliveryNote} />
                <SupportingDocReadOnly title="2. ใบกำกับภาษี" link={payable.supportingTaxInvoice} />
                <SupportingDocReadOnly title="3. ใบเสร็จรับเงิน (คู่ค้า)" link={payable.supportingMoneyReceipt} />
              </div>
            )}
          </section>

          {/* ฟอร์มทำจ่าย */}
          {canPay && isPending ? (
            <section className="space-y-4 rounded-md border border-slate-200 p-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">บันทึกจ่ายเมื่อครบกำหนด</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                <div className="space-y-2 md:col-span-9">
                  <Label>บัญชีธนาคารที่ตัดจ่าย</Label>
                  <Select value={bankId || undefined} onValueChange={setBankId}>
                    <SelectTrigger className="h-11 [&>span]:line-clamp-2 [&>span]:whitespace-normal [&>span]:text-left">
                      <SelectValue placeholder="เลือกบัญชี ACTIVE" />
                    </SelectTrigger>
                    <SelectContent className="max-w-[min(100vw-2rem,36rem)]">
                      {(banks ?? [])
                        .filter((b) => b.status === 'ACTIVE' && String(b.accountType) !== 'PETTY_CASH')
                        .map((b) => (
                          <SelectItem key={b.id} value={b.id} className="whitespace-normal">
                            {b.bankName} · {b.accountName} [{b.accountCode}]
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-3">
                  <Label>วิธีชำระ</Label>
                  <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TRANSFER">โอนเงิน</SelectItem>
                      <SelectItem value="CHEQUE">เช็ค</SelectItem>
                      <SelectItem value="CASH">เงินสด</SelectItem>
                      <SelectItem value="OTHER">อื่น ๆ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {payeeBanks.length > 0 ? (
                <div className="rounded-md border border-sky-200/90 bg-sky-50/45 px-3 py-3 space-y-3 dark:bg-sky-950/25 dark:border-sky-900/45">
                  <div className="flex items-center gap-2 text-sm font-semibold text-sky-950 dark:text-sky-100">
                    <Building2 className="h-4 w-4 shrink-0 opacity-80" />
                    บัญชีรับเงินของผู้ให้เช่า (โอนเข้า)
                  </div>
                  {payeeBanks.length > 1 ? (
                    <Select value={selectedPayee?.id || undefined} onValueChange={setPayeeBankId}>
                      <SelectTrigger className="h-11 bg-background">
                        <SelectValue placeholder="เลือกบัญชีคู่ค้า..." />
                      </SelectTrigger>
                      <SelectContent>
                        {payeeBanks.map((b, i) => (
                          <SelectItem key={b.id} value={b.id}>
                            {vendorBankAccountLabel(b, i)}
                            {b.isPrimary ? ' (หลัก)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  {selectedPayee ? (
                    <dl className="grid gap-1.5 text-sm">
                      {selectedPayee.bankName ? (
                        <div className="flex flex-wrap gap-x-2">
                          <dt className="text-muted-foreground shrink-0">ธนาคาร</dt>
                          <dd className="font-mono font-medium">{selectedPayee.bankName}</dd>
                        </div>
                      ) : null}
                      {selectedPayee.bankAccountName ? (
                        <div className="flex flex-wrap gap-x-2">
                          <dt className="text-muted-foreground shrink-0">ชื่อบัญชี</dt>
                          <dd className="font-medium">{selectedPayee.bankAccountName}</dd>
                        </div>
                      ) : null}
                      {selectedPayee.bankAccountNumber ? (
                        <div className="flex flex-wrap gap-x-2">
                          <dt className="text-muted-foreground shrink-0">เลขที่บัญชี</dt>
                          <dd className="font-mono font-semibold tracking-wide">
                            {selectedPayee.bankAccountNumber}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                  {vendor?.id ? (
                    <Button variant="link" className="h-auto p-0 text-xs font-semibold" asChild>
                      <Link href={`/vendors/${vendor.id}`}>
                        เปิดแก้ไขคู่ค้า <ExternalLink className="h-3 w-3 ml-0.5 inline" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              ) : vendor ? (
                <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
                  ยังไม่มีเลขบัญชีรับเงินของผู้ให้เช่า — แนะนำกรอกที่{' '}
                  <Link href={`/vendors/${vendor.id}`} className="font-semibold text-primary underline">
                    คู่ค้านี้ → ข้อมูลการเงิน
                  </Link>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>แนบหลักฐานโอนเงิน (PDF หรือรูปภาพ)</Label>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  แนบเฉพาะสลิปหรือหลักฐานการโอน — ใบหัก ณ ที่จ่ายพิมพ์จากระบบได้หลังบันทึกจ่าย
                </p>
                <Input
                  ref={paymentProofInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif"
                  className="h-11 cursor-pointer"
                  onChange={(e) => setPaymentProofFile(e.target.files?.[0] ?? null)}
                />
                {paymentProofFile ? (
                  <p className="text-xs text-muted-foreground truncate">เลือกแล้ว: {paymentProofFile.name}</p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>วันที่ทำรายการ (cashbook)</Label>
                  <DatePickerThaiBE
                    className="h-11 w-full"
                    value={htmlDateValueToTimestampMs(entryDate) ?? null}
                    onChange={(ms) => setEntryDate(timestampToHtmlDateValue(ms))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>ยอดตัดจากบัญชีธนาคาร (โอนสุทธิ)</Label>
                  <Input
                    readOnly
                    className="h-11 font-mono font-bold text-right bg-muted/50"
                    value={`฿${money(payable.netPayableAmount)}`}
                  />
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isPending ? 'ยกเลิก' : 'ปิด'}
          </Button>
          {canPay && isPending ? (
            <Button disabled={busy || !bankId || !entryDate || !paymentProofFile} onClick={() => void handlePay()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยันทำจ่าย'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
