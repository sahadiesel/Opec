'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { canSeeAccountingPillarUi } from '@/lib/permissions';
import { usePermissions } from '@/hooks/use-permissions';
import type { User, WithholdingCertificateDocument } from '@/lib/types';
import { Building2, ExternalLink, Loader2, Search } from 'lucide-react';

function isVendorPartnerWhtDoc(d: WithholdingCertificateDocument): boolean {
  return typeof d.sourceVendorBillId === 'string' && d.sourceVendorBillId.trim().length > 0;
}

function statusLabel(s: WithholdingCertificateDocument['documentStatus']): string {
  if (s === 'ISSUED') return 'ออกแล้ว';
  if (s === 'VERIFIED') return 'ตรวจแล้ว';
  if (s === 'CANCELLED') return 'ยกเลิก';
  if (s === 'REPLACED') return 'แทนที่';
  return 'ร่าง';
}

function fmtBaht(n: number): string {
  return `฿${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AccountingWithholdingVendorDocumentsPage() {
  const { currentUser, isLoading } = useAppUser();
  const { profile } = usePermissions(currentUser);
  const firestore = useFirestore();
  const [q, setQ] = useState('');

  const whtQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'withholding_certificate_documents'), orderBy('createdAt', 'desc'));
  }, [firestore]);

  const { data: rows, isLoading: loadingDocs, error } = useCollection<WithholdingCertificateDocument>(whtQuery as any);

  const vendorDocs = useMemo(() => (rows || []).filter(isVendorPartnerWhtDoc), [rows]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return vendorDocs;
    return vendorDocs.filter((d) => {
      const payee = (d.payee?.displayName || '').toLowerCase();
      const cert = (d.certificateNo || '').toLowerCase();
      const bill = (d.referenceVendorBillNo || '').toLowerCase();
      const po = (d.referencePurchaseNo || '').toLowerCase();
      return payee.includes(t) || cert.includes(t) || bill.includes(t) || po.includes(t) || d.id.toLowerCase().includes(t);
    });
  }, [vendorDocs, q]);

  if (isLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const user = currentUser as User;
  if (!canSeeAccountingPillarUi(user, profile)) {
    return (
      <AppShell user={user} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูบัญชี</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6 py-6 px-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-7 w-7 text-muted-foreground" />
            2. เอกสาร หัก ณ ที่จ่าย (คู่ค้า)
          </h1>
          <p className="text-muted-foreground mt-1">
            รายการหนังสือรับรองหัก ณ ที่จ่าย (ภงด.53 ฯลฯ) ที่สร้างจากการบันทึกจ่ายใบรับวางบิลคู่ค้า — เปิดรายละเอียดเพื่อพิมพ์ / XML
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ค้นหา</CardTitle>
            <CardDescription>ชื่อคู่ค้า เลขที่หนังสือ เลขที่ใบวางบิล เลข PO หรือรหัสเอกสาร</CardDescription>
            <div className="relative max-w-md pt-2">
              <Search className="absolute left-2.5 top-4 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="พิมพ์คำค้น..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            {error ? (
              <p className="text-sm text-destructive">โหลดข้อมูลไม่สำเร็จ — {String((error as Error)?.message || error)}</p>
            ) : loadingDocs ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {vendorDocs.length === 0
                  ? 'ยังไม่มีเอกสารหัก ณ ที่จ่ายจากคู่ค้า (จะถูกสร้างเมื่อบันทึกจ่ายใบวางบิลที่มีหัก ณ ที่จ่าย)'
                  : 'ไม่พบรายการที่ตรงกับคำค้น'}
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>สถานะ</TableHead>
                      <TableHead>เลขที่หนังสือ</TableHead>
                      <TableHead>คู่ค้า</TableHead>
                      <TableHead>วันที่จ่าย</TableHead>
                      <TableHead className="text-right">ยอดหัก</TableHead>
                      <TableHead>ใบวางบิล / PO</TableHead>
                      <TableHead className="w-[100px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <Badge variant={d.documentStatus === 'ISSUED' ? 'default' : 'secondary'}>
                            {statusLabel(d.documentStatus)}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{d.certificateNo?.trim() || '—'}</TableCell>
                        <TableCell className="max-w-[220px]">
                          <div className="truncate font-medium">{d.payee?.displayName?.trim() || '—'}</div>
                          {d.payee?.taxId ? (
                            <div className="text-xs text-muted-foreground font-mono">{d.payee.taxId}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{d.paymentDate || '—'}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{fmtBaht(d.withholdingTaxAmount)}</TableCell>
                        <TableCell className="text-sm">
                          <div className="font-mono">{d.referenceVendorBillNo || '—'}</div>
                          {d.referencePurchaseNo ? (
                            <div className="text-xs text-muted-foreground">PO {d.referencePurchaseNo}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/accounting/wht-certificates/${d.id}`}
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            เปิด
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </TableCell>
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
