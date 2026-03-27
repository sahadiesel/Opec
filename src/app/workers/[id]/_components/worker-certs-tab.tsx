'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, FileText } from 'lucide-react';
import { doc, type Firestore, type CollectionReference } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import type { WorkerCertificate, WorkerDocumentCatalogItem } from '@/lib/types';

interface WorkerCertsTabProps {
  workerId: string;
  firestore: Firestore | null;
  certs: WorkerCertificate[] | null;
  certsQuery: CollectionReference | null;
  workerDocCatalog: WorkerDocumentCatalogItem[] | null;
}

export function WorkerCertsTab({ workerId, firestore, certs, certsQuery, workerDocCatalog }: WorkerCertsTabProps) {
  const { toast } = useToast();
  const [isAddCertOpen, setIsAddCertOpen] = useState(false);
  const [newCertTemplateId, setNewCertTemplateId] = useState('');
  const [newCertNo, setNewCertNo] = useState('');
  const [newCertIssueDate, setNewCertIssueDate] = useState('');
  const [newCertExpiryDate, setNewCertExpiryDate] = useState('');
  const [editingCertId, setEditingCertId] = useState<string | null>(null);

  const handleSaveCert = () => {
    const selected = (workerDocCatalog || []).find((x) => x.id === newCertTemplateId);
    if (!selected || !certsQuery) return;
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
        c.id !== editingCertId
    );
    if (duplicateCert) {
      const shouldEdit = confirm('มีเอกสาร/ใบเซอร์รายการนี้อยู่แล้ว ต้องการแก้ไขรายการเดิมใช่ไหม?');
      if (!shouldEdit) return;
      setEditingCertId(duplicateCert.id);
      setNewCertTemplateId(selected.id);
      setNewCertNo(duplicateCert.certificateNo || '');
      setNewCertIssueDate(duplicateCert.issueDate ? timestampToHtmlDateValue(duplicateCert.issueDate) : '');
      setNewCertExpiryDate(duplicateCert.expiryDate ? timestampToHtmlDateValue(duplicateCert.expiryDate) : '');
      toast({ title: 'เข้าสู่โหมดแก้ไข', description: 'ปรับข้อมูลและกดบันทึกอีกครั้งเพื่ออัปเดตรายการเดิม' });
      return;
    }
    const now = Date.now();
    const issueDate = newCertIssueDate ? new Date(newCertIssueDate).getTime() : now;
    const expiryDate = selected.hasExpiry
      ? (newCertExpiryDate ? new Date(newCertExpiryDate).getTime() : 0)
      : 0;
    if (editingCertId && firestore) {
      updateDocumentNonBlocking(doc(firestore, 'workers', workerId, 'certificates', editingCertId), {
        certificateName: selected.itemName,
        certificateCode: selected.itemCode,
        certificateNo: newCertNo.trim(),
        issueDate,
        expiryDate,
        status: 'valid',
      });
    } else {
      addDocumentNonBlocking(certsQuery, {
        certificateName: selected.itemName,
        certificateCode: selected.itemCode,
        certificateNo: newCertNo.trim(),
        issueDate,
        expiryDate,
        status: 'valid',
      });
    }
    setIsAddCertOpen(false);
    setEditingCertId(null);
    setNewCertTemplateId('');
    setNewCertNo('');
    setNewCertIssueDate('');
    setNewCertExpiryDate('');
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2 text-primary">
            <FileText className="h-5 w-5" /> รายการใบรับรอง (Certificates Management)
          </CardTitle>
          <CardDescription>จัดเก็บใบเซอร์บังคับ (BOSIET, etc.) และติดตามวันหมดอายุ</CardDescription>
        </div>
        <Dialog open={isAddCertOpen} onOpenChange={setIsAddCertOpen}>
          <DialogTrigger asChild>
            <Button
              className="bg-primary font-bold shadow-md"
              onClick={() => {
                setEditingCertId(null);
                setNewCertTemplateId('');
                setNewCertNo('');
                setNewCertIssueDate('');
                setNewCertExpiryDate('');
              }}
            >
              <Plus className="h-4 w-4 mr-2" /> เพิ่มใบเซอร์ (Add Cert)
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>เพิ่มใบเซอร์จากรายการกลาง</DialogTitle>
              <DialogDescription>เลือกเฉพาะรายการประเภท Certificate จากเมนูรายการเอกสารกลาง</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label>รายการเซอร์</Label>
              <Select value={newCertTemplateId} onValueChange={setNewCertTemplateId}>
                <SelectTrigger><SelectValue placeholder="เลือกใบเซอร์..." /></SelectTrigger>
                <SelectContent>
                  {(workerDocCatalog || []).filter((x) => x.active !== false && x.requirementType === 'certificate').map((x) => (
                    <SelectItem key={x.id} value={x.id}>{x.itemName}</SelectItem>
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
                disabled={!((workerDocCatalog || []).find((x) => x.id === newCertTemplateId)?.hasExpiry)}
                onChange={(ms) => setNewCertExpiryDate(timestampToHtmlDateValue(ms))}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddCertOpen(false)}>ยกเลิก</Button>
              <Button onClick={handleSaveCert}>
                {editingCertId ? 'บันทึกการแก้ไข' : 'บันทึก'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="pl-6 font-bold">ชื่อใบเซอร์ (Name)</TableHead>
              <TableHead className="font-bold">เลขที่ใบเซอร์ (No.)</TableHead>
              <TableHead className="font-bold">วันหมดอายุ (Expiry)</TableHead>
              <TableHead className="font-bold">สถานะ (Status)</TableHead>
              <TableHead className="text-right pr-6">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {certs?.map(c => (
              <TableRow key={c.id}>
                <TableCell className="pl-6 font-medium text-primary">{c.certificateName}</TableCell>
                <TableCell className="font-mono text-xs">{c.certificateNo || '-'}</TableCell>
                <TableCell className={c.expiryDate > 0 && c.expiryDate < Date.now() ? 'text-destructive font-black' : 'font-medium'}>
                  {c.expiryDate > 0 ? new Date(c.expiryDate).toLocaleDateString('th-TH') : '-'}
                </TableCell>
                <TableCell>
                  <Badge variant={c.status === 'valid' ? 'default' : 'destructive'} className={c.status === 'valid' ? 'bg-green-600' : ''}>
                    {c.status.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-right pr-6">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive h-8 w-8"
                    onClick={() => {
                      if (!firestore) return;
                      if (confirm('ลบรายการ?')) {
                        deleteDocumentNonBlocking(doc(firestore, 'workers', workerId, 'certificates', c.id));
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {certs?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-20 text-center text-muted-foreground italic">ไม่พบข้อมูลใบรับรอง</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
