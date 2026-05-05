'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import {
  collection,
  query,
  where,
  limit,
  orderBy,
  addDoc,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import type {
  EmployeeQuotaDocument,
  EmployeeQuotaDocumentLine,
  EmployeeQuotaSlot,
  Worker,
} from '@/lib/types';
import { resolveSellRateForQuotaPosition } from '@/lib/employee-demo/resolve-quota-position-sell-rate';
import { useToast } from '@/hooks/use-toast';
import { Loader2, UserPlus, Trash2, Users, Search } from 'lucide-react';

function jobModeLabel(mode: EmployeeQuotaDocument['quotaJobMode']): string {
  return mode === 'ONSHORE' ? 'Onshore' : 'Offshore';
}

function displayQuotaNo(d: Pick<EmployeeQuotaDocument, 'id' | 'quotaDocumentNo'>): string {
  return d.quotaDocumentNo?.trim() || d.id;
}

function workerName(w: Worker): string {
  const n = `${w.firstName ?? ''} ${w.lastName ?? ''}`.trim();
  return n || w.nickname || w.workerCode || w.id;
}

function billingUnitLabel(u: string): string {
  if (u === 'monthly') return 'เดือน';
  if (u === 'hourly') return 'ชั่วโมง';
  return 'วัน';
}

export default function EmployeeDemoBookByQuotaPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedQuotaId, setSelectedQuotaId] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLine, setPickerLine] = useState<EmployeeQuotaDocumentLine | null>(null);
  const [workerSearch, setWorkerSearch] = useState('');
  const [rateStatus, setRateStatus] = useState<
    'idle' | 'loading' | { sellRate: number; billingUnit: string; contractId: string } | 'missing'
  >('idle');
  const [addingWorkerId, setAddingWorkerId] = useState<string | null>(null);

  const quotaListQuery = useMemoFirebase(
    () =>
      firestore
        ? query(
            collection(firestore, 'employee_quota_documents'),
            orderBy('createdAt', 'desc'),
            limit(80),
          )
        : null,
    [firestore],
  );
  const { data: quotaDocs, isLoading: quotaLoading } =
    useCollection<EmployeeQuotaDocument>(quotaListQuery as any);

  const slotsForQuotaQuery = useMemoFirebase(
    () =>
      firestore && selectedQuotaId
        ? query(collection(firestore, 'employee_quota_slots'), where('quotaDocumentId', '==', selectedQuotaId))
        : null,
    [firestore, selectedQuotaId],
  );
  const { data: quotaSlots, isLoading: slotsLoading } = useCollection<EmployeeQuotaSlot>(
    slotsForQuotaQuery as any,
  );

  const allSlotsQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'employee_quota_slots'), limit(2000)) : null),
    [firestore],
  );
  const { data: allSlots } = useCollection<EmployeeQuotaSlot>(allSlotsQuery as any);

  const workersForPositionQuery = useMemoFirebase(() => {
    if (!firestore || !pickerOpen || !pickerLine) return null;
    return query(
      collection(firestore, 'workers'),
      where('currentPositionId', '==', pickerLine.positionId),
      limit(400),
    );
  }, [firestore, pickerOpen, pickerLine]);

  const { data: workersRaw, isLoading: workersLoading } = useCollection<Worker>(workersForPositionQuery as any);

  const quotaDoc = useMemo(
    () => quotaDocs?.find((q) => q.id === selectedQuotaId) ?? null,
    [quotaDocs, selectedQuotaId],
  );

  const slotsByPosition = useMemo(() => {
    const m = new Map<string, EmployeeQuotaSlot[]>();
    for (const s of quotaSlots ?? []) {
      const arr = m.get(s.positionId) ?? [];
      arr.push(s);
      m.set(s.positionId, arr);
    }
    return m;
  }, [quotaSlots]);

  const workerIdsBookedElsewhere = useMemo(() => {
    const set = new Set<string>();
    if (!selectedQuotaId) return set;
    for (const s of allSlots ?? []) {
      if (s.quotaDocumentId !== selectedQuotaId) set.add(s.workerId);
    }
    return set;
  }, [allSlots, selectedQuotaId]);

  const workerIdsBookedThisQuota = useMemo(() => {
    const set = new Set<string>();
    for (const s of quotaSlots ?? []) set.add(s.workerId);
    return set;
  }, [quotaSlots]);

  useEffect(() => {
    if (!pickerOpen || !pickerLine || !quotaDoc || !firestore) {
      setRateStatus('idle');
      return;
    }
    let cancelled = false;
    setRateStatus('loading');
    resolveSellRateForQuotaPosition(firestore, quotaDoc, pickerLine.positionId).then((r) => {
      if (cancelled) return;
      if (!r) setRateStatus('missing');
      else
        setRateStatus({
          sellRate: r.sellRate,
          billingUnit: r.billingUnit,
          contractId: r.contractId,
        });
    });
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, pickerLine, quotaDoc, firestore]);

  const openPicker = useCallback((line: EmployeeQuotaDocumentLine) => {
    setPickerLine(line);
    setWorkerSearch('');
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setPickerLine(null);
    setRateStatus('idle');
    setWorkerSearch('');
  }, []);

  const eligibleWorkers = useMemo(() => {
    if (!quotaDoc || !pickerLine || !workersRaw) return [];
    const qjm = quotaDoc.quotaJobMode;
    const term = workerSearch.trim().toLowerCase();
    return workersRaw.filter((w) => {
      if (w.workerStatus !== 'AVAILABLE') return false;
      if (w.jobMode !== qjm) return false;
      if (w.readinessStatus === 'BLOCKED') return false;
      if (w.complianceAlertLevel === 'blocked') return false;
      if (workerIdsBookedElsewhere.has(w.id)) return false;
      if (workerIdsBookedThisQuota.has(w.id)) return false;
      if (!term) return true;
      const hay = `${w.workerCode} ${w.firstName} ${w.lastName} ${w.nickname ?? ''}`.toLowerCase();
      return hay.includes(term);
    });
  }, [
    quotaDoc,
    pickerLine,
    workersRaw,
    workerIdsBookedElsewhere,
    workerIdsBookedThisQuota,
    workerSearch,
  ]);

  const handleAddWorker = async (w: Worker) => {
    if (!firestore || !currentUser || !quotaDoc || !pickerLine) return;
    if (rateStatus === 'loading') {
      toast({ title: 'รอสักครู่', description: 'กำลังดึงราคาจากสัญญา…' });
      return;
    }
    if (rateStatus === 'missing' || rateStatus === 'idle') {
      toast({
        variant: 'destructive',
        title: 'ยังไม่มีราคา',
        description: 'ไม่พบอัตราในสัญญาสำหรับตำแหน่งนี้ — ตรวจสอบ PO/สัญญาและ position_rates',
      });
      return;
    }

    const already = slotsByPosition.get(pickerLine.positionId)?.length ?? 0;
    if (already >= pickerLine.quantity) {
      toast({ variant: 'destructive', title: 'เต็มโควต้า', description: 'จำนวนคนครบตามเอกสารโควต้าแล้ว' });
      return;
    }

    setAddingWorkerId(w.id);
    try {
      const resolved = await resolveSellRateForQuotaPosition(firestore, quotaDoc, pickerLine.positionId);
      if (!resolved) {
        toast({
          variant: 'destructive',
          title: 'ไม่พบราคา',
          description: 'ไม่สามารถบันทึกการจองได้หากไม่มีอัตราในสัญญา',
        });
        return;
      }

      await addDoc(collection(firestore, 'employee_quota_slots'), {
        quotaDocumentId: quotaDoc.id,
        positionId: pickerLine.positionId,
        workerId: w.id,
        workerCode: w.workerCode,
        workerDisplayName: workerName(w),
        sellRateSnapshot: resolved.sellRate,
        billingUnitSnapshot: resolved.billingUnit,
        contractIdForRate: resolved.contractId,
        quotaJobModeSnapshot: quotaDoc.quotaJobMode,
        createdAt: Date.now(),
        createdByUserId: currentUser.id,
        createdByDisplayName: currentUser.displayName,
      });

      toast({ title: 'จองแล้ว', description: `${workerName(w)} · ${resolved.sellRate.toLocaleString('th-TH')} บาท/${billingUnitLabel(resolved.billingUnit)}` });
      closePicker();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'จองไม่สำเร็จ', description: msg });
    } finally {
      setAddingWorkerId(null);
    }
  };

  const handleRemoveSlot = async (slot: EmployeeQuotaSlot) => {
    if (!firestore) return;
    try {
      await deleteDoc(doc(firestore, 'employee_quota_slots', slot.id));
      toast({ title: 'นำออกแล้ว', description: slot.workerDisplayName });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ', description: msg });
    }
  };

  if (userLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-5xl space-y-8 p-1">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-primary">
            <Users className="h-7 w-7" />
            จองคนลงตามโควต้า
          </h1>
          <p className="text-sm text-muted-foreground">
            เลือกเอกสารโควต้า แล้วจัดจำนวนคนต่อตำแหน่ง — แสดงเฉพาะลูกจ้างว่าง ตำแหน่งตรง โหมด Onshore/Offshore ตรงกับเอกสาร และยังไม่ถูกจองในโควต้าอื่น
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">1. เลือกเอกสารโควต้า</CardTitle>
            <CardDescription>รายการจากระบบสร้างเอกสารโควต้า (เรียงใหม่สุดก่อน)</CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={selectedQuotaId || '__none__'}
              onValueChange={(v) => setSelectedQuotaId(v === '__none__' ? '' : v)}
              disabled={quotaLoading}
            >
              <SelectTrigger className="max-w-xl">
                <SelectValue placeholder={quotaLoading ? 'กำลังโหลด…' : '— เลือกเอกสาร —'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— เลือกเอกสาร —</SelectItem>
                {(quotaDocs ?? []).map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {displayQuotaNo(q)} · {q.customerName} · {jobModeLabel(q.quotaJobMode)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {!selectedQuotaId || !quotaDoc ? (
          <p className="text-sm text-muted-foreground">เลือกเอกสารโควต้าเพื่อแสดงรายการตำแหน่ง</p>
        ) : slotsLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            กำลังโหลดการจอง…
          </div>
        ) : (
          <div className="space-y-6">
            <Card className="border-muted">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {displayQuotaNo(quotaDoc)} — {quotaDoc.customerName}
                </CardTitle>
                <CardDescription>
                  ประเภทราคา: <Badge variant="secondary">{jobModeLabel(quotaDoc.quotaJobMode)}</Badge>
                </CardDescription>
              </CardHeader>
            </Card>

            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground">2. รายการตำแหน่งและการจอง</h2>
              {quotaDoc.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">เอกสารนี้ไม่มีบรรทัดโควต้า</p>
              ) : (
                quotaDoc.lines.map((line) => {
                  const booked = slotsByPosition.get(line.positionId) ?? [];
                  const full = booked.length >= line.quantity;
                  return (
                    <Card key={line.positionId}>
                      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-2">
                        <div>
                          <CardTitle className="text-base">{line.positionName}</CardTitle>
                          <CardDescription>
                            โควต้าเอกสาร {line.quantity} คน · จองแล้ว {booked.length} คน
                          </CardDescription>
                        </div>
                        <Button
                          size="sm"
                          className="gap-1"
                          disabled={full}
                          onClick={() => openPicker(line)}
                        >
                          <UserPlus className="h-4 w-4" />
                          เพิ่มคน
                        </Button>
                      </CardHeader>
                      <CardContent>
                        {booked.length === 0 ? (
                          <p className="text-sm text-muted-foreground">ยังไม่มีผู้ถูกจองในตำแหน่งนี้</p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>รหัส</TableHead>
                                <TableHead>ชื่อ</TableHead>
                                <TableHead className="text-right">ราคา (ขาย)</TableHead>
                                <TableHead>หน่วย</TableHead>
                                <TableHead className="w-[100px]" />
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {booked.map((slot) => (
                                <TableRow key={slot.id}>
                                  <TableCell className="font-mono text-xs">{slot.workerCode}</TableCell>
                                  <TableCell>{slot.workerDisplayName}</TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {slot.sellRateSnapshot.toLocaleString('th-TH')}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground text-sm">
                                    {billingUnitLabel(slot.billingUnitSnapshot)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-destructive hover:text-destructive"
                                      onClick={() => handleRemoveSlot(slot)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        )}

        <Dialog open={pickerOpen} onOpenChange={(o) => !o && closePicker()}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>เลือกลูกจ้าง — {pickerLine?.positionName}</DialogTitle>
              <DialogDescription>
                {rateStatus === 'loading' && 'กำลังดึงราคาจากสัญญา…'}
                {rateStatus === 'missing' && (
                  <span className="text-destructive">
                    ไม่พบอัตราขายในสัญญา (position_rates) สำหรับตำแหน่งนี้ — แก้ข้อมูลสัญญาก่อนจอง
                  </span>
                )}
                {typeof rateStatus === 'object' && rateStatus !== null && 'sellRate' in rateStatus && (
                  <span>
                    ราคาอ้างอิง:{' '}
                    <strong>{rateStatus.sellRate.toLocaleString('th-TH')} บาท</strong> /{' '}
                    {billingUnitLabel(rateStatus.billingUnit)} · สัญญา {rateStatus.contractId.slice(0, 8)}…
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5" />
                ค้นหาชื่อ / รหัส
              </Label>
              <Input value={workerSearch} onChange={(e) => setWorkerSearch(e.target.value)} placeholder="พิมพ์เพื่อกรอง…" />
            </div>

            <ScrollArea className="h-[320px] rounded-md border">
              {workersLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  โหลดรายชื่อ…
                </div>
              ) : eligibleWorkers.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  ไม่มีลูกจ้างที่ว่างและตรงเงื่อนไข (ตำแหน่งตรง · สถานะ AVAILABLE · โหมด {quotaDoc ? jobModeLabel(quotaDoc.quotaJobMode) : ''} ·
                  ไม่ถูกจองโควต้าอื่น)
                </p>
              ) : (
                <div className="divide-y">
                  {eligibleWorkers.map((w) => (
                    <div key={w.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{workerName(w)}</div>
                        <div className="text-xs text-muted-foreground font-mono">{w.workerCode}</div>
                      </div>
                      <Button
                        size="sm"
                        disabled={
                          addingWorkerId !== null ||
                          rateStatus === 'loading' ||
                          rateStatus === 'missing' ||
                          rateStatus === 'idle'
                        }
                        onClick={() => handleAddWorker(w)}
                      >
                        {addingWorkerId === w.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'เลือก'}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            <DialogFooter>
              <Button variant="outline" onClick={closePicker}>
                ปิด
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
