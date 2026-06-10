'use client';

import { useMemo, useState } from 'react';
import {
  collection,
  Firestore,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { addMonths, format, startOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useCollection, useMemoFirebase } from '@/firebase';
import {
  ATTENDANCE_DAY_OVERRIDES_COLLECTION,
  ATTENDANCE_PUNCHES_COLLECTION,
} from '@/lib/attendance/constants';
import { formatBangkokHmFromUtcMs } from '@/lib/attendance/bangkok-calendar';
import { effectiveAttendanceHistoryDayRows } from '@/lib/attendance/correction-merge';
import type { AttendanceDayOverrideDoc, AttendancePunchDoc, AttendanceSubjectType } from '@/lib/attendance/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateThaiBE } from '@/lib/date-thai';

function TimeCell(props: { ms: number | null; corrected: boolean }) {
  const { ms, corrected } = props;
  if (ms == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="font-mono text-sm whitespace-nowrap">
      {formatBangkokHmFromUtcMs(ms)}
      {corrected ? (
        <Badge variant="secondary" className="ml-2 text-[9px] font-normal">
          หลังแก้
        </Badge>
      ) : null}
    </span>
  );
}

export function SubjectAttendanceHistory(props: {
  firestore: Firestore;
  subjectType: AttendanceSubjectType;
  subjectId: string;
  title?: string;
  description?: string;
}) {
  const { firestore, subjectType, subjectId, title, description } = props;
  const subjectKey = `${subjectType}:${subjectId}`;

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const payrollMonth = format(viewMonth, 'yyyy-MM');
  const monthLabel = format(viewMonth, 'MMMM yyyy');

  const punchRange = useMemo(() => {
    const startMs = viewMonth.getTime();
    const endExclusiveMs = addMonths(viewMonth, 1).getTime();
    return { startMs, endExclusiveMs };
  }, [viewMonth]);

  const punchesQuery = useMemoFirebase(() => {
    if (!subjectId) return null;
    return query(
      collection(firestore, ATTENDANCE_PUNCHES_COLLECTION),
      where('subjectType', '==', subjectType),
      where('subjectId', '==', subjectId),
      where('punchedAt', '>=', punchRange.startMs),
      where('punchedAt', '<', punchRange.endExclusiveMs),
      orderBy('punchedAt', 'desc'),
    );
  }, [firestore, subjectType, subjectId, punchRange.startMs, punchRange.endExclusiveMs]);

  const overridesQuery = useMemoFirebase(() => {
    if (!subjectId) return null;
    return query(
      collection(firestore, ATTENDANCE_DAY_OVERRIDES_COLLECTION),
      where('subjectKey', '==', subjectKey),
      where('payrollMonth', '==', payrollMonth),
    );
  }, [firestore, subjectId, subjectKey, payrollMonth]);

  const { data: punches, isLoading: punchesLoading, error: punchesError } =
    useCollection<AttendancePunchDoc>(punchesQuery as any);
  const { data: overrides, isLoading: overridesLoading, error: overridesError } =
    useCollection<AttendanceDayOverrideDoc>(overridesQuery as any);

  const rows = useMemo(
    () =>
      effectiveAttendanceHistoryDayRows(punches ?? [], overrides ?? []).filter((r) =>
        r.ymd.startsWith(payrollMonth),
      ),
    [punches, overrides, payrollMonth],
  );

  const isLoading = punchesLoading || overridesLoading;
  const error = punchesError ?? overridesError;

  return (
    <Card className="shadow-sm">
      <CardHeader className="bg-muted/30 border-b py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-lg">{title ?? 'ประวัติการลงเวลา (Kiosk)'}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setViewMonth(startOfMonth(new Date()))}
            >
              เดือนนี้
            </Button>
            <Button
              variant="outline"
              size="icon"
              type="button"
              className="h-9 w-9"
              aria-label="เดือนก่อน"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Label htmlFor="attendance-history-month" className="sr-only">
              เลือกเดือน
            </Label>
            <Input
              id="attendance-history-month"
              type="month"
              className="h-9 w-[9.5rem] tabular-nums"
              value={payrollMonth}
              onChange={(e) => {
                const v = e.target.value;
                if (!/^\d{4}-\d{2}$/.test(v)) return;
                const [y, m] = v.split('-').map(Number);
                setViewMonth(startOfMonth(new Date(y, m - 1, 1)));
              }}
            />
            <Button
              variant="outline"
              size="icon"
              type="button"
              className="h-9 w-9"
              aria-label="เดือนถัดไป"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="hidden lg:inline text-xs text-muted-foreground tabular-nums">{monthLabel}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดประวัติ…
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive py-2">
            โหลดไม่สำเร็จ — {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">ไม่มีบันทึกการลงเวลาในเดือนนี้</p>
        )}
        {!isLoading && !error && rows.length > 0 && (
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/3">วันที่</TableHead>
                <TableHead className="w-1/3">เข้างาน</TableHead>
                <TableHead className="w-1/3">ออกงาน</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.ymd}>
                  <TableCell className="w-1/3 font-mono text-sm whitespace-nowrap align-top">
                    {formatDateThaiBE(r.ymd)}
                  </TableCell>
                  <TableCell className="w-1/3 align-top">
                    <TimeCell ms={r.inMs} corrected={r.inCorrected} />
                  </TableCell>
                  <TableCell className="w-1/3 align-top">
                    <TimeCell ms={r.outMs} corrected={r.outCorrected} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
