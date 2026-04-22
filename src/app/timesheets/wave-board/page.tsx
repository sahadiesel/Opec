'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Waves,
  Save,
  Users,
  Loader2,
  Zap,
  Info,
  ChevronRight,
  Lock,
} from 'lucide-react';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useDoc } from '@/firebase/firestore/use-doc';
import { collection, doc, query, where, getDocs, type Firestore } from 'firebase/firestore';
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
import { PageGuidance } from '@/components/layout/page-guidance';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { TimesheetService } from '@/lib/services/timesheet-service';
import Link from 'next/link';
import { WAVE_TIMESHEET_DEPLOYMENT_STATUSES, OPEN_WAVE_STATUSES_FOR_TIMESHEET } from '@/lib/constants/timesheet-wave';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canEdit, canView, isMatrixControlledRole } from '@/lib/permissions';
import {
  resolveContractDailyHoursForWaveBoard,
  assignmentReadyForWaveTimesheet,
  waveRoundMonthLabel,
} from '@/lib/constants/timesheet-ui';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';
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

function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** มีเอกสาร daily_timesheets ในวันนั้นสำหรับ Wave ใดในรายการหรือไม่ */
async function hasDailyTimesheetsForDate(db: Firestore, date: string, waveIds: string[]): Promise<boolean> {
  if (waveIds.length === 0) return false;
  for (const chunk of chunkIds(waveIds, 10)) {
    const q = query(
      collection(db, 'daily_timesheets'),
      where('date', '==', date),
      where('waveId', 'in', chunk),
    );
    const snap = await getDocs(q);
    if (!snap.empty) return true;
  }
  return false;
}

const EVENT_TYPE_OPTIONS: { label: string; value: RateConditionEventType }[] = [
  { label: 'วันทำงาน (Work)', value: 'work_day' },
  { label: 'วันเดินทาง (Travel)', value: 'travel_day' },
  { label: 'สแตนด์บาย (Standby)', value: 'standby_day' },
  { label: 'เตรียมส่งตัว (Mob)', value: 'mobilization_day' },
  { label: 'วันเดินทางกลับ (Demob)', value: 'demobilization_day' },
  { label: 'ลาหยุดไม่รับค่าจ้าง (Unpaid)', value: 'unpaid_leave' },
];

type WaveBoardBlockProps = {
  wave: Wave;
  po: PurchaseOrder | undefined;
  targetDate: string;
  onBoardDateChange: (timestampMs: number) => void;
  currentUser: User;
  workers: Worker[] | undefined;
  positionLabel: (id?: string) => string;
  canEditTimesheets: boolean;
};

/**
 * ลงเวลารายวันต่อ Wave — บันทึกได้เฉพาะ **ร่าง (DRAFT)** ที่นี่
 * การส่งให้ผู้จัดการตรวจทำที่ **สรุปรายเดือน (wave-month)** เท่านั้น
 */
