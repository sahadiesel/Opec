'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { isSystemAdmin } from '@/lib/permission-core';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ShieldAlert, Building2, Save } from 'lucide-react';

type CompanyDocumentProfile = {
  companyNameTh?: string;
  companyNameEn?: string;
  taxId?: string;
  branchType?: 'head_office' | 'branch';
  branchNo?: string;
  phone?: string;
  email?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  updatedAt?: number;
  updatedBy?: string;
};

export default function DocumentProfileAdminPage() {
  const firestore = useFirestore();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<CompanyDocumentProfile>({});

  const profileRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'system', 'company_profile') : null),
    [firestore]
  );
  const { data: profile, isLoading: profileLoading } = useDoc<CompanyDocumentProfile>(profileRef as any);

  useEffect(() => {
    if (profile) setDraft(profile);
  }, [profile]);

  const canManage = useMemo(() => !!currentUser && isSystemAdmin(currentUser), [currentUser]);

  const handleSave = async () => {
    if (!profileRef || !currentUser || !canManage) return;
    setIsSaving(true);
    try {
      const normalizedBranchNo = draft.branchType === 'branch' ? (draft.branchNo || '').replace(/\D/g, '') : '00000';
      if (draft.branchType === 'branch') {
        if (normalizedBranchNo.length !== 5) {
          toast({
            variant: 'destructive',
            title: 'เลขสาขาไม่ถูกต้อง',
            description: 'กรุณากรอกเลขสาขาเป็นตัวเลข 5 หลัก (เช่น 00001)',
          });
          setIsSaving(false);
          return;
        }
      }
      await setDoc(
        profileRef,
        {
          ...draft,
          branchNo: normalizedBranchNo,
          updatedAt: Date.now(),
          updatedBy: currentUser.displayName,
        },
        { merge: true }
      );
      toast({ title: 'บันทึกสำเร็จ', description: 'อัปเดตหัวเอกสารกลางเรียบร้อยแล้ว' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: error?.message || 'เกิดข้อผิดพลาด' });
    } finally {
      setIsSaving(false);
    }
  };

  if (userLoading || profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!currentUser || !canManage) {
    return (
      <AppShell user={currentUser || null} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Restricted</h2>
          <p className="text-muted-foreground">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <Building2 className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-primary">Document Header Profile</h1>
            <p className="text-muted-foreground">ตั้งค่าชื่อบริษัทและที่อยู่สำหรับหัวเอกสารทุกประเภท</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>ข้อมูลบริษัทบนเอกสาร</CardTitle>
            <CardDescription>
              ใช้ร่วมกับใบเสนอราคา/แจ้งหนี้/ใบกำกับ/ใบสั่งซื้อ (เริ่มใช้งานแล้วกับใบเสนอราคา)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>ชื่อบริษัท (ไทย)</Label>
                <Input value={draft.companyNameTh || ''} onChange={(e) => setDraft({ ...draft, companyNameTh: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>ชื่อบริษัท (อังกฤษ)</Label>
                <Input value={draft.companyNameEn || ''} onChange={(e) => setDraft({ ...draft, companyNameEn: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>เลขผู้เสียภาษี</Label>
                <Input value={draft.taxId || ''} onChange={(e) => setDraft({ ...draft, taxId: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>ประเภทสาขา</Label>
                <Select
                  value={(draft.branchType as any) || 'head_office'}
                  onValueChange={(v: 'head_office' | 'branch') =>
                    setDraft({ ...draft, branchType: v, branchNo: v === 'head_office' ? undefined : draft.branchNo })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="head_office">สำนักงานใหญ่</SelectItem>
                    <SelectItem value="branch">สาขา</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label>เบอร์โทร</Label>
                <Input value={draft.phone || ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>อีเมล</Label>
                <Input type="email" value={draft.email || ''} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </div>
              {draft.branchType === 'branch' ? (
                <div className="grid gap-2">
                  <Label>เลขสาขา (5 หลัก)</Label>
                  <Input
                    inputMode="numeric"
                    maxLength={5}
                    autoComplete="off"
                    placeholder="เช่น 00001"
                    value={draft.branchNo || ''}
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, '').slice(0, 5);
                      setDraft({ ...draft, branchNo: d });
                    }}
                  />
                  <p className="text-xs text-muted-foreground">ระบุเลขสาขา 5 หลักตามทะเบียน (เฉพาะเมื่อเลือก &quot;สาขา&quot;)</p>
                </div>
              ) : (
                <div className="hidden md:block" aria-hidden />
              )}
            </div>
            <div className="grid gap-2">
              <Label>ชื่อที่อยู่ภาษาอังกฤษ</Label>
              <Input
                value={draft.addressLine1 || ''}
                onChange={(e) => setDraft({ ...draft, addressLine1: e.target.value })}
                placeholder="ที่อยู่เป็นภาษาอังกฤษสำหรับหัวเอกสาร"
              />
            </div>
            <div className="grid gap-2">
              <Label>ชื่อที่อยู่ภาษาไทย</Label>
              <Input
                value={draft.addressLine2 || ''}
                onChange={(e) => setDraft({ ...draft, addressLine2: e.target.value })}
                placeholder="ที่อยู่เป็นภาษาไทยสำหรับหัวเอกสาร"
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={isSaving} className="gap-2">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                บันทึกค่าเอกสารกลาง
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

