'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, limit, query } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useAppUser } from '@/hooks/use-app-user';
import { isSystemAdmin } from '@/lib/permission-core';
import type { Customer } from '@/lib/types';
import { setPortalAdminCustomerId } from '@/lib/client-portal/portal-session-storage';

export default function EnterClientPortalPage() {
  const router = useRouter();
  const auth = useAuth();
  const firestore = useFirestore();
  const { currentUser, isLoading } = useAppUser();
  const [search, setSearch] = useState('');
  const [enteringId, setEnteringId] = useState<string | null>(null);

  const customersQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'customers'), limit(500)) : null),
    [firestore],
  );
  const { data: customersRaw, isLoading: customersLoading } = useCollection<Customer>(customersQuery as any);

  const rows = useMemo(() => {
    const list = customersRaw ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (c) =>
            (c.name || '').toLowerCase().includes(q) ||
            (c.customerCode || '').toLowerCase().includes(q) ||
            (c.id || '').toLowerCase().includes(q),
        )
      : list;
    return [...filtered].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th', { sensitivity: 'base' }));
  }, [customersRaw, search]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch {
      /* ignore */
    }
    router.push('/');
  };

  const openPortalAs = (customerId: string) => {
    setEnteringId(customerId);
    setPortalAdminCustomerId(customerId);
    router.push('/client-portal/dashboard');
  };

  if (isLoading || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isSystemAdmin(currentUser)) {
    return (
      <AppShell user={currentUser} onLogout={() => void handleLogout()}>
        <div className="mx-auto max-w-lg py-16 text-center text-muted-foreground">
          <p>เฉพาะผู้ดูแลระบบ (System Administrator) เท่านั้นที่เปิดโหมดนี้ได้</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => void handleLogout()}>
      <div className="mx-auto max-w-5xl space-y-6 py-6 px-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <ExternalLink className="h-6 w-6 shrink-0 text-primary" />
            เข้าสู่ Client Portal
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            เลือกลูกค้าเพื่อเปิดพอร์ทัลในแท็บนี้ด้วยสิทธิ์ Approver — ใช้ตรวจข้อมูลหรือช่วยลูกค้าโดยไม่ต้องล็อกอินบัญชีลูกค้า การเข้าถึงข้อมูลยังผูกสิทธิ์ Firestore ของบัญชีแอดมินของคุณ
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">เลือกลูกค้า</CardTitle>
            <CardDescription>ค้นหาชื่อหรือรหัสลูกค้า แล้วกดเข้าพอร์ทัล</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative max-w-md">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="ค้นหา…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="rounded-md border max-h-[min(60vh,520px)] overflow-auto">
              {customersLoading ? (
                <div className="flex justify-center py-12 text-muted-foreground gap-2 items-center">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  กำลังโหลดรายชื่อลูกค้า…
                </div>
              ) : rows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">ไม่พบลูกค้า</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ชื่อลูกค้า</TableHead>
                      <TableHead className="w-[140px]">รหัส</TableHead>
                      <TableHead className="w-[160px] text-right">การทำงาน</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{c.customerCode || c.id.slice(0, 8)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={enteringId !== null}
                            className="gap-1"
                            onClick={() => openPortalAs(c.id)}
                          >
                            {enteringId === c.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ExternalLink className="h-3.5 w-3.5" />
                            )}
                            เข้าพอร์ทัล
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
