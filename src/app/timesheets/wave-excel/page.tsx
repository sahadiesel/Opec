'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import {
  Assignment,
  Customer,
  DailyTimesheet,
  PayrollPeriod,
  PurchaseOrder,
  User,
  Wave,
  Worker,
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { TimesheetService } from '@/lib/services/timesheet-service';
import { canView } from '@/lib/permissions';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import {
  WAVE_EXCEL_DEFAULT_NORMAL_HOURS,
  cycleUiKind,
  dailyDocToRowState,
  defaultRowState,
  emojiUiKind,
  labelUiKind,
  poOverlapsPayrollPeriod,
  rowStateToTimesheetPayload,
  rowVisual,
  waveExcelSummary,
  type WaveExcelRowState,
} from '@/lib/timesheet/wave-excel-entry';
import {
  Copy,
  Keyboard,
  Loader2,
  Save,
  Sheet,
  Sparkles,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ROW_VISUAL_CLASS: Record<string, string> = {
  green: 'bg-emerald-50/90 dark:bg-emerald-950/30 border-l-4 border-l-emerald-500',
  yellow: 'bg-amber-50/90 dark:bg-amber-950/30 border-l-4 border-l-amber-500',
  red: 'bg-red-50/80 dark:bg-red-950/25 border-l-4 border-l-red-500',
  gray: 'bg-muted/40 border-l-4 border-l-muted-foreground/30',
};

export default function WaveExcelEntryPage() {
  const firestore = useFirestore();
  const { toast } = useToast();
  const { isUserLoading } = useUser();
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [periodId, setPeriodId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [waveId, setWaveId] = useState('');
  const [targetDate, setTargetDate] = useState(() => timestampToHtmlDateValue(Date.now()));

  const [gridLoaded, setGridLoaded] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const skipAutosaveOnce = useRef(false);
  const persistRef = useRef<(silent: boolean) => Promise<void>>(async () => {});
  const [isLoadingGrid, setIsLoadingGrid] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCloning, setIsCloning] = useState(false);

  const [rowsByWorker, setRowsByWorker] = useState<Record<string, WaveExcelRowState>>({});
  const [roster, setRoster] = useState<Assignment[]>([]);
  const [loadedContext, setLoadedContext] = useState<{
    waveId: string;
    poId: string;
    targetDate: string;
  } | null>(null);

  const [focusedIdx, setFocusedIdx] = useState(0);
  const [selectAll, setSelectAll] = useState(true);
  const [selectedWorkers, setSelectedWorkers] = useState<Set<string>>(new Set());

  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raw = localStorage.getItem('opsflow_user');
    if (raw) setCurrentUser(JSON.parse(raw));
  }, []);

  const canTimesheets = useMemo(() => canView(currentUser, 'timesheets'), [currentUser]);

  const periodsQuery = useMemoFirebase(
    () => (firestore && canTimesheets ? query(collection(firestore, 'payroll_periods'), orderBy('startDate', 'desc')) : null),
    [firestore, canTimesheets]
  );
  const { data: periods } = useCollection<PayrollPeriod>(periodsQuery as any);

  const posQuery = useMemoFirebase(
    () =>
      firestore && canTimesheets
        ? query(collection(firestore, 'purchase_orders'), where('status', '==', 'active'))
        : null,
    [firestore, canTimesheets]
  );
  const { data: allPos } = useCollection<PurchaseOrder>(posQuery as any);

  const wavesQuery = useMemoFirebase(
    () => (firestore && canTimesheets ? collection(firestore, 'waves') : null),
    [firestore, canTimesheets]
  );
  const { data: allWaves } = useCollection<Wave>(wavesQuery as any);

  const customersQuery = useMemoFirebase(
    () => (firestore && canTimesheets ? collection(firestore, 'customers') : null),
    [firestore, canTimesheets]
  );
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const workersQuery = useMemoFirebase(
    () => (firestore && canTimesheets ? collection(firestore, 'workers') : null),
    [firestore, canTimesheets]
  );
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const focusPeriod = useMemo(() => periods?.find((p) => p.id === periodId) ?? null, [periods, periodId]);

  const posInPeriod = useMemo(() => {
    if (!focusPeriod || !allPos?.length) return [];
    return allPos.filter((p) => poOverlapsPayrollPeriod(p, focusPeriod.startDate, focusPeriod.endDate));
  }, [focusPeriod, allPos]);

  const customerOptions = useMemo(() => {
    const ids = [...new Set(posInPeriod.map((p) => p.customerId))];
    return ids
      .map((id) => ({
        id,
        name: customers?.find((c) => c.id === id)?.name ?? id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [posInPeriod, customers]);

  const posForCustomer = useMemo(() => {
    if (!customerId) return [];
    return posInPeriod.filter((p) => p.customerId === customerId);
  }, [posInPeriod, customerId]);

  const wavesForCustomer = useMemo(() => {
    const poIds = new Set(posForCustomer.map((p) => p.id));
    return (allWaves || []).filter((w) => poIds.has(w.poId));
  }, [allWaves, posForCustomer]);

  const selectedWave = useMemo(() => wavesForCustomer.find((w) => w.id === waveId) ?? null, [wavesForCustomer, waveId]);
  const selectedPo = useMemo(
    () => (selectedWave ? posForCustomer.find((p) => p.id === selectedWave.poId) ?? null : null),
    [selectedWave, posForCustomer]
  );

  const dateInPeriod = useMemo(() => {
    if (!focusPeriod) return true;
    return targetDate >= focusPeriod.startDate && targetDate <= focusPeriod.endDate;
  }, [focusPeriod, targetDate]);

  const sortedRoster = useMemo(() => {
    return [...roster].sort((a, b) => {
      const wa = workers?.find((w) => w.id === a.workerId);
      const wb = workers?.find((w) => w.id === b.workerId);
      const na = wa ? `${wa.firstName} ${wa.lastName}` : a.workerId;
      const nb = wb ? `${wb.firstName} ${wb.lastName}` : b.workerId;
      return na.localeCompare(nb, 'th');
    });
  }, [roster, workers]);

  const workerIdsSorted = useMemo(() => sortedRoster.map((a) => a.workerId), [sortedRoster]);

  const summary = useMemo(
    () => waveExcelSummary(workerIdsSorted.map((id) => rowsByWorker[id]).filter(Boolean), gridLoaded),
    [rowsByWorker, workerIdsSorted, gridLoaded]
  );

  const loadGrid = useCallback(async () => {
    if (!firestore || !currentUser || !waveId || !focusPeriod || !customerId || !dateInPeriod) {
      toast({
        variant: 'destructive',
        title: 'ข้อมูลไม่ครบ',
        description: 'เลือกรอบบัญชี ลูกค้า เวฟ และวันที่ให้ครบ (วันที่ต้องอยู่ในรอบ)',
      });
      return;
    }
    setIsLoadingGrid(true);
    try {
      const service = new TimesheetService(firestore);
      const list = await service.getWaveRosterForDate(waveId, targetDate);
      if (list.length === 0) {
        toast({ title: 'ไม่มีรายชื่อในเวฟวันนี้', description: 'ตรวจสอบมอบหมายงานและช่วงวันที่' });
        setRoster([]);
        setRowsByWorker({});
        setGridLoaded(false);
        setLoadedContext(null);
        return;
      }

      const w = wavesForCustomer.find((x) => x.id === waveId);
      const po = w ? posForCustomer.find((p) => p.id === w.poId) : null;
      if (!w || !po) throw new Error('ไม่พบ Wave / PO');

      const tsQ = query(
        collection(firestore, 'daily_timesheets'),
        where('waveId', '==', waveId),
        where('date', '==', targetDate)
      );
      const tsSnap = await getDocs(tsQ);
      const byWorker: Record<string, DailyTimesheet> = {};
      tsSnap.docs.forEach((d) => {
        const t = d.data() as DailyTimesheet;
        byWorker[t.workerId] = t;
      });

      const nextRows: Record<string, WaveExcelRowState> = {};
      for (const asgn of list) {
        const existing = byWorker[asgn.workerId];
        if (existing) {
          nextRows[asgn.workerId] = dailyDocToRowState(existing);
          if (nextRows[asgn.workerId].assignmentId !== asgn.id) {
            nextRows[asgn.workerId] = {
              ...nextRows[asgn.workerId],
              assignmentId: asgn.id,
            };
          }
        } else {
          nextRows[asgn.workerId] = defaultRowState(asgn.workerId, asgn.id);
        }
      }

      setRoster(list);
      setRowsByWorker(nextRows);
      setGridLoaded(true);
      setLoadedContext({ waveId, poId: po.id, targetDate });
      setFocusedIdx(0);
      setSelectAll(true);
      setSelectedWorkers(new Set(list.map((a) => a.workerId)));
      setLoadKey((k) => k + 1);
      skipAutosaveOnce.current = true;
      toast({ title: 'โหลดรายการแล้ว', description: `${list.length} คน` });
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'โหลดไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'ลองใหม่',
      });
    } finally {
      setIsLoadingGrid(false);
    }
  }, [
    firestore,
    currentUser,
    waveId,
    focusPeriod,
    customerId,
    targetDate,
    dateInPeriod,
    wavesForCustomer,
    posForCustomer,
    toast,
  ]);

  const persistRows = useCallback(
    async (silent: boolean) => {
      if (!firestore || !currentUser || !gridLoaded || !loadedContext || !selectedWave || !selectedPo) return;
      const service = new TimesheetService(firestore);
      const payloads: Partial<DailyTimesheet>[] = [];

      for (const asgn of roster) {
        const row = rowsByWorker[asgn.workerId];
        if (!row) continue;
        const wn = workers?.find((w) => w.id === asgn.workerId);
        const name = wn ? `${wn.firstName} ${wn.lastName}` : 'Unknown';
        const payload = rowStateToTimesheetPayload(row, {
          waveId: loadedContext.waveId,
          targetDate: loadedContext.targetDate,
          workerName: name,
          assignment: asgn,
          wave: selectedWave,
          po: selectedPo,
        });
        if (payload) payloads.push(payload);
      }

      if (payloads.length === 0) {
        if (!silent) toast({ title: 'ไม่มีแถวที่บันทึกได้', description: 'เลือกสถานะก่อน (ยกเว้นแถวล็อก)' });
        return;
      }

      if (!silent) setIsSaving(true);
      try {
        const res = await service.bulkUpsertTimesheets(payloads, currentUser);
        if (!silent) {
          toast({
            title: 'บันทึกแล้ว',
            description: `สร้าง ${res.created} · อัปเดต ${res.updated} · ข้าม ${res.skipped}`,
          });
        }
      } catch (e) {
        toast({
          variant: 'destructive',
          title: 'บันทึกล้มเหลว',
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        if (!silent) setIsSaving(false);
      }
    },
    [
      firestore,
      currentUser,
      gridLoaded,
      loadedContext,
      selectedWave,
      selectedPo,
      roster,
      rowsByWorker,
      workers,
      toast,
    ]
  );

  persistRef.current = persistRows;

  useEffect(() => {
    if (!gridLoaded || !loadedContext) return;
    if (skipAutosaveOnce.current) {
      skipAutosaveOnce.current = false;
      return;
    }
    const h = setTimeout(() => {
      void persistRef.current(true);
    }, 2800);
    return () => clearTimeout(h);
  }, [rowsByWorker, gridLoaded, loadedContext, loadKey]);

  const handleClonePrev = async () => {
    if (!firestore || !currentUser || !waveId || !dateInPeriod) return;
    setIsCloning(true);
    try {
      const service = new TimesheetService(firestore);
      const res = await service.copyFromPreviousDay(waveId, targetDate, currentUser);
      toast({ title: 'คัดลอกจากวันก่อน', description: `สร้าง ${res.created} แถว` });
      await loadGrid();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'คัดลอกไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsCloning(false);
    }
  };

  const fillNormalAll = () => {
    setRowsByWorker((prev) => {
      const next = { ...prev };
      for (const wid of workerIdsSorted) {
        if (!selectAll && !selectedWorkers.has(wid)) continue;
        const r = next[wid];
        if (!r || r.locked) continue;
        next[wid] = {
          ...r,
          uiKind: 'normal',
          normalHours: WAVE_EXCEL_DEFAULT_NORMAL_HOURS,
          ot15: 0,
          ot20: 0,
          ot30: 0,
        };
      }
      return next;
    });
    toast({ title: 'Fill Normal', description: 'ตั้งทำงานปกติ + ชั่วโมงเริ่มต้นให้แถวที่เลือก' });
  };

  const updateRow = (workerId: string, patch: Partial<WaveExcelRowState>) => {
    setRowsByWorker((prev) => {
      const cur = prev[workerId];
      if (!cur || cur.locked) return prev;
      return { ...prev, [workerId]: { ...cur, ...patch } };
    });
  };

  const toggleWorkerSelected = (workerId: string) => {
    setSelectedWorkers((prev) => {
      const n = new Set(prev);
      if (n.has(workerId)) n.delete(workerId);
      else n.add(workerId);
      return n;
    });
  };

  const onToggleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) setSelectedWorkers(new Set(workerIdsSorted));
    else setSelectedWorkers(new Set());
  };

  useEffect(() => {
    if (!gridLoaded) return;
    const onKey = (e: KeyboardEvent) => {
      if (!workerIdsSorted.length) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const widFromInput = (e.target as HTMLInputElement).dataset.workerid;
          const idx = workerIdsSorted.findIndex((id) => id === widFromInput);
          if (idx >= 0 && idx < workerIdsSorted.length - 1) {
            setFocusedIdx(idx + 1);
            const nextId = workerIdsSorted[idx + 1];
            const el = tableRef.current?.querySelector(`[data-focus-anchor="${nextId}"]`) as HTMLElement | null;
            el?.focus();
          }
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIdx((i) => Math.min(i + 1, workerIdsSorted.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const wid = workerIdsSorted[focusedIdx];
        if (!wid) return;
        const r = rowsByWorker[wid];
        if (r?.locked) return;
        updateRow(wid, { uiKind: cycleUiKind(r?.uiKind ?? 'unset') });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gridLoaded, workerIdsSorted, focusedIdx, rowsByWorker]);

  if (isUserLoading || !currentUser) {
    return <div className="flex min-h-[30vh] items-center justify-center text-muted-foreground text-sm">กำลังโหลด…</div>;
  }

  if (!canTimesheets) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="mx-auto max-w-lg py-20 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าหน้านี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto w-full min-w-0 max-w-[1680px] space-y-5 pb-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <PayrollScopeTag scope="worker" showHint={false} />
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-2">
              <Sheet className="h-8 w-8 shrink-0" />
              คีย์ Timesheet ทั้ง Wave (Excel-style)
            </h1>
            <p className="text-muted-foreground max-w-3xl">
              D4 — เลือกรอบ ลูกค้า เวฟ วันที่ แล้วโหลดรายชื่อครั้งเดียว คีย์ทั้งเวฟได้เร็ว: Fill Normal, คัดลอกวันก่อน, คลิกสลับสถานะ, คีย์ลัด, บันทึกอัตโนมัติ
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/timesheets/wave-board">Wave Board เดิม</Link>
            </Button>
            <Button variant="outline" onClick={handleClonePrev} disabled={!waveId || isCloning || !dateInPeriod}>
              {isCloning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              คัดลอกจากวันก่อนหน้า
            </Button>
            <Button onClick={() => void persistRows(false)} disabled={!gridLoaded || isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              บันทึกทั้งหมด
            </Button>
          </div>
        </div>

        <PageGuidance
          title="ใช้งานอย่างเร็ว"
          tips={[
            'เลือกรอบบัญชี → ลูกค้า → เวฟ → วันที่ แล้วกด "สร้าง/โหลดรายการ"',
            'คลิกที่ช่องสถานะเพื่อสลับแบบเร็ว หรือกด Enter เมื่อโฟกัสแถว (ไม่ได้อยู่ในช่องตัวเลข)',
            '↑ ↓ เลื่อนแถวที่เน้น · แถวสีเขียว = ครบ เหลือง = ยังไม่ครบ แดง = ยังไม่เลือกสถานะ',
            'บันทึกอัตโนมัติหลังหยุดพิมพ์ ~3 วินาที (รายการที่ล็อกจะข้าม)',
          ]}
        />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ตัวกรอง / ควบคุม</CardTitle>
            <CardDescription>เลือก 4 อย่างให้ครบ แล้วโหลดรายการ</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-2">
              <Label>รอบบัญชี (Period)</Label>
              <Select value={periodId} onValueChange={(v) => { setPeriodId(v); setCustomerId(''); setWaveId(''); setGridLoaded(false); }}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือกรอบ..." />
                </SelectTrigger>
                <SelectContent>
                  {periods?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label || p.id} ({p.startDate} – {p.endDate})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>ลูกค้า (Customer)</Label>
              <Select
                value={customerId}
                onValueChange={(v) => {
                  setCustomerId(v);
                  setWaveId('');
                  setGridLoaded(false);
                }}
                disabled={!periodId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="เลือกลูกค้า..." />
                </SelectTrigger>
                <SelectContent>
                  {customerOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label>เวฟ (Wave)</Label>
              <Select value={waveId} onValueChange={(v) => { setWaveId(v); setGridLoaded(false); }} disabled={!customerId}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือกเวฟ..." />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {wavesForCustomer.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.waveCode} · {w.projectName || w.siteLocation}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>วันที่</Label>
              <DatePickerThaiBE
                className="h-10"
                value={htmlDateValueToTimestampMs(targetDate)}
                onChange={(ms) => {
                  setTargetDate(timestampToHtmlDateValue(ms));
                  setGridLoaded(false);
                }}
              />
              {!dateInPeriod && focusPeriod && (
                <p className="text-xs text-destructive">วันที่ต้องอยู่ในรอบที่เลือก</p>
              )}
            </div>
          </CardContent>
          <CardContent className="pt-0 flex flex-wrap gap-2">
            <Button
              className="font-semibold"
              onClick={() => void loadGrid()}
              disabled={!periodId || !customerId || !waveId || !dateInPeriod || isLoadingGrid}
            >
              {isLoadingGrid ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              สร้าง / โหลดรายการ
            </Button>
            {gridLoaded && selectedWave && (
              <BadgePill
                label={selectedWave.waveCode}
                sub={`${summary.total} คน · ครบ ${summary.green} · ยังไม่ครบ ${summary.yellow} · ยังไม่ลง ${summary.red}`}
              />
            )}
          </CardContent>
        </Card>

        {gridLoaded && selectedWave && (
          <Card>
            <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                <CardTitle className="text-base">
                  {selectedWave.waveCode} — สรุปเวฟ
                </CardTitle>
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                <span>
                  ทั้งหมด <strong>{summary.total}</strong>
                </span>
                <span className="text-emerald-700 dark:text-emerald-400">ครบ {summary.green}</span>
                <span className="text-amber-700 dark:text-amber-400">ยังไม่ครบ {summary.yellow}</span>
                <span className="text-red-700 dark:text-red-400">ยังไม่ลง {summary.red}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-2">
                  <Checkbox id="selall" checked={selectAll} onCheckedChange={(c) => onToggleSelectAll(c === true)} />
                  <label htmlFor="selall" className="text-sm font-medium">
                    เลือกทั้งหมด
                  </label>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={fillNormalAll}>
                  Fill: ทำงานปกติ ({WAVE_EXCEL_DEFAULT_NORMAL_HOURS} ชม.) ให้แถวที่เลือก
                </Button>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Keyboard className="h-3.5 w-3.5" /> ↑↓ เลื่อนแถว · Enter สลับสถานะ · Enter ในช่องตัวเลขไปแถวถัดไป
                </span>
              </div>

              <div ref={tableRef} tabIndex={-1} className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-10 text-center">เลือก</TableHead>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>ชื่อ</TableHead>
                      <TableHead className="min-w-[200px]">สถานะวันนี้ (คลิกสลับ)</TableHead>
                      <TableHead className="w-24">ชั่วโมง</TableHead>
                      <TableHead className="w-20">OT1.5</TableHead>
                      <TableHead className="w-20">OT2</TableHead>
                      <TableHead className="w-20">OT3</TableHead>
                      <TableHead className="min-w-[160px]">หมายเหตุ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRoster.map((asgn, idx) => {
                      const wid = asgn.workerId;
                      const row = rowsByWorker[wid];
                      const w = workers?.find((x) => x.id === wid);
                      const name = w ? `${w.firstName} ${w.lastName}` : wid;
                      const vis = row ? rowVisual(row, gridLoaded) : 'gray';
                      const focused = idx === focusedIdx;
                      const sel = selectedWorkers.has(wid);

                      return (
                        <TableRow
                          key={asgn.id}
                          className={cn(ROW_VISUAL_CLASS[vis], focused && 'ring-2 ring-primary ring-inset')}
                          onClick={() => setFocusedIdx(idx)}
                        >
                          <TableCell className="text-center">
                            <Checkbox
                              checked={sel}
                              onCheckedChange={() => toggleWorkerSelected(wid)}
                              disabled={row?.locked}
                            />
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
                          <TableCell className="font-medium">{name}</TableCell>
                          <TableCell>
                            <button
                              type="button"
                              data-focus-anchor={wid}
                              disabled={row?.locked}
                              className={cn(
                                'w-full rounded-md border px-2 py-2 text-left text-sm transition hover:bg-background/80',
                                row?.locked && 'opacity-60 cursor-not-allowed'
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (row?.locked) return;
                                updateRow(wid, { uiKind: cycleUiKind(row?.uiKind ?? 'unset') });
                              }}
                            >
                              <span className="mr-2">{emojiUiKind(row?.uiKind ?? 'unset')}</span>
                              {labelUiKind(row?.uiKind ?? 'unset')}
                              {row?.locked && <span className="ml-2 text-xs text-muted-foreground">(ล็อก)</span>}
                            </button>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              max={24}
                              className="h-9"
                              disabled={row?.locked || row?.uiKind === 'no_work' || row?.uiKind === 'standby'}
                              data-workerid={wid}
                              value={row?.normalHours ?? 0}
                              onChange={(e) => updateRow(wid, { normalHours: Number(e.target.value) || 0 })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              max={24}
                              className="h-9"
                              disabled={row?.locked || row?.uiKind !== 'with_ot'}
                              data-workerid={wid}
                              value={row?.ot15 ?? 0}
                              onChange={(e) => updateRow(wid, { ot15: Number(e.target.value) || 0 })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              max={24}
                              className="h-9"
                              disabled={row?.locked || row?.uiKind !== 'with_ot'}
                              data-workerid={wid}
                              value={row?.ot20 ?? 0}
                              onChange={(e) => updateRow(wid, { ot20: Number(e.target.value) || 0 })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              max={24}
                              className="h-9"
                              disabled={row?.locked || row?.uiKind !== 'with_ot'}
                              data-workerid={wid}
                              value={row?.ot30 ?? 0}
                              onChange={(e) => updateRow(wid, { ot30: Number(e.target.value) || 0 })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-9"
                              disabled={row?.locked}
                              data-workerid={wid}
                              placeholder="ลา / ป่วย / ลูกค้าขอหยุด…"
                              value={row?.remark ?? ''}
                              onChange={(e) => updateRow(wid, { remark: e.target.value })}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function BadgePill({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="rounded-full border bg-primary/5 px-4 py-2 text-sm">
      <span className="font-semibold text-primary">{label}</span>
      <span className="text-muted-foreground"> · {sub}</span>
    </div>
  );
}
