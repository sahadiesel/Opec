'use client';

import { useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Database,
  Play,
  ShieldAlert,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  FileText,
} from 'lucide-react';
import { useFirestore, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { isSystemAdmin } from '@/lib/permission-core';
import {
  runOperationRoleKeyMigration,
  type OperationRoleKeyMigrationReport,
} from '@/lib/migration/operation-role-key-migration';
import {
  runPayrollOfficerProfileNormalization,
  type PayrollProfileNormalizationReport,
} from '@/lib/migration/payroll-officer-profile-normalization';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

export default function UserMigrationPage() {
  const firestore = useFirestore();
  const { currentUser, isLoading: userLoading } = useAppUser();
  useUser();
  const { toast } = useToast();

  const [isRunning, setIsRunning] = useState(false);
  const [roleKeyReport, setRoleKeyReport] = useState<OperationRoleKeyMigrationReport | null>(null);
  const [isPayrollNormalizationRunning, setIsPayrollNormalizationRunning] = useState(false);
  const [payrollNormalizationReport, setPayrollNormalizationReport] = useState<PayrollProfileNormalizationReport | null>(null);

  const canRun = firestore && currentUser && isSystemAdmin(currentUser);

  const handleRoleKeyMigration = async (apply: boolean) => {
    if (!firestore || !currentUser?.id) return;
    if (!isSystemAdmin(currentUser)) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
      return;
    }
    setIsRunning(true);
    setRoleKeyReport(null);
    try {
      const r = await runOperationRoleKeyMigration(firestore, {
        actorUid: currentUser.id,
        dryRun: !apply,
      });
      setRoleKeyReport(r);
      toast({
        title: apply ? 'Role-key migration เสร็จสิ้น' : 'Role-key dry run เสร็จสิ้น',
        description: apply
          ? `users patched ${r.usersPatched}, profiles patched ${r.profilesPatched}, cloned ${r.profilesCloned}`
          : `จะ patch users ${r.usersPatched}, profiles ${r.profilesPatched}`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsRunning(false);
    }
  };

  const handlePayrollProfileNormalization = async (apply: boolean) => {
    if (!firestore || !currentUser?.id) return;
    if (!isSystemAdmin(currentUser)) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
      return;
    }
    setIsPayrollNormalizationRunning(true);
    setPayrollNormalizationReport(null);
    try {
      const r = await runPayrollOfficerProfileNormalization(firestore, {
        actorUid: currentUser.id,
        dryRun: !apply,
      });
      setPayrollNormalizationReport(r);
      toast({
        title: apply ? 'Payroll profile normalization เสร็จสิ้น' : 'Payroll profile dry run เสร็จสิ้น',
        description: apply
          ? `users patched ${r.usersPatched}, profiles patched ${r.profilesPatched}`
          : `จะ patch users ${r.usersPatched}, profiles ${r.profilesPatched}`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsPayrollNormalizationRunning(false);
    }
  };

  if (userLoading || !currentUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground text-sm">
        กำลังโหลด…
      </div>
    );
  }

  if (!isSystemAdmin(currentUser)) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
          <ShieldAlert className="h-12 w-12 text-destructive" />
          <p className="font-bold">เฉพาะผู้ดูแลระบบเท่านั้น</p>
          <Button asChild variant="outline">
            <Link href="/">กลับหน้าหลัก</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Database className="h-7 w-7" /> Migration สิทธิ์ผู้ใช้ (Maintenance Only)
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              เครื่องมือนี้เป็นงานบำรุงรักษาชั่วคราวสำหรับ System Admin เท่านั้น ไม่ใช่ flow จัดการผู้ใช้ประจำวัน
            </p>
          </div>
          <Button variant="ghost" size="icon" asChild>
            <Link href="/users">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
        </div>

        <Alert className="bg-amber-50 border-amber-200">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <AlertTitle className="font-bold text-amber-800">คำเตือน</AlertTitle>
          <AlertDescription className="text-amber-700 text-sm">
            หน้านี้ทำงานเฉพาะการแปลง role key แบบ exact-match จาก plural เป็น singular เท่านั้น
            และจะไม่ reclassify role อื่น
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Operation Role Key Canonicalization</CardTitle>
            <CardDescription>
              This tool only converts legacy plural operation role keys to canonical singular keys. It does not reclassify roles.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <ShieldAlert className="h-5 w-5 text-blue-600" />
              <AlertTitle className="font-bold text-blue-800">Recommended execution order</AlertTitle>
              <AlertDescription className="text-blue-700 text-sm">
                This migration only canonicalizes the two operation plural keys and does not reclassify any other role.
                <br />
                1) Deploy code/rules with temporary normalization
                <br />
                2) Run dry run here, then apply migration
                <br />
                3) Verify users/permission_profiles and custom-claim sync input fields
                <br />
                4) Remove temporary legacy compatibility later
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button
                onClick={() => handleRoleKeyMigration(false)}
                disabled={!canRun || isRunning}
                variant="outline"
                className="gap-2"
              >
                {isRunning ? <Loader2 className="animate-spin h-4 w-4" /> : <FileText className="h-4 w-4" />}
                Role-Key Dry Run
              </Button>
              <Button
                onClick={() => handleRoleKeyMigration(true)}
                disabled={!canRun || isRunning}
                className="gap-2 bg-primary"
              >
                {isRunning ? <Loader2 className="animate-spin h-4 w-4" /> : <Play className="h-4 w-4" />}
                Apply Role-Key Migration
              </Button>
            </div>
            {roleKeyReport && (
              <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-sm">
                <div className="p-3 rounded bg-muted">
                  <div className="font-bold">{roleKeyReport.usersProcessed}</div>
                  <div className="text-muted-foreground text-xs">Users Processed</div>
                </div>
                <div className="p-3 rounded bg-green-100">
                  <div className="font-bold">{roleKeyReport.usersPatched}</div>
                  <div className="text-muted-foreground text-xs">Users Patched</div>
                </div>
                <div className="p-3 rounded bg-muted">
                  <div className="font-bold">{roleKeyReport.usersSkipped}</div>
                  <div className="text-muted-foreground text-xs">Users Skipped</div>
                </div>
                <div className="p-3 rounded bg-muted">
                  <div className="font-bold">{roleKeyReport.profilesProcessed}</div>
                  <div className="text-muted-foreground text-xs">Profiles Processed</div>
                </div>
                <div className="p-3 rounded bg-amber-100">
                  <div className="font-bold">{roleKeyReport.profilesPatched}</div>
                  <div className="text-muted-foreground text-xs">Profiles Patched</div>
                </div>
                <div className="p-3 rounded bg-blue-100">
                  <div className="font-bold">{roleKeyReport.profilesCloned}</div>
                  <div className="text-muted-foreground text-xs">Profiles Cloned</div>
                </div>
                <div className="p-3 rounded bg-muted">
                  <div className="font-bold">{roleKeyReport.profilesSkipped}</div>
                  <div className="text-muted-foreground text-xs">Profiles Skipped</div>
                </div>
              </div>
            )}
            {roleKeyReport && (
              <div className="border rounded overflow-x-auto max-h-[320px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Collection</TableHead>
                      <TableHead>Document</TableHead>
                      <TableHead>Legacy Plural</TableHead>
                      <TableHead>Mapped</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Updated Fields</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roleKeyReport.entries.map((e, idx) => (
                      <TableRow key={`${e.collection}-${e.documentId}-${idx}`}>
                        <TableCell>{e.collection}</TableCell>
                        <TableCell className="font-mono text-xs">{e.documentId}</TableCell>
                        <TableCell>
                          {e.legacyValues.length > 0 ? e.legacyValues.join(', ') : '—'}
                        </TableCell>
                        <TableCell>
                          {e.mappedValues.length > 0 ? e.mappedValues.join(', ') : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={e.status === 'patched' ? 'default' : 'secondary'}>
                            {e.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {e.updatedFields.length > 0 ? e.updatedFields.join(', ') : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payroll Role/Profile Normalization (Maintenance Only)</CardTitle>
            <CardDescription>
              This tool only fixes the exact mismatch: assignedRoleKey = payroll_officer but permissionProfileKey = hr_officer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <ShieldAlert className="h-5 w-5 text-blue-600" />
              <AlertTitle className="font-bold text-blue-800">Scope is intentionally narrow</AlertTitle>
              <AlertDescription className="text-blue-700 text-sm">
                Detect and patch only payroll-role/profile mismatch records. No unrelated role remapping.
                <br />
                Also ensures permission profile <code>payroll_officer</code> exists and template key is canonical.
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button
                onClick={() => handlePayrollProfileNormalization(false)}
                disabled={!canRun || isPayrollNormalizationRunning}
                variant="outline"
                className="gap-2"
              >
                {isPayrollNormalizationRunning ? <Loader2 className="animate-spin h-4 w-4" /> : <FileText className="h-4 w-4" />}
                Payroll Profile Dry Run
              </Button>
              <Button
                onClick={() => handlePayrollProfileNormalization(true)}
                disabled={!canRun || isPayrollNormalizationRunning}
                className="gap-2 bg-primary"
              >
                {isPayrollNormalizationRunning ? <Loader2 className="animate-spin h-4 w-4" /> : <Play className="h-4 w-4" />}
                Apply Payroll Profile Normalization
              </Button>
            </div>
            {payrollNormalizationReport && (
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
                <div className="p-3 rounded bg-muted">
                  <div className="font-bold">{payrollNormalizationReport.usersProcessed}</div>
                  <div className="text-muted-foreground text-xs">Users Processed</div>
                </div>
                <div className="p-3 rounded bg-green-100">
                  <div className="font-bold">{payrollNormalizationReport.usersPatched}</div>
                  <div className="text-muted-foreground text-xs">Users Patched</div>
                </div>
                <div className="p-3 rounded bg-muted">
                  <div className="font-bold">{payrollNormalizationReport.usersSkipped}</div>
                  <div className="text-muted-foreground text-xs">Users Skipped</div>
                </div>
                <div className="p-3 rounded bg-muted">
                  <div className="font-bold">{payrollNormalizationReport.profilesProcessed}</div>
                  <div className="text-muted-foreground text-xs">Profiles Processed</div>
                </div>
                <div className="p-3 rounded bg-amber-100">
                  <div className="font-bold">{payrollNormalizationReport.profilesPatched}</div>
                  <div className="text-muted-foreground text-xs">Profiles Patched</div>
                </div>
                <div className="p-3 rounded bg-muted">
                  <div className="font-bold">{payrollNormalizationReport.profilesSkipped}</div>
                  <div className="text-muted-foreground text-xs">Profiles Skipped</div>
                </div>
              </div>
            )}
            {payrollNormalizationReport && (
              <div className="border rounded overflow-x-auto max-h-[320px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Collection</TableHead>
                      <TableHead>Document</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Updated Fields</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payrollNormalizationReport.entries.map((e, idx) => (
                      <TableRow key={`${e.collection}-${e.documentId}-${idx}`}>
                        <TableCell>{e.collection}</TableCell>
                        <TableCell className="font-mono text-xs">{e.documentId}</TableCell>
                        <TableCell>
                          <Badge variant={e.status === 'patched' ? 'default' : 'secondary'}>{e.status}</Badge>
                        </TableCell>
                        <TableCell>{e.reason}</TableCell>
                        <TableCell>{e.updatedFields.length > 0 ? e.updatedFields.join(', ') : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
