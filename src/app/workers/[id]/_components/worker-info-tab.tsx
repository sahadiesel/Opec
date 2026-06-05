'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { CreditCard, HeartPulse, User, Phone, History, AlertTriangle, Wallet, Mail, CheckCircle2 } from 'lucide-react';
import type { Worker, Position, Assignment } from '@/lib/types';
import { formatDateThaiBE, formatDateTimeThaiBE } from '@/lib/date-thai';
import { sortPositionsByDisplayName } from '@/lib/position-display';
import { resolveWorkerLaborBaseRate } from '@/lib/payroll/labor-cost-model';
import { useActiveBankNameCatalog, useActiveSsoHospitalCatalog } from '@/hooks/use-hrm-name-catalogs';
import { displayWorkerRegistryJobStatus, workerRegistryJobStatusBadgeProps } from '@/lib/ops/worker-effective-job-status';

interface WorkerInfoTabProps {
  worker: Worker;
  isEditing: boolean;
  editedWorker: Partial<Worker>;
  setEditedWorker: (v: Partial<Worker>) => void;
  allPositions: Position[] | null;
  currentPosition: Position | null;
  canViewLaborCost: boolean;
  canEditLaborCost: boolean;
  /** เลขบัญชี / ข้อมูลการเงิน (จ่ายเงิน) — ซ่อนสำหรับ operations_officer / timekeeper */
  canViewBankPayrollProfile?: boolean;
  /** แก้สวิตช์พร้อม/ไม่พร้อมที่หัวข้อมูลส่วนตัว */
  canEditWorkerReadiness?: boolean;
  onReadinessManualHoldChange?: (hold: boolean) => void;
  /** HR/ผู้มีสิทธิ์แก้ทะเบียน — แสดงปุ่มเปิดใช้บัญชี Firebase */
  canActivateWorkerLogin?: boolean;
  onActivateWorkerLogin?: () => void | Promise<void>;
  activateWorkerLoginBusy?: boolean;
  /** mobilization ที่เปิดอยู่ — ใช้คำนวณสถานะงานที่แสดง */
  openMobilizations?: Assignment[] | null;
}

function numIn(v: number | undefined) {
  if (v == null || Number.isNaN(Number(v))) return '';
  return String(v);
}

