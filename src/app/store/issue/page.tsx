'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { 
  ArrowUpRight, 
  ArrowLeft, 
  Search, 
  Plus, 
  Trash2, 
  ShieldAlert, 
  User, 
  Briefcase,
  Waves,
  HardHat,
  CheckCircle2,
  Info,
  Loader2
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, doc, query, where, collectionGroup, getDocs, updateDoc, increment } from 'firebase/firestore';
import { StoreItem, Worker, Assignment, Wave, Position, User as AppUser, PositionPPERequirement, PositionToolRequirement } from '@/lib/types';
import { addDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function IssueItemsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [selectedAsgnId, setSelectedAsgnId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [cart, setCart] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const workersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'workers') : null), [firestore]);
  const { data: allWorkers } = useCollection<Worker>(workersQuery as any);

  const asgnQuery = useMemoFirebase(() => {
    if (!firestore || !selectedWorkerId) return null;
    return query(collectionGroup(firestore, 'assignments'), where('workerId', '==', selectedWorkerId));
  }, [firestore, selectedWorkerId]);
  const { data: assignments } = useCollection<Assignment>(asgnQuery as any);

  const activeAsgn = assignments?.find(a => a.id === selectedAsgnId);
  
  const waveRef = useMemoFirebase(() => (firestore && activeAsgn ? doc(firestore, 'waves', activeAsgn.waveId) : null), [firestore, activeAsgn?.waveId]);
  const { data: wave } = useDoc<Wave>(waveRef as any);

  const posRef = useMemoFirebase(() => (firestore && activeAsgn ? doc(firestore, 'positions', activeAsgn.positionId) : null), [firestore, activeAsgn?.positionId]);
  const { data: position } = useDoc<Position>(posRef as any);

  const itemsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'store_items') : null), [firestore]);
  const { data: storeItems } = useCollection<StoreItem>(itemsQuery as any);

  const [posPPE, setPosPPE] = useState<PositionPPERequirement[]>([]);
  const [posTools, setPosTools] = useState<PositionToolRequirement[]>([]);

  useEffect(() => {
    async function fetchPosReqs() {
      if (!firestore || !activeAsgn?.positionId) return;
      const ppeRef = collection(firestore, 'positions', activeAsgn.positionId, 'ppe_requirements');
      const toolRef = collection(firestore, 'positions', activeAsgn.positionId, 'tool_requirements');
      const [ppeSnap, toolSnap] = await Promise.all([getDocs(ppeRef), getDocs(toolRef)]);
      setPosPPE(ppeSnap.docs.map(d => d.data() as PositionPPERequirement));
      setPosTools(toolSnap.docs.map(d => d.data() as PositionToolRequirement));
    }
    fetchPosReqs();
  }, [firestore, activeAsgn?.positionId]);

  const handleAddToCart = (itemId: string) => {
    const item = storeItems?.find(i => i.id === itemId);
    if (!item) return;

    // RULE: Check Position Requirement
    const isAllowedPPE = posPPE.some(p => p.itemCode === item.itemCode || p.itemName === item.itemName);
    const isAllowedTool = posTools.some(t => t.itemName === item.itemName || t.itemCode === item.itemCode);

    if (!isAllowedPPE && !isAllowedTool) {
      toast({ 
        variant: "destructive", 
        title: "ไม่อนุญาตให้เบิก", 
        description: `รายการนี้ไม่ได้อยู่ใน Requirement ของตำแหน่ง ${position?.positionName}` 
      });
      return;
    }

    if (item.currentStock <= 0) {
      toast({ variant: "destructive", title: "สินค้าหมด", description: "ไม่สามารถเบิกได้เนื่องจากสต็อกเป็นศูนย์" });
      return;
    }

    if (cart.some(c => c.itemId === itemId)) return;

    setCart([...cart, {
      itemId: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      quantity: 1,
      unit: item.unit,
      isPPE: item.isPPE,
      isTool: item.isTool
    }]);
  };

  const handleIssue = async () => {
    if (!firestore || !activeAsgn || cart.length === 0) return;
    setIsSubmitting(true);

    try {
      const issueRef = collection(firestore, 'store_issue_slips');
      const slipNo = `ISS-${Date.now().toString().slice(-6)}`;
      
      const slipDoc = await addDocumentNonBlocking(issueRef, {
        issueNo: slipNo,
        workerId: selectedWorkerId,
        assignmentId: activeAsgn.id,
        waveId: activeAsgn.waveId,
        positionId: activeAsgn.positionId,
        issueDate,
        status: 'completed',
        createdAt: Date.now(),
        createdBy: currentUser?.displayName || 'System'
      });

      // Process each item in cart
      for (const item of cart) {
        const itemRef = doc(firestore, 'store_items', item.itemId);
        // Update Stock
        await updateDoc(itemRef, { currentStock: increment(-item.quantity) });
        
        // Log Transaction
        await addDocumentNonBlocking(collection(firestore, 'store_transactions'), {
          itemId: item.itemId,
          transactionType: 'ISSUE',
          quantity: item.quantity,
          workerId: selectedWorkerId,
          assignmentId: activeAsgn.id,
          waveId: activeAsgn.waveId,
          transactionDate: issueDate,
          createdAt: Date.now(),
          createdBy: currentUser?.displayName || 'System'
        });
      }

      toast({ title: "บันทึกการเบิกสำเร็จ", description: `รหัสใบเบิก: ${slipNo}` });
      router.push('/store');
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกการเบิกได้" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild><Link href="/store"><ArrowLeft className="h-5 w-5" /></Link></Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ArrowUpRight className="h-6 w-6 text-orange-600" /> บันทึกการเบิกอุปกรณ์ (Issue PPE/Tools)
            </h1>
            <p className="text-muted-foreground text-sm">เบิกอุปกรณ์ตามโควต้าตำแหน่งงานรายบุคคล</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-lg">ข้อมูลผู้เบิก & งาน (Recipient & Assignment)</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>เลือกคนงาน (Worker)</Label>
                  <Select onValueChange={setSelectedWorkerId} value={selectedWorkerId}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="ค้นหาคนงาน..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allWorkers?.map(w => (
                        <SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName} ({w.thaiNationalId})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedWorkerId && (
                  <div className="space-y-2">
                    <Label>เลือกการมอบหมายงาน (Assignment)</Label>
                    <Select onValueChange={setSelectedAsgnId} value={selectedAsgnId}>
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="เลือกงานที่กำลังดำเนินอยู่..." />
                      </SelectTrigger>
                      <SelectContent>
                        {assignments?.filter(a => a.deploymentStatus !== 'CLOSED').map(a => (
                          <SelectItem key={a.id} value={a.id}>{a.projectName} | เริ่ม {a.startDate}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {activeAsgn && (
                  <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg border">
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground uppercase font-bold">ตำแหน่งงาน:</p>
                      <p className="text-sm font-bold text-primary flex items-center gap-2"><Briefcase className="h-3.5 w-3.5" /> {position?.positionName}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground uppercase font-bold">Wave:</p>
                      <p className="text-sm font-bold text-primary flex items-center gap-2"><Waves className="h-3.5 w-3.5" /> {wave?.waveCode}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {activeAsgn && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">เลือกรายการอุปกรณ์ (Item Selection)</CardTitle>
                  <Badge variant="outline" className="text-primary border-primary">มีให้เบิก {storeItems?.length || 0} รายการ</Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="พิมพ์รหัสหรือชื่ออุปกรณ์..." className="pl-9 h-11" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-2">
                    {storeItems?.filter(i => i.active).map(item => (
                      <div key={item.id} className="p-3 border rounded-lg flex items-center justify-between hover:bg-muted/50 cursor-pointer transition-colors" onClick={() => handleAddToCart(item.id)}>
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-primary">{item.itemName}</p>
                          <p className="text-[10px] text-muted-foreground">{item.itemCode} | Stock: {item.currentStock}</p>
                        </div>
                        <Plus className="h-4 w-4 text-primary" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card className="border-primary/20 shadow-lg">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" /> รายการที่จะเบิก (Cart)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {cart.length === 0 ? (
                  <div className="py-10 text-center text-muted-foreground italic text-xs">ยังไม่มีรายการในตะกร้า</div>
                ) : (
                  <div className="space-y-2">
                    {cart.map((item, idx) => (
                      <div key={item.itemId} className="flex items-center justify-between p-2 border rounded bg-card">
                        <div className="flex-1">
                          <p className="text-xs font-bold truncate">{item.itemName}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Input 
                              type="number" 
                              className="h-7 w-16 text-xs" 
                              value={item.quantity} 
                              onChange={e => {
                                const newCart = [...cart];
                                newCart[idx].quantity = parseInt(e.target.value);
                                setCart(newCart);
                              }}
                            />
                            <span className="text-[10px] text-muted-foreground">{item.unit}</span>
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => setCart(cart.filter((_, i) => i !== idx))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2 pt-4 border-t">
                  <Label>วันที่ทำรายการ</Label>
                  <Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
                </div>
              </CardContent>
              <CardFooter className="bg-muted/30 border-t pt-4">
                <Button 
                  className="w-full h-12 font-bold bg-primary shadow-md" 
                  disabled={cart.length === 0 || !activeAsgn || isSubmitting}
                  onClick={handleIssue}
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  ยืนยันการเบิก (Confirm Issue)
                </Button>
              </CardFooter>
            </Card>

            <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle className="text-xs font-bold">Position Block Active</AlertTitle>
              <AlertDescription className="text-[10px]">
                ระบบจะอนุญาตให้เบิกเฉพาะอุปกรณ์ที่กำหนดไว้ในตำแหน่งงานเท่านั้น
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
