'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, doc, query, where } from 'firebase/firestore';
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  FileSignature,
  Loader2,
  Printer,
  Send,
  XCircle,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAppUser } from '@/hooks/use-app-user';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { canExecuteBankCashbookPayments } from '@/lib/permissions';
import { isAccountingManager, isSystemAdmin } from '@/lib/permission-core';
import type {
  BankAccount,
  PaymentMethod,
  RentalContract,
  RentalPayable,
  User,
  Vendor,
} from '@/lib/types';
import {
  approveRentalContract,
  cancelRentalContract,
  generateDueRentalPayables,
  payRentalPayable,
  rejectRentalContract,
  submitRentalContractForApproval,
} from '@/lib/services/rental-contract-service';
import { buildRentalContractPrintHtml } from '@/lib/documents/rental-contract-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';

function money(value: number): string {
  return Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function RentalContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const syncAttempted = useRef(false);

  const contractRef = useMemoFirebase(() => (firestore ? doc(firestore, 'rental_contracts', id) : null), [firestore, id]);
  const { data: contract, isLoading: contractLoading } = useDoc<RentalContract>(contractRef as never);
  const vendorRef = useMemoFirebase(
    () => (firestore && contract ? doc(firestore, 'vendors', contract.lessorVendorId) : null),
    [firestore, contract?.lessorVendorId],
  );
  const { data: vendor } = useDoc<Vendor>(vendorRef as never);
  const payableQuery = useMemoFirebase(
    () =>
      firestore && contract
        ? query(collection(firestore, 'rental_payables'), where('contractId', '==', contract.id))
        : null,
    [firestore, contract?.id],
  );
  const { data: payableRows } = useCollection<RentalPayable>(payableQuery as never);
  const payables = useMemo(
    () => [...(payableRows ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [payableRows],
  );

  const canApprove = !!currentUser && (isSystemAdmin(currentUser) || isAccountingManager(currentUser));
  const canPay = !!currentUser && canExecuteBankCashbookPayments(currentUser);
  const bankQuery = useMemoFirebase(
    () => (firestore && canPay ? query(collection(firestore, 'bank_accounts'), where('status', '==', 'ACTIVE')) : null),
    [firestore, canPay],
  );
  const { data: banks } = useCollection<BankAccount>(bankQuery as never);

  const [busy, setBusy] = useState(false);
  const [reasonMode, setReasonMode] = useState<'reject' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [payTarget, setPayTarget] = useState<RentalPayable | null>(null);
  const [bankId, setBankId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('TRANSFER');
  const [entryDate, setEntryDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }));

  useEffect(() => {
    if (!firestore || !contract || contract.status !== 'ACTIVE' || syncAttempted.current) return;
    syncAttempted.current = true;
    void generateDueRentalPayables(firestore, contract).catch((error) => console.error(error));
  }, [firestore, contract]);

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: success });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'ดำเนินการไม่สำเร็จ',
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const printContract = async () => {
    if (!contract || !vendor) return;
    const ok = await openStandardPrintWindow({
      windowTitle: `Rental-Contract-${contract.contractNo}`,
      suggestedFileName: `Rental-Contract-${contract.contractNo}`,
      bodyInnerHtml: buildRentalContractPrintHtml(contract, vendor),
      htmlLang: 'th',
    });
    if (!ok) toast({ variant: 'destructive', title: 'กรุณาอนุญาตป๊อปอัปเพื่อพิมพ์เอกสาร' });
  };

  const handleReasonAction = async () => {
    if (!firestore || !currentUser || !contract || !reasonMode) return;
    await act(
      () =>
        reasonMode === 'reject'
          ? rejectRentalContract(firestore, currentUser as User, contract, reason)
          : cancelRentalContract(firestore, currentUser as User, contract, reason),
      reasonMode === 'reject' ? 'ส่งกลับแก้ไขแล้ว' : 'ยกเลิกสัญญาและหยุดรอบรายเดือนแล้ว',
    );
    setReasonMode(null);
    setReason('');
  };

  const handlePay = async () => {
    if (!firestore || !currentUser || !contract || !vendor || !payTarget) return;
    await act(async () => {
      const result = await payRentalPayable(firestore, currentUser as User, {
        contract,
        payable: payTarget,
        vendor,
        bankAccountId: bankId,
        paymentMethod,
        entryDate,
      });
      toast({
        title: 'บันทึกทำจ่ายแล้ว',
        description: `${result.cashbookEntryNo}${result.whtCertificateId ? ' · ออกหนังสือหัก ณ ที่จ่ายแล้ว' : ''}`,
      });
      setPayTarget(null);
    }, 'บันทึกทำจ่ายสำเร็จ');
  };

  if (isLoading || contractLoading || !currentUser) return null;
  if (!contract) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-10 text-center text-muted-foreground">ไม่พบสัญญาเช่า</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-[1400px] space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                router.push(
                  contract.leaseKind === 'VEHICLE'
                    ? '/accounting/contracts/lease/vehicle'
                    : '/accounting/contracts/lease/property',
                )
              }
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold">
                <FileSignature className="h-6 w-6" /> {contract.contractNo}
              </h1>
              <p className="text-sm text-muted-foreground">
                {contract.leaseKind === 'VEHICLE' ? 'สัญญาเช่ารถยนต์' : 'สัญญาเช่าบ้าน/อาคาร/โรงงาน'}
                {' · '}
                {contract.lessorVendorName}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={contract.status === 'ACTIVE' ? 'default' : 'outline'}>{contract.status}</Badge>
            <Button variant="outline" className="gap-2" onClick={() => void printContract()}>
              <Printer className="h-4 w-4" /> พิมพ์สัญญา
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <Card>
            <CardHeader><CardTitle>รายละเอียดสัญญา</CardTitle></CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <div><p className="text-xs text-muted-foreground">ผู้เช่า</p><p className="font-semibold">{contract.tenantName}</p></div>
              <div><p className="text-xs text-muted-foreground">ผู้ให้เช่า</p><p className="font-semibold">{contract.lessorVendorName}</p></div>
              {contract.madeAtLocation ? (
                <div><p className="text-xs text-muted-foreground">ทำสัญญาที่</p><p>{contract.madeAtLocation}</p></div>
              ) : null}
              {contract.contractDate ? (
                <div><p className="text-xs text-muted-foreground">วันที่ทำสัญญา</p><p>{contract.contractDate}</p></div>
              ) : null}
              {contract.leaseKind === 'VEHICLE' ? (
                <>
                  <div><p className="text-xs text-muted-foreground">ยี่ห้อรถยนต์</p><p className="font-semibold">{contract.vehicleBrand || '—'}</p></div>
                  <div><p className="text-xs text-muted-foreground">เลขทะเบียน</p><p className="font-semibold">{contract.vehiclePlateNo || '—'}</p></div>
                  {contract.leaseDurationMonths != null ? (
                    <div><p className="text-xs text-muted-foreground">ระยะเวลาเช่า</p><p>{contract.leaseDurationMonths} เดือน</p></div>
                  ) : null}
                  {contract.advanceRentMonths != null ? (
                    <div><p className="text-xs text-muted-foreground">ค่าเช่าล่วงหน้า</p><p>{contract.advanceRentMonths} เดือน</p></div>
                  ) : null}
                  {contract.securityDepositAmount != null ? (
                    <div><p className="text-xs text-muted-foreground">เงินประกัน</p><p>{money(contract.securityDepositAmount)} บาท</p></div>
                  ) : null}
                </>
              ) : (
                <>
                  {contract.propertyAddress ? (
                    <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">ที่ตั้งทรัพย์สิน</p><p>{contract.propertyAddress}</p></div>
                  ) : null}
                  <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">สิ่งที่เช่า</p><p>{contract.rentedItemDescription}</p></div>
                </>
              )}
              <div><p className="text-xs text-muted-foreground">ค่าเช่าต่อเดือน</p><p className="text-xl font-bold">{money(contract.monthlyRentAmount)} บาท</p></div>
              <div><p className="text-xs text-muted-foreground">หัก ณ ที่จ่าย</p><p className="text-xl font-bold">{contract.withholdingTaxRatePercent}%</p></div>
              <div><p className="text-xs text-muted-foreground">ระยะเวลา</p><p>{contract.startDate} — {contract.endDate}</p></div>
              <div><p className="text-xs text-muted-foreground">ครบกำหนดจ่าย</p><p>วันที่ {contract.paymentDayOfMonth} ของทุกเดือน</p></div>
              {contract.notes ? <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">หมายเหตุ</p><p>{contract.notes}</p></div> : null}
              {contract.rejectionReason ? <div className="sm:col-span-2 text-destructive">เหตุผลส่งกลับ: {contract.rejectionReason}</div> : null}
              {contract.cancellationReason ? <div className="sm:col-span-2 text-destructive">เหตุผลยกเลิก: {contract.cancellationReason}</div> : null}
            </CardContent>
          </Card>

          <Card className="h-fit bg-slate-950 text-white">
            <CardHeader><CardTitle className="text-base">การดำเนินการ</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(contract.status === 'DRAFT' || contract.status === 'REJECTED') ? (
                <Button
                  className="w-full gap-2"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => submitRentalContractForApproval(firestore!, currentUser as User, contract),
                      'ส่งขออนุมัติแล้ว',
                    )
                  }
                >
                  <Send className="h-4 w-4" /> ส่ง Manager/Admin อนุมัติ
                </Button>
              ) : null}
              {canApprove && contract.status === 'PENDING_APPROVAL' ? (
                <>
                  <Button
                    className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const count = await approveRentalContract(firestore!, currentUser as User, contract);
                        toast({ title: 'อนุมัติสัญญาแล้ว', description: `เปิดใช้งานและสร้างรายการถึงกำหนด ${count} รายการ` });
                      }, 'อนุมัติสัญญาแล้ว')
                    }
                  >
                    <CheckCircle2 className="h-4 w-4" /> อนุมัติและเปิดใช้งาน
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => setReasonMode('reject')}>ส่งกลับแก้ไข</Button>
                </>
              ) : null}
              {canApprove && !['CANCELLED', 'EXPIRED'].includes(contract.status) ? (
                <Button variant="ghost" className="w-full text-red-300 hover:text-red-200" onClick={() => setReasonMode('cancel')}>
                  <XCircle className="mr-2 h-4 w-4" /> ยกเลิกสัญญา
                </Button>
              ) : null}
              {contract.status === 'ACTIVE' ? (
                <Button
                  variant="outline"
                  className="w-full border-white/40 bg-white/10 text-white hover:bg-white/20"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const count = await generateDueRentalPayables(firestore!, contract);
                      toast({
                        title: 'ซิงก์รอบค่าเช่าแล้ว',
                        description: count > 0 ? `สร้างรายการใหม่ ${count} รายการ` : 'ไม่มีรายการใหม่ที่ครบกำหนด',
                      });
                    }, 'ซิงก์รอบค่าเช่าแล้ว')
                  }
                >
                  ซิงก์รายการถึงกำหนดตอนนี้
                </Button>
              ) : null}
              {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : null}
              {contract.status === 'ACTIVE' ? (
                <p className="text-xs text-white/70">ระบบสร้างรายการรอจ่ายอัตโนมัติเมื่อถึงวันที่กำหนดของแต่ละเดือน</p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>รอบค่าเช่า / รายการรอจ่าย</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เดือน</TableHead>
                    <TableHead>ครบกำหนด</TableHead>
                    <TableHead className="text-right">ค่าเช่า</TableHead>
                    <TableHead className="text-right">หัก ณ ที่จ่าย</TableHead>
                    <TableHead className="text-right">สุทธิจ่าย</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead>อ้างอิง</TableHead>
                    <TableHead className="text-right">ดำเนินการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payables.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono">{row.periodMonth}</TableCell>
                      <TableCell>{row.dueDate}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.grossAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.withholdingTaxAmount)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{money(row.netPayableAmount)}</TableCell>
                      <TableCell>
                        <Badge variant={row.status === 'PAID' ? 'default' : row.status === 'VOID' ? 'destructive' : 'outline'}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.cashbookEntryNo ? <div>Cashbook: {row.cashbookEntryNo}</div> : '—'}
                        {row.whtCertificateDocumentId ? (
                          <Link className="block text-primary underline" href={`/accounting/wht-certificates/${row.whtCertificateDocumentId}`}>
                            หนังสือหัก ณ ที่จ่าย
                          </Link>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {canPay && row.status === 'PENDING' ? (
                          <Button size="sm" className="gap-2" onClick={() => setPayTarget(row)}>
                            <Banknote className="h-4 w-4" /> ทำจ่าย
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  {payables.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                        {contract.status === 'ACTIVE' ? 'ยังไม่ถึงกำหนดสร้างรายการรายเดือน' : 'รายการจะเริ่มหลังสัญญาได้รับอนุมัติ'}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!reasonMode} onOpenChange={(open) => !open && setReasonMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reasonMode === 'reject' ? 'ส่งสัญญากลับแก้ไข' : 'ยกเลิกสัญญา'}</DialogTitle>
            <DialogDescription>
              {reasonMode === 'cancel' ? 'รายการรอจ่ายที่ยังไม่จ่ายจะถูกยกเลิก และระบบจะหยุดสร้างรายการใหม่' : 'ระบุสิ่งที่ต้องแก้ไข'}
            </DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ระบุเหตุผล…" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonMode(null)}>กลับ</Button>
            <Button variant={reasonMode === 'cancel' ? 'destructive' : 'default'} disabled={busy || !reason.trim()} onClick={() => void handleReasonAction()}>
              ยืนยัน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ทำจ่ายค่าเช่า {payTarget?.periodMonth}</DialogTitle>
            <DialogDescription>
              ตัดบัญชีสุทธิ {money(payTarget?.netPayableAmount ?? 0)} บาท
              {(payTarget?.withholdingTaxAmount ?? 0) > 0
                ? ` · ออกหนังสือหัก ณ ที่จ่ายค่าเช่า ${money(payTarget?.withholdingTaxAmount ?? 0)} บาท`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>บัญชีธนาคาร</Label>
              <Select value={bankId} onValueChange={setBankId}>
                <SelectTrigger><SelectValue placeholder="เลือกบัญชี ACTIVE" /></SelectTrigger>
                <SelectContent>
                  {(banks ?? []).filter((b) => String(b.accountType) !== 'PETTY_CASH').map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.bankName} · {b.accountName} [{b.accountCode}]</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>วันที่ทำรายการ</Label>
              <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>วิธีจ่าย</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TRANSFER">โอนเงิน</SelectItem>
                  <SelectItem value="CHEQUE">เช็ค</SelectItem>
                  <SelectItem value="CASH">เงินสด</SelectItem>
                  <SelectItem value="OTHER">อื่น ๆ</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>ยกเลิก</Button>
            <Button disabled={busy || !bankId || !entryDate} onClick={() => void handlePay()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยันทำจ่าย'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
