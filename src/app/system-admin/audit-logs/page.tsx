'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  History, 
  Search, 
  Filter, 
  Calendar, 
  User, 
  ShieldAlert, 
  Info,
  ChevronRight,
  ArrowUpDown,
  Download,
  Terminal,
  Zap,
  Tag
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

export default function AuditLogExplorerPage() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [entityFilter, setEntityFilter] = useState('ALL');

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
    return logs.filter(log => {
      const actorName = log.actorName || '';
      const summary = log.afterSummary || '';
      const label = log.entityLabel || '';
      
      const matchesSearch = actorName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           summary.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           label.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesAction = actionFilter === 'ALL' || log.actionType === actionFilter;
      const matchesEntity = entityFilter === 'ALL' || log.entityType === entityFilter;
      
      return matchesSearch && matchesAction && matchesEntity;
    });
  }, [logs, searchTerm, actionFilter, entityFilter]);

  const entityTypes = useMemo(() => {
    if (!logs) return [];
    return Array.from(new Set(logs.map(l => l.entityType))).sort();
  }, [logs]);

  const actionTypes = useMemo(() => {
    if (!logs) return [];
    return Array.from(new Set(logs.map(l => l.actionType))).sort();
  }, [logs]);

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
          <Button variant="outline" className="gap-2 h-11">
            <Download className="h-4 w-4" /> Export Audit CSV
          </Button>
        </div>

        <PageGuidance 
          title="คำแนะนำในการตรวจสอบ (Audit Guidance)"
          tips={[
            "ใช้เพื่อตรวจสอบย้อนหลังว่าใครเป็นผู้ดำเนินการแก้ไขข้อมูล หรืออนุมัติรายการสำคัญในระบบ",
            "ท่านสามารถกรองตาม 'Action Type' เพื่อดูเฉพาะรายการที่มีการ ลบ (DELETE) หรือ ล็อก (LOCK) ได้",
            "ข้อมูล Audit ถูกบันทึกแบบถาวร (Immutable) เพื่อความโปร่งใสตามมาตรฐาน ISO และความปลอดภัยไซเบอร์"
          ]}
        />

        <Card className="shadow-sm border-none bg-card">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">ค้นหา (Search)</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="ชื่อผู้ใช้ หรือ รายละเอียด..." 
                    className="pl-9 h-11"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
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
                    {actionTypes.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
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
                    {entityTypes.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button variant="ghost" className="w-full gap-2 text-muted-foreground h-11" onClick={() => {
                  setSearchTerm('');
                  setActionFilter('ALL');
                  setEntityFilter('ALL');
                }}>
                  <Filter className="h-4 w-4" /> ล้างตัวกรอง
                </Button>
              </div>
            </div>
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
                          <span className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">{log.actorRole}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          log.actionType === 'DELETE' || log.actionType === 'REJECT' ? 'destructive' :
                          log.actionType === 'APPROVE' || log.actionType === 'PAID' ? 'default' :
                          'outline'
                        } className="text-[9px] font-black uppercase">
                          {log.actionType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-primary flex items-center gap-1">
                            <Tag className="h-2.5 w-2.5 text-muted-foreground" /> {log.entityType}
                          </span>
                          <span className="text-[9px] font-mono text-muted-foreground truncate max-w-[120px]">{log.entityLabel || log.entityId}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-medium text-slate-600 leading-relaxed max-w-[400px]">
                          {log.afterSummary}
                        </p>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <Badge variant="secondary" className="text-[8px] uppercase tracking-tighter bg-primary/5 text-primary border-primary/10">
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
            ระบบจัดเก็บ Audit Log แยกจากฐานข้อมูลหลักและไม่อนุญาตให้มีการแก้ไขหรือลบข้อมูลหลังจากบันทึกแล้ว เพื่อความโปร่งใสสูงสุดในการดำเนินงาน (SOX/Audit Compliance)
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
