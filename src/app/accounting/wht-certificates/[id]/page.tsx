'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, FileCode, Loader2, Printer, RefreshCw, ShieldCheck, Stamp } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { useAppUser } from '@/hooks/use-app-user';
import { useToast } from '@/hooks/use-toast';
import type {
  User,
  Vendor,
  PurchaseVendorBill,
  WithholdingCertificateCopyVariant,
  WithholdingCertificateDocument,
  WhtTaxCondition,
} from '@/lib/types';
import {
  canCancelWhtCertificate,
  canCreateVerifyPrintWhtCertificate,
  canGenerateWhtXmlPayload,
  canIssueWhtCertificate,
  canReadWhtCertificates,
  canVerifyWhtCertificate,
  isSystemAdmin,
} from '@/lib/permissions';
import {
  buildWithholdingCertificateDocumentHtml,
  buildWithholdingCertificatePayeeCopies12Html,
  openWithholdingCertificatePrintWindow,
} from '@/lib/documents/withholding-certificate-50-tw-print';
import {
  validateWhtCertificateForOfficialIssue,
  validateWhtCertificateForOfficialPrint,
  validateWhtCertificateForPayeeCopies12Print,
} from '@/lib/wht/wht-certificate-validation';
import { buildWhtElectronicDataFromDocument, refreshWhtCertificateMasterDataPatch, stripUndefinedForFirestore } from '@/lib/wht/wht-certificate-build';
import type { CompanyProfileWhtInput } from '@/lib/wht/wht-certificate-build';
import { buildWhtAuditLogEntry } from '@/lib/wht/wht-certificate-audit';
import {
  generateWhtXmlPayload,
  validateWhtBeforeExport,
  markWhtReadyForExportMerge,
  saveXmlExportLog,
} from '@/lib/wht/wht-xml-export-placeholder';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { timestampToHtmlDateValue } from '@/lib/date-thai';

function mergeWhtCertDisplaySettings(c: CompanyProfileWhtInput | null | undefined) {
  const d = c?.whtCertificateDisplay;
  return {
    showSignatureImage: !!d?.showSignatureImage,
    showCompanyStamp: !!d?.showCompanyStamp,
    showSystemGeneratedNote: d?.showSystemGeneratedNote !== false,
  };
}

function statusBadgeVariant(s: WithholdingCertificateDocument['documentStatus']) {
  if (s === 'ISSUED') return 'default';
  if (s === 'VERIFIED') return 'secondary';
  if (s === 'CANCELLED') return 'destructive';
  return 'outline';
}

async function appendAudit(
  firestore: Firestore,
  documentId: string,
  entry: ReturnType<typeof buildWhtAuditLogEntry>,
) {
  const logRef = doc(collection(firestore, 'withholding_certificate_documents', documentId, 'audit_logs'));
  await setDoc(logRef, stripUndefinedForFirestore({ id: logRef.id, ...entry }));
}

