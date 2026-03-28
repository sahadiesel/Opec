'use client';

import { useState, useMemo } from 'react';
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
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { doc, type Firestore, type CollectionReference } from 'firebase/firestore';
import { addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { getLatestDrugTestBySubstance, displayLocation } from '@/lib/drug-test-panel';
import Link from 'next/link';
import type { WorkerDrugTest, DrugTestPanelSubstance, DrugTestLocationType, DrugTestResult } from '@/lib/types';

interface WorkerDrugTabProps {
  workerId: string;
  firestore: Firestore | null;
  drugTests: WorkerDrugTest[] | null;
  drugTestsQuery: CollectionReference | null;
  panelSubstances: DrugTestPanelSubstance[];
}

export function WorkerDrugTab({ workerId, firestore, drugTests, drugTestsQuery, panelSubstances }: WorkerDrugTabProps) {
  const { toast } = useToast();
  const [drugEditSubstance, setDrugEditSubstance] = useState<DrugTestPanelSubstance | null>(null);
  const [drugFormDate, setDrugFormDate] = useState('');
  const [drugFormLocType, setDrugFormLocType] = useState<DrugTestLocationType>('OPEC');
  const [drugFormLocOther, setDrugFormLocOther] = useState('');
  const [drugFormResult, setDrugFormResult] = useState<DrugTestResult>('none');

  const latestBySubstance = useMemo(() => getLatestDrugTestBySubstance(drugTests || []), [drugTests]);

  const openDrugDialog = (s: DrugTestPanelSubstance) => {
    setDrugEditSubstance(s);
    const latest = latestBySubstance.get(s.id);
    if (latest) {
      setDrugFormDate(latest.testDate != null && latest.testDate > 0 ? timestampToHtmlDateValue(latest.testDate) : '');
      setDrugFormLocType(latest.testLocationType || (latest.laboratory ? 'OTHER' : 'OPEC'));
      setDrugFormLocOther(latest.testLocationOther || (latest.testLocationType !== 'OPEC' && latest.laboratory ? latest.laboratory : '') || '');
      const r = latest.result;
      setDrugFormResult(r === 'positive' || r === 'negative' ? r : 'none');
    } else {
      setDrugFormDate('');
      setDrugFormLocType('OPEC');
      setDrugFormLocOther('');
      setDrugFormResult('none');
    }
  };

  return (
    <Card>
      <CardHeader className="border-b bg-primary/5 pb-4">
        <CardTitle className="text-lg flex items-center gap-2 text-primary">
          <AlertCircle className="h-5 w-5" /> ผลตรวจสารเสพติด
        </CardTitle>
        <CardDescription>รายการสารตรวจมาจากการตั้งค่าในเมนูจัดการระบบ — ไม่มีวันหมดอายุในระบบ</CardDescription>
      </CardHeader>
      <CardContent className="p-0 pt-4 space-y-6">
        {panelSubstances.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            ยังไม่มีรายการสาร — ผู้ดูแลระบบสามารถตั้งค่าได้ที่{' '}
            <Link href="/system-admin/drug-test-panel" className="text-primary font-bold underline">ตั้งค่าแผงตรวจสารเสพติด</Link>
          </p>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-6 font-bold">ชื่อสารที่ตรวจ</TableHead>
                <TableHead className="font-bold">วันที่ตรวจ</TableHead>
                <TableHead className="font-bold">สถานที่ตรวจ</TableHead>
                <TableHead className="font-bold">ผลตรวจ</TableHead>
                <TableHead className="text-right pr-6">บันทึก</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {panelSubstances.map((s) => {
                const latest = latestBySubstance.get(s.id);
                const res = latest?.result;
                const resLabel = res === 'negative' ? 'NEGATIVE' : res === 'positive' ? 'POSITIVE' : 'NONE';
                return (
                  <TableRow key={s.id}>
                    <TableCell className="pl-6 font-bold text-primary">{s.label}</TableCell>
                    <TableCell className="text-sm">
                      {latest?.testDate != null && latest.testDate > 0 ? formatDateThaiBE(latest.testDate) : '—'}
                    </TableCell>
                    <TableCell className="text-sm">{latest ? displayLocation(latest) : '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        res === 'negative' ? 'bg-green-600 text-white border-green-600'
                          : res === 'positive' ? 'bg-destructive text-destructive-foreground'
                            : 'bg-slate-100 text-slate-600'
                      }>{resLabel}</Badge>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <Button size="sm" variant="outline" className="font-bold" onClick={() => openDrugDialog(s)}>
                        <Plus className="h-3 w-3 mr-1" /> บันทึกผล
                      </Button>
                    </TableCell>
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
                {(drugTests || []).filter((d) => !d.substanceKey).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="pl-6">{d.testDate != null && d.testDate > 0 ? formatOptionalDateThaiBE(d.testDate, '—') : '—'}</TableCell>
                    <TableCell className="text-xs">{d.laboratory || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={d.result === 'negative' ? 'default' : 'destructive'}>{(d.result || '').toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => {
                        if (!firestore) return;
                        if (confirm('ลบรายการ?')) deleteDocumentNonBlocking(doc(firestore, 'workers', workerId, 'drug_tests', d.id));
                      }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={drugEditSubstance != null} onOpenChange={(o) => !o && setDrugEditSubstance(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>บันทึกผลตรวจ: {drugEditSubstance?.label}</DialogTitle>
              <DialogDescription>ผลเริ่มต้น NONE = ยังไม่ได้ตรวจ — สถานที่เริ่มต้น OPEC</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label>วันที่ตรวจ</Label>
                <DatePickerThaiBE className="h-10" value={htmlDateValueToTimestampMs(drugFormDate)} onChange={(ms) => setDrugFormDate(timestampToHtmlDateValue(ms))} disabled={drugFormResult === 'none'} />
                <p className="text-[10px] text-muted-foreground">ถ้าเลือกผลเป็น NONE ไม่บังคับวันที่</p>
              </div>
              <div className="space-y-2">
                <Label>สถานที่ตรวจ</Label>
                <Select value={drugFormLocType} onValueChange={(v) => setDrugFormLocType(v as DrugTestLocationType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">NONE (ไม่ได้ตรวจ)</SelectItem>
                    <SelectItem value="negative">NEGATIVE</SelectItem>
                    <SelectItem value="positive">POSITIVE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDrugEditSubstance(null)}>ยกเลิก</Button>
              <Button onClick={() => {
                if (!drugTestsQuery || !drugEditSubstance) return;
                if (drugFormResult !== 'none' && !drugFormDate.trim()) {
                  toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'ถ้ามีผลตรวจแล้ว ต้องระบุวันที่ตรวจ' });
                  return;
                }
                if (drugFormLocType === 'OTHER' && !drugFormLocOther.trim()) {
                  toast({ variant: 'destructive', title: 'กรอกข้อมูลไม่ครบ', description: 'เลือกอื่นๆ ต้องระบุสถานที่' });
                  return;
                }
                addDocumentNonBlocking(drugTestsQuery, {
                  substanceKey: drugEditSubstance.id,
                  substanceLabelSnapshot: drugEditSubstance.label,
                  testDate: drugFormResult === 'none' || !drugFormDate.trim() ? null : new Date(drugFormDate).getTime(),
                  testLocationType: drugFormLocType,
                  testLocationOther: drugFormLocType === 'OTHER' ? drugFormLocOther.trim() : '',
                  result: drugFormResult,
                });
                setDrugEditSubstance(null);
                toast({ title: 'บันทึกแล้ว' });
              }}>บันทึก</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
