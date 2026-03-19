'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Hash, 
  Settings2, 
  RefreshCcw, 
  Search, 
  Edit2, 
  ShieldAlert, 
  Info,
  Calendar,
  Building2,
  Clock,
  Loader2,
  Save,
  CheckCircle2,
  PlusCircle,
  Zap
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User, NumberSequence, DeptType } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, updateDoc, query, orderBy, setDoc, writeBatch } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/use-permissions';
import { SEQUENCE_REGISTRY } from '@/lib/services/numbering-service';
import { writeAuditLog } from '@/lib/services/audit-service';

export default function NumberingAdminPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSequence, setSelectedSequence] = useState<NumberSequence | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  // Edit form state
  const [editData, setEditData] = useState<Partial<NumberSequence>>({});

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const { can, isLoading: isPermLoading } = usePermissions(currentUser);

  const numberingQuery = useMemoFirebase(() => {
    if (!firestore || !can('document_numbering').view) return null;
    return query(collection(firestore, 'number_sequences'), orderBy('sequenceKey', 'asc'));
  }, [firestore, can('document_numbering').view]);

  const { data: sequences, isLoading: isSequencesLoading } = useCollection<NumberSequence>(numberingQuery as any);

  const filteredSequences = useMemo(() => {
    if (!sequences) return [];
    return sequences.filter(s => 
      s.label.toLowerCase().includes(searchTerm.toLowerCase()) || 
      s.sequenceKey.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.prefix.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [sequences, searchTerm]);

  // Identify missing sequences from registry
  const missingSequences = useMemo(() => {
    if (!sequences) return [];
    const existingKeys = new Set(sequences.map(s => s.sequenceKey));
    return Object.keys(SEQUENCE_REGISTRY).filter(key => !existingKeys.has(key));
  }, [sequences]);

  const handleEdit = (seq: NumberSequence) => {
    setSelectedSequence(seq);
    setEditData({
      lastNumber: seq.lastNumber,
      prefix: seq.prefix,
      resetPolicy: seq.resetPolicy,
      isActive: seq.isActive,
      paddingLength: seq.paddingLength
    });
    setIsEditDialogOpen(true);
  };

  const handleSave = async () => {
    if (!firestore || !selectedSequence || !currentUser || !can('document_numbering').edit) return;
    setIsSaving(true);

    try {
      const seqRef = doc(firestore, 'number_sequences', selectedSequence.id);
      const updatePayload = {
        ...editData,
        updatedAt: Date.now(),
        updatedBy: currentUser.displayName
      };

      await updateDoc(seqRef, updatePayload);

      // Log the maintenance action
      await writeAuditLog(firestore, currentUser, {
        actionType: 'UPDATE_SEQUENCE',
        entityType: 'NumberSequence',
        entityId: selectedSequence.id,
        entityLabel: selectedSequence.label,
        afterSummary: `Updated sequence settings: prefix=${editData.prefix}, lastNumber=${editData.lastNumber}`,
        sourceModule: 'system'
      });

      toast({ title: "อัปเดตลำดับสำเร็จ", description: `แก้ไขข้อมูลลำดับ ${selectedSequence.label} เรียบร้อยแล้ว` });
      setIsEditDialogOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleInitializeMissing = async () => {
    if (!firestore || missingSequences.length === 0 || !currentUser) return;
    setIsInitializing(true);

    try {
      const batch = writeBatch(firestore);
      const now = Date.now();
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;

      for (const key of missingSequences) {
        const config = SEQUENCE_REGISTRY[key];
        const seqRef = doc(firestore, 'number_sequences', key);
        
        const newSeq: NumberSequence = {
          id: key,
          sequenceKey: key,
          label: config.label,
          prefix: config.prefix,
          department: config.dept,
          entityType: key,
          resetPolicy: config.resetPolicy,
          year: currentYear,
          month: currentMonth,
          paddingLength: config.padding,
          lastNumber: 0,
          lastIssuedCode: null,
          isActive: true,
          updatedAt: now,
          updatedBy: currentUser.displayName + ' (Auto-Init)'
        };
        
        batch.set(seqRef, newSeq);
      }

      await batch.commit();

      // Log bulk initialization
      await writeAuditLog(firestore, currentUser, {
        actionType: 'INIT_SEQUENCES',
        entityType: 'NumberSequence',
        entityId: 'registry',
        afterSummary: `Initialized ${missingSequences.length} missing sequences from registry`,
        sourceModule: 'system'
      });

      toast({ 
        title: "ตั้งค่าลำดับเริ่มต้นสำเร็จ", 
        description: `สร้างตัวนับลำดับใหม่จำนวน ${missingSequences.length} รายการ` 
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Init Failed", description: err.message });
    } finally {
      setIsInitializing(false);
    }
  };

  if (isUserLoading || isPermLoading || !currentUser) return null;

  if (!can('document_numbering').view) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Restricted (จำกัดสิทธิ์เข้าถึง)</h2>
          <p className="text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงส่วนการจัดการเลขที่เอกสาร กรุณาติดต่อผู้ดูแลระบบสูงสุด</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <Hash className="h-8 w-8 text-primary" /> จัดการเลขที่เอกสาร (Numbering Admin)
            </h1>
            <p className="text-muted-foreground text-lg">
              ควบคุมตัวนับลำดับ (Running Counters) และนโยบายการออกรหัสเอกสารทุกโมดูล
            </p>
          </div>
          {missingSequences.length > 0 && (
            <Button 
              className="gap-2 bg-blue-600 hover:bg-blue-700 shadow-md font-bold h-11" 
              onClick={handleInitializeMissing}
              disabled={isInitializing}
            >
              {isInitializing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              ตั้งค่าลำดับที่ขาดหาย ({missingSequences.length})
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-primary/5 border-primary/20 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-primary">System Registry</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-primary">{Object.keys(SEQUENCE_REGISTRY).length} Types</div>
              <p className="text-[10px] text-muted-foreground mt-1">โมดูลที่รองรับการรันเลขที่อัตโนมัติ</p>
            </CardContent>
          </Card>
          <Card className="bg-green-50 border-green-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-green-800">Initialized Counters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-green-700">{sequences?.length || 0} Records</div>
              <p className="text-[10px] text-green-600 mt-1">จำนวนตัวนับที่ถูกสร้างในฐานข้อมูลแล้ว</p>
            </CardContent>
          </Card>
          <Card className="bg-amber-50 border-amber-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase text-amber-800">Ready to Use</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-amber-700">100%</div>
              <p className="text-[10px] text-green-600 mt-1">สถานะความพร้อมของระบบรันเลขที่</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-3 bg-card p-4 rounded-lg border shadow-sm">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="ค้นหาชื่อเอกสาร หรือ Prefix..." 
              className="pl-9 h-11" 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isSequencesLoading ? (
              <div className="py-20 text-center animate-pulse italic">กำลังโหลดข้อมูลตัวนับลำดับ...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4">เอกสาร (Document Label)</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead className="text-center">ลำดับล่าสุด</TableHead>
                    <TableHead>รหัสล่าสุดที่ออก</TableHead>
                    <TableHead>Padding</TableHead>
                    <TableHead>Reset Policy</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSequences.map((s) => (
                    <TableRow key={s.id} className="hover:bg-muted/20">
                      <TableCell className="pl-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-sm text-primary">{s.label}</span>
                          <span className="text-[10px] font-mono text-muted-foreground uppercase">{s.sequenceKey}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-black text-primary">{s.prefix}</TableCell>
                      <TableCell className="text-center font-black text-lg">{s.lastNumber}</TableCell>
                      <TableCell className="font-mono text-xs text-blue-700 font-bold">{s.lastIssuedCode || '-'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.paddingLength} digits</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[9px] uppercase font-bold bg-white">
                          {s.resetPolicy}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <Button variant="ghost" size="icon" className="text-primary" onClick={() => handleEdit(s)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredSequences.length === 0 && !isSequencesLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-20 text-center text-muted-foreground italic">
                        ไม่พบข้อมูลตัวนับที่ค้นหา
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Safeguard Disclaimer */}
        <Card className="bg-amber-50 border-amber-200 border-dashed border-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-800 font-bold uppercase tracking-wider">
              <ShieldAlert className="h-4 w-4" /> Numbering Integrity Guide
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[10px] text-amber-700 leading-relaxed space-y-2">
            <p>1. <b>ห้ามแก้ไขลำดับล่าสุด (Last Number) ให้มีค่าน้อยลง</b> โดยไม่จำเป็น หากมีข้อมูลเก่าใช้เลขนั้นไปแล้ว ระบบจะติดลูป Uniqueness Safeguard ทำให้ไม่สามารถบันทึกข้อมูลใหม่ได้</p>
            <p>2. การเปลี่ยน <b>Prefix</b> จะมีผลกับเอกสารใบถัดไปทันที</p>
            <p>3. <b>Reset Policy</b> จะตรวจสอบการเปลี่ยน ปี/เดือน อัตโนมัติเมื่อมีการออกเลขที่ใหม่</p>
          </CardContent>
        </Card>

        {/* Editor Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-md border-t-8 border-t-primary">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-primary" /> แก้ไขตัวนับ: {selectedSequence?.label}
              </DialogTitle>
              <DialogDescription>จัดการค่าพื้นฐานของตัวนับลำดับ (Maintenance Mode)</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="font-bold">ลำดับปัจจุบัน (Current Counter)</Label>
                <Input 
                  type="number" 
                  value={editData.lastNumber} 
                  onChange={e => setEditData({...editData, lastNumber: parseInt(e.target.value)})} 
                  className="font-black text-xl"
                />
                <p className="text-[10px] text-muted-foreground italic">
                  * เลขถัดไปที่จะถูกออกคือ { (editData.lastNumber || 0) + 1 }
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="font-bold">Prefix</Label>
                  <Input 
                    value={editData.prefix} 
                    onChange={e => setEditData({...editData, prefix: e.target.value})} 
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold">Padding (Length)</Label>
                  <Input 
                    type="number"
                    value={editData.paddingLength} 
                    onChange={e => setEditData({...editData, paddingLength: parseInt(e.target.value)})} 
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="font-bold">นโยบายเริ่มนับใหม่ (Reset Policy)</Label>
                <Select 
                  value={editData.resetPolicy} 
                  onValueChange={(v: any) => setEditData({...editData, resetPolicy: v})}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (นับต่อเนื่องตลอดไป)</SelectItem>
                    <SelectItem value="yearly">Yearly (เริ่มใหม่ทุกปี)</SelectItem>
                    <SelectItem value="monthly">Monthly (เริ่มใหม่ทุกเดือน)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                <Label className="font-bold cursor-pointer">สถานะตัวนับ (Active Status)</Label>
                <Badge variant={editData.isActive ? 'default' : 'secondary'} className={editData.isActive ? 'bg-green-600' : ''}>
                  {editData.isActive ? 'ENABLED' : 'DISABLED'}
                </Badge>
              </div>
            </div>

            <DialogFooter className="bg-muted/30 -mx-6 -mb-6 p-4 mt-4 flex justify-end gap-2 border-t">
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>ยกเลิก</Button>
              <Button onClick={handleSave} disabled={isSaving || !can('document_numbering').edit} className="bg-primary font-bold">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                บันทึกการเปลี่ยนแปลง
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
