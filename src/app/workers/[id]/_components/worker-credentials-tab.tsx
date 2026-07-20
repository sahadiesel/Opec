'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue, formatOptionalDateThaiBE, coerceStoredDateToMs, effectiveCredentialRowStatus, isStoredExpiryPast } from '@/lib/date-thai';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, FileText, Pencil, Camera, Loader2, X, SkipForward, Undo2 } from 'lucide-react';
import { deleteField, doc, setDoc, type Firestore, type CollectionReference } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { useFirebaseApp } from '@/firebase';
import { uploadWorkerCertificatePhoto } from '@/lib/storage/worker-certificate-photos';
import { uploadWorkerDocumentPhoto } from '@/lib/storage/worker-document-photos';
import { isPdfAttachment, isPdfFile } from '@/lib/storage/worker-credential-attachment';
import { WorkerCredentialAttachmentThumb } from '@/components/workers/worker-credential-attachment-thumb';
import type {
  WorkerCertificate,
  WorkerDocument,
  WorkerDocumentCatalogItem,
  PositionCertificateRequirement,
  WorkerRequirementSkip,
} from '@/lib/types';
import { sanitizeFirestorePayload } from '@/lib/utils';
import {
  getMandatoryRequirementsWithNoWorkerRecord,
  orGroupMemberSummary,
  partitionMandatoryCertificateRequirements,
  requirementSkipDocId,
  buildManualRequirementSkipPredicate,
  findWorkerCertificateForRequirement,
} from '@/lib/position-certificate-compliance';

type CredentialKind = 'certificate' | 'document';

type FormContext = 'add-document' | 'add-position-cert' | 'edit';

type UnifiedCredentialRow = {
  id: string;
  kind: CredentialKind;
  itemName: string;
  itemCode: string;
  number: string;
  expiryDate: number;
  status?: string;
  attachment?: { downloadUrl?: string; contentType?: string; fileName?: string };
};

interface WorkerCredentialsTabProps {
  workerId: string;
  firestore: Firestore | null;
  certs: WorkerCertificate[] | null;
  certsQuery: CollectionReference | null;
  workerDocs: WorkerDocument[] | null;
  docsQuery: CollectionReference | null;
  workerDocCatalog: WorkerDocumentCatalogItem[] | null;
  positionCertRequirements?: PositionCertificateRequirement[] | null;
  requirementSkips?: WorkerRequirementSkip[] | null;
  currentPositionId?: string;
  currentUserId?: string;
  canEdit?: boolean;
}

function catalogRequirementTypeLabel(type: CredentialKind | undefined): string {
  return type === 'document' ? 'DOCUMENT' : 'CERTIFICATE';
}

function catalogHit(
  catalog: WorkerDocumentCatalogItem[] | null,
  code: string,
): WorkerDocumentCatalogItem | undefined {
  return (catalog || []).find((x) => (x.itemCode || '').toLowerCase() === (code || '').toLowerCase());
}

function buildUnifiedRows(
  certs: WorkerCertificate[] | null,
  workerDocs: WorkerDocument[] | null,
  catalog: WorkerDocumentCatalogItem[] | null,
): UnifiedCredentialRow[] {
  const rows: UnifiedCredentialRow[] = [];
  for (const c of certs || []) {
    rows.push({
      id: c.id,
      kind: 'certificate',
      itemName: c.certificateName || catalogHit(catalog, c.certificateCode)?.itemName || c.certificateCode,
      itemCode: c.certificateCode,
      number: c.certificateNo || '',
      expiryDate: coerceStoredDateToMs(c.expiryDate) ?? 0,
      status: c.status,
      attachment: c.attachment,
    });
  }
  for (const d of workerDocs || []) {
    const hit = catalogHit(catalog, d.documentType);
    rows.push({
      id: d.id,
      kind: 'document',
      itemName: hit?.itemName || d.documentType.replace(/_/g, ' '),
      itemCode: d.documentType,
      number: d.documentNo || '',
      expiryDate: coerceStoredDateToMs(d.expiryDate) ?? 0,
      attachment: d.attachment,
    });
  }
  return rows.sort((a, b) => a.itemName.localeCompare(b.itemName, 'th'));
}

