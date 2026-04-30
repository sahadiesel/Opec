'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FileQuestion, Plus, ChevronRight, Loader2, PackageSearch, Search } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, orderBy, query } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canApprovePurchaseAsManager } from '@/lib/permissions';
import { PurchaseRequest, PurchaseRequestStatus, User, Vendor } from '@/lib/types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';

function statusBadge(s: PurchaseRequestStatus) {
  const map: Record<PurchaseRequestStatus, { label: string; className: string }> = {
    DRAFT: { label: 'ฉบับร่าง', className: 'bg-slate-100 text-slate-800' },
    PENDING_APPROVAL: { label: 'รออนุมัติ', className: 'bg-amber-100 text-amber-900' },
    APPROVED: { label: 'อนุมัติแล้ว', className: 'bg-green-100 text-green-900' },
    REJECTED: { label: 'ไม่อนุมัติ', className: 'bg-red-100 text-red-800' },
    CANCELLED: { label: 'ยกเลิก', className: 'bg-muted' },
  };
  const c = map[s] || { label: s, className: 'bg-muted' };
  return <Badge className={c.className}>{c.label}</Badge>;
}

function tabFilter(tab: string, s: PurchaseRequestStatus): boolean {
  if (tab === 'all') return true;
  if (tab === 'drafts') return s === 'DRAFT';
  if (tab === 'pending') return s === 'PENDING_APPROVAL';
  if (tab === 'approved') return s === 'APPROVED' || s === 'REJECTED' || s === 'CANCELLED';
  return true;
}

export default function StorePurchaseRequestsPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const [q, setQ] = useState('');

  const okStore = useMemo(
    () => !!currentUser && canView(currentUser, 'store_inventory'),
    [currentUser]
  );
  const canApprove = useMemo(() => canApprovePurchaseAsManager(currentUser), [currentUser]);
  const ok = okStore || canApprove;

  const prQuery = useMemoFirebase(() => {
    if (!firestore || !ok) return null;
    return query(collection(firestore, 'purchase_requests'), orderBy('createdAt', 'desc'));
  }, [firestore, ok]);

  const { data: list, isLoading } = useCollection<PurchaseRequest>(prQuery as any);
  const vendorsQuery = useMemoFirebase(() => (firestore && ok ? collection(firestore, 'vendors') : null), [firestore, ok]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  const [tab, setTab] = useState('all');

  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (list || [])
      .filter((r) => tabFilter(tab, r.status))
      .filter((r) => {
        if (!qq) return true;
        return (
          (r.requestNo && r.requestNo.toLowerCase().includes(qq)) ||
          (r.title && r.title.toLowerCase().includes(qq)) ||
          (vendors?.find((v) => v.id === r.vendorId)?.vendorName || '').toLowerCase().includes(qq)
        );
      });
  }, [list, q, tab, vendors]);

  if (isUserLoading || userLoading || !currentUser) {
    return (
      <div className="flex min-h-[50vh] w-full items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }
  if (!ok) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <p className="p-8 text-center text-muted-foreground">คุณไม่มีสิทธิ์</p>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold text-primary">
              <FileQuestion className="h-8 w-8" /> คำขออนุมัติสั่งซื้อ (PR)
            </h1>
            <p className="mt-1 text-muted-foreground">
              สร้าง PR แล้วส่งให้ผู้จัดการฝ่ายปฏิบัติการอนุมัติ — อนุมัติแล้วแผนกคลัง/จัดซื้อจะสร้างใบสั่งซื้อโดยอ้างอิง PR
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/purchases">
                <PackageSearch className="mr-2 h-4 w-4" />
                ใบสั่งซื้อ
              </Link>
            </Button>
            {okStore && (
              <Button className="font-bold" asChild>
                <Link href="/store/purchase-requests/new">
                  <Plus className="mr-2 h-4 w-4" /> สร้าง PR
                </Link>
              </Button>
            )}
          </div>
        </div>

        {canApprove && (list || []).filter((r) => r.status === 'PENDING_APPROVAL').length > 0 && (
          <p className="text-sm text-amber-800">
            มี PR รออนุมัติ {(list || []).filter((r) => r.status === 'PENDING_APPROVAL').length} รายการ — เปิดรายละเอียดเพื่ออนุมัติ/ไม่อนุมัติ
          </p>
        )}

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList>
              <TabsTrigger value="all">ทั้งหมด</TabsTrigger>
              <TabsTrigger value="drafts">ฉบับร่าง</TabsTrigger>
              <TabsTrigger value="pending">รออนุมัติ</TabsTrigger>
              <TabsTrigger value="approved">สรุปผล</TabsTrigger>
            </TabsList>
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 pl-9"
                placeholder="ค้นหาเลขที่ หัวข้อ หรือคู่ค้า..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
        </Tabs>

        <Card className="mt-2 border-none shadow-md">
          <CardHeader>
            <CardTitle className="text-lg">รายการ PR</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-16 text-center text-muted-foreground">กำลังโหลด…</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">เลขที่ PR</TableHead>
                    <TableHead>หัวข้อ / รายละเอียด</TableHead>
                    <TableHead>คู่ค้า (เสนอ)</TableHead>
                    <TableHead className="text-right">ประมาณการ</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="pr-6 text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const v = vendors?.find((x) => x.id === r.vendorId);
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/30"
                        onClick={() => router.push(`/store/purchase-requests/${r.id}`)}
                      >
                        <TableCell className="pl-6 font-mono font-bold text-primary">{r.requestNo}</TableCell>
                        <TableCell>
                          <div className="font-medium">{r.title || '—'}</div>
                          {r.notes && <p className="line-clamp-1 text-xs text-muted-foreground">{r.notes}</p>}
                        </TableCell>
                        <TableCell>{v?.vendorName || '—'}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {r.estimatedAmount != null && r.estimatedAmount > 0
                            ? `฿${r.estimatedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                            : '—'}
                        </TableCell>
                        <TableCell>{statusBadge(r.status)}</TableCell>
                        <TableCell className="pr-6 text-right">
                          <Button type="button" size="icon" variant="ghost">
                            <ChevronRight className="h-5 w-5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-16 text-center text-muted-foreground">
                        ไม่มีรายการ
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
