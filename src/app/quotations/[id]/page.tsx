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
  ArrowDown,
  Tag,
  SearchCheck,
  Send,
  RefreshCw,
  Lock
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

  // --- Data Subscription ---
  const quotationRef = useMemoFirebase(() => (firestore ? doc(firestore, 'quotations', id) : null), [firestore, id]);
  const { data: quotation, isLoading: isQuoLoading } = useDoc<Quotation>(quotationRef as any);

  const linesQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'quotations', id, 'lines') : null), [firestore, id]);
  const { data: lines, isLoading: isLinesLoading } = useCollection<QuotationLine>(linesQuery as any);

  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [editedHeader, setEditedHeader] = useState<Partial<Quotation>>({});
  
  const [isLineDialogOpen, setIsLineDialogOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<Partial<QuotationLine> | null>(null);

  useEffect(() => {
    if (quotation) setEditedHeader(quotation);
  }, [quotation]);

  // --- Workflow Logic ---
  const isDraft = quotation?.status === 'draft';
  const isSent = quotation?.status === 'sent';
  const isFinalized = quotation ? ['accepted', 'rejected', 'cancelled', 'expired'].includes(quotation.status) : false;
  const isEditable = isDraft;

  // --- Handlers: Header ---
  const handleSaveHeader = () => {
    if (!quotationRef || !isEditable) return;
    updateDocumentNonBlocking(quotationRef, { ...editedHeader, updatedAt: Date.now() });
    setIsEditingHeader(false);
    toast({ title: "บันทึกหัวเอกสารสำเร็จ (Header Saved)" });
  };

  const handleUpdateStatus = (newStatus: QuotationStatus) => {
    if (!quotationRef) return;
    updateDocumentNonBlocking(quotationRef, { status: newStatus, updatedAt: Date.now() });
    
    let msg = `เปลี่ยนสถานะเป็น ${newStatus.toUpperCase()}`;
    if (newStatus === 'sent') msg = "ทำเครื่องหมายว่าส่งเอกสารแล้ว (Marked as Sent)";
    if (newStatus === 'accepted') msg = "ลูกค้ายืนยันตกลง (Client Accepted)";
    
    toast({ title: "อัปเดตสถานะสำเร็จ", description: msg });
  };

  // --- Handlers: Line Items ---
  const handleOpenAddLine = () => {
    if (!isEditable) return;
    setEditingLine({ 
      description: '', 
      quantity: 1, 
      unit: 'EA', 
      unitPrice: 0, 
      remarks: '', 
      displayOrder: (lines?.length || 0) + 1 
    });
    setIsLineDialogOpen(true);
  };

  const handleOpenEditLine = (line: QuotationLine) => {
    if (!isEditable) return;
    setEditingLine({ ...line });
    setIsLineDialogOpen(true);
  };

  const handleSaveLine = async () => {
    if (!firestore || !editingLine?.description || !isEditable) return;
    
    const qty = Number(editingLine.quantity) || 0;
    const price = Number(editingLine.unitPrice) || 0;
    const lineTotal = qty * price;
    
    const lineData = {
      ...editingLine,
      quantity: qty,
      unitPrice: price,
      lineTotal,
      updatedAt: Date.now()
    };

    if (editingLine.id) {
      const lineRef = doc(firestore, 'quotations', id, 'lines', editingLine.id);
      updateDocumentNonBlocking(lineRef, lineData);
      
      const updatedLines = lines?.map(l => l.id === editingLine.id ? { ...l, ...lineData } : l) || [];
      recalculateTotal(updatedLines as QuotationLine[]);
    } else {
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
    toast({ title: "บันทึกรายการสำเร็จ (Item Saved)" });
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!firestore || !isEditable) return;
    if (!confirm('ยืนยันการลบรายการนี้?')) return;
    
    await deleteDocumentNonBlocking(doc(firestore, 'quotations', id, 'lines', lineId));
    recalculateTotal(lines?.filter(l => l.id !== lineId) || []);
    toast({ title: "ลบรายการสำเร็จ" });
  };

  const handleMoveLine = async (line: QuotationLine, direction: 'up' | 'down') => {
    if (!firestore || !lines || !isEditable) return;
    
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
        {/* Page Header */}
        <div className="flex items-center justify-between print:hidden">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/quotations')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex flex-col">
              <h1 className="text-2xl font-bold tracking-tight">Quotation Workspace (ระบบจัดการใบเสนอราคา)</h1>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-primary">{quotation.quotationNo}</span>
                <Separator orientation="vertical" className="h-3" />
                <span className="text-sm text-muted-foreground">ลูกค้า: {quotation.customerNameSnapshot || '...'}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> พิมพ์ (Print)
            </Button>
            <Badge variant={isFinalized ? "default" : "outline"} className={`py-1.5 px-4 font-bold uppercase ${isFinalized ? "bg-slate-900" : "border-primary/20 bg-primary/5 text-primary"}`}>
              {isFinalized && <Lock className="h-3 w-3 mr-2" />}
              STATUS: {quotation.status}
            </Badge>
          </div>
        </div>

        <Tabs defaultValue="edit" className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-fit h-auto p-1 bg-muted/50 print:hidden">
            <TabsTrigger value="edit" className="gap-2 py-2 px-8"><Edit2 className="h-4 w-4" /> {isEditable ? 'แก้ไขข้อมูล (Edit)' : 'ดูรายละเอียด (View)'}</TabsTrigger>
            <TabsTrigger value="preview" className="gap-2 py-2 px-8"><FileText className="h-4 w-4" /> พรีวิวเอกสาร (Preview)</TabsTrigger>
            <TabsTrigger value="history" className="gap-2 py-2 px-8"><History className="h-4 w-4" /> ประวัติ (History)</TabsTrigger>
          </TabsList>

          <TabsContent value="edit" className="mt-6 space-y-6 print:hidden">
            <PageGuidance 
              title="สถานะปัจจุบัน (Document Stage)"
              tips={[
                isDraft ? "ฉบับร่าง (Draft): ท่านสามารถแก้ไขรายการและหัวเอกสารได้ตามต้องการ" : 
                isSent ? "ส่งแล้ว (Sent): เอกสารส่งให้ลูกค้าแล้ว ไม่สามารถแก้ไขได้โดยตรง หากต้องการแก้ไขกรุณากด 'Revise' เพื่อกลับไปสถานะร่าง" :
                "สิ้นสุด (Finalized): เอกสารนี้ถูกปิดสถานะแล้ว ไม่สามารถแก้ไขข้อมูลได้อีก"
              ]}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Header Information Card */}
                <Card className="shadow-sm border-none bg-white">
                  <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Tag className="h-5 w-5 text-primary" /> ข้อมูลหัวเอกสาร (Header Info)
                      </CardTitle>
                    </div>
                    {isEditable && (
                      <Button variant="ghost" size="sm" onClick={() => setIsEditingHeader(!isEditingHeader)}>
                        {isEditingHeader ? 'ยกเลิก' : 'แก้ไข'}
                      </Button>
                    )}
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
                    </div>
                    {isEditingHeader && (
                      <div className="flex justify-end pt-2">
                        <Button className="gap-2 bg-primary font-bold shadow-md" onClick={handleSaveHeader}><Save className="h-4 w-4" /> บันทึกหัวเอกสาร</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Line Item Editor Table */}
                <Card className="shadow-sm border-none bg-white overflow-hidden">
                  <CardHeader className="flex flex-row items-center justify-between border-b pb-4 bg-muted/5">
                    <div>
                      <CardTitle className="text-lg">รายการบริการ (Quotation Lines)</CardTitle>
                      <CardDescription>ระบุรายละเอียดสินค้าหรือบริการและราคาเสนอขาย</CardDescription>
                    </div>
                    {isEditable && (
                      <Button className="bg-primary font-bold shadow-md h-10" onClick={handleOpenAddLine}>
                        <Plus className="h-4 w-4 mr-2" /> เพิ่มรายการ (Add Item)
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="pl-6 w-[60px] text-center">#</TableHead>
                          <TableHead>รายละเอียด (Description)</TableHead>
                          <TableHead className="text-center w-[100px]">จำนวน/หน่วย</TableHead>
                          <TableHead className="text-right w-[140px]">ราคา/หน่วย</TableHead>
                          <TableHead className="text-right w-[140px] font-bold">ยอดรวม</TableHead>
                          <TableHead className="text-right pr-6 w-[140px]">จัดการ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedLines.map((line, index) => (
                          <TableRow key={line.id} className="group hover:bg-muted/10 transition-colors">
                            <TableCell className="pl-6 text-xs text-muted-foreground text-center font-mono">
                              {index + 1}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-bold text-sm text-primary">{line.description}</span>
                                {line.remarks && <span className="text-[10px] text-muted-foreground italic truncate max-w-[200px]">{line.remarks}</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="text-sm font-bold">{line.quantity}</span> <span className="text-[10px] text-muted-foreground uppercase font-medium">{line.unit}</span>
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium">
                              ฿{(line.unitPrice || 0).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-black text-primary">
                              ฿{(line.lineTotal || 0).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              {isEditable && (
                                <div className="flex justify-end items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => handleMoveLine(line, 'up')} disabled={index === 0}>
                                    <ArrowUp className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => handleMoveLine(line, 'down')} disabled={index === sortedLines.length - 1}>
                                    <ArrowDown className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => handleOpenEditLine(line)}>
                                    <Edit2 className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteLine(line.id)}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {(!lines || lines.length === 0) && !isLinesLoading && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">
                              <div className="flex flex-col items-center gap-2">
                                <Briefcase className="h-10 w-10 opacity-10" />
                                <p>ยังไม่มีรายการสินค้า/บริการในใบเสนอราคานี้</p>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                {/* Workflow Actions */}
                <Card className="bg-primary text-primary-foreground shadow-lg overflow-hidden border-none">
                  <CardHeader className="pb-4 border-b border-white/10">
                    <CardTitle className="text-sm font-bold uppercase tracking-wider opacity-80">การดำเนินการ (Workflow)</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-3">
                    {isDraft && (
                      <Button className="w-full bg-white text-primary hover:bg-slate-100 font-bold" onClick={() => handleUpdateStatus('sent')}>
                        <Send className="h-4 w-4 mr-2" /> ส่งให้ลูกค้า (Mark as Sent)
                      </Button>
                    )}
                    
                    {isSent && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <Button className="bg-green-600 hover:bg-green-700 font-bold text-xs" onClick={() => handleUpdateStatus('accepted')}>
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Accepted
                          </Button>
                          <Button variant="outline" className="bg-transparent border-white/20 text-white hover:bg-white/10 text-xs" onClick={() => handleUpdateStatus('rejected')}>
                            <XCircle className="h-3 w-3 mr-1" /> Rejected
                          </Button>
                        </div>
                        <Separator className="bg-white/10" />
                        <Button variant="ghost" className="w-full text-white/60 hover:text-white hover:bg-white/10 text-xs" onClick={() => handleUpdateStatus('draft')}>
                          <RefreshCw className="h-3 w-3 mr-2" /> เปิดเพื่อแก้ไข (Revise Draft)
                        </Button>
                      </>
                    )}

                    {!isFinalized && (
                      <Button variant="ghost" className="w-full text-white/60 hover:text-white hover:bg-white/10 text-xs" onClick={() => handleUpdateStatus('cancelled')}>
                        <Trash2 className="h-3 w-3 mr-2" /> ยกเลิกใบเสนอราคา
                      </Button>
                    )}

                    {isFinalized && (
                      <div className="text-center py-4 bg-white/5 rounded-lg border border-dashed border-white/10">
                        <Lock className="h-5 w-5 mx-auto mb-2 opacity-40" />
                        <p className="text-[10px] uppercase font-black tracking-widest opacity-60">Status Finalized</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Financial Summary Card */}
                <Card className="border-none shadow-md bg-white overflow-hidden">
                  <CardHeader className="bg-muted/30 border-b">
                    <CardTitle className="text-base flex items-center gap-2 font-bold text-primary">
                      <Calculator className="h-5 w-5" /> สรุปมูลค่า (Summary)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-3 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">ยอดรวมสินค้า (Subtotal):</span>
                      <span className="font-bold">฿{(quotation.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between items-center group">
                      <span className="text-muted-foreground">ส่วนลด (Discount):</span>
                      <div className="flex items-center gap-2">
                        {isEditable && <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity italic">แก้ไข {'>'}</span>}
                        <Input 
                          disabled={!isEditable}
                          type="number" 
                          className={`h-8 w-28 text-right text-xs font-bold text-red-600 ${isEditable ? 'border-dashed' : 'border-none bg-transparent'}`}
                          value={editedHeader.discountAmount || 0}
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0;
                            setEditedHeader({...editedHeader, discountAmount: val});
                            updateDoc(quotationRef!, { discountAmount: val, updatedAt: Date.now() });
                            recalculateTotal(lines || []);
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม ({quotation.taxPercent || 7}%):</span>
                      <span className="font-bold">฿{(quotation.taxAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between items-end">
                      <span className="font-black text-primary uppercase text-[10px] tracking-widest">ยอดสุทธิ (Grand Total)</span>
                      <span className="font-black text-2xl text-primary underline decoration-double">฿{(quotation.grandTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Technical/Commercial Notes */}
                <Card className="border-none shadow-sm bg-white">
                  <CardHeader className="pb-2 bg-muted/5 border-b">
                    <CardTitle className="text-xs font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                      <Info className="h-3 w-3" /> เงื่อนไขและหมายเหตุ (Notes)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-4">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-muted-foreground">เงื่อนไขในเอกสาร (Client Terms)</Label>
                      <Textarea 
                        disabled={!isEditable}
                        placeholder="ระบุเงื่อนไขการเสนอราคาที่ต้องการให้ลูกค้าเห็น..." 
                        className="text-xs min-h-[80px]"
                        value={editedHeader.notes || ''}
                        onChange={e => setEditedHeader({...editedHeader, notes: e.target.value})}
                        onBlur={handleSaveHeader}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-muted-foreground">บันทึกภายใน (Internal Log)</Label>
                      <Textarea 
                        disabled={!isEditable}
                        placeholder="สำหรับบันทึกเฉพาะเจ้าหน้าที่ขาย..." 
                        className="text-xs min-h-[80px] bg-muted/20"
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

          {/* Document Preview Tab */}
          <TabsContent value="preview" className="mt-6">
            <div className="bg-white border rounded-lg shadow-xl max-w-[21cm] mx-auto p-12 space-y-10 min-h-[29.7cm] font-serif text-slate-900 overflow-hidden print-container">
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
                    <p className="text-slate-600 leading-relaxed text-xs">{quotation.billingAddressSnapshot || 'N/A'}</p>
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
                <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Subject / Project Title:</p>
                <p className="font-bold text-base text-primary">{quotation.projectTitle}</p>
              </div>

              <div className="space-y-4">
                <Table className="border-collapse">
                  <TableHeader className="bg-slate-100 border-y-2 border-slate-300">
                    <TableRow className="hover:bg-transparent border-none">
                      <TableHead className="font-black text-slate-800 py-4 h-auto">Item Description</TableHead>
                      <TableHead className="text-right font-black text-slate-800 w-[80px] h-auto">Qty</TableHead>
                      <TableHead className="text-center font-black text-slate-800 w-[80px] h-auto">Unit</TableHead>
                      <TableHead className="text-right font-black text-slate-800 w-[120px] h-auto">Unit Price</TableHead>
                      <TableHead className="text-right font-black text-slate-800 w-[120px] h-auto">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedLines.map(line => (
                      <TableRow key={line.id} className="border-b border-slate-100 hover:bg-transparent">
                        <TableCell className="py-4">
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">{line.description}</span>
                            {line.remarks && <span className="text-[10px] text-slate-500 italic mt-0.5">{line.remarks}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-bold">{line.quantity}</TableCell>
                        <TableCell className="text-center text-[10px] uppercase font-bold text-slate-500">{line.unit}</TableCell>
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
                <p className="text-xs font-black uppercase text-slate-400 border-b pb-1 tracking-widest">Notes & Conditions:</p>
                <p className="text-xs text-slate-600 leading-relaxed italic whitespace-pre-line bg-slate-50 p-4 rounded border-l-4 border-slate-300">
                  {quotation.notes || 'No special conditions mentioned. This quotation is subject to standard manpower supply terms and conditions of OPEC.'}
                </p>
              </div>

              <div className="pt-24 grid grid-cols-2 gap-24">
                <div className="border-t border-slate-300 pt-4 text-center space-y-1">
                  <p className="font-black text-[10px] uppercase text-slate-400 mb-12">Authorized Signature (Issuer)</p>
                  <p className="font-bold text-sm text-slate-800">{quotation.createdBy}</p>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">OPEC Sales Management</p>
                </div>
                <div className="border-t border-slate-300 pt-4 text-center space-y-1">
                  <p className="font-black text-[10px] uppercase text-slate-400 mb-12">Customer Acceptance</p>
                  <div className="h-4" />
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Seal & Signature</p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-6 print:hidden">
            <Card className="shadow-sm border-none bg-white">
              <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" /> ประวัติกิจกรรม (Audit Log)</CardTitle></CardHeader>
              <CardContent className="space-y-6 py-10">
                <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative pb-4">
                  <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-primary" />
                  <div className="text-sm">
                    <p className="font-bold uppercase text-primary">LATEST STATUS: {quotation.status.toUpperCase()}</p>
                    <p className="text-xs text-muted-foreground">{new Date(quotation.updatedAt).toLocaleString('th-TH')}</p>
                    <p className="text-xs mt-1 font-medium">Edited by {quotation.updatedBy || 'System'}</p>
                  </div>
                </div>
                <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative">
                  <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-slate-300" />
                  <div className="text-sm">
                    <p className="font-bold uppercase text-muted-foreground">DOCUMENT CREATED</p>
                    <p className="text-xs text-muted-foreground">{new Date(quotation.createdAt).toLocaleString('th-TH')}</p>
                    <p className="text-xs mt-1 font-medium">Initiated by {quotation.createdBy}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Practical Line Item Editor Dialog */}
        <Dialog open={isLineDialogOpen} onOpenChange={setIsLineDialogOpen}>
          <DialogContent className="max-w-md border-t-8 border-t-primary">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl font-black text-primary">
                {editingLine?.id ? <Edit2 className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                {editingLine?.id ? 'แก้ไขรายการบริการ' : 'เพิ่มรายการใหม่'}
              </DialogTitle>
              <DialogDescription>ระบุรายละเอียดสินค้าหรือบริการและราคาเสนอขาย</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase text-muted-foreground">รายละเอียดรายการ (Description) *</Label>
                <Input 
                  value={editingLine?.description || ''} 
                  onChange={e => setEditingLine({...editingLine, description: e.target.value})} 
                  placeholder="เช่น ค่าแรงช่างเชื่อม (Welder) ประจำเดือน..."
                  className="h-11 font-medium"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="font-bold text-xs uppercase text-muted-foreground">จำนวน (Qty)</Label>
                  <Input 
                    type="number" 
                    value={editingLine?.quantity || 0} 
                    onChange={e => setEditingLine({...editingLine, quantity: parseFloat(e.target.value) || 0})} 
                    className="h-11 text-center font-bold"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold text-xs uppercase text-muted-foreground">หน่วย (Unit)</Label>
                  <Input 
                    value={editingLine?.unit || ''} 
                    onChange={e => setEditingLine({...editingLine, unit: e.target.value})} 
                    placeholder="EA, Days, Hrs"
                    className="h-11 text-center uppercase font-bold"
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label className="font-bold text-xs uppercase text-blue-700 tracking-wider">ราคาต่อหน่วย (Unit Price)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">฿</span>
                    <Input 
                      type="number" 
                      className="h-12 pl-8 font-black text-xl text-primary border-2 border-blue-100 focus:border-blue-500"
                      value={editingLine?.unitPrice || 0} 
                      onChange={e => setEditingLine({...editingLine, unitPrice: parseFloat(e.target.value) || 0})} 
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase text-muted-foreground">หมายเหตุรายการ (Item Remarks)</Label>
                <Input 
                  value={editingLine?.remarks || ''} 
                  onChange={e => setEditingLine({...editingLine, remarks: e.target.value})} 
                  placeholder="ระบุข้อมูลเพิ่มเติมเฉพาะรายการนี้..."
                  className="h-10 text-xs"
                />
              </div>
            </div>
            <DialogFooter className="bg-muted/30 p-4 -mx-6 -mb-6 border-t mt-4">
              <Button variant="outline" onClick={() => setIsLineDialogOpen(false)} className="h-11">ยกเลิก</Button>
              <Button onClick={handleSaveLine} disabled={!editingLine?.description} className="bg-primary font-black h-11 px-8 shadow-lg">
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
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 2cm !important;
            box-shadow: none !important;
            border: none !important;
          }
          header, nav, .sidebar, .print\\:hidden, [role="tablist"], button {
            display: none !important;
          }
        }
      `}</style>
    </AppShell>
  );
}
