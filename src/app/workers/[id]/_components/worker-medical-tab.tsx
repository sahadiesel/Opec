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
import { Plus, Trash2, Stethoscope } from 'lucide-react';
import { doc, type Firestore, type CollectionReference } from 'firebase/firestore';
import { addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import type { WorkerMedicalRecord } from '@/lib/types';

interface WorkerMedicalTabProps {
  workerId: string;
  firestore: Firestore | null;
  medicals: WorkerMedicalRecord[] | null;
  medicalsQuery: CollectionReference | null;
}

export function WorkerMedicalTab({ workerId, firestore, medicals, medicalsQuery }: WorkerMedicalTabProps) {
  const { toast } = useToast();
  const [isAddMedicalOpen, setIsAddMedicalOpen] = useState(false);
  const [newMedicalType, setNewMedicalType] = useState('General Health Exam');
  const [newMedicalExamDate, setNewMedicalExamDate] = useState('');
  const [newMedicalExpiryDate, setNewMedicalExpiryDate] = useState('');
  const [newMedicalFitStatus, setNewMedicalFitStatus] = useState<'fit' | 'unfit' | 'conditional'>('fit');
  const [newMedicalHospital, setNewMedicalHospital] = useState('');

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2 text-primary">
            <Stethoscope className="h-5 w-5" /> ผลการตรวจร่างกาย (Medical Records)
          </CardTitle>
          <CardDescription>ข้อมูลความพร้อมทางร่างกายตามเกณฑ์มาตรฐานงาน Offshore</CardDescription>
        </div>
        <Dialog open={isAddMedicalOpen} onOpenChange={setIsAddMedicalOpen}>
          <DialogTrigger asChild>
            <Button
              className="bg-primary font-bold shadow-md"
              onClick={() => {
                setNewMedicalType('General Health Exam');
                setNewMedicalExamDate('');
                setNewMedicalExpiryDate('');
                setNewMedicalFitStatus('fit');
                setNewMedicalHospital('');
              }}
            >
              <Plus className="h-4 w-4 mr-2" /> เพิ่มผลตรวจ (Add Medical)
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>บันทึกผลตรวจร่างกาย</DialogTitle>
              <DialogDescription>กรอกข้อมูลผลตรวจให้ครบก่อนบันทึก</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label>ประเภทการตรวจ</Label>
                <Input value={newMedicalType} onChange={(e) => setNewMedicalType(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>วันที่ตรวจ</Label>
                <DatePickerThaiBE className="h-10" value={htmlDateValueToTimestampMs(newMedicalExamDate)} onChange={(ms) => setNewMedicalExamDate(timestampToHtmlDateValue(ms))} />
              </div>
              <div className="space-y-2">
                <Label>วันหมดอายุ</Label>
                <DatePickerThaiBE className="h-10" value={htmlDateValueToTimestampMs(newMedicalExpiryDate)} onChange={(ms) => setNewMedicalExpiryDate(timestampToHtmlDateValue(ms))} />
              </div>
              <div className="space-y-2">
                <Label>ผลการตรวจ</Label>
                <Select value={newMedicalFitStatus} onValueChange={(v) => setNewMedicalFitStatus(v as 'fit' | 'unfit' | 'conditional')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fit">FIT</SelectItem>
                    <SelectItem value="unfit">UNFIT</SelectItem>
                    <SelectItem value="conditional">CONDITIONAL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>สถานพยาบาล</Label>
                <Input value={newMedicalHospital} onChange={(e) => setNewMedicalHospital(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddMedicalOpen(false)}>ยกเลิก</Button>
              <Button
                onClick={() => {
                  if (!medicalsQuery) return;
                  if (!newMedicalType.trim() || !newMedicalExamDate || !newMedicalExpiryDate) {
                    toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'กรุณาระบุประเภท วันที่ตรวจ และวันหมดอายุ' });
                    return;
                  }
                  addDocumentNonBlocking(medicalsQuery, {
                    medicalType: newMedicalType.trim(),
                    examDate: new Date(newMedicalExamDate).getTime(),
                    expiryDate: new Date(newMedicalExpiryDate).getTime(),
                    fitStatus: newMedicalFitStatus,
                    hospitalOrClinic: newMedicalHospital || '',
                  });
                  setIsAddMedicalOpen(false);
                }}
              >
                บันทึก
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="pl-6 font-bold">ประเภทการตรวจ (Type)</TableHead>
              <TableHead className="font-bold">วันที่ตรวจ (Exam Date)</TableHead>
              <TableHead className="font-bold">วันหมดอายุ (Expiry)</TableHead>
              <TableHead className="font-bold">ผลการตรวจ (Result)</TableHead>
              <TableHead className="text-right pr-6">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {medicals?.map(m => (
              <TableRow key={m.id}>
                <TableCell className="pl-6 font-medium text-primary">{m.medicalType}</TableCell>
                <TableCell className="text-xs">{new Date(m.examDate).toLocaleDateString('th-TH')}</TableCell>
                <TableCell className={m.expiryDate < Date.now() ? 'text-destructive font-black' : 'font-medium'}>
                  {new Date(m.expiryDate).toLocaleDateString('th-TH')}
                </TableCell>
                <TableCell>
                  <Badge variant={m.fitStatus === 'fit' ? 'default' : 'destructive'} className={m.fitStatus === 'fit' ? 'bg-green-600' : ''}>
                    {m.fitStatus.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-right pr-6">
                  <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => {
                    if (!firestore) return;
                    if (confirm('ลบรายการ?')) deleteDocumentNonBlocking(doc(firestore, 'workers', workerId, 'medical_records', m.id));
                  }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {medicals?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-20 text-center text-muted-foreground italic">ไม่พบประวัติการตรวจร่างกาย</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
