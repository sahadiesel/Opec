'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue, formatOptionalDateThaiBE } from '@/lib/date-thai';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Trash2, FileText, Pencil, Camera, Loader2, X, FileImage } from 'lucide-react';
import { deleteField, doc, type Firestore, type CollectionReference } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { useFirebaseApp } from '@/firebase';
import { uploadWorkerCertificatePhoto } from '@/lib/storage/worker-certificate-photos';
import { uploadWorkerDocumentPhoto } from '@/lib/storage/worker-document-photos';
import type {
  WorkerCertificate,
  WorkerDocument,
  WorkerDocumentCatalogItem,
  PositionCertificateRequirement,
} from '@/lib/types';

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
  attachment?: { downloadUrl?: string };
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
      expiryDate: c.expiryDate || 0,
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
      expiryDate: d.expiryDate || 0,
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
  const [formPreviewUrl, setFormPreviewUrl] = useState<string | null>(null);
  const [formRemoveAttachment, setFormRemoveAttachment] = useState(false);
  const [saving, setSaving] = useState(false);

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

  const missingPositionCerts = useMemo(
    () =>
      positionCertificateReqs.filter(
        (req) =>
          !(certs || []).some(
            (c) =>
              (c.certificateCode || '').toLowerCase() === (req.certificateCode || '').toLowerCase(),
          ),
      ),
    [positionCertificateReqs, certs],
  );

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
    setIssueDate(cert.issueDate ? timestampToHtmlDateValue(cert.issueDate) : '');
    setExpiryDate(cert.expiryDate ? timestampToHtmlDateValue(cert.expiryDate) : '');
    if (cert.attachment?.downloadUrl) setFormPreviewUrl(cert.attachment.downloadUrl);
  };

  const populateFromDoc = (row: WorkerDocument) => {
    clearPhotoPreview();
    setFormContext('edit');
    setLockedPositionReq(null);
    setEditing({ id: row.id, kind: 'document' });
    const template = catalogHit(workerDocCatalog, row.documentType);
    setTemplateId(template?.id || '');
    setNumber(row.documentNo || '');
    setIssueDate(row.issueDate ? timestampToHtmlDateValue(row.issueDate) : '');
    setExpiryDate(row.expiryDate ? timestampToHtmlDateValue(row.expiryDate) : '');
    if (row.attachment?.downloadUrl) setFormPreviewUrl(row.attachment.downloadUrl);
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
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const onPhotoPick = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'รองรับเฉพาะรูปภาพ', description: 'เลือกไฟล์ JPEG, PNG หรือ WebP' });
      return;
    }
    if (formPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(formPreviewUrl);
    setFormFile(file);
    setFormRemoveAttachment(false);
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
          status: 'valid',
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
              const thumbUrl = row.attachment?.downloadUrl;
              const expired = row.expiryDate > 0 && row.expiryDate < Date.now();
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
                    {row.expiryDate > 0 ? formatOptionalDateThaiBE(row.expiryDate, '—') : '—'}
                  </TableCell>
                  <TableCell className="align-top">
                    {row.kind === 'certificate' && row.status ? (
                      <Badge
                        variant={row.status === 'valid' ? 'default' : 'destructive'}
                        className={row.status === 'valid' ? 'bg-green-600' : ''}
                      >
                        {row.status.toUpperCase()}
                      </Badge>
                    ) : expired ? (
                      <Badge variant="destructive">EXPIRED</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center align-top">
                    {thumbUrl ? (
                      <a
                        href={thumbUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex flex-col items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-blue-700 hover:bg-blue-100"
                        title="เปิดเอกสารแนบ"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumbUrl} alt="" className="h-10 w-10 rounded object-cover" />
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold">
                          <FileImage className="h-3 w-3" /> ดูเอกสาร
                        </span>
                      </a>
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
            {missingPositionCerts.map((req) => (
              <TableRow key={`missing-${req.id}`} className="bg-amber-50/40">
                <TableCell className="pl-6 font-medium text-primary align-top break-words">
                  {req.certificateName}
                  <Badge variant="outline" className="ml-2 text-[10px] font-normal text-amber-800 border-amber-300">
                    ตามตำแหน่ง
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
                  <Badge variant="secondary" className="text-[10px] uppercase">
                    ยังไม่มี
                  </Badge>
                </TableCell>
                <TableCell className="text-center align-top text-muted-foreground">—</TableCell>
                {canEdit ? (
                  <TableCell className="text-center pr-6 align-top">
                    <Button size="sm" className="h-8" onClick={() => openFillPositionCert(req)}>
                      บันทึกใบเซอร์
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
            {rows.length === 0 && missingPositionCerts.length === 0 && (
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
                <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                  <p className="text-xs text-muted-foreground mb-1">ใบเซอร์ (CERTIFICATE)</p>
                  <p className="font-semibold text-primary">
                    {lockedPositionReq?.certificateName ||
                      selectedTemplate?.itemName ||
                      (certs || []).find((c) => c.id === editing?.id)?.certificateName ||
                      '—'}
                  </p>
                </div>
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
                  <Camera className="h-4 w-4" /> แนบรูปถ่าย
                </Label>
                <p className="text-[10px] text-muted-foreground">ถ่ายจากกล้องหรือเลือกไฟล์ — ระบบบีบอัดไม่เกิน 500 KB</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="max-w-[14rem] text-xs"
                    onChange={(e) => onPhotoPick(e.target.files?.[0] ?? null)}
                  />
                  {formPreviewUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-destructive"
                      onClick={removeAttachmentPreview}
                    >
                      <X className="h-3 w-3 mr-1" /> {editing && !formFile ? 'ลบไฟล์แนบ' : 'ลบรูป'}
                    </Button>
                  )}
                </div>
                {formRemoveAttachment && !formPreviewUrl && (
                  <p className="text-[10px] text-amber-700">จะลบไฟล์แนบเดิมเมื่อกดบันทึก</p>
                )}
                {formPreviewUrl && (
                  <a href={formPreviewUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={formPreviewUrl} alt="ตัวอย่างรูปแนบ" className="h-20 w-20 rounded border object-cover" />
                  </a>
                )}
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
      </CardContent>
    </Card>
  );
}
