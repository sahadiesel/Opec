
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
  ExternalLink
} from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, collection, updateDoc, query, where } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { 
  BillingNote, 
  BillingNoteLine, 
  BillingNoteStatus, 
  User, 
  Customer,
  TaxInvoice
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
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

  useEffect(() => {
    if (note) setEditedNote(note);
  }, [note]);

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

  const recalculateTotals = (currentLines: BillingNoteLine[]) => {
    if (!noteRef) return;
    const amountBeforeTax = currentLines.reduce((sum, l) => sum + Number(l.amount), 0);
    const vatAmount = amountBeforeTax * 0.07;
    const netAmount = amountBeforeTax + vatAmount;
    
    updateDoc(noteRef, {
      amountBeforeTax,
      vatAmount,
      netAmount,
      updatedAt: Date.now()
    });
  };

  const handleSaveHeader = () => {
    if (!noteRef) return;
    updateDocumentNonBlocking(noteRef, { ...editedNote, updatedAt: Date.now() });
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
                        <Input type="date" disabled={!isEditingHeader} value={editedNote.billingDate} onChange={e => setEditedNote({...editedNote, billingDate: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label>วันที่ครบกำหนด</Label>
                        <Input type="date" disabled={!isEditingHeader} value={editedNote.dueDate} onChange={e => setEditedNote({...editedNote, dueDate: e.target.value})} />
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
                      <span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม (7%)</span>
                      <span className="font-bold">{note.currency} {note.vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
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
                        <p className="text-xs text-muted-foreground">{new Date(note.createdAt).toLocaleString('th-TH')}</p>
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
