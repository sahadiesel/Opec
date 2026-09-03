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
  RefreshCw,
  Ban,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAppUser } from '@/hooks/use-app-user';
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
} from '@/lib/services/equipment-rental-contract-service';
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

export default function RentContractDetailPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const router = useRouter();
  const { currentUser, isLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
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

  const monthlyTotal = useMemo(
    () => Number(contract?.monthlyRentAmount) || 0,
    [contract?.monthlyRentAmount],
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
                  {contract.status === 'DRAFT' && (
                    <Button size="sm" className="h-8" disabled={busy} onClick={() => void handleActivate()}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                      เปิดใช้งาน + สร้างใบที่ครบกำหนด
                    </Button>
                  )}
                  {contract.status === 'ACTIVE' && (
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
                  {contract.status !== 'CANCELLED' && (
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

            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">รายการอุปกรณ์ / ค่าเช่ารายเดือน</CardTitle>
                <CardDescription className="text-xs">
                  รวมก่อน VAT ฿{monthlyTotal.toLocaleString()} · VAT {contract.vatRatePercent}%
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                <Table className="text-xs [&_th]:h-8 [&_td]:py-1.5">
                  <TableHeader>
                    <TableRow>
                      <TableHead>รายการ</TableHead>
                      <TableHead className="text-right">จำนวน</TableHead>
                      <TableHead>หน่วย</TableHead>
                      <TableHead className="text-right">ราคา/เดือน</TableHead>
                      <TableHead className="text-right">รวม</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(contract.lineItems || []).map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>{it.description}</TableCell>
                        <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                        <TableCell>{it.unit || '—'}</TableCell>
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
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4" /> ใบแจ้งหนี้ตามสัญญา
                </CardTitle>
                <CardDescription className="text-xs">
                  สร้างอัตโนมัติเมื่อถึงวันวางบิล · จากนั้นออกใบกำกับภาษี/ใบเสร็จที่เมนูบัญชีตามเดิม
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-4 pb-4">
                {canEdit && contract.status === 'ACTIVE' && (
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

            {contract.notes && (
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
