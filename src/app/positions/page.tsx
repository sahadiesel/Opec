'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Sparkles, Trash2, Edit, ListChecks, HardHat, Hammer } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { RoleType, Position, PositionRequirement } from '@/lib/types';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { generatePositionRequirements } from '@/ai/flows/generate-position-requirements';

export default function PositionsPage() {
  const [user, setUser] = useState<{ displayName: string; role: RoleType } | null>(null);
  const [positions, setPositions] = useState<Position[]>([
    { id: '1', name: 'Offshore Welder', department: 'Operations', description: 'Experienced welder for offshore platform maintenance.' },
    { id: '2', name: 'Safety Officer', department: 'HSE', description: 'Ensures safety compliance on site.' },
    { id: '3', name: 'Crane Operator', department: 'Logistics', description: 'Certified heavy crane operator.' },
  ]);
  
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState('');
  const [activeReqType, setActiveReqType] = useState<'certificate' | 'ppe' | 'tool'>('certificate');

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setUser(JSON.parse(stored));
  }, []);

  const handleAiAssist = async () => {
    if (!selectedPosition) return;
    setIsAiLoading(true);
    try {
      const result = await generatePositionRequirements({
        positionName: selectedPosition.name,
        requirementsType: activeReqType,
        additionalDetails: 'Requires specific safety and technical standards for OPEC operations.'
      });
      setAiResult(result.description);
    } catch (error) {
      console.error(error);
    } finally {
      setIsAiLoading(false);
    }
  };

  if (!user) return null;

  return (
    <AppShell user={user} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">เมทริกซ์ตำแหน่งงาน (Position Matrix)</h1>
            <p className="text-muted-foreground">กำหนดเกณฑ์ความพร้อม มาตรฐานใบรับรอง PPE และอุปกรณ์สำหรับแต่ละตำแหน่ง</p>
          </div>
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> เพิ่มตำแหน่งงานใหม่
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>รายการตำแหน่งงาน</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาตำแหน่ง..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ตำแหน่ง (Position)</TableHead>
                  <TableHead>แผนก (Dept)</TableHead>
                  <TableHead>เกณฑ์ความต้องการ (Matrix Requirements)</TableHead>
                  <TableHead className="text-right">จัดการ (Actions)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((pos) => (
                  <TableRow key={pos.id}>
                    <TableCell className="font-semibold">{pos.name}</TableCell>
                    <TableCell>{pos.department}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">3 Certs</span>
                        <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-700/10">Medical Mandatory</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" onClick={() => {
                            setSelectedPosition(pos);
                            setAiResult('');
                          }}>
                            <Edit className="h-4 w-4 mr-1" /> จัดการเกณฑ์
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>จัดการเกณฑ์มาตรฐาน: {pos.name}</DialogTitle>
                            <DialogDescription>
                              ระบุความต้องการขั้นพื้นฐานสำหรับคนงานในตำแหน่งนี้
                            </DialogDescription>
                          </DialogHeader>
                          
                          <Tabs defaultValue="certificate" onValueChange={(v) => setActiveReqType(v as any)} className="w-full mt-4">
                            <TabsList className="grid w-full grid-cols-3">
                              <TabsTrigger value="certificate" className="gap-2"><ListChecks className="h-4 w-4" /> ใบรับรอง</TabsTrigger>
                              <TabsTrigger value="ppe" className="gap-2"><HardHat className="h-4 w-4" /> ชุด PPE</TabsTrigger>
                              <TabsTrigger value="tool" className="gap-2"><Hammer className="h-4 w-4" /> อุปกรณ์</TabsTrigger>
                            </TabsList>
                            
                            {['certificate', 'ppe', 'tool'].map((type) => (
                              <TabsContent key={type} value={type} className="space-y-4 pt-4">
                                <div className="flex items-center justify-between">
                                  <h3 className="text-lg font-medium">รายการ {type === 'certificate' ? 'ใบรับรอง' : type === 'ppe' ? 'PPE' : 'อุปกรณ์'} ที่บังคับ</h3>
                                  <Button variant="outline" size="sm" className="gap-2 text-secondary border-secondary" onClick={handleAiAssist} disabled={isAiLoading}>
                                    <Sparkles className="h-4 w-4" /> {isAiLoading ? 'AI กำลังวิเคราะห์...' : 'ใช้ AI ช่วยแนะนำ'}
                                  </Button>
                                </div>
                                
                                <div className="border rounded-md p-4 bg-muted/30">
                                  {aiResult ? (
                                    <div className="space-y-3">
                                      <Label className="text-secondary font-bold">ข้อเสนอแนะจาก AI Assistant:</Label>
                                      <Textarea value={aiResult} onChange={(e) => setAiResult(e.target.value)} className="min-h-[200px] text-sm" />
                                      <p className="text-xs text-muted-foreground italic">* กรุณาตรวจสอบและแก้ไขข้อความข้างต้นก่อนบันทึกเป็นมาตรฐาน</p>
                                    </div>
                                  ) : (
                                    <div className="text-center py-8 text-muted-foreground">
                                      ยังไม่มีการระบุเกณฑ์มาตรฐาน กด "ใช้ AI ช่วยแนะนำ" เพื่อเริ่มต้นอย่างรวดเร็ว
                                    </div>
                                  )}
                                </div>
                              </TabsContent>
                            ))}
                          </Tabs>

                          <DialogFooter className="mt-6">
                            <Button variant="ghost">ยกเลิก</Button>
                            <Button className="bg-primary">บันทึกเกณฑ์มาตรฐาน</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                      <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