export function WorkerCredentialsTab({
  workerId,
  firestore,
  certs,
  certsQuery,
  workerDocs,
  docsQuery,
  workerDocCatalog,
  positionCertRequirements,
  requirementSkips,
  currentPositionId,
  currentUserId,
  canEdit = false,
}: WorkerCredentialsTabProps) {
  const { toast } = useToast();
  const firebaseApp = useFirebaseApp();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [formContext, setFormContext] = useState<FormContext>('add-document');
  const [lockedPositionReq, setLockedPositionReq] = useState<PositionCertificateRequirement | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [number, setNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [editing, setEditing] = useState<{ id: string; kind: CredentialKind } | null>(null);
  const [formFile, setFormFile] = useState<File | null>(null);
  const [formPreviewIsPdf, setFormPreviewIsPdf] = useState(false);
  const [formPreviewUrl, setFormPreviewUrl] = useState<string | null>(null);
  const [formRemoveAttachment, setFormRemoveAttachment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [skipTarget, setSkipTarget] = useState<PositionCertificateRequirement | null>(null);
  const [skipReason, setSkipReason] = useState('');
  const [skipSaving, setSkipSaving] = useState(false);

  const manualSkipPredicate = useMemo(
    () => buildManualRequirementSkipPredicate(requirementSkips),
    [requirementSkips],
  );

  const documentCatalogOptions = useMemo(
    () =>
      (workerDocCatalog || [])
        .filter((x) => x.active !== false && x.requirementType === 'document')
        .sort((a, b) => a.itemName.localeCompare(b.itemName, 'th')),
    [workerDocCatalog],
  );

  const positionCertificateReqs = useMemo(
    () =>
      (positionCertRequirements || []).filter(
        (r) => (r.requirementType || 'certificate') === 'certificate',
      ),
    [positionCertRequirements],
  );

  const missingPositionCerts = useMemo(() => {
    const certReqs = (positionCertRequirements || []).filter(
      (r) => (r.requirementType || 'certificate') === 'certificate' && r.required,
    );
    const catalogLookup = (code: string | undefined) => catalogHit(workerDocCatalog, code || '');
    return getMandatoryRequirementsWithNoWorkerRecord(
      certReqs,
      certs || [],
      [],
      Date.now(),
      catalogLookup,
      manualSkipPredicate,
    );
  }, [positionCertRequirements, certs, workerDocCatalog, manualSkipPredicate]);

  const skippedPositionCerts = useMemo(() => {
    const skips = requirementSkips || [];
    if (!skips.length) return [] as { req: PositionCertificateRequirement; skip: WorkerRequirementSkip }[];
    const certReqs = (positionCertRequirements || []).filter((r) => r.required);
    const seenOr = new Set<string>();
    const out: { req: PositionCertificateRequirement; skip: WorkerRequirementSkip }[] = [];
    for (const skip of skips) {
      const gk = (skip.alternativeGroupKey || '').trim();
      if (gk) {
        if (seenOr.has(gk)) continue;
        seenOr.add(gk);
        const req =
          certReqs.find((r) => (r.alternativeGroupKey || '').trim() === gk) ||
          certReqs.find((r) => r.id === skip.requirementId);
        if (req) {
          if (findWorkerCertificateForRequirement(req, certs || [])) continue;
          out.push({ req, skip });
        }
        continue;
      }
      const req =
        certReqs.find((r) => r.id === skip.requirementId) ||
        certReqs.find(
          (r) =>
            (r.certificateCode || '').trim().toLowerCase() ===
            (skip.certificateCode || '').trim().toLowerCase(),
        );
      if (req) {
        if (findWorkerCertificateForRequirement(req, certs || [])) continue;
        out.push({ req, skip });
      }
    }
    return out.sort((a, b) =>
      (a.req.certificateName || '').localeCompare(b.req.certificateName || '', 'th'),
    );
  }, [requirementSkips, positionCertRequirements, certs]);

  const missingOrGroupMeta = useMemo(() => {
    const certReqs = (positionCertRequirements || []).filter(
      (r) => (r.requirementType || 'certificate') === 'certificate' && r.required,
    );
    const { orGroups } = partitionMandatoryCertificateRequirements(certReqs);
    const meta = new Map<string, { label: string; summary: string; reqs: PositionCertificateRequirement[] }>();
    for (const [key, groupReqs] of orGroups) {
      const label =
        (groupReqs.find((r) => (r.alternativeGroupLabel || '').trim())?.alternativeGroupLabel || '').trim() ||
        'กลุ่มทางเลือก';
      meta.set(groupReqs[0].id, { label, summary: orGroupMemberSummary(groupReqs), reqs: groupReqs });
      for (const r of groupReqs.slice(1)) {
        meta.set(r.id, { label, summary: orGroupMemberSummary(groupReqs), reqs: groupReqs });
      }
    }
    return meta;
  }, [positionCertRequirements]);

  const dialogCatalogOptions = useMemo(() => {
    if (formContext === 'add-document') return documentCatalogOptions;
    if (formContext === 'edit' && editing?.kind === 'document') return documentCatalogOptions;
    return [];
  }, [formContext, editing, documentCatalogOptions]);

  const rows = useMemo(
    () => buildUnifiedRows(certs, workerDocs, workerDocCatalog),
    [certs, workerDocs, workerDocCatalog],
  );

  const selectedTemplate =
    dialogCatalogOptions.find((x) => x.id === templateId) ||
    catalogHit(workerDocCatalog, lockedPositionReq?.certificateCode || '') ||
    (templateId ? (workerDocCatalog || []).find((x) => x.id === templateId) : undefined);

  const clearPhotoPreview = () => {
    if (formPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(formPreviewUrl);
    }
    setFormPreviewUrl(null);
    setFormFile(null);
    setFormRemoveAttachment(false);
    setFormPreviewIsPdf(false);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const resetForm = () => {
    clearPhotoPreview();
    setEditing(null);
    setFormContext('add-document');
    setLockedPositionReq(null);
    setTemplateId('');
    setNumber('');
    setIssueDate('');
    setExpiryDate('');
  };

  const populateFromCert = (cert: WorkerCertificate) => {
    clearPhotoPreview();
    setFormContext('edit');
    setLockedPositionReq(null);
    setEditing({ id: cert.id, kind: 'certificate' });
    const template = catalogHit(workerDocCatalog, cert.certificateCode);
    setTemplateId(template?.id || '');
    setNumber(cert.certificateNo || '');
    setIssueDate(coerceStoredDateToMs(cert.issueDate) ? timestampToHtmlDateValue(coerceStoredDateToMs(cert.issueDate)!) : '');
    setExpiryDate(coerceStoredDateToMs(cert.expiryDate) ? timestampToHtmlDateValue(coerceStoredDateToMs(cert.expiryDate)!) : '');
    if (cert.attachment?.downloadUrl) {
      setFormPreviewUrl(cert.attachment.downloadUrl);
      setFormPreviewIsPdf(isPdfAttachment(cert.attachment));
    }
  };

  const populateFromDoc = (row: WorkerDocument) => {
    clearPhotoPreview();
    setFormContext('edit');
    setLockedPositionReq(null);
    setEditing({ id: row.id, kind: 'document' });
    const template = catalogHit(workerDocCatalog, row.documentType);
    setTemplateId(template?.id || '');
    setNumber(row.documentNo || '');
    setIssueDate(coerceStoredDateToMs(row.issueDate) ? timestampToHtmlDateValue(coerceStoredDateToMs(row.issueDate)!) : '');
    setExpiryDate(coerceStoredDateToMs(row.expiryDate) ? timestampToHtmlDateValue(coerceStoredDateToMs(row.expiryDate)!) : '');
    if (row.attachment?.downloadUrl) {
      setFormPreviewUrl(row.attachment.downloadUrl);
      setFormPreviewIsPdf(isPdfAttachment(row.attachment));
    }
  };

  useEffect(() => {
    if (!dialogOpen) clearPhotoPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen]);

  const openAddDialog = () => {
    resetForm();
    setFormContext('add-document');
    setDialogOpen(true);
  };

  const openFillPositionCert = (req: PositionCertificateRequirement) => {
    resetForm();
    setFormContext('add-position-cert');
    setLockedPositionReq(req);
    const template =
      (req.templateId ? (workerDocCatalog || []).find((x) => x.id === req.templateId) : undefined) ||
      catalogHit(workerDocCatalog, req.certificateCode);
    setTemplateId(template?.id || '');
    setDialogOpen(true);
  };

  const orGroupFillOptions = useMemo(() => {
    const gk = (lockedPositionReq?.alternativeGroupKey || '').trim();
    if (!gk) return null;
    return (positionCertRequirements || []).filter(
      (r) => (r.alternativeGroupKey || '').trim() === gk,
    );
  }, [lockedPositionReq, positionCertRequirements]);

  const pickOrGroupFillReq = (reqId: string) => {
    const req = (positionCertRequirements || []).find((r) => r.id === reqId);
    if (!req) return;
    setLockedPositionReq(req);
    const template =
      (req.templateId ? (workerDocCatalog || []).find((x) => x.id === req.templateId) : undefined) ||
      catalogHit(workerDocCatalog, req.certificateCode);
    setTemplateId(template?.id || '');
  };

  const openEditDialog = (row: UnifiedCredentialRow) => {
    if (row.kind === 'certificate') {
      const cert = (certs || []).find((c) => c.id === row.id);
      if (cert) populateFromCert(cert);
    } else {
      const docRow = (workerDocs || []).find((d) => d.id === row.id);
      if (docRow) populateFromDoc(docRow);
    }
    setDialogOpen(true);
  };

  const removeAttachmentPreview = () => {
    if (formPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(formPreviewUrl);
    setFormPreviewUrl(null);
    setFormFile(null);
    setFormRemoveAttachment(true);
    setFormPreviewIsPdf(false);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const onAttachmentPick = (file: File | null) => {
    if (!file) return;
    const pdf = isPdfFile(file);
    if (!pdf && !file.type.startsWith('image/')) {
      toast({
        variant: 'destructive',
        title: 'ไฟล์ไม่รองรับ',
        description: 'เลือกรูปภาพ (JPEG, PNG, WebP) หรือ PDF',
      });
      return;
    }
    if (formPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(formPreviewUrl);
    setFormFile(file);
    setFormRemoveAttachment(false);
    setFormPreviewIsPdf(pdf);
    setFormPreviewUrl(URL.createObjectURL(file));
  };

  const resolveSaveTarget = (): {
    kind: CredentialKind;
    itemName: string;
    itemCode: string;
    hasExpiry: boolean;
  } | null => {
    if (formContext === 'add-position-cert' && lockedPositionReq) {
      const tpl = selectedTemplate;
      return {
        kind: 'certificate',
        itemName: tpl?.itemName || lockedPositionReq.certificateName,
        itemCode: tpl?.itemCode || lockedPositionReq.certificateCode,
        hasExpiry: tpl?.hasExpiry ?? lockedPositionReq.hasExpiry ?? true,
      };
    }
    if (formContext === 'add-document') {
      const selected = documentCatalogOptions.find((x) => x.id === templateId);
      if (!selected || selected.requirementType !== 'document') return null;
      return {
        kind: 'document',
        itemName: selected.itemName,
        itemCode: selected.itemCode,
        hasExpiry: selected.hasExpiry ?? false,
      };
    }
    if (formContext === 'edit' && editing) {
      if (editing.kind === 'certificate') {
        const cert = (certs || []).find((c) => c.id === editing.id);
        if (!cert) return null;
        const tpl = catalogHit(workerDocCatalog, cert.certificateCode);
        return {
          kind: 'certificate',
          itemName: tpl?.itemName || cert.certificateName,
          itemCode: cert.certificateCode,
          hasExpiry: tpl?.hasExpiry ?? true,
        };
      }
      const selected = documentCatalogOptions.find((x) => x.id === templateId);
      if (!selected || selected.requirementType !== 'document') return null;
      return {
        kind: 'document',
        itemName: selected.itemName,
        itemCode: selected.itemCode,
        hasExpiry: selected.hasExpiry ?? false,
      };
    }
    return null;
  };

  const handleSave = async () => {
    if (!firestore) return;
    const target = resolveSaveTarget();
    if (!target) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่ได้เลือกรายการ',
        description:
          formContext === 'add-document'
            ? 'เลือกเอกสารประเภท DOCUMENT จากรายการกลาง'
            : 'ไม่พบรายการที่จะบันทึก',
      });
      return;
    }
    const kind = target.kind;
    if (!editing && kind === 'certificate' && !certsQuery) return;
    if (!editing && kind === 'document' && !docsQuery) return;
    if (!number.trim()) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'กรุณากรอกเลขที่เอกสาร' });
      return;
    }
    if (target.hasExpiry && !expiryDate) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'รายการนี้ต้องระบุวันหมดอายุ' });
      return;
    }

    const duplicateCert =
      kind === 'certificate'
        ? (certs || []).find(
            (c) =>
              (c.certificateCode || '').toLowerCase() === (target.itemCode || '').toLowerCase() &&
              c.id !== editing?.id,
          )
        : undefined;
    const duplicateDoc =
      kind === 'document'
        ? (workerDocs || []).find(
            (d) =>
              (d.documentType || '').toLowerCase() === (target.itemCode || '').toLowerCase() &&
              d.id !== editing?.id,
          )
        : undefined;

    if (!editing && duplicateCert) {
      const shouldEdit = confirm('มีรายการใบเซอร์นี้อยู่แล้ว ต้องการแก้ไขรายการเดิมใช่ไหม?');
      if (!shouldEdit) return;
      populateFromCert(duplicateCert);
      toast({ title: 'เข้าสู่โหมดแก้ไข', description: 'ปรับข้อมูลและกดบันทึกอีกครั้ง' });
      return;
    }
    if (!editing && duplicateDoc) {
      const shouldEdit = confirm('มีเอกสารรายการนี้อยู่แล้ว ต้องการแก้ไขรายการเดิมใช่ไหม?');
      if (!shouldEdit) return;
      populateFromDoc(duplicateDoc);
      toast({ title: 'เข้าสู่โหมดแก้ไข', description: 'ปรับข้อมูลและกดบันทึกอีกครั้ง' });
      return;
    }

    setSaving(true);
    try {
      const now = Date.now();
      const issueTs = issueDate ? new Date(issueDate).getTime() : now;
      const expiryTs = target.hasExpiry ? (expiryDate ? new Date(expiryDate).getTime() : 0) : 0;

      let attachment: { downloadUrl?: string } | undefined;
      if (formFile) {
        attachment =
          kind === 'certificate'
            ? await uploadWorkerCertificatePhoto(firebaseApp, workerId, target.itemCode, formFile)
            : await uploadWorkerDocumentPhoto(firebaseApp, workerId, target.itemCode, formFile);
      }

      if (kind === 'certificate') {
        const payload: Record<string, unknown> = {
          certificateName: target.itemName,
          certificateCode: target.itemCode,
          certificateNo: number.trim(),
          issueDate: issueTs,
          expiryDate: expiryTs,
          status: !target.hasExpiry || !isStoredExpiryPast(expiryTs, now) ? 'valid' : 'expired',
        };
        if (attachment) payload.attachment = attachment;
        else if (editing && formRemoveAttachment) payload.attachment = deleteField();

        if (editing) {
          updateDocumentNonBlocking(doc(firestore, 'workers', workerId, 'certificates', editing.id), payload);
        } else {
          addDocumentNonBlocking(certsQuery!, payload);
        }
      } else {
        const payload: Record<string, unknown> = {
          documentType: target.itemCode,
          documentNo: number.trim(),
          issueDate: issueTs,
          expiryDate: expiryTs,
        };
        if (attachment) payload.attachment = attachment;
        else if (editing && formRemoveAttachment) payload.attachment = deleteField();

        if (editing) {
          updateDocumentNonBlocking(doc(firestore, 'workers', workerId, 'documents', editing.id), payload);
        } else {
          addDocumentNonBlocking(docsQuery!, payload);
        }
      }

      const wasEdit = !!editing;
      setDialogOpen(false);
      resetForm();
      toast({ title: wasEdit ? 'อัปเดตรายการแล้ว' : 'บันทึกรายการแล้ว' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (row: UnifiedCredentialRow) => {
    if (!firestore || !confirm('ลบรายการ?')) return;
    const sub = row.kind === 'certificate' ? 'certificates' : 'documents';
    deleteDocumentNonBlocking(doc(firestore, 'workers', workerId, sub, row.id));
  };

  const openSkipDialog = (req: PositionCertificateRequirement) => {
    setSkipTarget(req);
    setSkipReason('');
  };

  const handleConfirmSkip = async () => {
    if (!firestore || !skipTarget) return;
    const reason = skipReason.trim();
    if (!reason) {
      toast({ variant: 'destructive', title: 'กรุณาระบุเหตุผล', description: 'ต้องบันทึกเหตุผลเมื่อข้ามเกณฑ์' });
      return;
    }
    setSkipSaving(true);
    try {
      const now = Date.now();
      const skipId = requirementSkipDocId(skipTarget);
      await setDoc(
        doc(firestore, 'workers', workerId, 'requirement_skips', skipId),
        sanitizeFirestorePayload({
          requirementId: skipTarget.id,
          certificateCode: skipTarget.certificateCode,
          certificateName: skipTarget.certificateName,
          requirementType: skipTarget.requirementType || 'certificate',
          alternativeGroupKey: (skipTarget.alternativeGroupKey || '').trim() || undefined,
          reason,
          skippedAt: now,
          skippedByUserId: currentUserId || undefined,
          positionId: currentPositionId || undefined,
        }),
        { merge: true },
      );
      setSkipTarget(null);
      setSkipReason('');
      toast({ title: 'ข้ามเกณฑ์แล้ว', description: 'บันทึกเหตุผลและอัปเดตความพร้อม' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: message });
    } finally {
      setSkipSaving(false);
    }
  };

  const handleUndoSkip = (skip: WorkerRequirementSkip) => {
    if (!firestore || !confirm('ยกเลิกการข้ามเกณฑ์นี้?')) return;
    deleteDocumentNonBlocking(doc(firestore, 'workers', workerId, 'requirement_skips', skip.id));
    toast({ title: 'ยกเลิกการข้ามแล้ว' });
  };

  const colCount = canEdit ? 7 : 6;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2 text-primary">
            <FileText className="h-5 w-5" /> เอกสารและใบเซอร์ (Documents & Certificates)
          </CardTitle>
          <CardDescription>
            ใบเซอร์ (CERTIFICATE) ตามเกณฑ์ตำแหน่งงาน · เอกสาร (DOCUMENT) เพิ่มจากรายการกลางได้ที่ปุ่มด้านขวา
          </CardDescription>
        </div>
        {canEdit ? (
          <Button className="bg-primary font-bold shadow-md shrink-0" onClick={openAddDialog}>
            <Plus className="h-4 w-4 mr-2" /> เพิ่มเอกสาร
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="pl-6 font-bold">ชื่อรายการ</TableHead>
              <TableHead className="font-bold">ประเภท</TableHead>
              <TableHead className="font-bold">เลขที่</TableHead>
              <TableHead className="font-bold">วันหมดอายุ</TableHead>
              <TableHead className="font-bold">สถานะ</TableHead>
              <TableHead className="font-bold text-center text-blue-700">เอกสารแนบ</TableHead>
              {canEdit ? <TableHead className="text-center pr-6 font-bold">จัดการ</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const catalogItem = catalogHit(workerDocCatalog, row.itemCode);
              const reqType = catalogItem?.requirementType || row.kind;
              const hasExpiry = catalogItem?.hasExpiry ?? true;
              const expired = hasExpiry && isStoredExpiryPast(row.expiryDate);
              const displayStatus = effectiveCredentialRowStatus(
                row.kind,
                row.status,
                row.expiryDate,
                Date.now(),
                hasExpiry,
              );
              return (
                <TableRow key={`${row.kind}-${row.id}`}>
                  <TableCell className="pl-6 font-medium text-primary align-top break-words">{row.itemName}</TableCell>
                  <TableCell className="align-top">
                    <Badge variant="outline" className="uppercase text-[10px] font-semibold tracking-wide">
                      {catalogRequirementTypeLabel(reqType === 'document' ? 'document' : 'certificate')}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs align-top break-all">{row.number || '—'}</TableCell>
                  <TableCell className={`align-top ${expired ? 'text-destructive font-black' : 'font-medium'}`}>
                    {!hasExpiry ? (
                      <span className="text-xs text-muted-foreground">ไม่มีวันหมดอายุ</span>
                    ) : row.expiryDate > 0 ? (
                      formatOptionalDateThaiBE(row.expiryDate, '—')
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    {displayStatus ? (
                      <Badge
                        variant={displayStatus === 'valid' ? 'default' : 'destructive'}
                        className={displayStatus === 'valid' ? 'bg-green-600' : ''}
                      >
                        {displayStatus.toUpperCase()}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center align-top">
                    {row.attachment?.downloadUrl ? (
                      <WorkerCredentialAttachmentThumb attachment={row.attachment} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="text-center pr-6 align-top">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          title="แก้ไขรายการ"
                          onClick={() => openEditDialog(row)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive h-8 w-8"
                          title="ลบรายการ"
                          onClick={() => handleDelete(row)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
            {missingPositionCerts.map((req) => {
              const orMeta = missingOrGroupMeta.get(req.id);
              const isOrGroup = !!orMeta && (req.alternativeGroupKey || '').trim();
              return (
              <TableRow key={`missing-${req.id}`} className="bg-amber-50/40">
                <TableCell className="pl-6 font-medium text-primary align-top break-words">
                  {isOrGroup ? orMeta!.label : req.certificateName}
                  {isOrGroup ? (
                    <p className="text-[10px] font-normal text-muted-foreground mt-1">
                      อย่างใดอย่างหนึ่ง: {orMeta!.summary}
                    </p>
                  ) : null}
                  <Badge variant="outline" className="ml-2 text-[10px] font-normal text-amber-800 border-amber-300">
                    {isOrGroup ? 'OR · ตามตำแหน่ง' : 'ตามตำแหน่ง'}
                  </Badge>
                </TableCell>
                <TableCell className="align-top">
                  <Badge variant="outline" className="uppercase text-[10px] font-semibold tracking-wide">
                    CERTIFICATE
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs align-top text-muted-foreground">—</TableCell>
                <TableCell className="align-top text-muted-foreground">—</TableCell>
                <TableCell className="align-top">
                  <Badge variant="secondary" className="text-[10px] uppercase" title="ยังไม่ได้บันทึกใบเซอร์รายการนี้">
                    ยังไม่ครบ
                  </Badge>
                </TableCell>
                <TableCell className="text-center align-top text-muted-foreground">—</TableCell>
                {canEdit ? (
                  <TableCell className="text-center pr-6 align-top">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-muted-foreground"
                        title="ข้ามเกณฑ์ (ไม่บล็อกความพร้อม)"
                        onClick={() => openSkipDialog(req)}
                      >
                        <SkipForward className="h-3.5 w-3.5 mr-1" />
                        ข้าม
                      </Button>
                      <Button size="sm" className="h-8" onClick={() => openFillPositionCert(req)}>
                        บันทึกใบเซอร์
                      </Button>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            );
            })}
            {skippedPositionCerts.map(({ req, skip }) => {
              const orMeta = missingOrGroupMeta.get(req.id);
              const isOrGroup = !!orMeta && (req.alternativeGroupKey || '').trim();
              return (
                <TableRow key={`skipped-${skip.id}`} className="bg-slate-50/80">
                  <TableCell className="pl-6 font-medium text-primary align-top break-words">
                    {isOrGroup ? orMeta!.label : req.certificateName}
                    {isOrGroup ? (
                      <p className="text-[10px] font-normal text-muted-foreground mt-1">
                        อย่างใดอย่างหนึ่ง: {orMeta!.summary}
                      </p>
                    ) : null}
                    <Badge variant="outline" className="ml-2 text-[10px] font-normal text-slate-700 border-slate-300">
                      ข้ามแล้ว
                    </Badge>
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant="outline" className="uppercase text-[10px] font-semibold tracking-wide">
                      CERTIFICATE
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs align-top text-muted-foreground">—</TableCell>
                  <TableCell className="align-top text-muted-foreground">—</TableCell>
                  <TableCell className="align-top">
                    <Badge variant="secondary" className="text-[10px] uppercase bg-slate-200 text-slate-800">
                      SKIPPED
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center align-top text-muted-foreground text-xs max-w-[10rem]">
                    <span className="line-clamp-3" title={skip.reason}>
                      {skip.reason}
                    </span>
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="text-center pr-6 align-top">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-muted-foreground"
                        title="ยกเลิกการข้าม"
                        onClick={() => handleUndoSkip(skip)}
                      >
                        <Undo2 className="h-3.5 w-3.5 mr-1" />
                        ยกเลิกข้าม
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
            {rows.length === 0 && missingPositionCerts.length === 0 && skippedPositionCerts.length === 0 && (
              <TableRow>
                <TableCell colSpan={colCount} className="py-20 text-center text-muted-foreground italic">
                  ไม่พบเอกสารหรือใบเซอร์ในระบบ
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {formContext === 'add-document'
                  ? 'เพิ่มเอกสาร (DOCUMENT)'
                  : formContext === 'add-position-cert'
                    ? 'บันทึกใบเซอร์ตามตำแหน่ง'
                    : editing?.kind === 'certificate'
                      ? 'แก้ไขใบเซอร์'
                      : 'แก้ไขเอกสาร'}
              </DialogTitle>
              <DialogDescription>
                {formContext === 'add-document'
                  ? 'เลือกเฉพาะรายการประเภท DOCUMENT จากเอกสารกลาง'
                  : formContext === 'add-position-cert'
                    ? 'กรอกข้อมูลใบเซอร์ที่ตำแหน่งงานกำหนดไว้ — ไม่สามารถเลือกใบเซอร์นอกเกณฑ์ได้'
                    : editing?.kind === 'certificate'
                      ? 'แก้ไขข้อมูลใบเซอร์หรือไฟล์แนบ'
                      : 'แก้ไขข้อมูลเอกสารหรือไฟล์แนบ'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              {formContext === 'add-document' || (formContext === 'edit' && editing?.kind === 'document') ? (
                <>
                  <Label>รายการเอกสาร (DOCUMENT)</Label>
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger>
                      <SelectValue placeholder="เลือกเอกสาร..." />
                    </SelectTrigger>
                    <SelectContent>
                      {dialogCatalogOptions.map((x) => (
                        <SelectItem key={x.id} value={x.id}>
                          {x.itemName} · DOCUMENT
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <>
                  {orGroupFillOptions && orGroupFillOptions.length > 1 ? (
                    <div className="space-y-2">
                      <Label>เลือกใบเซอร์ในกลุ่ม OR</Label>
                      <Select value={lockedPositionReq?.id || ''} onValueChange={pickOrGroupFillReq}>
                        <SelectTrigger>
                          <SelectValue placeholder="เลือกใบเซอร์..." />
                        </SelectTrigger>
                        <SelectContent>
                          {orGroupFillOptions.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.certificateName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                    <p className="text-xs text-muted-foreground mb-1">ใบเซอร์ (CERTIFICATE)</p>
                    <p className="font-semibold text-primary">
                      {lockedPositionReq?.certificateName ||
                        selectedTemplate?.itemName ||
                        (certs || []).find((c) => c.id === editing?.id)?.certificateName ||
                        '—'}
                    </p>
                  </div>
                </>
              )}
              {selectedTemplate && formContext === 'add-document' ? (
                <p className="text-xs text-muted-foreground">
                  ประเภท: <span className="font-semibold uppercase">DOCUMENT</span>
                </p>
              ) : null}
              <Label>เลขที่เอกสาร</Label>
              <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="เช่น CERT-00123 / P1234567" />
              <Label>วันที่ออกเอกสาร</Label>
              <DatePickerThaiBE
                className="h-10"
                value={htmlDateValueToTimestampMs(issueDate)}
                onChange={(ms) => setIssueDate(timestampToHtmlDateValue(ms))}
              />
              <Label>วันหมดอายุ</Label>
              <DatePickerThaiBE
                className="h-10"
                value={htmlDateValueToTimestampMs(expiryDate)}
                disabled={
                  formContext === 'add-document' || (formContext === 'edit' && editing?.kind === 'document')
                    ? !selectedTemplate?.hasExpiry
                    : !(selectedTemplate?.hasExpiry ?? lockedPositionReq?.hasExpiry ?? true)
                }
                onChange={(ms) => setExpiryDate(timestampToHtmlDateValue(ms))}
              />
              <div className="space-y-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3">
                <Label className="flex items-center gap-2">
                  <Camera className="h-4 w-4" /> แนบไฟล์ (รูปหรือ PDF)
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  รูป: JPEG/PNG/WebP (บีบอัดไม่เกิน 500 KB) · PDF: สูงสุด 10 MB
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*,application/pdf,.pdf"
                    capture="environment"
                    className="max-w-[14rem] text-xs"
                    onChange={(e) => onAttachmentPick(e.target.files?.[0] ?? null)}
                  />
                  {formPreviewUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-destructive"
                      onClick={removeAttachmentPreview}
                    >
                      <X className="h-3 w-3 mr-1" /> {editing && !formFile ? 'ลบไฟล์แนบ' : 'ลบไฟล์'}
                    </Button>
                  )}
                </div>
                {formRemoveAttachment && !formPreviewUrl && (
                  <p className="text-[10px] text-amber-700">จะลบไฟล์แนบเดิมเมื่อกดบันทึก</p>
                )}
                {formPreviewUrl && formPreviewIsPdf ? (
                  <a
                    href={formPreviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-red-800 hover:bg-muted/40"
                  >
                    <FileText className="h-5 w-5 shrink-0" />
                    <span className="truncate max-w-[12rem]">{formFile?.name || 'ไฟล์ PDF'}</span>
                  </a>
                ) : null}
                {formPreviewUrl && !formPreviewIsPdf ? (
                  <a href={formPreviewUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={formPreviewUrl} alt="ตัวอย่างรูปแนบ" className="h-20 w-20 rounded border object-cover" />
                  </a>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                ยกเลิก
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {editing ? 'บันทึกการแก้ไข' : 'บันทึก'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={skipTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setSkipTarget(null);
              setSkipReason('');
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>ข้ามเกณฑ์ใบเซอร์</DialogTitle>
              <DialogDescription>
                {skipTarget?.certificateName || '—'} — จะไม่บล็อกความพร้อม (Not Ready) แต่ต้องระบุเหตุผล
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="skip-reason">เหตุผลที่ข้าม</Label>
              <Textarea
                id="skip-reason"
                value={skipReason}
                onChange={(e) => setSkipReason(e.target.value)}
                placeholder="เช่น มีใบเซอร์จากบริษัทเดิม / ลูกค้ายอมรับ / รออบรมรอบถัดไป"
                rows={4}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setSkipTarget(null);
                  setSkipReason('');
                }}
                disabled={skipSaving}
              >
                ยกเลิก
              </Button>
              <Button onClick={() => void handleConfirmSkip()} disabled={skipSaving}>
                {skipSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                ยืนยันข้าม
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
