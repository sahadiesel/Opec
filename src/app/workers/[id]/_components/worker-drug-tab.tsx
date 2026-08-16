'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import {
  htmlDateValueToTimestampMs,
  timestampToHtmlDateValue,
  formatOptionalDateThaiBE,
  formatDateThaiBE,
  formatDateTimeThaiBE,
} from '@/lib/date-thai';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Trash2, Pencil, AlertCircle, Camera, Loader2, X, FileText, Eye } from 'lucide-react';
import { addDoc, doc, deleteField, type Firestore, type CollectionReference } from 'firebase/firestore';
import { deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { useFirebaseApp } from '@/firebase';
import {
  displayLocation,
  sortDrugTestsNewestFirst,
  computeDrugTestRecordValidityStatus,
  drugTestRowValidityLabelTh,
  kitResultsForDisplay,
  listWorkerDrugTestAttachments,
  formatDrugTestBloodPressure,
} from '@/lib/drug-test-panel';
import { thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';
import { MAX_WORKER_DRUG_TEST_ATTACHMENTS, uploadWorkerDrugTestPhoto } from '@/lib/storage/worker-drug-test-photos';
import { isPdfAttachment, isPdfFile, validateWorkerCredentialAttachmentFile } from '@/lib/storage/worker-credential-attachment';
import Link from 'next/link';
import type {
  WorkerDrugTest,
  DrugTestPanelSubstance,
  DrugTestLocationType,
  DrugTestResult,
  DrugTestScreeningConclusion,
  WaveMonthTimesheetPhotoAttachment,
  User,
} from '@/lib/types';

interface WorkerDrugTabProps {
  workerId: string;
  firestore: Firestore | null;
  drugTests: WorkerDrugTest[] | null;
  drugTestsQuery: CollectionReference | null;
  panelSubstances: DrugTestPanelSubstance[];
  canEdit?: boolean;
  currentUser?: User | null;
}

type KitResultMap = Record<string, DrugTestResult>;

function resultBadgeClass(res: DrugTestResult | undefined): string {
  if (res === 'negative') return 'bg-green-600 text-white border-green-600';
  if (res === 'positive') return 'bg-destructive text-destructive-foreground';
  return 'bg-slate-100 text-slate-600';
}

function resultLabel(res: DrugTestResult | undefined): string {
  if (res === 'negative') return 'NEGATIVE';
  if (res === 'positive') return 'POSITIVE';
  return 'NONE';
}

function suggestConclusion(selectedResults: DrugTestResult[]): DrugTestScreeningConclusion | '' {
  if (selectedResults.some((r) => r === 'positive')) return 'fail';
  if (selectedResults.length > 0 && selectedResults.every((r) => r === 'negative')) return 'pass';
  return '';
}

function parseOptionalNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function WorkerDrugTab({
  workerId,
  firestore,
  drugTests,
  drugTestsQuery,
  panelSubstances,
  canEdit = false,
  currentUser = null,
}: WorkerDrugTabProps) {
  const { toast } = useToast();
  const firebaseApp = useFirebaseApp();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [drugDialogOpen, setDrugDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'edit' | 'view'>('edit');
  const [selectedKitIds, setSelectedKitIds] = useState<string[]>([]);
  const [kitResultById, setKitResultById] = useState<KitResultMap>({});
  const [drugFormDate, setDrugFormDate] = useState('');
  const [drugFormLocType, setDrugFormLocType] = useState<DrugTestLocationType>('OPEC');
  const [drugFormLocOther, setDrugFormLocOther] = useState('');
  const [bodyTemp, setBodyTemp] = useState('');
  const [bpSys, setBpSys] = useState('');
  const [bpDia, setBpDia] = useState('');
  const [alcohol, setAlcohol] = useState('');
  const [conclusion, setConclusion] = useState<DrugTestScreeningConclusion | ''>('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingPreviewUrls, setPendingPreviewUrls] = useState<string[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<WaveMonthTimesheetPhotoAttachment[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<Set<string>>(() => new Set());
  const [editingDrugId, setEditingDrugId] = useState<string | null>(null);
  const [recordMeta, setRecordMeta] = useState<{ by: string; at: number } | null>(null);
  const [drugSaving, setDrugSaving] = useState(false);

  const sortedRecords = useMemo(() => sortDrugTestsNewestFirst(drugTests || []), [drugTests]);
  const formReadOnly = dialogMode === 'view' || !canEdit;

  const substanceLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of panelSubstances) map.set(s.id, s.label);
    return map;
  }, [panelSubstances]);

  const keptExistingAttachments = useMemo(
    () => existingAttachments.filter((a) => !removedAttachmentIds.has(a.id)),
    [existingAttachments, removedAttachmentIds],
  );
  const attachmentSlotsLeft = MAX_WORKER_DRUG_TEST_ATTACHMENTS - keptExistingAttachments.length - pendingFiles.length;

  const revokePendingPreviews = (urls: string[]) => {
    for (const url of urls) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
  };

  const clearPendingFiles = () => {
    revokePendingPreviews(pendingPreviewUrls);
    setPendingFiles([]);
    setPendingPreviewUrls([]);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const resetDrugForm = () => {
    clearPendingFiles();
    setEditingDrugId(null);
    setDialogMode('edit');
    setSelectedKitIds(panelSubstances.map((s) => s.id));
    const next: KitResultMap = {};
    for (const s of panelSubstances) next[s.id] = 'none';
    setKitResultById(next);
    setDrugFormDate(timestampToHtmlDateValue(Date.now()));
    setDrugFormLocType('OPEC');
    setDrugFormLocOther('');
    setBodyTemp('');
    setBpSys('');
    setBpDia('');
    setAlcohol('');
    setConclusion('');
    setExistingAttachments([]);
    setRemovedAttachmentIds(new Set());
    setRecordMeta(null);
  };

  const populateFormFromRow = (row: WorkerDrugTest, mode: 'edit' | 'view') => {
    clearPendingFiles();
    setEditingDrugId(row.id);
    setDialogMode(mode);
    const kits = kitResultsForDisplay(row);
    const ids = kits.map((k) => k.substanceKey);
    setSelectedKitIds(ids.length ? ids : panelSubstances[0]?.id ? [panelSubstances[0].id] : []);
    const next: KitResultMap = {};
    for (const s of panelSubstances) next[s.id] = 'none';
    for (const k of kits) next[k.substanceKey] = k.result;
    setKitResultById(next);
    setDrugFormDate(row.testDate ? timestampToHtmlDateValue(row.testDate) : '');
    setDrugFormLocType(row.testLocationType || 'OPEC');
    setDrugFormLocOther(row.testLocationOther || '');
    setBodyTemp(row.bodyTemperatureC != null && Number.isFinite(row.bodyTemperatureC) ? String(row.bodyTemperatureC) : '');
    setBpSys(
      row.bloodPressureSystolic != null && Number.isFinite(row.bloodPressureSystolic)
        ? String(row.bloodPressureSystolic)
        : '',
    );
    setBpDia(
      row.bloodPressureDiastolic != null && Number.isFinite(row.bloodPressureDiastolic)
        ? String(row.bloodPressureDiastolic)
        : '',
    );
    setAlcohol(row.alcoholMgPercent != null && Number.isFinite(row.alcoholMgPercent) ? String(row.alcoholMgPercent) : '');
    setConclusion(row.conclusion === 'pass' || row.conclusion === 'fail' ? row.conclusion : '');
    setExistingAttachments(listWorkerDrugTestAttachments(row));
    setRemovedAttachmentIds(new Set());
    const at = row.recordedAt || row.createdAt;
    setRecordMeta(at ? { by: row.recordedByName || '—', at } : null);
  };

  useEffect(() => {
    if (!drugDialogOpen) {
      clearPendingFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when dialog closes
  }, [drugDialogOpen]);

  const openAddDrugDialog = () => {
    resetDrugForm();
    setDrugDialogOpen(true);
  };

  const openEditDrugDialog = (row: WorkerDrugTest) => {
    populateFormFromRow(row, 'edit');
    setDrugDialogOpen(true);
  };

  const openViewDrugDialog = (row: WorkerDrugTest) => {
    populateFormFromRow(row, 'view');
    setDrugDialogOpen(true);
  };

  const toggleKit = (id: string, checked: boolean) => {
    setSelectedKitIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
    if (checked && !kitResultById[id]) {
      setKitResultById((prev) => ({ ...prev, [id]: 'none' }));
    }
  };

  const setKitResult = (id: string, result: DrugTestResult) => {
    setKitResultById((prev) => {
      const next = { ...prev, [id]: result };
      const selectedResults = selectedKitIds.map((kid) => next[kid] || 'none');
      const suggested = suggestConclusion(selectedResults);
      if (suggested) setConclusion(suggested);
      return next;
    });
  };

  const onAttachmentsPick = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const incoming = Array.from(fileList);
    const accepted: File[] = [];
    for (const file of incoming) {
      const err = validateWorkerCredentialAttachmentFile(file);
      if (err) {
        toast({ variant: 'destructive', title: 'ไฟล์ไม่รองรับ', description: `${file.name}: ${err}` });
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) return;
    const room = MAX_WORKER_DRUG_TEST_ATTACHMENTS - keptExistingAttachments.length - pendingFiles.length;
    if (room <= 0) {
      toast({
        variant: 'destructive',
        title: 'แนบครบแล้ว',
        description: `แนบได้ไม่เกิน ${MAX_WORKER_DRUG_TEST_ATTACHMENTS} รูปต่อรอบตรวจ`,
      });
      return;
    }
    const take = accepted.slice(0, room);
    if (accepted.length > room) {
      toast({
        title: `รับได้ ${take.length} ไฟล์`,
        description: `จำกัดไม่เกิน ${MAX_WORKER_DRUG_TEST_ATTACHMENTS} รูปต่อรอบตรวจ`,
      });
    }
    const urls = take.map((f) => URL.createObjectURL(f));
    setPendingFiles((prev) => [...prev, ...take]);
    setPendingPreviewUrls((prev) => [...prev, ...urls]);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const removePendingFile = (index: number) => {
    const url = pendingPreviewUrls[index];
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    setPendingPreviewUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const removeExistingAttachment = (id: string) => {
    setRemovedAttachmentIds((prev) => new Set(prev).add(id));
  };

  const handleSaveDrug = async () => {
    if (!firestore) return;
    if (!editingDrugId && !drugTestsQuery) return;
    if (formReadOnly) return;

    const selectedKits = panelSubstances.filter((s) => selectedKitIds.includes(s.id));
    if (selectedKits.length === 0) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'ติ๊กชุดตรวจอย่างน้อย 1 ชุด' });
      return;
    }
    if (!conclusion) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'เลือกข้อสรุป ผ่าน หรือ ไม่ผ่าน' });
      return;
    }
    if (!drugFormDate.trim()) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'ระบุวันที่ตรวจ' });
      return;
    }
    if (drugFormLocType === 'OTHER' && !drugFormLocOther.trim()) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'เลือกอื่นๆ ต้องระบุสถานที่' });
      return;
    }

    const temp = parseOptionalNumber(bodyTemp);
    const sys = parseOptionalNumber(bpSys);
    const dia = parseOptionalNumber(bpDia);
    const alc = parseOptionalNumber(alcohol);
    if (temp == null || sys == null || dia == null || alc == null) {
      toast({
        variant: 'destructive',
        title: 'กรอกข้อมูลไม่ครบ',
        description: 'ใส่ค่าอุณหภูมิ ความดัน (ตัวบน/ตัวล่าง) และผลแอลกอฮอล์',
      });
      return;
    }

    setDrugSaving(true);
    try {
      const kitResults = selectedKits.map((s) => ({
        substanceKey: s.id,
        substanceLabelSnapshot: s.label,
        result: kitResultById[s.id] || 'none',
      }));
      const primary = kitResults.find((k) => k.result === 'positive') || kitResults[0];

      const uploaded: WaveMonthTimesheetPhotoAttachment[] = [];
      for (let i = 0; i < pendingFiles.length; i++) {
        uploaded.push(
          await uploadWorkerDrugTestPhoto(firebaseApp, workerId, `${primary.substanceKey}_${i + 1}`, pendingFiles[i]),
        );
      }
      const attachments = [...keptExistingAttachments, ...uploaded];

      const now = Date.now();
      const recorderName = (currentUser?.displayName || currentUser?.email || '').trim() || 'system';
      const recorderId = currentUser?.id || '';

      const payload: Record<string, unknown> = {
        substanceKey: primary.substanceKey,
        substanceLabelSnapshot: primary.substanceLabelSnapshot,
        testDate: htmlDateValueToTimestampMs(drugFormDate) ?? null,
        testLocationType: drugFormLocType,
        testLocationOther: drugFormLocType === 'OTHER' ? drugFormLocOther.trim() : '',
        result: primary.result,
        kitResults,
        bodyTemperatureC: temp,
        bloodPressureSystolic: sys,
        bloodPressureDiastolic: dia,
        alcoholMgPercent: alc,
        conclusion,
        attachments,
      };

      if (attachments[0]) {
        payload.attachment = attachments[0];
      } else if (editingDrugId) {
        payload.attachment = deleteField();
      }

      if (editingDrugId) {
        payload.updatedAt = now;
        payload.updatedByName = recorderName;
        payload.updatedByUserId = recorderId;
        updateDocumentNonBlocking(doc(firestore, 'workers', workerId, 'drug_tests', editingDrugId), payload);
      } else {
        payload.createdAt = now;
        payload.recordedAt = now;
        payload.recordedByName = recorderName;
        payload.recordedByUserId = recorderId;
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

  const equipmentLabel = (row: WorkerDrugTest) => {
    const kits = kitResultsForDisplay(row);
    if (kits.length === 0) {
      return row.substanceLabelSnapshot || substanceLabelById.get(row.substanceKey || '') || row.substanceKey || '—';
    }
    return kits
      .map((k) => k.substanceLabelSnapshot || substanceLabelById.get(k.substanceKey) || k.substanceKey)
      .join(' · ');
  };

  return (
    <Card>
      <CardHeader className="border-b bg-primary/5 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2 text-primary">
              <AlertCircle className="h-5 w-5" /> ผลตรวจสารเสพติด
            </CardTitle>
            <CardDescription className="mt-1">
              บันทึกรอบตรวจเป็นประวัติ — ติ๊กชุดตรวจ ใส่ค่าชีพจร และสรุปผ่าน/ไม่ผ่าน · ล่าสุดอยู่บนสุด
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
                <TableHead className="pl-6 font-bold">ชุดตรวจ / ผล</TableHead>
                <TableHead className="font-bold">วันที่ตรวจ</TableHead>
                <TableHead className="font-bold">ค่าที่ตรวจ</TableHead>
                <TableHead className="font-bold">สรุป</TableHead>
                <TableHead className="font-bold">สถานะ</TableHead>
                <TableHead className="font-bold">ผู้บันทึก</TableHead>
                <TableHead className="font-bold text-center">รูปแนบ</TableHead>
                <TableHead className="text-right pr-6 font-bold">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRecords.map((row) => {
                const kits = kitResultsForDisplay(row);
                const validity = computeDrugTestRecordValidityStatus(row, thailandTodayYmd());
                const validityLabel = drugTestRowValidityLabelTh(validity);
                const thumbs = listWorkerDrugTestAttachments(row);
                const recordedAt = row.recordedAt || row.createdAt;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="pl-6">
                      <div className="space-y-1">
                        {(kits.length ? kits : [{ substanceKey: '', substanceLabelSnapshot: equipmentLabel(row), result: row.result }]).map(
                          (k) => (
                            <div key={k.substanceKey || k.substanceLabelSnapshot} className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-bold text-primary">
                                {k.substanceLabelSnapshot || substanceLabelById.get(k.substanceKey) || k.substanceKey}
                              </span>
                              <Badge variant="outline" className={resultBadgeClass(k.result)}>
                                {resultLabel(k.result)}
                              </Badge>
                            </div>
                          ),
                        )}
                        <p className="text-[10px] text-muted-foreground">{displayLocation(row)}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.testDate != null && row.testDate > 0 ? formatDateThaiBE(row.testDate) : '—'}
                    </TableCell>
                    <TableCell className="text-xs space-y-0.5 text-muted-foreground">
                      <div>อุณหภูมิ {row.bodyTemperatureC != null ? `${row.bodyTemperatureC} °C` : '—'}</div>
                      <div>ความดัน {formatDrugTestBloodPressure(row)}</div>
                      <div>แอลกอฮอล์ {row.alcoholMgPercent != null ? `${row.alcoholMgPercent} mg%` : '—'}</div>
                    </TableCell>
                    <TableCell>
                      {row.conclusion === 'pass' ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">ผ่าน</Badge>
                      ) : row.conclusion === 'fail' ? (
                        <Badge variant="destructive">ไม่ผ่าน</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {validity === 'valid' ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-400 font-semibold">
                          {validityLabel}
                        </Badge>
                      ) : validity === 'expired' ? (
                        <Badge variant="outline" className="bg-orange-50 text-orange-800 border-orange-400 font-semibold">
                          {validityLabel}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium text-foreground">{row.recordedByName || '—'}</div>
                      <div className="text-muted-foreground">{recordedAt ? formatDateTimeThaiBE(recordedAt) : '—'}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      {thumbs.length ? (
                        <div className="inline-flex flex-wrap justify-center gap-1 max-w-[7.5rem]">
                          {thumbs.slice(0, 5).map((att) =>
                            isPdfAttachment(att) ? (
                              <a
                                key={att.id}
                                href={att.downloadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex h-10 w-10 items-center justify-center rounded border border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
                                title={att.fileName || 'PDF'}
                              >
                                <FileText className="h-5 w-5" />
                              </a>
                            ) : (
                              <a
                                key={att.id}
                                href={att.downloadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block rounded border overflow-hidden hover:opacity-90"
                                title="เปิดรูปแนบ"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={att.downloadUrl} alt="" className="h-10 w-10 object-cover" />
                              </a>
                            ),
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-primary"
                          title="ดูประวัติ"
                          onClick={() => openViewDrugDialog(row)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canEdit ? (
                          <>
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
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {(drugTests || []).some((d) => !d.substanceKey && !(d.kitResults && d.kitResults.length)) && (
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
                  .filter((d) => !d.substanceKey && !(d.kitResults && d.kitResults.length))
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
          <DialogContent className="max-w-3xl w-[min(48rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {dialogMode === 'view' ? 'ประวัติผลตรวจ' : editingDrugId ? 'แก้ไขผลตรวจ' : 'บันทึกผลตรวจ'}
              </DialogTitle>
              <DialogDescription>
                {dialogMode === 'view'
                  ? 'ข้อมูลที่บันทึกไว้ — ผู้บันทึกและวันเวลาอยู่ด้านล่าง'
                  : 'ติ๊กชุดที่ตรวจ ระบุผลรายชุด ใส่ค่าชีพจร แล้วเลือกสรุปผ่าน/ไม่ผ่าน'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>1. ชุดตรวจ (ติ๊กชุดที่ใช้ — เลือกได้ 1 หรือทั้ง 2 ชุด)</Label>
                <div className="space-y-2">
                  {panelSubstances.map((s) => {
                    const checked = selectedKitIds.includes(s.id);
                    return (
                      <div key={s.id} className="rounded-md border p-3 space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium">
                          <Checkbox
                            checked={checked}
                            disabled={formReadOnly}
                            onCheckedChange={(v) => toggleKit(s.id, v === true)}
                          />
                          {s.label}
                        </label>
                        {checked ? (
                          <div className="pl-6 space-y-1">
                            <Label className="text-xs text-muted-foreground">ผลชุดนี้</Label>
                            <Select
                              value={kitResultById[s.id] || 'none'}
                              onValueChange={(v) => setKitResult(s.id, v as DrugTestResult)}
                              disabled={formReadOnly}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">NONE (ไม่ได้ระบุ)</SelectItem>
                                <SelectItem value="negative">NEGATIVE</SelectItem>
                                <SelectItem value="positive">POSITIVE</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="drug-body-temp">2. อุณหภูมิร่างกาย (°C)</Label>
                  <Input
                    id="drug-body-temp"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min="30"
                    max="45"
                    placeholder="เช่น 36.5"
                    value={bodyTemp}
                    disabled={formReadOnly}
                    onChange={(e) => setBodyTemp(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>3. ค่าความดัน (mmHg)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      placeholder="ตัวบน"
                      value={bpSys}
                      disabled={formReadOnly}
                      onChange={(e) => setBpSys(e.target.value)}
                    />
                    <span className="text-muted-foreground">/</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      placeholder="ตัวล่าง"
                      value={bpDia}
                      disabled={formReadOnly}
                      onChange={(e) => setBpDia(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="drug-alcohol">4. ผลเช็คแอลกอฮอล์ (mg%)</Label>
                  <Input
                    id="drug-alcohol"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="เช่น 0.0"
                    value={alcohol}
                    disabled={formReadOnly}
                    onChange={(e) => setAlcohol(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>ข้อสรุป</Label>
                <RadioGroup
                  value={conclusion}
                  onValueChange={(v) => setConclusion(v as DrugTestScreeningConclusion)}
                  className="flex flex-wrap gap-4"
                >
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="pass" disabled={formReadOnly} />
                    ผ่าน
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="fail" disabled={formReadOnly} />
                    ไม่ผ่าน
                  </label>
                </RadioGroup>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>วันที่ตรวจ</Label>
                  <DatePickerThaiBE
                    className="h-10"
                    value={htmlDateValueToTimestampMs(drugFormDate)}
                    onChange={(ms) => setDrugFormDate(timestampToHtmlDateValue(ms))}
                    disabled={formReadOnly}
                  />
                </div>
                <div className="space-y-2">
                  <Label>สถานที่ตรวจ</Label>
                  <Select
                    value={drugFormLocType}
                    onValueChange={(v) => setDrugFormLocType(v as DrugTestLocationType)}
                    disabled={formReadOnly}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OPEC">OPEC</SelectItem>
                      <SelectItem value="OTHER">อื่นๆ</SelectItem>
                    </SelectContent>
                  </Select>
                  {drugFormLocType === 'OTHER' && (
                    <Input
                      placeholder="ระบุสถานที่"
                      value={drugFormLocOther}
                      disabled={formReadOnly}
                      onChange={(e) => setDrugFormLocOther(e.target.value)}
                    />
                  )}
                </div>
              </div>

              <div className="space-y-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3">
                <Label className="flex items-center gap-2">
                  <Camera className="h-4 w-4" /> แนบรูป (ไม่เกิน {MAX_WORKER_DRUG_TEST_ATTACHMENTS} รูป)
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  JPEG/PNG/WebP บีบอัดอัตโนมัติไม่เกิน 500 KB ต่อรูป · PDF สูงสุด 10 MB · คงเหลือ {Math.max(0, attachmentSlotsLeft)} ไฟล์
                </p>
                {!formReadOnly ? (
                  <Input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*,application/pdf,.pdf"
                    capture="environment"
                    multiple
                    className="max-w-[18rem] text-xs"
                    disabled={attachmentSlotsLeft <= 0}
                    onChange={(e) => onAttachmentsPick(e.target.files)}
                  />
                ) : null}
                {(keptExistingAttachments.length > 0 || pendingFiles.length > 0) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {keptExistingAttachments.map((att) => (
                      <div key={att.id} className="relative">
                        {isPdfAttachment(att) ? (
                          <a
                            href={att.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-20 w-20 items-center justify-center rounded border bg-red-50 text-red-800"
                          >
                            <FileText className="h-8 w-8" />
                          </a>
                        ) : (
                          <a href={att.downloadUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={att.downloadUrl} alt="" className="h-20 w-20 rounded border object-cover" />
                          </a>
                        )}
                        {!formReadOnly ? (
                          <button
                            type="button"
                            className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-white"
                            onClick={() => removeExistingAttachment(att.id)}
                            title="ลบรูปนี้"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {pendingFiles.map((file, i) => (
                      <div key={`${file.name}-${i}`} className="relative">
                        {isPdfFile(file) ? (
                          <div className="inline-flex h-20 w-20 items-center justify-center rounded border bg-red-50 text-red-800">
                            <FileText className="h-8 w-8" />
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={pendingPreviewUrls[i]} alt="" className="h-20 w-20 rounded border object-cover" />
                        )}
                        {!formReadOnly ? (
                          <button
                            type="button"
                            className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-white"
                            onClick={() => removePendingFile(i)}
                            title="ลบไฟล์นี้"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {recordMeta ? (
                  <p>
                    ผู้บันทึก <span className="font-semibold text-foreground">{recordMeta.by}</span> ·{' '}
                    {formatDateTimeThaiBE(recordMeta.at)}
                  </p>
                ) : (
                  <p>
                    เมื่อบันทึกจะเก็บผู้บันทึก{' '}
                    <span className="font-semibold text-foreground">
                      {currentUser?.displayName || currentUser?.email || 'ผู้ใช้ปัจจุบัน'}
                    </span>{' '}
                    พร้อมวันเวลาเป็นประวัติ
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDrugDialogOpen(false)} disabled={drugSaving}>
                {formReadOnly ? 'ปิด' : 'ยกเลิก'}
              </Button>
              {!formReadOnly ? (
                <Button onClick={() => void handleSaveDrug()} disabled={drugSaving}>
                  {drugSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  {editingDrugId ? 'บันทึกการแก้ไข' : 'บันทึก'}
                </Button>
              ) : canEdit ? (
                <Button
                  onClick={() => setDialogMode('edit')}
                >
                  แก้ไข
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
