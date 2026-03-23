'use client';

import { useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Database,
  RefreshCw,
  Play,
  FileText,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  UserX,
  Loader2,
  ArrowLeft,
  Download,
} from 'lucide-react';
import { useFirestore, useUser } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { isSystemAdmin } from '@/lib/permission-core';
import {
  runUserAuthMigration,
  type MigrationReport,
  type UserMigrationEntry,
} from '@/lib/migration/user-auth-migration';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Checkbox } from '@/components/ui/checkbox';

export default function UserMigrationPage() {
  const firestore = useFirestore();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser } = useUser();
  const { toast } = useToast();

  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<MigrationReport | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [skipNeedsReview, setSkipNeedsReview] = useState(true);

  const canRun = firestore && currentUser && isSystemAdmin(currentUser);

  const handleRun = async (apply: boolean) => {
    if (!firestore || !currentUser?.id) return;
    if (!isSystemAdmin(currentUser)) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
      return;
    }

    setIsRunning(true);
    setReport(null);
    try {
      const r = await runUserAuthMigration(firestore, {
        actorUid: currentUser.id,
        dryRun: apply ? false : true,
        skipNeedsReview,
      });
      setReport(r);
      toast({
        title: apply ? 'Migration เสร็จสิ้น' : 'Dry Run เสร็จสิ้น',
        description: apply
          ? `อัปเดต ${r.usersPatched} ผู้ใช้, สร้าง ${r.profilesCreated.length} โปรไฟล์`
          : `จะอัปเดต ${r.usersPatched} ผู้ใช้ (ยังไม่ได้เขียน)`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsRunning(false);
    }
  };

  const handleDownloadReport = () => {
    if (!report) return;
    const lines = [
      `# User Auth Migration Report`,
      `Timestamp: ${new Date(report.timestamp).toISOString()}`,
      `Actor: ${report.actorUid}`,
      `Dry Run: ${report.dryRun}`,
      ``,
      `## Summary`,
      `- Users processed: ${report.usersProcessed}`,
      `- Users patched: ${report.usersPatched}`,
      `- Users skipped: ${report.usersSkipped}`,
      `- Needs review: ${report.usersNeedsReview}`,
      `- Conflicts: ${report.usersConflict}`,
      `- Profiles created: ${report.profilesCreated.join(', ') || 'none'}`,
      ``,
      `## Entries`,
      `| User | Email | Legacy | Mapped | Confidence | Conflict | Applied |`,
      `|------|-------|--------|--------|------------|----------|---------|`,
      ...report.entries.map(
        (e) =>
          `| ${e.displayName} | ${e.email} | ${e.legacyRole || e.legacyDepartment || '-'} | ${e.mappedCanonical} | ${e.confidence} | ${e.hasConflict ? 'Yes' : ''} | ${e.patchApplied ? 'Yes' : ''} |`
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `migration-report-${report.timestamp}.md`;
    a.click();
    URL.revokeObjectURL(url);
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
              <Database className="h-7 w-7" /> Migration สิทธิ์ผู้ใช้ (User Auth)
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Backfill departmentGroup, accessLevel, assignedRoleKey, permissionProfileKey จาก legacy
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
            Migration จะ <strong>เพิ่ม</strong> fields ใหม่เท่านั้น ไม่ลบข้อมูลเก่า
            ผู้ใช้ที่ข้อมูลไม่ชัดจะถูก mark เป็น needs_review แทนการเดาสุ่ม
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>ตัวเลือก</CardTitle>
            <CardDescription>
              Dry Run = ดูผลลัพธ์โดยไม่เขียน Firestore
              Apply = เขียนการเปลี่ยนแปลงจริง
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={dryRun} onCheckedChange={(v) => setDryRun(!!v)} />
                <span>Dry Run (แนะนำก่อน apply จริง)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={skipNeedsReview} onCheckedChange={(v) => setSkipNeedsReview(!!v)} />
                <span>ข้ามผู้ใช้ที่ needs_review (ไม่ patch)</span>
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => handleRun(false)}
                disabled={!canRun || isRunning}
                variant="outline"
                className="gap-2"
              >
                {isRunning ? <Loader2 className="animate-spin h-4 w-4" /> : <FileText className="h-4 w-4" />}
                Dry Run
              </Button>
              <Button
                onClick={() => handleRun(true)}
                disabled={!canRun || isRunning}
                className="gap-2 bg-primary"
              >
                {isRunning ? <Loader2 className="animate-spin h-4 w-4" /> : <Play className="h-4 w-4" />}
                Apply Migration
              </Button>
            </div>
          </CardContent>
        </Card>

        {report && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>รายงาน Migration</CardTitle>
                <CardDescription>
                  {report.dryRun ? 'Dry Run — ไม่มีการเขียน' : 'มีการอัปเดต Firestore'}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleDownloadReport} className="gap-2">
                <Download className="h-4 w-4" /> ดาวน์โหลด
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
                <div className="p-3 rounded bg-muted">
                  <div className="font-bold">{report.usersProcessed}</div>
                  <div className="text-muted-foreground text-xs">Processed</div>
                </div>
                <div className="p-3 rounded bg-green-100">
                  <div className="font-bold">{report.usersPatched}</div>
                  <div className="text-muted-foreground text-xs">Patched</div>
                </div>
                <div className="p-3 rounded bg-muted">
                  <div className="font-bold">{report.usersSkipped}</div>
                  <div className="text-muted-foreground text-xs">Skipped</div>
                </div>
                <div className="p-3 rounded bg-amber-100">
                  <div className="font-bold">{report.usersNeedsReview}</div>
                  <div className="text-muted-foreground text-xs">Needs Review</div>
                </div>
                <div className="p-3 rounded bg-red-100">
                  <div className="font-bold">{report.usersConflict}</div>
                  <div className="text-muted-foreground text-xs">Conflict</div>
                </div>
                <div className="p-3 rounded bg-blue-100">
                  <div className="font-bold">{report.profilesCreated.length}</div>
                  <div className="text-muted-foreground text-xs">Profiles Created</div>
                </div>
              </div>

              {report.profilesCreated.length > 0 && (
                <div>
                  <div className="text-sm font-bold mb-1">Profiles ที่สร้างใหม่:</div>
                  <div className="flex flex-wrap gap-1">
                    {report.profilesCreated.map((k) => (
                      <Badge key={k} variant="secondary">
                        {k}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {report.errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Errors</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {report.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <div className="border rounded overflow-x-auto max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Legacy</TableHead>
                      <TableHead>Mapped</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Conflict</TableHead>
                      <TableHead>Applied</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.entries.map((e) => (
                      <TableRow key={e.userId}>
                        <TableCell>
                          <div className="font-medium">{e.displayName || e.email}</div>
                          <div className="text-xs text-muted-foreground">{e.email}</div>
                        </TableCell>
                        <TableCell>
                          {e.legacyRole || e.legacyDepartment || '-'}
                          {e.legacyLevel && ` / ${e.legacyLevel}`}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{e.mappedCanonical}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              e.confidence === 'needs_review'
                                ? 'destructive'
                                : e.confidence === 'high'
                                  ? 'default'
                                  : 'secondary'
                            }
                          >
                            {e.confidence}
                          </Badge>
                        </TableCell>
                        <TableCell>{e.hasConflict ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : '-'}</TableCell>
                        <TableCell>{e.patchApplied ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
