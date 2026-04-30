'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { addDoc, collection } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { Vendor, User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function NewPurchaseRequestPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [vendorId, setVendorId] = useState<string | undefined>(undefined);
  const [estStr, setEstStr] = useState('');

  const ok = useMemo(
    () => !!currentUser && canView(currentUser, 'store_inventory'),
    [currentUser]
  );
  const vendorsQuery = useMemoFirebase(() => (firestore && ok ? collection(firestore, 'vendors') : null), [firestore, ok]);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as any);

  const save = async (submitForApproval: boolean) => {
    if (!firestore || !currentUser) return;
    const t = title.trim();
    if (!t) {
      toast({ variant: 'destructive', title: 'ระบุหัวข้อ' });
      return;
    }
    if (submitForApproval) {
      if (!vendorId) {
        toast({ variant: 'destructive', title: 'ระบุคู่ค้า', description: 'จำเป็นตอนส่งอนุมัติ' });
        return;
      }
    }
    setSaving(true);
    try {
      const { code } = await generateNextDocumentCode(firestore, 'purchase_request', {
        actor: currentUser.displayName || currentUser.email,
      });
      const now = Date.now();
      const est = parseFloat(estStr.replace(/,/g, ''));
      const prRef = await addDoc(collection(firestore, 'purchase_requests'), {
        requestNo: code,
        title: t,
        notes: notes.trim() || undefined,
        vendorId: vendorId || undefined,
        estimatedAmount: Number.isFinite(est) && est > 0 ? est : undefined,
        status: submitForApproval ? 'PENDING_APPROVAL' : 'DRAFT',
        requestedByUid: currentUser.id,
        requestedByName: currentUser.displayName || currentUser.email || '',
        submittedAt: submitForApproval ? now : undefined,
        createdAt: now,
        updatedAt: now,
      });
      toast({
        title: submitForApproval ? 'ส่งขออนุมัติแล้ว' : 'บันทึกฉบับร่างแล้ว',
        description: code,
      });
      router.push(`/store/purchase-requests/${prRef.id}`);
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

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
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="icon" asChild>
            <Link href="/store/purchase-requests">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold text-primary">สร้าง PR</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>รายละเอียด</CardTitle>
            <CardDescription>เลขที่ {getPreviewPattern('purchase_request')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>หัวข้อ (สรุปความต้องการ)</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น อุปกรณ์ทดสอบรังสี, น้ำมันหล่อลื่น" />
            </div>
            <div className="space-y-2">
              <Label>คู่ค้า (เสนอ) — แนะนำระบุก่อนส่งอนุมัติ</Label>
              <Select value={vendorId || ''} onValueChange={(v) => setVendorId(v || undefined)}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือก (ถ้ามี)" />
                </SelectTrigger>
                <SelectContent>
                  {vendors?.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.vendorName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>งบประมาณโดยประมาณ (ไม่บังคับ)</Label>
              <Input
                inputMode="decimal"
                value={estStr}
                onChange={(e) => setEstStr(e.target.value)}
                placeholder="เช่น 10000"
              />
            </div>
            <div className="space-y-2">
              <Label>รายละเอียด / เหตุผล</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => void save(false)}
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                บันทึกฉบับร่าง
              </Button>
              <Button type="button" className="font-bold" disabled={saving} onClick={() => void save(true)}>
                ส่งขออนุมัติ
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