function parseThaiMoneyInput(raw: string): number | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function WorkerInfoTab({
  worker,
  isEditing,
  editedWorker,
  setEditedWorker,
  allPositions,
  currentPosition,
  canViewLaborCost,
  canEditLaborCost,
  canViewBankPayrollProfile = true,
  canEditWorkerReadiness = false,
  onReadinessManualHoldChange,
  canActivateWorkerLogin = false,
  onActivateWorkerLogin,
  activateWorkerLoginBusy = false,
  openMobilizations,
}: WorkerInfoTabProps) {
  const activeBankCatalog = useActiveBankNameCatalog();
  const activeHospitalCatalog = useActiveSsoHospitalCatalog();

  const displayJobStatus = displayWorkerRegistryJobStatus(worker, openMobilizations ?? undefined);
  const jobBadge = workerRegistryJobStatusBadgeProps(displayJobStatus);

  const positionsSorted = useMemo(
    () => sortPositionsByDisplayName(allPositions ?? []),
    [allPositions]
  );

  const wEff = isEditing ? ({ ...worker, ...editedWorker } as Worker) : worker;
  const onshoreEff = canViewLaborCost
    ? resolveWorkerLaborBaseRate(
        {
          laborCostUsePositionDefault: wEff.laborCostUsePositionDefault,
          laborCostCustomOnshore: wEff.laborCostCustomOnshore,
          laborCostCustomOffshore: wEff.laborCostCustomOffshore,
          positionAllowanceDailyBaht: wEff.positionAllowanceDailyBaht,
        },
        currentPosition,
        'onshore',
      )
    : null;
  const offshoreEff = canViewLaborCost
    ? resolveWorkerLaborBaseRate(
        {
          laborCostUsePositionDefault: wEff.laborCostUsePositionDefault,
          laborCostCustomOnshore: wEff.laborCostCustomOnshore,
          laborCostCustomOffshore: wEff.laborCostCustomOffshore,
          positionAllowanceDailyBaht: wEff.positionAllowanceDailyBaht,
        },
        currentPosition,
        'offshore',
      )
    : null;
  const usePosDefault = (isEditing ? editedWorker.laborCostUsePositionDefault : worker.laborCostUsePositionDefault) !== false;
  const laborReadOnly = !isEditing || !canEditLaborCost;
  const customOnDisplay = isEditing
    ? (editedWorker.laborCostCustomOnshore !== undefined ? editedWorker.laborCostCustomOnshore : worker.laborCostCustomOnshore)
    : worker.laborCostCustomOnshore;
  const customOffDisplay = isEditing
    ? (editedWorker.laborCostCustomOffshore !== undefined ? editedWorker.laborCostCustomOffshore : worker.laborCostCustomOffshore)
    : worker.laborCostCustomOffshore;

  const readinessOnHold = worker.readinessManualHold === true;
  const readinessComplianceOk = worker.readinessStatus === 'READY';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Card className="shadow-sm">
          <CardHeader className="bg-primary/5 border-b space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <CardTitle className="text-lg flex items-center gap-2 text-primary">
                <User className="h-5 w-5 shrink-0" /> ข้อมูลส่วนตัว (Personal Details)
              </CardTitle>
              <div className="flex flex-col items-stretch gap-2 sm:items-end shrink-0">
                <div className="flex items-center gap-2 sm:gap-3">
                  <span
                    className={`text-xs font-semibold whitespace-nowrap ${readinessOnHold ? 'text-amber-900' : 'text-muted-foreground'}`}
                  >
                    ไม่พร้อม (Not Ready)
                  </span>
                  <Switch
                    checked={!readinessOnHold}
                    disabled={!canEditWorkerReadiness}
                    title={canEditWorkerReadiness ? undefined : 'ไม่มีสิทธิ์แก้ไขสถานะพร้อม'}
                    aria-label="สลับสถานะพร้อมปฏิบัติงาน"
                    onCheckedChange={(on) => onReadinessManualHoldChange?.(!on)}
                  />
                  <span
                    className={`text-xs font-semibold whitespace-nowrap ${!readinessOnHold ? 'text-green-700' : 'text-muted-foreground'}`}
                  >
                    พร้อม (Ready)
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground max-w-[280px] sm:text-right leading-snug">
                  ปิดสวิตช์เมื่อพักงานหรือมีเหตุชั่วคราว — ระบบจะไม่ให้เลือกในการมอบหมายจนกว่าจะเปิดใหม่ (ไม่เปลี่ยนผลตรวจเอกสาร)
                </p>
              </div>
            </div>
            {readinessComplianceOk && worker.complianceAlertLevel === 'warning' && (
              <p className="text-xs flex items-center gap-1.5 text-orange-800 bg-orange-50 border border-orange-200 rounded-md px-2 py-1.5 w-fit">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                เอกสารใกล้หมดอายุ (~{worker.nearestExpiryInDays ?? '-'} วัน) — ยังพร้อมมอบหมายได้แต่ควรต่ออายุ
              </p>
            )}
            {!readinessComplianceOk && (
              <p className="text-xs flex items-center gap-1.5 text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-2 py-1.5 w-fit">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                ความพร้อมจากเอกสาร: <strong className="font-mono">{worker.readinessStatus}</strong> — แก้ที่แท็บ Cert / Medical / Drug ตามเกณฑ์
              </p>
            )}
            {readinessComplianceOk && !readinessOnHold && (
              <p className="text-xs flex items-center gap-1.5 text-green-800 bg-green-50 border border-green-200 rounded-md px-2 py-1.5 w-fit">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ผ่านเกณฑ์ความพร้อม — เปิดสวิตช์พร้อมแล้วจะเข้าคิวมอบหมายได้
              </p>
            )}
            {readinessComplianceOk && readinessOnHold && (
              <p className="text-xs flex items-center gap-1.5 text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 w-fit">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                ปิดการพร้อมโดย HR — เอกสารยังครบแต่ไม่แสดงในรายการมอบหมาย
              </p>
            )}
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label className="font-bold">รหัสคนงาน (Worker Code)</Label>
                <Input disabled value={worker.workerCode || '(Auto-generated)'} className="bg-muted font-mono font-bold" />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">ชื่อจริง (First Name) *</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.firstName : worker.firstName) ?? ''} onChange={e => setEditedWorker({...editedWorker, firstName: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">นามสกุล (Last Name) *</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.lastName : worker.lastName) ?? ''} onChange={e => setEditedWorker({...editedWorker, lastName: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">ชื่อเล่น (Nickname)</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.nickname : worker.nickname) ?? ''} onChange={e => setEditedWorker({...editedWorker, nickname: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">เลขบัตรประชาชน (ID Card No.) *</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.thaiNationalId : worker.thaiNationalId) ?? ''} onChange={e => setEditedWorker({...editedWorker, thaiNationalId: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">เลขพาสปอร์ต (Passport No.)</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.passportNo : worker.passportNo) ?? ''} onChange={e => setEditedWorker({...editedWorker, passportNo: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">สัญชาติ (Nationality)</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.nationality : worker.nationality) ?? ''} onChange={e => setEditedWorker({...editedWorker, nationality: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">เบอร์โทรศัพท์ (Contact Phone) *</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.contactPhone : worker.contactPhone) ?? ''} onChange={e => setEditedWorker({...editedWorker, contactPhone: e.target.value})} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label className="font-bold flex items-center gap-2">
                  <Mail className="h-4 w-4 opacity-70" /> อีเมล (สำหรับล็อกอิน Portal)
                </Label>
                <Input
                  type="email"
                  autoComplete="off"
                  disabled={!isEditing}
                  placeholder="name@example.com"
                  value={(isEditing ? editedWorker.email : worker.email) ?? ''}
                  onChange={(e) => setEditedWorker({ ...editedWorker, email: e.target.value })}
                />
                <p className="text-xs text-muted-foreground leading-snug">
                  พนักงานล็อกอินด้วยอีเมลนี้ได้หลังผู้ดูแล HR กด «เปิดใช้อีเมลล็อกอิน» เท่านั้น — การแก้อีเมลในทะเบียนอย่างเดียวไม่ทำให้ Firebase Auth เปลี่ยนตามจนกว่าจะกดปุ่มนี้อีกครั้ง
                </p>
              </div>
              <div className="space-y-2 flex flex-col justify-end pb-1">
                {worker.linkedUserId ? (
                  <Badge className="w-fit bg-emerald-600 hover:bg-emerald-600">เปิดใช้ล็อกอินแล้ว</Badge>
                ) : (
                  <Badge variant="outline" className="w-fit border-amber-500 text-amber-900 bg-amber-50">
                    ยังไม่เปิดใช้ล็อกอิน
                  </Badge>
                )}
                {canActivateWorkerLogin && onActivateWorkerLogin ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full sm:w-auto shrink-0 font-semibold"
                    disabled={
                      activateWorkerLoginBusy ||
                      isEditing ||
                      !String(worker.email ?? '').trim().includes('@')
                    }
                    onClick={() => void onActivateWorkerLogin()}
                  >
                    {activateWorkerLoginBusy ? 'กำลังดำเนินการ…' : 'เปิดใช้อีเมลล็อกอิน (Activate)'}
                  </Button>
                ) : null}
              </div>
              <div className={canViewLaborCost ? 'space-y-2 md:col-span-2' : 'space-y-2 md:col-span-3'}>
                <Label className="font-bold">ตำแหน่งงานหลัก (Primary Position) *</Label>
                <Select
                  disabled={!isEditing}
                  onValueChange={(v) =>
                    setEditedWorker({
                      ...editedWorker,
                      currentPositionId: v === '__none__' ? '' : v,
                    })
                  }
                  value={
                    (isEditing ? editedWorker.currentPositionId : worker.currentPositionId) || '__none__'
                  }
                >
                  <SelectTrigger className="h-10"><SelectValue placeholder="เลือกตำแหน่ง" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— เลือกตำแหน่ง —</SelectItem>
                    {positionsSorted.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.positionName || p.positionNameTh}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {canViewLaborCost ? (
                <div className="space-y-2 md:col-span-1">
                  <Label className="font-bold">ค่าตำแหน่ง (บาท/วัน)</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    className="font-mono"
                    disabled={!isEditing || !canEditLaborCost}
                    placeholder="เช่น 150"
                    value={numIn(
                      isEditing
                        ? editedWorker.positionAllowanceDailyBaht !== undefined
                          ? editedWorker.positionAllowanceDailyBaht
                          : worker.positionAllowanceDailyBaht
                        : worker.positionAllowanceDailyBaht,
                    )}
                    onChange={(e) =>
                      setEditedWorker({
                        ...editedWorker,
                        positionAllowanceDailyBaht: parseThaiMoneyInput(e.target.value),
                      })
                    }
                  />
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    ต้นทุนจ่ายเท่านั้น (ไม่ใช่ราคาขาย): หลังระบบคำนวณฐานต้นทุนต่อวันตามเดิมแล้ว จะบวกจำนวนนี้เพิ่ม · ว่างหรือ 0 = ไม่บวก ·
                    ไม่บวกเมื่อใช้ override ฐานรายคน
                  </p>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label className="font-bold">ทักษะ / ความสามารถ (Skills / Trade)</Label>
              <Input
                disabled={!isEditing}
                placeholder="เช่น Welder 6G, Rigger, Scaffolder..."
                value={(isEditing ? (editedWorker.skills ?? []) : (worker.skills ?? [])).join(', ')}
                onChange={e => setEditedWorker({...editedWorker, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
              />
            </div>

            <div className="space-y-2">
              <Label className="font-bold">ที่อยู่ (Residential Address)</Label>
              <Textarea disabled={!isEditing} value={(isEditing ? editedWorker.address : worker.address) ?? ''} onChange={e => setEditedWorker({...editedWorker, address: e.target.value})} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="bg-primary/5 border-b">
            <CardTitle className="text-lg flex items-center gap-2 text-primary">
              <Phone className="h-5 w-5" /> ผู้ติดต่อฉุกเฉิน (Emergency Contact)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label className="font-bold">ชื่อผู้ติดต่อ (Contact Name)</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.emergencyContactName : worker.emergencyContactName) ?? ''} onChange={e => setEditedWorker({...editedWorker, emergencyContactName: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">เบอร์โทรฉุกเฉิน (Emergency Phone)</Label>
                <Input disabled={!isEditing} value={(isEditing ? editedWorker.emergencyContactPhone : worker.emergencyContactPhone) ?? ''} onChange={e => setEditedWorker({...editedWorker, emergencyContactPhone: e.target.value})} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        {canViewLaborCost && (
          <Card className="shadow-sm border-amber-200/60 bg-amber-50/20">
            <CardHeader className="bg-amber-100/40 border-b border-amber-100">
              <CardTitle className="text-lg flex items-center gap-2 text-amber-900">
                <Wallet className="h-5 w-5" /> ต้นทุนค่าแรง (OPEC ฝั่งจ่าย)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label className="font-bold">ยึด default ของตำแหน่งหลัก</Label>
                  <p className="text-xs text-muted-foreground">
                    ปิด = กำหนดฐาน onshore / offshore เอง (override รายคน ทุกงาน/สัญญา)
                  </p>
                </div>
                <Switch
                  disabled={laborReadOnly}
                  checked={usePosDefault}
                  onCheckedChange={(v) => {
                    setEditedWorker({ ...editedWorker, laborCostUsePositionDefault: v ? true : false });
                  }}
                />
              </div>
              {usePosDefault && !currentPosition && (
                <p className="text-sm rounded-md border border-amber-200 bg-amber-100/50 p-3 text-amber-900">
                  ยังไม่มีตำแหน่งหลัก (หรือรอโหลด) — กรุณาเลือกตำแหน่งในฟอร์มด้านบนเพื่อใช้ฐาน default
                </p>
              )}
              {usePosDefault && currentPosition && (
                <p className="text-sm rounded-md border border-amber-200/60 bg-amber-50/50 p-3 text-amber-900">
                  ฐานจากตำแหน่ง <strong>{currentPosition.positionName || currentPosition.positionNameTh}</strong>: ออนชอร์{' '}
                  {currentPosition.defaultLaborCostOnshore != null ? `฿${currentPosition.defaultLaborCostOnshore}` : '—'} ออฟชอร์{' '}
                  {currentPosition.defaultLaborCostOffshore != null ? `฿${currentPosition.defaultLaborCostOffshore}` : '—'}
                </p>
              )}
              {!usePosDefault && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="font-bold">ฐานออนชอร์ (ฝั่ง OPEC) — บาท/วัน</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      className="font-mono"
                      disabled={laborReadOnly}
                      value={numIn(customOnDisplay)}
                      onChange={(e) =>
                        setEditedWorker({ ...editedWorker, laborCostCustomOnshore: parseThaiMoneyInput(e.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">ฐานออฟชอร์ (ฝั่ง OPEC) — บาท/วัน</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      className="font-mono"
                      disabled={laborReadOnly}
                      value={numIn(customOffDisplay)}
                      onChange={(e) =>
                        setEditedWorker({ ...editedWorker, laborCostCustomOffshore: parseThaiMoneyInput(e.target.value) })
                      }
                    />
                  </div>
                </div>
              )}
              <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
                <p>
                  ตัวอย่างฐานต้นทุนต่อวัน (รวมค่าตำแหน่งแล้วเมื่อใช้ default ตำแหน่ง — ไม่ใช่ราคาขาย): ออนชอร์{' '}
                  {onshoreEff?.rate != null ? `฿${onshoreEff.rate} (${onshoreEff.source === 'position_default' ? 'ตำแหน่ง' : 'กำหนดเอง'})` : '—'} · ออฟชอร์{' '}
                  {offshoreEff?.rate != null ? `฿${offshoreEff.rate} (${offshoreEff.source === 'position_default' ? 'ตำแหน่ง' : 'กำหนดเอง'})` : '—'}
                </p>
                <p className="text-[11px]">
                  Payroll ใช้เส้นทางต้นทุนเดิมต่อใบ timesheet — มีแค่การบวกค่าตำแหน่งรายคนท้ายขั้นตอนนั้น (ถ้ามีค่ามากกว่า 0 และไม่ใช้ override รายคน)
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {canViewBankPayrollProfile ? (
        <Card className="shadow-sm border-blue-100 bg-blue-50/20">
          <CardHeader className="bg-blue-100/50 border-b border-blue-100">
            <CardTitle className="text-lg flex items-center gap-2 text-blue-800">
              <CreditCard className="h-5 w-5" /> ข้อมูลการเงิน (Financial Profile)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label className="font-bold">ชื่อธนาคาร (Bank Name)</Label>
              <Input
                disabled={!isEditing}
                list="hrm-bank-datalist-worker"
                value={(isEditing ? editedWorker.bankName : worker.bankName) ?? ''}
                onChange={(e) => setEditedWorker({ ...editedWorker, bankName: e.target.value })}
                placeholder="พิมพ์หรือเลือกจากรายการ"
              />
              <datalist id="hrm-bank-datalist-worker">
                {activeBankCatalog.map((b) => (
                  <option key={b.id} value={b.nameTh} />
                ))}
              </datalist>
              <p className="text-[11px] text-muted-foreground">
                <Link href="/hr/bank-registry" className="text-primary underline hover:no-underline">
                  จัดการทะเบียนธนาคาร
                </Link>
              </p>
            </div>
            <div className="space-y-2">
              <Label className="font-bold">ชื่อบัญชี (Account Holder Name)</Label>
              <Input disabled={!isEditing} value={(isEditing ? editedWorker.bankAccountName : worker.bankAccountName) ?? ''} onChange={e => setEditedWorker({...editedWorker, bankAccountName: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label className="font-bold">เลขที่บัญชี (Bank Account No.)</Label>
              <Input disabled={!isEditing} value={(isEditing ? editedWorker.bankAccountNumber : worker.bankAccountNumber) ?? ''} onChange={e => setEditedWorker({...editedWorker, bankAccountNumber: e.target.value})} />
            </div>
          </CardContent>
        </Card>
        ) : null}

        <Card className="shadow-sm border-emerald-100 bg-emerald-50/15">
          <CardHeader className="bg-emerald-100/40 border-b border-emerald-100">
            <CardTitle className="text-lg flex items-center gap-2 text-emerald-900">
              <HeartPulse className="h-5 w-5" /> ประกันสังคม — โรงพยาบาลหลัก (ถ้ามี)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-2">
            <Label className="font-bold">โรงพยาบาลประกันสังคม</Label>
            <Input
              disabled={!isEditing}
              list="hrm-hospital-datalist-worker"
              value={(isEditing ? editedWorker.socialSecurityHospital : worker.socialSecurityHospital) ?? ''}
              onChange={(e) => setEditedWorker({ ...editedWorker, socialSecurityHospital: e.target.value })}
              placeholder="พิมพ์หรือเลือกจากรายการ"
            />
            <datalist id="hrm-hospital-datalist-worker">
              {activeHospitalCatalog.map((h) => (
                <option key={h.id} value={h.nameTh} />
              ))}
            </datalist>
            <p className="text-[11px] text-muted-foreground">
              <Link href="/hr/hospital-registry" className="text-primary underline hover:no-underline">
                จัดการทะเบียนโรงพยาบาล
              </Link>
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="bg-destructive/5 border-b border-destructive/10">
            <CardTitle className="text-lg flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> บันทึกทางวินัย (Disciplinary Notes)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <Textarea
              disabled={!isEditing}
              className="min-h-[120px] text-destructive border-destructive/20 focus:border-destructive"
              placeholder="ระบุความผิดปกติ หรือเหตุการณ์สำคัญ..."
              value={(isEditing ? editedWorker.disciplinaryNotes : worker.disciplinaryNotes) ?? ''}
              onChange={e => setEditedWorker({...editedWorker, disciplinaryNotes: e.target.value})}
            />
          </CardContent>
        </Card>

        <Card className="shadow-sm bg-muted/20">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <History className="h-4 w-4" /> ข้อมูลระบบ (System Meta)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">ลงทะเบียนเมื่อ:</span>
              <span className="font-medium">{formatDateThaiBE(worker.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">อัปเดตล่าสุด:</span>
              <span className="font-medium">{formatDateTimeThaiBE(worker.updatedAt)}</span>
            </div>
            <div className="flex justify-between border-t pt-2 mt-2">
              <span className="text-muted-foreground">สถานะงาน (Job Status):</span>
              <Badge variant={jobBadge.variant} className={`text-[9px] uppercase font-bold ${jobBadge.className}`}>
                {jobBadge.label}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
