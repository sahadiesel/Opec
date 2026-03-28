'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue, formatOptionalDateThaiBE } from '@/lib/date-thai';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, FileSearch } from 'lucide-react';
import { doc, type Firestore, type CollectionReference } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import type { WorkerDocument, WorkerDocumentCatalogItem } from '@/lib/types';

interface WorkerDocsTabProps {
  workerId: string;
  firestore: Firestore | null;
  workerDocs: WorkerDocument[] | null;
  docsQuery: CollectionReference | null;
  workerDocCatalog: WorkerDocumentCatalogItem[] | null;
}

export function WorkerDocsTab({ workerId, firestore, workerDocs, docsQuery, workerDocCatalog }: WorkerDocsTabProps) {
  const { toast } = useToast();
  const [isAddDocOpen, setIsAddDocOpen] = useState(false);
  const [newDocTemplateId, setNewDocTemplateId] = useState('');
  const [newDocNo, setNewDocNo] = useState('');
  const [newDocIssueDate, setNewDocIssueDate] = useState('');
  const [newDocExpiryDate, setNewDocExpiryDate] = useState('');
  const [editingDocId, setEditingDocId] = useState<string | null>(null);

  const handleSaveDoc = () => {
    const selected = (workerDocCatalog || []).find((x) => x.id === newDocTemplateId);
    if (!selected || !docsQuery) return;
    if (!newDocNo.trim()) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'กรุณากรอกเลขที่เอกสาร' });
      return;
    }
    if (selected.hasExpiry && !newDocExpiryDate) {
      toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'เอกสารนี้ต้องระบุวันหมดอายุ' });
      return;
    }
    const duplicateDoc = (workerDocs || []).find(
      (d) => (d.documentType || '').toLowerCase() === (selected.itemCode || '').toLowerCase() && d.id !== editingDocId
    );
    if (duplicateDoc) {
      const shouldEdit = confirm('มีเอกสารรายการนี้อยู่แล้ว ต้องการแก้ไขรายการเดิมใช่ไหม?');
      if (!shouldEdit) return;
      setEditingDocId(duplicateDoc.id);
      setNewDocTemplateId(selected.id);
      setNewDocNo(duplicateDoc.documentNo || '');
      setNewDocIssueDate(duplicateDoc.issueDate ? timestampToHtmlDateValue(duplicateDoc.issueDate) : '');
      setNewDocExpiryDate(duplicateDoc.expiryDate ? timestampToHtmlDateValue(duplicateDoc.expiryDate) : '');
      toast({ title: 'เข้าสู่โหมดแก้ไข', description: 'ปรับข้อมูลและกดบันทึกอีกครั้งเพื่ออัปเดตรายการเดิม' });
      return;
    }
    const now = Date.now();
    const issueDate = newDocIssueDate ? new Date(newDocIssueDate).getTime() : now;
    const expiryDate = selected.hasExpiry ? (newDocExpiryDate ? new Date(newDocExpiryDate).getTime() : 0) : 0;
    if (editingDocId && firestore) {
      updateDocumentNonBlocking(doc(firestore, 'workers', workerId, 'documents', editingDocId), {
        documentType: selected.itemCode,
        documentNo: newDocNo.trim(),
        issueDate,
        expiryDate,
      });
    } else {
      addDocumentNonBlocking(docsQuery, {
        documentType: selected.itemCode,
        documentNo: newDocNo.trim(),
        issueDate,
        expiryDate,
      });
    }
    setIsAddDocOpen(false);
    setEditingDocId(null);
    setNewDocTemplateId('');
    setNewDocNo('');
    setNewDocIssueDate('');
    setNewDocExpiryDate('');
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2 text-primary">
            <FileSearch className="h-5 w-5" /> เอกสารอื่น ๆ (Identity & Documents)
          </CardTitle>
          <CardDescription>จัดเก็บสำเนาบัตรประชาชน พาสปอร์ต ทะเบียนบ้าน หรือสัญญาจ้างงาน</CardDescription>
        </div>
        <Dialog open={isAddDocOpen} onOpenChange={setIsAddDocOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary font-bold shadow-md" onClick={() => { setEditingDocId(null); setNewDocTemplateId(''); setNewDocNo(''); setNewDocIssueDate(''); setNewDocExpiryDate(''); }}>
              <Plus className="h-4 w-4 mr-2" /> เพิ่มเอกสาร (Add Doc)
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>เพิ่มเอกสารจากรายการกลาง</DialogTitle>
              <DialogDescription>เลือกเฉพาะรายการประเภท Document จากเมนูรายการเอกสารกลาง</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label>รายการเอกสาร</Label>
              <Select value={newDocTemplateId} onValueChange={setNewDocTemplateId}>
                <SelectTrigger><SelectValue placeholder="เลือกเอกสาร..." /></SelectTrigger>
                <SelectContent>
                  {(workerDocCatalog || []).filter((x) => x.active !== false && x.requirementType === 'document').map((x) => (
                    <SelectItem key={x.id} value={x.id}>{x.itemName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label>เลขที่เอกสาร</Label>
              <Input value={newDocNo} onChange={(e) => setNewDocNo(e.target.value)} placeholder="เช่น P1234567 / SB77889" />
              <Label>วันที่ออกเอกสาร</Label>
              <DatePickerThaiBE className="h-10" value={htmlDateValueToTimestampMs(newDocIssueDate)} onChange={(ms) => setNewDocIssueDate(timestampToHtmlDateValue(ms))} />
              <Label>วันหมดอายุ</Label>
              <DatePickerThaiBE className="h-10" value={htmlDateValueToTimestampMs(newDocExpiryDate)} disabled={!((workerDocCatalog || []).find((x) => x.id === newDocTemplateId)?.hasExpiry)} onChange={(ms) => setNewDocExpiryDate(timestampToHtmlDateValue(ms))} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDocOpen(false)}>ยกเลิก</Button>
              <Button onClick={handleSaveDoc}>{editingDocId ? 'บันทึกการแก้ไข' : 'บันทึก'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="pl-6 font-bold">ประเภทเอกสาร (Type)</TableHead>
              <TableHead className="font-bold">เลขที่เอกสาร (Doc No.)</TableHead>
              <TableHead className="font-bold">วันหมดอายุ (Expiry)</TableHead>
              <TableHead className="text-right pr-6">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workerDocs?.map(d => (
              <TableRow key={d.id}>
                <TableCell className="pl-6 font-bold text-primary capitalize">{d.documentType.replace('_', ' ')}</TableCell>
                <TableCell className="font-mono text-xs">{d.documentNo}</TableCell>
                <TableCell className="text-xs">{d.expiryDate > 0 ? formatOptionalDateThaiBE(d.expiryDate, '-') : '-'}</TableCell>
                <TableCell className="text-right pr-6">
                  <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => {
                    if (!firestore) return;
                    if (confirm('ลบรายการ?')) deleteDocumentNonBlocking(doc(firestore, 'workers', workerId, 'documents', d.id));
                  }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {workerDocs?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-20 text-center text-muted-foreground italic">ไม่พบเอกสารในระบบ</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
