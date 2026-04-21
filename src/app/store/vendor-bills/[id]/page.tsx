'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2, Send, Banknote, ClipboardCheck, Printer } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { collection, doc, setDoc } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useAppUser } from '@/hooks/use-app-user';
import { canMarkPurchaseVendorBillPaid, canView } from '@/lib/permissions';
import {
  PaymentMethod,
  Purchase,
  PurchasePaymentMilestone,
  PurchaseVendorBill,
  PurchaseVendorBillStatus,
  User,
  Vendor,
} from '@/lib/types';
import { executeVendorBillPayment } from '@/lib/ops/vendor-bill-payment';
import { supplierWithholdingOnMilestone } from '@/lib/ops/purchase-payment-milestones';
import { formatDateThaiBE, htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusLabel(s: PurchaseVendorBillStatus) {
  if (s === 'DRAFT') return 'ฉบับร่าง';
  if (s === 'SUBMITTED') return 'รอจ่ายเงิน';
  return 'จ่ายแล้ว';
}

export default function StoreVendorBillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const okStore = useMemo(
    () => !!currentUser && canView(currentUser, 'store_inventory'),
    [currentUser]
  );
  const okAccounting = useMemo(
    () => !!currentUser && canView(currentUser, 'accounts_payable'),
    [currentUser]
  );
  const canPay = useMemo(() => canMarkPurchaseVendorBillPaid(currentUser), [currentUser]);
  const canOpen = okStore || okAccounting || canPay;

  const billRef = useMemoFirebase(
    () => (firestore && canOpen ? doc(firestore, 'purchase_vendor_bills', id) : null),
    [firestore, id, canOpen]
  );
  const { data: bill, isLoading: billLoading } = useDoc<PurchaseVendorBill>(billRef as any);

  const purchaseRef = useMemoFirebase(
    () =>
      firestore && bill?.purchaseId ? doc(firestore, 'purchases', bill.purchaseId) : null,
    [firestore, bill?.purchaseId]
  );
  const { data: purchase } = useDoc<Purchase>(purchaseRef as any);

  const vendorRef = useMemoFirebase(
    () => (firestore && bill?.vendorId ? doc(firestore, 'vendors', bill.vendorId) : null),
    [firestore, bill?.vendorId]
  );
  const { data: vendor } = useDoc<Vendor>(vendorRef as any);

  const milestoneRef = useMemoFirebase(
    () =>
      firestore && bill?.purchaseId && bill?.milestoneId
        ? doc(firestore, 'purchases', bill.purchaseId, 'payment_milestones', bill.milestoneId)
        : null,
    [firestore, bill?.purchaseId, bill?.milestoneId]
  );
  const { data: linkedMilestone } = useDoc<PurchasePaymentMilestone>(milestoneRef as any);

  const bankAccountsQuery = useMemoFirebase(
    () => (firestore && canPay ? collection(firestore, 'bank_accounts') : null),
    [firestore, canPay]
  );
  const { data: bankAccounts } = useCollection(bankAccountsQuery as any);

  const [billingDate, setBillingDate] = useState('');
  const [payDate, setPayDate] = useState('');
  const [notes, setNotes] = useState('');
  const [payoutBankId, setPayoutBankId] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<PaymentMethod>('TRANSFER');
  const [payoutEntryDate, setPayoutEntryDate] = useState('');
  const [paying, setPaying] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);

  useEffect(() => {
    if (!bill) return;
    setBillingDate(bill.billingReceivedDate || '');
    setPayDate(bill.plannedPaymentDate || '');
    setNotes(bill.notes || '');
    if (bill.status === 'SUBMITTED') {
      setPayoutEntryDate((d) => d || timestampToHtmlDateValue(Date.now()));
    }
  }, [bill?.id, bill?.status]);

  useEffect(() => {
    if (!bankAccounts?.length || payoutBankId) return;
    const first = bankAccounts.find((b) => b.status === 'ACTIVE');
    if (first) setPayoutBankId(first.id);
  }, [bankAccounts, bill?.id, payoutBankId]);

  const grossForPayment = useMemo(() => {
    if (!purchase || !bill) return 0;
    return Number(bill.billAmount ?? purchase.totalAmount) || 0;
  }, [bill, purchase]);

  /** ยอดงวดรวม VAT สำหรับคำนวณหัก (ให้ตรงกับ milestone ถ้ามี) */
  const grossInclVatForBill = useMemo(() => {
    if (!purchase || !bill) return 0;
    if (linkedMilestone != null) return Number(linkedMilestone.amount) || 0;
    return Number(bill.billAmount ?? purchase.totalAmount) || 0;
  }, [purchase, bill, linkedMilestone]);

  /** ฐานหัก ณ ที่จ่ายตาม PO — ใช้ยอดงวดถ้ามี milestone */
  const withholdingPreview = useMemo(() => {
    if (!purchase?.supplierWithholdingEnabled) return null;
    const rate = Number(purchase.supplierWithholdingRatePercent) || 0;
    if (rate < 0.005) return null;
    if (!bill) return null;
    const grossInclVat =
      linkedMilestone != null
        ? Number(linkedMilestone.amount) || 0
        : Number(bill.billAmount ?? purchase.totalAmount) || 0;
    if (grossInclVat < 0.01) return null;
    return supplierWithholdingOnMilestone(grossInclVat, rate, purchase);
  }, [purchase, linkedMilestone, bill]);

  const canPrintWithholdingSummary = !!withholdingPreview && withholdingPreview.wht > 0.005;

  /** ตรงกับ executeVendorBillPayment: ตัดธนาคารเฉพาะสุทธิจ่ายคู่ค้า — หัก ณ ที่จ่ายไม่ผ่านบัญชี */
  const bankDebitAmount = useMemo(() => {
    if (withholdingPreview && withholdingPreview.wht > 0.005) return withholdingPreview.netPaid;
    return grossInclVatForBill || grossForPayment;
  }, [withholdingPreview, grossForPayment, grossInclVatForBill]);

  const handlePrintWithholding = () => {
    if (!purchase || !bill || !vendor || !withholdingPreview || !canPrintWithholdingSummary) return;
    const m = linkedMilestone;
    const seq = m?.sequence ?? 1;
    const label = m?.label || 'ชำระตามใบรับวางบิล';
    const gross = m ? m.amount : grossForPayment;
    const { wht, netPaid } = withholdingPreview;
    const rate = Number(purchase.supplierWithholdingRatePercent) || 0;
    const w = window.open('', '_blank');
    if (!w) return;
    const vn = vendor.vendorName || '—';
    const rows = `<tr>
      <td style="padding:6px;border:1px solid #ccc">${seq}</td>
      <td style="padding:6px;border:1px solid #ccc">${escapeHtml(label)}</td>
      <td style="padding:6px;border:1px solid #ccc;text-align:right">${gross.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td style="padding:6px;border:1px solid #ccc;text-align:right">${wht.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td style="padding:6px;border:1px solid #ccc;text-align:right;font-weight:bold">${netPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
    </tr>`;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>สรุปหัก ณ ที่จ่าย ${escapeHtml(bill.receiptNo)}</title>
  <style>body{font-family:system-ui,sans-serif;padding:24px;max-width:900px;margin:0 auto} table{border-collapse:collapse;width:100%;margin-top:16px} th{background:#f3f4f6;text-align:left;padding:8px;border:1px solid #ccc}</style></head><body>
  <h1>สรุปหัก ณ ที่จ่าย — ผู้รับเงิน (คู่ค้า)</h1>
  <p><strong>เลขที่ PO:</strong> ${escapeHtml(purchase.purchaseNo || purchase.id)} &nbsp;|&nbsp; <strong>คู่ค้า:</strong> ${escapeHtml(vn)}</p>
  <p><strong>อัตราหัก ณ ที่จ่าย:</strong> ${rate}% (ฐานคำนวณ = ยอดแต่ละงวดชำระ)</p>
  <p><strong>พิมพ์เมื่อ:</strong> ${escapeHtml(formatDateThaiBE(Date.now()))}</p>
  <table>
    <thead><tr>
      <th>งวด</th><th>รายละเอียด</th><th style="text-align:right">ฐานจ่าย (บาท)</th><th style="text-align:right">หัก ณ ที่จ่าย (บาท)</th><th style="text-align:right">สุทธิจ่าย (บาท)</th>
    </tr></thead>
    <tbody>${rows}
    <tr style="font-weight:bold;background:#fafafa">
      <td colspan="2" style="padding:8px;border:1px solid #ccc">รวม</td>
      <td style="padding:8px;border:1px solid #ccc;text-align:right">${gross.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td style="padding:8px;border:1px solid #ccc;text-align:right">${wht.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td style="padding:8px;border:1px solid #ccc;text-align:right">${netPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
    </tr>
    </tbody>
  </table>
  <p style="margin-top:24px;font-size:12px;color:#666">เอกสารสำหรับแผนกบัญชี — ตรวจสอบอัตราตามประกาศกรมสรรพากร</p>
  </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  const saveDraft = async () => {
    if (!billRef || !bill || bill.status !== 'DRAFT') return;
    await updateDocumentNonBlocking(billRef, {
      billingReceivedDate: billingDate,
      plannedPaymentDate: payDate,
      notes,
      updatedAt: Date.now(),
    });
    toast({ title: 'บันทึกฉบับร่างแล้ว' });
  };

  const submitToAccounting = async () => {
    if (!firestore || !billRef || !bill || !purchase || bill.status !== 'DRAFT') {
      toast({ variant: 'destructive', title: 'ส่งไม่ได้', description: 'ต้องเป็นฉบับร่างและมีใบสั่งซื้อ' });
      return;
    }
    const now = Date.now();
    await updateDocumentNonBlocking(billRef, {
      billingReceivedDate: billingDate,
      plannedPaymentDate: payDate,
      notes,
      purchaseType: purchase.purchaseType,
      status: 'SUBMITTED' as PurchaseVendorBillStatus,
      submittedToAccountingAt: now,
      updatedAt: now,
    });
    const apAmount = bill.billAmount ?? purchase.totalAmount;
    await setDoc(
      doc(firestore, 'accounts_payable', bill.id),
      {
        id: bill.id,
        vendorId: bill.vendorId,
        documentNo: bill.receiptNo,
        referenceId: bill.purchaseId,
        billDate: billingDate,
        dueDate: payDate,
        debitAmount: apAmount,
        creditAmount: 0,
        outstandingAmount: apAmount,
        status: 'OPEN',
        origin: 'STORE_VENDOR_BILL',
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    setSubmitConfirmOpen(false);
    toast({
      title: 'ส่งแผนกบัญชีแล้ว',
      description: 'อยู่ในคิว «ตรวจสอบรายจ่าย» และเจ้าหนี้การค้า (เครดิต)',
    });
  };

  const markPaid = async () => {
    if (!firestore || !billRef || !bill || !purchase || !purchaseRef || bill.status !== 'SUBMITTED') {
      toast({ variant: 'destructive', title: 'บันทึกไม่ได้' });
      return;
    }
    if (!canPay || !currentUser) return;
    if (!payoutBankId) {
      toast({ variant: 'destructive', title: 'เลือกบัญชีธนาคาร', description: 'ใช้ตัดจ่ายและลง cashbook' });
      return;
    }
    if (!payoutEntryDate.trim()) {
      toast({ variant: 'destructive', title: 'ระบุวันที่จ่าย' });
      return;
    }
    setPaying(true);
    try {
      const { cashbookEntryNo } = await executeVendorBillPayment({
        firestore,
        billRef,
        bill,
        purchaseRef,
        purchase,
        vendorName: vendor?.vendorName || bill.vendorId,
        bankAccountId: payoutBankId,
        paymentMethod: payoutMethod,
        entryDate: payoutEntryDate,
        currentUser,
      });
      toast({
        title: 'บันทึกจ่ายแล้ว',
        description: `Cashbook ${cashbookEntryNo} · หักยอดบัญชีธนาคารแล้ว`,
      });
    } catch (e: unknown) {
      const code = e instanceof Error ? e.message : '';
      if (code === 'ALREADY_RECORDED') {
        toast({ variant: 'destructive', title: 'รายการนี้ลง cashbook แล้ว' });
      } else {
        console.error(e);
        toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: 'ตรวจสิทธิ์บัญชี/ธนาคารหรือลองใหม่' });
      }
    } finally {
      setPaying(false);
    }
  };

  if (userLoading || !currentUser) return null;
  if (!canOpen) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">ไม่มีสิทธิ์</div>
      </AppShell>
    );
  }

  if (billLoading || !bill) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const readOnly = bill.status !== 'DRAFT' || !okStore;

  const effectivePurchaseType = bill.purchaseType ?? purchase?.purchaseType;
  const isCashPo = effectivePurchaseType === 'CASH';

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/store/vendor-bills">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-primary">{bill.receiptNo}</h1>
            <p className="text-sm text-muted-foreground">
              ใบสั่งซื้อ {bill.purchaseNo || bill.purchaseId} · {vendor?.vendorName || '—'}
            </p>
          </div>
          <Badge className="ml-auto">{statusLabel(bill.status)}</Badge>
        </div>

        {bill.status === 'PAID' && bill.cashbookEntryNo && (
          <Card className="border-green-200 bg-green-50/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-green-900">ลงสมุด cashbook แล้ว</CardTitle>
              <CardDescription className="text-green-800">
                เลขที่รายการ: <span className="font-mono font-bold">{bill.cashbookEntryNo}</span>
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {bill.status === 'SUBMITTED' && purchase && purchaseRef && (
          <>
            {!isCashPo && (
              <Card className="border-blue-200 bg-blue-50/40">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-blue-800" /> ใบสั่งซื้อแบบเครดิต
                  </CardTitle>
                  <CardDescription className="text-blue-950/90 space-y-2">
                    <p>
                      รายการนี้อยู่ใน{' '}
                      <Link href="/accounting/outgoing-review" className="font-semibold underline">
                        ตรวจสอบรายจ่าย
                      </Link>{' '}
                      และ{' '}
                      <Link href="/accounts-payable" className="font-semibold underline">
                        เจ้าหนี้การค้า
                      </Link>{' '}
                      แล้ว — เมื่อถึงกำหนดชำระให้บันทึกจ่ายด้านล่าง (ลง cashbook และปิดเจ้าหนี้)
                    </p>
                  </CardDescription>
                </CardHeader>
              </Card>
            )}
            {bill.status === 'SUBMITTED' && canPay && (
              <Card className={isCashPo ? 'border-emerald-200' : 'border-slate-200'}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Banknote className="h-5 w-5" />
                    {isCashPo
                      ? 'จ่ายเงิน (เงินสด) + ลงรายรับรายจ่าย'
                      : 'บันทึกจ่ายเมื่อครบกำหนด (เครดิต)'}
                  </CardTitle>
                  <CardDescription>
                    {isCashPo ? (
                      <>
                        ลง cashbook เป็นจ่ายออก — <strong>ตัดบัญชีธนาคารเฉพาะสุทธิโอนให้คู่ค้า</strong>
                        {purchase?.supplierWithholdingEnabled
                          ? ' (ส่วนหัก ณ ที่จ่ายสะสมที่เมนูรายการหัก ณ ที่จ่าย ไม่ตัดบัญชีตอนโอน)'
                          : ''}
                        {' — แนะนำทำจากเมนู '}
                        <Link href="/accounting/outgoing-review" className="font-semibold underline">
                          ตรวจสอบรายจ่าย
                        </Link>{' '}
                        หรือดำเนินการที่นี่
                      </>
                    ) : (
                      <>
                        เมื่อถึงวันจ่ายจริง ให้กดจ่ายที่นี่ — ระบบจะลง cashbook ปิดเจ้าหนี้ และอัปเดตงวด PO
                      </>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2 min-w-0">
                      <Label>บัญชีธนาคารที่ตัดจ่าย</Label>
                      <Select value={payoutBankId || undefined} onValueChange={setPayoutBankId}>
                        <SelectTrigger className="h-11 w-full">
                          <SelectValue placeholder="เลือกบัญชี..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(bankAccounts || [])
                            .filter((b) => b.status === 'ACTIVE')
                            .map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.bankName} · {b.accountNumber} (฿{b.currentBalance.toLocaleString()})
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 min-w-0">
                      <Label>วิธีชำระ</Label>
                      <Select value={payoutMethod} onValueChange={(v) => setPayoutMethod(v as PaymentMethod)}>
                        <SelectTrigger className="h-11 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TRANSFER">โอนเงิน</SelectItem>
                          <SelectItem value="CASH">เงินสด</SelectItem>
                          <SelectItem value="CHEQUE">เช็ค</SelectItem>
                          <SelectItem value="OTHER">อื่น ๆ</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2 min-w-0">
                      <Label>วันที่ทำรายการ (cashbook)</Label>
                      <DatePickerThaiBE
                        className="h-11 w-full"
                        value={htmlDateValueToTimestampMs(payoutEntryDate)}
                        onChange={(ms) => setPayoutEntryDate(timestampToHtmlDateValue(ms))}
                      />
                    </div>
                    <div className="space-y-2 min-w-0">
                      <Label>ยอดตัดจากบัญชีธนาคาร (โอนสุทธิให้คู่ค้า)</Label>
                      <Input
                        readOnly
                        className="h-11 font-mono font-bold text-right bg-muted/50"
                        value={`฿ ${bankDebitAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                      />
                      {withholdingPreview && withholdingPreview.wht > 0.005 ? (
                        <div className="text-[11px] text-muted-foreground leading-snug space-y-1">
                          <p>
                            ยอดงวด (รวม VAT) ฿
                            {grossInclVatForBill.toLocaleString(undefined, { minimumFractionDigits: 2 })} — หัก ณ ที่จ่าย ฿
                            {withholdingPreview.wht.toLocaleString(undefined, { minimumFractionDigits: 2 })} (
                            {purchase?.supplierWithholdingRatePercent}%) ไม่ตัดจากบัญชีตอนโอน — สะสมที่{' '}
                            <Link href="/accounting/withholding-tax" className="font-semibold text-primary underline">
                              รายการหัก ณ ที่จ่าย
                            </Link>{' '}
                            เพื่อสรุปนำส่งสรรพากร
                          </p>
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          ไม่มีหัก ณ ที่จ่าย — ตัดบัญชีเท่ายอดงวด/ใบวางบิล
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row flex-wrap gap-3 pt-1">
                    <Button
                      className="bg-green-600 hover:bg-green-700 font-bold gap-2 sm:flex-1 min-h-11"
                      disabled={paying || !payoutBankId}
                      onClick={() => void markPaid()}
                    >
                      {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                      ยืนยันจ่ายเงิน + ลง cashbook
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="font-bold gap-2 border-primary/30 min-h-11 sm:flex-1"
                      disabled={!canPrintWithholdingSummary}
                      onClick={() => handlePrintWithholding()}
                      title={
                        canPrintWithholdingSummary
                          ? 'พิมพ์สรุปหัก ณ ที่จ่าย (ผู้รับเงิน)'
                          : 'เปิดใช้เมื่อ PO เปิดหัก ณ ที่จ่ายและมียอดหักจากงวดนี้'
                      }
                    >
                      <Printer className="h-4 w-4" />
                      สร้างใบหัก ณ ที่จ่าย (พิมพ์)
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {purchase && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">อ้างอิงใบสั่งซื้อ</CardTitle>
              <CardDescription className="space-y-1">
                <p>
                  ยอดสุทธิใบสั่งซื้อ ฿{' '}
                  {purchase.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                {bill.billAmount != null && bill.billAmount > 0 && (
                  <p className="font-semibold text-foreground">
                    ยอดในใบรับวางบิลนี้ ฿{' '}
                    {bill.billAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                )}
                {linkedMilestone && (
                  <p>
                    งวดชำระ #{linkedMilestone.sequence}: {linkedMilestone.label}
                  </p>
                )}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {bill.status === 'DRAFT' && okStore && (
          <Card className="border-amber-200/80 bg-amber-50/30 print:hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">การยืนยันงวดชำระ</CardTitle>
              <CardDescription>
                เมื่อกดส่งแผนกบัญชี ถือว่าได้ตรวจรับสินค้า/งานตามงวดที่ใบนี้อ้างอิงครบถ้วนแล้ว (ทั้งกรณีเงินสดและเครดิต)
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ข้อมูลใบรับวางบิล</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="space-y-2">
              <Label>วันที่รับวางบิล</Label>
              <DatePickerThaiBE
                className="h-11"
                value={htmlDateValueToTimestampMs(billingDate)}
                onChange={(ms) => setBillingDate(timestampToHtmlDateValue(ms))}
                disabled={readOnly}
              />
            </div>
            <div className="space-y-2">
              <Label>วันที่ตั้งใจจ่ายเงิน</Label>
              <DatePickerThaiBE
                className="h-11"
                value={htmlDateValueToTimestampMs(payDate)}
                onChange={(ms) => setPayDate(timestampToHtmlDateValue(ms))}
                disabled={readOnly}
              />
            </div>
            <div className="space-y-2">
              <Label>หมายเหตุ</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={readOnly}
                rows={3}
              />
            </div>

            {bill.status === 'DRAFT' && okStore && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="outline" onClick={() => void saveDraft()}>
                  บันทึกฉบับร่าง
                </Button>
                <Button className="font-bold gap-2" type="button" onClick={() => setSubmitConfirmOpen(true)}>
                  <Send className="h-4 w-4" /> ส่งแผนกบัญชี
                </Button>
              </div>
            )}

          </CardContent>
        </Card>

        <AlertDialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ส่งใบรับวางบิลให้ฝ่ายบัญชี?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">
                  ยืนยันว่าตรวจรับสินค้า/งานตามงวดนี้ถูกต้องแล้ว — หลังส่ง รายการจะไปอยู่ที่ «ตรวจสอบรายจ่าย» และเจ้าหนี้การค้า
                  (เครดิต)
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction onClick={() => void submitToAccounting()}>ยืนยันส่ง</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
