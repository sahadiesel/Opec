'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ShieldCheck, ShieldAlert, RefreshCw, Info, LockKeyhole } from 'lucide-react';
import { User, PermissionProfile } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, orderBy, writeBatch } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { isAdminUser } from '@/lib/auth-mapping';
import { getBaselineProfiles, getProfileDepartmentGroup } from '@/lib/permissions';
import { formatDateTimeThaiBE } from '@/lib/date-thai';

export default function PermissionMatrixPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [isMigrating, setIsMigrating] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isUserAdmin = useMemo(() => isAdminUser(currentUser), [currentUser]);

  const profilesQuery = useMemoFirebase(() => {
    if (!firestore || !isUserAdmin) return null;
    return query(collection(firestore, 'permission_profiles'), orderBy('profileKey', 'asc'));
  }, [firestore, isUserAdmin]);

  const { data: profiles, isLoading: isProfilesLoading } = useCollection<PermissionProfile>(profilesQuery as any);

  const groupedSummary = useMemo(() => {
    if (!profiles) return [];
    const map = new Map<string, number>();

    for (const profile of profiles) {
      const group = getProfileDepartmentGroup(profile);
      const key = `${group}:${profile.level}`;
      map.set(key, (map.get(key) || 0) + 1);
    }

    return Array.from(map.entries()).map(([key, count]) => {
      const [departmentGroup, level] = key.split(':');
      return { departmentGroup, level, count };
    });
  }, [profiles]);

  const handleResetToBaseline = async () => {
    if (!firestore) return;

    setIsMigrating(true);
    const batch = writeBatch(firestore);

    try {
      const baselines = getBaselineProfiles();

      for (const p of baselines) {
        const profileRef = doc(firestore, 'permission_profiles', p.profileKey!);
        batch.set(
          profileRef,
          {
            ...p,
            id: p.profileKey,
            updatedAt: Date.now(),
            updatedBy: 'System Baseline Tool',
          },
          { merge: true }
        );
      }

      await batch.commit();
      toast({ title: 'กู้คืนโปรไฟล์มาตรฐานสำเร็จ (Baseline restored)' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Migration Failed', description: err.message });
    } finally {
      setIsMigrating(false);
    }
  };

  if (isUserLoading || !currentUser) return null;

  if (!isUserAdmin) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <div>
            <h2 className="text-xl font-bold">Access Restricted</h2>
            <p className="text-muted-foreground">Only system administrators can access advanced settings.</p>
          </div>
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
              <LockKeyhole className="h-8 w-8 text-primary" />
              จัดการแม่แบบสิทธิ์ (Permission Matrix Reference)
            </h1>
            <p className="text-muted-foreground text-lg">
              หน้านี้เป็นหน้าอ้างอิงและซ่อม baseline ชั่วคราว ไม่ใช่แหล่งกำหนดสิทธิ์หลักของ internal users
            </p>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="gap-2 border-primary text-primary" disabled={isMigrating}>
                <RefreshCw className={`h-4 w-4 ${isMigrating ? 'animate-spin' : ''}`} />
                Restore Baseline Profiles
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>ยืนยันการกู้คืนค่ามาตรฐาน?</AlertDialogTitle>
                <AlertDialogDescription>
                  ระบบจะเขียนทับโปรไฟล์ baseline มาตรฐาน เพื่อใช้เป็นข้อมูลอ้างอิงและซ่อมกรณี profile ขาดหาย
                  หน้านี้ไม่ใช่ตัวกำหนดสิทธิ์หลักของผู้ใช้ภายใน
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                <AlertDialogAction onClick={handleResetToBaseline}>ตกลง</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <Info className="h-4 w-4" />
          <AlertTitle>ทำไมแก้เมทริกซ์แล้ว “ไม่มีผล”</AlertTitle>
          <AlertDescription className="space-y-2 text-sm">
            <p>
              การเข้าถึงข้อมูลจริงใน Firestore ใช้บทบาทแบบ RBAC (เช่น <code className="text-xs">hr_manager</code>) จาก
              เอกสารผู้ใช้และฟิลด์ <code className="text-xs">primaryRoleTemplateKey</code> ในโปรไฟล์ — ไม่ได้อ่านทุกช่องใน
              ตารางเมทริกซ์ทีละโมดูล
            </p>
            <p>
              <strong>ให้ทำที่เมนูจัดการผู้ใช้</strong> เลือกโปรไฟล์หรือบทบาท แล้วบันทึก (สถานะ ACTIVE) จากนั้นให้ผู้ใช้คนนั้น{' '}
              <strong>ออกจากระบบแล้วเข้าใหม่</strong> เพื่อให้เครื่องโหลดสิทธิ์ล่าสุด
            </p>
            <p className="text-muted-foreground">
              หน้านี้ใช้กู้คืน baseline และดูสรุปโปรไฟล์ — แก้รายละเอียดโมดูลหลักได้ที่ &quot;จัดการสิทธิ์การใช้งาน (Permission
              Profiles)&quot;
            </p>
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                สถานะหน้า Matrix
              </CardTitle>
              <CardDescription>โหมดปัจจุบันของระบบสิทธิ์</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span>Role/Profile editor</span>
                <Badge variant="destructive">Disabled</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Baseline restore</span>
                <Badge className="bg-green-600">Enabled</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Reference listing</span>
                <Badge className="bg-blue-600">Enabled</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">สรุปตามกลุ่มสิทธิ์ / ระดับ</CardTitle>
              <CardDescription>จำนวน permission profiles ที่มีอยู่ในระบบปัจจุบัน (อิง departmentGroup)</CardDescription>
            </CardHeader>
            <CardContent>
              {groupedSummary.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">ยังไม่พบข้อมูลโปรไฟล์</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {groupedSummary.map((item) => (
                    <Badge key={`${item.departmentGroup}-${item.level}`} variant="outline" className="px-3 py-1">
                      {item.departmentGroup} / {item.level}: {item.count}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardHeader>
            <CardTitle>รายการโปรไฟล์เดิม (Legacy / Transitional Profiles)</CardTitle>
            <CardDescription>
              ใช้เพื่อตรวจสอบความครบถ้วนของ profile records เท่านั้น ไม่ควรใช้หน้านี้เป็นเครื่องมือกำหนดสิทธิ์หลัก
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            {isProfilesLoading ? (
              <div className="py-20 text-center animate-pulse italic">กำลังโหลดข้อมูลโปรไฟล์...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4">โปรไฟล์ (Profile Key)</TableHead>
                    <TableHead>ชื่อโปรไฟล์</TableHead>
                    <TableHead>กลุ่ม / ระดับ</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead>อัปเดตล่าสุด</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles?.map((p) => (
                    <TableRow key={p.id} className="hover:bg-muted/20 transition-all">
                      <TableCell className="pl-6 py-4 font-mono text-xs font-bold text-primary">
                        {p.profileKey}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold">{p.profileNameEn}</span>
                          <span className="text-xs text-muted-foreground">{p.profileNameTh}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5">
                          <Badge variant="outline" className="capitalize bg-blue-50 text-blue-700 font-bold">
                            {getProfileDepartmentGroup(p)}
                          </Badge>
                          <Badge variant="secondary" className="capitalize font-bold">
                            {p.level}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={p.isActive ? 'bg-green-600' : 'bg-slate-400'}>
                          {p.isActive ? 'ACTIVE' : 'INACTIVE'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground leading-tight">
                        {formatDateTimeThaiBE(p.updatedAt)}
                        <br />
                        โดย {p.updatedBy}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!profiles?.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-muted-foreground italic">
                        ยังไม่พบ permission profiles
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
