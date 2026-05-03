'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronLeft, Loader2, Users2 } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import type { Customer, CustomerMonthTimesheetDocument, DailyTimesheet, PurchaseOrder, User } from '@/lib/types';
import { useAppUser } from '@/hooks/use-app-user';
import { canAccess, canView, isMatrixControlledRole } from '@/lib/permissions';
import { PageGuidance } from '@/components/layout/page-guidance';
import { PayrollScopeTag } from '@/components/hr/payroll-scope-tag';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';
import { formatThaiYearMonthLabel } from '@/lib/ops/timesheet-hub-po-month';
import {
  countDailiesByCustomerWorkMode,
  customerMonthTimesheetDocId,
  deriveCustomerWorkModeKeysFromDailies,
} from '@/lib/timesheet/customer-month-timesheet-bridge';
import { ensureCustomerMonthTimesheetDocument } from '@/lib/timesheet/ensure-customer-month-timesheet-document';

function ymNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function CustomerMonthTimesheetPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const useMatrixGuards = isMatrixControlledRole(currentUser);
  const canViewTs = useMemo(
    () => (useMatrixGuards ? canAccess(currentUser, 'timesheets', 'view') : canView(currentUser, 'timesheets')),
    [currentUser, useMatrixGuards],
  );

  const [monthYm, setMonthYm] = useState(ymNow);
  const [allMonthSheetsRaw, setAllMonthSheetsRaw] = useState<DailyTimesheet[] | null>(null);
  const [tsLoading, setTsLoading] = useState(true);
  const [shellById, setShellById] = useState<Map<string, CustomerMonthTimesheetDocument>>(() => new Map());
  const [shellEnsureBusy, setShellEnsureBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    const m = p.get('month');
    if (m && /^\d{4}-\d{2}$/.test(m)) setMonthYm(m);
  }, []);

  const poQuery = useMemoFirebase(
    () =>
      firestore && canViewTs
        ? query(collection(firestore, 'purchase_orders'), where('status', 'in', ['pending', 'active']))
        : null,
    [firestore, canViewTs],
  );
  const { data: pos, isLoading: posLoading } = useCollection<PurchaseOrder>(poQuery as any);

  const customersQuery = useMemoFirebase(
    () => (firestore && canViewTs ? collection(firestore, 'customers') : null),
    [firestore, canViewTs],
  );
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const openPoIdSet = useMemo(() => new Set((pos ?? []).map((p) => p.id)), [pos]);

  const monthStart = `${monthYm}-01`;
  const monthEnd = lastDayOfCalendarMonth(monthYm);

  const tsQuery = useMemoFirebase(() => {
    if (!firestore || !canViewTs) return null;
    return query(
      collection(firestore, 'daily_timesheets'),
      where('date', '>=', monthStart),
      where('date', '<=', monthEnd),
    );
  }, [firestore, canViewTs, monthStart, monthEnd]);

  useEffect(() => {
    if (!tsQuery) {
      setAllMonthSheetsRaw(null);
      setTsLoading(false);
      return;
    }
    setTsLoading(true);
    const unsub = onSnapshot(
      tsQuery,
      (snap) => {
        setAllMonthSheetsRaw(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as DailyTimesheet)));
        setTsLoading(false);
      },
      (err) => {
        console.warn('[customer-month] daily_timesheets:', err.code, err.message);
        setAllMonthSheetsRaw([]);
        setTsLoading(false);
      },
    );
    return () => unsub();
  }, [tsQuery]);

  const monthSheetsForOpenPos = useMemo(() => {
    if (!allMonthSheetsRaw?.length || openPoIdSet.size === 0) return [];
    return allMonthSheetsRaw.filter((t) => openPoIdSet.has(t.purchaseOrderId));
  }, [allMonthSheetsRaw, openPoIdSet]);

  const cmKeys = useMemo(
    () => deriveCustomerWorkModeKeysFromDailies(monthSheetsForOpenPos),
    [monthSheetsForOpenPos],
  );

  const cmKeysSig = useMemo(() => cmKeys.map((k) => `${k.customerId}|${k.workMode}`).sort().join(','), [cmKeys]);

  const countsByPair = useMemo(() => countDailiesByCustomerWorkMode(monthSheetsForOpenPos), [monthSheetsForOpenPos]);

  const poHintByPair = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of monthSheetsForOpenPos) {
      const cid = (t.customerId || '').trim();
      const wm = t.workMode;
      if (!cid || (wm !== 'ONSHORE' && wm !== 'OFFSHORE')) continue;
      const k = `${cid}|${wm}`;
      if (!m.has(k)) m.set(k, t.purchaseOrderId);
    }
    return m;
  }, [monthSheetsForOpenPos]);

  const customerRows = useMemo(() => {
    const ids = [...new Set(cmKeys.map((k) => k.customerId))].sort((a, b) => a.localeCompare(b));
    const custById = new Map((customers ?? []).map((c) => [c.id, c]));
    return ids.map((customerId) => ({
      customerId,
      customerName: custById.get(customerId)?.name?.trim() || customerId,
      hasOn: cmKeys.some((k) => k.customerId === customerId && k.workMode === 'ONSHORE'),
      hasOff: cmKeys.some((k) => k.customerId === customerId && k.workMode === 'OFFSHORE'),
    }));
  }, [cmKeys, customers]);

  useEffect(() => {
    if (!firestore || !currentUser || !canViewTs || !/^\d{4}-\d{2}$/.test(monthYm)) return;
    if (cmKeys.length === 0) {
      setShellById(new Map());
      setShellEnsureBusy(false);
      return;
    }
    let cancelled = false;
    setShellEnsureBusy(true);
    void (async () => {
      const next = new Map<string, CustomerMonthTimesheetDocument>();
      const custById = new Map((customers ?? []).map((c) => [c.id, c]));
      for (const { customerId, workMode } of cmKeys) {
        try {
          const nameSnap = custById.get(customerId)?.name?.trim();
          const docRow = await ensureCustomerMonthTimesheetDocument(
            firestore,
            monthYm,
            customerId,
            workMode,
            currentUser as User,
            nameSnap,
          );
          next.set(docRow.id, docRow);
        } catch (e) {
          console.error('[customer-month] ensure shell', customerId, workMode, e);
        }
      }
      if (!cancelled) setShellById(next);
      if (!cancelled) setShellEnsureBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, currentUser, canViewTs, monthYm, cmKeysSig, customers]);

  if (userLoading || !currentUser) return null;
  if (!canViewTs) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }

  const loading = tsLoading || posLoading;

  const cellShell = (customerId: string, mode: 'ONSHORE' | 'OFFSHORE') => {
    const pairKey = `${customerId}|${mode}`;
    const count = countsByPair.get(pairKey) ?? 0;
    const docId = customerMonthTimesheetDocId(customerId, monthYm, mode);
    const row = docId ? shellById.get(docId) : undefined;
    const poId = poHintByPair.get(pairKey);

    if (!row && count === 0) {
      return <span className="text-muted-foreground text-xs">—</span>;
    }

    return (
      <div className="space-y-1">
        {row?.timesheetNo ? (
          <Badge variant="outline" className="font-mono text-[10px]">
            {row.timesheetNo}
          </Badge>
        ) : shellEnsureBusy ? (
          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> ออกเลข…
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
        <div className="text-[10px] text-muted-foreground">{count} แถวรายวัน</div>
        {poId ? (
          <Link
            href={`/timesheets/po-month?month=${encodeURIComponent(monthYm)}&highlightPo=${encodeURIComponent(poId)}`}
            className="text-[10px] text-primary font-medium underline block"
          >
            เอกสาร PO+เดือน (ตัวอย่าง PO)
          </Link>
        ) : null}
      </div>
    );
  };

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-[1100px] space-y-6 px-2 pb-10 lg:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <PayrollScopeTag scope="worker" showHint={false} />
            <Button variant="link" className="h-auto p-0 text-sm text-muted-foreground" asChild>
              <Link href="/timesheets">
                <ChevronLeft className="mr-1 inline h-4 w-4" />
                กลับศูนย์ลงเวลา
              </Link>
            </Button>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2 lg:text-3xl">
              <Users2 className="h-7 w-7 lg:h-8 lg:w-8 shrink-0" />
              Timesheet รายเดือนตามลูกค้า × Onshore / Offshore
            </h1>
            <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
              แยก<strong>หนึ่งใบต่อลูกค้าต่อโหมดงานต่อเดือน</strong> (ลูกค้า A มีทั้ง onshore และ offshore = 2 ใบ) — สังเคราะห์จาก{' '}
              <span className="font-mono">daily_timesheets</span> ในเดือนที่เลือกที่อยู่ภายใต้ PO ที่ยัง pending/active · เลขอ้างอิง{' '}
              <span className="font-mono">CTX-</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/timesheets/wave-month?month=${encodeURIComponent(monthYm)}`}>สรุปราย wave</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/timesheets/po-month?month=${encodeURIComponent(monthYm)}`}>เอกสาร PO+เดือน</Link>
            </Button>
          </div>
        </div>

        <PageGuidance
          title="เฟส 2 — การใช้งาน"
          tips={[
            'เลขที่ CTX- สร้างอัตโนมัติเมื่อมีรายวันในเดือนนั้นที่มี customerId + workMode ครบ',
            'ปิดงวด / ส่งอนุมัติหลักยังทำผ่านเอกสาร PO+เดือน (และ workflow เดิม) — หน้านี้เป็น “หัวใบ” ตามลูกค้าและโหมด',
            'ลิงก์ “เอกสาร PO+เดือน” เป็นตัวอย่าง PO หนึ่งใบที่มีข้อมูลในโหมดนั้น — ถ้ามีหลาย PO ให้ใช้เมนู PO+เดือนเพื่อเลือกใบอื่น',
          ]}
        />

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">ตัวกรอง</CardTitle>
            <CardDescription>เดือนปฏิทิน (ปี-เดือน) — ข้อมูลรายวันโหลดแบบเรียลไทม์</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">เดือน</Label>
              <Input type="month" value={monthYm} onChange={(e) => setMonthYm(e.target.value)} className="h-10 w-[200px]" />
            </div>
            <p className="text-sm text-muted-foreground pb-1">
              {formatThaiYearMonthLabel(monthYm, 'th-TH')} · PO เปิด/pending {openPoIdSet.size} ใบ
            </p>
          </CardContent>
        </Card>

        {loading ? (
          <p className="text-center text-muted-foreground py-12 inline-flex items-center justify-center gap-2 w-full">
            <Loader2 className="h-5 w-5 animate-spin" /> กำลังโหลด…
          </p>
        ) : customerRows.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 border border-dashed rounded-lg">
            ไม่มีรายวันในเดือนนี้ที่ผูกลูกค้าและโหมด Onshore/Offshore ภายใต้ PO ที่เปิดอยู่ — ลงเวลาจาก Mob / กระดาน PO ก่อน
          </p>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">หัวเอกสารต่อลูกค้า</CardTitle>
              <CardDescription>คอลัมน์ Onshore / Offshore แสดงเมื่อมีข้อมูลรายวันในโหมดนั้น</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ลูกค้า</TableHead>
                    <TableHead className="text-center w-[200px]">Onshore</TableHead>
                    <TableHead className="text-center w-[200px]">Offshore</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerRows.map((r) => (
                    <TableRow key={r.customerId}>
                      <TableCell>
                        <div className="font-medium">{r.customerName}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">{r.customerId}</div>
                      </TableCell>
                      <TableCell className="align-top text-center">{cellShell(r.customerId, 'ONSHORE')}</TableCell>
                      <TableCell className="align-top text-center">{cellShell(r.customerId, 'OFFSHORE')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
