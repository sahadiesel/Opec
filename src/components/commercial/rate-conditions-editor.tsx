'use client';

import { useState, useMemo } from 'react';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Plus, 
  Edit2, 
  Trash2, 
  Calculator, 
  Calendar, 
  Briefcase, 
  MapPin, 
  ChevronRight,
  AlertCircle,
  Info,
  Save,
  Loader2,
  CheckCircle2,
  Zap,
  Globe,
  Anchor
} from 'lucide-react';
import { 
  RateCondition, 
  RateConditionEventType, 
  RateConditionUnitType, 
  RateConditionCalculationMethod,
  RateConditionParentType,
  RateConditionAppliesTo,
  User,
  JobMode,
  Position
} from '@/lib/types';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { Input } from '@/components/ui/input';
import {
  htmlDateValueToTimestampMs,
  timestampToHtmlDateValue,
  formatYmdLocalThaiBE,
} from '@/lib/date-thai';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, query, where, orderBy } from 'firebase/firestore';
import { addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/use-permissions';
import { Separator } from '@/components/ui/separator';
import { writeAuditLog } from '@/lib/services/audit-service';
import { sortPositionsByDisplayName } from '@/lib/position-display';

interface RateConditionsEditorProps {
  parentType: RateConditionParentType;
  parentId: string;
  appliesTo: RateConditionAppliesTo;
  user: User;
}

const EVENT_TYPE_LABELS: Record<RateConditionEventType, string> = {
  work_day: 'วันทำงานปกติ (Work Day)',
  off_day_worked: 'ทำงานวันหยุด (Off Day Worked)',
  public_holiday_worked: 'ทำงานวันหยุดนักขัตฤกษ์',
  travel_day: 'วันเดินทาง (Travel Day)',
  standby_day: 'วันแสตนบาย (Standby)',
  mobilization_day: 'วันเดินทาง',
  demobilization_day: 'วันเดินทางกลับ (De-mob)',
  training_day: 'วันอบรม (Training)',
  sick_leave_paid: 'ลาป่วย (Paid Sick Leave)',
  vacation_paid: 'ลาพักร้อน (Paid Vacation)',
  unpaid_leave: 'ลาไม่รับค่าจ้าง (Unpaid)',
  night_shift: 'กะกลางคืน (Night Shift)',
  half_day: 'ครึ่งวัน (Half Day)',
  early_return: 'กลับก่อนกำหนด (Early Return)',
  client_cancellation: 'ลูกค้ายกเลิกงาน',
  replacement_day: 'วันเปลี่ยนตัวคนงาน',
  other: 'อื่น ๆ (Other)'
};

export function RateConditionsEditor({ parentType, parentId, appliesTo, user }: RateConditionsEditorProps) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const { can } = usePermissions(user);

  // 1. Data Fetching
  const conditionsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(
      collection(firestore, 'rate_conditions'),
      where('parentType', '==', parentType),
      where('parentId', '==', parentId),
      orderBy('displayOrder', 'asc')
    );
  }, [firestore, parentType, parentId]);

  const { data: conditions, isLoading } = useCollection<RateCondition>(conditionsQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'positions') : null), [firestore]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);

  const positionsSorted = useMemo(
    () => sortPositionsByDisplayName(allPositions ?? []),
    [allPositions]
  );

  // 2. Editor State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<RateCondition>>({});

  const canEdit = useMemo(() => {
    if (appliesTo === 'SALES') {
      /** เงื่อนไขขายผูกสัญญาหลัก (parentId = main_contracts) — ไม่บังคับเมนู Sales Terms แยก */
      return can('main_contracts').edit || can('sales_contract_terms').edit;
    }
    return can('labor_cost_contract_terms').edit;
  }, [can, appliesTo]);

  // 3. Actions
  const handleAdd = () => {
    setEditingId(null);
    setFormData({
      parentType,
      parentId,
      appliesTo,
      eventType: 'work_day',
      unitType: 'DAY',
      calculationMethod: 'MULTIPLIER',
      multiplier: 1,
      baseRate: 0,
      workMode: 'BOTH',
      isActive: true,
      displayOrder: (conditions?.length || 0) + 1,
      effectiveDate: new Date().toISOString().split('T')[0],
      requiresApproval: false
    });
    setIsDialogOpen(true);
  };

  const handleEdit = (condition: RateCondition) => {
    setEditingId(condition.id);
    setFormData({ ...condition });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!firestore || !canEdit) return;

    const method = formData.calculationMethod;
    const base = Number(formData.baseRate ?? 0);
    const fixed = Number(formData.fixedAmount ?? 0);

    if ((method === 'MULTIPLIER' || method === 'PERCENTAGE' || method === 'FORMULA') && base === 0) {
      const proceed = confirm(
        `คุณเลือกวิธีคำนวณ "${method}" แต่ Base Rate = 0\n\n` +
        `ผลคำนวณจะเป็น 0 บาทเสมอ (0 × ตัวคูณ = 0)\n\n` +
        `ต้องการบันทึกต่อหรือไม่? (กดยกเลิกเพื่อกลับไปแก้ไข Base Rate)`,
      );
      if (!proceed) return;
    }

    if ((method === 'FIXED' || method === 'FLAT') && base === 0 && fixed === 0) {
      const proceed = confirm(
        `คุณเลือกวิธีคำนวณ "${method}" แต่ทั้ง Base Rate และ Fixed Amount = 0\n\n` +
        `ผลคำนวณจะเป็น 0 บาทเสมอ\n\n` +
        `ต้องการบันทึกต่อหรือไม่?`,
      );
      if (!proceed) return;
    }

    setIsSaving(true);

    try {
      if (editingId) {
        const docRef = doc(firestore, 'rate_conditions', editingId);
        updateDocumentNonBlocking(docRef, { ...formData, updatedAt: Date.now() });
        
        writeAuditLog(firestore, user, {
          actionType: 'UPDATE',
          entityType: 'RateCondition',
          entityId: editingId,
          entityLabel: `${formData.eventType}`,
          sourceModule: 'commercial',
          linkedIds: [parentId],
          contractTermId: parentType === 'SALES_CONTRACT' || parentType === 'LABOR_COST_CONTRACT' ? parentId : undefined,
          afterSummary: `Updated rate condition for ${parentType}`
        });
        
        toast({ title: "อัปเดตเงื่อนไขสำเร็จ" });
      } else {
        const colRef = collection(firestore, 'rate_conditions');
        const docRef = await addDocumentNonBlocking(colRef, {
          ...formData,
          createdAt: Date.now(),
          createdBy: user.displayName
        });
        
        if (docRef) {
          writeAuditLog(firestore, user, {
            actionType: 'CREATE',
            entityType: 'RateCondition',
            entityId: docRef.id,
            entityLabel: `${formData.eventType}`,
            sourceModule: 'commercial',
            linkedIds: [parentId],
            contractTermId: parentType === 'SALES_CONTRACT' || parentType === 'LABOR_COST_CONTRACT' ? parentId : undefined,
            afterSummary: `Created new rate condition for ${parentType}`
          });
        }
        
        toast({ title: "เพิ่มเงื่อนไขสำเร็จ" });
      }
      setIsDialogOpen(false);
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "ไม่สามารถบันทึกข้อมูลได้" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    if (!firestore || !canEdit) return;
    const condition = conditions?.find(c => c.id === id);
    if (confirm('ยืนยันการลบเงื่อนไขราคานี้?')) {
      deleteDocumentNonBlocking(doc(firestore, 'rate_conditions', id));
      
      writeAuditLog(firestore, user, {
        actionType: 'DELETE',
        entityType: 'RateCondition',
        entityId: id,
        entityLabel: condition?.eventType,
        sourceModule: 'commercial',
        linkedIds: [parentId],
        contractTermId: parentType === 'SALES_CONTRACT' || parentType === 'LABOR_COST_CONTRACT' ? parentId : undefined,
        afterSummary: `Deleted rate condition from ${parentType}`
      });
      
      toast({ title: "ลบข้อมูลสำเร็จ" });
    }
  };

  // 4. Render Helpers
  const getRateDisplay = (c: RateCondition) => {
    switch (c.calculationMethod) {
      case 'FLAT': return `฿${c.fixedAmount?.toLocaleString()}`;
      case 'MULTIPLIER': return `${c.multiplier}x ของฐาน`;
      case 'PERCENTAGE': return `${c.percentageOfBase}% ของฐาน`;
      case 'FORMULA': return `สูตรคำนวณ`;
      default: return '-';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-primary flex items-center gap-2">
            <Calculator className="h-5 w-5" /> 
            {appliesTo === 'SALES' ? 'เงื่อนไขอัตราการคิดเงินลูกค้า (Billing Rates)' : 'เงื่อนไขอัตราการจ่ายพนักงาน (Cost Rates)'}
          </h3>
          <p className="text-sm text-muted-foreground">กำหนดกฎการคำนวณรายได้/ต้นทุน แยกตามเหตุการณ์และประเภทงาน</p>
        </div>
        {canEdit && (
          <Button onClick={handleAdd} className="gap-2 bg-primary font-bold shadow-md">
            <Plus className="h-4 w-4" /> เพิ่มกฎการคำนวณ (Add Rule)
          </Button>
        )}
      </div>

      <Card className="shadow-lg border-none overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-20 text-center animate-pulse italic">กำลังโหลดรายการเงื่อนไข...</div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[60px] text-center">ลำดับ</TableHead>
                  <TableHead>เหตุการณ์ (Event Type)</TableHead>
                  <TableHead>เป้าหมาย (Scope)</TableHead>
                  <TableHead>วิธีคำนวณ (Method)</TableHead>
                  <TableHead>หน่วย</TableHead>
                  <TableHead className="text-right">อัตรา (Rate)</TableHead>
                  <TableHead className="text-center">สถานะ</TableHead>
                  <TableHead className="text-right pr-6">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conditions?.map((c) => {
                  const pos = allPositions?.find(p => p.id === c.positionId);
                  return (
                    <TableRow key={c.id} className="hover:bg-muted/20 group">
                      <TableCell className="text-center font-mono text-xs text-muted-foreground">{c.displayOrder}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-bold text-sm text-primary">{EVENT_TYPE_LABELS[c.eventType]}</span>
                          <span className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                            <Calendar className="h-2.5 w-2.5" /> {formatYmdLocalThaiBE(c.effectiveDate)}{' '}
                            {c.endDate ? `ถึง ${formatYmdLocalThaiBE(c.endDate)}` : '(ไม่มีวันหมดอายุ)'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {c.workMode === 'OFFSHORE' && <Badge variant="outline" className="text-[9px] bg-blue-50 text-blue-700 border-blue-200"><Anchor className="h-2 w-2 mr-1" /> Offshore</Badge>}
                          {c.workMode === 'ONSHORE' && <Badge variant="outline" className="text-[9px] bg-green-50 text-green-700 border-green-200"><Globe className="h-2 w-2 mr-1" /> Onshore</Badge>}
                          {pos && <Badge variant="outline" className="text-[9px]"><Briefcase className="h-2 w-2 mr-1" /> {pos.positionName || pos.positionNameTh}</Badge>}
                          {!pos && !c.workMode && <span className="text-[10px] text-muted-foreground italic">General</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px] font-bold">{c.calculationMethod}</Badge>
                      </TableCell>
                      <TableCell className="text-xs font-medium">{c.unitType}</TableCell>
                      <TableCell className="text-right font-black text-primary">
                        {getRateDisplay(c)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={c.isActive ? "bg-green-600" : "bg-slate-300"}>
                          {c.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(c)} disabled={!canEdit}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(c.id)} disabled={!canEdit}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!conditions || conditions.length === 0) && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-20 text-center text-muted-foreground italic">
                      <Zap className="h-10 w-10 mx-auto mb-4 opacity-10" />
                      ยังไม่มีการกำหนดเงื่อนไขราคา กดปุ่ม "เพิ่มกฎการคำนวณ" เพื่อเริ่มต้น
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Editor Modal */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-primary" /> {editingId ? 'แก้ไขกฎการคำนวณ' : 'สร้างกฎการคำนวณใหม่'}
            </DialogTitle>
            <DialogDescription>ระบุเงื่อนไขการคำนวณเงินรายบรรทัดสำหรับระบบอัตโนมัติ</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="font-bold">เหตุการณ์ (Event Trigger) *</Label>
                <Select value={formData.eventType} onValueChange={(v: any) => setFormData({ ...formData, eventType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EVENT_TYPE_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="font-bold">ประเภทงาน (Work Mode)</Label>
                <Select value={formData.workMode} onValueChange={(v: any) => setFormData({ ...formData, workMode: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BOTH">ทั้งคู่ (Both)</SelectItem>
                    <SelectItem value="OFFSHORE">Offshore เท่านั้น</SelectItem>
                    <SelectItem value="ONSHORE">Onshore เท่านั้น</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="font-bold">ตำแหน่งงาน (Optional Position)</Label>
                <Select value={formData.positionId || 'all'} onValueChange={(v) => setFormData({ ...formData, positionId: v === 'all' ? undefined : v })}>
                  <SelectTrigger><SelectValue placeholder="ทุกตำแหน่ง (General)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">-- ทุกตำแหน่ง --</SelectItem>
                    {positionsSorted.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.positionName || p.positionNameTh}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="font-bold text-xs">วันที่มีผล (Start)</Label>
                  <DatePickerThaiBE
                    className="h-10"
                    value={htmlDateValueToTimestampMs(formData.effectiveDate)}
                    onChange={(ms) => setFormData({ ...formData, effectiveDate: timestampToHtmlDateValue(ms) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold text-xs">วันสิ้นสุด (End)</Label>
                  <DatePickerThaiBE
                    className="h-10"
                    value={htmlDateValueToTimestampMs(formData.endDate)}
                    onChange={(ms) => setFormData({ ...formData, endDate: timestampToHtmlDateValue(ms) })}
                    allowClear
                    onClear={() => setFormData({ ...formData, endDate: '' })}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-dashed border-primary/20">
              <div className="space-y-2">
                <Label className="font-bold">วิธีคำนวณ (Calculation Method) *</Label>
                <Select value={formData.calculationMethod} onValueChange={(v: any) => setFormData({ ...formData, calculationMethod: v })}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FLAT">ยอดคงที่ (Flat Amount)</SelectItem>
                    <SelectItem value="MULTIPLIER">ตัวคูณฐานราคา (Multiplier)</SelectItem>
                    <SelectItem value="PERCENTAGE">เปอร์เซ็นต์ฐานราคา (%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="font-bold">หน่วยการคำนวณ (Unit)</Label>
                <Select value={formData.unitType} onValueChange={(v: any) => setFormData({ ...formData, unitType: v })}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAY">รายวัน (Day)</SelectItem>
                    <SelectItem value="HOUR">รายชั่วโมง (Hour)</SelectItem>
                    <SelectItem value="TRIP">ต่อเที่ยว (Trip)</SelectItem>
                    <SelectItem value="FIXED">ต่อรายการ (Fixed)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.calculationMethod === 'FLAT' && (
                <div className="space-y-2">
                  <Label className="font-bold text-blue-700">ระบุยอดเงินคงที่ (Fixed Amount)</Label>
                  <Input type="number" className="bg-white font-black text-lg" value={formData.fixedAmount} onChange={e => setFormData({ ...formData, fixedAmount: parseFloat(e.target.value) })} />
                </div>
              )}

              {formData.calculationMethod === 'MULTIPLIER' && (
                <div className="space-y-2">
                  <Label className="font-bold text-blue-700">ตัวคูณ (Multiplier)</Label>
                  <Input type="number" step="0.1" className="bg-white font-black text-lg" value={formData.multiplier} onChange={e => setFormData({ ...formData, multiplier: parseFloat(e.target.value) })} />
                  <p className="text-[10px] text-muted-foreground italic">เช่น 1.5 สำหรับ OT, 0.5 สำหรับวันเดินทางครึ่งราคา</p>
                </div>
              )}

              {formData.calculationMethod === 'PERCENTAGE' && (
                <div className="space-y-2">
                  <Label className="font-bold text-blue-700">เปอร์เซ็นต์ (%)</Label>
                  <Input type="number" className="bg-white font-black text-lg" value={formData.percentageOfBase} onChange={e => setFormData({ ...formData, percentageOfBase: parseFloat(e.target.value) })} />
                </div>
              )}

              <div className="space-y-2">
                <Label className="font-bold">ลำดับการแสดงผล (Priority)</Label>
                <Input type="number" value={formData.displayOrder} onChange={e => setFormData({ ...formData, displayOrder: parseInt(e.target.value) })} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-bold">ข้อกำหนด/หมายเหตุในการเบิกจ่าย (Policy Text)</Label>
            <Input 
              placeholder={appliesTo === 'SALES' ? "เช่น คิดเงินเฉพาะกรณีที่..." : "เช่น จ่ายให้เฉพาะพนักงานที่..."}
              value={appliesTo === 'SALES' ? formData.billableConditionText : formData.payableConditionText} 
              onChange={e => setFormData({ ...formData, [appliesTo === 'SALES' ? 'billableConditionText' : 'payableConditionText']: e.target.value })} 
            />
          </div>

          <DialogFooter className="bg-muted/30 -mx-6 -mb-6 p-4 mt-4 border-t flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleSave} disabled={isSaving} className="bg-primary font-bold shadow-md">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              บันทึกเงื่อนไข
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
