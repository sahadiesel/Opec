'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Plus, 
  Search, 
  Filter, 
  ChevronRight, 
  FileText, 
  Building2, 
  Calendar,
  AlertTriangle,
  Info,
  ArrowRight,
  Loader2,
  Receipt
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { BillingNote, BillingNoteStatus, User, Customer, MainContract, PurchaseOrder } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, orderBy } from 'firebase/firestore';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription,
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function BillingNotesPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isAuthorized = useMemo(() => {
    const authRoles = ['system_admin', 'sales_officer', 'finance_officer'];
    return currentUser?.roleIds?.some(r => authRoles.includes(r)) || false;
  }, [currentUser]);

  const notesQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'billing_notes'), orderBy('billingDate', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: notes, isLoading } = useCollection<BillingNote>(notesQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'customers') : null), [firestore, isAuthorized]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newNote, setNewNote] = useState<Partial<BillingNote>>({
    billingNoteNo: `BN-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
    billingDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 2592000000).toISOString().split('T')[0], // +30 days
    currency: 'THB',
    status: 'DRAFT',
    notes: ''
  });

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!newNote.customerId || !newNote.billingNoteNo) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุเลขที่ใบวางบิลและลูกค้า" });
      return;
    }

    try {
      const docRef = await addDocumentNonBlocking(collection(firestore, 'billing_notes'), {
        ...newNote,
        amountBeforeTax: 0,
        vatAmount: 0,
        withholdingTaxAmount: 0,
        netAmount: 0,
        createdAt: Date.now(),
        createdBy: currentUser.displayName,
        updatedAt: Date.now(),
        updatedBy: currentUser.id
      });

      setIsDialogOpen(false);
      toast({ title: "สร้างใบวางบิลสำเร็จ", description: "กำลังนำคุณไปที่หน้าจัดการรายการสินค้า..." });
      if (docRef) router.push(`/billing-notes/${docRef.id}`);
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างใบวางบิลได้" });
    }
  };

  const getStatusBadge = (status: BillingNoteStatus) => {
    switch (status) {
      case 'DRAFT': return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">DRAFT</Badge>;
      case 'ISSUED': return <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">ISSUED</Badge>;
      case 'SUBMITTED': return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">SUBMITTED</Badge>;
      case 'PARTIALLY_PAID': return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">PARTIALLY PAID</Badge>;
      case 'PAID': return <Badge className="bg-green-600">PAID</Badge>;
      case 'CANCELLED': return <Badge variant="secondary">CANCELLED</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <FileText className="h-8 w-8" /> ใบวางบิลลูกหนี้ (Billing Notes)
          </h1>
          <p className="text-muted-foreground text-lg">
            จัดการรายการเรียกเก็บเงินจากลูกค้า อ้างอิงตามสัญญาและใบสั่งซื้อ เพื่อความถูกต้องก่อนออกใบกำกับภาษี
          </p>
        </div>

        <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
          <Info className="h-5 w-5 text-blue-600" />
          <AlertTitle className="font-bold text-lg">นโยบายการวางบิล (Billing Policy)</AlertTitle>
          <AlertDescription className="text-sm">
            ใบวางบิลที่ถูกส่งให้ลูกค้าหรือนำไปออกใบกำกับภาษีแล้ว ไม่ควรแก้ไขรายการย้อนหลังเพื่อความถูกต้องของระบบบัญชีลูกหนี้ (AR)
          </AlertDescription>
        </Alert>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="ค้นหาเลขที่ใบวางบิล หรือ ชื่อลูกค้า..." className="pl-9 h-11" />
            </div>
            <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                <Plus className="h-5 w-5" /> สร้างใบวางบิลใหม่ (New Billing Note)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>สร้างใบวางบิลใหม่ (Create Billing Note)</DialogTitle>
                <DialogDescription>ระบุข้อมูลพื้นฐานและลูกค้า ระบบจะสร้างร่างเอกสารเพื่อให้คุณเพิ่มรายการบรรทัดในขั้นตอนถัดไป</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>เลขที่ใบวางบิล (Billing Note No.)</Label>
                  <Input value={newNote.billingNoteNo} onChange={e => setNewNote({...newNote, billingNoteNo: e.target.value})} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>ลูกค้า (Customer)</Label>
                  <Select onValueChange={v => setNewNote({...newNote, customerId: v})}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกบริษัทลูกค้า..." /></SelectTrigger>
                    <SelectContent>
                      {customers?.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name} ({c.customerCode})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>วันที่วางบิล (Billing Date)</Label>
                  <Input type="date" value={newNote.billingDate} onChange={e => setNewNote({...newNote, billingDate: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>วันที่ครบกำหนด (Due Date)</Label>
                  <Input type="date" value={newNote.dueDate} onChange={e => setNewNote({...newNote, dueDate: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>สกุลเงิน (Currency)</Label>
                  <Select onValueChange={v => setNewNote({...newNote, currency: v})} defaultValue="THB">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="THB">THB</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold">เริ่มจัดทำรายการ (Confirm)</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูลใบวางบิล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">เลขที่ (No.)</TableHead>
                    <TableHead className="font-bold">ลูกค้า (Customer)</TableHead>
                    <TableHead className="font-bold">ช่วงเวลา (Period)</TableHead>
                    <TableHead className="font-bold text-right">ยอดรวมสุทธิ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notes?.map((note) => {
                    const customer = customers?.find(c => c.id === note.customerId);
                    return (
                      <TableRow 
                        key={note.id} 
                        className="cursor-pointer hover:bg-muted/30 group transition-all" 
                        onClick={() => router.push(`/billing-notes/${note.id}`)}
                      >
                        <TableCell className="py-4 pl-6 font-bold text-primary font-mono">{note.billingNoteNo}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {customer?.name || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-medium">
                            <Calendar className="h-3 w-3" />
                            {note.billingPeriodStart} - {note.billingPeriodEnd}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-black text-primary">
                          {note.currency} {note.netAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>{getStatusBadge(note.status)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="group-hover:text-primary"><ChevronRight className="h-5 w-5" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(!notes || notes.length === 0) && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการใบวางบิลในระบบ</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
