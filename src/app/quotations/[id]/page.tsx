
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
  History,
  Info,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Briefcase,
  Printer,
  Edit2,
  Calculator,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection, updateDoc, writeBatch } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Quotation, QuotationLine, QuotationStatus, User, Customer } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { PageGuidance } from '@/components/layout/page-guidance';

export default function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const quotationRef = useMemoFirebase(() => (firestore ? doc(firestore, 'quotations', id) : null), [firestore, id]);
  const { data: quotation, isLoading: isQuoLoading } = useDoc<Quotation>(quotationRef as any);

  const linesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'quotations', id, 'lines') : null), [firestore, id]);
  const { data: lines, isLoading: isLinesLoading } = useCollection<QuotationLine>(linesQuery as any);

  const customerRef = useMemoFirebase(() => (firestore && quotation ? doc(firestore, 'customers', quotation.customerId) : null), [firestore, quotation?.customerId]);
  const { data: customer } = useDoc<Customer>(customerRef as any);

  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [editedHeader, setEditedHeader] = useState<Partial<Quotation>>({});
  
  const [isLineDialogOpen, setIsLineDialogOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<Partial<QuotationLine> | null>(null);

  useEffect(() => {
    if (quotation) setEditedHeader(quotation);
  }, [quotation]);

  const handleSaveHeader = () => {
    if (!quotationRef) return;
    updateDocumentNonBlocking(quotationRef, { ...editedHeader, updatedAt: Date.now() });
    setIsEditingHeader(false);
    toast({ title: "บันทึกหัวเอกสารสำเร็จ" });
  };

  const handleUpdateStatus = (newStatus: QuotationStatus) => {
    if (!quotationRef) return;
    updateDocumentNonBlocking(quotationRef, { status: newStatus, updatedAt: Date.now() });
    toast({ title: "อัปเดตสถานะสำเร็จ", description: `เปลี่ยนสถานะเป็น ${newStatus}` });
  };

  const handleOpenAddLine = () => {
    setEditingLine({ description: '', quantity: 1, unit: 'EA', unitPrice: 0, remarks: '', displayOrder: (lines?.length || 0) + 1 });
    setIsLineDialogOpen(true);
  };

  const handleOpenEditLine = (line: QuotationLine) => {
    setEditingLine({ ...line });
    setIsLineDialogOpen(true);
  };

  const handleSaveLine = async () => {
    if (!firestore || !editingLine?.description) return;
    
    const lineTotal = (Number(editingLine.quantity) || 0) * (Number(editingLine.unitPrice) || 0);
    const lineData = {
      ...editingLine,
      lineTotal,
      updatedAt: Date.now()
    };

    if (editingLine.id) {
      // Update existing
      const lineRef = doc(firestore, 'quotations', id, 'lines', editingLine.id);
      updateDocumentNonBlocking(lineRef, lineData);
      
      // Local recalculation for immediate feedback
      const updatedLines = lines?.map(l => l.id === editingLine.id ? { ...l, ...lineData } : l) || [];
      recalculateTotal(updatedLines as QuotationLine[]);
    } else {
      // Add new
      const linesColRef = collection(firestore, 'quotations', id, 'lines');
      await addDocumentNonBlocking(linesColRef, {
        ...lineData,
        quotationId: id,
        createdAt: Date.now()
      });
      
      const updatedLines = [...(lines || []), { ...lineData } as QuotationLine];
      recalculateTotal(updatedLines);
    }

    setIsLineDialogOpen(false);
    setEditingLine(null);
    toast({ title: "บันทึกรายการสำเร็จ" });
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!firestore) return;
    await deleteDocumentNonBlocking(doc(firestore, 'quotations', id, 'lines', lineId));
    recalculateTotal(lines?.filter(l => l.id !== lineId) || []);
    toast({ title: "ลบรายการสำเร็จ" });
  };

  const handleMoveLine = async (line: QuotationLine, direction: 'up' | 'down') => {
    if (!firestore || !lines) return;
    
    const sortedLines = [...lines].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    const currentIndex = sortedLines.findIndex(l => l.id === line.id);
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    if (newIndex < 0 || newIndex >= sortedLines.length) return;

    const otherLine = sortedLines[newIndex];
    const batch = writeBatch(firestore);
    
    const lineRef = doc(firestore, 'quotations', id, 'lines', line.id);
    const otherRef = doc(firestore, 'quotations', id, 'lines', otherLine.id);

    batch.update(lineRef, { displayOrder: otherLine.displayOrder || 0 });
    batch.update(otherRef, { displayOrder: line.displayOrder || 0 });

    await batch.commit();
  };

  const recalculateTotal = (currentLines: QuotationLine[]) => {
    if (!quotationRef || !quotation) return;
    const subtotal = currentLines.reduce((sum, l) => sum + (Number(l.lineTotal) || 0), 0);
    const taxPercent = quotation.taxPercent || 7;
    const discountAmount = quotation.discountAmount || 0;
    const taxAmount = (subtotal - discountAmount) * (taxPercent / 100);
    const grandTotal = subtotal - discountAmount + taxAmount;
    
    updateDoc(quotationRef, { 
      subtotal, 
      taxAmount, 
      grandTotal, 
      updatedAt: Date.now() 
    });
  };

  if (isQuoLoading || !quotation || !currentUser) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 text-primary animate-spin" /></div>;
  }

  const sortedLines = lines?.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)) || [];

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between print:hidden">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/quotations')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex flex-col">
              <h1 className="text-2xl font-bold tracking-tight">Quotation Workspace (ระบบจัดการใบเสนอราคา)</h1>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{quotation.quotationNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>ลูกค้า: {quotation.customerNameSnapshot || '...'}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> พิมพ์ (Print)
            </Button>
            <Badge variant="outline" className="py-1.5 px-4 font-bold border-primary/20 bg-primary/5 text-primary uppercase">
              STATUS: {quotation.status}
            </Badge>
          </div>
        </div>

        <Tabs defaultValue="edit" className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-fit h-auto p-1 bg-muted/50 print:hidden">
            <TabsTrigger value="edit" className="gap-2 py-2 px-8"><Edit2 className="h-4 w-4" /> แก้ไขข้อมูล (Edit)</TabsTrigger>
            <TabsTrigger value="preview" className="gap-2 py-2 px-8"><FileText className="h-4 w-4" /> พรีวิวเอกสาร (Preview)</TabsTrigger>
            <TabsTrigger value="history" className="gap-2 py-2 px-8"><History className="h-4 w-4" /> ประวัติ (History)</TabsTrigger>
          </TabsList>

          <TabsContent value="edit" className="mt-6 space-y-6 print:hidden">
            <PageGuidance 
              title="ขั้นตอนการทำงาน (Quotation Workflow)"
              tips={[
                "ระบุข้อมูลหัวเอกสารและลูกค้าให้ครบถ้วนก่อนเพิ่มรายการบริการ",
                "รายการบริการจะถูกคำนวณภาษีมูลค่าเพิ่ม (VAT 7%) โดยอัตโนมัติจากยอด Subtotal",
                "เมื่อเอกสารพร้อมแล้ว ให้เปลี่ยนสถานะเป็น 'sent' เพื่อเตรียมส่งให้ลูกค้าพิจารณา",
                "คุณสามารถจัดลำดับรายการได้โดยใช้ปุ่มขึ้น/ลง ในตารางรายการบริการ"
              ]}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                    <div>
                      <CardTitle>ข้อมูลหัวเอกสาร (Header Info)</CardTitle>
                      <CardDescription>รายละเอียดลูกค้าและวันที่กำหนด</CardDescription>
                    </div>
                    <Button variant="ghost" onClick={() => setIsEditingHeader(!isEditingHeader)}>
                      {isEditingHeader ? 'ยกเลิก' : 'แก้ไข'}
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2 col-span-2">
                        <Label className="font-bold">หัวข้อโครงการ (Project Title)</Label>
                        <Input disabled={!isEditingHeader} value={editedHeader.projectTitle || ''} onChange={e => setEditedHeader({...editedHeader, projectTitle: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">วันที่ออกเอกสาร (Issue Date)</Label>
                        <Input type="date" disabled={!isEditingHeader} value={editedHeader.issueDate || ''} onChange={e => setEditedHeader({...editedHeader, issueDate: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">วันหมดอายุข้อเสนอ (Valid Until)</Label>
                        <Input type="date" disabled={!isEditingHeader} value={editedHeader.validUntilDate || ''} onChange={e => setEditedHeader({...editedHeader, validUntilDate: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">รหัสอ้างอิงลูกค้า (Ref No.)</Label>
                        <Input disabled={!isEditingHeader} value={editedHeader.referenceNo || ''} onChange={e => setEditedHeader({...editedHeader, referenceNo: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">ผู้ติดต่อฝั่งลูกค้า (Contact Person)</Label>
                        <Input disabled={!isEditingHeader} value={editedHeader.contactPerson || ''} onChange={e => setEditedHeader({...editedHeader, contactPerson: e.target.value})} />
                      </div>
                    </div>
                    {isEditingHeader && (
                      <div className="flex justify-end pt-2">
                        <Button className="gap-2 bg-primary font-bold shadow-md" onClick={handleSaveHeader}><Save className="h-4 w-4" /> บันทึกหัวเอกสาร</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                    <div>
                      <CardTitle>รายการบริการ (Quotation Lines)</CardTitle>
                      <CardDescription>ระบุรายการสินค้าหรือบริการที่นำเสนอ</CardDescription>
                    </div>
                    <Button className="bg-primary font-bold shadow-md" onClick={handleOpenAddLine}>
                      <Plus className="h-4 w-4 mr-2" /> เพิ่มรายการ
                    </Button>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead className="pl-6 w-[50px]">ลำดับ</TableHead>
                          <TableHead>รายละเอียด</TableHead>
                          <TableHead className="text-right">จำนวน</TableHead>
                          <TableHead className="text-right">ราคา/หน่วย</TableHead>
                          <TableHead className="text-right font-bold">รวม</TableHead>
                          <TableHead className="text-right pr-6">จัดการ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedLines.map((line, index) => (
                          <TableRow key={line.id} className="group">
                            <TableCell className="pl-6 text-xs text-muted-foreground text-center">
                              {index + 1}
                            </TableCell>
                            <TableCell className="text-sm font-medium">
                              <div className="flex flex-col">
                                <span>{line.description}</span>
                                {line.remarks && <span className="text-[10px] text-muted-foreground italic">{line.remarks}</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="font-bold">{line.quantity}</span> <span className="text-[10px] text-muted-foreground uppercase">{line.unit}</span>
                            </TableCell>
                            <TableCell className="text-right">฿{(line.unitPrice || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right font-bold text-primary">฿{(line.lineTotal || 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right pr-6">
                              <div className="flex justify-end items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleMoveLine(line, 'up')} disabled={index === 0}>
                                  <ArrowUp className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleMoveLine(line, 'down')} disabled={index === sortedLines.length - 1}>
                                  <ArrowDown className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => handleOpenEditLine(line)}>
                                  <Edit2 className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteLine(line.id)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {(!lines || lines.length === 0) && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">ยังไม่มีรายการ กรุณากดเพิ่มรายการ</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card className="bg-primary text-primary-foreground shadow-lg overflow-hidden border-none">
                  <CardHeader className="pb-4 border-b border-white/10">
                    <CardTitle className="text-sm font-bold uppercase tracking-wider opacity-80">การดำเนินการ (Workflow)</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-3">
                    {quotation.status === 'draft' && (
                      <Button className="w-full bg-white text-primary hover:bg-slate-100 font-bold" onClick={() => handleUpdateStatus('sent')}>
                        <CheckCircle2 className="h-4 w-4 mr-2" /> ส่งให้ลูกค้า (Mark as Sent)
                      </Button>
                    )}
                    {quotation.status === 'sent' && (
                      <>
                        <Button className="w-full bg-green-600 hover:bg-green-700 text-white font-bold" onClick={() => handleUpdateStatus('accepted')}>
                          <CheckCircle2 className="h-4 w-4 mr-2" /> ลูกค้าตอบรับ (Accepted)
                        </Button>
                        <Button variant="outline" className="w-full bg-transparent border-white/20 text-white hover:bg-white/10" onClick={() => handleUpdateStatus('rejected')}>
                          <XCircle className="h-4 w-4 mr-2" /> ลูกค้าปฏิเสธ (Rejected)
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" className="w-full text-white/60 hover:text-white hover:bg-white/10" onClick={() => handleUpdateStatus('cancelled')}>
                      ยกเลิกใบเสนอราคา
                    </Button>
                  </CardContent>
                </Card>

                <Card className="border-primary/10 shadow-md">
                  <CardHeader className="bg-muted/30 border-b">
                    <CardTitle className="text-base flex items-center gap-2 font-bold text-primary">
                      <Calculator className="h-5 w-5" /> สรุปมูลค่า (Summary)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">รวมยอดสินค้า (Subtotal):</span>
                      <span className="font-bold">฿{(quotation.subtotal || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">ส่วนลด (Discount):</span>
                      <div className="flex items-center gap-2">
                        <Input 
                          type="number" 
                          className="h-7 w-24 text-right text-xs font-bold text-red-600"
                          value={editedHeader.discountAmount || 0}
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0;
                            setEditedHeader({...editedHeader, discountAmount: val});
                            // Delayed auto-save for the discount field
                            const timer = setTimeout(() => {
                              updateDoc(quotationRef!, { discountAmount: val, updatedAt: Date.now() });
                              recalculateTotal(lines || []);
                            }, 500);
                            return () => clearTimeout(timer);
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม ({quotation.taxPercent || 7}%):</span>
                      <span className="font-bold">฿{(quotation.taxAmount || 0).toLocaleString()}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between text-lg">
                      <span className="font-black text-primary uppercase">ยอดสุทธิ (Net Total):</span>
                      <span className="font-black text-2xl text-primary">฿{(quotation.grandTotal || 0).toLocaleString()}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-bold uppercase text-muted-foreground">หมายเหตุและเงื่อนไข (Terms)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground">ข้อความในเอกสาร (Notes on Doc)</Label>
                      <Textarea 
                        placeholder="ระบุเงื่อนไขการเสนอราคา..." 
                        className="text-xs min-h-[80px]"
                        value={editedHeader.notes || ''}
                        onChange={e => setEditedHeader({...editedHeader, notes: e.target.value})}
                        onBlur={handleSaveHeader}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground">บันทึกภายใน (Internal Notes)</Label>
                      <Textarea 
                        placeholder="สำหรับดูเฉพาะเจ้าหน้าที่..." 
                        className="text-xs min-h-[80px] bg-amber-50/30"
                        value={editedHeader.internalNotes || ''}
                        onChange={e => setEditedHeader({...editedHeader, internalNotes: e.target.value})}
                        onBlur={handleSaveHeader}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="mt-6">
            <div className="bg-white border rounded-lg shadow-xl max-w-[21cm] mx-auto p-12 space-y-10 min-h-[29.7cm] font-serif text-slate-900 overflow-hidden">
              <div className="flex justify-between items-start border-b-4 border-primary pb-6">
                <div className="space-y-1">
                  <h2 className="text-3xl font-black text-primary uppercase tracking-tighter">OPEC OpsFlow</h2>
                  <p className="text-xs font-bold text-slate-500 uppercase">Enterprise Manpower Supply Operations</p>
                </div>
                <div className="text-right space-y-1">
                  <h3 className="text-2xl font-black uppercase text-slate-800">Quotation</h3>
                  <p className="font-mono text-sm font-bold text-primary">{quotation.quotationNo}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-12 text-sm">
                <div className="space-y-3">
                  <p className="font-black text-xs uppercase tracking-widest text-slate-400 border-b pb-1">Issued To:</p>
                  <div className="space-y-1">
                    <p className="font-bold text-lg">{quotation.customerNameSnapshot}</p>
                    <p className="text-slate-600 leading-relaxed">{quotation.billingAddressSnapshot || 'N/A'}</p>
                    <p className="text-slate-600">Contact: {quotation.contactPerson || '-'}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="font-black text-xs uppercase tracking-widest text-slate-400 border-b pb-1">Document Dates:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <span className="text-slate-500">Date Issued:</span>
                    <span className="font-bold text-right">{quotation.issueDate}</span>
                    <span className="text-slate-500">Valid Until:</span>
                    <span className="font-bold text-right text-red-600">{quotation.validUntilDate}</span>
                    <span className="text-slate-500">Currency:</span>
                    <span className="font-bold text-right">{quotation.currency}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-4 border rounded">
                <p className="text-xs font-black uppercase text-slate-400 mb-1">Subject / Project:</p>
                <p className="font-bold text-lg text-primary">{quotation.projectTitle}</p>
              </div>

              <div className="space-y-4">
                <Table className="border-collapse">
                  <TableHeader className="bg-slate-100 border-y-2 border-slate-300">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="font-black text-slate-800 py-4">Item Description</TableHead>
                      <TableHead className="text-right font-black text-slate-800 w-[80px]">Qty</TableHead>
                      <TableHead className="text-center font-black text-slate-800 w-[80px]">Unit</TableHead>
                      <TableHead className="text-right font-black text-slate-800 w-[120px]">Unit Price</TableHead>
                      <TableHead className="text-right font-black text-slate-800 w-[120px]">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedLines.map(line => (
                      <TableRow key={line.id} className="border-b border-slate-100 hover:bg-transparent">
                        <TableCell className="py-4">
                          <div className="flex flex-col">
                            <span className="font-medium">{line.description}</span>
                            {line.remarks && <span className="text-[10px] text-slate-500 italic mt-0.5">{line.remarks}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{line.quantity}</TableCell>
                        <TableCell className="text-center text-xs">{line.unit}</TableCell>
                        <TableCell className="text-right">฿{(line.unitPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right font-bold text-slate-800">฿{(line.lineTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end pt-6">
                <div className="w-[300px] space-y-2 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal:</span>
                    <span className="font-bold text-slate-800">฿{(quotation.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  {(quotation.discountAmount || 0) > 0 && (
                    <div className="flex justify-between text-red-600 font-bold">
                      <span>Discount:</span>
                      <span>- ฿{(quotation.discountAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-600">
                    <span>VAT ({quotation.taxPercent || 7}%):</span>
                    <span className="font-bold text-slate-800">฿{(quotation.taxAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-xl border-t-2 border-slate-800 pt-2">
                    <span className="font-black text-primary">Grand Total:</span>
                    <span className="font-black text-primary underline decoration-double">฿{(quotation.grandTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              <div className="pt-12 space-y-4">
                <p className="text-xs font-black uppercase text-slate-400 border-b pb-1">Notes & Conditions:</p>
                <p className="text-xs text-slate-600 leading-relaxed italic whitespace-pre-line">
                  {quotation.notes || 'No special conditions mentioned. This quotation is subject to standard manpower supply terms and conditions of OPEC.'}
                </p>
              </div>

              <div className="pt-24 grid grid-cols-2 gap-24">
                <div className="border-t border-slate-300 pt-4 text-center space-y-1">
                  <p className="font-black text-[10px] uppercase text-slate-400 mb-12">Authorized Signature (Issuer)</p>
                  <p className="font-bold text-sm text-slate-800">{quotation.createdBy}</p>
                  <p className="text-[10px] text-slate-500 uppercase">OPEC Sales Management</p>
                </div>
                <div className="border-t border-slate-300 pt-4 text-center space-y-1">
                  <p className="font-black text-[10px] uppercase text-slate-400 mb-12">Customer Acceptance</p>
                  <div className="h-4" />
                  <p className="text-[10px] text-slate-500 uppercase">Seal & Signature</p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-6 print:hidden">
            <Card>
              <CardHeader><CardTitle>ประวัติการเปลี่ยนแปลง (Audit Log)</CardTitle></CardHeader>
              <CardContent className="space-y-6 py-10">
                <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative pb-4">
                  <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-primary" />
                  <div className="text-sm">
                    <p className="font-bold uppercase">LATEST STATUS: {quotation.status}</p>
                    <p className="text-xs text-muted-foreground">{new Date(quotation.updatedAt).toLocaleString('th-TH')}</p>
                    <p className="text-xs mt-1">Edited by {quotation.updatedBy || 'System'}</p>
                  </div>
                </div>
                <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative">
                  <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-slate-300" />
                  <div className="text-sm">
                    <p className="font-bold uppercase text-muted-foreground">DOCUMENT CREATED</p>
                    <p className="text-xs text-muted-foreground">{new Date(quotation.createdAt).toLocaleString('th-TH')}</p>
                    <p className="text-xs mt-1">Initiated by {quotation.createdBy}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Line Item Editor Dialog */}
        <Dialog open={isLineDialogOpen} onOpenChange={setIsLineDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {editingLine?.id ? <Edit2 className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                {editingLine?.id ? 'แก้ไขรายการบริการ' : 'เพิ่มรายการใหม่'}
              </DialogTitle>
              <DialogDescription>ระบุรายละเอียดสินค้าหรือบริการและราคาเพื่อนำไปพรีวิวในเอกสาร</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="font-bold">รายละเอียดรายการ (Description) *</Label>
                <Input 
                  value={editingLine?.description || ''} 
                  onChange={e => setEditingLine({...editingLine, description: e.target.value})} 
                  placeholder="เช่น ค่าแรงช่างเชื่อม (Welder) ประจำเดือน..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="font-bold">จำนวน (Qty)</Label>
                  <Input 
                    type="number" 
                    value={editingLine?.quantity || 0} 
                    onChange={e => setEditingLine({...editingLine, quantity: parseFloat(e.target.value) || 0})} 
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">หน่วย (Unit)</Label>
                  <Input 
                    value={editingLine?.unit || ''} 
                    onChange={e => setEditingLine({...editingLine, unit: e.target.value})} 
                    placeholder="EA, Days, Hrs"
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label className="font-bold text-blue-700">ราคาต่อหน่วย (Unit Price)</Label>
                  <Input 
                    type="number" 
                    className="font-black text-lg"
                    value={editingLine?.unitPrice || 0} 
                    onChange={e => setEditingLine({...editingLine, unitPrice: parseFloat(e.target.value) || 0})} 
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="font-bold">หมายเหตุรายการ (Item Remarks)</Label>
                <Input 
                  value={editingLine?.remarks || ''} 
                  onChange={e => setEditingLine({...editingLine, remarks: e.target.value})} 
                  placeholder="ระบุข้อมูลเพิ่มเติมเฉพาะรายการนี้..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsLineDialogOpen(false)}>ยกเลิก</Button>
              <Button onClick={handleSaveLine} disabled={!editingLine?.description} className="bg-primary font-bold shadow-md">
                <Save className="h-4 w-4 mr-2" /> บันทึกรายการ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print-container, .print-container * {
            visibility: visible;
          }
          .print-container {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          header, .sidebar, .print\\:hidden, [role="tablist"], button {
            display: none !important;
          }
          [data-state="active"] > div {
            display: block !important;
            visibility: visible !important;
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
          }
          .main-content {
            margin: 0 !important;
            padding: 0 !important;
          }
        }
      `}</style>
    </AppShell>
  );
}
