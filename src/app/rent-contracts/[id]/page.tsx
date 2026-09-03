'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { doc } from 'firebase/firestore';
import {
  ArrowLeft,
  FileText,
  Loader2,
  Play,
  Printer,
  RefreshCw,
  Ban,
  Save,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  EquipmentRentalContractDetailsFields,
  EquipmentRentalLineItemsEditor,
  detailsDraftToInput,
  emptyEquipmentRentalDetailsDraft,
  emptyEquipmentRentalLineDraft,
  type EquipmentRentalDetailsDraft,
  type EquipmentRentalLineDraft,
} from '@/components/rent-contracts/equipment-rental-contract-form-fields';
import { useAppUser } from '@/hooks/use-app-user';
import {
  resolveOpecLessorFromCompanyProfile,
  useCompanyDocumentProfile,
} from '@/hooks/use-company-document-profile';
import { useToast } from '@/hooks/use-toast';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { canManageEquipmentRentalContracts } from '@/lib/permissions';
import type {
  CommercialInvoice,
  EquipmentRentalContract,
  EquipmentRentalContractStatus,
  User,
} from '@/lib/types';
import {
  activateEquipmentRentalContract,
  cancelEquipmentRentalContract,
  forceCreateEquipmentRentalInvoiceForMonth,
  generateDueEquipmentRentalInvoices,
  listEquipmentRentalInvoicesForContract,
  updateEquipmentRentalContract,
} from '@/lib/services/equipment-rental-contract-service';
import { buildEquipmentRentalContractPrintHtml } from '@/lib/documents/equipment-rental-contract-print';
import { openStandardPrintWindow } from '@/lib/documents/standard-document-print';
import { formatStoredDateRangeThaiBE, formatDateThaiBE } from '@/lib/date-thai';

function statusBadge(status: EquipmentRentalContractStatus) {
  const label: Record<EquipmentRentalContractStatus, string> = {
    DRAFT: 'ร่าง',
    ACTIVE: 'ใช้งาน',
    CANCELLED: 'ยกเลิก',
    EXPIRED: 'สิ้นสุด',
  };
  if (status === 'ACTIVE') return <Badge className="bg-emerald-600">{label[status]}</Badge>;
  if (status === 'CANCELLED') return <Badge variant="destructive">{label[status]}</Badge>;
  return <Badge variant="outline">{label[status]}</Badge>;
}

