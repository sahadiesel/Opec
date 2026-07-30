'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, doc, orderBy, query, where } from 'firebase/firestore';
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Eye,
  FileSignature,
  History,
  Loader2,
  Pencil,
  Printer,
  Send,
  XCircle,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAppUser } from '@/hooks/use-app-user';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { canExecuteBankCashbookPayments } from '@/lib/permissions';
import { isAccountingManager, isAccountingOfficer, isSystemAdmin } from '@/lib/permission-core';
import type {
  BankAccount,
  RentalContract,
  RentalPayable,
  User,
  Vendor,
} from '@/lib/types';
import {
  approveRentalContract,
  cancelRentalContract,
  computeRentalMonthAmounts,
  defaultVatRateForLessor,
  generateDueRentalPayables,
  rejectRentalContract,
  resolveContractVatRatePercent,
  submitRentalContractForApproval,
  updateRentalContract,
} from '@/lib/services/rental-contract-service';
import { buildRentalContractPrintHtml } from '@/lib/documents/rental-contract-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import {
  RentalContractLogsTab,
  type RentalContractChangeLog,
} from './_components/rental-contract-logs-tab';
import { RentalPayablePayoutDialog } from './_components/rental-payable-payout-dialog';

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

  const [busy, setBusy] = useState(false);
  const [reasonMode, setReasonMode] = useState<'reject' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [payTarget, setPayTarget] = useState<RentalPayable | null>(null);

  useEffect(() => {
    if (!payTarget) return;
    const fresh = payables.find((p) => p.id === payTarget.id);
    if (fresh && fresh !== payTarget) setPayTarget(fresh);
  }, [payables, payTarget]);

  const logsQuery = useMemoFirebase(
    () =>
      firestore
        ? query(collection(firestore, 'rental_contracts', id, 'change_logs'), orderBy('eventAt', 'desc'))
        : null,
    [firestore, id],
  );
  const { data: changeLogs } = useCollection<RentalContractChangeLog>(logsQuery as never);

  const canApprove = !!currentUser && (isSystemAdmin(currentUser) || isAccountingManager(currentUser));
  const canPay = !!currentUser && canExecuteBankCashbookPayments(currentUser);
  const canEditHeader =
    !!currentUser &&
    !!contract &&
    !['CANCELLED', 'EXPIRED', 'PENDING_APPROVAL'].includes(contract.status) &&
    (isSystemAdmin(currentUser) ||
      isAccountingManager(currentUser) ||
      (isAccountingOfficer(currentUser) && (contract.status === 'DRAFT' || contract.status === 'REJECTED')));

  const bankQuery = useMemoFirebase(
    () => (firestore && canPay ? query(collection(firestore, 'bank_accounts'), where('status', '==', 'ACTIVE')) : null),
    [firestore, canPay],
  );
  const { data: banks } = useCollection<BankAccount>(bankQuery as never);
  const [editOpen, setEditOpen] = useState(false);
  const [vatManual, setVatManual] = useState(false);
  const [editForm, setEditForm] = useState({
    monthlyRent: '',
    vatRate: '0',
    whtRate: '5',
    paymentDay: '1',
    startDate: '',
    endDate: '',
    notes: '',
    madeAtLocation: '',
    contractDate: '',
    propertyAddress: '',
    propertyCategory: 'BUILDING' as 'HOUSE' | 'BUILDING' | 'FACTORY' | 'OTHER',
    vehicleBrand: '',
    vehiclePlateNo: '',
    leaseDurationMonths: '',
    advanceRentMonths: '0',
    securityDepositAmount: '0',
    rentedItemDescription: '',
  });

  const monthPreview = useMemo(() => {
    if (!contract) return null;
    return computeRentalMonthAmounts({
      monthlyRentAmount: contract.monthlyRentAmount,
      vatRatePercent: resolveContractVatRatePercent(contract),
      withholdingTaxRatePercent: contract.withholdingTaxRatePercent,
    });
  }, [contract]);

  const editPreview = useMemo(() => {
    const base = Number(editForm.monthlyRent) || 0;
    if (base <= 0) return null;
    return computeRentalMonthAmounts({
      monthlyRentAmount: base,
      vatRatePercent: Number(editForm.vatRate) || 0,
      withholdingTaxRatePercent: Number(editForm.whtRate) || 0,
    });
  }, [editForm.monthlyRent, editForm.vatRate, editForm.whtRate]);

  useEffect(() => {
    if (!firestore || !contract || contract.status !== 'ACTIVE' || syncAttempted.current) return;
    syncAttempted.current = true;
    void generateDueRentalPayables(firestore, contract).catch((error) => console.error(error));
  }, [firestore, contract]);

  const openEdit = () => {
    if (!contract) return;
    const vat = resolveContractVatRatePercent(contract);
    setVatManual(contract.vatSource === 'MANUAL');
    setEditForm({
      monthlyRent: String(contract.monthlyRentAmount ?? ''),
      vatRate: String(vat),
      whtRate: String(contract.withholdingTaxRatePercent ?? 0),
      paymentDay: String(contract.paymentDayOfMonth ?? 1),
      startDate: contract.startDate || '',
      endDate: contract.endDate || '',
      notes: contract.notes || '',
      madeAtLocation: contract.madeAtLocation || '',
      contractDate: contract.contractDate || '',
      propertyAddress: contract.propertyAddress || '',
      propertyCategory: contract.propertyCategory || 'BUILDING',
      vehicleBrand: contract.vehicleBrand || '',
      vehiclePlateNo: contract.vehiclePlateNo || '',
      leaseDurationMonths: contract.leaseDurationMonths != null ? String(contract.leaseDurationMonths) : '',
      advanceRentMonths: String(contract.advanceRentMonths ?? 0),
      securityDepositAmount: String(contract.securityDepositAmount ?? 0),
      rentedItemDescription: contract.rentedItemDescription || '',
    });
    setEditOpen(true);
  };

  useEffect(() => {
    if (!editOpen || vatManual) return;
    setEditForm((prev) => ({
      ...prev,
      vatRate: String(defaultVatRateForLessor(vendor)),
    }));
  }, [editOpen, vatManual, vendor]);

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

  const handleSaveEdit = async () => {
    if (!firestore || !currentUser || !contract) return;
    await act(async () => {
      const result = await updateRentalContract(firestore, currentUser as User, contract, {
        monthlyRentAmount: Number(editForm.monthlyRent),
        vatRatePercent: Number(editForm.vatRate) || 0,
        vatSource: vatManual ? 'MANUAL' : 'AUTO_BY_LESSOR',
        withholdingTaxRatePercent: Number(editForm.whtRate) || 0,
        paymentDayOfMonth: Number(editForm.paymentDay) || 1,
        startDate: editForm.startDate,
        endDate: editForm.endDate,
        notes: editForm.notes,
        madeAtLocation: editForm.madeAtLocation,
        contractDate: editForm.contractDate || undefined,
        propertyAddress: editForm.propertyAddress,
        propertyCategory: editForm.propertyCategory,
        vehicleBrand: editForm.vehicleBrand,
        vehiclePlateNo: editForm.vehiclePlateNo,
        leaseDurationMonths: editForm.leaseDurationMonths ? Number(editForm.leaseDurationMonths) : 0,
        advanceRentMonths: Number(editForm.advanceRentMonths) || 0,
        securityDepositAmount: Number(editForm.securityDepositAmount) || 0,
        rentedItemDescription: editForm.rentedItemDescription,
      });
      toast({
        title: 'บันทึกการแก้ไขแล้ว',
        description:
          result.pendingPayablesUpdated > 0
            ? `อัปเดตรอบรอจ่าย ${result.pendingPayablesUpdated} รายการ · บันทึกประวัติแล้ว`
            : 'บันทึกประวัติการแก้ไขแล้ว',
      });
      setEditOpen(false);
    }, 'แก้ไขสัญญาสำเร็จ');
  };

  if (isLoading || contractLoading || !currentUser) return null;
  if (!contract) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-10 text-center text-muted-foreground">ไม่พบสัญญาเช่า</div>
      </AppShell>
    );
  }

  const vatRate = resolveContractVatRatePercent(contract);
  const lessorFormLabel =
    vendor?.vendorLegalForm === 'NATURAL'
      ? 'บุคคลธรรมดา'
      : vendor?.vendorLegalForm === 'JURISTIC'
        ? 'นิติบุคคล'
        : null;

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
                {lessorFormLabel ? ` (${lessorFormLabel})` : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={contract.status === 'ACTIVE' ? 'default' : 'outline'}>{contract.status}</Badge>
            {canEditHeader ? (
              <Button variant="outline" className="gap-2" onClick={openEdit}>
                <Pencil className="h-4 w-4" /> แก้ไขสัญญา
              </Button>
            ) : null}
            <Button variant="outline" className="gap-2" onClick={() => void printContract()}>
              <Printer className="h-4 w-4" /> พิมพ์สัญญา
            </Button>
          </div>
        </div>

        <Tabs defaultValue="detail" className="space-y-4">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/50 p-1 md:w-fit">
            <TabsTrigger value="detail" className="gap-2 px-4 py-2">
              รายละเอียดและรอบจ่าย
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2 px-4 py-2">
              <History className="h-4 w-4" /> ประวัติการแก้ไข
              {(changeLogs?.length ?? 0) > 0 ? (
                <Badge variant="secondary" className="ml-1 tabular-nums">
                  {changeLogs!.length}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="detail" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
              <Card>
                <CardHeader><CardTitle>รายละเอียดสัญญา</CardTitle></CardHeader>
                <CardContent className="grid gap-5 sm:grid-cols-2">
                  <div><p className="text-xs text-muted-foreground">ผู้เช่า</p><p className="font-semibold">{contract.tenantName}</p></div>
                  <div>
                    <p className="text-xs text-muted-foreground">ผู้ให้เช่า</p>
                    <p className="font-semibold">{contract.lessorVendorName}</p>
                    {lessorFormLabel ? (
                      <p className="text-xs text-muted-foreground">{lessorFormLabel}</p>
                    ) : null}
                  </div>
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
                  <div>
                    <p className="text-xs text-muted-foreground">ค่าเช่าต่อเดือน (ก่อน VAT)</p>
                    <p className="text-xl font-bold">{money(contract.monthlyRentAmount)} บาท</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">ภาษีมูลค่าเพิ่ม (VAT)</p>
                    <p className="text-xl font-bold">
                      {vatRate}%
                      {monthPreview && vatRate > 0 ? (
                        <span className="ml-2 text-base font-semibold text-muted-foreground">
                          = {money(monthPreview.vatAmount)} บาท
                        </span>
                      ) : (
                        <span className="ml-2 text-sm font-normal text-muted-foreground">ไม่คิด VAT</span>
                      )}
                    </p>
                    {contract.vatSource === 'MANUAL' ? (
                      <p className="text-xs text-muted-foreground">กำหนดเอง</p>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">หัก ณ ที่จ่าย</p>
                    <p className="text-xl font-bold">
                      {contract.withholdingTaxRatePercent}%
                      {monthPreview && monthPreview.withholdingTaxAmount > 0 ? (
                        <span className="ml-2 text-base font-semibold text-muted-foreground">
                          = {money(monthPreview.withholdingTaxAmount)} บาท
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">คิดบนฐานก่อน VAT</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">สุทธิโอน/เดือน (ประมาณการ)</p>
                    <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
                      {money(monthPreview?.netPayableAmount ?? contract.monthlyRentAmount)} บาท
                    </p>
                    {monthPreview && vatRate > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        รวมในใบ {money(monthPreview.grossAmount)} − หัก ณ ที่จ่าย {money(monthPreview.withholdingTaxAmount)}
                      </p>
                    ) : null}
                  </div>
                  <div><p className="text-xs text-muted-foreground">ระยะเวลา</p><p>{contract.startDate} — {contract.endDate}</p></div>
                  <div><p className="text-xs text-muted-foreground">ครบกำหนดจ่าย</p><p>วันที่ {contract.paymentDayOfMonth} ของทุกเดือน</p></div>
                  {contract.notes ? <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">หมายเหตุ</p><p>{contract.notes}</p></div> : null}
                  {contract.lastEditedAt ? (
                    <div className="sm:col-span-2 text-xs text-muted-foreground">
                      แก้ไขล่าสุด: {new Date(contract.lastEditedAt).toLocaleString('th-TH')}
                      {contract.lastEditedByName ? ` โดย ${contract.lastEditedByName}` : ''}
                      {contract.revision ? ` · รอบที่ ${contract.revision}` : ''}
                    </div>
                  ) : null}
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
              <CardHeader>
                <CardTitle>แผนงวดชำระตามสัญญา</CardTitle>
                <CardDescription>
                  แต่ละเดือนมีหลักฐานการจ่าย · Cashbook · หัก ณ ที่จ่าย และเอกสารประกอบ (ใบเสร็จ) เหมือนใบวางบิล
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>เดือน</TableHead>
                        <TableHead>ครบกำหนด</TableHead>
                        <TableHead className="text-right">ยอด (รวม VAT)</TableHead>
                        <TableHead className="text-right">หัก ณ ที่จ่าย</TableHead>
                        <TableHead className="text-right">สุทธิโอน</TableHead>
                        <TableHead>สถานะ</TableHead>
                        <TableHead>Cashbook</TableHead>
                        <TableHead>หลักฐานจ่าย</TableHead>
                        <TableHead>หัก ณ ที่จ่าย</TableHead>
                        <TableHead className="text-right">ดำเนินการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payables.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono">{row.periodMonth}</TableCell>
                          <TableCell>{row.dueDate}</TableCell>
                          <TableCell className="text-right font-mono font-semibold tabular-nums">
                            ฿{money(row.grossAmount)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{money(row.withholdingTaxAmount)}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{money(row.netPayableAmount)}</TableCell>
                          <TableCell>
                            {row.status === 'PAID' ? (
                              <Badge className="bg-green-600">จ่ายแล้ว</Badge>
                            ) : row.status === 'VOID' ? (
                              <Badge variant="destructive">ยกเลิก</Badge>
                            ) : (
                              <Badge variant="outline">รอจ่าย</Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {row.cashbookEntryNo || '—'}
                          </TableCell>
                          <TableCell>
                            {row.paymentProofUrl ? (
                              <a
                                href={row.paymentProofUrl}
                                className="text-primary font-semibold underline text-xs"
                                target="_blank"
                                rel="noreferrer"
                              >
                                {row.paymentProofFileName || 'เปิดไฟล์'}
                              </a>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>
                            {row.whtCertificateDocumentId ? (
                              <Button type="button" variant="secondary" size="sm" className="h-8 gap-1.5 px-2.5" asChild>
                                <Link href={`/accounting/wht-certificates/${row.whtCertificateDocumentId}`}>
                                  <Eye className="h-3.5 w-3.5" />
                                  พรีวิว / พิมพ์
                                </Link>
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {canPay && row.status === 'PENDING' ? (
                              <Button size="sm" className="gap-2" onClick={() => setPayTarget(row)}>
                                <Banknote className="h-4 w-4" /> ทำจ่าย
                              </Button>
                            ) : row.status === 'PAID' || row.cashbookEntryId ? (
                              <Button size="sm" variant="outline" onClick={() => setPayTarget(row)}>
                                รายละเอียด
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                      {payables.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10} className="py-12 text-center text-muted-foreground">
                            {contract.status === 'ACTIVE' ? 'ยังไม่ถึงกำหนดสร้างรายการรายเดือน' : 'รายการจะเริ่มหลังสัญญาได้รับอนุมัติ'}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <RentalContractLogsTab changeLogs={changeLogs ?? null} />
          </TabsContent>
        </Tabs>
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

      <RentalPayablePayoutDialog
        open={!!payTarget}
        onOpenChange={(open) => !open && setPayTarget(null)}
        contract={contract}
        payable={payTarget}
        vendor={vendor ?? null}
        banks={banks ?? null}
        currentUser={currentUser as User}
        canPay={canPay}
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>แก้ไขสัญญา {contract.contractNo}</DialogTitle>
            <DialogDescription>
              ระบบจะเก็บค่าเดิมไว้ในประวัติการแก้ไข · หากเปลี่ยนยอด/VAT/หัก ณ ที่จ่าย จะอัปเดตรอบรอจ่ายที่ยังไม่จ่ายให้ตรง
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>ค่าเช่า/เดือน (ก่อน VAT)</Label>
              <Input
                type="number"
                value={editForm.monthlyRent}
                onChange={(e) => setEditForm((p) => ({ ...p, monthlyRent: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>VAT % {lessorFormLabel ? `(ผู้ให้เช่า: ${lessorFormLabel})` : ''}</Label>
              <Input
                type="number"
                value={editForm.vatRate}
                onChange={(e) => {
                  setVatManual(true);
                  setEditForm((p) => ({ ...p, vatRate: e.target.value }));
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                นิติบุคคลมัก 7% · บุคคลธรรมดา 0% · แก้ค่าแล้วถือว่ากำหนดเอง
              </p>
            </div>
            <div className="space-y-2">
              <Label>หัก ณ ที่จ่าย %</Label>
              <Input
                type="number"
                value={editForm.whtRate}
                onChange={(e) => setEditForm((p) => ({ ...p, whtRate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>วันครบกำหนดจ่าย (1–31)</Label>
              <Input
                type="number"
                value={editForm.paymentDay}
                onChange={(e) => setEditForm((p) => ({ ...p, paymentDay: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>วันเริ่มสัญญา</Label>
              <Input
                type="date"
                value={editForm.startDate}
                onChange={(e) => setEditForm((p) => ({ ...p, startDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>วันสิ้นสุดสัญญา</Label>
              <Input
                type="date"
                value={editForm.endDate}
                onChange={(e) => setEditForm((p) => ({ ...p, endDate: e.target.value }))}
              />
            </div>
            {contract.leaseKind === 'VEHICLE' ? (
              <>
                <div className="space-y-2">
                  <Label>ยี่ห้อรถ</Label>
                  <Input
                    value={editForm.vehicleBrand}
                    onChange={(e) => setEditForm((p) => ({ ...p, vehicleBrand: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>เลขทะเบียน</Label>
                  <Input
                    value={editForm.vehiclePlateNo}
                    onChange={(e) => setEditForm((p) => ({ ...p, vehiclePlateNo: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>ระยะเวลาเช่า (เดือน)</Label>
                  <Input
                    type="number"
                    value={editForm.leaseDurationMonths}
                    onChange={(e) => setEditForm((p) => ({ ...p, leaseDurationMonths: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>เงินประกัน</Label>
                  <Input
                    type="number"
                    value={editForm.securityDepositAmount}
                    onChange={(e) => setEditForm((p) => ({ ...p, securityDepositAmount: e.target.value }))}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2 sm:col-span-2">
                  <Label>ที่ตั้งทรัพย์สิน</Label>
                  <Input
                    value={editForm.propertyAddress}
                    onChange={(e) => setEditForm((p) => ({ ...p, propertyAddress: e.target.value }))}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>สิ่งที่เช่า</Label>
                  <Input
                    value={editForm.rentedItemDescription}
                    onChange={(e) => setEditForm((p) => ({ ...p, rentedItemDescription: e.target.value }))}
                  />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>ทำสัญญาที่</Label>
              <Input
                value={editForm.madeAtLocation}
                onChange={(e) => setEditForm((p) => ({ ...p, madeAtLocation: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>วันที่ทำสัญญา</Label>
              <Input
                type="date"
                value={editForm.contractDate}
                onChange={(e) => setEditForm((p) => ({ ...p, contractDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>หมายเหตุ</Label>
              <Textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
            {editPreview ? (
              <div className="sm:col-span-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                ประมาณการต่อเดือน: ก่อนภาษี {money(editPreview.baseRentAmount)} + VAT {money(editPreview.vatAmount)}
                {' = '}รวม {money(editPreview.grossAmount)} − หัก ณ ที่จ่าย {money(editPreview.withholdingTaxAmount)}
                {' → '}
                <span className="font-semibold">สุทธิโอน {money(editPreview.netPayableAmount)}</span>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>ยกเลิก</Button>
            <Button disabled={busy} onClick={() => void handleSaveEdit()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึกการแก้ไข'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
