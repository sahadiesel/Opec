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
  FileSignature, 
  Building2, 
  Calendar, 
  History,
  Info,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Briefcase,
  Plus,
  Trash2,
  Printer,
  Edit2,
  FileText,
  Calculator
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
  const [isAddingLine, setIsAddingLine] = useState(false);
  const [newLine, setNewLine] = useState<Partial<QuotationLine>>({ description: '', quantity: 1, unit: 'EA', unitPrice: 0 });

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

  const handleAddLine = async () => {
    if (!firestore || !newLine.description) return;
    const lineRef = collection(firestore, 'quotations', id, 'lines');
    const lineTotal = (newLine.quantity || 0) * (newLine.unitPrice || 0);
    
    await addDocumentNonBlocking(lineRef, {
      ...newLine,
      quotationId: id,
      lineTotal,
      displayOrder: (lines?.length || 0) + 1,
      createdAt: Date.now()
    });

    recalculateTotal([...(lines || []), { ...newLine, lineTotal } as any]);
    setIsAddingLine(false);
    setNewLine({ description: '', quantity: 1, unit: 'EA', unitPrice: 0 });
    toast({ title: "เพิ่มรายการสำเร็จ" });
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!firestore) return;
    await deleteDocumentNonBlocking(doc(firestore, 'quotations', id, 'lines', lineId));
    recalculateTotal(lines?.filter(l => l.id !== lineId) || []);
    toast({ title: "ลบรายการสำเร็จ" });
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

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header - Hidden on Print */}
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Header Editor */}
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
                        <Label>หัวข้อโครงการ (Project Title)</Label>
                        <Input disabled={!isEditingHeader} value={editedHeader.projectTitle || ''} onChange={e => setEditedHeader({...editedHeader, projectTitle: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label>วันที่ออกเอกสาร (Issue Date)</Label>
                        <Input type="date" disabled={!isEditingHeader} value={editedHeader.issueDate || ''} onChange={e => setEditedHeader({...editedHeader, issueDate: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label>วันหมดอายุข้อเสนอ (Valid Until)</Label>
                        <Input type="date" disabled={!isEditingHeader} value={editedHeader.validUntilDate || ''} onChange={e => setEditedHeader({...editedHeader, validUntilDate: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label>รหัสอ้างอิงลูกค้า (Ref No.)</Label>
                        <Input disabled={!isEditingHeader} value={editedHeader.referenceNo || ''} onChange={e => setEditedHeader({...editedHeader, referenceNo: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label>ผู้ติดต่อฝั่งลูกค้า (Contact Person)</Label>
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

                {/* Line Items Editor */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
                    <div>
                      <CardTitle>รายการบริการ (Quotation Lines)</CardTitle>
                      <CardDescription>ระบุรายการสินค้าหรือบริการที่นำเสนอ</CardDescription>
                    </div>
                    <Dialog open={isAddingLine} onOpenChange={setIsAddingLine}>
                      <DialogTrigger asChild>
                        <Button className="bg-primary font-bold shadow-md"><Plus className="h-4 w-4 mr-2" /> เพิ่มรายการ</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>เพิ่มรายการในใบเสนอราคา</DialogTitle></DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label>รายละเอียดรายการ (Description)</Label>
                            <Input value={newLine.description} onChange={e => setNewLine({...newLine, description: e.target.value})} />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>จำนวน (Quantity)</Label>
                              <Input type="number" value={newLine.quantity} onChange={e => setNewLine({...newLine, quantity: parseFloat(e.target.value)})} />
                            </div>
                            <div className="space-y-2">
                              <Label>หน่วย (Unit)</Label>
                              <Input value={newLine.unit} onChange={e => setNewLine({...newLine, unit: e.target.value})} placeholder="EA, Days, etc." />
                            </div>
                            <div className="space-y-2">
                              <Label>ราคาต่อหน่วย (Unit Price)</Label>
                              <Input type="number" value={newLine.unitPrice} onChange={e => setNewLine({...newLine, unitPrice: parseFloat(e.target.value)})} />
                            </div>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button onClick={handleAddLine} disabled={!newLine.description} className="bg-primary font-bold">บันทึกรายการ</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead className="pl-6">รายละเอียด</TableHead>
                          <TableHead className="text-right">จำนวน</TableHead>
                          <TableHead className="text-right">หน่วย</TableHead>
                          <TableHead className="text-right">ราคา/หน่วย</TableHead>
                          <TableHead className="text-right font-bold">รวม</TableHead>
                          <TableHead className="text-right pr-6">จัดการ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines?.sort((a,b) => (a.displayOrder || 0) - (b.displayOrder || 0)).map(line => (
                          <TableRow key={line.id}>
                            <TableCell className="pl-6 text-sm font-medium">{line.description}</TableCell>
                            <TableCell className="text-right">{line.quantity}</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">{line.unit}</TableCell>
                            <TableCell className="text-right">฿{line.unitPrice.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-bold">฿{line.lineTotal.toLocaleString()}</TableCell>
                            <TableCell className="text-right pr-6">
                              <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => handleDeleteLine(line.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
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

              {/* Sidebar: Status & Actions */}
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
                      <span className="font-bold">฿{quotation.subtotal.toLocaleString()}</span>
                    </div>
                    {quotation.discountAmount > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>ส่วนลด (Discount):</span>
                        <span className="font-bold">- ฿{quotation.discountAmount.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม ({quotation.taxPercent}%):</span>
                      <span className="font-bold">฿{quotation.taxAmount.toLocaleString()}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between text-lg">
                      <span className="font-black text-primary uppercase">ยอดสุทธิ (Total):</span>
                      <span className="font-black text-2xl text-primary">฿{quotation.grandTotal.toLocaleString()}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="mt-6">
            {/* Formal Quotation Layout */}
            <div className="bg-white border rounded-lg shadow-xl max-w-[21cm] mx-auto p-12 space-y-10 min-h-[29.7cm] font-serif text-slate-900">
              {/* Doc Header */}
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

              {/* Addresses */}
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

              {/* Title Section */}
              <div className="bg-slate-50 p-4 border rounded">
                <p className="text-xs font-black uppercase text-slate-400 mb-1">Subject / Project:</p>
                <p className="font-bold text-lg text-primary">{quotation.projectTitle}</p>
              </div>

              {/* Items Table */}
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
                    {lines?.sort((a,b) => (a.displayOrder || 0) - (b.displayOrder || 0)).map(line => (
                      <TableRow key={line.id} className="border-b border-slate-100 hover:bg-transparent">
                        <TableCell className="py-4 font-medium">{line.description}</TableCell>
                        <TableCell className="text-right">{line.quantity}</TableCell>
                        <TableCell className="text-center text-xs">{line.unit}</TableCell>
                        <TableCell className="text-right">฿{line.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right font-bold text-slate-800">฿{line.lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Footer Totals */}
              <div className="flex justify-end pt-6">
                <div className="w-[300px] space-y-2 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal:</span>
                    <span className="font-bold text-slate-800">฿{quotation.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  {quotation.discountAmount > 0 && (
                    <div className="flex justify-between text-red-600 font-bold">
                      <span>Discount:</span>
                      <span>- ฿{quotation.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-600">
                    <span>VAT ({quotation.taxPercent}%):</span>
                    <span className="font-bold text-slate-800">฿{quotation.taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-xl border-t-2 border-slate-800 pt-2">
                    <span className="font-black text-primary">Grand Total:</span>
                    <span className="font-black text-primary underline decoration-double">฿{quotation.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              {/* Terms */}
              <div className="pt-12 space-y-4">
                <p className="text-xs font-black uppercase text-slate-400 border-b pb-1">Notes & Conditions:</p>
                <p className="text-xs text-slate-600 leading-relaxed italic whitespace-pre-line">
                  {quotation.notes || 'No special conditions mentioned. This quotation is subject to standard manpower supply terms and conditions of OPEC.'}
                </p>
              </div>

              {/* Signatures */}
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
