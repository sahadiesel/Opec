'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue, formatOptionalDateThaiBE, formatDateThaiBE } from '@/lib/date-thai';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Trash2, Pencil, AlertCircle, Camera, Loader2, X } from 'lucide-react';
import { addDoc, doc, deleteField, type Firestore, type CollectionReference } from 'firebase/firestore';
import { deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { useFirebaseApp } from '@/firebase';
import { displayLocation, sortDrugTestsNewestFirst, computeDrugTestRowValidityStatus, drugTestRowValidityLabelTh } from '@/lib/drug-test-panel';
import { thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';
import { uploadWorkerDrugTestPhoto } from '@/lib/storage/worker-drug-test-photos';
import Link from 'next/link';
import type {
  WorkerDrugTest,
  DrugTestPanelSubstance,
  DrugTestLocationType,
  DrugTestResult,
  WaveMonthTimesheetPhotoAttachment,
} from '@/lib/types';

interface WorkerDrugTabProps {
  workerId: string;
  firestore: Firestore | null;
  drugTests: WorkerDrugTest[] | null;
  drugTestsQuery: CollectionReference | null;
  panelSubstances: DrugTestPanelSubstance[];
  canEdit?: boolean;
}

export function WorkerDrugTab({ workerId, firestore, drugTests, drugTestsQuery, panelSubstances, canEdit = false }: WorkerDrugTabProps) {
  const { toast } = useToast();
  const firebaseApp = useFirebaseApp();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [drugDialogOpen, setDrugDialogOpen] = useState(false);
  const [drugFormSubstanceKey, setDrugFormSubstanceKey] = useState('');
  const [drugFormDate, setDrugFormDate] = useState('');
  const [drugFormLocType, setDrugFormLocType] = useState<DrugTestLocationType>('OPEC');
  const [drugFormLocOther, setDrugFormLocOther] = useState('');
  const [drugFormResult, setDrugFormResult] = useState<DrugTestResult>('none');
  const [drugFormFile, setDrugFormFile] = useState<File | null>(null);
  const [drugFormPreviewUrl, setDrugFormPreviewUrl] = useState<string | null>(null);
  const [drugFormRemoveAttachment, setDrugFormRemoveAttachment] = useState(false);
  const [editingDrugId, setEditingDrugId] = useState<string | null>(null);
  const [drugSaving, setDrugSaving] = useState(false);

  const sortedRecords = useMemo(() => sortDrugTestsNewestFirst(drugTests || []), [drugTests]);

  const substanceLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of panelSubstances) map.set(s.id, s.label);
    return map;
  }, [panelSubstances]);

  const clearPhotoPreview = () => {
    if (drugFormPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(drugFormPreviewUrl);
    }
    setDrugFormPreviewUrl(null);
    setDrugFormFile(null);
    setDrugFormRemoveAttachment(false);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const resetDrugForm = () => {
    clearPhotoPreview();
    setEditingDrugId(null);
    setDrugFormSubstanceKey(panelSubstances[0]?.id || '');
    setDrugFormDate('');
    setDrugFormLocType('OPEC');
    setDrugFormLocOther('');
    setDrugFormResult('none');
  };

  const populateFormFromRow = (row: WorkerDrugTest) => {
    clearPhotoPreview();
    setEditingDrugId(row.id);
    setDrugFormSubstanceKey(row.substanceKey || panelSubstances[0]?.id || '');
    setDrugFormDate(row.testDate ? timestampToHtmlDateValue(row.testDate) : '');
    setDrugFormLocType(row.testLocationType || 'OPEC');
    setDrugFormLocOther(row.testLocationOther || '');
    setDrugFormResult(row.result || 'none');
    if (row.attachment?.downloadUrl) {
      setDrugFormPreviewUrl(row.attachment.downloadUrl);
    }
  };

  useEffect(() => {
    if (!drugDialogOpen) {
      clearPhotoPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when dialog closes
  }, [drugDialogOpen]);

  const openAddDrugDialog = () => {
    resetDrugForm();
    setDrugDialogOpen(true);
  };

  const openEditDrugDialog = (row: WorkerDrugTest) => {
    populateFormFromRow(row);
    setDrugDialogOpen(true);
  };

  const removeAttachmentPreview = () => {
    if (drugFormPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(drugFormPreviewUrl);
    }
    setDrugFormPreviewUrl(null);
    setDrugFormFile(null);
    setDrugFormRemoveAttachment(true);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const onPhotoPick = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'รองรับเฉพาะรูปภาพ', description: 'เลือกไฟล์ JPEG, PNG หรือ WebP' });
      return;
    }
    if (drugFormPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(drugFormPreviewUrl);
    }
    setDrugFormFile(file);
    setDrugFormRemoveAttachment(false);
    setDrugFormPreviewUrl(URL.createObjectURL(file));
  };

  const handleSaveDrug = async () => {
    if (!firestore) return;
    if (!editingDrugId && !drugTestsQuery) return;
    const substance = panelSubstances.find((s) => s.id === drugFormSubstanceKey);
    if (!substance) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'เลือกอุปกรณ์การตรวจ' });
      return;
    }
    if (drugFormResult !== 'none' && !drugFormDate.trim()) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'ถ้ามีผลตรวจแล้ว ต้องระบุวันที่ตรวจ' });
      return;
    }
    if (drugFormLocType === 'OTHER' && !drugFormLocOther.trim()) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'เลือกอื่นๆ ต้องระบุสถานที่' });
      return;
    }

    setDrugSaving(true);
    try {
      let attachment: WaveMonthTimesheetPhotoAttachment | undefined;
      if (drugFormFile) {
        attachment = await uploadWorkerDrugTestPhoto(firebaseApp, workerId, substance.id, drugFormFile);
      }

      const payload: Record<string, unknown> = {
        substanceKey: substance.id,
        substanceLabelSnapshot: substance.label,
        testDate: drugFormResult === 'none' || !drugFormDate.trim() ? null : new Date(drugFormDate).getTime(),
        testLocationType: drugFormLocType,
        testLocationOther: drugFormLocType === 'OTHER' ? drugFormLocOther.trim() : '',
        result: drugFormResult,
      };

      if (editingDrugId) {
        if (attachment) {
          payload.attachment = attachment;
        } else if (drugFormRemoveAttachment) {
          payload.attachment = deleteField();
        }
        updateDocumentNonBlocking(doc(firestore, 'workers', workerId, 'drug_tests', editingDrugId), payload);
      } else {
        payload.createdAt = Date.now();
        if (attachment) payload.attachment = attachment;
        await addDoc(drugTestsQuery!, payload);
      }

      const wasEdit = !!editingDrugId;
      setDrugDialogOpen(false);
      resetDrugForm();
      toast({ title: wasEdit ? 'อัปเดตแล้ว' : 'บันทึกแล้ว' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: message });
    } finally {
      setDrugSaving(false);
    }
  };

  const equipmentLabel = (row: WorkerDrugTest) =>
    row.substanceLabelSnapshot || substanceLabelById.get(row.substanceKey || '') || row.substanceKey || '—';

  return (
    <Card>
      <CardHeader className="border-b bg-primary/5 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2 text-primary">
              <AlertCircle className="h-5 w-5" /> ผลตรวจสารเสพติด
            </CardTitle>
            <CardDescription className="mt-1">
              รายการอุปกรณ์การตรวจมาจากการตั้งค่าในเมนูจัดการระบบ — บันทึกล่าสุดอยู่บนสุด
            </CardDescription>
          </div>
          {canEdit && panelSubstances.length > 0 && (
            <Button size="sm" className="font-bold shrink-0" onClick={openAddDrugDialog}>
              <Plus className="h-4 w-4 mr-1" /> เพิ่มการตรวจ
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0 pt-4 space-y-6">
        {panelSubstances.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            ยังไม่มีรายการอุปกรณ์ — ผู้ดูแลระบบสามารถตั้งค่าได้ที่{' '}
            <Link href="/system-admin/drug-test-panel" className="text-primary font-bold underline">
              ตั้งค่าแผงตรวจสารเสพติด
            </Link>
          </p>
        ) : sortedRecords.length === 0 ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">
            ยังไม่มีผลตรวจ — กด «เพิ่มการตรวจ» เพื่อบันทึกครั้งแรก
          </p>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-6 font-bold">อุปกรณ์การตรวจ</TableHead>
                <TableHead className="font-bold">วันที่ตรวจ</TableHead>
                <TableHead className="font-bold">สถานที่ตรวจ</TableHead>
                <TableHead className="font-bold">ผลตรวจ</TableHead>
                <TableHead className="font-bold">สถานะ</TableHead>
                <TableHead className="font-bold text-center">เอกสารแนบ</TableHead>
                {canEdit ? <TableHead className="text-right pr-6 font-bold">จัดการ</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRecords.map((row) => {
                const res = row.result;
                const resLabel = res === 'negative' ? 'NEGATIVE' : res === 'positive' ? 'POSITIVE' : 'NONE';
                const validity = computeDrugTestRowValidityStatus(row, thailandTodayYmd());
                const validityLabel = drugTestRowValidityLabelTh(validity);
                const thumbUrl = row.attachment?.downloadUrl;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="pl-6 font-bold text-primary">{equipmentLabel(row)}</TableCell>
                    <TableCell className="text-sm">
                      {row.testDate != null && row.testDate > 0 ? formatDateThaiBE(row.testDate) : '—'}
                    </TableCell>
                    <TableCell className="text-sm">{displayLocation(row)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          res === 'negative'
                            ? 'bg-green-600 text-white border-green-600'
                            : res === 'positive'
                              ? 'bg-destructive text-destructive-foreground'
                              : 'bg-slate-100 text-slate-600'
                        }
                      >
                        {resLabel}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {validity === 'valid' ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-400 font-semibold">
                          Valid
                        </Badge>
                      ) : validity === 'expired' ? (
                        <Badge variant="outline" className="bg-orange-50 text-orange-800 border-orange-400 font-semibold">
                          Expired
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {thumbUrl ? (
                        <a
                          href={thumbUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block rounded border overflow-hidden hover:opacity-90"
                          title="เปิดรูปแนบ"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={thumbUrl} alt="" className="h-10 w-10 object-cover" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {canEdit ? (
                      <TableCell className="text-right pr-6">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-primary"
                            title="แก้ไขรายการ"
                            onClick={() => openEditDrugDialog(row)}
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
                              if (confirm('ลบรายการผลตรวจนี้?'))
                                deleteDocumentNonBlocking(doc(firestore, 'workers', workerId, 'drug_tests', row.id));
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
            </TableBody>
          </Table>
        )}

        {(drugTests || []).some((d) => !d.substanceKey) && (
          <div className="px-6 pb-4">
            <p className="text-xs font-bold text-muted-foreground mb-2">ประวัติแบบเก่า (ก่อนปรับระบบ)</p>
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6 font-bold">วันที่ตรวจ</TableHead>
                  <TableHead className="font-bold">สถานที่</TableHead>
                  <TableHead className="font-bold">ผล</TableHead>
                  <TableHead className="text-right pr-6">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(drugTests || [])
                  .filter((d) => !d.substanceKey)
                  .map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="pl-6">
                        {d.testDate != null && d.testDate > 0 ? formatOptionalDateThaiBE(d.testDate, '—') : '—'}
                      </TableCell>
                      <TableCell className="text-xs">{d.laboratory || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={d.result === 'negative' ? 'default' : 'destructive'}>
                          {(d.result || '').toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        {canEdit ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive h-8 w-8"
                            onClick={() => {
                              if (!firestore) return;
                              if (confirm('ลบรายการ?'))
                                deleteDocumentNonBlocking(doc(firestore, 'workers', workerId, 'drug_tests', d.id));
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog
          open={drugDialogOpen}
          onOpenChange={(open) => {
            setDrugDialogOpen(open);
            if (!open) resetDrugForm();
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingDrugId ? 'แก้ไขผลตรวจ' : 'บันทึกผลตรวจ'}</DialogTitle>
              <DialogDescription>
                {editingDrugId
                  ? 'แก้ไขวันที่ สถานที่ ผลตรวจ หรือไฟล์แนบ — ลบรูปเดิมแล้วเลือกไฟล์ใหม่ได้'
                  : 'ผลเริ่มต้น NONE = ยังไม่ได้ตรวจ — สถานที่เริ่มต้น OPEC'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label>อุปกรณ์การตรวจ</Label>
                <Select value={drugFormSubstanceKey} onValueChange={setDrugFormSubstanceKey}>
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกอุปกรณ์" />
                  </SelectTrigger>
                  <SelectContent>
                    {panelSubstances.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>วันที่ตรวจ</Label>
                <DatePickerThaiBE
                  className="h-10"
                  value={htmlDateValueToTimestampMs(drugFormDate)}
                  onChange={(ms) => setDrugFormDate(timestampToHtmlDateValue(ms))}
                  disabled={drugFormResult === 'none'}
                />
                <p className="text-[10px] text-muted-foreground">ถ้าเลือกผลเป็น NONE ไม่บังคับวันที่</p>
              </div>
              <div className="space-y-2">
                <Label>สถานที่ตรวจ</Label>
                <Select value={drugFormLocType} onValueChange={(v) => setDrugFormLocType(v as DrugTestLocationType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEC">OPEC</SelectItem>
                    <SelectItem value="OTHER">อื่นๆ</SelectItem>
                  </SelectContent>
                </Select>
                {drugFormLocType === 'OTHER' && (
                  <Input placeholder="ระบุสถานที่" value={drugFormLocOther} onChange={(e) => setDrugFormLocOther(e.target.value)} />
                )}
              </div>
              <div className="space-y-2">
                <Label>ผลตรวจ</Label>
                <Select value={drugFormResult} onValueChange={(v) => setDrugFormResult(v as DrugTestResult)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">NONE (ไม่ได้ตรวจ)</SelectItem>
                    <SelectItem value="negative">NEGATIVE</SelectItem>
                    <SelectItem value="positive">POSITIVE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
                  {drugFormPreviewUrl && (
                    <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive" onClick={removeAttachmentPreview}>
                      <X className="h-3 w-3 mr-1" /> {editingDrugId && !drugFormFile ? 'ลบไฟล์แนบ' : 'ลบรูป'}
                    </Button>
                  )}
                </div>
                {drugFormRemoveAttachment && !drugFormPreviewUrl && (
                  <p className="text-[10px] text-amber-700">จะลบไฟล์แนบเดิมเมื่อกดบันทึก</p>
                )}
                {drugFormPreviewUrl && (
                  <a href={drugFormPreviewUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={drugFormPreviewUrl} alt="ตัวอย่างรูปแนบ" className="h-20 w-20 rounded border object-cover" />
                  </a>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDrugDialogOpen(false)} disabled={drugSaving}>
                ยกเลิก
              </Button>
              <Button onClick={() => void handleSaveDrug()} disabled={drugSaving}>
                {drugSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {editingDrugId ? 'บันทึกการแก้ไข' : 'บันทึก'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
