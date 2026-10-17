'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  History,
  Search,
  Filter,
  Calendar,
  User,
  ShieldAlert,
  Info,
  Download,
  Terminal,
  Zap,
  Tag,
  Printer,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AuditLog, User as AppUser } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { usePermissions } from '@/hooks/use-permissions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { PageGuidance } from '@/components/layout/page-guidance';
import { formatDateThaiBE, formatTimeThaiBE } from '@/lib/date-thai';
import { openStandardPrintWindow, sanitizePrintFileBaseName } from '@/lib/documents/standard-document-print';
import { useToast } from '@/hooks/use-toast';

const BE_YEAR_OFFSET = 543;

const THAI_MONTH_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'มกราคม' },
  { value: 2, label: 'กุมภาพันธ์' },
  { value: 3, label: 'มีนาคม' },
  { value: 4, label: 'เมษายน' },
  { value: 5, label: 'พฤษภาคม' },
  { value: 6, label: 'มิถุนายน' },
  { value: 7, label: 'กรกฎาคม' },
  { value: 8, label: 'สิงหาคม' },
  { value: 9, label: 'กันยายน' },
  { value: 10, label: 'ตุลาคม' },
  { value: 11, label: 'พฤศจิกายน' },
  { value: 12, label: 'ธันวาคม' },
];

function beYearFromCe(ceYear: number): number {
  return ceYear + BE_YEAR_OFFSET;
}

/** เดือน/ปีปัจจุบันตามเขต Asia/Bangkok (ปีเป็น พ.ศ.) */
function currentAuditFilterMonthYear(): { yearBe: number; month: number } {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  return {
    yearBe: beYearFromCe(Number(ymd.slice(0, 4))),
    month: Number(ymd.slice(5, 7)),
  };
}

const yearOptionsBe = (() => {
  const cy = Number(
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 4),
  );
  return Array.from({ length: 8 }, (_, i) => beYearFromCe(cy - i));
})();

function bangkokYmdFromMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function logMatchesMonthYear(
  log: AuditLog,
  yearBe: 'ALL' | number,
  month: 'ALL' | number,
): boolean {
  if (yearBe === 'ALL' && month === 'ALL') return true;
  const ymd = bangkokYmdFromMs(log.eventAt);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const ceYear = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  if (yearBe !== 'ALL' && ceYear !== yearBe - BE_YEAR_OFFSET) return false;
  if (month !== 'ALL' && m !== month) return false;
  return true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function periodFilterLabel(yearBe: 'ALL' | number, month: 'ALL' | number): string {
  const monthLabel =
    month === 'ALL' ? 'ทุกเดือน' : THAI_MONTH_OPTIONS.find((m) => m.value === month)?.label || String(month);
  const yearLabel = yearBe === 'ALL' ? 'ทุกปี' : `พ.ศ. ${yearBe}`;
  return `${monthLabel} · ${yearLabel}`;
}

export default function AuditLogExplorerPage() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const initialPeriod = useMemo(() => currentAuditFilterMonthYear(), []);

  // Filters — เดือน/ปีค่าเริ่มต้น = ปัจจุบัน (Bangkok)
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [yearFilter, setYearFilter] = useState<'ALL' | number>(initialPeriod.yearBe);
  const [monthFilter, setMonthFilter] = useState<'ALL' | number>(initialPeriod.month);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const { can, isLoading: isPermLoading } = usePermissions(currentUser);

  // Queries - Limit to 200 for lightweight explorer
  const auditQuery = useMemoFirebase(() => {
    if (!firestore || !can('audit_logs').view) return null;
    return query(collection(firestore, 'audit_logs'), orderBy('eventAt', 'desc'), limit(200));
  }, [firestore, can('audit_logs').view]);

  const { data: logs, isLoading: isLogsLoading } = useCollection<AuditLog>(auditQuery as any);

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    return logs.filter((log) => {
      const actorName = log.actorName || '';
      const summary = log.afterSummary || '';
      const label = log.entityLabel || '';

      const matchesSearch =
        actorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        summary.toLowerCase().includes(searchTerm.toLowerCase()) ||
        label.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesAction = actionFilter === 'ALL' || log.actionType === actionFilter;
      const matchesEntity = entityFilter === 'ALL' || log.entityType === entityFilter;
      const matchesPeriod = logMatchesMonthYear(log, yearFilter, monthFilter);

      return matchesSearch && matchesAction && matchesEntity && matchesPeriod;
    });
  }, [logs, searchTerm, actionFilter, entityFilter, yearFilter, monthFilter]);

  const entityTypes = useMemo(() => {
    if (!logs) return [];
    return Array.from(new Set(logs.map((l) => l.entityType))).sort();
  }, [logs]);

  const actionTypes = useMemo(() => {
    if (!logs) return [];
    return Array.from(new Set(logs.map((l) => l.actionType))).sort();
  }, [logs]);

  const clearFilters = () => {
    const cur = currentAuditFilterMonthYear();
    setSearchTerm('');
    setActionFilter('ALL');
    setEntityFilter('ALL');
    setYearFilter(cur.yearBe);
    setMonthFilter(cur.month);
  };

  const handleExportCsv = useCallback(() => {
    if (filteredLogs.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีข้อมูลให้ส่งออก',
        description: 'ปรับตัวกรองหรือรอโหลดประวัติกิจกรรม',
      });
      return;
    }
    const header = [
      'eventAt',
      'dateBe',
      'time',
      'actorName',
      'actorRole',
      'actionType',
      'entityType',
      'entityLabel',
      'afterSummary',
      'sourceModule',
    ];
    const rows = filteredLogs.map((log) =>
      [
        String(log.eventAt ?? ''),
        formatDateThaiBE(log.eventAt),
        formatTimeThaiBE(log.eventAt),
        log.actorName || '',
        log.actorRole || '',
        log.actionType || '',
        log.entityType || '',
        log.entityLabel || log.entityId || '',
        log.afterSummary || '',
        log.sourceModule || 'system',
      ]
        .map((c) => csvEscape(String(c)))
        .join(','),
    );
    const csv = `\uFEFF${header.join(',')}\n${rows.join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const period = periodFilterLabel(yearFilter, monthFilter).replace(/\s·\s/g, '-');
    a.href = url;
    a.download = sanitizePrintFileBaseName(`audit-logs-${period}`) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'ส่งออก CSV แล้ว', description: `${filteredLogs.length} รายการตามตัวกรองปัจจุบัน` });
  }, [filteredLogs, yearFilter, monthFilter, toast]);

  const handlePrint = useCallback(async () => {
    if (filteredLogs.length === 0) {
      toast({
        variant: 'destructive',
        title: 'ไม่มีข้อมูลให้พิมพ์',
        description: 'ปรับตัวกรองหรือรอโหลดประวัติกิจกรรม',
      });
      return;
    }
    const period = periodFilterLabel(yearFilter, monthFilter);
    const rowsHtml = filteredLogs
      .map((log) => {
        return `<tr>
          <td>${escapeHtml(formatDateThaiBE(log.eventAt))}<br/><span style="color:#666;font-size:11px">${escapeHtml(formatTimeThaiBE(log.eventAt))}</span></td>
          <td>${escapeHtml(log.actorName || '—')}<br/><span style="color:#666;font-size:11px">${escapeHtml(log.actorRole || '')}</span></td>
          <td>${escapeHtml(log.actionType || '')}</td>
          <td>${escapeHtml(log.entityType || '')}<br/><span style="color:#666;font-size:11px">${escapeHtml(log.entityLabel || log.entityId || '')}</span></td>
          <td>${escapeHtml(log.afterSummary || '')}</td>
          <td>${escapeHtml(log.sourceModule || 'system')}</td>
        </tr>`;
      })
      .join('');

    const body = `
      <div style="font-family:system-ui,sans-serif;padding:8px 4px">
        <h1 style="font-size:18px;margin:0 0 4px">ประวัติกิจกรรมระบบ (Audit Log)</h1>
        <p style="margin:0 0 12px;font-size:12px;color:#444">
          ช่วงเวลา: <strong>${escapeHtml(period)}</strong>
          · จำนวน ${filteredLogs.length} รายการ
          · พิมพ์เมื่อ ${escapeHtml(formatDateThaiBE(Date.now()))} ${escapeHtml(formatTimeThaiBE(Date.now()))}
          ${currentUser?.displayName ? ` · โดย ${escapeHtml(currentUser.displayName)}` : ''}
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead>
            <tr style="background:#f3f4f6;text-align:left">
              <th style="border:1px solid #ccc;padding:6px">วันที่ / เวลา</th>
              <th style="border:1px solid #ccc;padding:6px">ผู้ดำเนินการ</th>
              <th style="border:1px solid #ccc;padding:6px">การกระทำ</th>
              <th style="border:1px solid #ccc;padding:6px">เป้าหมาย</th>
              <th style="border:1px solid #ccc;padding:6px">รายละเอียด</th>
              <th style="border:1px solid #ccc;padding:6px">Module</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        <p style="margin-top:16px;font-size:10px;color:#666">เอกสารสำหรับตรวจสอบย้อนหลัง — ข้อมูล Audit เป็นแบบถาวร (Immutable)</p>
      </div>
      <style>
        td { border:1px solid #ccc; padding:6px; vertical-align:top; }
        @media print { body { margin: 0; } }
      </style>
    `;

    const ok = await openStandardPrintWindow({
      windowTitle: 'Audit-Logs',
      suggestedFileName: sanitizePrintFileBaseName(`audit-logs-${period}`),
      bodyInnerHtml: body,
      htmlLang: 'th',
    });
    if (!ok) {
      toast({
        variant: 'destructive',
        title: 'เปิดหน้าต่างพิมพ์ไม่ได้',
        description: 'กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้',
      });
    }
  }, [filteredLogs, yearFilter, monthFilter, currentUser?.displayName, toast]);

  if (isUserLoading || isPermLoading || !currentUser) return null;

  if (!can('audit_logs').view) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Restricted (จำกัดสิทธิ์เข้าถึง)</h2>
          <p className="text-muted-foreground">Only authorized system monitors can view the audit trail.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <History className="h-8 w-8 text-primary" /> ประวัติกิจกรรมระบบ (Audit Log Explorer)
            </h1>
            <p className="text-muted-foreground text-lg italic">
              ตรวจสอบเหตุการณ์สำคัญ การแก้ไขข้อมูล และการอนุมัติย้อนหลัง (System-wide traceability).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="gap-2 h-11" onClick={() => void handlePrint()}>
              <Printer className="h-4 w-4" /> พิมพ์
            </Button>
            <Button type="button" variant="outline" className="gap-2 h-11" onClick={handleExportCsv}>
              <Download className="h-4 w-4" /> Export Audit CSV
            </Button>
          </div>
        </div>

        <PageGuidance
          title="คำแนะนำในการตรวจสอบ (Audit Guidance)"
          tips={[
            "ใช้เพื่อตรวจสอบย้อนหลังว่าใครเป็นผู้ดำเนินการแก้ไขข้อมูล หรืออนุมัติรายการสำคัญในระบบ",
            "ท่านสามารถกรองตาม 'Action Type' เพื่อดูเฉพาะรายการที่มีการ ลบ (DELETE) หรือ ล็อก (LOCK) ได้",
            'ค่าเริ่มต้นตัวกรองเดือน/ปี = เดือนปัจจุบัน (เขตเวลาไทย) — กดล้างตัวกรองเพื่อกลับค่านี้',
            'ข้อมูล Audit ถูกบันทึกแบบถาวร (Immutable) เพื่อความโปร่งใสตามมาตรฐาน ISO และความปลอดภัยไซเบอร์',
          ]}
        />

        <Card className="shadow-sm border-none bg-card">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">ค้นหา (Search)</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="ชื่อผู้ใช้ หรือ รายละเอียด..."
                    className="pl-9 h-11"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">ประเภทการกระทำ (Action)</Label>
                <Select value={actionFilter} onValueChange={setActionFilter}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="ทุกการกระทำ" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกการกระทำ (All Actions)</SelectItem>
                    {actionTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">ประเภทข้อมูล (Entity)</Label>
                <Select value={entityFilter} onValueChange={setEntityFilter}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="ทุกประเภทข้อมูล" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกประเภท (All Entities)</SelectItem>
                    {entityTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">เดือน</Label>
                <Select
                  value={monthFilter === 'ALL' ? 'ALL' : String(monthFilter)}
                  onValueChange={(v) => setMonthFilter(v === 'ALL' ? 'ALL' : Number(v))}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="เลือกเดือน" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกเดือน</SelectItem>
                    {THAI_MONTH_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">ปี (พ.ศ.)</Label>
                <Select
                  value={yearFilter === 'ALL' ? 'ALL' : String(yearFilter)}
                  onValueChange={(v) => setYearFilter(v === 'ALL' ? 'ALL' : Number(v))}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="เลือกปี" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกปี (พ.ศ.)</SelectItem>
                    {yearOptionsBe.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        พ.ศ. {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button variant="ghost" className="w-full gap-2 text-muted-foreground h-11" onClick={clearFilters}>
                  <Filter className="h-4 w-4" /> ล้างตัวกรอง
                </Button>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              แสดง {filteredLogs.length} รายการ · ช่วง {periodFilterLabel(yearFilter, monthFilter)}
              {logs ? ` (จากชุดล่าสุด ${logs.length} รายการ)` : ''}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLogsLoading ? (
              <div className="py-20 text-center animate-pulse">กำลังดึงข้อมูลประวัติกิจกรรม...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4 font-bold text-[10px] uppercase">วันที่ / เวลา</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase">ผู้ดำเนินการ (Actor)</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase">ประเภทการกระทำ</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase">เป้าหมาย (Entity)</TableHead>
                    <TableHead className="font-bold text-[10px] uppercase">รายละเอียด (Summary)</TableHead>
                    <TableHead className="text-right pr-6 font-bold text-[10px] uppercase">Module</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => (
                    <TableRow key={log.id} className="hover:bg-muted/20 transition-all group">
                      <TableCell className="pl-6 py-4">
                        <div className="flex flex-col text-[10px]">
                          <span className="font-bold text-primary flex items-center gap-1">
                            <Calendar className="h-2.5 w-2.5" /> {formatDateThaiBE(log.eventAt)}
                          </span>
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Zap className="h-2.5 w-2.5" /> {formatTimeThaiBE(log.eventAt)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-primary flex items-center gap-1">
                            <User className="h-3 w-3" /> {log.actorName}
                          </span>
                          <span className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">
                            {log.actorRole}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            log.actionType === 'DELETE' || log.actionType === 'REJECT'
                              ? 'destructive'
                              : log.actionType === 'APPROVE' || log.actionType === 'PAID'
                                ? 'default'
                                : 'outline'
                          }
                          className="text-[9px] font-black uppercase"
                        >
                          {log.actionType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-primary flex items-center gap-1">
                            <Tag className="h-2.5 w-2.5 text-muted-foreground" /> {log.entityType}
                          </span>
                          <span className="text-[9px] font-mono text-muted-foreground truncate max-w-[120px]">
                            {log.entityLabel || log.entityId}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-medium text-slate-600 leading-relaxed max-w-[400px]">
                          {log.afterSummary}
                        </p>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <Badge
                          variant="secondary"
                          className="text-[8px] uppercase tracking-tighter bg-primary/5 text-primary border-primary/10"
                        >
                          {log.sourceModule || 'system'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredLogs.length === 0 && !isLogsLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">
                        <Terminal className="h-10 w-10 mx-auto mb-4 opacity-10" />
                        ไม่พบข้อมูลประวัติกิจกรรมตามที่ค้นหา
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Security Integrity Notice */}
        <Card className="bg-primary/5 border-primary/10 border-dashed border-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-primary font-bold uppercase tracking-widest">
              <Info className="h-4 w-4" /> Data Integrity Safeguard
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[10px] text-muted-foreground leading-relaxed">
            ระบบจัดเก็บ Audit Log แยกจากฐานข้อมูลหลักและไม่อนุญาตให้มีการแก้ไขหรือลบข้อมูลหลังจากบันทึกแล้ว
            เพื่อความโปร่งใสสูงสุดในการดำเนินงาน (SOX/Audit Compliance)
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
