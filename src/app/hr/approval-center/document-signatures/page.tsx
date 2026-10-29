'use client';

import { useState } from 'react';
import Link from 'next/link';
import { collection, query, where } from 'firebase/firestore';
import { Loader2, PenLine } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppUser } from '@/hooks/use-app-user';
import { useCollection, useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { canViewHrApprovalSubsection } from '@/lib/navigation/nav-access';
import { isSystemAdmin } from '@/lib/permission-core';
import { isSimpleAdmin } from '@/lib/simple-tier-model';
import { decideDocumentSignature } from '@/lib/services/document-signature-request-service';
import { formatDateTimeThaiBE } from '@/lib/date-thai';
import { useToast } from '@/hooks/use-toast';
import type { DocumentSignatureRequest, User } from '@/lib/types';

const HREF: Record<DocumentSignatureRequest['sourceCollection'], (id: string) => string> = {
  tax_invoices: (id) => `/tax-invoices/${id}`,
  commercial_invoices: (id) => `/draft-invoices/${id}`,
  quotations: (id) => `/quotations/${id}`,
};

export default function DocumentSignatureApprovalPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const approvalGate =
    !!currentUser &&
    canViewHrApprovalSubsection(currentUser as User, isSystemAdmin(currentUser) || isSimpleAdmin(currentUser));

  const pendingQ = useMemoFirebase(
    () =>
      firestore && approvalGate
        ? query(collection(firestore, 'document_signature_requests'), where('status', '==', 'PENDING'))
        : null,
    [firestore, approvalGate],
  );
  const { data: rows, isLoading } = useCollection<DocumentSignatureRequest>(pendingQ as never);

  const selfRef = useMemoFirebase(
    () => (firestore && currentUser ? doc(firestore, 'users', currentUser.id) : null),
    [firestore, currentUser],
  );
  const { data: self } = useDoc<User>(selfRef as never);

  const decide = async (row: DocumentSignatureRequest, decision: 'APPROVED' | 'REJECTED') => {
    if (!firestore || !currentUser) return;
    setBusyId(row.id);
    try {
      await decideDocumentSignature(
        firestore,
        row,
        currentUser,
        decision,
        decision === 'APPROVED' ? self?.signatureImageUrl || currentUser.signatureImageUrl : undefined,
      );
      toast({
        title: decision === 'APPROVED' ? 'อนุมัติลายเซ็นแล้ว' : 'ปฏิเสธคำขอแล้ว',
        description: row.documentNo,
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  if (userLoading || !currentUser) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">กำลังโหลด…</div>;
  }
  if (!approvalGate) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="mx-auto max-w-lg py-20 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าหน้านี้</div>
      </AppShell>
    );
  }

  const list = [...(rows ?? [])].sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-primary">
              <PenLine className="h-7 w-7" />
              รออนุมัติการเซ็นต์เอกสาร
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              อนุมัติแล้วลายเซ็นของผู้จัดการจะถูกใส่ในช่องผู้มีอำนาจลงนาม ตอนพิมพ์เอกสารเลือก “ลายเซ็น” เพื่อแสดงรูป
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/hr/approval-center">กลับศูนย์อนุมัติ</Link>
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : list.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">ไม่มีคำขอรออนุมัติ</CardContent>
          </Card>
        ) : (
          list.map((row) => (
            <Card key={row.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {row.documentLabel} · <span className="font-mono">{row.documentNo}</span>
                </CardTitle>
                <CardDescription>
                  ขอโดย {row.requestedByName || '—'} · {row.requestedAt ? formatDateTimeThaiBE(row.requestedAt) : '—'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={HREF[row.sourceCollection](row.sourceId)}>เปิดเอกสาร</Link>
                </Button>
                <Button size="sm" disabled={busyId === row.id} onClick={() => void decide(row, 'APPROVED')}>
                  {busyId === row.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  อนุมัติและใส่ลายเซ็น
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={busyId === row.id}
                  onClick={() => void decide(row, 'REJECTED')}
                >
                  ปฏิเสธ
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
