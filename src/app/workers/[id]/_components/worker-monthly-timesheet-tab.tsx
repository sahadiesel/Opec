'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { DailyTimesheet, User } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { formatDateThaiBE } from '@/lib/date-thai';
import { canView } from '@/lib/permissions';

function dateToYearMonth(dateStr: string): string | null {
  const t = dateStr?.trim();
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(t);
  return m ? `${m[1]}-${m[2]}` : null;
}

function fmtHours(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  return n.toLocaleString('th-TH', { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 });
}

export function WorkerMonthlyTimesheetTab(props: {
  rows: DailyTimesheet[] | null;
  isLoading: boolean;
  error?: Error | null;
  currentUser: User | null;
}) {
  const { rows, isLoading, error, currentUser } = props;
  const canOpenWaveMonth = Boolean(currentUser && canView(currentUser, 'timesheets'));

  const monthRows = useMemo(() => {
    if (!rows?.length) return [];
    const map = new Map<
      string,
      {
        yearMonth: string;
        dates: Set<string>;
        rowCount: number;
        normal: number;
        ot15: number;
        ot20: number;
        ot30: number;
        holiday: number;
      }
    >();

    for (const ts of rows) {
      const ym = dateToYearMonth(ts.date);
      if (!ym) continue;
      let g = map.get(ym);
      if (!g) {
        g = {
          yearMonth: ym,
          dates: new Set(),
          rowCount: 0,
          normal: 0,
          ot15: 0,
          ot20: 0,
          ot30: 0,
          holiday: 0,
        };
        map.set(ym, g);
      }
      g.dates.add(ts.date);
      g.rowCount += 1;
      g.normal += Number(ts.normalHours || 0);
      g.ot15 += Number(ts.ot15Hours || 0);
      g.ot20 += Number(ts.ot20Hours || 0);
      g.ot30 += Number(ts.ot30Hours || 0);
      g.holiday += Number(ts.holidayHours || 0);
    }

    return [...map.values()]
      .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
      .map((g) => {
        const paidHours = g.normal + g.ot15 + g.ot20 + g.ot30 + g.holiday;
        return {
          ...g,
          daysWorked: g.dates.size,
          paidHours,
        };
      });
  }, [rows]);

  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b bg-muted/30 py-4">
        <CardTitle className="text-lg">สรุปลงเวลารายเดือน (Timesheet)</CardTitle>
        <CardDescription>
          สรุปจากแถวรายวันใน <code className="text-xs">daily_timesheets</code> ของคนงานนี้ — แถวละหนึ่งเดือน (ค.ศ.
          yyyy-MM) ไม่ใช่การสแกน Kiosk
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด timesheet…
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive py-2">
            โหลดไม่สำเร็จ — {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        {!isLoading && !error && monthRows.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">ยังไม่มีแถวรายวันในระบบสำหรับคนงานนี้</p>
        )}
        {!isLoading && !error && monthRows.length > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>งวดเดือน</TableHead>
                  <TableHead className="text-right">วันที่มีบันทึก</TableHead>
                  <TableHead className="text-right">แถวรายวัน</TableHead>
                  <TableHead className="text-right">ปกติ</TableHead>
                  <TableHead className="text-right">OT 1.5</TableHead>
                  <TableHead className="text-right">OT 2.0</TableHead>
                  <TableHead className="text-right">OT 3.0</TableHead>
                  <TableHead className="text-right">Holiday</TableHead>
                  <TableHead className="text-right">รวม (ชม.)</TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthRows.map((r) => {
                  const labelFirstDay = formatDateThaiBE(`${r.yearMonth}-01`);
                  return (
                    <TableRow key={r.yearMonth}>
                      <TableCell>
                        <span className="font-mono text-xs font-semibold">{r.yearMonth}</span>
                        <div className="text-xs text-muted-foreground">วันที่ 1 เดือนนั้น: {labelFirstDay}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.daysWorked}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.rowCount}</TableCell>
                      <TableCell className="text-right tabular-nums font-mono text-xs">{fmtHours(r.normal)}</TableCell>
                      <TableCell className="text-right tabular-nums font-mono text-xs">{fmtHours(r.ot15)}</TableCell>
                      <TableCell className="text-right tabular-nums font-mono text-xs">{fmtHours(r.ot20)}</TableCell>
                      <TableCell className="text-right tabular-nums font-mono text-xs">{fmtHours(r.ot30)}</TableCell>
                      <TableCell className="text-right tabular-nums font-mono text-xs">{fmtHours(r.holiday)}</TableCell>
                      <TableCell className="text-right tabular-nums font-mono text-xs font-medium">
                        {fmtHours(r.paidHours)}
                      </TableCell>
                      <TableCell className="text-right">
                        {canOpenWaveMonth ? (
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/timesheets/wave-month?month=${encodeURIComponent(r.yearMonth)}`}>
                              เปิดสรุปเดือน
                            </Link>
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
