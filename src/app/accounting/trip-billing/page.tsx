'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  collection,
  query,
  where,
  limit,
} from 'firebase/firestore';
import {
  RefreshCw,
  Loader2,
  Users,
  FileText,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Label } from '@/components/ui/label';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { useToast } from '@/hooks/use-toast';
import { formatStoredDateThaiBE } from '@/lib/date-thai';
import type { PurchaseOrder, TripBillingBatch, User } from '@/lib/types';
import { billingModeLabel } from '@/lib/commercial/resolve-billing-mode';
import { syncTripBillingForPo, finalizeStandbyOnlyTripBatch, isStandbyOnlyClosedTripBatch } from '@/lib/services/trip-billing-service';
import { ensureCommercialDraftInvoiceForTripBatch } from '@/lib/services/commercial-invoice-service';
import {
  resolveTripMobDemobLocationChoice,
  type TripMobDemobLocationOption,
} from '@/lib/services/trip-mob-demob-billing';

function batchStatusBadge(status: TripBillingBatch['status']) {
  switch (status) {
    case 'ready':
      return <Badge className="bg-emerald-600">พร้อมวางบิล</Badge>;
    case 'approved':
      return <Badge className="bg-blue-600">อนุมัติแล้ว</Badge>;
    case 'invoiced':
      return <Badge variant="secondary">ออก invoice แล้ว</Badge>;
    case 'void':
      return <Badge variant="destructive">ยกเลิก</Badge>;
    case 'pending_manager':
      return <Badge variant="outline">รอผู้จัดการ</Badge>;
    default:
      return <Badge variant="outline">รอครบทุกคน (D1)</Badge>;
  }
}

