'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  collection,
  query,
  where,
  orderBy,
  Firestore,
} from 'firebase/firestore';
import { addMonths, format, startOfMonth } from 'date-fns';
import { AppShell } from '@/components/layout/app-shell';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { canAccessHrAttendanceKioskPages } from '@/lib/navigation/nav-access';
import type { User } from '@/lib/types';
import { ATTENDANCE_PUNCHES_COLLECTION } from '@/lib/attendance/constants';
import type { AttendancePunchDoc, AttendanceSubjectType } from '@/lib/attendance/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { formatDateTimeThaiBE } from '@/lib/date-thai';

type SubjectKey = `${AttendanceSubjectType}:${string}`;

function subjectKey(subjectType: AttendanceSubjectType, subjectId: string): SubjectKey {
  return `${subjectType}:${subjectId}`;
}

function groupBySubject(rows: Array<AttendancePunchDoc & { id: string }>): Map<SubjectKey, AttendancePunchDoc[]> {
  const m = new Map<SubjectKey, AttendancePunchDoc[]>();
  for (const r of rows) {
    const k = subjectKey(r.subjectType, r.subjectId);
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  for (const [, arr] of m) {
    arr.sort((a, b) => (b.punchedAt ?? 0) - (a.punchedAt ?? 0));
  }
  return m;
}

export default function HrAttendanceManagePage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [search, setSearch] = useState('');
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  const range = useMemo(() => {
    const startMs = viewMonth.getTime();
    const endExclusiveMs = addMonths(viewMonth, 1).getTime();
    return { startMs, endExclusiveMs };
  }, [viewMonth]);

  const canUse = useMemo(
    () => !!currentUser && canAccessHrAttendanceKioskPages(currentUser as User, null),
    [currentUser],
  );

  const punchesQuery = useMemoFirebase(() => {
    if (!firestore || !canUse) return null;
    return query(
      collection(firestore as Firestore, ATTENDANCE_PUNCHES_COLLECTION),
      where('punchedAt', '>=', range.startMs),
      where('punchedAt', '<', range.endExclusiveMs),
      orderBy('punchedAt', 'desc'),
    );
  }, [firestore, canUse, range.startMs, range.endExclusiveMs]);

  const { data: punchRows, isLoading: punchesLoading, error: punchesError } =
    useCollection<AttendancePunchDoc>(punchesQuery as any);

  const grouped = useMemo(() => groupBySubject((punchRows ?? []) as any), [punchRows]);

  const summaryRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const entries = [...grouped.entries()].map(([key, punches]) => {
      const name = punches[0]?.subjectNameSnapshot ?? key;
      const inCount = punches.filter((p) => p.direction === 'IN').length;
      const outCount = punches.filter((p) => p.direction === 'OUT').length;
      const last = punches[0];
      return { key, name, punches, inCount, outCount, last };
    });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'th'));
    if (!q) return entries;
    return entries.filter((r) => r.name.toLowerCase().includes(q));
  }, [grouped, search]);

  const toggleOpen = (key: string) => {
    setOpenRows((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">
        กำลังโหลด…
      </div>
    );
  }

  if (!canUse) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">
          คุณไม่มีสิทธิ์เข้าถึงเมนูนี้
        </div>
      </AppShell>
    );
  }

  const monthLabel = format(viewMonth, 'MMMM yyyy');

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" asChild className="shrink-0 mt-0.5">
              <Link href="/timesheets">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-primary">จัดการการลงเวลา</h1>
              <p className="text-sm text-muted-foreground mt-1">
                สรุปการลงเวลาผ่าน Kiosk (QR) รายเดือน — พนักงานที่มีบันทึกในเดือนที่เลือก
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              aria-label="เดือนก่อน"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold tabular-nums min-w-[9rem] text-center">{monthLabel}</span>
            <Button
              variant="outline"
              size="icon"
              type="button"
              aria-label="เดือนถัดไป"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-lg">สรุปรายเดือน</CardTitle>
            <CardDescription>
              ค้นหาชื่อพนักงาน — ขยายแถวเพื่อดูบันทึกเข้า/ออกทั้งหมดในเดือน
            </CardDescription>
            <div className="pt-2 max-w-md">
              <Input
                placeholder="Search employee…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="ค้นหาพนักงาน"
              />
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {punchesLoading && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
                <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดข้อมูล…
              </div>
            )}
            {punchesError && (
              <p className="text-sm text-destructive py-4">
                โหลดไม่สำเร็จ —{' '}
                {punchesError instanceof Error ? punchesError.message : String(punchesError)}
              </p>
            )}
            {!punchesLoading && !punchesError && summaryRows.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">
                ไม่มีบันทึกการลงเวลาผ่าน Kiosk ในเดือนนี้
              </p>
            )}
            {!punchesLoading && !punchesError && summaryRows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>พนักงาน</TableHead>
                    <TableHead className="text-right">ครั้งเข้า (IN)</TableHead>
                    <TableHead className="text-right">ครั้งออก (OUT)</TableHead>
                    <TableHead>ลงเวลาล่าสุด</TableHead>
                    <TableHead className="w-24 text-right">โปรไฟล์</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryRows.map((row) => {
                    const colon = row.key.indexOf(':');
                    const st = row.key.slice(0, colon) as AttendanceSubjectType;
                    const sid = row.key.slice(colon + 1);
                    const href =
                      st === 'office_staff'
                        ? `/office-staff/${sid}?tab=attendance`
                        : `/workers/${sid}?tab=monthly_timesheet`;
                    const isOpen = !!openRows[row.key];
                    return (
                      <Fragment key={row.key}>
                        <TableRow className="hover:bg-muted/40">
                          <TableCell className="align-top">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              type="button"
                              onClick={() => toggleOpen(row.key)}
                              aria-expanded={isOpen}
                            >
                              <ChevronDown
                                className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                              />
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium align-top">
                            <div className="flex flex-col gap-0.5">
                              <span>{row.name}</span>
                              <span className="text-[11px] text-muted-foreground font-normal">
                                {st === 'office_staff' ? 'พนักงานออฟฟิศ' : 'ลูกจ้าง'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right align-top tabular-nums">{row.inCount}</TableCell>
                          <TableCell className="text-right align-top tabular-nums">{row.outCount}</TableCell>
                          <TableCell className="align-top text-sm text-muted-foreground whitespace-nowrap">
                            {row.last ? formatDateTimeThaiBE(row.last.punchedAt) : '—'}
                          </TableCell>
                          <TableCell className="text-right align-top">
                            <Button variant="outline" size="sm" className="h-8 gap-1" asChild>
                              <Link href={href}>
                                <ExternalLink className="h-3.5 w-3.5" /> เปิด
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/10 hover:bg-muted/10 border-b">
                            <TableCell colSpan={6} className="p-3">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>วันเวลา</TableHead>
                                    <TableHead>การกระทำ</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {row.punches.map((p, idx) => (
                                    <TableRow key={`${row.key}-${p.punchedAt}-${p.direction}-${idx}`}>
                                      <TableCell className="font-mono text-sm whitespace-nowrap">
                                        {formatDateTimeThaiBE(p.punchedAt)}
                                      </TableCell>
                                      <TableCell>
                                        <Badge
                                          variant={p.direction === 'IN' ? 'default' : 'secondary'}
                                          className="font-normal"
                                        >
                                          {p.direction === 'IN' ? 'เข้างาน (IN)' : 'ออกงาน (OUT)'}
                                        </Badge>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button variant="secondary" asChild>
            <Link href="/hr/attendance/kiosk">ไปหน้า Kiosk (QR)</Link>
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
