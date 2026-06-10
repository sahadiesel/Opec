'use client';

import { useEffect, useRef, useState } from 'react';
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
import type { WorkerCertificate, WorkerDocumentCatalogItem } from '@/lib/types';

interface WorkerCertsTabProps {
  workerId: string;
  firestore: Firestore | null;
  certs: WorkerCertificate[] | null;
  certsQuery: CollectionReference | null;
  workerDocCatalog: WorkerDocumentCatalogItem[] | null;
  canEdit?: boolean;
}

export function WorkerCertsTab({ workerId, firestore, certs, certsQuery, workerDocCatalog, canEdit = false }: WorkerCertsTabProps) {
  const { toast } = useToast();
  const firebaseApp = useFirebaseApp();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [certDialogOpen, setCertDialogOpen] = useState(false);
  const [newCertTemplateId, setNewCertTemplateId] = useState('');
  const [newCertNo, setNewCertNo] = useState('');
  const [newCertIssueDate, setNewCertIssueDate] = useState('');
  const [newCertExpiryDate, setNewCertExpiryDate] = useState('');
  const [editingCertId, setEditingCertId] = useState<string | null>(null);
  const [certFormFile, setCertFormFile] = useState<File | null>(null);
  const [certFormPreviewUrl, setCertFormPreviewUrl] = useState<string | null>(null);
  const [certFormRemoveAttachment, setCertFormRemoveAttachment] = useState(false);
  const [certSaving, setCertSaving] = useState(false);

  const selectedTemplate = (workerDocCatalog || []).find((x) => x.id === newCertTemplateId);

  const clearPhotoPreview = () => {
    if (certFormPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(certFormPreviewUrl);
    }
    setCertFormPreviewUrl(null);
    setCertFormFile(null);
    setCertFormRemoveAttachment(false);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const resetCertForm = () => {
    clearPhotoPreview();
    setEditingCertId(null);
    setNewCertTemplateId('');
    setNewCertNo('');
    setNewCertIssueDate('');
    setNewCertExpiryDate('');
  };

  const populateFormFromCert = (cert: WorkerCertificate) => {
    clearPhotoPreview();
    setEditingCertId(cert.id);
    const template = (workerDocCatalog || []).find(
      (x) => (x.itemCode || '').toLowerCase() === (cert.certificateCode || '').toLowerCase(),
    );
    setNewCertTemplateId(template?.id || '');
    setNewCertNo(cert.certificateNo || '');
    setNewCertIssueDate(cert.issueDate ? timestampToHtmlDateValue(cert.issueDate) : '');
    setNewCertExpiryDate(cert.expiryDate ? timestampToHtmlDateValue(cert.expiryDate) : '');
    if (cert.attachment?.downloadUrl) {
      setCertFormPreviewUrl(cert.attachment.downloadUrl);
    }
  };

  useEffect(() => {
    if (!certDialogOpen) {
      clearPhotoPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when dialog closes
  }, [certDialogOpen]);

  const openAddCertDialog = () => {
    resetCertForm();
    setCertDialogOpen(true);
  };

  const openEditCertDialog = (cert: WorkerCertificate) => {
    populateFormFromCert(cert);
    setCertDialogOpen(true);
  };

  const removeAttachmentPreview = () => {
    if (certFormPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(certFormPreviewUrl);
    }
    setCertFormPreviewUrl(null);
    setCertFormFile(null);
    setCertFormRemoveAttachment(true);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const onPhotoPick = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'รองรับเฉพาะรูปภาพ', description: 'เลือกไฟล์ JPEG, PNG หรือ WebP' });
      return;
    }
    if (certFormPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(certFormPreviewUrl);
    }
    setCertFormFile(file);
    setCertFormRemoveAttachment(false);
    setCertFormPreviewUrl(URL.createObjectURL(file));
  };

  const handleSaveCert = async () => {
    const selected = (workerDocCatalog || []).find((x) => x.id === newCertTemplateId);
    if (!selected || !firestore) return;
    if (!editingCertId && !certsQuery) return;
    if (!newCertNo.trim()) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'กรุณากรอกเลขที่เอกสารใบเซอร์' });
      return;
    }
    if (selected.hasExpiry && !newCertExpiryDate) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'เอกสารนี้ต้องระบุวันหมดอายุ' });
      return;
    }
    const duplicateCert = (certs || []).find(
      (c) =>
        (c.certificateCode || '').toLowerCase() === (selected.itemCode || '').toLowerCase() &&
        c.id !== editingCertId,
    );
    if (duplicateCert && !editingCertId) {
      const shouldEdit = confirm('มีเอกสาร/ใบเซอร์รายการนี้อยู่แล้ว ต้องการแก้ไขรายการเดิมใช่ไหม?');
      if (!shouldEdit) return;
      populateFormFromCert(duplicateCert);
      toast({ title: 'เข้าสู่โหมดแก้ไข', description: 'ปรับข้อมูลและกดบันทึกอีกครั้งเพื่ออัปเดตรายการเดิม' });
      return;
    }

    setCertSaving(true);
    try {
      let attachment = undefined as WorkerCertificate['attachment'];
      if (certFormFile) {
        attachment = await uploadWorkerCertificatePhoto(
          firebaseApp,
          workerId,
          selected.itemCode,
          certFormFile,
        );
      }

      const now = Date.now();
      const issueDate = newCertIssueDate ? new Date(newCertIssueDate).getTime() : now;
      const expiryDate = selected.hasExpiry
        ? (newCertExpiryDate ? new Date(newCertExpiryDate).getTime() : 0)
        : 0;

      const payload: Record<string, unknown> = {
        certificateName: selected.itemName,
        certificateCode: selected.itemCode,
        certificateNo: newCertNo.trim(),
        issueDate,
        expiryDate,
        status: 'valid',
      };

      if (attachment) {
        payload.attachment = attachment;
      } else if (editingCertId && certFormRemoveAttachment) {
        payload.attachment = deleteField();
      }

      if (editingCertId) {
        updateDocumentNonBlocking(doc(firestore, 'workers', workerId, 'certificates', editingCertId), payload);
      } else {
        addDocumentNonBlocking(certsQuery!, payload);
      }

      const wasEdit = !!editingCertId;
      setCertDialogOpen(false);
      resetCertForm();
      toast({ title: wasEdit ? 'อัปเดตใบเซอร์แล้ว' : 'บันทึกใบเซอร์แล้ว' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: message });
    } finally {
      setCertSaving(false);
    }
  };

  const colClass = canEdit ? 'w-1/6' : 'w-1/5';
  const colCount = canEdit ? 6 : 5;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2 text-primary">
            <FileText className="h-5 w-5" /> รายการใบรับรอง (Certificates Management)
          </CardTitle>
          <CardDescription>จัดเก็บใบเซอร์บังคับ (BOSIET, etc.) และติดตามวันหมดอายุ</CardDescription>
        </div>
        {canEdit ? (
          <Button className="bg-primary font-bold shadow-md shrink-0" onClick={openAddCertDialog}>
            <Plus className="h-4 w-4 mr-2" /> เพิ่มใบเซอร์ (Add Cert)
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table className="table-fixed w-full">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className={`${colClass} pl-6 font-bold`}>ชื่อใบเซอร์ (Name)</TableHead>
              <TableHead className={`${colClass} font-bold`}>เลขที่ใบเซอร์ (No.)</TableHead>
              <TableHead className={`${colClass} font-bold`}>วันหมดอายุ (Expiry)</TableHead>
              <TableHead className={`${colClass} font-bold`}>สถานะ (Status)</TableHead>
              <TableHead className={`${colClass} font-bold text-center text-blue-700`}>เอกสารแนบ</TableHead>
              {canEdit ? <TableHead className={`${colClass} text-center pr-6 font-bold`}>จัดการ</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {certs?.map((c) => {
              const thumbUrl = c.attachment?.downloadUrl;
              return (
                <TableRow key={c.id}>
                  <TableCell className={`${colClass} pl-6 font-medium text-primary align-top break-words`}>
                    {c.certificateName}
                  </TableCell>
                  <TableCell className={`${colClass} font-mono text-xs align-top break-all`}>{c.certificateNo || '—'}</TableCell>
                  <TableCell
                    className={`${colClass} align-top ${c.expiryDate > 0 && c.expiryDate < Date.now() ? 'text-destructive font-black' : 'font-medium'}`}
                  >
                    {c.expiryDate > 0 ? formatOptionalDateThaiBE(c.expiryDate, '—') : '—'}
                  </TableCell>
                  <TableCell className={`${colClass} align-top`}>
                    <Badge variant={c.status === 'valid' ? 'default' : 'destructive'} className={c.status === 'valid' ? 'bg-green-600' : ''}>
                      {c.status.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className={`${colClass} text-center align-top`}>
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
                    <TableCell className={`${colClass} text-center pr-6 align-top`}>
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          title="แก้ไขรายการ"
                          onClick={() => openEditCertDialog(c)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive h-8 w-8"
                          title="ลบรายการ"
                          onClick={() => {
                            if (!firestore) return;
                            if (confirm('ลบรายการ?')) {
                              deleteDocumentNonBlocking(doc(firestore, 'workers', workerId, 'certificates', c.id));
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
            {certs?.length === 0 && (
              <TableRow>
                <TableCell colSpan={colCount} className="py-20 text-center text-muted-foreground italic">
                  ไม่พบข้อมูลใบรับรอง
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Dialog
          open={certDialogOpen}
          onOpenChange={(open) => {
            setCertDialogOpen(open);
            if (!open) resetCertForm();
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingCertId ? 'แก้ไขใบเซอร์' : 'เพิ่มใบเซอร์จากรายการกลาง'}</DialogTitle>
              <DialogDescription>
                {editingCertId
                  ? 'แก้ไขข้อมูลใบเซอร์หรือไฟล์แนบ — ลบรูปเดิมแล้วเลือกไฟล์ใหม่ได้'
                  : 'เลือกเฉพาะรายการประเภท Certificate จากเมนูรายการเอกสารกลาง'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label>รายการเซอร์</Label>
              <Select value={newCertTemplateId} onValueChange={setNewCertTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือกใบเซอร์..." />
                </SelectTrigger>
                <SelectContent>
                  {(workerDocCatalog || [])
                    .filter((x) => x.active !== false && x.requirementType === 'certificate')
                    .map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.itemName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Label>เลขที่เอกสารใบเซอร์</Label>
              <Input value={newCertNo} onChange={(e) => setNewCertNo(e.target.value)} placeholder="เช่น CERT-00123" />
              <Label>วันที่ออกเอกสาร</Label>
              <DatePickerThaiBE
                className="h-10"
                value={htmlDateValueToTimestampMs(newCertIssueDate)}
                onChange={(ms) => setNewCertIssueDate(timestampToHtmlDateValue(ms))}
              />
              <Label>วันหมดอายุ</Label>
              <DatePickerThaiBE
                className="h-10"
                value={htmlDateValueToTimestampMs(newCertExpiryDate)}
                disabled={!selectedTemplate?.hasExpiry}
                onChange={(ms) => setNewCertExpiryDate(timestampToHtmlDateValue(ms))}
              />
              <div className="space-y-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3">
                <Label className="flex items-center gap-2">
                  <Camera className="h-4 w-4" /> แนบรูปถ่ายใบเซอร์
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
                  {certFormPreviewUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-destructive"
                      onClick={removeAttachmentPreview}
                    >
                      <X className="h-3 w-3 mr-1" /> {editingCertId && !certFormFile ? 'ลบไฟล์แนบ' : 'ลบรูป'}
                    </Button>
                  )}
                </div>
                {certFormRemoveAttachment && !certFormPreviewUrl && (
                  <p className="text-[10px] text-amber-700">จะลบไฟล์แนบเดิมเมื่อกดบันทึก</p>
                )}
                {certFormPreviewUrl && (
                  <a href={certFormPreviewUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={certFormPreviewUrl} alt="ตัวอย่างรูปแนบ" className="h-20 w-20 rounded border object-cover" />
                  </a>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCertDialogOpen(false)} disabled={certSaving}>
                ยกเลิก
              </Button>
              <Button onClick={() => void handleSaveCert()} disabled={certSaving}>
                {certSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {editingCertId ? 'บันทึกการแก้ไข' : 'บันทึก'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
