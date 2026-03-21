
'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  FileBarChart, 
  Search, 
  Filter, 
  Building2, 
  Calendar,
  Clock,
  ArrowUpRight,
  TrendingUp,
  Receipt,
  FileText,
  ShieldCheck,
  Download,
  Info,
  BadgeCheck,
  Calculator,
  Wallet,
  MessageSquareWarning,
  Loader2,
  ChevronRight,
  Lock
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { TaxInvoice, User as AppUser, AccountsReceivable, BillingNote, Receipt as ReceiptType, IssueCategory } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { PageGuidance } from '@/components/layout/page-guidance';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DisputeService } from '@/lib/services/dispute-service';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function ClientBillingViewPage() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const [searchTerm, setSearchTerm] = useState('');

  // Dispute Dialog State
  const [isDisputeOpen, setIsDisputeOpen] = useState(false);
  const [disputeContext, setDisputeContext] = useState<{ category: IssueCategory, id: string, no: string } | null>(null);
  const [disputeComment, setDisputeComment] = useState('');
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);

  // 1. Data Queries scoped to client customerId
  const invQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'tax_invoices'), 
      where('customerId', '==', currentUser.customerId),
      orderBy('issueDate', 'desc')
    );
  }, [firestore, currentUser?.customerId]);
  const { data: invoices, isLoading: isInvLoading } = useCollection<TaxInvoice>(invQuery as any);

  const bnQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'billing_notes'),
      where('customerId', '==', currentUser.customerId),
      orderBy('billingDate', 'desc')
    );
  }, [firestore, currentUser?.customerId]);
  const { data: billingNotes, isLoading: isBNLoading } = useCollection<BillingNote>(bnQuery as any);

  const receiptQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'receipts'),
      where('customerId', '==', currentUser.customerId),
      orderBy('receiptDate', 'desc')
    );
  }, [firestore, currentUser?.customerId]);
  const { data: receipts, isLoading: isReceiptsLoading } = useCollection<ReceiptType>(receiptQuery as any);

  const arQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser?.customerId) return null;
    return query(
      collection(firestore, 'accounts_receivable'), 
      where('customerId', '==', currentUser.customerId),
      where('status', 'in', ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'])
    );
  }, [firestore, currentUser?.customerId]);
  const { data: arItems } = useCollection<AccountsReceivable>(arQuery as any);

  const stats = useMemo(() => {
    if (!arItems) return { outstanding: 0, count: 0 };
    return {
      outstanding: arItems.reduce((sum, item) => sum + item.outstandingAmount, 0),
      count: arItems.length
    };
  }, [arItems]);

  const handleOpenDispute = (category: IssueCategory, id: string, no: string) => {
    setDisputeContext({ category, id, no });
    setIsDisputeOpen(true);
  };

  const handleReportIssue = async () => {
    if (!disputeContext || !disputeComment || !firestore || !currentUser) return;
    
    setIsSubmittingDispute(true);
    try {
      const service = new DisputeService(firestore);
      await service.reportIssue({
        category: disputeContext.category,
        referenceId: disputeContext.id,
        referenceNo: disputeContext.no,
        description: disputeComment
      }, currentUser);

      toast({ 
        title: "รับเรื่องตรวจสอบแล้ว (Request Received)", 
        description: "เจ้าหน้าที่ฝ่ายบัญชี OPEC จะตรวจสอบความถูกต้องและติดต่อกลับโดยเร็ว" 
      });
      setIsDisputeOpen(false);
      setDisputeComment('');
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  if (isUserLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            <FileBarChart className="h-8 w-8 text-primary" /> เอกสารการเงินและการวางบิล (Billing & Financial Docs)
          </h1>
          <p className="text-muted-foreground text-lg italic">
            ตรวจสอบรายการใบวางบิล ใบกำกับภาษี และประวัติการรับชำระเงิน (Financial traceability).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-l-8 border-l-blue-600 bg-blue-50/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">ยอดค้างชำระปัจจุบัน (Total Balance)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-primary">฿ {stats.outstanding.toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-tighter">Outstanding from {stats.count} Open Invoices</p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-green-600 bg-green-50/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">รายการที่ชำระแล้ว (Confirmed Receipts)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-green-700">
                ฿ {(receipts?.reduce((sum, r) => sum + Number(r.receivedAmount), 0) || 0).toLocaleString()}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-tighter">Total Confirmed Payments</p>
            </CardContent>
          </Card>
          <Card className="border-l-8 border-l-primary bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black uppercase text-muted-foreground">Credit Policy</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-primary">Credit 30 Days</div>
              <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-tighter">Standard Commercial Terms</p>
            </CardContent>
          </Card>
        </div>

        <PageGuidance 
          tips={[
            "รายการ 'Billing Note' คือเอกสารสรุปยอดประจำเดือนที่ OPEC จัดส่งให้เพื่อตรวจสอบความถูกต้องก่อนออกใบกำกับภาษี",
            "เอกสารที่สถานะเป็น 'PAID' หรือได้รับการยืนยันแล้วจะไม่สามารถแจ้งปัญหาผ่านช่องทางปกติได้",
            "หากท่านดำเนินการโอนเงินแล้วแต่ยังไม่ได้รับใบเสร็จ หรือยอดไม่ถูกต้อง กรุณาใช้ปุ่ม 'แจ้งปัญหา'"
          ]}
        />

        <Tabs defaultValue="invoices" className="w-full">
          <TabsList className="grid grid-cols-3 w-full md:w-[600px] h-auto p-1 bg-muted/50">
            <TabsTrigger value="invoices" className="gap-2 py-2 px-6"><FileText className="h-4 w-4" /> ใบกำกับภาษี (Invoices)</TabsTrigger>
            <TabsTrigger value="notes" className="gap-2 py-2 px-6"><Calculator className="h-4 w-4" /> ใบวางบิล (Notes)</TabsTrigger>
            <TabsTrigger value="receipts" className="gap-2 py-2 px-6"><Wallet className="h-4 w-4" /> การชำระเงิน (Receipts)</TabsTrigger>
          </TabsList>

          <TabsContent value="invoices" className="mt-6 space-y-6">
            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0">
                {isInvLoading ? (
                  <div className="py-20 text-center animate-pulse italic">กำลังโหลดข้อมูล...</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6 py-4 font-bold">เลขที่ใบกำกับภาษี</TableHead>
                        <TableHead className="font-bold">วันที่ออก</TableHead>
                        <TableHead className="text-right font-bold">ยอดเงินรวม</TableHead>
                        <TableHead className="text-right font-bold">ยอดค้างชำระ</TableHead>
                        <TableHead className="font-bold">สถานะ</TableHead>
                        <TableHead className="text-right pr-6">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices?.map((inv) => {
                        const ar = arItems?.find(item => item.referenceId === inv.id);
                        const outstanding = ar ? ar.outstandingAmount : (inv.status === 'ISSUED' ? inv.totalAmount : 0);
                        const isSettled = outstanding <= 0;
                        
                        return (
                          <TableRow key={inv.id} className={`${isSettled ? 'bg-slate-50/50' : 'hover:bg-muted/20'} transition-all group`}>
                            <TableCell className="pl-6 py-4">
                              <div className="flex items-center gap-2 text-sm font-bold text-primary">
                                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                                {inv.taxInvoiceNo}
                                {isSettled && <Lock className="h-3 w-3 text-amber-600" title="Settled - Locked" />}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs font-medium text-muted-foreground">{inv.issueDate}</TableCell>
                            <TableCell className="text-right font-bold">฿ {inv.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                            <TableCell className="text-right font-black text-primary">฿ {outstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                            <TableCell>
                              <Badge variant={outstanding === 0 ? 'default' : 'outline'} className={outstanding === 0 ? 'bg-green-600' : 'uppercase text-[9px]'}>
                                {outstanding === 0 ? 'PAID' : inv.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              <div className="flex justify-end gap-2">
                                {!isSettled && (
                                  <Button size="sm" variant="ghost" className="font-bold text-xs h-8 group" onClick={() => handleOpenDispute('TAX_INVOICE', inv.id, inv.taxInvoiceNo)}>
                                    <MessageSquareWarning className="h-3.5 w-3.5 mr-1.5" /> แจ้งปัญหา
                                  </Button>
                                )}
                                <Button size="sm" variant="ghost" className="font-bold text-xs h-8">
                                  <Download className="h-3.5 w-3.5 mr-1.5" /> PDF
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes" className="mt-6 space-y-6">
            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0">
                {isBNLoading ? (
                  <div className="py-20 text-center animate-pulse italic">กำลังโหลดข้อมูล...</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6 py-4 font-bold">เลขที่ใบวางบิล</TableHead>
                        <TableHead className="font-bold">วันที่วางบิล</TableHead>
                        <TableHead className="font-bold">วันครบกำหนด</TableHead>
                        <TableHead className="text-right font-bold">ยอดสุทธิ</TableHead>
                        <TableHead className="font-bold">สถานะ</TableHead>
                        <TableHead className="text-right pr-6">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {billingNotes?.map((note) => {
                        const isFinalized = note.status === 'PAID' || note.status === 'CANCELLED';
                        return (
                          <TableRow key={note.id} className={`${isFinalized ? 'bg-slate-50/50' : 'hover:bg-muted/20'} group`}>
                            <TableCell className="pl-6 py-4 font-mono font-bold text-primary">
                              <div className="flex items-center gap-2">
                                {note.billingNoteNo}
                                {isFinalized && <Lock className="h-3 w-3 text-amber-600" />}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm font-medium">{note.billingDate}</TableCell>
                            <TableCell className="text-sm font-medium text-red-600">{note.dueDate}</TableCell>
                            <TableCell className="text-right font-bold text-primary">฿ {note.netAmount.toLocaleString()}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="uppercase text-[9px]">{note.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              {!isFinalized && (
                                <Button size="sm" variant="ghost" className="font-bold text-xs h-8 group" onClick={() => handleOpenDispute('BILLING_NOTE', note.id, note.billingNoteNo)}>
                                  <MessageSquareWarning className="h-3.5 w-3.5 mr-1.5" /> แจ้งปัญหา
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="receipts" className="mt-6 space-y-6">
            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0">
                {isReceiptsLoading ? (
                  <div className="py-20 text-center animate-pulse italic">กำลังโหลดข้อมูล...</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6 py-4 font-bold">เลขที่ใบเสร็จ</TableHead>
                        <TableHead className="font-bold">วันที่รับเงิน</TableHead>
                        <TableHead className="font-bold">วิธีชำระ</TableHead>
                        <TableHead className="text-right font-bold">ยอดเงินที่ได้รับ</TableHead>
                        <TableHead className="text-right">สถานะ</TableHead>
                        <TableHead className="text-right pr-6">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {receipts?.map((r) => (
                        <TableRow key={r.id} className="hover:bg-muted/20 group">
                          <TableCell className="pl-6 py-4">
                            <div className="flex items-center gap-2 font-bold text-sm text-green-700">
                              <BadgeCheck className="h-4 w-4" /> {r.receiptNo}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm font-medium">{r.receiptDate}</TableCell>
                          <TableCell className="text-xs uppercase font-bold text-muted-foreground">{r.paymentMethod}</TableCell>
                          <TableCell className="text-right font-black text-primary">฿ {r.receivedAmount.toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <Badge className="bg-green-600 text-[10px] uppercase">{r.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <Button size="sm" variant="ghost" className="font-bold text-xs h-8 group" onClick={() => handleOpenDispute('RECEIPT', r.id, r.receiptNo)}>
                              <MessageSquareWarning className="h-3.5 w-3.5 mr-1.5" /> แจ้งปัญหา
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Dispute Dialog */}
        <Dialog open={isDisputeOpen} onOpenChange={setIsDisputeOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>แจ้งปัญหาข้อมูลเอกสาร (Report Document Issue)</DialogTitle>
              <DialogDescription>ระบุรายละเอียดข้อมูลที่ต้องการให้เจ้าหน้าที่ฝ่ายบัญชี OPEC ตรวจสอบแก้ไข</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {disputeContext && (
                <div className="p-3 bg-muted rounded-lg text-xs space-y-1">
                  <p><b>ประเภทเอกสาร:</b> {disputeContext.category}</p>
                  <p><b>เลขที่อ้างอิง:</b> {disputeContext.no}</p>
                </div>
              )}
              <div className="space-y-2">
                <Label className="font-bold text-primary">รายละเอียดความไม่ถูกต้อง / ข้อมูลที่ต้องการแจ้ง</Label>
                <Textarea 
                  placeholder="เช่น ยอดเงินไม่ตรงกับใบสั่งซื้อ, วันที่ครบกำหนดไม่ถูกต้อง, ยังไม่ได้รับต้นฉบับ..." 
                  value={disputeComment}
                  onChange={e => setDisputeComment(e.target.value)}
                  className="min-h-[120px]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDisputeOpen(false)} disabled={isSubmittingDispute}>ยกเลิก</Button>
              <Button onClick={handleReportIssue} className="bg-primary font-bold shadow-lg h-11 px-8" disabled={isSubmittingDispute || !disputeComment}>
                {isSubmittingDispute ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                ส่งเรื่องตรวจสอบ (Submit Query)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