function contractToDetailsDraft(c: EquipmentRentalContract): EquipmentRentalDetailsDraft {
  const s = (v: unknown) => (v == null ? '' : String(v));
  return emptyEquipmentRentalDetailsDraft({
    madeAtTambon: s(c.madeAtTambon),
    madeAtAmphoe: s(c.madeAtAmphoe),
    madeAtProvince: s(c.madeAtProvince),
    contractDate: s(c.contractDate),
    lesseeAuthorizedSignatory: s(c.lesseeAuthorizedSignatory),
    lesseeCertificateDate: s(c.lesseeCertificateDate),
    customerAddressSnapshot: s(c.customerAddressSnapshot),
    customerTaxIdSnapshot: s(c.customerTaxIdSnapshot),
    lessorName: s(c.lessorName) || 'บริษัท โอเปค เอ็นจิเนียริ่ง แอนด์ แมนเนจเม้นท์ จำกัด',
    lessorAddress: s(c.lessorAddress),
    lessorTaxId: s(c.lessorTaxId),
    lessorAuthorizedSignatory: s(c.lessorAuthorizedSignatory),
    insuranceClass: s(c.insuranceClass),
    rentalDurationValue: s(c.rentalDurationValue),
    rentalDurationUnit: c.rentalDurationUnit === 'DAY' ? 'DAY' : 'MONTH',
    appendix1Pages: s(c.appendix1Pages),
    appendix2Pages: s(c.appendix2Pages),
    appendix3Pages: s(c.appendix3Pages),
    invoiceLeadWorkingDays: s(c.invoiceLeadWorkingDays ?? 7),
    bankName: s(c.bankName),
    bankBranch: s(c.bankBranch),
    bankAccountName: s(c.bankAccountName),
    bankAccountNumber: s(c.bankAccountNumber),
    interruptionThresholdDays: s(c.interruptionThresholdDays),
    storageReturnNoticeDays: s(c.storageReturnNoticeDays),
    maxEquipmentAgeYears: s(c.maxEquipmentAgeYears),
    deliveryLocation: s(c.deliveryLocation),
    deliveryDate: s(c.deliveryDate),
    deliveryNoticeWorkingDays: s(c.deliveryNoticeWorkingDays),
    replacementDeliveryDays: s(c.replacementDeliveryDays),
    repairCorrectionDays: s(c.repairCorrectionDays),
    replacementPenaltyPerDay: s(c.replacementPenaltyPerDay),
    maxReplacementDelayDays: s(c.maxReplacementDelayDays),
    relocationNoticeDays: s(c.relocationNoticeDays),
    performanceBondType: s(c.performanceBondType),
    performanceBondAmount: s(c.performanceBondAmount),
    performanceBondPercent: s(c.performanceBondPercent),
    performanceBondTopUpDays: s(c.performanceBondTopUpDays),
    lossReplacementDays: s(c.lossReplacementDays),
    alternateRentalWindowValue: s(c.alternateRentalWindowValue),
    alternateRentalWindowUnit: c.alternateRentalWindowUnit === 'MONTH' ? 'MONTH' : 'DAY',
    lateDeliveryPenaltyPerDay: s(c.lateDeliveryPenaltyPerDay),
    penaltyDebtPayDays: s(c.penaltyDebtPayDays ?? 15),
    equipmentReturnDays: s(c.equipmentReturnDays),
    addressChangeNoticeDays: s(c.addressChangeNoticeDays),
    witness1Name: s(c.witness1Name),
    witness2Name: s(c.witness2Name),
  });
}

function contractToLineDrafts(c: EquipmentRentalContract): EquipmentRentalLineDraft[] {
  const rows = c.lineItems || [];
  if (rows.length === 0) return [emptyEquipmentRentalLineDraft()];
  return rows.map((it) => ({
    description: it.description || '',
    brand: it.brand || '',
    serialNumber: it.serialNumber || '',
    size: it.size || '',
    horsepower: it.horsepower || '',
    quantity: String(it.quantity ?? 1),
    unitPrice: String(it.unitPrice ?? ''),
    unit: it.unit || 'คัน/เครื่อง',
    ratePeriod: it.ratePeriod === 'DAY' ? 'DAY' : 'MONTH',
  }));
}

