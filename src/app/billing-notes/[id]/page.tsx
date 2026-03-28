
'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft, 
  Save, 
  Plus, 
  Trash2, 
  Building2, 
  Calendar, 
  FileText, 
  Receipt,
  CheckCircle2,
  History,
  Info,
  Loader2,
  ChevronRight,
  Calculator,
  ArrowRight,
  FileBadge,
  XCircle,
  ExternalLink,
  Sparkles,
  AlertTriangle
} from 'lucide-react';
import Link from 'next/link';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection, updateDoc, query, where } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  BillingNote, 
  BillingNoteLine, 
  BillingNoteStatus, 
  User, 
  Customer,
  TaxInvoice,
} from '@/lib/types';
import { generateBillingLines, saveBillingLines, type BillingLineGenerationResult } from '@/lib/services/billing-line-generator';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue, formatDateTimeThaiBE } from '@/lib/date-thai';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';

export default function BillingNoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const noteRef = useMemoFirebase(() => (firestore ? doc(firestore, 'billing_notes', id) : null), [firestore, id]);
  const { data: note, isLoading: isNoteLoading } = useDoc<BillingNote>(noteRef as any);

  const linesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'billing_notes', id, 'lines') : null), [firestore, id]);
  const { data: lines, isLoading: isLinesLoading } = useCollection<BillingNoteLine>(linesQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'customers') : null), [firestore]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const customer = customers?.find(c => c.id === note?.customerId);

  const linkedInvoicesQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'tax_invoices'), where('billingNoteId', '==', id)) : null), [firestore, id]);
  const { data: linkedInvoices } = useCollection<TaxInvoice>(linkedInvoicesQuery as any);

  const [isAddingLine, setIsAddingLine] = useState(false);
  const [newLine, setNewLine] = useState<Partial<BillingNoteLine>>({
    description: '',
    referenceType: 'SERVICE',
    quantity: 1,
    unitPrice: 0
  });

  const [isEditingHeader, setIsEditingEditingHeader] = useState(false);
  const [editedNote, setEditedNote] = useState<Partial<BillingNote>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [genResult, setGenResult] = useState<BillingLineGenerationResult | null>(null);

  useEffect(() => {
    if (note) setEditedNote(note);
  }, [note]);

  const handleAutoGenerate = async () => {
    if (!firestore || !note?.poId || !note.billingPeriodStart || !note.billingPeriodEnd) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'ใบวางบิลต้องมี PO, ช่วงเวลาเริ่ม/สิ้นสุด' });
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateBillingLines(
        firestore,
        note.poId,
        note.billingPeriodStart,
        note.billingPeriodEnd,
        note.waveId || undefined,
      );
      setGenResult(result);

      if (result.lines.length === 0) {
        toast({ variant: 'destructive', title: 'ไม่พบรายการ', description: result.warnings.join('\n') || 'ไม่มี timesheet ที่พร้อมวางบิลในช่วงเวลานี้' });
        return;
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'เกิดข้อผิดพลาด', description: e.message });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConfirmGenLines = async () => {
    if (!firestore || !genResult || !noteRef) return;
    setIsGenerating(true);
    try {
      await saveBillingLines(firestore, id, genResult.lines);
      recalculateTotals([...(lines || []), ...genResult.lines.map((l, i) => ({ ...l, id: `gen_${i}`, billingNoteId: id, createdAt: Date.now(), updatedAt: Date.now() }))]);
      setGenResult(null);
      toast({ title: 'สร้างรายการสำเร็จ', description: `เพิ่ม ${genResult.lines.length} รายการจาก ${genResult.timesheetCount} timesheets` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddLine = async () => {
    if (!firestore || !newLine.description || !newLine.quantity || !newLine.unitPrice) return;
    
    const lineRef = collection(firestore, 'billing_notes', id, 'lines');
    const amount = Number(newLine.quantity) * Number(newLine.unitPrice);
    
    await addDocumentNonBlocking(lineRef, {
      ...newLine,
      billingNoteId: id,
      amount,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    recalculateTotals([...(lines || []), { ...newLine, amount } as any]);
    setIsAddingLine(false);
    setNewLine({ description: '', referenceType: 'SERVICE', quantity: 1, unitPrice: 0 });
    toast({ title: "เพิ่มรายการสำเร็จ" });
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!firestore) return;
    await deleteDocumentNonBlocking(doc(firestore, 'billing_notes', id, 'lines', lineId));
    recalculateTotals(lines?.filter(l => l.id !== lineId) || []);
    toast({ title: "ลบรายการสำเร็จ" });
  };

  const vatRate = (note?.vatPercent ?? 7) / 100;

  const recalculateTotals = (currentLines: BillingNoteLine[], withholdingOverride?: number) => {
    if (!noteRef || !note) return;
    const amountBeforeTax = currentLines.reduce((sum, l) => sum + Number(l.amount), 0);
    const vatAmount = amountBeforeTax * vatRate;
    const wht =
      withholdingOverride !== undefined
        ? withholdingOverride
        : Number(note.withholdingTaxAmount) || 0;
    const netAmount = Math.max(0, amountBeforeTax + vatAmount - wht);

    updateDoc(noteRef, {
      amountBeforeTax,
      vatAmount,
      withholdingTaxAmount: wht,
      netAmount,
      updatedAt: Date.now()
    });
  };

  const handleSaveHeader = () => {
    if (!noteRef || !lines) return;
    const amountBeforeTax = lines.reduce((sum, l) => sum + Number(l.amount), 0);
    const vatAmount = amountBeforeTax * vatRate;
    const wht = Number(editedNote.withholdingTaxAmount) || 0;
    const netAmount = Math.max(0, amountBeforeTax + vatAmount - wht);
    updateDocumentNonBlocking(noteRef, {
      ...editedNote,
      amountBeforeTax,
      vatAmount,
      withholdingTaxAmount: wht,
      netAmount,
      updatedAt: Date.now(),
    });
    setIsEditingEditingHeader(false);
    toast({ title: "บันทึกข้อมูลสำเร็จ" });
  };

  const handleUpdateStatus = (newStatus: BillingNoteStatus) => {
    if (!noteRef) return;
    updateDocumentNonBlocking(noteRef, { status: newStatus, updatedAt: Date.now() });
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus}` });
  };

  if (isNoteLoading || !note || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/billing-notes')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Billing Note Detail (รายละเอียดใบวางบิล)</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{note.billingNoteNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>ลูกค้า: {customer?.name || '...'}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="py-1.5 px-4 font-bold border-primary/20 bg-primary/5 text-primary">
              STATUS: {note.status}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <Tabs defaultValue="lines" className="w-full">
              <TabsList className="grid grid-cols-4 w-full md:w-fit h-auto p-1 bg-muted/50">
                <TabsTrigger value="lines" className="gap-2 py-2 px-6">รายการวางบิล</TabsTrigger>
                <TabsTrigger value="info" className="gap-2 py-2 px-6">ข้อมูลหัวเอกสาร</TabsTrigger>
                <TabsTrigger value="summary" className="gap-2 py-2 px-6">สรุปยอด</TabsTrigger>
                <TabsTrigger value="history" className="gap-2 py-2 px-6">ประวัติ</TabsTrigger>
              </TabsList>

              <TabsContent value="lines" className="mt-6 space-y-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                    <div>
                      <CardTitle className="text-lg">รายการเรียกเก็บเงิน (Billing Items)</CardTitle>
                      <CardDescription>ระบุรายการตามสัญญา ใบสั่งซื้อ หรือค่าบริการอื่น ๆ</CardDescription>
                    </div>
                    {note.status === 'DRAFT' && (
                      <div className="flex gap-2">
                        {note.poId && (
                          <Button variant="outline" className="font-bold gap-2 border-green-300 text-green-700 hover:bg-green-50" onClick={handleAutoGenerate} disabled={isGenerating}>
                            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            สร้างจาก Timesheet
                          </Button>
                        )}
                      <Dialog open={isAddingLine} onOpenChange={setIsAddingLine}>
                        <DialogTrigger asChild>
                          <Button className="bg-primary font-bold"><Plus className="h-4 w-4 mr-2" /> เพิ่มรายการ</Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>เพิ่มรายการวางบิล</DialogTitle>
                          </DialogHeader>
                          <div className="grid gap-4 py-4">
                            <div className="space-y-2">
                              <Label>คำอธิบาย (Description)</Label>
                              <Input value={newLine.description} onChange={e => setNewLine({...newLine, description: e.target.value})} placeholder="เช่น ค่าจ้างพนักงาน..." />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label>จำนวน</Label>
                                <Input type="number" value={newLine.quantity} onChange={e => setNewLine({...newLine, quantity: parseFloat(e.target.value)})} />
                              </div>
                              <div className="space-y-2">
                                <Label>ราคาต่อหน่วย</Label>
                                <Input type="number" value={newLine.unitPrice} onChange={e => setNewLine({...newLine, unitPrice: parseFloat(e.target.value)})} />
                              </div>
                            </div>
                          </div>
                          <DialogFooter>
                            <Button onClick={handleAddLine}>ยืนยันเพิ่มรายการ</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead>รายละเอียด (Description)</TableHead>
                          <TableHead className="text-right">จำนวน</TableHead>
                          <TableHead className="text-right">ราคา/หน่วย</TableHead>
                          <TableHead className="text-right font-bold">ยอดรวม</TableHead>
                          <TableHead className="text-right">จัดการ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines?.map(line => (
                          <TableRow key={line.id}>
                            <TableCell className="font-medium text-sm">{line.description}</TableCell>
                            <TableCell className="text-right">{line.quantity.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{line.unitPrice.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-bold text-primary">
                              ฿ {line.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right">
                              {note.status === 'DRAFT' && (
                                <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => handleDeleteLine(line.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {genResult && genResult.lines.length > 0 && (
                  <Card className="border-2 border-green-200 bg-green-50/30">
                    <CardHeader className="border-b pb-4">
                      <CardTitle className="text-lg flex items-center gap-2 text-green-800">
                        <Sparkles className="h-5 w-5" /> ตัวอย่างรายการจาก Timesheet ({genResult.timesheetCount} records)
                      </CardTitle>
                      <CardDescription>
                        ตรวจสอบรายการก่อนยืนยัน — จะเพิ่มเข้าใบวางบิลนี้
                      </CardDescription>
                      {genResult.warnings.length > 0 && (
                        <Alert className="mt-2 bg-amber-50 border-amber-200 text-amber-800">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>คำเตือน</AlertTitle>
                          <AlertDescription>
                            {genResult.warnings.map((w, i) => <p key={i} className="text-xs">{w}</p>)}
                          </AlertDescription>
                        </Alert>
                      )}
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader className="bg-green-100/50">
                          <TableRow>
                            <TableHead>รายละเอียด</TableHead>
                            <TableHead className="text-right">จำนวน</TableHead>
                            <TableHead className="text-right">ราคา/หน่วย</TableHead>
                            <TableHead className="text-right font-bold">ยอดรวม</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {genResult.lines.map((line, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="font-medium text-sm">{line.description}</TableCell>
                              <TableCell className="text-right">{line.quantity.toLocaleString()}</TableCell>
                              <TableCell className="text-right">{line.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                              <TableCell className="text-right font-bold text-green-700">
                                ฿ {line.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                    <CardFooter className="flex justify-between items-center pt-4 border-t">
                      <div className="text-sm font-bold text-green-800">
                        รวมทั้งหมด: ฿ {genResult.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setGenResult(null)}>ยกเลิก</Button>
                        <Button className="bg-green-700 hover:bg-green-800 font-bold gap-2" onClick={handleConfirmGenLines} disabled={isGenerating}>
                          {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          ยืนยันเพิ่ม {genResult.lines.length} รายการ
                        </Button>
                      </div>
                    </CardFooter>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="info" className="mt-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>ข้อมูลหัวเอกสาร (Header Information)</CardTitle>
                    </div>
                    {note.status === 'DRAFT' && (
                      <Button variant="outline" onClick={() => setIsEditingEditingHeader(!isEditingHeader)}>
                        {isEditingHeader ? 'ยกเลิก' : 'แก้ไขข้อมูล'}
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label>เลขที่ใบวางบิล</Label>
                        <Input disabled value={note.billingNoteNo} />
                      </div>
                      <div className="space-y-2">
                        <Label>ลูกค้า</Label>
                        <Input disabled value={customer?.name || ''} />
                      </div>
                      <div className="space-y-2">
                        <Label>วันที่วางบิล</Label>
                        <DatePickerThaiBE
                          className="h-10"
                          disabled={!isEditingHeader}
                          value={htmlDateValueToTimestampMs(editedNote.billingDate)}
                          onChange={(ms) => setEditedNote({ ...editedNote, billingDate: timestampToHtmlDateValue(ms) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>วันที่ครบกำหนด</Label>
                        <DatePickerThaiBE
                          className="h-10"
                          disabled={!isEditingHeader}
                          value={htmlDateValueToTimestampMs(editedNote.dueDate)}
                          onChange={(ms) => setEditedNote({ ...editedNote, dueDate: timestampToHtmlDateValue(ms) })}
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>ภาษีหัก ณ ที่จ่าย (บาท) — หักจากยอดรวมหลัง VAT</Label>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          disabled={!isEditingHeader}
                          value={editedNote.withholdingTaxAmount ?? note.withholdingTaxAmount ?? 0}
                          onChange={(e) =>
                            setEditedNote({
                              ...editedNote,
                              withholdingTaxAmount: parseFloat(e.target.value) || 0,
                            })
                          }
                        />
                        <p className="text-[10px] text-muted-foreground">
                          ใช้สอดคล้องกับใบเสนอราคา/สัญญาและการตัดลูกหนี้เมื่อรับเงิน + หนังสือหัก ณ
                        </p>
                      </div>
                    </div>
                    {isEditingHeader && (
                      <div className="flex justify-end">
                        <Button className="gap-2 bg-primary font-bold" onClick={handleSaveHeader}><Save className="h-4 w-4" /> บันทึก</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="summary" className="mt-6">
                <Card className="max-w-2xl mx-auto border-2 border-primary/10">
                  <CardHeader className="bg-muted/30 border-b">
                    <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5 text-primary" /> สรุปยอดเงิน</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4">
                    <div className="flex justify-between items-center text-sm border-b pb-2">
                      <span className="text-muted-foreground">ยอดรวมก่อนภาษี</span>
                      <span className="font-bold">{note.currency} {note.amountBeforeTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm border-b pb-2">
                      <span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม ({note.vatPercent ?? 7}%)</span>
                      <span className="font-bold">{note.currency} {note.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    {(Number(note.withholdingTaxAmount) || 0) > 0 && (
                      <div className="flex justify-between items-center text-sm border-b pb-2 text-amber-800">
                        <span>หัก ณ ที่จ่าย</span>
                        <span className="font-bold">
                          − {note.currency}{' '}
                          {Number(note.withholdingTaxAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-lg pt-2">
                      <span className="font-black text-primary uppercase">ยอดสุทธิ</span>
                      <span className="font-black text-2xl text-primary">{note.currency} {note.netAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="history" className="mt-6">
                <Card>
                  <CardHeader><CardTitle className="text-lg flex items-center gap-2"><History className="h-5 w-5" /> Audit Log</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative">
                      <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-primary" />
                      <div className="text-sm">
                        <p className="font-bold uppercase">Created</p>
                        <p className="text-xs text-muted-foreground">{formatDateTimeThaiBE(note.createdAt)}</p>
                        <p className="text-xs mt-1">Initiated by {note.createdBy}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-6">
            <Card className="bg-primary text-primary-foreground shadow-lg">
              <CardHeader className="pb-4 border-b border-white/10">
                <CardTitle className="text-sm font-bold uppercase tracking-wider opacity-80">การดำเนินการ (Workflow)</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-3">
                {note.status === 'DRAFT' && (
                  <Button className="w-full bg-white text-primary hover:bg-slate-100 font-bold" onClick={() => handleUpdateStatus('ISSUED')}>
                    <CheckCircle2 className="h-4 w-4 mr-2" /> ยืนยันการออกใบวางบิล
                  </Button>
                )}
                {['ISSUED', 'SUBMITTED'].includes(note.status) && (
                  <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold" onClick={() => router.push('/tax-invoices')}>
                    <FileBadge className="h-4 w-4 mr-2" /> ไปออกใบกำกับภาษี
                  </Button>
                )}
                <Button variant="ghost" className="w-full text-white/60 hover:text-white hover:bg-white/10" onClick={() => handleUpdateStatus('CANCELLED')}>
                  <XCircle className="h-4 w-4 mr-2" /> ยกเลิกใบวางบิลนี้
                </Button>
              </CardContent>
            </Card>

            {linkedInvoices && linkedInvoices.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-bold uppercase text-muted-foreground">เอกสารที่เกี่ยวข้อง</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {linkedInvoices.map(inv => (
                    <Link key={inv.id} href={`/tax-invoices/${inv.id}`} className="flex items-center justify-between p-2 rounded hover:bg-muted group">
                      <div className="flex items-center gap-2">
                        <FileBadge className="h-3 w-3 text-primary" />
                        <span className="text-xs font-mono font-bold">{inv.taxInvoiceNo}</span>
                      </div>
                      <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card className="bg-muted/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">ข้อมูลโปรเจกต์</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-2 text-xs">
                <div className="space-y-1">
                  <p className="text-muted-foreground uppercase font-bold text-[9px]">ลูกค้า:</p>
                  <p className="font-bold flex items-center gap-1"><Building2 className="h-3 w-3" /> {customer?.name}</p>
                </div>
                <Separator />
                <div className="space-y-1">
                  <p className="text-muted-foreground uppercase font-bold text-[9px]">ยอดเรียกเก็บสุทธิ:</p>
                  <p className="text-lg font-black text-primary">{note.currency} {note.netAmount.toLocaleString()}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
