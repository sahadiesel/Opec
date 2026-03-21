
'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ShieldCheck, Eye, FileText, CheckCircle2, XCircle, Users, AlertCircle, HardHat, ChevronRight } from 'lucide-react';
import { User, Assignment, Worker } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, where } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import Link from 'next/link';

/**
 * Legacy Candidate Review Page - Refactored to Personnel Directory for document portal model.
 */
export default function ClientPersonnelDirectoryPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isClientAccess = useMemo(() => {
    return currentUser?.department === 'client' || currentUser?.department === 'admin' || currentUser?.userType === 'customer_portal';
  }, [currentUser]);

  // Standardized to scoped 'mobilizations' collection
  const mobilizationQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser || !isClientAccess) return null;
    const service = new CustomerQueryService(firestore);
    return service.getScopedAssignmentsQuery(currentUser);
  }, [firestore, currentUser, isClientAccess]);

  const { data: assignments, isLoading: isAssignmentsLoading } = useCollection<Assignment>(mobilizationQuery as any);

  const workersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser || !isClientAccess) return null;
    return collection(firestore, 'workers');
  }, [firestore, currentUser, isClientAccess]);
  
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  if (isUserLoading || !currentUser) return null;

  if (!isClientAccess) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground opacity-50" />
          <h2 className="text-xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground">This portal is reserved for Client representatives.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <HardHat className="h-6 w-6" /> รายชื่อกำลังพลและประวัติ (Personnel Directory)
            </h1>
            <p className="text-muted-foreground">
              {currentUser.userType === 'internal' ? 'Internal Monitoring View' : `Customer Account: ${currentUser.displayName}`}
            </p>
          </div>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardHeader className="bg-primary/5 border-b pb-4">
            <CardTitle className="text-lg">ทำเนียบพนักงานโครงการ (Project Roster)</CardTitle>
            <CardDescription>ตรวจสอบประวัติและใบรับรองของพนักงานที่ปฏิบัติงานในโครงการของท่าน</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isAssignmentsLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4 font-bold">ชื่อพนักงาน (Worker)</TableHead>
                    <TableHead className="font-bold">ตำแหน่งหลัก</TableHead>
                    <TableHead className="font-bold">สถานะล่าสุด</TableHead>
                    <TableHead className="font-bold">โครงการ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments?.map((asgn) => {
                    const worker = allWorkers?.find(w => w.id === asgn.workerId);
                    return (
                      <TableRow key={asgn.id} className="hover:bg-muted/20 transition-all">
                        <TableCell className="pl-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-primary">{worker ? `${worker.firstName} ${worker.lastName}` : 'N/A'}</span>
                            <span className="text-[10px] text-muted-foreground font-mono uppercase">REF: {asgn.assignmentNo || asgn.id.substring(0,8)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-white text-primary border-primary/20 text-[10px] font-bold">
                            {asgn.positionId}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[9px] font-black uppercase tracking-tighter">
                            {asgn.deploymentStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-medium text-slate-600 truncate max-w-[200px]">
                          {asgn.projectName}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button size="sm" variant="outline" className="font-bold text-xs h-8 group" asChild>
                            <Link href={`/client-portal/waves`}>
                              <Eye className="h-3.5 w-3.5 mr-1.5" /> ดูข้อมูลพนักงาน <ChevronRight className="h-3 w-3 ml-1 group-hover:translate-x-1 transition-all" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!assignments || assignments.length === 0) && !isAssignmentsLoading && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">ไม่มีข้อมูลพนักงานรอดำเนินการในขณะนี้</TableCell>
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
