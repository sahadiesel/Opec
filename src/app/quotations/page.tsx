'use client';

import { useState, useMemo } from 'react';
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
  FileSignature, 
  Building2, 
  Calendar,
  Info,
  Loader2,
  ArrowRight
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Quotation, QuotationStatus, User, Customer } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
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
import { generateNextDocumentCode, getPreviewPattern } from '@/lib/services/numbering-service';
import { useAppUser } from '@/hooks/use-app-user';
import { canView } from '@/lib/permissions';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { htmlDateValueToTimestampMs, timestampToHtmlDateValue } from '@/lib/date-thai';

export default function QuotationsPage() {
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(() => canView(currentUser, 'quotations'), [currentUser]);

  const quotationsQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'quotations'), orderBy('createdAt', 'desc'));
  }, [firestore, isAuthorized]);

  const { data: quotations, isLoading } = useCollection<Quotation>(quotationsQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'customers') : null), [firestore, isAuthorized]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | QuotationStatus>('all');
  const [newQuotation, setNewQuotation] = useState<Partial<Quotation>>({
    quotationNo: getPreviewPattern('quotation'),
    issueDate: new Date().toISOString().split('T')[0],
    validUntilDate: new Date(Date.now() + 2592000000).toISOString().split('T')[0], // 30 days
    currency: 'THB',
    status: 'draft',
    projectTitle: '',
    subtotal: 0,
    discountAmount: 0,
    taxPercent: 7,
    taxAmount: 0,
    grandTotal: 0
  });

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!newQuotation.customerId || !newQuotation.projectTitle) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุชื่อใบเสนอราคาและลูกค้า" });
      return;
    }

    setIsCreating(true);
    try {
      // 1. Generate unique quotation number atomically
      const { code: finalNo } = await generateNextDocumentCode(firestore, 'quotation', { 
        actor: currentUser.displayName 
      });

      const customer = customers?.find(c => c.id === newQuotation.customerId);

      // 2. Create the document
      const docRef = await addDocumentNonBlocking(collection(firestore, 'quotations'), {
        ...newQuotation,
        quotationNo: finalNo,
        customerNameSnapshot: customer?.name || '',
        billingAddressSnapshot: customer?.billingAddress || '',
        createdAt: Date.now(),
        createdBy: currentUser.displayName,
        updatedAt: Date.now(),
        updatedBy: currentUser.id
      });

      setIsDialogOpen(false);
      toast({ title: "สร้างใบเสนอราคาสำเร็จ", description: `เลขที่เอกสาร: ${finalNo}` });
      if (docRef) router.push(`/quotations/${docRef.id}`);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถสร้างใบเสนอราคาได้" });
    } finally {
      setIsCreating(false);
    }
  };

  const getStatusBadge = (status: QuotationStatus) => {
    switch (status) {
      case 'draft': return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">DRAFT</Badge>;
      case 'sent': return <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">SENT</Badge>;
      case 'accepted': return <Badge className="bg-green-600 text-white">ACCEPTED</Badge>;
      case 'rejected': return <Badge variant="destructive">REJECTED</Badge>;
      case 'cancelled': return <Badge variant="secondary">CANCELLED</Badge>;
      case 'expired': return <Badge variant="outline" className="text-orange-600 border-orange-200">EXPIRED</Badge>;
      case 'revised': return <Badge variant="secondary" className="bg-violet-100 text-violet-700">REVISED</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const filteredQuotations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return (quotations || []).filter((q) => {
      const statusMatched = statusFilter === 'all' || q.status === statusFilter;
      if (!statusMatched) return false;
      if (!term) return true;
      const no = (q.quotationNo || '').toLowerCase();
      const customer = (q.customerNameSnapshot || '').toLowerCase();
      const title = (q.projectTitle || '').toLowerCase();
      const status = (q.status || '').toLowerCase();
      return no.includes(term) || customer.includes(term) || title.includes(term) || status.includes(term);
    });
  }, [quotations, searchTerm, statusFilter]);

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <FileSignature className="h-8 w-8" /> ใบเสนอราคา (Quotations)
          </h1>
          <p className="text-muted-foreground text-lg">
            จัดการใบเสนอราคาเพื่อส่งให้ลูกค้าพิจารณาก่อนจัดทำสัญญาหลักหรือใบสั่งซื้อ
          </p>
        </div>

        <Alert className="bg-primary/5 border-primary/20 shadow-sm">
          <Info className="h-5 w-5 text-primary" />
          <AlertTitle className="font-bold">นโยบายเลขที่เอกสาร (Quotation Numbering)</AlertTitle>
          <AlertDescription className="text-sm">
            ระบบจะรันเลขที่ใบเสนอราคาให้โดยอัตโนมัติ (QT-YYYY-MM-XXXXX) เมื่อมีการยืนยันการบันทึก เพื่อความต่อเนื่องของข้อมูลทางบัญชี
          </AlertDescription>
        </Alert>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ค้นหาเลขที่ หรือ ชื่อใบเสนอราคา..."
                className="pl-9 h-11"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="w-[210px]">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | QuotationStatus)}>
                <SelectTrigger className="h-11 gap-2">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4" />
                    <SelectValue placeholder="ตัวกรองสถานะ" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทุกสถานะ</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="revised">Revised</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <Dialog open={isAuthorized && isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 h-11 px-6 bg-primary shadow-md text-base font-bold">
                <Plus className="h-5 w-5" /> สร้างใบเสนอราคาใหม่ (New Quotation)
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>สร้างใบเสนอราคาใหม่</DialogTitle>
                <DialogDescription>ระบุรายละเอียดเบื้องต้นเพื่อเริ่มต้นจัดทำข้อเสนอเชิงพาณิชย์</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>ชื่อใบเสนอราคา / หัวข้อโครงการ</Label>
                  <Input value={newQuotation.projectTitle} onChange={e => setNewQuotation({...newQuotation, projectTitle: e.target.value})} placeholder="เช่น โครงการ Maintenance Platform A" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>เลขที่เอกสาร (Internal Ref)</Label>
                  <Input value={newQuotation.quotationNo} disabled className="bg-muted/50 font-mono font-bold" />
                  <p className="text-[10px] text-muted-foreground italic">* เลขที่จริงจะถูกออกให้โดยระบบเมื่อกดบันทึก</p>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>ลูกค้า (Customer)</Label>
                  <Select onValueChange={v => setNewQuotation({...newQuotation, customerId: v})}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="เลือกบริษัทลูกค้า..." /></SelectTrigger>
                    <SelectContent>
                      {customers?.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>วันที่ออกเอกสาร</Label>
                  <DatePickerThaiBE
                    value={htmlDateValueToTimestampMs(newQuotation.issueDate)}
                    onChange={(ms) =>
                      setNewQuotation({ ...newQuotation, issueDate: timestampToHtmlDateValue(ms) })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>วันหมดอายุข้อเสนอ</Label>
                  <DatePickerThaiBE
                    value={htmlDateValueToTimestampMs(newQuotation.validUntilDate)}
                    onChange={(ms) =>
                      setNewQuotation({ ...newQuotation, validUntilDate: timestampToHtmlDateValue(ms) })
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating}>ยกเลิก</Button>
                <Button onClick={handleCreate} className="bg-primary font-bold" disabled={isCreating}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  สร้างและไปจัดการราคา (Confirm)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-20 text-center text-muted-foreground italic animate-pulse">กำลังโหลดข้อมูล...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-bold py-4 pl-6">เลขที่ (No.)</TableHead>
                    <TableHead className="font-bold">ลูกค้า (Customer)</TableHead>
                    <TableHead className="font-bold">รายละเอียด (Title)</TableHead>
                    <TableHead className="font-bold text-right">มูลค่าสุทธิ</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredQuotations.map((q) => {
                    return (
                      <TableRow 
                        key={q.id} 
                        className="cursor-pointer hover:bg-muted/30 group transition-all" 
                        onClick={() => router.push(`/quotations/${q.id}`)}
                      >
                        <TableCell className="py-4 pl-6 font-bold text-primary font-mono">{q.quotationNo}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm font-bold text-primary">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {q.customerNameSnapshot || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{q.projectTitle}</TableCell>
                        <TableCell className="text-right font-black text-primary">
                          {q.currency} {(q.grandTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>{getStatusBadge(q.status)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="group-hover:text-primary"><ChevronRight className="h-5 w-5" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredQuotations.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">ไม่มีรายการใบเสนอราคาในระบบ</TableCell>
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
