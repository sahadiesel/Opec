'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Sparkles, Trash2, Edit } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { RoleType, Position } from '@/lib/types';
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
import { generatePositionRequirements } from '@/ai/flows/generate-position-requirements';

export default function PositionsPage() {
  const [user, setUser] = useState<{ displayName: string; role: RoleType } | null>(null);
  const [positions, setPositions] = useState<Position[]>([
    { id: '1', name: 'Offshore Welder', department: 'Operations', description: 'Experienced welder for offshore platform maintenance.' },
    { id: '2', name: 'Safety Officer', department: 'HSE', description: 'Ensures safety compliance on site.' },
    { id: '3', name: 'Crane Operator', department: 'Logistics', description: 'Certified heavy crane operator.' },
  ]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);

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
        requirementsType: 'certificate',
        additionalDetails: 'Requires offshore-specific safety certifications.'
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
            <h1 className="text-2xl font-bold tracking-tight">จัดการตำแหน่งงาน (Positions)</h1>
            <p className="text-muted-foreground">กำหนดตำแหน่งและเกณฑ์ความพร้อมสำหรับคนงาน</p>
          </div>
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> เพิ่มตำแหน่งงาน
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>รายการตำแหน่งงาน</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="ค้นหาตำแหน่งงาน..." className="pl-8" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อตำแหน่ง (Position Name)</TableHead>
                  <TableHead>แผนก (Department)</TableHead>
                  <TableHead>คำอธิบาย (Description)</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((pos) => (
                  <TableRow key={pos.id}>
                    <TableCell className="font-medium">{pos.name}</TableCell>
                    <TableCell>{pos.department}</TableCell>
                    <TableCell className="max-w-xs truncate">{pos.description}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" onClick={() => setSelectedPosition(pos)}>
                            <Sparkles className="h-4 w-4 mr-1 text-secondary" /> AI Assist
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                          <DialogHeader>
                            <DialogTitle>AI Requirements Assistant</DialogTitle>
                            <DialogDescription>
                              สร้างรายละเอียดความต้องการใบรับรองสำหรับตำแหน่ง {pos.name} โดยอัตโนมัติ
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="space-y-2">
                              <Label>ตำแหน่งงาน</Label>
                              <Input value={pos.name} readOnly />
                            </div>
                            <Button 
                              onClick={handleAiAssist} 
                              disabled={isAiLoading}
                              className="w-full gap-2 bg-secondary hover:bg-secondary/90"
                            >
                              {isAiLoading ? 'กำลังสร้างข้อมูล...' : <><Sparkles className="h-4 w-4" /> สร้างรายละเอียดความต้องการ</>}
                            </Button>
                            {aiResult && (
                              <div className="space-y-2">
                                <Label>ผลลัพธ์จาก AI</Label>
                                <Textarea value={aiResult} readOnly className="h-48 font-mono text-xs" />
                              </div>
                            )}
                          </div>
                          <DialogFooter>
                            <Button variant="outline">ยกเลิก</Button>
                            <Button disabled={!aiResult}>บันทึกเป็นมาตรฐาน</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                      <Button variant="ghost" size="icon"><Edit className="h-4 w-4" /></Button>
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