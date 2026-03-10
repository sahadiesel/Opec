'use client';

import { useState, use } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Save, FileText, HardHat, Hammer, ArrowLeft } from 'lucide-react';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Position, PositionCertificateRequirement, PositionPPERequirement, PositionToolRequirement, User } from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';

export default function PositionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser } = useUser();
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

  useState(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  });

  const handleSaveMaster = () => {
    if (!posRef) return;
    updateDocumentNonBlocking(posRef, { ...editedPos, updatedAt: Date.now() });
    setIsEditing(false);
    toast({ title: "บันทึกสำเร็จ", description: "ข้อมูลหลักของตำแหน่งงานถูกอัปเดตแล้ว" });
  };

  const handleAddCert = () => {
    if (!certsQuery) return;
    addDocumentNonBlocking(certsQuery, {
      certificateName: 'New Certificate',
      certificateCode: 'CERT-000',
      required: true,
      validityMonths: 12
    });
  };

  const handleAddPPE = () => {
    if (!ppeQuery) return;
    addDocumentNonBlocking(ppeQuery, {
      itemName: 'New PPE Item',
      itemCode: 'PPE-000',
      quantityDefault: 1,
      required: true
    });
  };

  const handleAddTool = () => {
    if (!toolsQuery) return;
    addDocumentNonBlocking(toolsQuery, {
      itemName: 'New Tool',
      itemCode: 'TOOL-000',
      itemType: 'tool',
      quantityDefault: 1,
      allowed: true
    });
  };

  const deleteReq = (sub: string, reqId: string) => {
    if (!firestore) return;
    if (confirm('ยืนยันการลบรายการนี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'positions', id, sub, reqId));
    }
  };

  if (isPosLoading || !position || !currentUser) return null;

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
              <Badge variant="outline" className="font-mono">{position.positionCode}</Badge>
            </div>
            <p className="text-muted-foreground">{position.category} | {position.payrollBasis} Basis</p>
          </div>
          <Button onClick={() => { setEditedPos(position); setIsEditing(!isEditing); }}>
            {isEditing ? 'Cancel Edit' : 'Edit Master Data'}
          </Button>
        </div>

        <Tabs defaultValue="master" className="w-full">
          <TabsList className="grid grid-cols-4 w-fit">
            <TabsTrigger value="master" className="gap-2"><FileText className="h-4 w-4" /> ข้อมูลหลัก</TabsTrigger>
            <TabsTrigger value="certs" className="gap-2"><FileText className="h-4 w-4" /> ใบรับรอง (Certs)</TabsTrigger>
            <TabsTrigger value="ppe" className="gap-2"><HardHat className="h-4 w-4" /> PPE</TabsTrigger>
            <TabsTrigger value="tools" className="gap-2"><Hammer className="h-4 w-4" /> อุปกรณ์ (Tools)</TabsTrigger>
          </TabsList>

          <TabsContent value="master">
            <Card>
              <CardHeader>
                <CardTitle>Master Data Profile</CardTitle>
                <CardDescription>ข้อมูลพื้นฐานและรายละเอียดของตำแหน่งงาน</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>ชื่อตำแหน่ง</Label>
                    <Input 
                      disabled={!isEditing} 
                      value={isEditing ? editedPos.positionName : position.positionName} 
                      onChange={e => setEditedPos({...editedPos, positionName: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>รหัสตำแหน่ง</Label>
                    <Input 
                      disabled={!isEditing} 
                      value={isEditing ? editedPos.positionCode : position.positionCode} 
                      onChange={e => setEditedPos({...editedPos, positionCode: e.target.value})}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>รายละเอียดงาน</Label>
                  <Input 
                    disabled={!isEditing} 
                    value={isEditing ? editedPos.description : position.description} 
                    onChange={e => setEditedPos({...editedPos, description: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>หมายเหตุภายใน (Internal Notes)</Label>
                  <Input 
                    disabled={!isEditing} 
                    value={isEditing ? editedPos.notes : position.notes} 
                    onChange={e => setEditedPos({...editedPos, notes: e.target.value})}
                  />
                </div>
                {isEditing && (
                  <Button className="gap-2" onClick={handleSaveMaster}>
                    <Save className="h-4 w-4" /> บันทึกการเปลี่ยนแปลง
                  </Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="certs">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Certificate Requirements</CardTitle>
                  <CardDescription>ใบรับรองและวุฒิบัตรที่จำเป็นสำหรับตำแหน่งนี้</CardDescription>
                </div>
                <Button onClick={handleAddCert} className="gap-2"><Plus className="h-4 w-4" /> เพิ่มใบรับรอง</Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ชื่อใบรับรอง</TableHead>
                      <TableHead>รหัส</TableHead>
                      <TableHead>บังคับ (Required)</TableHead>
                      <TableHead>อายุการใช้งาน (เดือน)</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {certs?.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.certificateName}</TableCell>
                        <TableCell className="font-mono text-xs">{c.certificateCode}</TableCell>
                        <TableCell>{c.required ? <Badge>Mandatory</Badge> : <Badge variant="outline">Optional</Badge>}</TableCell>
                        <TableCell>{c.validityMonths || 'N/A'}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteReq('certificate_requirements', c.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ppe">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>PPE Requirements</CardTitle>
                  <CardDescription>รายการชุดป้องกันส่วนบุคคลที่ต้องจัดเตรียม</CardDescription>
                </div>
                <Button onClick={handleAddPPE} className="gap-2"><Plus className="h-4 w-4" /> เพิ่มรายการ PPE</Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ชื่อรายการ PPE</TableHead>
                      <TableHead>รหัส</TableHead>
                      <TableHead>จำนวน (Default)</TableHead>
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
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tools">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Tools & Equipment Allowance</CardTitle>
                  <CardDescription>อุปกรณ์และเครื่องมือที่อนุญาตให้ใช้หรือต้องจัดเตรียม</CardDescription>
                </div>
                <Button onClick={handleAddTool} className="gap-2"><Plus className="h-4 w-4" /> เพิ่มรายการอุปกรณ์</Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ชื่ออุปกรณ์</TableHead>
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
