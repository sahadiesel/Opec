'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2, Send, Banknote } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useAppUser } from '@/hooks/use-app-user';
import { canMarkPurchaseVendorBillPaid, canView } from '@/lib/permissions';
import {
  Purchase,
  PurchaseVendorBill,
  PurchaseVendorBillStatus,
  User,
  Vendor,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';

function statusLabel(s: PurchaseVendorBillStatus) {
  if (s === 'DRAFT') return 'ฉบับร่าง';
  if (s === 'SUBMITTED') return 'รอจ่ายเงิน';
  return 'จ่ายแล้ว';
}

export default function StoreVendorBillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
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

  const [billingDate, setBillingDate] = useState('');
  const [payDate, setPayDate] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!bill) return;
    setBillingDate(bill.billingReceivedDate || '');
    setPayDate(bill.plannedPaymentDate || '');
    setNotes(bill.notes || '');
  }, [bill?.id]);

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
      status: 'SUBMITTED' as PurchaseVendorBillStatus,
      submittedToAccountingAt: now,
      updatedAt: now,
    });
    await setDoc(
      doc(firestore, 'accounts_payable', bill.id),
      {
        id: bill.id,
        vendorId: bill.vendorId,
        documentNo: bill.receiptNo,
        referenceId: bill.purchaseId,
        billDate: billingDate,
        dueDate: payDate,
        debitAmount: purchase.totalAmount,
        creditAmount: 0,
        outstandingAmount: purchase.totalAmount,
        status: 'OPEN',
        origin: 'STORE_VENDOR_BILL',
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    toast({ title: 'ส่งแผนกบัญชีแล้ว', description: 'รายการปรากฏในเจ้าหนี้การค้า' });
  };

  const markPaid = async () => {
    if (!firestore || !billRef || !bill || !purchase || bill.status !== 'SUBMITTED') {
      toast({ variant: 'destructive', title: 'บันทึกไม่ได้' });
      return;
    }
    if (!canPay) return;
    const now = Date.now();
    const total = purchase.totalAmount;
    await updateDocumentNonBlocking(billRef, {
      status: 'PAID' as PurchaseVendorBillStatus,
      paidAt: now,
      paidByUid: currentUser?.id,
      paidByName: currentUser?.displayName || currentUser?.email || '',
      updatedAt: now,
    });
    await setDoc(
      doc(firestore, 'accounts_payable', bill.id),
      {
        creditAmount: total,
        outstandingAmount: 0,
        status: 'PAID',
        updatedAt: now,
      },
      { merge: true }
    );
    toast({ title: 'บันทึกจ่ายแล้ว' });
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

        {purchase && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">อ้างอิงใบสั่งซื้อ</CardTitle>
              <CardDescription>
                ยอดสุทธิ ฿ {purchase.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
                <Button variant="outline" onClick={saveDraft}>
                  บันทึกฉบับร่าง
                </Button>
                <Button className="font-bold gap-2" onClick={submitToAccounting}>
                  <Send className="h-4 w-4" /> ส่งแผนกบัญชี
                </Button>
              </div>
            )}

            {bill.status === 'SUBMITTED' && canPay && (
              <Button className="bg-green-600 hover:bg-green-700 font-bold gap-2 w-fit" onClick={markPaid}>
                <Banknote className="h-4 w-4" /> บันทึกจ่ายเงินแล้ว
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
