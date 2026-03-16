'use client';

import { useState, use, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Plus, 
  Trash2, 
  Save, 
  FileText, 
  HardHat, 
  Hammer, 
  ArrowLeft,
  Sparkles,
  Briefcase,
  Activity,
  Info
} from 'lucide-react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Position, PositionCertificateRequirement, PositionPPERequirement, PositionToolRequirement, User } from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { generatePositionRequirements } from '@/ai/flows/generate-position-requirements';

export default function PositionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading: isAuthLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const posRef = useMemoFirebase(() => (firestore ? doc(firestore, 'positions', id) : null), [firestore, id]);
  const { data: position, isLoading: isPosLoading } = useDoc<Position>(posRef as any);

  const certsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'positions', id, 'certificate_requirements') : null), [firestore, id]);
  const { data: certs } = useCollection<PositionCertificateRequirement>(certsQuery as any);

  const ppeQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'positions', id, 'ppe_requirements') : null), [firestore, id]);
  const { data: ppe } = useCollection<PositionPPERequirement>(ppeQuery as any);

  const toolsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'positions', id, 'tool_requirements') : null), [firestore, id]);
  const { data: tools } = useCollection<PositionToolRequirement>(toolsQuery as any);

  const [isEditing, setIsEditing] = useState(false);
  const [editedPos, setEditedPos] = useState<Partial<Position>>({});

  const [isAddCertOpen, setIsAddCertOpen] = useState(false);
  const [isAddPPEOpen, setIsAddPPEOpen] = useState(false);
  const [isAddToolOpen, setIsAddToolOpen] = useState(false);

  const [newCert, setNewCert] = useState<Partial<PositionCertificateRequirement>>({ required: true });
  const [newPPE, setNewPPE] = useState<Partial<PositionPPERequirement>>({ required: true, quantityDefault: 1 });
  const [newTool, setNewTool] = useState<Partial<PositionToolRequirement>>({ allowed: true, quantityDefault: 1, itemType: 'tool' });

  const [isGenerating, setIsGenerating] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const handleSaveMaster = () => {
    if (!posRef) return;
    updateDocumentNonBlocking(posRef, { ...editedPos, updatedAt: Date.now() });
    setIsEditing(false);
    toast({ title: "บันทึกสำเร็จ", description: "ข้อมูลหลักของตำแหน่งงานถูกอัปเดตแล้ว" });
  };

  const handleAddCert = () => {
    if (!certsQuery) return;
    addDocumentNonBlocking(certsQuery, {
      certificateName: newCert.certificateName || '',
      certificateCode: newCert.certificateCode || '',
      required: newCert.required ?? true,
      validityMonths: newCert.validityMonths || 0,
      notes: newCert.notes || ''
    });
    setIsAddCertOpen(false);
    setNewCert({ required: true });
  };

  const handleAddPPE = () => {
    if (!ppeQuery) return;
    addDocumentNonBlocking(ppeQuery, {
      itemName: newPPE.itemName || '',
      itemCode: newPPE.itemCode || '',
      quantityDefault: newPPE.quantityDefault ?? 1,
      required: newPPE.required ?? true,
      notes: newPPE.notes || ''
    });
    setIsAddPPEOpen(false);
    setNewPPE({ required: true, quantityDefault: 1 });
  };

  const handleAddTool = () => {
    if (!toolsQuery) return;
    addDocumentNonBlocking(toolsQuery, {
      itemName: newTool.itemName || '',
      itemCode: newTool.itemCode || '',
      itemType: newTool.itemType || 'tool',
      quantityDefault: newTool.quantityDefault ?? 1,
      allowed: newTool.allowed ?? true,
      notes: newTool.notes || ''
    });
    setIsAddToolOpen(false);
    setNewTool({ allowed: true, quantityDefault: 1, itemType: 'tool' });
  };

  const deleteReq = (sub: string, reqId: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบรายการนี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'positions', id, sub, reqId));
    }
  };

  const handleGenerateAI = async (type: 'certificate' | 'ppe' | 'tool') => {
    if (!position) return;
    setIsGenerating(type);
    try {
      const result = await generatePositionRequirements({
        positionName: position.positionName,
        requirementsType: type,
        additionalDetails: position.description
      });
      
      toast({
        title: "AI Suggested Requirements",
        description: result.description,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "AI Generation Failed",
        description: "ไม่สามารถสร้างคำแนะนำได้ในขณะนี้"
      });
    } finally {
      setIsGenerating(null);
    }
  };

  if (isPosLoading || !position || !currentUser) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-muted-foreground">กำลังโหลดข้อมูล (Loading Positions Matrix)...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1400px] mx-auto">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/positions"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-primary">
                {position.positionNameTh || position.positionName} ({position.positionName})
              </h1>
              <Badge variant="outline" className="font-mono text-primary border-primary/20">
                Code: {position.positionCode}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 flex items-center gap-2">
              <Info className="h-4 w-4" /> จัดการเกณฑ์มาตรฐานตำแหน่ง (Standard Matrix), ใบเซอร์บังคับ และอุปกรณ์ที่จำเป็น
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-11" onClick={() => { setEditedPos(position); setIsEditing(!isEditing); }}>
              {isEditing ? 'ยกเลิก (Cancel)' : 'แก้ไขข้อมูลหลัก (Edit Info)'}
            </Button>
            {isEditing && (
              <Button className="h-11 gap-2 bg-primary font-bold shadow-md" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึก (Save)
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="master" className="w-full">
          <TabsList className="grid grid-cols-4 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="master" className="gap-2 py-2 px-8"><Briefcase className="h-4 w-4" /> ข้อมูลตำแหน่ง (Profile)</TabsTrigger>
            <TabsTrigger value="certs" className="gap-2 py-2 px-8"><FileText className="h-4 w-4" /> ใบเซอร์ (Certs)</TabsTrigger>
            <TabsTrigger value="ppe" className="gap-2 py-2 px-8"><HardHat className="h-4 w-4" /> PPE</TabsTrigger>
            <TabsTrigger value="tools" className="gap-2 py-2 px-8"><Hammer className="h-4 w-4" /> อุปกรณ์ (Tools)</TabsTrigger>
          </TabsList>

          <TabsContent value="master" className="mt-6 space-y-6">
            <Card className="shadow-sm">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="text-lg flex items-center gap-2 text-primary">
                  <Activity className="h-5 w-5" /> รายละเอียดตำแหน่ง (Job Definition)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อภาษาไทย (Thai Name) *</Label>
                    <Input 
                      disabled={!isEditing} 
                      value={isEditing ? editedPos.positionNameTh : position.positionNameTh} 
                      onChange={e => setEditedPos({...editedPos, positionNameTh: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ชื่อภาษาอังกฤษ (English Name) *</Label>
                    <Input 
                      disabled={!isEditing} 
                      value={isEditing ? editedPos.positionName : position.positionName} 
                      onChange={e => setEditedPos({...editedPos, positionName: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">รหัสตำแหน่ง (Position Code) *</Label>
                    <Input 
                      disabled={!isEditing} 
                      value={isEditing ? editedPos.positionCode : position.positionCode} 
                      onChange={e => setEditedPos({...editedPos, positionCode: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">หมวดหมู่ (Category)</Label>
                    <Select 
                      disabled={!isEditing}
                      onValueChange={v => setEditedPos({...editedPos, category: v})}
                      value={isEditing ? editedPos.category : position.category}
                    >
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Offshore">Offshore (นอกชายฝั่ง)</SelectItem>
                        <SelectItem value="Onshore">Onshore (บนฝั่ง)</SelectItem>
                        <SelectItem value="Technical">Technical (สายเทคนิค)</SelectItem>
                        <SelectItem value="Administrative">Administrative (สายธุรการ)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ฐานการจ่ายเงินคนงาน (Payroll Basis)</Label>
                    <Select 
                      disabled={!isEditing}
                      onValueChange={v => setEditedPos({...editedPos, payrollBasis: v as any})}
                      value={isEditing ? editedPos.payrollBasis : position.payrollBasis}
                    >
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Daily">Daily (รายวัน)</SelectItem>
                        <SelectItem value="Monthly">Monthly (รายเดือน)</SelectItem>
                        <SelectItem value="Hourly">Hourly (รายชั่วโมง)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">รายละเอียดงาน (Description)</Label>
                  <Textarea 
                    className="min-h-[100px]"
                    disabled={!isEditing} 
                    value={isEditing ? editedPos.description : position.description} 
                    onChange={e => setEditedPos({...editedPos, description: e.target.value})}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="certs" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <FileText className="h-5 w-5" /> เกณฑ์ใบรับรองบังคับ (Compliance Reqs)
                  </CardTitle>
                  <CardDescription>ใบเซอร์ที่คนงานต้องมีและยังไม่หมดอายุเพื่อผ่านเกณฑ์ READY</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-10 border-blue-200 text-blue-700 bg-blue-50" onClick={() => handleGenerateAI('certificate')} disabled={!!isGenerating}>
                    {isGenerating === 'certificate' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    แนะนำโดย AI (AI Suggest)
                  </Button>
                  <Dialog open={isAddCertOpen} onOpenChange={setIsAddCertOpen}>
                    <DialogTrigger asChild>
                      <Button className="h-10 bg-primary font-bold shadow-md"><Plus className="h-4 w-4 mr-2" /> เพิ่มเกณฑ์ (Add)</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>เพิ่มเกณฑ์ใบรับรอง</DialogTitle>
                        <DialogDescription>กำหนดมาตรฐานใบรับรองสำหรับตำแหน่งงานนี้</DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label className="font-bold">ชื่อใบรับรอง (Certificate Name) *</Label>
                          <Input value={newCert.certificateName || ''} onChange={e => setNewCert({...newCert, certificateName: e.target.value})} />
                        </div>
                        <div className="grid gap-2">
                          <Label className="font-bold">รหัสมาตรฐาน (System Code)</Label>
                          <Input value={newCert.certificateCode || ''} onChange={e => setNewCert({...newCert, certificateCode: e.target.value})} />
                        </div>
                        <div className="grid gap-2">
                          <Label className="font-bold">อายุการใช้งานแนะนำ (Validity Months)</Label>
                          <Input type="number" value={newCert.validityMonths || ''} onChange={e => setNewCert({...newCert, validityMonths: parseInt(e.target.value)})} />
                        </div>
                        <div className="flex items-center space-x-2 p-3 border rounded-lg bg-muted/20">
                          <Checkbox id="req" checked={newCert.required} onCheckedChange={v => setNewCert({...newCert, required: !!v})} />
                          <Label htmlFor="req" className="font-bold cursor-pointer">บังคับต้องมี (Mandatory - Blocks Readiness)</Label>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddCertOpen(false)}>ยกเลิก</Button>
                        <Button onClick={handleAddCert} className="bg-primary font-bold">บันทึกเกณฑ์ (Save)</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 font-bold">ใบรับรอง (Certificate)</TableHead>
                      <TableHead className="font-bold">ความสำคัญ (Criticality)</TableHead>
                      <TableHead className="font-bold">อายุมาตรฐาน</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {certs?.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-primary">{c.certificateName}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{c.certificateCode || 'N/A'}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {c.required ? (
                            <Badge className="bg-red-600">Mandatory (บังคับ)</Badge>
                          ) : (
                            <Badge variant="outline" className="text-slate-500">Optional (เสริม)</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{c.validityMonths ? `${c.validityMonths} เดือน` : 'ไม่ระบุ'}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => deleteReq('certificate_requirements', c.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {certs?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-20 text-center text-muted-foreground italic">ไม่มีรายการใบเซอร์ที่กำหนด</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ppe" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <HardHat className="h-5 w-5" /> อุปกรณ์ PPE บังคับ (Standard PPE)</CardTitle>
                  <CardDescription>รายการชุดและอุปกรณ์ป้องกันภัยที่บริษัทต้องจัดเตรียมให้ตำแหน่งนี้</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-10 border-blue-200 text-blue-700 bg-blue-50" onClick={() => handleGenerateAI('ppe')} disabled={!!isGenerating}>
                    {isGenerating === 'ppe' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    แนะนำโดย AI
                  </Button>
                  <Dialog open={isAddPPEOpen} onOpenChange={setIsAddPPEOpen}>
                    <DialogTrigger asChild>
                      <Button className="h-10 bg-primary font-bold shadow-md"><Plus className="h-4 w-4 mr-2" /> เพิ่มรายการ (Add)</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>เพิ่มรายการ PPE มาตรฐาน</DialogTitle></DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label className="font-bold">ชื่ออุปกรณ์ (Item Name) *</Label>
                          <Input value={newPPE.itemName || ''} onChange={e => setNewPPE({...newPPE, itemName: e.target.value})} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label className="font-bold">รหัส (Item Code)</Label>
                            <Input value={newPPE.itemCode || ''} onChange={e => setNewPPE({...newPPE, itemCode: e.target.value})} />
                          </div>
                          <div className="grid gap-2">
                            <Label className="font-bold">จำนวนต่อคน (Qty)</Label>
                            <Input type="number" value={newPPE.quantityDefault || 1} onChange={e => setNewPPE({...newPPE, quantityDefault: parseInt(e.target.value)})} />
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 p-3 border rounded-lg">
                          <Checkbox id="ppe-req" checked={newPPE.required} onCheckedChange={v => setNewPPE({...newPPE, required: !!v})} />
                          <Label htmlFor="ppe-req" className="font-bold cursor-pointer">รายการบังคับ (Required)</Label>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddPPEOpen(false)}>ยกเลิก</Button>
                        <Button onClick={handleAddPPE} className="bg-primary font-bold">บันทึก (Save)</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 font-bold">อุปกรณ์ (PPE Item)</TableHead>
                      <TableHead className="font-bold">จำนวน (Qty)</TableHead>
                      <TableHead className="font-bold">ความสำคัญ</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ppe?.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="pl-6 font-bold text-primary">{p.itemName}</TableCell>
                        <TableCell className="text-sm font-medium">{p.quantityDefault} ชุด/คน</TableCell>
                        <TableCell>{p.required ? <Badge className="bg-orange-600">Required</Badge> : <Badge variant="outline">Optional</Badge>}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => deleteReq('ppe_requirements', p.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {ppe?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-20 text-center text-muted-foreground italic">ไม่มีรายการ PPE ที่กำหนด</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tools" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between border-b bg-primary/5 pb-4">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <Hammer className="h-5 w-5" /> เครื่องมือประจำตำแหน่ง (Tool Reqs)
                  </CardTitle>
                  <CardDescription>รายการเครื่องมือช่างพื้นฐานที่อนุญาตให้เบิกได้ตามตำแหน่งงาน</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-10 border-blue-200 text-blue-700 bg-blue-50" onClick={() => handleGenerateAI('tool')} disabled={!!isGenerating}>
                    {isGenerating === 'tool' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    แนะนำโดย AI
                  </Button>
                  <Dialog open={isAddToolOpen} onOpenChange={setIsAddToolOpen}>
                    <DialogTrigger asChild>
                      <Button className="h-10 bg-primary font-bold shadow-md"><Plus className="h-4 w-4 mr-2" /> เพิ่มรายการ (Add)</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>เพิ่มรายการเครื่องมือ/อุปกรณ์</DialogTitle></DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label className="font-bold">ชื่ออุปกรณ์ *</Label>
                          <Input value={newTool.itemName || ''} onChange={e => setNewTool({...newTool, itemName: e.target.value})} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label className="font-bold">ประเภท</Label>
                            <Select onValueChange={v => setNewTool({...newTool, itemType: v as any})} value={newTool.itemType}>
                              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="tool">Tool (เครื่องมือ)</SelectItem>
                                <SelectItem value="equipment">Equipment (เครื่องใช้)</SelectItem>
                                <SelectItem value="consumable">Consumable (วัสดุสิ้นเปลือง)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2">
                            <Label className="font-bold">จำนวนเบิก</Label>
                            <Input type="number" value={newTool.quantityDefault || 1} onChange={e => setNewTool({...newTool, quantityDefault: parseInt(e.target.value)})} />
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddToolOpen(false)}>ยกเลิก</Button>
                        <Button onClick={handleAddTool} className="bg-primary font-bold">บันทึก (Save)</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 font-bold">เครื่องมือ (Tools & Equipments)</TableHead>
                      <TableHead className="font-bold">ประเภท</TableHead>
                      <TableHead className="font-bold">จำนวนเบิก</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tools?.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="pl-6 font-bold text-primary">{t.itemName}</TableCell>
                        <TableCell className="capitalize text-xs font-medium text-muted-foreground">{t.itemType}</TableCell>
                        <TableCell className="text-sm font-bold">{t.quantityDefault} EA</TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => deleteReq('tool_requirements', t.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {tools?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-20 text-center text-muted-foreground italic">ไม่มีรายการเครื่องมือที่กำหนด</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
