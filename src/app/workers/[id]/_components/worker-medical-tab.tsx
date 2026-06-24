'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue, formatDateThaiBE } from '@/lib/date-thai';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Trash2, Stethoscope, Pencil, Camera, Loader2, X, FileText, FileImage } from 'lucide-react';
import { deleteField, doc, type Firestore, type CollectionReference } from 'firebase/firestore';
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { useFirebaseApp } from '@/firebase';
import { uploadWorkerMedicalPhoto } from '@/lib/storage/worker-medical-photos';
import { isPdfAttachment, isPdfFile } from '@/lib/storage/worker-credential-attachment';
import type { WorkerMedicalRecord, WaveMonthTimesheetPhotoAttachment } from '@/lib/types';

interface WorkerMedicalTabProps {
  workerId: string;
  firestore: Firestore | null;
  medicals: WorkerMedicalRecord[] | null;
  medicalsQuery: CollectionReference | null;
  canEdit?: boolean;
}

export function WorkerMedicalTab({ workerId, firestore, medicals, medicalsQuery, canEdit = false }: WorkerMedicalTabProps) {
  const { toast } = useToast();
  const firebaseApp = useFirebaseApp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMedicalId, setEditingMedicalId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [medicalType, setMedicalType] = useState('General Health Exam');
  const [examDate, setExamDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [fitStatus, setFitStatus] = useState<'fit' | 'unfit' | 'conditional'>('fit');
  const [hospital, setHospital] = useState('');

  const [formFile, setFormFile] = useState<File | null>(null);
  const [formPreviewUrl, setFormPreviewUrl] = useState<string | null>(null);
  const [formPreviewIsPdf, setFormPreviewIsPdf] = useState(false);
  const [formRemoveAttachment, setFormRemoveAttachment] = useState(false);

  const clearAttachmentPreview = () => {
    if (formPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(formPreviewUrl);
    }
    setFormPreviewUrl(null);
    setFormFile(null);
    setFormRemoveAttachment(false);
    setFormPreviewIsPdf(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const resetForm = () => {
    clearAttachmentPreview();
    setEditingMedicalId(null);
    setMedicalType('General Health Exam');
    setExamDate('');
    setExpiryDate('');
    setFitStatus('fit');
    setHospital('');
  };

  const populateFormFromRow = (row: WorkerMedicalRecord) => {
    clearAttachmentPreview();
    setEditingMedicalId(row.id);
    setMedicalType(row.medicalType || 'General Health Exam');
    setExamDate(row.examDate ? timestampToHtmlDateValue(row.examDate) : '');
    setExpiryDate(row.expiryDate ? timestampToHtmlDateValue(row.expiryDate) : '');
    setFitStatus(row.fitStatus || 'fit');
    setHospital(row.hospitalOrClinic || '');
    if (row.attachment?.downloadUrl) {
      setFormPreviewUrl(row.attachment.downloadUrl);
      setFormPreviewIsPdf(isPdfAttachment(row.attachment));
    }
  };

  useEffect(() => {
    if (!dialogOpen) clearAttachmentPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen]);

  const openAddDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (row: WorkerMedicalRecord) => {
    populateFormFromRow(row);
    setDialogOpen(true);
  };

  const removeAttachmentPreview = () => {
    if (formPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(formPreviewUrl);
    }
    setFormPreviewUrl(null);
    setFormFile(null);
    setFormRemoveAttachment(true);
    setFormPreviewIsPdf(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
    if (formPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(formPreviewUrl);
    }
    setFormFile(file);
    setFormRemoveAttachment(false);
    setFormPreviewIsPdf(pdf);
    setFormPreviewUrl(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    if (!firestore) return;
    if (!editingMedicalId && !medicalsQuery) return;
    if (!medicalType.trim() || !examDate || !expiryDate) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'กรุณาระบุประเภท วันที่ตรวจ และวันหมดอายุ' });
      return;
    }

    setSaving(true);
    try {
      let attachment: WaveMonthTimesheetPhotoAttachment | undefined;
      if (formFile) {
        attachment = await uploadWorkerMedicalPhoto(firebaseApp, workerId, medicalType.trim(), formFile);
      }

      const payload: Record<string, unknown> = {
        medicalType: medicalType.trim(),
        examDate: new Date(examDate).getTime(),
        expiryDate: new Date(expiryDate).getTime(),
        fitStatus,
        hospitalOrClinic: hospital.trim(),
      };

      if (editingMedicalId) {
        if (attachment) {
          payload.attachment = attachment;
        } else if (formRemoveAttachment) {
          payload.attachment = deleteField();
        }
        updateDocumentNonBlocking(doc(firestore, 'workers', workerId, 'medical_records', editingMedicalId), payload);
      } else {
        if (attachment) payload.attachment = attachment;
        addDocumentNonBlocking(medicalsQuery!, payload);
      }

      const wasEdit = !!editingMedicalId;
      setDialogOpen(false);
      resetForm();
      toast({ title: wasEdit ? 'อัปเดตแล้ว' : 'บันทึกแล้ว' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2 text-primary">
            <Stethoscope className="h-5 w-5" /> ผลการตรวจร่างกาย (Medical Records)
          </CardTitle>
          <CardDescription>ข้อมูลความพร้อมทางร่างกายตามเกณฑ์มาตรฐานงาน Offshore</CardDescription>
        </div>
        {canEdit ? (
          <Button className="bg-primary font-bold shadow-md shrink-0" onClick={openAddDialog}>
            <Plus className="h-4 w-4 mr-2" /> เพิ่มผลตรวจ (Add Medical)
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="pl-6 font-bold">ประเภทการตรวจ (Type)</TableHead>
              <TableHead className="font-bold">วันที่ตรวจ (Exam Date)</TableHead>
              <TableHead className="font-bold">วันหมดอายุ (Expiry)</TableHead>
              <TableHead className="font-bold">ผลการตรวจ (Result)</TableHead>
              <TableHead className="font-bold text-center text-blue-700">เอกสารแนบ</TableHead>
              {canEdit ? <TableHead className="text-center pr-6 font-bold">จัดการ</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {medicals?.map((m) => {
              const thumbUrl = m.attachment?.downloadUrl;
              return (
                <TableRow key={m.id}>
                  <TableCell className="pl-6 font-medium text-primary">{m.medicalType}</TableCell>
                  <TableCell className="text-xs">{formatDateThaiBE(m.examDate)}</TableCell>
                  <TableCell className={m.expiryDate < Date.now() ? 'text-destructive font-black' : 'font-medium'}>
                    {formatDateThaiBE(m.expiryDate)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={m.fitStatus === 'fit' ? 'default' : 'destructive'}
                      className={m.fitStatus === 'fit' ? 'bg-green-600' : ''}
                    >
                      {m.fitStatus.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center align-top">
                    {thumbUrl ? (
                      isPdfAttachment(m.attachment) ? (
                        <a
                          href={thumbUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex flex-col items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-red-800 hover:bg-red-100"
                          title="เปิด PDF"
                        >
                          <FileText className="h-8 w-8" />
                          <span className="text-[10px] font-semibold">PDF</span>
                        </a>
                      ) : (
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
                      )
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
                          className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10"
                          title="แก้ไขรายการ"
                          onClick={() => openEditDialog(m)}
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
                              deleteDocumentNonBlocking(doc(firestore, 'workers', workerId, 'medical_records', m.id));
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
            {medicals?.length === 0 && (
              <TableRow>
                <TableCell colSpan={canEdit ? 6 : 5} className="py-20 text-center text-muted-foreground italic">
                  ไม่พบประวัติการตรวจร่างกาย
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
          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingMedicalId ? 'แก้ไขผลตรวจร่างกาย' : 'บันทึกผลตรวจร่างกาย'}</DialogTitle>
              <DialogDescription>
                {editingMedicalId
                  ? 'แก้ไขข้อมูลหรือไฟล์แนบ — ลบไฟล์เดิมแล้วเลือกใหม่ได้'
                  : 'กรอกข้อมูลผลตรวจให้ครบก่อนบันทึก'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label>ประเภทการตรวจ</Label>
                <Input value={medicalType} onChange={(e) => setMedicalType(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>วันที่ตรวจ</Label>
                <DatePickerThaiBE
                  className="h-10"
                  value={htmlDateValueToTimestampMs(examDate)}
                  onChange={(ms) => setExamDate(timestampToHtmlDateValue(ms))}
                />
              </div>
              <div className="space-y-2">
                <Label>วันหมดอายุ</Label>
                <DatePickerThaiBE
                  className="h-10"
                  value={htmlDateValueToTimestampMs(expiryDate)}
                  onChange={(ms) => setExpiryDate(timestampToHtmlDateValue(ms))}
                />
              </div>
              <div className="space-y-2">
                <Label>ผลการตรวจ</Label>
                <Select value={fitStatus} onValueChange={(v) => setFitStatus(v as 'fit' | 'unfit' | 'conditional')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fit">FIT</SelectItem>
                    <SelectItem value="unfit">UNFIT</SelectItem>
                    <SelectItem value="conditional">CONDITIONAL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>สถานพยาบาล</Label>
                <Input value={hospital} onChange={(e) => setHospital(e.target.value)} />
              </div>
              <div className="space-y-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3">
                <Label className="flex items-center gap-2">
                  <Camera className="h-4 w-4" /> แนบไฟล์ (รูปหรือ PDF)
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  รูป: JPEG/PNG/WebP (บีบอัดไม่เกิน 500 KB) · PDF: สูงสุด 10 MB
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf,.pdf"
                    capture="environment"
                    className="max-w-[14rem] text-xs"
                    onChange={(e) => onAttachmentPick(e.target.files?.[0] ?? null)}
                  />
                  {formPreviewUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-destructive"
                      onClick={removeAttachmentPreview}
                    >
                      <X className="h-3 w-3 mr-1" /> {editingMedicalId && !formFile ? 'ลบไฟล์แนบ' : 'ลบไฟล์'}
                    </Button>
                  ) : null}
                </div>
                {formRemoveAttachment && !formPreviewUrl ? (
                  <p className="text-[10px] text-amber-700">จะลบไฟล์แนบเดิมเมื่อกดบันทึก</p>
                ) : null}
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
                {editingMedicalId ? 'บันทึกการแก้ไข' : 'บันทึก'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