export default function TripBillingPage() {
  const firestore = useFirestore();
  const { user: authUser } = useUser();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { toast } = useToast();
  const router = useRouter();

  const [selectedPoId, setSelectedPoId] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [localBatches, setLocalBatches] = useState<TripBillingBatch[]>([]);
  const [mobLocationDialog, setMobLocationDialog] = useState<{
    batch: TripBillingBatch;
    options: TripMobDemobLocationOption[];
    selectedKey: string;
  } | null>(null);
  const [sbOnlyDialog, setSbOnlyDialog] = useState<TripBillingBatch | null>(null);

  const canSee = currentUser && canView(currentUser, 'draft_invoices');

  const posQuery = useMemoFirebase(
    () =>
      firestore
        ? query(
            collection(firestore, 'purchase_orders'),
            where('status', 'in', ['pending', 'active']),
            limit(120),
          )
        : null,
    [firestore],
  );
  const { data: purchaseOrdersRaw } = useCollection<PurchaseOrder>(posQuery as any);
  const purchaseOrders = useMemo(() => {
    const rows = purchaseOrdersRaw ?? [];
    return [...rows].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [purchaseOrdersRaw]);

  const batchesQuery = useMemoFirebase(
    () =>
      firestore && selectedPoId
        ? query(collection(firestore, 'trip_billing_batches'), where('poId', '==', selectedPoId))
        : null,
    [firestore, selectedPoId],
  );
  const { data: batchesRaw, isLoading: batchesLoading } = useCollection<TripBillingBatch>(
    batchesQuery as any,
  );

  const batchesFromFirestore = useMemo(() => {
    const rows = batchesRaw ?? [];
    return [...rows].sort((a, b) => b.tripAnchorStartDate.localeCompare(a.tripAnchorStartDate));
  }, [batchesRaw]);

  const batches = localBatches.length > 0 ? localBatches : batchesFromFirestore;

  const selectedPo = purchaseOrders.find((p) => p.id === selectedPoId);

  const handleSync = useCallback(async () => {
    if (!firestore || !currentUser || !selectedPo) return;
    setSyncing(true);
    try {
      const res = await syncTripBillingForPo(firestore, selectedPo);
      const { loadTripBillingBatchesForPo } = await import('@/lib/services/mob-cycle-billing-sync');
      const fresh = await loadTripBillingBatchesForPo(firestore, selectedPo.id);
      setLocalBatches(fresh);
      toast({
        title: 'ซิงก์แล้ว',
        description: `${res.reviews} รอบคน · ${res.batches} ชุดวางบิล (${billingModeLabel('TRIP')})`,
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ซิงก์ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSyncing(false);
    }
  }, [firestore, currentUser, selectedPo, toast]);

  const handleFinalizeStandbyOnly = async (batch: TripBillingBatch) => {
    if (!firestore || !currentUser) return;
    setBusyId(`sb_${batch.id}`);
    try {
      const res = await finalizeStandbyOnlyTripBatch(firestore, batch.id, currentUser as User);
      toast({
        title: 'ปิดรอบ SB-only แล้ว',
        description: `สมาชิก ${res.closedMembers} คน · จบรอบ ${res.periodEnd} — กดสร้างใบวางบิลได้เลย`,
      });
      setSbOnlyDialog(null);
      const { loadTripBillingBatchesForPo } = await import('@/lib/services/mob-cycle-billing-sync');
      if (selectedPo) {
        setLocalBatches(await loadTripBillingBatchesForPo(firestore, selectedPo.id));
      } else {
        setLocalBatches([]);
      }
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'ปิดรอบ SB-only ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateInvoice = async (batch: TripBillingBatch) => {
    if (!firestore || !currentUser || !selectedPo?.contractId) {
      toast({
        variant: 'destructive',
        title: 'สร้าง invoice ไม่ได้',
        description: 'PO ไม่มีสัญญาหลัก — ตรวจ contractId ของ PO',
      });
      return;
    }
    setBusyId(`inv_${batch.id}`);
    try {
      if (await isStandbyOnlyClosedTripBatch(firestore, batch.memberMobCycleIds)) {
        await doCreateInvoice(batch, undefined);
        return;
      }
      const choice = await resolveTripMobDemobLocationChoice(
        firestore,
        selectedPo.contractId,
        batch.memberMobCycleIds,
      );
      if (choice.kind === 'error') {
        toast({ variant: 'destructive', title: 'สร้าง invoice ไม่ได้', description: choice.message });
        return;
      }
      if (choice.kind === 'prompt') {
        setMobLocationDialog({
          batch,
          options: choice.options,
          selectedKey: choice.options[0]?.key ?? '',
        });
        return;
      }
      await doCreateInvoice(
        batch,
        choice.kind === 'auto' ? choice.mobLocationKey : undefined,
      );
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'สร้าง invoice ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  const doCreateInvoice = async (batch: TripBillingBatch, tripMobDemobLocationKey?: string) => {
    if (!firestore || !currentUser) return;
    setBusyId(`inv_${batch.id}`);
    try {
      const res = await ensureCommercialDraftInvoiceForTripBatch(
        firestore,
        batch,
        currentUser as User,
        tripMobDemobLocationKey ? { tripMobDemobLocationKey } : undefined,
      );
      if (res.ok) {
        toast({ title: 'สร้าง invoice แล้ว', description: res.invoiceNo });
        router.push(`/draft-invoices/${res.id}`);
      } else {
        toast({ variant: 'destructive', title: 'สร้าง invoice ไม่ได้', description: res.reason });
      }
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'สร้าง invoice ไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  const confirmMobLocationAndCreate = async () => {
    if (!mobLocationDialog?.selectedKey) return;
    const { batch, selectedKey } = mobLocationDialog;
    setMobLocationDialog(null);
    await doCreateInvoice(batch, selectedKey);
  };

  if (userLoading || !authUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        กำลังโหลด…
      </div>
    );
  }

  if (!canSee) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="mx-auto max-w-lg py-20 text-center text-muted-foreground">
          ไม่มีสิทธิ์เข้าหน้านี้
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser as User} onLogout={() => {}}>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">ทำใบแจ้งหนี้แบบ Trip</h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              Thai Nippon / Offshore — จัดกลุ่มคนที่ mobilize พร้อมกัน (M1 วันเดียวกัน) → ออก invoice เดียวเมื่อทุกคน demob (D1)
              · รอบ standby อย่างเดียว (ไม่มี M1/D1) กด「ปิดรอบ SB-only」ได้
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/draft-invoices">
              <FileText className="mr-2 h-4 w-4" />
              ทำใบแจ้งหนี้แบบ Monthly
            </Link>
          </Button>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>โหมด Trip — ตั้งที่สัญญา/PO</AlertTitle>
          <AlertDescription>
            ตั้งที่{' '}
            <Link href="/main-contracts" className="font-medium text-primary underline">
              สัญญาหลัก (Main Contracts)
            </Link>
            {' '}หรือ{' '}
            <Link href="/purchase-orders" className="font-medium text-primary underline">
              Customer PO
            </Link>
            {' '}→ เลือก <strong>TRIP</strong> สำหรับ Thai Nippon offshore · Guangzhou ใช้ <strong>MONTHLY</strong>
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">เลือก PO</CardTitle>
            <CardDescription>ซิงก์ mobilization + timesheet → ชุดวางบิลอัตโนมัติ</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="min-w-[280px] flex-1">
              <Select value={selectedPoId || undefined} onValueChange={setSelectedPoId}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือก Purchase Order…" />
                </SelectTrigger>
                <SelectContent>
                  {purchaseOrders.map((po) => (
                    <SelectItem key={po.id} value={po.id}>
                      {po.poCode} — {po.projectName || po.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!selectedPoId || syncing}
              onClick={handleSync}
            >
              {syncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              ซิงก์ชุดวางบิล
            </Button>
          </CardContent>
        </Card>

        {selectedPoId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                ชุดวางบิล — {selectedPo?.poCode ?? selectedPoId}
              </CardTitle>
              <CardDescription>
                คนที่ M1 วันเดียวกันอยู่ชุดเดียวกัน (เช่น Naret + Sronnarin 2 คน, หรือกลุ่ม 4 คนในอนาคต)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {batchesLoading && batches.length === 0 ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  กำลังโหลด…
                </div>
              ) : batches.length === 0 ? (
                <p className="text-muted-foreground text-sm py-8 text-center">
                  ยังไม่มีชุดวางบิล — กด «ซิงก์ชุดวางบิล» หลังมี timesheet M1/D1 หรือ SB
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>M1 (เริ่มรอบ)</TableHead>
                      <TableHead>ช่วง</TableHead>
                      <TableHead>สมาชิก</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right">ดำเนินการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map((batch) => {
                      const names =
                        [...new Set(batch.memberWorkerNames ?? [])].filter(Boolean).join(', ') ||
                        `${new Set(batch.memberWorkerIds ?? []).size || batch.memberWorkerIds?.length || 0} คน`;
                      const periodLabel = batch.periodEnd
                        ? `${formatStoredDateThaiBE(batch.periodStart)} – ${formatStoredDateThaiBE(batch.periodEnd)}`
                        : `${formatStoredDateThaiBE(batch.periodStart)} – (ยังทำงาน)`;
                      const isBusy =
                        busyId === batch.id ||
                        busyId === `inv_${batch.id}` ||
                        busyId === `sb_${batch.id}`;

                      return (
                        <TableRow key={batch.id}>
                          <TableCell className="font-medium whitespace-nowrap">
                            {formatStoredDateThaiBE(batch.tripAnchorStartDate)}
                          </TableCell>
                          <TableCell className="text-sm">{periodLabel}</TableCell>
                          <TableCell>
                            <div className="text-sm">{names}</div>
                            <div className="text-xs text-muted-foreground">
                              {new Set(batch.memberWorkerIds ?? []).size || batch.memberMobCycleIds.length}{' '}
                              mob cycle
                            </div>
                          </TableCell>
                          <TableCell>{batchStatusBadge(batch.status)}</TableCell>
                          <TableCell className="text-right space-x-2 whitespace-nowrap">
                            {(batch.status === 'ready' || batch.status === 'approved') && (
                              <Button
                                size="sm"
                                variant="default"
                                disabled={isBusy}
                                onClick={() => handleCreateInvoice(batch)}
                              >
                                {isBusy ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <FileText className="mr-1 h-3.5 w-3.5" />
                                    สร้างใบวางบิล
                                  </>
                                )}
                              </Button>
                            )}
                            {batch.status === 'invoiced' && batch.sourceCommercialInvoiceId && (
                              <Button size="sm" variant="outline" asChild>
                                <Link href={`/draft-invoices/${batch.sourceCommercialInvoiceId}`}>
                                  เปิด Invoice
                                </Link>
                              </Button>
                            )}
                            {batch.status === 'draft' && (
                              <div className="inline-flex flex-col items-end gap-1.5">
                                <span className="inline-flex items-center text-xs text-muted-foreground">
                                  <Clock className="mr-1 h-3.5 w-3.5" />
                                  รอ D1 ครบทุกคน
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isBusy || busyId === `sb_${batch.id}`}
                                  onClick={() => setSbOnlyDialog(batch)}
                                >
                                  {busyId === `sb_${batch.id}` ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    'ปิดรอบ SB-only'
                                  )}
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog
        open={mobLocationDialog != null}
        onOpenChange={(open) => {
          if (!open) setMobLocationDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>เลือกจุด Mob/Demob สำหรับค่า MOB</AlertDialogTitle>
            <AlertDialogDescription>
              สัญญากำหนดให้คิดค่า Mob/Demob ไป-กลับต่อคนต่อ trip — เลือกจุดที่ตรงกับการเดินทางของชุดนี้
              (อัตราดึงจากตารางราคาสัญญา)
            </AlertDialogDescription>
          </AlertDialogHeader>
          {mobLocationDialog && (
            <div className="space-y-2 py-2">
              <Label htmlFor="trip-mob-location">จุด Mob/Demob</Label>
              <Select
                value={mobLocationDialog.selectedKey}
                onValueChange={(key) =>
                  setMobLocationDialog((prev) => (prev ? { ...prev, selectedKey: key } : null))
                }
              >
                <SelectTrigger id="trip-mob-location">
                  <SelectValue placeholder="เลือกจุด" />
                </SelectTrigger>
                <SelectContent>
                  {mobLocationDialog.options.map((opt) => (
                    <SelectItem key={opt.key} value={opt.key}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              disabled={!mobLocationDialog?.selectedKey || busyId != null}
              onClick={(e) => {
                e.preventDefault();
                void confirmMobLocationAndCreate();
              }}
            >
              สร้าง Invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={sbOnlyDialog != null}
        onOpenChange={(open) => {
          if (!open) setSbOnlyDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ปิดรอบวางบิลแบบ Standby only?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  ใช้เมื่อคนงานมา standby แต่ไม่ลงงาน (ไม่มี M1/D1) และต้องวางบิลค่า SB — เช่น
                  Ritrong วันที่ 29–30 มิ.ย. และ 1–3 ก.ค.
                </p>
                <p>
                  ระบบจะตั้งวันจบรอบ = วัน standby สุดท้ายของทุกคนในชุดนี้ แล้วอนุมัติพร้อมวางบิลอัตโนมัติ
                  — กด「สร้างใบวางบิล」ได้เลย (ไม่คิดค่า MOB ไป-กลับ)
                </p>
                {sbOnlyDialog ? (
                  <p className="font-medium text-foreground">
                    สมาชิก:{' '}
                    {[...new Set(sbOnlyDialog.memberWorkerNames ?? [])].filter(Boolean).join(', ') ||
                      '—'}
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              disabled={!sbOnlyDialog || busyId != null}
              onClick={(e) => {
                e.preventDefault();
                if (sbOnlyDialog) void handleFinalizeStandbyOnly(sbOnlyDialog);
              }}
            >
              ยืนยันปิดรอบ SB-only
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
