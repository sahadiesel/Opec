'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  User,
  Worker,
  WorkerCertificate,
  WorkerMedicalRecord,
  WorkerDrugTest,
  WorkerDocument,
} from '@/lib/types';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection } from 'firebase/firestore';
import { isClient } from '@/lib/permissions';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { formatDateTimeThaiBE } from '@/lib/date-thai';
import { Badge } from '@/components/ui/badge';

export default function ClientWorkerDocumentsPage({ params }: { params: Promise<{ workerId: string }> }) {
  const { workerId } = use(params);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  useUser();
  const firestore = useFirestore();
  const { locale } = usePortalLocale();

  useEffect(() => {
    const raw = localStorage.getItem('opsflow_user');
    if (raw) setCurrentUser(JSON.parse(raw));
  }, []);

  const ready = Boolean(firestore && currentUser && isClient(currentUser));

  const workerRef = useMemoFirebase(() => (ready ? doc(firestore!, 'workers', workerId) : null), [firestore, workerId, ready]);
  const { data: worker, error: workerErr } = useDoc<Worker>(workerRef as any);

  const certsQ = useMemoFirebase(
    () => (ready ? collection(firestore!, 'workers', workerId, 'certificates') : null),
    [firestore, workerId, ready]
  );
  const { data: certs } = useCollection<WorkerCertificate>(certsQ as any);

  const medQ = useMemoFirebase(
    () => (ready ? collection(firestore!, 'workers', workerId, 'medical_records') : null),
    [firestore, workerId, ready]
  );
  const { data: medicals } = useCollection<WorkerMedicalRecord>(medQ as any);

  const drugQ = useMemoFirebase(
    () => (ready ? collection(firestore!, 'workers', workerId, 'drug_tests') : null),
    [firestore, workerId, ready]
  );
  const { data: drugs } = useCollection<WorkerDrugTest>(drugQ as any);

  const docsQ = useMemoFirebase(
    () => (ready ? collection(firestore!, 'workers', workerId, 'documents') : null),
    [firestore, workerId, ready]
  );
  const { data: wdocs } = useCollection<WorkerDocument>(docsQ as any);

  if (!currentUser || !isClient(currentUser)) {
    return <p className="text-sm text-muted-foreground">Portal only.</p>;
  }

  if (workerErr || (worker === null && ready)) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/client-portal/workers">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {locale === 'en' ? 'Back' : 'กลับ'}
          </Link>
        </Button>
        <p className="text-sm text-destructive">
          {locale === 'en'
            ? 'No access to this worker profile. Ask OPEC to add your company to assignedCustomerIds on the worker record.'
            : 'ไม่มีสิทธิ์ดูคนงานนี้ — ให้ OPEC เพิ่มบริษัทท่านใน assignedCustomerIds ที่เรกคอร์ดคนงาน'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/client-portal/workers">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {locale === 'en' ? 'Personnel list' : 'รายชื่อกำลังพล'}
          </Link>
        </Button>
      </div>

      <div>
        <h2 className="text-xl font-bold text-primary">
          {worker ? `${worker.firstName} ${worker.lastName}` : '…'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {locale === 'en' ? 'Shared compliance documents (read-only).' : 'เอกสารที่เปิดให้ดู (อ่านอย่างเดียว)'}
        </p>
        {worker?.readinessStatus && (
          <Badge variant="outline" className="mt-2">
            {worker.readinessStatus}
          </Badge>
        )}
      </div>

      <DocTable
        title={locale === 'en' ? 'Certificates' : 'ใบรับรอง'}
        rows={(certs ?? []).map((c) => ({
          k: c.id,
          a: c.certificateName,
          b: c.certificateNo || '—',
          c: formatDateTimeThaiBE(c.expiryDate),
        }))}
        locale={locale}
      />
      <DocTable
        title={locale === 'en' ? 'Medical' : 'ตรวจสุขภาพ'}
        rows={(medicals ?? []).map((m) => ({
          k: m.id,
          a: m.medicalType,
          b: m.fitStatus,
          c: formatDateTimeThaiBE(m.expiryDate),
        }))}
        locale={locale}
      />
      <DocTable
        title={locale === 'en' ? 'Drug tests' : 'ตรวจสารเสพติด'}
        rows={(drugs ?? []).map((d) => ({
          k: d.id,
          a: d.substanceLabelSnapshot || d.substanceKey || '—',
          b: d.result,
          c: formatDateTimeThaiBE(d.testDate),
        }))}
        locale={locale}
      />
      <DocTable
        title={locale === 'en' ? 'Other documents' : 'เอกสารอื่น'}
        rows={(wdocs ?? []).map((d) => ({
          k: d.id,
          a: d.documentType,
          b: d.documentNo,
          c: formatDateTimeThaiBE(d.expiryDate),
        }))}
        locale={locale}
      />
    </div>
  );
}

function DocTable({
  title,
  rows,
  locale,
}: {
  title: string;
  rows: { k: string; a: string; b: string; c: string }[];
  locale: string;
}) {
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{locale === 'en' ? 'Item' : 'รายการ'}</TableHead>
              <TableHead>{locale === 'en' ? 'Ref' : 'อ้างอิง'}</TableHead>
              <TableHead>{locale === 'en' ? 'Expiry / date' : 'วันหมดอายุ'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.k}>
                <TableCell className="text-sm">{r.a}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.b}</TableCell>
                <TableCell className="text-xs">{r.c}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-6 text-muted-foreground text-sm">
                  —
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
