'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Waves, Save, Loader2, Zap, Info, ChevronRight, Lock, UserMinus } from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { htmlDateValueToTimestampMs } from '@/lib/date-thai';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, getDoc, getDocs, query, where, writeBatch, increment, type Firestore } from 'firebase/firestore';
import {
  PurchaseOrder,
  Wave,
  Assignment,
  Worker,
  DailyTimesheet,
  RateConditionEventType,
  User,
  DailyTimesheetStatus,
  Position,
  POLine,
  PositionRate,
  WaveMonthTimesheetReview,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { TimesheetService } from '@/lib/services/timesheet-service';
import Link from 'next/link';
import { WAVE_TIMESHEET_DEPLOYMENT_STATUSES } from '@/lib/constants/timesheet-wave';
import {
  resolveContractDailyHoursForWaveBoard,
  assignmentReadyForWaveTimesheet,
  waveRoundMonthLabel,
} from '@/lib/constants/timesheet-ui';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { pickRosterLinePerWorker } from '@/lib/ops/assignment-roster';
import { formatThaiYearMonthLabel } from '@/lib/ops/timesheet-hub-po-month';

const EVENT_TYPE_OPTIONS: { label: string; value: RateConditionEventType }[] = [
  { label: 'วันทำงาน (Work)', value: 'work_day' },
  { label: 'วันเดินทาง (Travel)', value: 'travel_day' },
  { label: 'สแตนด์บาย (Standby)', value: 'standby_day' },
  { label: 'เตรียมส่งตัว (Mob)', value: 'mobilization_day' },
  { label: 'วันเดินทางกลับ (Demob)', value: 'demobilization_day' },
  { label: 'ลาหยุดไม่รับค่าจ้าง (Unpaid)', value: 'unpaid_leave' },
];

function isMonthReviewLocked(r: WaveMonthTimesheetReview | undefined | null): boolean {
  if (!r) return false;
  return (
    r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved'
  );
}

export type PoDailyBoardCardProps = {
  po: PurchaseOrder;
  waves: Wave[];
  targetDate: string;
  onBoardDateChange: (timestampMs: number) => void;
  currentUser: User;
  workers: Worker[] | undefined;
  positionLabel: (id?: string) => string;
  canEditTimesheets: boolean;
};

/**
 * กระดานลงเวลารายวันต่อ PO — รวมทุก wave ใต้ PO; แต่ละแถวบอกรหัส wave
 */
export function PoDailyBoardCard({
  po,
  waves,
  targetDate,
  onBoardDateChange,
  currentUser,
  workers,
  positionLabel,
  canEditTimesheets,
}: PoDailyBoardCardProps) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [rosterData, setRosterData] = useState<Record<string, Partial<DailyTimesheet>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [demobTarget, setDemobTarget] = useState<Assignment | null>(null);
  const [demobSubmitting, setDemobSubmitting] = useState(false);
  const [reviewByWaveId, setReviewByWaveId] = useState<Map<string, WaveMonthTimesheetReview | null>>(
    () => new Map(),
  );

  const monthYm = targetDate.slice(0, 7);
  const waveById = useMemo(() => new Map(waves.map((w) => [w.id, w])), [waves]);
  const waveIdSet = useMemo(() => new Set(waves.map((w) => w.id)), [waves]);

  useEffect(() => {
    if (!firestore || !/^\d{4}-\d{2}$/.test(monthYm) || waves.length === 0) {
      setReviewByWaveId(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const m = new Map<string, WaveMonthTimesheetReview | null>();
      await Promise.all(
        waves.map(async (w) => {
          const ref = doc(firestore, 'wave_month_timesheet_reviews', `${w.id}_${monthYm}`);
          const snap = await getDoc(ref);
          m.set(
            w.id,
            snap.exists() ? ({ id: snap.id, ...(snap.data() as object) } as WaveMonthTimesheetReview) : null,
          );
        }),
      );
      if (!cancelled) setReviewByWaveId(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, monthYm, waves]);

  const poLinesQuery = useMemoFirebase(
    () => (firestore && po.id ? collection(firestore, 'purchase_orders', po.id, 'po_lines') : null),
    [firestore, po.id],
  );
  const { data: poLines } = useCollection<POLine>(poLinesQuery as any);

  const contractRatesQuery = useMemoFirebase(
    () =>
      firestore && po.contractId ? collection(firestore, 'main_contracts', po.contractId, 'position_rates') : null,
    [firestore, po.contractId],
  );
  const { data: contractPositionRates } = useCollection<PositionRate>(contractRatesQuery as any);

  const defaultHoursByWave = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of waves) {
      m.set(
        w.id,
        resolveContractDailyHoursForWaveBoard(w, poLines ?? undefined, contractPositionRates ?? undefined),
      );
    }
    return m;
  }, [waves, poLines, contractPositionRates]);

  const mobsByPoQuery = useMemoFirebase(
    () => (firestore && po.id ? query(collection(firestore, 'mobilizations'), where('poId', '==', po.id)) : null),
    [firestore, po.id],
  );
  const { data: mobsForPo, isLoading: isAsgnLoading } = useCollection<Assignment>(mobsByPoQuery as any);

  const assignmentRows = useMemo(() => {
    if (!mobsForPo) return [] as Assignment[];
    const inScope = mobsForPo.filter(
      (a) => waveIdSet.has(a.waveId) && WAVE_TIMESHEET_DEPLOYMENT_STATUSES.includes(a.deploymentStatus as any),
    );
    const out: Assignment[] = [];
    for (const w of waves) {
      const raw = inScope.filter((a) => a.waveId === w.id);
      out.push(...pickRosterLinePerWorker(raw).filter((a) => assignmentReadyForWaveTimesheet(a)));
    }
    return out.sort((a, b) => {
      const wa = waveById.get(a.waveId)?.waveCode ?? '';
      const wb = waveById.get(b.waveId)?.waveCode ?? '';
      if (wa !== wb) return wa.localeCompare(wb, 'th');
      const wn = (id: string) => {
        const w = workers?.find((x) => x.id === id);
        return w ? `${w.firstName} ${w.lastName}` : id;
      };
      return wn(a.workerId).localeCompare(wn(b.workerId), 'th');
    });
  }, [mobsForPo, waveIdSet, waves, waveById, workers]);

  const anyMonthLocked = useMemo(() => {
    for (const w of waves) {
      if (isMonthReviewLocked(reviewByWaveId.get(w.id) ?? null)) return true;
    }
    return false;
  }, [reviewByWaveId, waves]);

  const loadRoster = useCallback(async () => {
    if (!firestore || !targetDate || assignmentRows.length === 0) {
      if (assignmentRows.length === 0) setRosterData({});
      return;
    }
    const existing: Record<string, DailyTimesheet> = {};
    for (const w of waves) {
      const q = query(
        collection(firestore, 'daily_timesheets'),
        where('waveId', '==', w.id),
        where('date', '==', targetDate),
      );
      const snap = await getDocs(q);
      snap.docs.forEach((d) => {
        const data = d.data() as DailyTimesheet;
        existing[data.assignmentId] = data;
      });
    }
    const next: Record<string, Partial<DailyTimesheet>> = {};
    for (const asgn of assignmentRows) {
      const dft = defaultHoursByWave.get(asgn.waveId) ?? 12;
      if (existing[asgn.id]) {
        const ex = existing[asgn.id];
        next[asgn.id] =
          ex.eventType === 'unpaid_leave' && (ex.normalHours ?? 0) !== 0 ? { ...ex, normalHours: 0 } : ex;
      } else {
        next[asgn.id] = {
          workerId: asgn.workerId,
          assignmentId: asgn.id,
          date: targetDate,
          eventType: 'work_day',
          normalHours: dft,
          ot15Hours: 0,
          status: 'DRAFT',
        };
      }
    }
    setRosterData(next);
  }, [firestore, targetDate, assignmentRows, waves, defaultHoursByWave]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const applyBulk = (field: keyof DailyTimesheet, value: unknown) => {
    if (anyMonthLocked) {
      toast({ variant: 'destructive', title: 'งวดนี้ปิดแล้ว', description: 'มี wave ใต้ PO นี้ถูกล็อกงวด / รออนุมัติ' });
      return;
    }
    if (!firestore) return;
    const updated = { ...rosterData };
    const service = new TimesheetService(firestore);
    for (const key of Object.keys(updated)) {
      const currentStatus = updated[key].status as DailyTimesheetStatus;
      if (service.canEdit(currentStatus)) {
        updated[key] = { ...updated[key], [field]: value };
      }
    }
    setRosterData(updated);
    toast({ title: 'Bulk apply', description: 'ใช้กับรายการที่ยังแก้ได้' });
  };

  const handleSaveDraft = async () => {
    if (anyMonthLocked) {
      toast({ variant: 'destructive', title: 'งวดนี้ปิดแล้ว', description: 'ไม่สามารถบันทึก — งวดถูกล็อก' });
      return;
    }
    if (!canEditTimesheets) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไข timesheet' });
      return;
    }
    if (!firestore || !currentUser) return;
    setIsSaving(true);
    try {
      const service = new TimesheetService(firestore);
      const poId = po.id;
      const payloads: Partial<DailyTimesheet>[] = [];

      for (const asgn of assignmentRows) {
        const ts = rosterData[asgn.id];
        if (!ts?.workerId) continue;
        if (ts.status && service.isFinalized(ts.status as DailyTimesheetStatus)) continue;

        const wv = waveById.get(asgn.waveId);
        if (!wv) continue;
        if (isMonthReviewLocked(reviewByWaveId.get(wv.id) ?? null)) continue;

        const worker = workers?.find((w) => w.id === asgn.workerId);
        const contractId = (asgn.contractId || po.contractId || '').trim();
        const poLineId = (asgn.poLineId || wv.poLineId || '').trim();
        const positionId = (asgn.positionId || '').trim();
        if (!contractId || !poLineId || !positionId) {
          toast({
            variant: 'destructive',
            title: 'บันทึกไม่ได้ — ข้อมูลไม่ครบ',
            description: 'contractId, poLineId, positionId — ตรวจ mobilization / PO',
          });
          setIsSaving(false);
          return;
        }

        const isUnpaid = ts.eventType === 'unpaid_leave';
        payloads.push({
          ...ts,
          normalHours: isUnpaid ? 0 : (ts.normalHours ?? 0),
          ot15Hours: 0,
          workerNameSnapshot: worker ? `${worker.firstName} ${worker.lastName}` : 'Unknown',
          waveId: wv.id,
          siteId: wv.id,
          purchaseOrderId: asgn.poId || poId,
          poLineId,
          contractId,
          customerId: wv.customerId || '',
          positionId,
          workMode: asgn.workMode ?? 'OFFSHORE',
          shiftType: 'DAY',
          status: 'DRAFT',
        });
      }

      if (payloads.length === 0) {
        toast({ title: 'ไม่มีการเปลี่ยน', description: 'รายการถูกล็อกหรือว่าง' });
        return;
      }

      const results = await service.bulkUpsertTimesheets(payloads, currentUser);
      toast({ title: 'บันทึกร่างสำเร็จ', description: `สร้าง ${results.created} · อัปเดต ${results.updated}` });
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsSaving(false);
    }
  };

  const demobilizeEndDate = useMemo(() => {
    if (!demobTarget) return targetDate;
    const start = demobTarget.startDate || '1970-01-01';
    return targetDate >= start ? targetDate : start;
  }, [demobTarget, targetDate]);

  const confirmDemobilize = async () => {
    if (!firestore || !currentUser?.id || !demobTarget) return;
    if (!canEditTimesheets) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์' });
      return;
    }
    const asgn = demobTarget;
    const endDate = demobilizeEndDate;
    setDemobSubmitting(true);
    try {
      const mobRef = doc(firestore, 'mobilizations', asgn.id);
      const batch = writeBatch(firestore);
      batch.update(mobRef, {
        deploymentStatus: 'DEMOBILIZED',
        mobilizationStatus: 'DEMOBILIZED',
        endDate,
        updatedAt: Date.now(),
        updatedBy: currentUser.id,
      });
      const wId = (asgn.waveId || '').trim();
      if (wId) {
        batch.update(doc(firestore, 'waves', wId), {
          assignedWorkers: increment(-1),
          updatedAt: Date.now(),
        });
      }
      await batch.commit();
      setDemobTarget(null);
      toast({ title: 'จบงวด (Demob) แล้ว', description: 'รายการนี้จะหยุดลงเวลาจาก wave นี้' });
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'อัปเดตไม่สำเร็จ', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDemobSubmitting(false);
    }
  };

  const demobWorkerName = demobTarget
    ? (() => {
        const w = workers?.find((x) => x.id === demobTarget.workerId);
        return w ? `${w.firstName} ${w.lastName}`.trim() : demobTarget.workerId;
      })()
    : '';

  return (
    <>
      <Card className="shadow-lg border-none overflow-hidden">
        <CardHeader className="bg-primary/95 text-primary-foreground border-b">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-lg flex flex-wrap items-center gap-2">
                <Waves className="h-5 w-5 shrink-0" />
                <span className="font-mono">{po.poCode}</span>
                <span className="opacity-80">· งวด {formatThaiYearMonthLabel(monthYm, 'th-TH')}</span>
                <span className="text-xs font-normal opacity-90">({monthYm})</span>
              </CardTitle>
              <CardDescription className="text-primary-foreground/80 text-sm mt-1">
                รวม {waves.length} wave: {waves.map((w) => `${w.waveCode} [${w.status}]`).join(' · ')} — รายเดียวต่อ row แสดง wave
              </CardDescription>
            </div>
            <Button variant="secondary" size="sm" className="shrink-0" asChild>
              <Link href={`/timesheets/wave-month?month=${encodeURIComponent(monthYm)}`}>
                สรุปลงเวลารายเดือน (ส่งตรวจ) →
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 space-y-4">
          {anyMonthLocked ? (
            <Alert className="rounded-none border-x-0 border-t-0">
              <AlertTitle>งวด {monthYm} ถูกล็อกใน wave บางตัวใต้ PO นี้</AlertTitle>
              <AlertDescription>
                มีรอบ wave ที่ entry_locked / รออนุมัติ / อนุมัติ — ราย wave นั้นแก้เวลาไม่ได้
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 p-4 bg-muted/20 rounded-none border-b border-dashed">
            <span className="text-xs font-black text-muted-foreground uppercase flex items-center gap-2 mr-2">
              <Zap className="h-4 w-4 text-amber-500" /> Quick apply (ทุก row ใต้ PO นี้)
            </span>
            <Button
              size="sm"
              variant="outline"
              className="bg-white border-primary/20"
              disabled={anyMonthLocked}
              onClick={() => applyBulk('eventType', 'work_day')}
            >
              1. Work day
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-white border-primary/20"
              disabled={anyMonthLocked}
              onClick={() => applyBulk('eventType', 'standby_day')}
            >
              2. Standby
            </Button>
            <div className="flex w-full min-w-0 flex-1 flex-col gap-3 border-t border-dashed border-muted-foreground/25 pt-3 sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap sm:items-end sm:justify-end sm:gap-3 sm:border-t-0 sm:pt-0 sm:pl-3 sm:border-l sm:border-muted-foreground/25">
              <div className="space-y-1.5 w-full min-w-[11rem] sm:w-auto shrink-0">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">วันที่</Label>
                <DatePickerThaiBE
                  className="h-11"
                  value={htmlDateValueToTimestampMs(targetDate)}
                  onChange={onBoardDateChange}
                />
              </div>
              <div className="flex flex-col items-stretch gap-1 sm:items-end sm:min-w-[7rem]">
                <Button
                  size="sm"
                  className="gap-1.5 bg-primary font-bold shadow-sm"
                  onClick={() => void handleSaveDraft()}
                  disabled={isSaving || !canEditTimesheets || anyMonthLocked}
                >
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  บันทึก
                </Button>
                <span className="text-[10px] text-muted-foreground">บันทึกทุก row ตาม wave ของราย</span>
              </div>
            </div>
          </div>

          {isAsgnLoading && (
            <div className="py-20 text-center animate-pulse">Loading Roster…</div>
          )}
          {!isAsgnLoading && assignmentRows.length > 0 ? (
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6 py-4 font-bold">พนักงาน (Worker)</TableHead>
                  <TableHead className="font-bold">Wave</TableHead>
                  <TableHead className="font-bold">ตำแหน่ง</TableHead>
                  <TableHead className="font-bold w-[220px]">ประเภทวัน</TableHead>
                  <TableHead className="font-bold text-center w-[110px]">ชั่วโมงปกติ</TableHead>
                  <TableHead className="font-bold">สถานะ</TableHead>
                  <TableHead className="w-[128px] text-center font-bold">จบงวด</TableHead>
                  <TableHead className="text-right pr-6">หมายเหตุ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignmentRows.map((asgn) => {
                  const wv = waveById.get(asgn.waveId);
                  const rowLocked = wv && isMonthReviewLocked(reviewByWaveId.get(wv.id) ?? null);
                  const dft = defaultHoursByWave.get(asgn.waveId) ?? 12;
                  const raw = rosterData[asgn.id];
                  const worker = workers?.find((x) => x.id === asgn.workerId);
                  const et = raw?.eventType ?? 'work_day';
                  const row = {
                    ...raw,
                    eventType: et,
                    normalHours: et === 'unpaid_leave' ? 0 : (raw?.normalHours ?? dft),
                    ot15Hours: raw?.ot15Hours ?? 0,
                    remark: raw?.remark ?? '',
                  };
                  const tsService = new TimesheetService(firestore!);
                  const isLocked = tsService.isFinalized(row.status as DailyTimesheetStatus);
                  const rowEditLocked = isLocked || rowLocked || anyMonthLocked;

                  return (
                    <TableRow key={asgn.id} className={rowEditLocked ? 'bg-slate-50 opacity-80' : 'hover:bg-muted/20'}>
                      <TableCell className="pl-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-sm text-primary">
                            {worker?.firstName} {worker?.lastName}
                          </span>
                          <span className="text-[9px] font-mono text-muted-foreground uppercase">
                            {worker?.workerCode || asgn.id.slice(0, 8)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs font-mono text-primary/90">
                        {wv?.waveCode ?? asgn.waveId}
                        <span className="ml-1 text-muted-foreground">({waveRoundMonthLabel(wv as Wave)})</span>
                      </TableCell>
                      <TableCell className="text-sm">{positionLabel(asgn.positionId)}</TableCell>
                      <TableCell>
                        <Select
                          disabled={rowEditLocked}
                          value={row.eventType}
                          onValueChange={(v: RateConditionEventType) => {
                            setRosterData((prev) => {
                              const cur = prev[asgn.id] ?? {
                                workerId: asgn.workerId,
                                assignmentId: asgn.id,
                                date: targetDate,
                                eventType: 'work_day' as RateConditionEventType,
                                normalHours: dft,
                                ot15Hours: 0,
                                status: 'DRAFT' as DailyTimesheetStatus,
                              };
                              let nextHours = cur.normalHours ?? dft;
                              if (v === 'unpaid_leave') nextHours = 0;
                              else if (cur.eventType === 'unpaid_leave') nextHours = dft;
                              return { ...prev, [asgn.id]: { ...cur, eventType: v, normalHours: nextHours } };
                            });
                          }}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EVENT_TYPE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          disabled={rowEditLocked || row.eventType === 'unpaid_leave'}
                          type="number"
                          className="h-9 text-center font-bold"
                          value={row.normalHours}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10) || 0;
                            setRosterData((p) => ({
                              ...p,
                              [asgn.id]: { ...(p[asgn.id] || {}), normalHours: v },
                            }));
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {rowEditLocked && <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />}
                          {raw?.status ? (
                            <Badge variant="outline" className="text-[9px] font-black uppercase">
                              {raw.status}
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">No Log</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-[10px] gap-1 border-amber-600/40"
                          disabled={!canEditTimesheets || demobSubmitting}
                          onClick={() => setDemobTarget(asgn)}
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                          จบงวด
                        </Button>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <Input
                          disabled={rowEditLocked}
                          className="h-8 text-[10px] text-right"
                          value={row.remark}
                          onChange={(e) =>
                            setRosterData((p) => ({ ...p, [asgn.id]: { ...p[asgn.id], remark: e.target.value } }))
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : !isAsgnLoading ? (
            <div className="px-4 py-6">
              <Alert>
                <AlertTitle>ยังไม่มีคนในตาราง</AlertTitle>
                <AlertDescription>
                  ไม่มอบหมาย / ยัง DRAFT / ยังไม่พร้อม (readiness) — ตรวจ Mobilization กับ wave นี้
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="bg-muted/20 border-t py-3 flex justify-between flex-wrap gap-2">
          <p className="text-xs text-muted-foreground">
            ชั่วโมงค่าเริ่มต้นจาก wave + PO/สัญญา
          </p>
          <Button variant="link" className="text-xs h-auto p-0" asChild>
            <Link href="/timesheets/wave-month">ศูนย์สรุปรอบเดือน (wave-month)</Link>
          </Button>
        </CardFooter>
      </Card>
      <AlertDialog
        open={demobTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDemobTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันจบงวด (Demobilize)</AlertDialogTitle>
            <AlertDialogDescription>
              สิ้นสุด {demobWorkerName} ใน {demobTarget ? waveById.get(demobTarget.waveId)?.waveCode : '—'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={demobSubmitting}>ยกเลิก</AlertDialogCancel>
            <Button
              type="button"
              className="bg-amber-700 text-white"
              disabled={demobSubmitting}
              onClick={() => void confirmDemobilize()}
            >
              {demobSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ยืนยัน'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