export default function WhtCertificateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [taxConditionOtherRemark, setTaxConditionOtherRemark] = useState('');
  const [taxCondition, setTaxCondition] = useState<WhtTaxCondition>('WITHHOLDING');

  const certRef = useMemoFirebase(
    () => (firestore && id ? doc(firestore, 'withholding_certificate_documents', id) : null),
    [firestore, id],
  );
  const { data: wht, isLoading } = useDoc<WithholdingCertificateDocument>(certRef as any);

  const companyRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'system', 'company_profile') : null),
    [firestore],
  );
  const { data: companyRaw } = useDoc<CompanyProfileWhtInput>(companyRef as any);
  const displayOpts = useMemo(() => mergeWhtCertDisplaySettings(companyRaw), [companyRaw]);

  useEffect(() => {
    if (wht?.taxCondition) setTaxCondition(wht.taxCondition);
  }, [wht?.id]);

  useEffect(() => {
    setOverrideReason(wht?.payeeTaxIdMissingReason || '');
  }, [wht?.id]);

  useEffect(() => {
    setTaxConditionOtherRemark(wht?.taxConditionOtherRemark || '');
  }, [wht?.id]);

  const validationOfficial = useMemo(
    () => (wht ? validateWhtCertificateForOfficialIssue(wht) : []),
    [wht],
  );

  const actorName = currentUser?.displayName?.trim() || currentUser?.email || currentUser?.id || '';

  const runPrint = async (variant: WithholdingCertificateCopyVariant) => {
    if (!firestore || !currentUser || !wht || !variant) return;
    const errs = validateWhtCertificateForOfficialPrint(wht, variant);
    if (errs.length) {
      toast({ variant: 'destructive', title: 'พิมพ์ไม่ได้', description: errs.join(' ') });
      return;
    }
    setBusy('print-official');
    try {
      const html = buildWithholdingCertificateDocumentHtml(wht, {
        copyVariant: variant,
        official: true,
        printedByName: actorName,
        printedAtMs: Date.now(),
        ...displayOpts,
      });
      openWithholdingCertificatePrintWindow(html);
      await updateDoc(certRef!, {
        lastPrintedCopyVariant: variant,
        updatedAt: Date.now(),
        updatedByUid: currentUser.id,
        updatedByName: actorName,
      });
      await appendAudit(firestore, wht.id, {
        ...buildWhtAuditLogEntry({
          documentId: wht.id,
          action: 'PRINT_WHT',
          actorId: currentUser.id,
          actorName,
          payloadSummary: { copyVariant: variant, official: true },
        }),
      });
    } finally {
      setBusy(null);
    }
  };

  const runPrintPayeeCopies12 = async () => {
    if (!firestore || !currentUser || !wht || !certRef) return;
    const errs = validateWhtCertificateForPayeeCopies12Print(wht, true);
    if (errs.length) {
      toast({ variant: 'destructive', title: 'พิมพ์ไม่ได้', description: errs.join(' ') });
      return;
    }
    setBusy('print-payee12-official');
    try {
      const html = buildWithholdingCertificatePayeeCopies12Html(wht, {
        official: true,
        printedByName: actorName,
        printedAtMs: Date.now(),
        ...displayOpts,
      });
      openWithholdingCertificatePrintWindow(html);
      await updateDoc(certRef, {
        lastPrintedCopyVariant: 'COPY_PAYEE_TAX_RETURN',
        updatedAt: Date.now(),
        updatedByUid: currentUser.id,
        updatedByName: actorName,
      });
      await appendAudit(firestore, wht.id, {
        ...buildWhtAuditLogEntry({
          documentId: wht.id,
          action: 'PRINT_WHT',
          actorId: currentUser.id,
          actorName,
          payloadSummary: { payeeCopies12Bundle: true, official: true },
        }),
      });
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    if (!firestore || !currentUser || !wht || !certRef) return;
    const errs = validateWhtCertificateForOfficialIssue(wht);
    if (errs.length) {
      toast({ variant: 'destructive', title: 'ตรวจสอบไม่ผ่าน', description: errs.join(' ') });
      return;
    }
    setBusy('verify');
    try {
      await updateDoc(certRef, {
        documentStatus: 'VERIFIED',
        taxCondition,
        taxConditionOtherRemark:
          taxCondition === 'OTHER' ? taxConditionOtherRemark.trim() || null : null,
        verifiedAt: Date.now(),
        verifiedByUid: currentUser.id,
        verifiedByName: actorName,
        updatedAt: Date.now(),
        updatedByUid: currentUser.id,
        updatedByName: actorName,
      });
      await appendAudit(firestore, wht.id, {
        ...buildWhtAuditLogEntry({
          documentId: wht.id,
          action: 'VERIFY_WHT',
          actorId: currentUser.id,
          actorName,
        }),
      });
      toast({ title: 'ตรวจสอบแล้ว (VERIFIED)' });
    } finally {
      setBusy(null);
    }
  };

  const issue = async () => {
    if (!firestore || !currentUser || !wht || !certRef) return;
    if (wht.documentStatus === 'ISSUED') {
      toast({ variant: 'destructive', title: 'ออกแล้ว', description: 'เอกสารนี้มีเลขที่แล้ว' });
      return;
    }
    if (wht.documentStatus !== 'VERIFIED' && wht.documentStatus !== 'DRAFT') {
      toast({
        variant: 'destructive',
        title: 'ออกไม่ได้',
        description: 'สถานะเอกสารไม่พร้อมออกเลขที่ — ใช้ได้เฉพาะร่าง (DRAFT) หรือตรวจแล้ว (VERIFIED)',
      });
      return;
    }
    const errs = validateWhtCertificateForOfficialIssue(wht);
    if (errs.length) {
      toast({ variant: 'destructive', title: 'ออกไม่ได้', description: errs.join(' ') });
      return;
    }
    setBusy('issue');
    try {
      const issueYmd = timestampToHtmlDateValue(Date.now());
      const { code } = await generateNextDocumentCode(firestore, 'wht_certificate_50', {
        actor: actorName,
        userId: currentUser.id,
        date: new Date(),
      });
      const electronic = buildWhtElectronicDataFromDocument({
        ...wht,
        certificateNo: code,
        paymentIssueDate: issueYmd,
      });
      await updateDoc(
        certRef,
        stripUndefinedForFirestore({
          certificateNo: code,
          paymentIssueDate: issueYmd,
          documentStatus: 'ISSUED',
          issuedAt: Date.now(),
          issuedByUid: currentUser.id,
          issuedByName: actorName,
          whtElectronicData: stripUndefinedForFirestore({ ...electronic, xmlExportStatus: 'NOT_EXPORTED' }),
          updatedAt: Date.now(),
          updatedByUid: currentUser.id,
          updatedByName: actorName,
        }),
      );
      await appendAudit(firestore, wht.id, {
        ...buildWhtAuditLogEntry({
          documentId: wht.id,
          action: 'ISSUE_WHT',
          actorId: currentUser.id,
          actorName,
          payloadSummary: { certificateNo: code },
        }),
      });
      toast({ title: 'ออกเอกสารแล้ว', description: `เลขที่ ${code}` });
    } finally {
      setBusy(null);
    }
  };

  const cancelDoc = async () => {
    if (!firestore || !currentUser || !wht || !certRef) return;
    const reason = cancelReason.trim();
    if (!reason) {
      toast({ variant: 'destructive', title: 'ระบุเหตุผลการยกเลิก' });
      return;
    }
    setBusy('cancel');
    try {
      await updateDoc(certRef, {
        documentStatus: 'CANCELLED',
        cancelReason: reason,
        cancelledAt: Date.now(),
        cancelledByUid: currentUser.id,
        cancelledByName: actorName,
        updatedAt: Date.now(),
        updatedByUid: currentUser.id,
        updatedByName: actorName,
      });
      await appendAudit(firestore, wht.id, {
        ...buildWhtAuditLogEntry({
          documentId: wht.id,
          action: 'CANCEL_WHT',
          actorId: currentUser.id,
          actorName,
          reason,
        }),
      });
      setCancelOpen(false);
      setCancelReason('');
      toast({ title: 'ยกเลิกเอกสารแล้ว' });
    } finally {
      setBusy(null);
    }
  };

  const saveTaxAndOverride = async () => {
    if (!firestore || !currentUser || !wht || !certRef) return;
    if (wht.documentStatus === 'ISSUED' || wht.documentStatus === 'CANCELLED') {
      toast({ variant: 'destructive', title: 'แก้ไขไม่ได้', description: 'สถานะเอกสารไม่อนุญาตให้แก้' });
      return;
    }
    setBusy('save-meta');
    try {
      const patch: Record<string, unknown> = {
        taxCondition,
        taxConditionOtherRemark:
          taxCondition === 'OTHER' ? taxConditionOtherRemark.trim() || null : null,
        updatedAt: Date.now(),
        updatedByUid: currentUser.id,
        updatedByName: actorName,
      };
      if (isSystemAdmin(currentUser)) {
        const has = !!overrideReason.trim();
        patch.payeeTaxIdMissingOverride = has;
        patch.payeeTaxIdMissingReason = has ? overrideReason.trim() : null;
      }
      await updateDoc(certRef, patch as DocumentData);
      toast({ title: 'บันทึกแล้ว' });
    } finally {
      setBusy(null);
    }
  };

  const generateXml = async () => {
    if (!firestore || !currentUser || !wht || !certRef) return;
    const pre = validateWhtBeforeExport(wht);
    if (pre.length) {
      toast({ variant: 'destructive', title: 'สร้าง XML ไม่ได้', description: pre.join(' ') });
      return;
    }
    setBusy('xml');
    try {
      const { xml } = generateWhtXmlPayload(wht.id, wht);
      const logPayload = saveXmlExportLog(wht.id, xml, 'GENERATED_INTERNAL', currentUser.id);
      const logRef = doc(collection(firestore, 'withholding_certificate_documents', wht.id, 'xml_export_logs'));
      await setDoc(logRef, { id: logRef.id, ...logPayload });
      await updateDoc(
        certRef,
        stripUndefinedForFirestore({
          xmlExportStatus: 'EXPORTED_XML',
          whtElectronicData: stripUndefinedForFirestore({
            ...wht.whtElectronicData,
            xmlExportStatus: 'EXPORTED_XML',
            xmlGeneratedAt: Date.now(),
            xmlGeneratedBy: currentUser.id,
          }),
          updatedAt: Date.now(),
          updatedByUid: currentUser.id,
          updatedByName: actorName,
        }),
      );
      await appendAudit(firestore, wht.id, {
        ...buildWhtAuditLogEntry({
          documentId: wht.id,
          action: 'GENERATE_WHT_XML',
          actorId: currentUser.id,
          actorName,
        }),
      });
      toast({ title: 'สร้าง XML ภายในแล้ว', description: 'ดู log ใน xml_export_logs (ไม่ใช่สคีมากรมสรรพากร)' });
    } finally {
      setBusy(null);
    }
  };

  const markReadyXml = async () => {
    if (!firestore || !currentUser || !wht || !certRef) return;
    const pre = validateWhtBeforeExport(wht);
    if (pre.length) {
      toast({ variant: 'destructive', title: 'ไม่พร้อม export', description: pre.join(' ') });
      return;
    }
    setBusy('ready-xml');
    try {
      const merge = markWhtReadyForExportMerge(wht.whtElectronicData || {});
      await updateDoc(
        certRef,
        stripUndefinedForFirestore({
          ...merge,
          updatedByUid: currentUser.id,
          updatedByName: actorName,
        }),
      );
      toast({ title: 'ตั้งสถานะ READY_FOR_EXPORT แล้ว' });
    } finally {
      setBusy(null);
    }
  };

  const refreshFromMaster = async () => {
    if (!firestore || !currentUser || !wht || !certRef) return;
    if (!wht.sourceVendorBillId?.trim()) {
      toast({
        variant: 'destructive',
        title: 'อัปเดตไม่ได้',
        description: 'เอกสารนี้ไม่มีอ้างอิงใบวางบิล — ไม่ทราบคู่ค้า',
      });
      return;
    }

    setBusy('refresh-master');
    try {
      const billSnap = await getDoc(doc(firestore, 'purchase_vendor_bills', wht.sourceVendorBillId));
      if (!billSnap.exists()) {
        toast({
          variant: 'destructive',
          title: 'อัปเดตไม่ได้',
          description: 'ไม่พบใบวางบิลต้นทาง',
        });
        return;
      }
      const bill = { id: billSnap.id, ...billSnap.data() } as PurchaseVendorBill;
      if (!bill.vendorId?.trim()) {
        toast({
          variant: 'destructive',
          title: 'อัปเดตไม่ได้',
          description: 'ใบวางบิลไม่มีรหัสคู่ค้า',
        });
        return;
      }

      const vendorSnap = await getDoc(doc(firestore, 'vendors', bill.vendorId));
      if (!vendorSnap.exists()) {
        toast({
          variant: 'destructive',
          title: 'อัปเดตไม่ได้',
          description: 'ไม่พบทะเบียนคู่ค้า — ตรวจสอบว่ายัง ACTIVE อยู่',
        });
        return;
      }
      const vendor = { id: vendorSnap.id, ...vendorSnap.data() } as Vendor;

      const patch = refreshWhtCertificateMasterDataPatch({
        existing: wht,
        vendor,
        company: companyRaw ?? undefined,
      });
      const merged: WithholdingCertificateDocument = { ...wht, ...patch };
      const validationErrs = validateWhtCertificateForOfficialIssue(merged);
      if (validationErrs.length > 0) {
        toast({
          variant: 'destructive',
          title: 'ข้อมูลทะเบียนยังไม่ครบ',
          description: validationErrs.join(' '),
        });
        return;
      }

      await updateDoc(
        certRef,
        stripUndefinedForFirestore({
          ...patch,
          updatedAt: Date.now(),
          updatedByUid: currentUser.id,
          updatedByName: actorName,
        }) as DocumentData,
      );
      await appendAudit(firestore, wht.id, {
        ...buildWhtAuditLogEntry({
          documentId: wht.id,
          action: 'REFRESH_WHT_FROM_MASTER',
          actorId: currentUser.id,
          actorName,
          payloadSummary: {
            vendorId: vendor.id,
            payeeTaxId: merged.payee.taxId,
            payeeName: merged.payee.displayName,
          },
        }),
      });
      setRefreshOpen(false);
      toast({
        title: 'อัปเดตข้อมูลเอกสารแล้ว',
        description: 'ดึงชื่อ ที่อยู่ และเลขผู้เสียภาษีจากทะเบียนคู่ค้า/บริษัทใหม่ — ยอดเงินและเลขที่ไม่เปลี่ยน',
      });
    } finally {
      setBusy(null);
    }
  };

  if (userLoading || !currentUser) return null;
  if (!canReadWhtCertificates(currentUser)) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">ไม่มีสิทธิ์</div>
      </AppShell>
    );
  }

  if (isLoading || !wht) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/store/vendor-bills/${wht.sourceVendorBillId}`}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-primary truncate">
              หนังสือรับรองหัก ณ ที่จ่าย {wht.certificateNo ? `· ${wht.certificateNo}` : '(ร่าง)'}
            </h1>
            <p className="text-sm text-muted-foreground font-mono">{wht.id}</p>
          </div>
          <Badge className="ml-auto shrink-0" variant={statusBadgeVariant(wht.documentStatus)}>
            {wht.documentStatus}
          </Badge>
          <Badge variant="outline" className="shrink-0">
            XML: {wht.xmlExportStatus}
          </Badge>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">สรุปยอด</CardTitle>
            <CardDescription>
              ฐานหัก ณ ที่จ่าย = ก่อน VAT · สุทธิจ่าย = รวม VAT − ภาษีหัก
            </CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
            <div>ก่อน VAT: {wht.amountBeforeVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            <div>VAT: {wht.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            <div>รวม (gross): {wht.grossAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            <div>
              หัก ณ ที่จ่าย ({wht.withholdingTaxRatePercent}%):{' '}
              {wht.withholdingTaxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="font-semibold sm:col-span-2">
              สุทธิจ่ายคู่ค้า: {wht.netPaidAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>

        <Card className={validationOfficial.length ? 'border-amber-300' : 'border-green-200'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> สถานะ validation (ก่อนออกเอกสารทางการ)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {validationOfficial.length === 0 ? (
              <p className="text-green-800">ผ่านเงื่อนไขขั้นต่ำ</p>
            ) : (
              <ul className="list-disc pl-5 space-y-1 text-amber-900">
                {validationOfficial.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {(wht.documentStatus === 'DRAFT' || wht.documentStatus === 'VERIFIED') && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">เงื่อนไขการหักภาษี / override</CardTitle>
              <CardDescription>แก้ได้เฉพาะ DRAFT / VERIFIED</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 max-w-md">
                <Label>taxCondition</Label>
                <Select value={taxCondition} onValueChange={(v) => setTaxCondition(v as WhtTaxCondition)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WITHHOLDING">หัก ณ ที่จ่าย</SelectItem>
                    <SelectItem value="TAX_PAID_BY_PAYER_ONE_TIME">ออกภาษีให้ครั้งเดียว</SelectItem>
                    <SelectItem value="TAX_PAID_BY_PAYER_FOREVER">ออกภาษีให้ตลอดไป</SelectItem>
                    <SelectItem value="OTHER">อื่น ๆ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {taxCondition === 'OTHER' && (
                <div className="space-y-2 max-w-xl">
                  <Label>รายละเอียดเงื่อนไข «อื่น ๆ»</Label>
                  <Textarea
                    value={taxConditionOtherRemark}
                    onChange={(e) => setTaxConditionOtherRemark(e.target.value)}
                    rows={2}
                    placeholder="บังคับเมื่อเลือกอื่น ๆ"
                  />
                </div>
              )}
              {isSystemAdmin(currentUser) && (
                <div className="space-y-2">
                  <Label>
                    เหตุผลยืนยันกรณีพิเศษ (admin) — เก็บเป็นหลักฐานเท่านั้น ไม่ยกเลิกการบังคับเลขผู้เสียภาษีคู่ค้าบนแบบ
                  </Label>
                  <Textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={2} />
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox checked={!!wht.payeeTaxIdMissingOverride} disabled />
                    <span>สถานะ override ปัจจุบันในระบบ</span>
                  </div>
                </div>
              )}
              <Button variant="outline" disabled={!!busy} onClick={() => void saveTaxAndOverride()}>
                บันทึกการตั้งค่า
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Stamp className="h-4 w-4" /> การดำเนินการ
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {canVerifyWhtCertificate(currentUser) && wht.documentStatus === 'DRAFT' && (
              <Button disabled={!!busy} onClick={() => void verify()}>
                {busy === 'verify' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                ตรวจสอบความถูกต้อง
              </Button>
            )}
            {canIssueWhtCertificate(currentUser) && wht.documentStatus === 'VERIFIED' && (
              <Button disabled={!!busy} className="font-bold" onClick={() => void issue()}>
                {busy === 'issue' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                ออกเอกสาร (ISSUED)
              </Button>
            )}
            {canCreateVerifyPrintWhtCertificate(currentUser) && wht.documentStatus === 'ISSUED' && (
              <>
                <Button disabled={!!busy} onClick={() => void runPrint('COPY_PAYEE_TAX_RETURN')}>
                  <Printer className="h-4 w-4 mr-2" />
                  พิมพ์ฉบับที่ 1
                </Button>
                <Button className="font-semibold" disabled={!!busy} onClick={() => void runPrintPayeeCopies12()}>
                  <Printer className="h-4 w-4 mr-2" />
                  พิมพ์ฉบับที่ 1+2 (ไฟล์เดียว / PDF)
                </Button>
                <Button disabled={!!busy} onClick={() => void runPrint('COPY_PAYER_RECORD')}>
                  พิมพ์สำเนาผู้หัก
                </Button>
              </>
            )}
            {canGenerateWhtXmlPayload(currentUser) && wht.documentStatus === 'ISSUED' && (
              <>
                <Button variant="secondary" disabled={!!busy} onClick={() => void markReadyXml()}>
                  เตรียมข้อมูล XML
                </Button>
                <Button variant="secondary" disabled={!!busy} onClick={() => void generateXml()}>
                  <FileCode className="h-4 w-4 mr-2" />
                  Generate Internal XML
                </Button>
              </>
            )}
            {canIssueWhtCertificate(currentUser) &&
              wht.documentStatus !== 'CANCELLED' &&
              wht.documentStatus !== 'REPLACED' && (
                <Button variant="outline" disabled={!!busy} onClick={() => setRefreshOpen(true)}>
                  {busy === 'refresh-master' ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Generate เอกสารใหม่
                </Button>
              )}
            {canCancelWhtCertificate(currentUser) &&
              wht.documentStatus !== 'CANCELLED' &&
              wht.documentStatus !== 'REPLACED' && (
                <Button variant="destructive" disabled={!!busy} onClick={() => setCancelOpen(true)}>
                  ยกเลิกเอกสาร
                </Button>
              )}
          </CardContent>
        </Card>

        <AlertDialog open={refreshOpen} onOpenChange={setRefreshOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Generate เอกสารใหม่จากทะเบียน?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2 text-sm">
                <span className="block">
                  ระบบจะดึงชื่อ ที่อยู่ และเลขประจำตัวผู้เสียภาษีของคู่ค้า (และข้อมูลผู้จ่ายจาก company profile)
                  มาใส่ในเอกสารนี้ใหม่
                </span>
                <span className="block">ยอดเงิน เลขที่เอกสาร และวันที่จ่ายไม่เปลี่ยน</span>
                {wht.xmlExportStatus === 'EXPORTED_XML' ? (
                  <span className="block text-amber-800">
                    เอกสารเคย export XML แล้ว — หลังอัปเดตต้อง Generate Internal XML ใหม่
                  </span>
                ) : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy === 'refresh-master'}>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction disabled={busy === 'refresh-master'} onClick={() => void refreshFromMaster()}>
                {busy === 'refresh-master' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                ยืนยันอัปเดต
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ยกเลิกหนังสือรับรอง?</AlertDialogTitle>
              <AlertDialogDescription>
                <Textarea
                  className="mt-2"
                  placeholder="ระบุเหตุผล (บังคับ)"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ปิด</AlertDialogCancel>
              <AlertDialogAction onClick={() => void cancelDoc()}>ยืนยันยกเลิก</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
