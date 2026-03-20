'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  ShieldAlert, 
  ShieldCheck, 
  Lock, 
  History, 
  UserCheck, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Info,
  ChevronRight,
  SearchCheck,
  FileText,
  Building2,
  Coins,
  ArrowRight,
  Database
} from 'lucide-react';
import { User, PermissionProfile } from '@/lib/types';
import { useFirestore, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { doc } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/hooks/use-permissions';
import { isAdminUser } from '@/lib/auth-mapping';
import { PageGuidance } from '@/components/layout/page-guidance';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export default function SecurityCheckPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const { can, profile, isLoading: isPermLoading } = usePermissions(currentUser);
  const isUserAdmin = useMemo(() => isAdminUser(currentUser), [currentUser]);

  // Checklist state
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

  const toggleItem = (id: string) => {
    setCheckedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (isUserLoading || isPermLoading || !currentUser) return null;

  if (!isUserAdmin) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Restricted (จำกัดสิทธิ์เข้าถึง)</h2>
          <p className="text-muted-foreground">This security dashboard is reserved for System Administrators.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1400px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-primary" /> ตรวจสอบความปลอดภัยระบบ (Security & Compliance)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            รายการตรวจสอบมาตรการป้องกันข้อมูลและการเข้าถึง (Internal security audit and verification checklist).
          </p>
        </div>

        <PageGuidance 
          title="เป้าหมายของระบบความปลอดภัย (Security Goals)"
          tips={[
            "Data Isolation: ลูกค้าต้องเห็นเฉพาะข้อมูลของตนเอง และไม่สามารถเข้าถึงระบบ Payroll หรือต้นทุนภายในได้",
            "Immutability: รายการที่ได้รับการอนุมัติ (Approved) หรือล็อก (Locked) จะต้องไม่สามารถแก้ไขได้โดยตรง",
            "Traceability: ทุกเหตุการณ์สำคัญต้องถูกบันทึกใน Audit Log และไม่สามารถลบประวัติได้"
          ]}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="shadow-md">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Database className="h-5 w-5 text-primary" /> รายการตรวจสอบสิทธิ์ (Compliance Checklist)
                </CardTitle>
                <CardDescription>กรุณาตรวจสอบว่ากฎการเข้าถึงทำงานตามนโยบายบริษัท</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <CheckSection 
                  title="1. การแยกส่วนข้อมูล (Data Isolation)" 
                  items={[
                    { id: 'c1', label: 'Customer Roles ไม่สามารถเข้าถึงคอลเลกชัน /payroll_batches หรือ /worker_payment_profiles' },
                    { id: 'c2', label: 'ลูกค้าเห็นเฉพาะใบลงเวลา (Timesheets) ที่ระบุ customerId ของบริษัทตนเองเท่านั้น' },
                    { id: 'c3', label: 'ระบบ block การเขียนข้อมูล Commercial Terms จากภายนอก' }
                  ]}
                  checked={checkedItems}
                  onToggle={toggleItem}
                />

                <CheckSection 
                  title="2. ความสมบูรณ์ของเวิร์กโฟลว์ (Workflow Gating)" 
                  items={[
                    { id: 'w1', label: 'ใบลงเวลาที่มีสถานะ CLIENT_APPROVED ถูกล็อกไม่ให้พนักงานทั่วไปแก้ไข' },
                    { id: 'w2', label: 'Payroll Batch ที่สถานะเป็น LOCKED ไม่สามารถเปลี่ยนแปลงยอดเงินหรือสถานะได้อีก' },
                    { id: 'w3', label: 'ประวัติการเตรียมจ่าย (Export History) ถูกเก็บรักษาไว้ ไม่มีการลบทิ้งเมื่อสร้างไฟล์ใหม่' }
                  ]}
                  checked={checkedItems}
                  onToggle={toggleItem}
                />

                <CheckSection 
                  title="3. การตรวจสอบย้อนหลัง (Traceability)" 
                  items={[
                    { id: 'a1', label: 'การ Submit, Approve, Reject ทุกครั้งต้องมีรายการใน Audit Log' },
                    { id: 'a2', label: 'Audit Log บันทึกรายละเอียด changedFields เมื่อมีการแก้ไขข้อมูลสำคัญ' },
                    { id: 'a3', label: 'รายการใน Audit Log ไม่สามารถถูกลบได้โดย user หรือ manager' }
                  ]}
                  checked={checkedItems}
                  onToggle={toggleItem}
                />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-blue-200 bg-blue-50/20 shadow-md">
              <CardHeader className="pb-3 border-b border-blue-100">
                <CardTitle className="text-sm font-black uppercase tracking-widest text-blue-800 flex items-center gap-2">
                  <UserCheck className="h-4 w-4" /> My Effective Permissions
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Logged in as:</p>
                  <p className="text-sm font-bold text-primary">{currentUser.displayName}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Profile Assigned:</p>
                  <Badge variant="outline" className="font-mono text-blue-700 bg-blue-50 border-blue-200">
                    {currentUser.permissionProfileKey || 'LEGACY_FALLBACK'}
                  </Badge>
                </div>
                <Separator className="bg-blue-100" />
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Access Summary:</p>
                  <PermissionStat label="View Audit Logs" allowed={can('audit_logs').view} />
                  <PermissionStat label="System Admin" allowed={can('system_admin').view} />
                  <PermissionStat label="Modify Rates" allowed={can('rate_conditions').edit} />
                  <PermissionStat label="Approve Payroll" allowed={can('worker_payroll').approve} />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-amber-50 border-amber-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="h-3 w-3" /> Security Alert
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[10px] text-amber-700 leading-relaxed">
                หากพบว่าพนักงานทั่วไปสามารถเข้าถึงเมนู "ประวัติกิจกรรม (Audit Logs)" หรือ "สิทธิ์การใช้งาน" ได้ กรุณาตรวจสอบการตั้งค่า Profile Matrix ทันทีเพื่อป้องกันการรั่วไหลของข้อมูล
              </CardContent>
            </Card>

            <Card className="border-dashed">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2 text-primary font-bold">
                  <Info className="h-4 w-4" /> Tools
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" size="sm" className="w-full text-xs" asChild>
                  <a href="/system-admin/audit-logs">เปิด Audit Explorer <ArrowRight className="h-3 w-3 ml-1" /></a>
                </Button>
                <Button variant="outline" size="sm" className="w-full text-xs" asChild>
                  <a href="/system-admin/permission-audit">ตรวจสอบความสมบูรณ์สิทธิ์ <ArrowRight className="h-3 w-3 ml-1" /></a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function CheckSection({ title, items, checked, onToggle }: any) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-primary uppercase tracking-tight">{title}</h3>
      <div className="space-y-2 pl-1">
        {items.map((item: any) => (
          <div key={item.id} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/30 transition-colors">
            <Checkbox 
              id={item.id} 
              checked={checked[item.id]} 
              onCheckedChange={() => onToggle(item.id)}
              className="mt-0.5"
            />
            <Label htmlFor={item.id} className="text-xs leading-relaxed cursor-pointer font-medium text-slate-600">
              {item.label}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}

function PermissionStat({ label, allowed }: { label: string; allowed: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      {allowed ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-red-400 opacity-50" />
      )}
    </div>
  );
}
