'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirebaseApp, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { deleteField, doc, setDoc } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { isSystemAdmin } from '@/lib/permission-core';
import { useToast } from '@/hooks/use-toast';
import { uploadDocumentHeaderImage } from '@/lib/storage/company-document-assets';
import { Loader2, ShieldAlert, Building2, Save, ImageIcon, Upload, X } from 'lucide-react';

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
  /** รูปโลโก้ — แสดงบนเอกสาร ~1"×1"; `null` = ลบออก (ยังไม่บันทึก) */
  documentHeaderLogoUrl?: string | null;
  /** รูปตรายาง — แสดง ~2"×2" */
  documentHeaderStampUrl?: string | null;
  /** หนังสือรับรองหัก ณ ที่จ่าย (PDF) — ควบคุมลายเซ็น/ตราประทับ/ข้อความระบบ */
  whtCertificateDisplay?: {
    showSignatureImage?: boolean;
    showCompanyStamp?: boolean;
    showSystemGeneratedNote?: boolean;
    authorizedSignerName?: string;
    signerPosition?: string;
    signatureImageUrl?: string;
    companyStampImageUrl?: string;
  };
  updatedAt?: number;
  updatedBy?: string;
};

export default function DocumentProfileAdminPage() {
  const firestore = useFirestore();
  const firebaseApp = useFirebaseApp();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<CompanyDocumentProfile>({});
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const stampInputRef = useRef<HTMLInputElement>(null);

  const profileRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'system', 'company_profile') : null),
    [firestore]
  );
  const { data: profile, isLoading: profileLoading } = useDoc<CompanyDocumentProfile>(profileRef as any);

  useEffect(() => {
    if (profile) setDraft(profile);
  }, [profile]);

  const canManage = useMemo(() => !!currentUser && isSystemAdmin(currentUser), [currentUser]);

  const handleHeaderImage =
    (kind: 'logo' | 'stamp') => async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (kind === 'logo') setUploadingLogo(true);
      else setUploadingStamp(true);
      try {
        const url = await uploadDocumentHeaderImage(firebaseApp, kind, file);
        if (kind === 'logo') {
          setDraft((d) => ({ ...d, documentHeaderLogoUrl: url }));
        } else {
          setDraft((d) => ({ ...d, documentHeaderStampUrl: url }));
        }
        toast({ title: 'อัปโหลดรูปแล้ว', description: 'กด "บันทึกค่าเอกสารกลาง" เพื่อยืนยัน URL ลงฐานข้อมูล' });
      } catch (err: any) {
        toast({
          variant: 'destructive',
          title: 'อัปโหลดไม่สำเร็จ',
          description: err?.message || 'เกิดข้อผิดพลาด',
        });
      } finally {
        if (kind === 'logo') setUploadingLogo(false);
        else setUploadingStamp(false);
      }
    };

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
      const { documentHeaderLogoUrl: logoUrl, documentHeaderStampUrl: stampUrl, ...restDraft } = draft;
      const payload: Record<string, unknown> = {
        ...restDraft,
        branchNo: normalizedBranchNo,
        updatedAt: Date.now(),
        updatedBy: currentUser.displayName,
      };
      if (logoUrl === null) {
        payload.documentHeaderLogoUrl = deleteField();
      } else if (logoUrl) {
        payload.documentHeaderLogoUrl = logoUrl;
      }
      if (stampUrl === null) {
        payload.documentHeaderStampUrl = deleteField();
      } else if (stampUrl) {
        payload.documentHeaderStampUrl = stampUrl;
      }
      await setDoc(profileRef, payload as Record<string, unknown> & { updatedBy?: string; updatedAt?: number }, { merge: true });
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
              ใช้ร่วมกับใบเสนอราคา/แจ้งหนี้/ใบกำกับ/ใบสั่งซื้อ — รวมถึงหัวกระดาษในหนังสือรับรองหัก ณ ที่จ่าย (ม.50 ทวิ){' '}
              <span className="text-muted-foreground">
                (prefix เลขที่หนังสือรับรองแยกตั้งได้ที่เมนู Admin · เลขที่เอกสาร — ลำดับ{' '}
                <code className="text-xs bg-muted px-1 rounded">wht_certificate_50</code>)
              </span>
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

            <div className="space-y-2">
              <Label>รูปบนเอกสาร (โลโก้ / ตรายาง)</Label>
              <p className="text-sm text-muted-foreground">
                อัปโหลดแล้วกดบันทึก — กล่องตัวอย่างสะท้อนขนาดมาตรฐานบน print (1&quot; = 1 นิ้ว)
              </p>
              <div className="flex flex-col lg:flex-row flex-wrap items-end justify-between gap-6 pt-1">
                <div className="flex flex-col sm:flex-row flex-wrap gap-6">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={handleHeaderImage('logo')}
                  />
                  <div className="space-y-2">
                    <span className="text-sm font-medium">โลโก้ (แสดง ~1&quot;×1&quot;)</span>
                    <div
                      className="border border-dashed border-muted-foreground/40 bg-muted/30 rounded-md flex items-center justify-center overflow-hidden"
                      style={{ width: '1in', height: '1in' }}
                    >
                      {draft.documentHeaderLogoUrl ? (
                        <img
                          src={draft.documentHeaderLogoUrl}
                          alt="โลโก้บริษัท"
                          className="max-w-full max-h-full w-auto h-auto object-contain"
                        />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1.5"
                        disabled={!canManage || uploadingLogo}
                        onClick={() => logoInputRef.current?.click()}
                      >
                        {uploadingLogo ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        แนบรูป
                      </Button>
                      {draft.documentHeaderLogoUrl ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-destructive"
                          onClick={() => setDraft((d) => ({ ...d, documentHeaderLogoUrl: null }))}
                        >
                          <X className="h-3.5 w-3.5" /> เอาออก
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <input
                    ref={stampInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={handleHeaderImage('stamp')}
                  />
                  <div className="space-y-2">
                    <span className="text-sm font-medium">ตรายาง (แสดง ~2&quot;×2&quot;)</span>
                    <div
                      className="border border-dashed border-muted-foreground/40 bg-muted/30 rounded-md flex items-center justify-center overflow-hidden"
                      style={{ width: '2in', height: '2in' }}
                    >
                      {draft.documentHeaderStampUrl ? (
                        <img
                          src={draft.documentHeaderStampUrl}
                          alt="ตรายาง"
                          className="max-w-full max-h-full w-auto h-auto object-contain"
                        />
                      ) : (
                        <ImageIcon className="h-10 w-10 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1.5"
                        disabled={!canManage || uploadingStamp}
                        onClick={() => stampInputRef.current?.click()}
                      >
                        {uploadingStamp ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        แนบรูป
                      </Button>
                      {draft.documentHeaderStampUrl ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-destructive"
                          onClick={() => setDraft((d) => ({ ...d, documentHeaderStampUrl: null }))}
                        >
                          <X className="h-3.5 w-3.5" /> เอาออก
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <Button onClick={handleSave} disabled={isSaving} className="gap-2 shrink-0 w-full sm:w-auto">
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  บันทึกค่าเอกสารกลาง
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>หนังสือรับรองหัก ณ ที่จ่าย (ม.50 ทวิ)</CardTitle>
            <CardDescription>
              ควบคุมการแสดงลายเซ็นและตราประทับบน PDF — ถ้าไม่แสดง ระบบจะใช้ข้อความแนะนำตามการตั้งค่า
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const wd = draft.whtCertificateDisplay || {};
              const patch = (p: Partial<NonNullable<CompanyDocumentProfile['whtCertificateDisplay']>>) =>
                setDraft((d) => ({
                  ...d,
                  whtCertificateDisplay: { ...d.whtCertificateDisplay, ...p },
                }));
              return (
                <>
                  <div className="flex flex-col gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={!!wd.showSignatureImage}
                        onCheckedChange={(c) => patch({ showSignatureImage: c === true })}
                      />
                      แสดงรูปลายเซ็น (ถ้ามี URL)
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={!!wd.showCompanyStamp}
                        onCheckedChange={(c) => patch({ showCompanyStamp: c === true })}
                      />
                      แสดงตราประทับบริษัท (ถ้ามี URL)
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={wd.showSystemGeneratedNote !== false}
                        onCheckedChange={(c) => patch({ showSystemGeneratedNote: c === true })}
                      />
                      แสดงข้อความ «จัดทำโดยระบบอิเล็กทรอนิกส์…» เมื่อไม่มีลายเซ็น/ตราประทับ
                    </label>
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>ผู้มีอำนาจลงนาม (ข้อความ)</Label>
                      <Input
                        value={wd.authorizedSignerName || ''}
                        onChange={(e) => patch({ authorizedSignerName: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>ตำแหน่ง</Label>
                      <Input value={wd.signerPosition || ''} onChange={(e) => patch({ signerPosition: e.target.value })} />
                    </div>
                    <div className="grid gap-2 md:col-span-2">
                      <Label>URL รูปลายเซ็น (ถ้ามี)</Label>
                      <Input
                        value={wd.signatureImageUrl || ''}
                        onChange={(e) => patch({ signatureImageUrl: e.target.value })}
                        placeholder="https://..."
                      />
                    </div>
                    <div className="grid gap-2 md:col-span-2">
                      <Label>URL ตราประทับ (ถ้ามี)</Label>
                      <Input
                        value={wd.companyStampImageUrl || ''}
                        onChange={(e) => patch({ companyStampImageUrl: e.target.value })}
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                  <Button onClick={handleSave} disabled={isSaving} variant="secondary" className="gap-2">
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    บันทึกค่าเอกสารกลาง (รวมการตั้งค่า WHT)
                  </Button>
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

