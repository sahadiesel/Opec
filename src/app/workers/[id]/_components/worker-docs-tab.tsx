'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue, formatOptionalDateThaiBE } from '@/lib/date-thai';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Trash2, FileSearch, Pencil, Camera, Loader2, X, FileImage } from 'lucide-react';
import { deleteField, doc, type Firestore, type CollectionReference } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { useFirebaseApp } from '@/firebase';
import { uploadWorkerDocumentPhoto } from '@/lib/storage/worker-document-photos';
import type { WorkerDocument, WorkerDocumentCatalogItem } from '@/lib/types';

interface WorkerDocsTabProps {
  workerId: string;
  firestore: Firestore | null;
  workerDocs: WorkerDocument[] | null;
  docsQuery: CollectionReference | null;
  workerDocCatalog: WorkerDocumentCatalogItem[] | null;
  canEdit?: boolean;
}

function documentTypeLabel(doc: WorkerDocument, catalog: WorkerDocumentCatalogItem[] | null): string {
  const hit = (catalog || []).find(
    (x) => (x.itemCode || '').toLowerCase() === (doc.documentType || '').toLowerCase(),
  );
  return hit?.itemName || doc.documentType.replace(/_/g, ' ');
}

export function WorkerDocsTab({ workerId, firestore, workerDocs, docsQuery, workerDocCatalog, canEdit = false }: WorkerDocsTabProps) {
  const { toast } = useToast();
  const firebaseApp = useFirebaseApp();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [newDocTemplateId, setNewDocTemplateId] = useState('');
  const [newDocNo, setNewDocNo] = useState('');
  const [newDocIssueDate, setNewDocIssueDate] = useState('');
  const [newDocExpiryDate, setNewDocExpiryDate] = useState('');
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [docFormFile, setDocFormFile] = useState<File | null>(null);
  const [docFormPreviewUrl, setDocFormPreviewUrl] = useState<string | null>(null);
  const [docFormRemoveAttachment, setDocFormRemoveAttachment] = useState(false);
  const [docSaving, setDocSaving] = useState(false);

  const selectedTemplate = (workerDocCatalog || []).find((x) => x.id === newDocTemplateId);

  const clearPhotoPreview = () => {
    if (docFormPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(docFormPreviewUrl);
    }
    setDocFormPreviewUrl(null);
    setDocFormFile(null);
    setDocFormRemoveAttachment(false);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const resetDocForm = () => {
    clearPhotoPreview();
    setEditingDocId(null);
    setNewDocTemplateId('');
    setNewDocNo('');
    setNewDocIssueDate('');
    setNewDocExpiryDate('');
  };

  const populateFormFromDoc = (row: WorkerDocument) => {
    clearPhotoPreview();
    setEditingDocId(row.id);
    const template = (workerDocCatalog || []).find(
      (x) => (x.itemCode || '').toLowerCase() === (row.documentType || '').toLowerCase(),
    );
    setNewDocTemplateId(template?.id || '');
    setNewDocNo(row.documentNo || '');
    setNewDocIssueDate(row.issueDate ? timestampToHtmlDateValue(row.issueDate) : '');
    setNewDocExpiryDate(row.expiryDate ? timestampToHtmlDateValue(row.expiryDate) : '');
    if (row.attachment?.downloadUrl) {
      setDocFormPreviewUrl(row.attachment.downloadUrl);
    }
  };

  useEffect(() => {
    if (!docDialogOpen) {
      clearPhotoPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when dialog closes
  }, [docDialogOpen]);

  const openAddDocDialog = () => {
    resetDocForm();
    setDocDialogOpen(true);
  };

  const openEditDocDialog = (row: WorkerDocument) => {
    populateFormFromDoc(row);
    setDocDialogOpen(true);
  };

  const removeAttachmentPreview = () => {
    if (docFormPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(docFormPreviewUrl);
    }
    setDocFormPreviewUrl(null);
    setDocFormFile(null);
    setDocFormRemoveAttachment(true);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const onPhotoPick = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'รองรับเฉพาะรูปภาพ', description: 'เลือกไฟล์ JPEG, PNG หรือ WebP' });
      return;
    }
    if (docFormPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(docFormPreviewUrl);
    }
    setDocFormFile(file);
    setDocFormRemoveAttachment(false);
    setDocFormPreviewUrl(URL.createObjectURL(file));
  };

  const handleSaveDoc = async () => {
    const selected = (workerDocCatalog || []).find((x) => x.id === newDocTemplateId);
    if (!selected || !firestore) return;
    if (!editingDocId && !docsQuery) return;
    if (!newDocNo.trim()) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'กรุณากรอกเลขที่เอกสาร' });
      return;
    }
    if (selected.hasExpiry && !newDocExpiryDate) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'เอกสารนี้ต้องระบุวันหมดอายุ' });
      return;
    }
    const duplicateDoc = (workerDocs || []).find(
      (d) =>
        (d.documentType || '').toLowerCase() === (selected.itemCode || '').toLowerCase() &&
        d.id !== editingDocId,
    );
    if (duplicateDoc && !editingDocId) {
      const shouldEdit = confirm('มีเอกสารรายการนี้อยู่แล้ว ต้องการแก้ไขรายการเดิมใช่ไหม?');
      if (!shouldEdit) return;
      populateFormFromDoc(duplicateDoc);
      toast({ title: 'เข้าสู่โหมดแก้ไข', description: 'ปรับข้อมูลและกดบันทึกอีกครั้งเพื่ออัปเดตรายการเดิม' });
      return;
    }

    setDocSaving(true);
    try {
      let attachment = undefined as WorkerDocument['attachment'];
      if (docFormFile) {
        attachment = await uploadWorkerDocumentPhoto(firebaseApp, workerId, selected.itemCode, docFormFile);
      }

      const now = Date.now();
      const issueDate = newDocIssueDate ? new Date(newDocIssueDate).getTime() : now;
      const expiryDate = selected.hasExpiry
        ? (newDocExpiryDate ? new Date(newDocExpiryDate).getTime() : 0)
        : 0;

      const payload: Record<string, unknown> = {
        documentType: selected.itemCode,
        documentNo: newDocNo.trim(),
        issueDate,
        expiryDate,
      };

      if (attachment) {
        payload.attachment = attachment;
      } else if (editingDocId && docFormRemoveAttachment) {
        payload.attachment = deleteField();
      }

      if (editingDocId) {
        updateDocumentNonBlocking(doc(firestore, 'workers', workerId, 'documents', editingDocId), payload);
      } else {
        addDocumentNonBlocking(docsQuery!, payload);
      }

      const wasEdit = !!editingDocId;
      setDocDialogOpen(false);
      resetDocForm();
      toast({ title: wasEdit ? 'อัปเดตเอกสารแล้ว' : 'บันทึกเอกสารแล้ว' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: message });
    } finally {
      setDocSaving(false);
    }
  };

  const colClass = canEdit ? 'w-1/5' : 'w-1/4';
  const colCount = canEdit ? 5 : 4;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2 text-primary">
            <FileSearch className="h-5 w-5" /> เอกสารอื่น ๆ (Identity & Documents)
          </CardTitle>
          <CardDescription>จัดเก็บสำเนาบัตรประชาชน พาสปอร์ต ทะเบียนบ้าน หรือสัญญาจ้างงาน</CardDescription>
        </div>
        {canEdit ? (
          <Button className="bg-primary font-bold shadow-md shrink-0" onClick={openAddDocDialog}>
            <Plus className="h-4 w-4 mr-2" /> เพิ่มเอกสาร (Add Doc)
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table className="table-fixed w-full">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className={`${colClass} pl-6 font-bold`}>ประเภทเอกสาร (Type)</TableHead>
              <TableHead className={`${colClass} font-bold`}>เลขที่เอกสาร (Doc No.)</TableHead>
              <TableHead className={`${colClass} font-bold`}>วันหมดอายุ (Expiry)</TableHead>
              <TableHead className={`${colClass} font-bold text-center text-blue-700`}>เอกสารแนบ</TableHead>
              {canEdit ? <TableHead className={`${colClass} text-center pr-6 font-bold`}>จัดการ</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {workerDocs?.map((d) => {
              const thumbUrl = d.attachment?.downloadUrl;
              return (
                <TableRow key={d.id}>
                  <TableCell className={`${colClass} pl-6 font-bold text-primary align-top break-words capitalize`}>
                    {documentTypeLabel(d, workerDocCatalog)}
                  </TableCell>
                  <TableCell className={`${colClass} font-mono text-xs align-top break-all`}>{d.documentNo || '—'}</TableCell>
                  <TableCell className={`${colClass} text-xs align-top`}>
                    {d.expiryDate > 0 ? formatOptionalDateThaiBE(d.expiryDate, '—') : '—'}
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
                          onClick={() => openEditDocDialog(d)}
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
                              deleteDocumentNonBlocking(doc(firestore, 'workers', workerId, 'documents', d.id));
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
            {workerDocs?.length === 0 && (
              <TableRow>
                <TableCell colSpan={colCount} className="py-20 text-center text-muted-foreground italic">
                  ไม่พบเอกสารในระบบ
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Dialog
          open={docDialogOpen}
          onOpenChange={(open) => {
            setDocDialogOpen(open);
            if (!open) resetDocForm();
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingDocId ? 'แก้ไขเอกสาร' : 'เพิ่มเอกสารจากรายการกลาง'}</DialogTitle>
              <DialogDescription>
                {editingDocId
                  ? 'แก้ไขข้อมูลเอกสารหรือไฟล์แนบ — ลบรูปเดิมแล้วเลือกไฟล์ใหม่ได้'
                  : 'เลือกเฉพาะรายการประเภท Document จากเมนูรายการเอกสารกลาง'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label>รายการเอกสาร</Label>
              <Select value={newDocTemplateId} onValueChange={setNewDocTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือกเอกสาร..." />
                </SelectTrigger>
                <SelectContent>
                  {(workerDocCatalog || [])
                    .filter((x) => x.active !== false && x.requirementType === 'document')
                    .map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.itemName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Label>เลขที่เอกสาร</Label>
              <Input value={newDocNo} onChange={(e) => setNewDocNo(e.target.value)} placeholder="เช่น P1234567 / SB77889" />
              <Label>วันที่ออกเอกสาร</Label>
              <DatePickerThaiBE
                className="h-10"
                value={htmlDateValueToTimestampMs(newDocIssueDate)}
                onChange={(ms) => setNewDocIssueDate(timestampToHtmlDateValue(ms))}
              />
              <Label>วันหมดอายุ</Label>
              <DatePickerThaiBE
                className="h-10"
                value={htmlDateValueToTimestampMs(newDocExpiryDate)}
                disabled={!selectedTemplate?.hasExpiry}
                onChange={(ms) => setNewDocExpiryDate(timestampToHtmlDateValue(ms))}
              />
              <div className="space-y-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3">
                <Label className="flex items-center gap-2">
                  <Camera className="h-4 w-4" /> แนบรูปถ่ายเอกสาร
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
                  {docFormPreviewUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-destructive"
                      onClick={removeAttachmentPreview}
                    >
                      <X className="h-3 w-3 mr-1" /> {editingDocId && !docFormFile ? 'ลบไฟล์แนบ' : 'ลบรูป'}
                    </Button>
                  )}
                </div>
                {docFormRemoveAttachment && !docFormPreviewUrl && (
                  <p className="text-[10px] text-amber-700">จะลบไฟล์แนบเดิมเมื่อกดบันทึก</p>
                )}
                {docFormPreviewUrl && (
                  <a href={docFormPreviewUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={docFormPreviewUrl} alt="ตัวอย่างรูปแนบ" className="h-20 w-20 rounded border object-cover" />
                  </a>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDocDialogOpen(false)} disabled={docSaving}>
                ยกเลิก
              </Button>
              <Button onClick={() => void handleSaveDoc()} disabled={docSaving}>
                {docSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {editingDocId ? 'บันทึกการแก้ไข' : 'บันทึก'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
