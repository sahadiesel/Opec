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
  Briefcase
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

  const [isGenerating, setIsGenerating] = useState(false);

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
    setIsGenerating(true);
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
      setIsGenerating(false);
    }
  };

  if (isPosLoading || !position || !currentUser) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-muted-foreground">กำลังโหลดข้อมูลตำแหน่งงาน...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/positions"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{position.positionName}</h1>
              <Badge variant="outline" className="font-mono text-primary border-primary/20">{position.positionCode}</Badge>
            </div>
            <p className="text-muted-foreground">{position.category} | จ่ายแบบ {position.payrollBasis}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditedPos(position); setIsEditing(!isEditing); }}>
              {isEditing ? 'ยกเลิกการแก้ไข' : 'แก้ไขข้อมูลหลัก'}
            </Button>
            {isEditing && (
              <Button className="gap-2" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึก
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="master" className="w-full">
          <TabsList className="grid grid-cols-4 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="master" className="gap-2 py-2 px-6"><Briefcase className="h-4 w-4" /> ข้อมูลตำแหน่ง</TabsTrigger>
            <TabsTrigger value="certs" className="gap-2 py-2 px-6"><FileText className="h-4 w-4" /> ใบเซอร์ (Certificates)</TabsTrigger>
            <TabsTrigger value="ppe" className="gap-2 py-2 px-6"><HardHat className="h-4 w-4" /> PPE</TabsTrigger>
            <TabsTrigger value="tools" className="gap-2 py-2 px-6"><Hammer className="h-4 w-4" /> เครื่องมือ/อุปกรณ์</TabsTrigger>
          </TabsList>

          <TabsContent value="master" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>ข้อมูลตำแหน่ง (Position Info)</CardTitle>
                <CardDescription>รายละเอียดพื้นฐานของตำแหน่งงาน</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>ชื่อตำแหน่ง (Position Name)</Label>
                    <Input 
                      disabled={!isEditing} 
                      value={isEditing ? editedPos.positionName : position.positionName} 
                      onChange={e => setEditedPos({...editedPos, positionName: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>รหัสตำแหน่ง (Code)</Label>
                    <Input 
                      disabled={!isEditing} 
                      value={isEditing ? editedPos.positionCode : position.positionCode} 
                      onChange={e => setEditedPos({...editedPos, positionCode: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>หมวดหมู่ (Category)</Label>
                    <Select 
                      disabled={!isEditing}
                      onValueChange={v => setEditedPos({...editedPos, category: v})}
                      value={isEditing ? editedPos.category : position.category}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Offshore">Offshore</SelectItem>
                        <SelectItem value="Onshore">Onshore</SelectItem>
                        <SelectItem value="Technical">Technical</SelectItem>
                        <SelectItem value="Administrative">Administrative</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>ฐานการจ่ายเงิน (Payroll Basis)</Label>
                    <Select 
                      disabled={!isEditing}
                      onValueChange={v => setEditedPos({...editedPos, payrollBasis: v as any})}
                      value={isEditing ? editedPos.payrollBasis : position.payrollBasis}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Daily">Daily</SelectItem>
                        <SelectItem value="Monthly">Monthly</SelectItem>
                        <SelectItem value="Hourly">Hourly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>รายละเอียดงาน (Description)</Label>
                  <Textarea 
                    className="min-h-[100px]"
                    disabled={!isEditing} 
                    value={isEditing ? editedPos.description : position.description} 
                    onChange={e => setEditedPos({...editedPos, description: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>หมายเหตุภายใน (Internal Notes)</Label>
                  <Textarea 
                    className="min-h-[80px]"
                    disabled={!isEditing} 
                    value={isEditing ? editedPos.notes : position.notes} 
                    onChange={e => setEditedPos({...editedPos, notes: e.target.value})}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="certs" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>ใบเซอร์ที่ต้องมี (Required Certificates)</CardTitle>
                  <CardDescription>เกณฑ์ใบเซอร์มาตรฐานสำหรับตำแหน่งนี้</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleGenerateAI('certificate')} disabled={isGenerating}>
                    <Sparkles className="h-4 w-4 mr-2" /> AI Helper
                  </Button>
                  <Dialog open={isAddCertOpen} onOpenChange={setIsAddCertOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2"><Plus className="h-4 w-4" /> เพิ่มใบเซอร์</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>เพิ่มเกณฑ์ใบเซอร์</DialogTitle>
                        <DialogDescription>เพิ่มมาตรฐานใบเซอร์สำหรับตำแหน่งนี้</DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label>ชื่อใบเซอร์ (Certificate Name)</Label>
                          <Input value={newCert.certificateName || ''} onChange={e => setNewCert({...newCert, certificateName: e.target.value})} />
                        </div>
                        <div className="grid gap-2">
                          <Label>รหัสใบเซอร์ (Code)</Label>
                          <Input value={newCert.certificateCode || ''} onChange={e => setNewCert({...newCert, certificateCode: e.target.value})} />
                        </div>
                        <div className="grid gap-2">
                          <Label>อายุการใช้งาน (Validity Months)</Label>
                          <Input type="number" value={newCert.validityMonths || ''} onChange={e => setNewCert({...newCert, validityMonths: parseInt(e.target.value)})} />
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox id="req" checked={newCert.required} onCheckedChange={v => setNewCert({...newCert, required: !!v})} />
                          <Label htmlFor="req">บังคับ (Mandatory)</Label>
                        </div>
                        <div className="grid gap-2">
                          <Label>หมายเหตุ</Label>
                          <Textarea value={newCert.notes || ''} onChange={e => setNewCert({...newCert, notes: e.target.value})} />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddCertOpen(false)}>ยกเลิก</Button>
                        <Button onClick={handleAddCert}>บันทึกรายการ</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ใบเซอร์</TableHead>
                      <TableHead>รหัส</TableHead>
                      <TableHead>บังคับ</TableHead>
                      <TableHead>อายุใช้งาน (ด.)</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {certs?.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.certificateName}</TableCell>
                        <TableCell className="font-mono text-xs">{c.certificateCode}</TableCell>
                        <TableCell>{c.required ? <Badge>Mandatory</Badge> : <Badge variant="outline">Optional</Badge>}</TableCell>
                        <TableCell>{c.validityMonths || '-'}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteReq('certificate_requirements', c.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!certs?.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่มีข้อมูลใบเซอร์</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ppe" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>PPE ที่ต้องใช้ (Required PPE)</CardTitle>
                  <CardDescription>รายการชุดอุปกรณ์ป้องกันส่วนบุคคลพื้นฐาน</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleGenerateAI('ppe')} disabled={isGenerating}>
                    <Sparkles className="h-4 w-4 mr-2" /> AI Helper
                  </Button>
                  <Dialog open={isAddPPEOpen} onOpenChange={setIsAddPPEOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2"><Plus className="h-4 w-4" /> เพิ่มรายการ PPE</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>เพิ่มรายการ PPE</DialogTitle>
                        <DialogDescription>กำหนดอุปกรณ์ PPE มาตรฐานสำหรับตำแหน่งนี้</DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label>ชื่ออุปกรณ์</Label>
                          <Input value={newPPE.itemName || ''} onChange={e => setNewPPE({...newPPE, itemName: e.target.value})} />
                        </div>
                        <div className="grid gap-2">
                          <Label>รหัสอุปกรณ์</Label>
                          <Input value={newPPE.itemCode || ''} onChange={e => setNewPPE({...newPPE, itemCode: e.target.value})} />
                        </div>
                        <div className="grid gap-2">
                          <Label>จำนวนมาตรฐาน</Label>
                          <Input type="number" value={newPPE.quantityDefault || 1} onChange={e => setNewPPE({...newPPE, quantityDefault: parseInt(e.target.value)})} />
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox id="ppe-req" checked={newPPE.required} onCheckedChange={v => setNewPPE({...newPPE, required: !!v})} />
                          <Label htmlFor="ppe-req">บังคับ (Required)</Label>
                        </div>
                        <div className="grid gap-2">
                          <Label>หมายเหตุ</Label>
                          <Textarea value={newPPE.notes || ''} onChange={e => setNewPPE({...newPPE, notes: e.target.value})} />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddPPEOpen(false)}>ยกเลิก</Button>
                        <Button onClick={handleAddPPE}>บันทึกรายการ</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>อุปกรณ์ PPE</TableHead>
                      <TableHead>รหัส</TableHead>
                      <TableHead>จำนวน</TableHead>
                      <TableHead>บังคับ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ppe?.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.itemName}</TableCell>
                        <TableCell className="font-mono text-xs">{p.itemCode}</TableCell>
                        <TableCell>{p.quantityDefault}</TableCell>
                        <TableCell>{p.required ? <Badge>Required</Badge> : <Badge variant="outline">Optional</Badge>}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteReq('ppe_requirements', p.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!ppe?.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่มีข้อมูล PPE</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tools" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>เครื่องมือ/อุปกรณ์ (Tools / Equipment)</CardTitle>
                  <CardDescription>รายการเครื่องมือที่ได้รับอนุญาต</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleGenerateAI('tool')} disabled={isGenerating}>
                    <Sparkles className="h-4 w-4 mr-2" /> AI Helper
                  </Button>
                  <Dialog open={isAddToolOpen} onOpenChange={setIsAddToolOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2"><Plus className="h-4 w-4" /> เพิ่มเครื่องมือ</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>เพิ่มเครื่องมือ/อุปกรณ์</DialogTitle>
                        <DialogDescription>กำหนดเครื่องมือมาตรฐานสำหรับตำแหน่งงาน</DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label>ชื่อเครื่องมือ</Label>
                          <Input value={newTool.itemName || ''} onChange={e => setNewTool({...newTool, itemName: e.target.value})} />
                        </div>
                        <div className="grid gap-2">
                          <Label>รหัสเครื่องมือ</Label>
                          <Input value={newTool.itemCode || ''} onChange={e => setNewTool({...newTool, itemCode: e.target.value})} />
                        </div>
                        <div className="grid gap-2">
                          <Label>ประเภท</Label>
                          <Select onValueChange={v => setNewTool({...newTool, itemType: v as any})} value={newTool.itemType}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="tool">Tool</SelectItem>
                              <SelectItem value="equipment">Equipment</SelectItem>
                              <SelectItem value="consumable">Consumable</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label>จำนวนเริ่มต้น</Label>
                          <Input type="number" value={newTool.quantityDefault || 1} onChange={e => setNewTool({...newTool, quantityDefault: parseInt(e.target.value)})} />
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox id="tool-allow" checked={newTool.allowed} onCheckedChange={v => setNewTool({...newTool, allowed: !!v})} />
                          <Label htmlFor="tool-allow">อนุญาตให้ใช้ (Allowed)</Label>
                        </div>
                        <div className="grid gap-2">
                          <Label>หมายเหตุ</Label>
                          <Textarea value={newTool.notes || ''} onChange={e => setNewTool({...newTool, notes: e.target.value})} />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddToolOpen(false)}>ยกเลิก</Button>
                        <Button onClick={handleAddTool}>บันทึกรายการ</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เครื่องมือ / อุปกรณ์</TableHead>
                      <TableHead>รหัส</TableHead>
                      <TableHead>ประเภท</TableHead>
                      <TableHead>จำนวน</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tools?.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.itemName}</TableCell>
                        <TableCell className="font-mono text-xs">{t.itemCode}</TableCell>
                        <TableCell className="capitalize">{t.itemType}</TableCell>
                        <TableCell>{t.quantityDefault}</TableCell>
                        <TableCell>{t.allowed ? <Badge className="bg-green-500">Allowed</Badge> : <Badge variant="destructive">Blocked</Badge>}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteReq('tool_requirements', t.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!tools?.length && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">ไม่มีข้อมูลอุปกรณ์</TableCell>
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