export default function RentContractDetailPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const router = useRouter();
  const { currentUser, isLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { profile: companyProfile } = useCompanyDocumentProfile();
  const authorized = !!currentUser && canManageEquipmentRentalContracts(currentUser);
  const canEdit = authorized;

  const contractRef = useMemoFirebase(
    () => (firestore && authorized && id ? doc(firestore, 'equipment_rental_contracts', id) : null),
    [firestore, authorized, id],
  );
  const { data: contract, isLoading: loadingContract } = useDoc<EquipmentRentalContract>(
    contractRef as any,
  );

  const [invoices, setInvoices] = useState<Array<CommercialInvoice & { id: string }>>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forceMonth, setForceMonth] = useState('');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [billingDay, setBillingDay] = useState('1');
  const [vatPercent, setVatPercent] = useState('7');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EquipmentRentalLineDraft[]>([emptyEquipmentRentalLineDraft()]);
  const [details, setDetails] = useState(emptyEquipmentRentalDetailsDraft());

  const reloadInvoices = useCallback(async () => {
    if (!firestore || !id) return;
    setLoadingInvoices(true);
    try {
      const rows = await listEquipmentRentalInvoicesForContract(firestore, id);
      setInvoices(rows);
    } catch {
      setInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  }, [firestore, id]);

  useEffect(() => {
    void reloadInvoices();
  }, [reloadInvoices]);

  useEffect(() => {
    if (!contract?.startDate) return;
    setForceMonth(contract.startDate.slice(0, 7));
  }, [contract?.startDate]);

  useEffect(() => {
    if (!contract || editing) return;
    setTitle(contract.title || '');
    setStartDate(contract.startDate || '');
    setEndDate(contract.endDate || '');
    setBillingDay(String(contract.billingDayOfMonth || 1));
    setVatPercent(String(contract.vatRatePercent ?? 7));
    setNotes(contract.notes || '');
    setLines(contractToLineDrafts(contract));
    const lessor = resolveOpecLessorFromCompanyProfile(companyProfile);
    setDetails({
      ...contractToDetailsDraft(contract),
      lessorName: lessor.lessorName,
      lessorAddress: lessor.lessorAddress || contract.lessorAddress || '',
      lessorTaxId: lessor.lessorTaxId || contract.lessorTaxId || '',
      lessorAuthorizedSignatory:
        lessor.lessorAuthorizedSignatory || contract.lessorAuthorizedSignatory || '',
    });
  }, [contract, editing, companyProfile]);

  useEffect(() => {
    if (!editing) return;
    const lessor = resolveOpecLessorFromCompanyProfile(companyProfile);
    setDetails((prev) => ({
      ...prev,
      lessorName: lessor.lessorName,
      lessorAddress: lessor.lessorAddress,
      lessorTaxId: lessor.lessorTaxId,
      lessorAuthorizedSignatory: lessor.lessorAuthorizedSignatory || prev.lessorAuthorizedSignatory,
    }));
  }, [companyProfile, editing]);

  const monthlyTotal = useMemo(
    () => Number(contract?.monthlyRentAmount) || 0,
    [contract?.monthlyRentAmount],
  );

  const opecLessor = useMemo(
    () => resolveOpecLessorFromCompanyProfile(companyProfile),
    [companyProfile],
  );

  const handleActivate = async () => {
    if (!firestore || !currentUser || !id) return;
    setBusy(true);
    try {
      const { invoicesCreated } = await activateEquipmentRentalContract(
        firestore,
        currentUser as User,
        id,
      );
      toast({
        title: 'เปิดใช้งานสัญญาแล้ว',
        description:
          invoicesCreated > 0
            ? `สร้างใบแจ้งหนี้ที่ครบกำหนด ${invoicesCreated} ใบ`
            : 'ยังไม่มีเดือนที่ถึงวันวางบิล',
      });
      await reloadInvoices();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'เปิดใช้งานไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSyncDue = async () => {
    if (!firestore || !currentUser || !contract) return;
    setBusy(true);
    try {
      const n = await generateDueEquipmentRentalInvoices(
        firestore,
        currentUser as User,
        { ...contract, id },
      );
      toast({
        title: 'ซิงก์ใบแจ้งหนี้',
        description: n > 0 ? `สร้างใหม่ ${n} ใบ` : 'ไม่มีรอบที่ต้องสร้างเพิ่ม',
      });
      await reloadInvoices();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ซิงก์ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleForceMonth = async () => {
    if (!firestore || !currentUser || !id || !forceMonth) return;
    setBusy(true);
    try {
      const r = await forceCreateEquipmentRentalInvoiceForMonth(
        firestore,
        currentUser as User,
        id,
        forceMonth,
      );
      toast({
        title: r.created ? 'สร้างใบแจ้งหนี้แล้ว' : 'มีใบของเดือนนี้อยู่แล้ว',
        description: r.invoiceId,
      });
      await reloadInvoices();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'สร้างไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!firestore || !currentUser || !id) return;
    if (!window.confirm('ยืนยันยกเลิกสัญญานี้?')) return;
    setBusy(true);
    try {
      await cancelEquipmentRentalContract(firestore, currentUser as User, id);
      toast({ title: 'ยกเลิกสัญญาแล้ว' });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ยกเลิกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = async () => {
    if (!contract) return;
    const lessor = resolveOpecLessorFromCompanyProfile(companyProfile);
    const ok = await openStandardPrintWindow({
      windowTitle: `สัญญาเช่าเครื่องจักรกล-${contract.contractNo}`,
      suggestedFileName: `Equipment-Rental-${contract.contractNo}`,
      bodyInnerHtml: buildEquipmentRentalContractPrintHtml({
        ...contract,
        id,
        lessorName: lessor.lessorName || contract.lessorName,
        lessorAddress: lessor.lessorAddress || contract.lessorAddress,
        lessorTaxId: lessor.lessorTaxId || contract.lessorTaxId,
        lessorAuthorizedSignatory:
          lessor.lessorAuthorizedSignatory || contract.lessorAuthorizedSignatory,
        lessorIsIndividual: false,
      }),
      htmlLang: 'th',
    });
    if (!ok) toast({ variant: 'destructive', title: 'กรุณาอนุญาตป๊อปอัปเพื่อพิมพ์เอกสาร' });
  };

  const handleSave = async () => {
    if (!firestore || !currentUser || !id) return;
    setBusy(true);
    try {
      const lessor = resolveOpecLessorFromCompanyProfile(companyProfile);
      await updateEquipmentRentalContract(firestore, currentUser as User, id, {
        title,
        startDate,
        endDate,
        billingDayOfMonth: Number(billingDay) || 1,
        vatRatePercent: Number(vatPercent) || 0,
        notes,
        lineItems: lines.map((l) => ({
          description: l.description,
          brand: l.brand,
          serialNumber: l.serialNumber,
          size: l.size,
          horsepower: l.horsepower,
          quantity: Number(l.quantity) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          unit: l.unit,
          ratePeriod: l.ratePeriod,
        })),
        details: {
          ...detailsDraftToInput(details),
          lessorName: lessor.lessorName,
          lessorAddress: lessor.lessorAddress || null,
          lessorTaxId: lessor.lessorTaxId || null,
          lessorAuthorizedSignatory: lessor.lessorAuthorizedSignatory || null,
          lessorIsIndividual: false,
        },
      });
      setEditing(false);
      toast({ title: 'บันทึกสัญญาแล้ว' });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !currentUser) return null;
  if (!authorized) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="py-10 text-center text-muted-foreground text-sm">ไม่มีสิทธิ์เข้าถึง</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-4 max-w-5xl mx-auto text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => router.push('/rent-contracts')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> กลับ
          </Button>
        </div>

        {loadingContract || !contract ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold text-primary font-mono">{contract.contractNo}</h1>
                  {statusBadge(contract.status)}
                </div>
                <p className="font-semibold">{contract.title}</p>
                <p className="text-xs text-muted-foreground">
                  ลูกค้า: {contract.customerNameSnapshot} ·{' '}
                  {formatStoredDateRangeThaiBE(contract.startDate, contract.endDate)} · วางบิลวันที่{' '}
                  {contract.billingDayOfMonth} ของเดือน
                </p>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => void handlePrint()}>
                    <Printer className="h-3.5 w-3.5 mr-1" /> พิมพ์สัญญา
                  </Button>
                  {(contract.status === 'DRAFT' || contract.status === 'ACTIVE') && !editing && (
                    <Button size="sm" variant="secondary" className="h-8" disabled={busy} onClick={() => setEditing(true)}>
                      แก้ไขรายละเอียด
                    </Button>
                  )}
                  {editing && (
                    <>
                      <Button size="sm" className="h-8" disabled={busy} onClick={() => void handleSave()}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                        บันทึก
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={busy}
                        onClick={() => setEditing(false)}
                      >
                        ยกเลิกแก้ไข
                      </Button>
                    </>
                  )}
                  {contract.status === 'DRAFT' && !editing && (
                    <Button size="sm" className="h-8" disabled={busy} onClick={() => void handleActivate()}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                      เปิดใช้งาน + สร้างใบที่ครบกำหนด
                    </Button>
                  )}
                  {contract.status === 'ACTIVE' && !editing && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={busy}
                      onClick={() => void handleSyncDue()}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" /> ซิงก์ใบแจ้งหนี้ที่ครบกำหนด
                    </Button>
                  )}
                  {contract.status !== 'CANCELLED' && !editing && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-destructive"
                      disabled={busy}
                      onClick={() => void handleCancel()}
                    >
                      <Ban className="h-3.5 w-3.5 mr-1" /> ยกเลิก
                    </Button>
                  )}
                </div>
              )}
            </div>

            {editing ? (
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">แก้ไขสัญญาเช่าเครื่องจักรกล</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-4 pb-4">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">ชื่อสัญญา</Label>
                      <Input className="h-8 text-xs" value={title} onChange={(e) => setTitle(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">วันเริ่ม</Label>
                      <Input type="date" className="h-8 text-xs" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">วันสิ้นสุด</Label>
                      <Input type="date" className="h-8 text-xs" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">วันวางบิล</Label>
                      <Input className="h-8 text-xs" value={billingDay} onChange={(e) => setBillingDay(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">VAT %</Label>
                      <Input className="h-8 text-xs" value={vatPercent} onChange={(e) => setVatPercent(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">รายการเครื่องจักรกล</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setLines((prev) => [...prev, emptyEquipmentRentalLineDraft()])}
                      >
                        เพิ่มรายการ
                      </Button>
                    </div>
                    <EquipmentRentalLineItemsEditor lines={lines} onChange={setLines} />
                  </div>
                  <EquipmentRentalContractDetailsFields value={details} onChange={setDetails} />
                  <div className="space-y-1">
                    <Label className="text-xs">หมายเหตุ</Label>
                    <Textarea className="text-xs min-h-[72px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm">รายการเครื่องจักรกล / ค่าเช่า</CardTitle>
                    <CardDescription className="text-xs">
                      รวมก่อน VAT ฿{monthlyTotal.toLocaleString()} · VAT {contract.vatRatePercent}%
                      {contract.deliveryLocation ? ` · ส่งมอบที่ ${contract.deliveryLocation}` : ''}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="px-0 pb-0">
                    <Table className="text-xs [&_th]:h-8 [&_td]:py-1.5">
                      <TableHeader>
                        <TableRow>
                          <TableHead>ชนิด</TableHead>
                          <TableHead>ยี่ห้อ</TableHead>
                          <TableHead>หมายเลข</TableHead>
                          <TableHead className="text-right">จำนวน</TableHead>
                          <TableHead>หน่วย</TableHead>
                          <TableHead>ช่วงราคา</TableHead>
                          <TableHead className="text-right">ราคา/หน่วย</TableHead>
                          <TableHead className="text-right">ยอด/เดือน</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(contract.lineItems || []).map((it) => (
                          <TableRow key={it.id}>
                            <TableCell>
                              <div>{it.description}</div>
                              {(it.size || it.horsepower) && (
                                <div className="text-[10px] text-muted-foreground">
                                  {[it.size && `ขนาด ${it.size}`, it.horsepower && `${it.horsepower} แรงม้า`]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>{it.brand || '—'}</TableCell>
                            <TableCell className="font-mono text-[11px]">{it.serialNumber || '—'}</TableCell>
                            <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                            <TableCell>{it.unit || '—'}</TableCell>
                            <TableCell>{it.ratePeriod === 'DAY' ? 'วัน' : 'เดือน'}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              ฿{Number(it.unitPrice).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">
                              ฿{Number(it.amount).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm">เงื่อนไขตามแบบสัญญา</CardTitle>
                    <CardDescription className="text-xs">ช่องว่างข้อ ๓–๒๕ ที่กรอกไว้สำหรับพิมพ์เอกสาร</CardDescription>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-xs">
                    <div className="col-span-2 md:col-span-3 rounded border border-dashed bg-muted/20 px-3 py-2">
                      <div className="text-muted-foreground text-[10px]">ผู้ให้เช่า (จากระบบ)</div>
                      <div className="font-medium">{opecLessor.lessorName}</div>
                      <div className="text-muted-foreground whitespace-pre-wrap">
                        {opecLessor.lessorAddress || contract.lessorAddress || '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[10px]">ทำสัญญาที่</div>
                      <div>
                        {[contract.madeAtTambon, contract.madeAtAmphoe, contract.madeAtProvince]
                          .filter(Boolean)
                          .join(' / ') || '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[10px]">ระยะเวลาเช่า</div>
                      <div>
                        {contract.rentalDurationValue != null
                          ? `${contract.rentalDurationValue} ${contract.rentalDurationUnit === 'DAY' ? 'วัน' : 'เดือน'}`
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[10px]">ประกันภัยชั้น</div>
                      <div>{contract.insuranceClass || '—'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[10px]">บัญชีรับเงิน</div>
                      <div>
                        {contract.bankName
                          ? `${contract.bankName} ${contract.bankAccountNumber || ''}`.trim()
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[10px]">หลักประกัน</div>
                      <div>
                        {contract.performanceBondType || contract.performanceBondAmount != null
                          ? `${contract.performanceBondType || ''} ${
                              contract.performanceBondAmount != null
                                ? `฿${Number(contract.performanceBondAmount).toLocaleString()}`
                                : ''
                            }`.trim()
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[10px]">สถานที่ส่งมอบ</div>
                      <div>{contract.deliveryLocation || '—'}</div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4" /> ใบแจ้งหนี้ตามสัญญา
                </CardTitle>
                <CardDescription className="text-xs">
                  สร้างอัตโนมัติเมื่อถึงวันวางบิล · จากนั้นออกใบกำกับภาษี/ใบเสร็จที่เมนูบัญชีตามเดิม
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-4 pb-4">
                {canEdit && contract.status === 'ACTIVE' && !editing && (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">สร้างใบเดือน (YYYY-MM)</Label>
                      <Input
                        className="h-8 w-36 text-xs"
                        value={forceMonth}
                        onChange={(e) => setForceMonth(e.target.value)}
                        placeholder="2026-09"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8"
                      disabled={busy || !forceMonth}
                      onClick={() => void handleForceMonth()}
                    >
                      สร้างใบแจ้งหนี้เดือนนี้
                    </Button>
                  </div>
                )}

                {loadingInvoices ? (
                  <div className="py-8 flex justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <Table className="text-xs [&_th]:h-8 [&_td]:py-1.5">
                    <TableHeader>
                      <TableRow>
                        <TableHead>เดือน</TableHead>
                        <TableHead>เลขที่ใบ</TableHead>
                        <TableHead>วันออก</TableHead>
                        <TableHead className="text-right">ยอดรวม</TableHead>
                        <TableHead>สถานะ</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-mono">{inv.equipmentRentalPeriodMonth}</TableCell>
                          <TableCell className="font-mono text-[11px]">{inv.invoiceNo}</TableCell>
                          <TableCell>{formatDateThaiBE(inv.issueDate)}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            ฿{Number(inv.totalAmount).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">
                              {inv.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="link" size="sm" className="h-7 px-0 text-xs" asChild>
                              <Link href={`/draft-invoices/${inv.id}`}>เปิดใบแจ้งหนี้</Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {invoices.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground italic">
                            ยังไม่มีใบแจ้งหนี้ — เปิดใช้งานสัญญาหรือรอถึงวันวางบิล
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {!editing && contract.notes && (
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">หมายเหตุ</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 text-xs text-muted-foreground whitespace-pre-wrap">
                  {contract.notes}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