function WaveBoardBlock({
  wave,
  po,
  targetDate,
  onBoardDateChange,
  currentUser,
  workers,
  positionLabel,
  canEditTimesheets,
}: WaveBoardBlockProps) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [rosterData, setRosterData] = useState<Record<string, Partial<DailyTimesheet>>>({});
  const [isSaving, setIsSaving] = useState(false);

  const monthYm = targetDate.slice(0, 7);
  const waveMonthReviewRef = useMemoFirebase(
    () =>
      firestore && /^\d{4}-\d{2}$/.test(monthYm)
        ? doc(firestore, 'wave_month_timesheet_reviews', `${wave.id}_${monthYm}`)
        : null,
    [firestore, wave.id, monthYm],
  );
  const { data: waveMonthReview } = useDoc<WaveMonthTimesheetReview>(waveMonthReviewRef as any);
  const isWaveMonthPeriodLocked =
    waveMonthReview?.status === 'entry_locked' ||
    waveMonthReview?.status === 'pending_manager_review' ||
    waveMonthReview?.status === 'approved';

  const poLinesQuery = useMemoFirebase(
    () =>
      firestore && wave.poId ? collection(firestore, 'purchase_orders', wave.poId, 'po_lines') : null,
    [firestore, wave.poId],
  );
  const { data: poLines } = useCollection<POLine>(poLinesQuery as any);

  const contractRatesQuery = useMemoFirebase(
    () =>
      firestore && po?.contractId ? collection(firestore, 'main_contracts', po.contractId, 'position_rates') : null,
    [firestore, po?.contractId],
  );
  const { data: contractPositionRates } = useCollection<PositionRate>(contractRatesQuery as any);

  const contractDefaultDailyHours = useMemo(
    () => resolveContractDailyHoursForWaveBoard(wave, poLines ?? undefined, contractPositionRates ?? undefined),
    [wave, poLines, contractPositionRates],
  );

  const asgnQuery = useMemoFirebase(() => {
    if (!firestore || !wave.id) return null;
    return query(
      collection(firestore, 'mobilizations'),
      where('waveId', '==', wave.id),
      where('deploymentStatus', 'in', WAVE_TIMESHEET_DEPLOYMENT_STATUSES),
    );
  }, [firestore, wave.id]);
  const { data: assignmentsRaw, isLoading: isAsgnLoading } = useCollection<Assignment>(asgnQuery as any);
  const assignments = useMemo(
    () => assignmentsRaw?.filter((a) => assignmentReadyForWaveTimesheet(a)),
    [assignmentsRaw],
  );

  useEffect(() => {
    async function loadData() {
      if (!firestore || !wave.id || !targetDate || !assignments) return;

      const q = query(
        collection(firestore, 'daily_timesheets'),
        where('waveId', '==', wave.id),
        where('date', '==', targetDate),
      );
      const snap = await getDocs(q);
      const existing: Record<string, DailyTimesheet> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as DailyTimesheet;
        existing[data.workerId] = data;
      });

      const newRoster: Record<string, Partial<DailyTimesheet>> = {};
      assignments.forEach((asgn) => {
        if (existing[asgn.workerId]) {
          const ex = existing[asgn.workerId];
          newRoster[asgn.workerId] =
            ex.eventType === 'unpaid_leave' && (ex.normalHours ?? 0) !== 0 ? { ...ex, normalHours: 0 } : ex;
        } else {
          newRoster[asgn.workerId] = {
            workerId: asgn.workerId,
            assignmentId: asgn.id,
            date: targetDate,
            eventType: 'work_day',
            normalHours: contractDefaultDailyHours,
            ot15Hours: 0,
            status: 'DRAFT',
          };
        }
      });
      setRosterData(newRoster);
    }
    void loadData();
  }, [firestore, wave.id, targetDate, assignments, contractDefaultDailyHours]);

  const applyBulk = (field: keyof DailyTimesheet, value: unknown) => {
    if (isWaveMonthPeriodLocked) {
      toast({
        variant: 'destructive',
        title: 'งวดนี้ปิดแล้ว',
        description: 'มีการปิดงวดเดือน / ส่งตรวจแล้ว — แก้ไขไม่ได้ ยกเว้นผู้จัดการปฏิเสธงวด',
      });
      return;
    }
    const updated = { ...rosterData };
    const service = new TimesheetService(firestore!);

    Object.keys(updated).forEach((wid) => {
      const currentStatus = updated[wid].status as DailyTimesheetStatus;
      if (service.canEdit(currentStatus)) {
        updated[wid] = { ...updated[wid], [field]: value };
      }
    });
    setRosterData(updated);
    toast({ title: 'Bulk Apply Complete', description: 'Applied to editable records.' });
  };

  const handleSaveDraft = async () => {
    if (isWaveMonthPeriodLocked) {
      toast({
        variant: 'destructive',
        title: 'งวดนี้ปิดแล้ว',
        description: 'ไม่สามารถบันทึกลงเวลาในช่วงที่ปิดงวด / รอผู้จัดการ / อนุมัติแล้ว',
      });
      return;
    }
    if (!canEditTimesheets) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไข timesheet' });
      return;
    }
    if (!firestore || !currentUser || !wave.id) return;
    setIsSaving(true);
    try {
      const service = new TimesheetService(firestore);
      const poId = wave.poId;

      const payloads: Partial<DailyTimesheet>[] = [];
      for (const ts of Object.values(rosterData)) {
        const worker = workers?.find((w) => w.id === ts.workerId);
        const asgn = assignments?.find((a) => a.id === ts.assignmentId);

        if (ts.status && service.isFinalized(ts.status as DailyTimesheetStatus)) {
          continue;
        }

        const contractId = (asgn?.contractId || po?.contractId || '').trim();
        const poLineId = (asgn?.poLineId || wave.poLineId || '').trim();
        const positionId = (asgn?.positionId || '').trim();
        if (!contractId || !poLineId || !positionId) {
          toast({
            variant: 'destructive',
            title: 'บันทึกไม่ได้ — ข้อมูลไม่ครบ',
            description:
              'ต้องมี contractId, poLineId และ positionId จากการมอบหมาย/PO — ตรวจ Mobilization และบรรทัด PO ของ Wave',
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
          waveId: wave.id,
          siteId: wave.id,
          purchaseOrderId: asgn?.poId || poId,
          poLineId,
          contractId,
          customerId: wave.customerId || '',
          positionId,
          workMode: asgn?.workMode ?? 'OFFSHORE',
          shiftType: 'DAY' as const,
          status: 'DRAFT' as DailyTimesheetStatus,
        });
      }

      if (payloads.length === 0) {
        toast({ title: 'No changes', description: 'All visible records are locked or unchanged.' });
        setIsSaving(false);
        return;
      }

      const results = await service.bulkUpsertTimesheets(payloads as Partial<DailyTimesheet>[], currentUser);
      toast({
        title: 'บันทึกร่างสำเร็จ',
        description: `สร้างใหม่: ${results.created}, อัปเดต: ${results.updated} — ส่งตรวจรอบเดือนทำที่สรุปรายเดือน (Wave)`,
      });
    } catch (e: unknown) {
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="shadow-lg border-none overflow-hidden">
      <CardHeader className="bg-primary/95 text-primary-foreground border-b">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-lg flex flex-wrap items-center gap-2">
              <Waves className="h-5 w-5 shrink-0" />
              <span className="font-mono">{po?.poCode ?? wave.poId}</span>
              <span className="opacity-80">·</span>
              <span className="font-mono">{wave.waveCode}</span>
              <Badge variant="secondary" className="text-[10px] font-normal bg-white/15 text-white border-white/20">
                {wave.status}
              </Badge>
            </CardTitle>
            <CardDescription className="text-primary-foreground/75 text-sm mt-1">
              {waveRoundMonthLabel(wave)} · {wave.siteLocation || '—'}
            </CardDescription>
          </div>
          <Button variant="secondary" size="sm" className="shrink-0" asChild>
            <Link href={`/timesheets/wave-month?month=${encodeURIComponent(monthYm)}`}>
              สรุปลงเวลารายเดือน (ส่งตรวจผู้จัดการ) →
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 space-y-4">
        {isWaveMonthPeriodLocked ? (
          <Alert className="rounded-none border-x-0 border-t-0">
            <AlertTitle>งวด {monthYm} ถูกปิดสำหรับ Wave นี้</AlertTitle>
            <AlertDescription>
              มีการปิดงวดเดือนหรือส่งตรวจผู้จัดการแล้ว — ไม่สามารถแก้ไขลงเวลาในช่วงนี้ได้ (หากถูกปฏิเสธจากผู้จัดการจะปลดล็อกอัตโนมัติ)
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 p-4 bg-muted/20 rounded-none border-b border-dashed">
          <span className="text-xs font-black text-muted-foreground uppercase flex items-center gap-2 mr-2">
            <Zap className="h-4 w-4 text-amber-500" /> Quick Apply (เฉพาะ Wave นี้):
          </span>
          <Button
            size="sm"
            variant="outline"
            className="bg-white border-primary/20"
            disabled={isWaveMonthPeriodLocked}
            onClick={() => applyBulk('eventType', 'work_day')}
          >
            1. Work day
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="bg-white border-primary/20"
            disabled={isWaveMonthPeriodLocked}
            onClick={() => applyBulk('eventType', 'standby_day')}
          >
            2. Standby
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="bg-white border-primary/20 font-semibold"
            disabled={isWaveMonthPeriodLocked}
            onClick={() => applyBulk('normalHours', contractDefaultDailyHours)}
          >
            ตั้งทั้งแผง: {contractDefaultDailyHours} ชม.
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="bg-white border-primary/20"
            disabled={isWaveMonthPeriodLocked}
            onClick={() => applyBulk('normalHours', 8)}
          >
            ตั้งทั้งแผง: 8 ชม.
          </Button>

          <div className="flex w-full min-w-0 flex-1 flex-col gap-3 border-t border-dashed border-muted-foreground/25 pt-3 sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap sm:items-end sm:justify-end sm:gap-3 sm:border-t-0 sm:pt-0 sm:pl-3 sm:border-l sm:border-muted-foreground/25">
            <div className="space-y-1.5 w-full min-w-[11rem] sm:w-auto shrink-0">
              <Label className="text-[10px] font-black uppercase text-muted-foreground">
                วันที่ปฏิบัติงาน (ใช้ร่วมทุก Wave)
              </Label>
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
                disabled={isSaving || !canEditTimesheets || isWaveMonthPeriodLocked}
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                บันทึก
              </Button>
              <span className="text-[10px] text-muted-foreground text-center sm:text-right leading-tight">
                บันทึกเฉพาะ Wave นี้
              </span>
            </div>
          </div>
        </div>

        {!isAsgnLoading && assignmentsRaw && assignmentsRaw.length > 0 && (!assignments || assignments.length === 0) && (
          <div className="px-4">
            <Alert className="border-amber-200 bg-amber-50 text-amber-950">
              <AlertTitle>ยังไม่มีคนที่พร้อมลงเวลาในเวฟนี้</AlertTitle>
              <AlertDescription>
                Wave Board แสดงเฉพาะคนงานที่ <strong>READINESS = ready</strong> และ deployment อยู่ในชุดที่เปิดบอร์ดได้
                — ถ้ามีการมอบหมายแต่ยังไม่ ready ให้ไปแก้ที่ Mobilization ก่อน
              </AlertDescription>
            </Alert>
          </div>
        )}

        {isAsgnLoading ? (
          <div className="py-20 text-center animate-pulse">Loading Roster...</div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-6 py-4 font-bold">พนักงาน (Worker)</TableHead>
                <TableHead className="font-bold">ตำแหน่ง</TableHead>
                <TableHead className="font-bold w-[220px]">ประเภทวัน</TableHead>
                <TableHead className="font-bold text-center w-[110px]">ชั่วโมงปกติ</TableHead>
                <TableHead className="font-bold">สถานะ</TableHead>
                <TableHead className="text-right pr-6">หมายเหตุ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments?.map((asgn) => {
                const worker = workers?.find((w) => w.id === asgn.workerId);
                const raw = rosterData[asgn.workerId];
                const et = raw?.eventType ?? 'work_day';
                const row = {
                  ...raw,
                  eventType: et,
                  normalHours: et === 'unpaid_leave' ? 0 : (raw?.normalHours ?? contractDefaultDailyHours),
                  ot15Hours: raw?.ot15Hours ?? 0,
                  remark: raw?.remark ?? '',
                };
                const tsService = new TimesheetService(firestore!);
                const isLocked = tsService.isFinalized(row.status as DailyTimesheetStatus);
                const rowEditLocked = isLocked || isWaveMonthPeriodLocked;

                return (
                  <TableRow key={asgn.id} className={rowEditLocked ? 'bg-slate-50 opacity-80' : 'hover:bg-muted/20'}>
                    <TableCell className="pl-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-sm text-primary">
                          {worker?.firstName} {worker?.lastName}
                        </span>
                        <span className="text-[9px] font-mono text-muted-foreground uppercase">
                          {worker?.workerCode || asgn.id.substring(0, 8)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{positionLabel(asgn.positionId)}</TableCell>
                    <TableCell>
                              <Select 
                                disabled={rowEditLocked}
                                value={row.eventType}
                        onValueChange={(v: RateConditionEventType) => {
                          const updated = { ...rosterData };
                          const cur = updated[asgn.workerId] ?? {
                            workerId: asgn.workerId,
                            assignmentId: asgn.id,
                            date: targetDate,
                            eventType: 'work_day' as RateConditionEventType,
                            normalHours: contractDefaultDailyHours,
                            ot15Hours: 0,
                            status: 'DRAFT' as DailyTimesheetStatus,
                          };
                          let nextHours = cur.normalHours ?? contractDefaultDailyHours;
                          if (v === 'unpaid_leave') nextHours = 0;
                          else if (cur.eventType === 'unpaid_leave') nextHours = contractDefaultDailyHours;
                          updated[asgn.workerId] = { ...cur, eventType: v, normalHours: nextHours };
                          setRosterData(updated);
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
                          const updated = { ...rosterData };
                          const cur = updated[asgn.workerId] ?? {
                            workerId: asgn.workerId,
                            assignmentId: asgn.id,
                            date: targetDate,
                            eventType: 'work_day' as RateConditionEventType,
                            normalHours: contractDefaultDailyHours,
                            ot15Hours: 0,
                            status: 'DRAFT' as DailyTimesheetStatus,
                          };
                          updated[asgn.workerId] = {
                            ...cur,
                            normalHours: parseInt(e.target.value, 10) || 0,
                          };
                          setRosterData(updated);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                                {(isLocked || isWaveMonthPeriodLocked) && (
                          <span title="Locked Document">
                            <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
                          </span>
                        )}
                        {raw?.status ? (
                          <Badge
                            variant="outline"
                            className={`text-[9px] font-black uppercase ${
                              raw.status === 'CLIENT_APPROVED'
                                ? 'bg-green-50 text-green-700 border-green-200'
                                : raw.status === 'VERIFIED_PAPER'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : raw.status === 'LOCKED'
                                    ? 'bg-slate-900 text-white'
                                    : raw.status === 'OPS_REVIEWED'
                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                      : 'bg-slate-100'
                            }`}
                          >
                            {raw.status}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground italic">No Log</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                              <Input 
                                disabled={rowEditLocked}
                                placeholder="..."
                        className="h-8 text-[10px] text-right"
                        value={row.remark}
                        onChange={(e) => {
                          const updated = { ...rosterData };
                          const cur = updated[asgn.workerId] ?? {
                            workerId: asgn.workerId,
                            assignmentId: asgn.id,
                            date: targetDate,
                            eventType: 'work_day' as RateConditionEventType,
                            normalHours: contractDefaultDailyHours,
                            ot15Hours: 0,
                            status: 'DRAFT' as DailyTimesheetStatus,
                          };
                          updated[asgn.workerId] = { ...cur, remark: e.target.value };
                          setRosterData(updated);
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CardFooter className="bg-muted/20 border-t py-3 justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground italic">
          <Info className="h-4 w-4 text-primary shrink-0" />
          ค่าเริ่มต้นชม. ต่อวัน = {contractDefaultDailyHours} (จาก PO / สัญญา)
        </div>
        <Button variant="link" className="text-xs h-auto p-0" asChild>
          <Link href={`/timesheets/wave-month?month=${encodeURIComponent(monthYm)}`}>
            ส่งตรวจรอบเดือน (ศูนย์อนุมัติ) <ChevronRight className="h-3 w-3 inline" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function WaveTimesheetBoardPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { toast } = useToast();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewTimesheets = useMemo(
    () => (useMatrixGuards ? canAccess(currentUser, 'timesheets', 'view') : canView(currentUser, 'timesheets')),
    [currentUser, useMatrixGuards],
  );
  const canEditTimesheets = useMemo(
    () => (useMatrixGuards ? canAccess(currentUser, 'timesheets', 'edit') : canEdit(currentUser, 'timesheets')),
    [currentUser, useMatrixGuards],
  );

  const [targetDate, setTargetDate] = useState(() => timestampToHtmlDateValue(Date.now()));
  const [dateConfirmOpen, setDateConfirmOpen] = useState(false);
  const [pendingDateChangeMs, setPendingDateChangeMs] = useState<number | null>(null);

  const firestore = useFirestore();

  const poQuery = useMemoFirebase(
    () =>
      firestore && canViewTimesheets
        ? query(collection(firestore, 'purchase_orders'), where('status', 'in', ['pending', 'active']))
        : null,
    [firestore, canViewTimesheets],
  );
  const { data: pos, isLoading: posLoading } = useCollection<PurchaseOrder>(poQuery as any);

  const waveQuery = useMemoFirebase(() => {
    if (!firestore || !canViewTimesheets) return null;
    return query(collection(firestore, 'waves'), where('status', 'in', OPEN_WAVE_STATUSES_FOR_TIMESHEET));
  }, [firestore, canViewTimesheets]);
  const { data: allOpenWaves, isLoading: wavesLoading } = useCollection<Wave>(waveQuery as any);

  const openPoIdSet = useMemo(() => new Set((pos ?? []).map((p) => p.id)), [pos]);

  const sortedWaves = useMemo(() => {
    const list = (allOpenWaves ?? []).filter((w) => openPoIdSet.has(w.poId));
    const poById = new Map((pos ?? []).map((p) => [p.id, p]));
    return [...list].sort((a, b) => {
      const pa = poById.get(a.poId)?.poCode ?? '';
      const pb = poById.get(b.poId)?.poCode ?? '';
      if (pa !== pb) return pa.localeCompare(pb, 'th');
      return (a.waveCode || '').localeCompare(b.waveCode || '', 'th');
    });
  }, [allOpenWaves, openPoIdSet, pos]);

  const workersQuery = useMemoFirebase(
    () => (firestore && canViewTimesheets ? collection(firestore, 'workers') : null),
    [firestore, canViewTimesheets],
  );
  const { data: workers } = useCollection<Worker>(workersQuery as any);

  const positionsQuery = useMemoFirebase(
    () => (firestore && canViewTimesheets ? collection(firestore, 'positions') : null),
    [firestore, canViewTimesheets],
  );
  const { data: positions } = useCollection<Position>(positionsQuery as any);
  const positionLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of positions ?? []) {
      m.set(p.id, positionListPrimaryName(p as PositionDoc));
    }
    return (id?: string) => (id && m.get(id)) || id || '—';
  }, [positions]);

  const poById = useMemo(() => new Map((pos ?? []).map((p) => [p.id, p])), [pos]);

  const notifyMonthReviewIfLocked = useCallback(
    async (htmlDate: string) => {
      if (!firestore || sortedWaves.length === 0) return;
      const ym = htmlDate.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) return;
      const snap = await getDocs(
        query(collection(firestore, 'wave_month_timesheet_reviews'), where('yearMonth', '==', ym)),
      );
      const waveIdSet = new Set(sortedWaves.map((w) => w.id));
      for (const d of snap.docs) {
        const r = d.data() as WaveMonthTimesheetReview;
        if (!waveIdSet.has(r.waveId)) continue;
        if (r.status === 'pending_manager_review' || r.status === 'approved') {
          toast({
            variant: 'destructive',
            title: 'แก้ไขไม่ได้ในช่วงนี้',
            description: 'ไม่สามารถแก้ไขได้เนื่องจากได้มีการส่งเพื่อตรวจสอบแล้ว',
          });
          return;
        }
      }
    },
    [firestore, sortedWaves, toast],
  );

  const applyBoardDate = useCallback(
    async (ms: number) => {
      const next = timestampToHtmlDateValue(ms);
      setTargetDate(next);
      await notifyMonthReviewIfLocked(next);
    },
    [notifyMonthReviewIfLocked],
  );

  const handleBoardDateChange = useCallback(
    (ms: number) => {
      const next = timestampToHtmlDateValue(ms);
      if (next === targetDate) return;

      void (async () => {
        if (!firestore || sortedWaves.length === 0) {
          await applyBoardDate(ms);
          return;
        }
        const waveIds = sortedWaves.map((w) => w.id);
        const hasSaved = await hasDailyTimesheetsForDate(firestore, next, waveIds);
        if (hasSaved) {
          setPendingDateChangeMs(ms);
          setDateConfirmOpen(true);
          return;
        }
        await applyBoardDate(ms);
      })();
    },
    [applyBoardDate, firestore, sortedWaves, targetDate],
  );

  const loading = posLoading || wavesLoading;

  if (userLoading || !currentUser) return null;
  if (!canViewTimesheets) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto w-full min-w-0 max-w-[1600px] space-y-6">
        <section className="w-full space-y-2">
          <PayrollScopeTag scope="worker" showHint={false} />
          <Button variant="link" className="h-auto p-0 text-sm text-muted-foreground" asChild>
            <Link href="/timesheets">← กลับไปภาพรวม PO / Wave</Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight text-primary">
            <Waves className="mr-3 inline-block h-8 w-8 align-middle text-primary" aria-hidden />
            คีย์ลงเวลาแบบกลุ่ม (Wave Daily Board)
          </h1>
          <p className="text-muted-foreground text-lg max-w-4xl">
            <strong>Worker Payroll</strong> — ลงชั่วโมงและประเภทวันต่อคน <strong>ตาม Wave</strong> ในวันที่เลือก
            บันทึกที่นี่เป็น <strong>ร่าง (DRAFT)</strong> เท่านั้น — การส่งให้ผู้จัดการตรวจทำที่{' '}
            <Link href="/timesheets/wave-month" className="text-primary font-semibold underline">
              สรุปลงเวลารายเดือน
            </Link>{' '}
            (รอบเดือน)
          </p>
        </section>

        <PageGuidance
          title="คู่มือการบันทึกแบบกลุ่ม"
          tips={[
            'เลือกวันที่เดียว — แต่ละการ์ด = หนึ่ง Wave (ทุก PO/Wave ที่ยังไม่ปิด)',
            'แต่ละ Wave บันทึกร่างแยกกัน — ไม่มีการยืนยัน/ส่งตรวจรายวันที่นี่',
            'ส่งตรวจให้ Operations / HR Manager: ไปที่สรุปรายเดือน แล้วกดส่งตรวจรอบเดือนต่อ Wave',
            'แถวที่ล็อกแล้วแก้ไม่ได้ — รายการที่ยังไม่ finalize เท่านั้นที่ปรับใน Bulk ได้',
            'เลือกวันที่ที่เคยบันทึกแล้ว ระบบจะถามยืนยันก่อน — หากเดือนนั้นส่งตรวจ/อนุมัติแล้วจะแจ้งเตือนเมื่อเปลี่ยนวันที่',
          ]}
        />

        <p className="text-sm text-muted-foreground">
          แสดง {sortedWaves.length} Wave ที่ยังไม่ปิด
          {pos != null ? ` · ${pos.length} PO (pending/active)` : ''}
        </p>

        {loading ? (
          <p className="text-center text-muted-foreground py-12">กำลังโหลด…</p>
        ) : sortedWaves.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 border border-dashed rounded-lg">
            ไม่มี Wave ที่ยังไม่ปิดสำหรับ PO ที่เปิดอยู่
          </p>
        ) : (
          <div className="space-y-8">
            {sortedWaves.map((wave) => (
              <WaveBoardBlock
                key={`${wave.id}-${targetDate}`}
                wave={wave}
                po={poById.get(wave.poId)}
                targetDate={targetDate}
                onBoardDateChange={handleBoardDateChange}
                currentUser={currentUser}
                workers={workers ?? undefined}
                positionLabel={positionLabel}
                canEditTimesheets={canEditTimesheets}
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={dateConfirmOpen}
        onOpenChange={(open) => {
          setDateConfirmOpen(open);
          if (!open) setPendingDateChangeMs(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>มีการบันทึกเวลาวันนี้แล้ว</AlertDialogTitle>
            <AlertDialogDescription>
              พบข้อมูลลงเวลาในวันที่เลือกอยู่แล้วในฐานข้อมูล — ต้องการแก้ไขหรือไม่?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={() => {
                if (pendingDateChangeMs == null) return;
                const ms = pendingDateChangeMs;
                setPendingDateChangeMs(null);
                void applyBoardDate(ms);
              }}
            >
              ต้องการแก้ไข
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
