'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  Worker,
  WorkerCertificate,
  WorkerMedicalRecord,
  WorkerDrugTest,
  WorkerDocument,
} from '@/lib/types';
import { useFirestore, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection } from 'firebase/firestore';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { formatDateTimeThaiBE } from '@/lib/date-thai';
import { Badge } from '@/components/ui/badge';

type DocRow = {
  k: string;
  a: string;
  b: string;
  c: string;
  url?: string | null;
};

export default function ClientWorkerDocumentsPage({ params }: { params: Promise<{ workerId: string }> }) {
  const { workerId } = use(params);
  const { effectiveUser: currentUser, canAccessPortal, appUserLoading } = useClientPortalIdentity();
  const firestore = useFirestore();
  const { locale } = usePortalLocale();

  const ready = Boolean(firestore && currentUser && canAccessPortal);

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

  if (appUserLoading) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }

  if (!currentUser || !canAccessPortal) {
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
            ? 'No access to this worker profile. Ask OPEC to open document sharing for your company on this worker (assignedCustomerIds).'
            : 'ไม่มีสิทธิ์ดูคนงานนี้ — ให้ OPEC เปิดสิทธิ์แชร์เอกสารให้บริษัทท่านบนเรกคอร์ดคนงาน (assignedCustomerIds)'}
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
          url: c.attachment?.downloadUrl,
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
          url: m.attachment?.downloadUrl,
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
          url: d.attachment?.downloadUrl,
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
          url: d.attachment?.downloadUrl,
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
  rows: DocRow[];
  locale: string;
}) {
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table className="table-fixed w-full">
          <colgroup>
            <col className="w-[40%]" />
            <col className="w-[22%]" />
            <col className="w-[26%]" />
            <col className="w-[12%]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">{locale === 'en' ? 'Item' : 'รายการ'}</TableHead>
              <TableHead className="px-4">{locale === 'en' ? 'Ref' : 'อ้างอิง'}</TableHead>
              <TableHead className="px-4">{locale === 'en' ? 'Expiry / date' : 'วันหมดอายุ'}</TableHead>
              <TableHead className="px-4 text-right">{locale === 'en' ? 'File' : 'ไฟล์'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.k}>
                <TableCell className="px-4 text-sm align-middle break-words">{r.a || '—'}</TableCell>
                <TableCell className="px-4 text-xs text-muted-foreground align-middle break-words">
                  {r.b || '—'}
                </TableCell>
                <TableCell className="px-4 text-xs align-middle whitespace-nowrap">{r.c || '—'}</TableCell>
                <TableCell className="px-4 text-right align-middle">
                  {r.url ? (
                    <Button variant="ghost" size="sm" className="h-8 px-2" asChild>
                      <a href={r.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        <span className="sr-only">{locale === 'en' ? 'Open file' : 'เปิดไฟล์'}</span>
                      </a>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="px-4 text-center py-6 text-muted-foreground text-sm">
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
