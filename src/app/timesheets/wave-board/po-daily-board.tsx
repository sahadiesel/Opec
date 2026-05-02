'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarDays, Save, Loader2, Zap, Lock, UserMinus } from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { htmlDateValueToTimestampMs, formatStoredDateRangeThaiBE } from '@/lib/date-thai';
import { parseISO, isWithinInterval } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  increment,
  type Firestore,
} from 'firebase/firestore';
import {
  PurchaseOrder,
  Wave,
  Assignment,
  Worker,
  DailyTimesheet,
  RateConditionEventType,
  User,
  DailyTimesheetStatus,
  POLine,
  PositionRate,
  WaveMonthTimesheetReview,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TimesheetService } from '@/lib/services/timesheet-service';
import Link from 'next/link';
import { WAVE_TIMESHEET_DEPLOYMENT_STATUSES } from '@/lib/constants/timesheet-wave';
import {
  resolveContractDailyHoursForAssignmentLine,
  assignmentReadyForWaveTimesheet,
} from '@/lib/constants/timesheet-ui';
import { poTimesheetScopeId, isPoTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
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
import { assignmentOverlapsYearMonth, formatThaiYearMonthLabel } from '@/lib/ops/timesheet-hub-po-month';

const EVENT_TYPE_OPTIONS: { label: string; value: RateConditionEventType }[] = [
  { label: 'วันทำงาน (Work)', value: 'work_day' },
  { label: 'วันเดินทาง (Travel)', value: 'travel_day' },
  { label: 'สแตนด์บาย (Standby)', value: 'standby_day' },
  { label: 'เตรียมส่งตัว (Mob)', value: 'mobilization_day' },
  { label: 'วันเดินทางกลับ (Demob)', value: 'demobilization_day' },
  { label: 'ไม่จ่ายค่าแรง (Unpaid)', value: 'unpaid_leave' },
];

/** คอลัมน์สถานะ — แสดงรหัสจากประเภทวันที่บันทึกแล้วเท่านั้น (ไม่แสดง DRAFT) */
function waveBoardStatusCode(
  persisted: boolean,
  eventType: RateConditionEventType | undefined,
): string {
  if (!persisted) return ' - ';
  const et = eventType ?? 'work_day';
  if (et === 'work_day') return 'W';
  if (et === 'standby_day') return 'SB';
  const rest: Partial<Record<RateConditionEventType, string>> = {
    travel_day: 'TV',
    mobilization_day: 'MO',
    demobilization_day: 'DE',
    unpaid_leave: 'NP',
  };
  return rest[et] ?? String(et).replace(/_/g, ' ').slice(0, 3).toUpperCase();
}

function isMonthReviewLocked(r: WaveMonthTimesheetReview | undefined | null): boolean {
  if (!r) return false;
  return (
    r.status === 'entry_locked' || r.status === 'pending_manager_review' || r.status === 'approved'
  );
}

/** วันที่ลงเวลา (yyyy-MM-dd) อยู่ในช่วง start–end ของมอบหมายหรือไม่ */
function assignmentCoversHtmlDate(a: Pick<Assignment, 'startDate' | 'endDate'>, htmlDate: string): boolean {
  const s = (a.startDate || '').slice(0, 10);
  const e = (a.endDate || a.startDate || '').slice(0, 10);
  const d = htmlDate.slice(0, 10);
  if (!s || !d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d >= s && d <= e;
}

export type PoDailyBoardScope =
  | { mode: 'single'; po: PurchaseOrder; waves: Wave[] }
  | { mode: 'bundle'; bundleKey: string; pos: PurchaseOrder[]; waves: Wave[] };

export type PoDailyBoardCardProps = {
  scope: PoDailyBoardScope;
  /** มีเมื่อเปิดจาก ?month= และวันที่เลือกยังอยู่ในเดือนนั้น — แสดงทุกคนที่ทับเดือน (ไม่ใช่แค่วันเดียว) */
  rosterFilterYm?: string | null;
  targetDate: string;
  onBoardDateChange: (timestampMs: number) => void;
  currentUser: User;
  workers: Worker[] | undefined;
  positionLabel: (id?: string) => string;
  canEditTimesheets: boolean;
};

/**
 * กระดานลงเวลารายวัน — แถวจาก mobilization ที่ช่วง start–end ครอบคลุมวันที่เลือก (readiness + deployment ตาม Wave Board)
 * โหมด bundle = ตารางเดียวรวมทุก PO ในชุด PO Active (ไม่แยกการ์ดต่อ PO)
 */
export function PoDailyBoardCard({
  scope,
  rosterFilterYm = null,
  targetDate,
  onBoardDateChange,
  currentUser,
  workers,
  positionLabel,
  canEditTimesheets,
}: PoDailyBoardCardProps) {
  const posList = useMemo(() => {
    if (scope.mode === 'single') return [scope.po];
    return scope.pos;
  }, [
    scope.mode,
    scope.mode === 'single' ? scope.po.id : scope.pos.map((p) => p.id).sort().join(','),
  ]);
  const isBundle = scope.mode === 'bundle';
  const bundleKey = isBundle ? scope.bundleKey : null;
  const waves = scope.waves;
  const canonicalPo = posList[0];
  const poIds = useMemo(() => posList.map((p) => p.id).filter(Boolean), [posList]);
  const poIdsKey = poIds.join('|');
  const poById = useMemo(() => new Map(posList.map((p) => [p.id, p])), [posList]);
  const firestore = useFirestore();
  const { toast } = useToast();
  const [rosterData, setRosterData] = useState<Record<string, Partial<DailyTimesheet>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [demobTarget, setDemobTarget] = useState<Assignment | null>(null);
  const [demobSubmitting, setDemobSubmitting] = useState(false);
  const [reviewByWaveId, setReviewByWaveId] = useState<Map<string, WaveMonthTimesheetReview | null>>(
    () => new Map(),
  );
  /** assignment ที่มีเอกสาร daily_timesheets จริงในวันที่เลือก (ไม่ใช่แค่ placeholder บนจอ) */
  const [persistedAssignmentIds, setPersistedAssignmentIds] = useState<Set<string>>(() => new Set());

  const monthYm = targetDate.slice(0, 7);
  const waveById = useMemo(() => new Map(waves.map((w) => [w.id, w])), [waves]);

  const poMonthHref = useMemo(() => {
    if (isBundle && bundleKey) {
      return `/timesheets/po-month?month=${encodeURIComponent(monthYm)}&poActiveBundleId=${encodeURIComponent(bundleKey)}`;
    }
    return `/timesheets/po-month?month=${encodeURIComponent(monthYm)}&highlightPo=${encodeURIComponent(canonicalPo.id)}`;
  }, [isBundle, bundleKey, monthYm, canonicalPo.id]);

  useEffect(() => {
    if (!firestore || !/^\d{4}-\d{2}$/.test(monthYm)) {
      setReviewByWaveId(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const m = new Map<string, WaveMonthTimesheetReview | null>();
      const scopeIds = [...new Set(poIds.map((pid) => poTimesheetScopeId(pid)))];
      await Promise.all([
        ...scopeIds.map(async (sid) => {
          const scopeRef = doc(firestore, 'wave_month_timesheet_reviews', `${sid}_${monthYm}`);
          const scopeSnap = await getDoc(scopeRef);
          m.set(
            sid,
            scopeSnap.exists()
              ? ({ id: scopeSnap.id, ...(scopeSnap.data() as object) } as WaveMonthTimesheetReview)
              : null,
          );
        }),
        ...waves.map(async (w) => {
          const ref = doc(firestore, 'wave_month_timesheet_reviews', `${w.id}_${monthYm}`);
          const snap = await getDoc(ref);
          m.set(w.id, snap.exists() ? ({ id: snap.id, ...(snap.data() as object) } as WaveMonthTimesheetReview) : null);
        }),
      ]);
      if (!cancelled) setReviewByWaveId(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, monthYm, waves, poIdsKey]);

  const poLinesGroupQuery = useMemoFirebase(
    () => (firestore && poIds.length ? collectionGroup(firestore, 'po_lines') : null),
    [firestore, poIds.length],
  );
  const { data: allPoLines } = useCollection<POLine>(poLinesGroupQuery as any);
  const bundlePoLines = useMemo(() => {
    const set = new Set(poIds);
    return (allPoLines ?? []).filter((l) => set.has(l.poId));
  }, [allPoLines, poIds]);

  const contractIds = useMemo(
    () => [...new Set(posList.map((p) => (p.contractId || '').trim()).filter(Boolean))],
    [posList],
  );
  const contractIdsKey = contractIds.join('|');

  const [ratesByContractId, setRatesByContractId] = useState<Map<string, PositionRate[]>>(() => new Map());

  useEffect(() => {
    if (!firestore || contractIds.length === 0) {
      setRatesByContractId(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const m = new Map<string, PositionRate[]>();
      await Promise.all(
        contractIds.map(async (cid) => {
          const snap = await getDocs(collection(firestore, 'main_contracts', cid, 'position_rates'));
          m.set(
            cid,
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as PositionRate)),
          );
        }),
      );
      if (!cancelled) setRatesByContractId(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, contractIdsKey]);

  const mobsQuery = useMemoFirebase(() => {
    if (!firestore || !poIds.length) return null;
    if (poIds.length === 1) return query(collection(firestore, 'mobilizations'), where('poId', '==', poIds[0]));
    return query(collection(firestore, 'mobilizations'), where('poId', 'in', poIds.slice(0, 30)));
  }, [firestore, poIdsKey]);

  const { data: mobsForPo, isLoading: isAsgnLoading } = useCollection<Assignment>(mobsQuery as any);

  const assignmentRows = useMemo(() => {
    if (!mobsForPo) return [] as Assignment[];
    let target: Date | null = null;
    if (!rosterFilterYm || !/^\d{4}-\d{2}$/.test(rosterFilterYm)) {
      try {
        target = parseISO(targetDate);
        if (Number.isNaN(target.getTime())) return [];
      } catch {
        return [];
      }
    }
    const inScope = mobsForPo.filter((a) => {
      if (!WAVE_TIMESHEET_DEPLOYMENT_STATUSES.includes(a.deploymentStatus as any)) return false;
      if (!assignmentReadyForWaveTimesheet(a)) return false;
      if (rosterFilterYm && /^\d{4}-\d{2}$/.test(rosterFilterYm)) {
        return assignmentOverlapsYearMonth(a, rosterFilterYm);
      }
      try {
        const start = parseISO(a.startDate);
        const end = parseISO(a.endDate);
        return target != null && isWithinInterval(target, { start, end });
      } catch {
        return false;
      }
    });
    const roster = pickRosterLinePerWorker(inScope).filter((a) => assignmentReadyForWaveTimesheet(a));
    return roster.sort((a, b) => {
      const wn = (id: string) => {
        const w = workers?.find((x) => x.id === id);
        return w ? `${w.firstName} ${w.lastName}` : id;
      };
      return wn(a.workerId).localeCompare(wn(b.workerId), 'th');
    });
  }, [mobsForPo, targetDate, workers, rosterFilterYm]);

  const defaultHoursByAssignmentId = useMemo(() => {
    const m = new Map<string, number>();
    for (const asgn of assignmentRows) {
      const poRow = poById.get(asgn.poId);
      const cid = (asgn.contractId || poRow?.contractId || '').trim();
      const lines = bundlePoLines.filter((l) => l.poId === asgn.poId);
      const rates = ratesByContractId.get(cid);
      m.set(asgn.id, resolveContractDailyHoursForAssignmentLine(asgn.poLineId, lines, rates));
    }
    return m;
  }, [assignmentRows, bundlePoLines, ratesByContractId, poById]);

  const anyMonthLocked = useMemo(() => {
    for (const pid of poIds) {
      if (isMonthReviewLocked(reviewByWaveId.get(poTimesheetScopeId(pid)) ?? null)) return true;
    }
    for (const w of waves) {
      if (isMonthReviewLocked(reviewByWaveId.get(w.id) ?? null)) return true;
    }
    return false;
  }, [reviewByWaveId, waves, poIds]);

  const loadRoster = useCallback(async () => {
    if (!firestore || !targetDate || assignmentRows.length === 0) {
      if (assignmentRows.length === 0) setRosterData({});
      return;
    }
    const existing: Record<string, DailyTimesheet> = {};
    await Promise.all(
      poIds.map(async (pid) => {
        const q = query(
          collection(firestore, 'daily_timesheets'),
          where('purchaseOrderId', '==', pid),
          where('date', '==', targetDate),
        );
        const snap = await getDocs(q);
        snap.docs.forEach((d) => {
          const data = d.data() as DailyTimesheet;
          existing[data.assignmentId] = data;
        });
      }),
    );
    const next: Record<string, Partial<DailyTimesheet>> = {};
    const persisted = new Set<string>();
    for (const asgn of assignmentRows) {
      const dft = defaultHoursByAssignmentId.get(asgn.id) ?? 12;
      if (existing[asgn.id]) {
        persisted.add(asgn.id);
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
    setPersistedAssignmentIds(persisted);
    setRosterData(next);
  }, [firestore, targetDate, assignmentRows, poIds, defaultHoursByAssignmentId]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const applyBulk = (field: keyof DailyTimesheet, value: unknown) => {
    if (anyMonthLocked) {
      toast({
        variant: 'destructive',
        title: 'งวดนี้ปิดแล้ว',
        description: 'งวด PO หรือ wave (ข้อมูลเก่า) ถูกล็อก / รออนุมัติ',
      });
      return;
    }
    if (!firestore) return;
    const updated = { ...rosterData };
    const service = new TimesheetService(firestore);
    for (const key of Object.keys(updated)) {
      const asgn = assignmentRows.find((x) => x.id === key);
      if (!asgn || !assignmentCoversHtmlDate(asgn, targetDate)) continue;
      const currentStatus = updated[key].status as DailyTimesheetStatus;
      if (service.canEdit(currentStatus)) {
        updated[key] = { ...updated[key], [field]: value };
      }
    }
    setRosterData(updated);
    toast({
      title: 'Bulk apply',
      description: 'ใช้กับแถวที่วันที่เลือกอยู่ในช่วงมอบหมายและยังแก้ได้',
    });
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
      const payloads: Partial<DailyTimesheet>[] = [];

      for (const asgn of assignmentRows) {
        if (!assignmentCoversHtmlDate(asgn, targetDate)) continue;
        const ts = rosterData[asgn.id];
        if (!ts?.workerId) continue;
        if (ts.status && service.isFinalized(ts.status as DailyTimesheetStatus)) continue;

        const poRow = poById.get(asgn.poId) ?? canonicalPo;
        const rowScopeId = poTimesheetScopeId(poRow.id);
        if (isMonthReviewLocked(reviewByWaveId.get(rowScopeId) ?? null)) continue;
        const wv = waveById.get(asgn.waveId);
        if (wv && isMonthReviewLocked(reviewByWaveId.get(wv.id) ?? null)) continue;

        const worker = workers?.find((w) => w.id === asgn.workerId);
        const contractId = (asgn.contractId || poRow.contractId || '').trim();
        const poLineId = (asgn.poLineId || wv?.poLineId || '').trim();
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
          waveId: rowScopeId,
          siteId: rowScopeId,
          purchaseOrderId: asgn.poId || poRow.id,
          poActiveBundleId: bundleKey ?? poRow.poActiveBundleId,
          poLineId,
          contractId,
          customerId: poRow.customerId || '',
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
      await loadRoster();
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
      if (wId && !isPoTimesheetScopeId(wId)) {
        batch.update(doc(firestore, 'waves', wId), {
          assignedWorkers: increment(-1),
          updatedAt: Date.now(),
        });
      }
      await batch.commit();
      setDemobTarget(null);
      toast({ title: 'จบงวด (Demob) แล้ว', description: 'รายการนี้จะไม่ถูกนับในกระดานตามช่วงมอบหมายอีกต่อไป' });
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
                <CalendarDays className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
                {isBundle ? (
                  <>
                    <span>ชุด PO Active</span>
                    <span className="font-mono text-sm opacity-95">
                      {posList.map((p) => p.poCode).join(' · ')}
                    </span>
                  </>
                ) : (
                  <span className="font-mono">{canonicalPo.poCode}</span>
                )}
                <span className="opacity-80">· งวด {formatThaiYearMonthLabel(monthYm, 'th-TH')}</span>
                <span className="text-xs font-normal opacity-90">({monthYm})</span>
              </CardTitle>
              <CardDescription className="text-primary-foreground/80 text-sm mt-1">
                {isBundle ? (
                  <>
                    ตารางเดียวรวมทุก PO ในชุด — แถวเฉพาะคนที่ <strong>mobilization แล้ว</strong> (readiness + deployment ตาม Wave Board)
                    {rosterFilterYm && /^\d{4}-\d{2}$/.test(rosterFilterYm) ? (
                      <>
                        {' '}
                        และช่วงมอบหมาย<strong>ทับเดือน {rosterFilterYm}</strong> (สอดคล้องจำนวน MOB ผ่าน) — แก้/บันทึกเฉพาะวันที่อยู่ในช่วงมอบหมาย
                      </>
                    ) : (
                      <> และวันที่อยู่ในช่วงมอบหมายตามวันที่เลือก</>
                    )}{' '}
                    · คนที่ยัง assign / ไม่พร้อมจะไม่ขึ้น · waves: {waves.map((w) => `${w.waveCode} [${w.status}]`).join(' · ') || '—'}
                  </>
                ) : (
                  <>
                    รวม {waves.length} wave: {waves.map((w) => `${w.waveCode} [${w.status}]`).join(' · ')} — แต่ละ row อ้าง assignment
                    ของรายนั้น · แถวเฉพาะ mobilization ที่พร้อมแล้วเท่านั้น
                  </>
                )}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-1.5 sm:items-end shrink-0">
              <Button variant="secondary" size="sm" asChild>
                <Link href={poMonthHref}>เอกสาร PO+เดือน (วางบิล / payroll) →</Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 space-y-4">
          {anyMonthLocked ? (
            <Alert className="rounded-none border-x-0 border-t-0">
              <AlertTitle>
                งวด {monthYm} ถูกล็อกสำหรับ {isBundle ? 'PO ในชุดนี้' : 'PO นี้'} (หรือ wave ข้อมูลเก่า)
              </AlertTitle>
              <AlertDescription>
                สถานะ entry_locked / รออนุมัติ / อนุมัติ — แก้เวลาในกระดานนี้ไม่ได้จนกว่าจะปลดล็อกตามกระบวนการ
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 p-4 bg-muted/20 rounded-none border-b border-dashed">
            <span className="text-xs font-black text-muted-foreground uppercase flex items-center gap-2 mr-2">
              <Zap className="h-4 w-4 text-amber-500" /> Quick apply ({isBundle ? 'ทุกแถวในตารางชุดนี้' : 'ทุก row ใต้ PO นี้'})
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
            <Button
              size="sm"
              variant="outline"
              className="bg-white border-primary/20"
              disabled={anyMonthLocked}
              onClick={() => applyBulk('eventType', 'mobilization_day')}
            >
              3. Mob
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-white border-primary/20"
              disabled={anyMonthLocked}
              onClick={() => applyBulk('eventType', 'demobilization_day')}
            >
              4. Dmob
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
                <span className="text-[10px] text-muted-foreground">
                  บันทึกเฉพาะแถวที่วันที่เลือกอยู่ในช่วงมอบหมาย
                  {rosterFilterYm && /^\d{4}-\d{2}$/.test(rosterFilterYm) ? ' (รายชื่อตามเดือนนี้)' : ''}
                </span>
              </div>
            </div>
          </div>

          {isAsgnLoading && (
            <div className="py-20 text-center animate-pulse">Loading Roster…</div>
          )}
          {!isAsgnLoading && assignmentRows.length > 0 ? (
            <Table className="w-full text-sm">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6 py-4 font-bold min-w-[9rem]">พนักงาน (Worker)</TableHead>
                  {isBundle ? (
                    <TableHead className="font-bold w-[7rem] min-w-[6rem] whitespace-nowrap">รหัส PO</TableHead>
                  ) : null}
                  <TableHead className="font-bold w-[8.5rem] min-w-[7rem]">ช่วงมอบหมาย</TableHead>
                  <TableHead className="font-bold min-w-[5rem] max-w-[8rem]">ตำแหน่ง</TableHead>
                  <TableHead className="font-bold w-[148px] max-w-[160px] shrink-0">ประเภทวัน</TableHead>
                  <TableHead className="font-bold text-center w-[5.5rem] shrink-0">ชั่วโมงปกติ</TableHead>
                  <TableHead className="font-bold w-[6.5rem] shrink-0 whitespace-nowrap">สถานะปัจจุบัน</TableHead>
                  <TableHead className="w-[5.75rem] text-center font-bold shrink-0">จบงวด</TableHead>
                  <TableHead className="text-right pr-6 min-w-[6rem] w-[18%]">หมายเหตุ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignmentRows.map((asgn) => {
                  const wv = waveById.get(asgn.waveId);
                  const poForRow = poById.get(asgn.poId) ?? canonicalPo;
                  const rowScopeId = poTimesheetScopeId(poForRow.id);
                  const scopeLocked = isMonthReviewLocked(reviewByWaveId.get(rowScopeId) ?? null);
                  const waveLocked =
                    wv && !isPoTimesheetScopeId(asgn.waveId)
                      ? isMonthReviewLocked(reviewByWaveId.get(wv.id) ?? null)
                      : false;
                  const rowLocked = scopeLocked || waveLocked;
                  const dft = defaultHoursByAssignmentId.get(asgn.id) ?? 12;
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
                  const dateInAssignment = assignmentCoversHtmlDate(asgn, targetDate);
                  const rowEditLocked = isLocked || rowLocked || anyMonthLocked || !dateInAssignment;
                  const persisted = persistedAssignmentIds.has(asgn.id);

                  return (
                    <TableRow
                      key={asgn.id}
                      className={
                        rowEditLocked
                          ? !dateInAssignment
                            ? 'bg-amber-50/40 dark:bg-amber-950/20'
                            : 'bg-slate-50 opacity-80'
                          : 'hover:bg-muted/20'
                      }
                    >
                      <TableCell className="pl-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-sm text-primary">
                            {worker?.firstName} {worker?.lastName}
                          </span>
                          <span className="text-[9px] font-mono text-muted-foreground uppercase">
                            {worker?.workerCode || asgn.id.slice(0, 8)}
                          </span>
                          {!dateInAssignment ? (
                            <span className="text-[9px] text-amber-800 dark:text-amber-200 mt-0.5">
                              วันที่เลือกอยู่นอกช่วงมอบหมาย — เปลี่ยนวันที่หรือรอถึงช่วงที่ทับ
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      {isBundle ? (
                        <TableCell className="align-top py-4 font-mono text-xs text-muted-foreground">
                          {poForRow.poCode}
                        </TableCell>
                      ) : null}
                      <TableCell className="align-top text-xs py-4 text-foreground/90">
                        <span className="leading-tight">{formatStoredDateRangeThaiBE(asgn.startDate, asgn.endDate)}</span>
                      </TableCell>
                      <TableCell className="text-sm align-top py-4 max-w-[8rem]">
                        <span className="line-clamp-2" title={positionLabel(asgn.positionId)}>
                          {positionLabel(asgn.positionId)}
                        </span>
                      </TableCell>
                      <TableCell className="w-[148px] max-w-[160px] align-top py-4 shrink-0">
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
                          <SelectTrigger className="h-9 text-xs w-full max-w-[160px] min-w-0 [&_span]:truncate">
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
                        <div className="flex items-center gap-2 tabular-nums">
                          {rowEditLocked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />}
                          <span
                            className="text-xs font-semibold text-foreground min-w-[2rem]"
                            title={
                              !dateInAssignment
                                ? 'วันนี้อยู่นอกช่วงมอบหมาย — ไม่บันทึกจากแถวนี้'
                                : persisted
                                  ? `บันทึกแล้ว · ${row.eventType}`
                                  : 'ยังไม่มีการบันทึก timesheet สำหรับวันนี้'
                            }
                          >
                            {!dateInAssignment ? '—' : waveBoardStatusCode(persisted, row.eventType)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-[10px] gap-1 border-amber-600/40"
                          disabled={!canEditTimesheets || demobSubmitting || !dateInAssignment}
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
                  ยังไม่ mobilization ครบตามเกณฑ์ Wave Board / ถือ DRAFT / ยังไม่พร้อม (readiness) / วันที่อยู่นอกช่วงมอบหมาย —{' '}
                  ตรวจ Mobilization และการมอบหมายในชุด PO Active นี้ (คนที่อยู่แค่ assign จะไม่ขึ้นที่นี่จนกว่าจะ mob แล้ว)
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="bg-muted/20 border-t py-3 flex flex-wrap justify-between items-center gap-2">
          <p className="text-xs text-muted-foreground max-w-2xl">
            บันทึกลง <span className="font-medium">daily timesheets</span> ต่อ assignment — ชั่วโมงเริ่มต้นจากสัญญา/บรรทัด PO ของแต่ละคน
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="link" className="text-xs h-auto p-0" asChild>
              <Link href={poMonthHref}>เอกสาร PO+เดือน (ปิดงวด / วางบิล)</Link>
            </Button>
            <Button variant="link" className="text-xs h-auto p-0" asChild>
              <Link href="/timesheets/wave-month">สรุปรอบเดือนราย wave</Link>
            </Button>
          </div>
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
