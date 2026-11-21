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
import { CreditCard, HeartPulse, User, History, AlertTriangle, Wallet, Mail, CheckCircle2, Settings2, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Worker, Position, Assignment } from '@/lib/types';
import { formatDateThaiBE, formatDateTimeThaiBE } from '@/lib/date-thai';
import { sortPositionsByDisplayName } from '@/lib/position-display';
import { resolveWorkerLaborBaseRate } from '@/lib/payroll/labor-cost-model';
import type { AssignedContractLaborQuote } from '@/lib/payroll/timesheet-labor-base-cost';
import { deriveOtHourlyRatesFromDailyPackage } from '@/lib/commercial/package-hourly-rate';
import { useActiveBankNameCatalog, useActiveSsoHospitalCatalog } from '@/hooks/use-hrm-name-catalogs';
import { NameTitleSelect, NameTitleEnSelect, type EnNameTitle } from '@/components/hr/name-title-select';
import { EmploymentTenureFields } from '@/components/hr/employment-tenure-fields';
import type { EmploymentEndReason } from '@/lib/hr/employment-tenure';
import { displayWorkerRegistryJobStatus, workerRegistryJobStatusBadgeProps } from '@/lib/ops/worker-effective-job-status';
import { workerEmploymentContractStatus } from '@/lib/hr/worker-employment-contract-status';
import {
  LUMP_SUM_ENGAGEMENT_LOCKED_MESSAGE,
  workerPayrollEngagementChangeBlocked,
} from '@/lib/payroll/lump-sum-worker';

interface WorkerInfoTabProps {
  worker: Worker;
  isEditingProfile: boolean;
  isEditingSettings: boolean;
  editedWorker: Partial<Worker>;
  setEditedWorker: (v: Partial<Worker>) => void;
  allPositions: Position[] | null;
  currentPosition: Position | null;
  canEditWorker: boolean;
  canViewLaborCost: boolean;
  canEditLaborCost: boolean;
  /** เลขบัญชี / ข้อมูลการเงิน (จ่ายเงิน) — ซ่อนสำหรับ operations_officer / timekeeper */
  canViewBankPayrollProfile?: boolean;
  /** HR/ผู้มีสิทธิ์แก้ทะเบียน — แสดงปุ่มเปิดใช้บัญชี Firebase */
  canActivateWorkerLogin?: boolean;
  onActivateWorkerLogin?: () => void | Promise<void>;
  activateWorkerLoginBusy?: boolean;
  /** mobilization ที่เปิดอยู่ — ใช้คำนวณสถานะงานที่แสดง */
  openMobilizations?: Assignment[] | null;
  /** null = กำลังโหลดเรทจากสัญญาของงานที่มอบหมาย */
  assignedLaborQuotes?: AssignedContractLaborQuote[] | null;
  sectionSaving?: boolean;
  onBeginEditProfile?: () => void;
  onCancelEditProfile?: () => void;
  onSaveProfile?: () => void;
  onBeginEditSettings?: () => void;
  onCancelEditSettings?: () => void;
  onSaveSettings?: () => void;
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
  isEditingProfile,
  isEditingSettings,
  editedWorker,
  setEditedWorker,
  allPositions,
  currentPosition,
  canEditWorker,
  canViewLaborCost,
  canEditLaborCost,
  canViewBankPayrollProfile = true,
  canActivateWorkerLogin = false,
  onActivateWorkerLogin,
  activateWorkerLoginBusy = false,
  openMobilizations,
  assignedLaborQuotes = null,
  sectionSaving = false,
  onBeginEditProfile,
  onCancelEditProfile,
  onSaveProfile,
  onBeginEditSettings,
  onCancelEditSettings,
  onSaveSettings,
}: WorkerInfoTabProps) {
  const activeBankCatalog = useActiveBankNameCatalog();
  const activeHospitalCatalog = useActiveSsoHospitalCatalog();

  const displayJobStatus = displayWorkerRegistryJobStatus(worker, openMobilizations ?? undefined);
  const jobBadge = workerRegistryJobStatusBadgeProps(displayJobStatus);
  const engagementChangeLocked = workerPayrollEngagementChangeBlocked(worker, openMobilizations);

  const positionsSorted = useMemo(
    () => sortPositionsByDisplayName(allPositions ?? []),
    [allPositions]
  );

  const isEditingAny = isEditingProfile || isEditingSettings;
  const wEff = isEditingAny ? ({ ...worker, ...editedWorker } as Worker) : worker;
  const profileLocked = !isEditingProfile;
  const settingsLocked = !isEditingSettings;
  const laborReadOnly = settingsLocked || !canEditLaborCost;
  const bankNameValue = (isEditingProfile ? editedWorker.bankName : worker.bankName) ?? '';
  const bankNameInCatalog = activeBankCatalog.some((b) => b.nameTh === bankNameValue);
  const hospitalValue =
    (isEditingProfile ? editedWorker.socialSecurityHospital : worker.socialSecurityHospital) ?? '';
  const hospitalInCatalog = activeHospitalCatalog.some((h) => h.nameTh === hospitalValue);
  const engagementKind = wEff.payrollEngagementKind === 'LUMP_SUM' ? 'LUMP_SUM' : 'COMPANY';
  const isLumpSum = engagementKind === 'LUMP_SUM';
  const contractStatus = workerEmploymentContractStatus(wEff);
  const assignedNow = displayJobStatus === 'ASSIGNED' || displayJobStatus === 'ON_SITE';
  const pastContractWhileWorking = contractStatus.pastEndDate && assignedNow;
  const contractReady = contractStatus.inContract;
  const onshoreEff = canViewLaborCost
    ? resolveWorkerLaborBaseRate(
        {
          laborCostUsePositionDefault: wEff.laborCostUsePositionDefault,
          laborCostCustomOnshore: wEff.laborCostCustomOnshore,
          laborCostCustomOffshore: wEff.laborCostCustomOffshore,
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
        },
        currentPosition,
        'offshore',
      )
    : null;
  const usePosDefault =
    (isEditingSettings ? editedWorker.laborCostUsePositionDefault : worker.laborCostUsePositionDefault) !== false;
  const customOnDisplay = isEditingSettings
    ? editedWorker.laborCostCustomOnshore !== undefined
      ? editedWorker.laborCostCustomOnshore
      : worker.laborCostCustomOnshore
    : worker.laborCostCustomOnshore;
  const customOffDisplay = isEditingSettings
    ? editedWorker.laborCostCustomOffshore !== undefined
      ? editedWorker.laborCostCustomOffshore
      : worker.laborCostCustomOffshore
    : worker.laborCostCustomOffshore;

  const slipRateLabel = (mode: 'onshore' | 'offshore') => {
    if (!usePosDefault) {
      const eff = mode === 'onshore' ? onshoreEff : offshoreEff;
      return eff?.rate != null ? `฿${eff.rate.toLocaleString('th-TH')} (กำหนดเอง)` : '—';
    }
    const fromContract = (assignedLaborQuotes ?? []).find((q) => q.workMode === mode && q.contractDaily > 0);
    if (fromContract) {
      return `฿${fromContract.contractDaily.toLocaleString('th-TH')} (สัญญา)`;
    }
    const fallback = mode === 'onshore'
      ? currentPosition?.defaultLaborCostOnshore
      : currentPosition?.defaultLaborCostOffshore;
    const n = Number(fallback);
    if (Number.isFinite(n) && n > 0) {
      return `฿${n.toLocaleString('th-TH')} (ฐานตำแหน่ง)`;
    }
    return '—';
  };

  /** มาตรฐานออฟชอร์ 12 ชม. = 8 ปกติ + 4 OT → OT1.5/ชม. จากฐานรายวัน */
  const offshoreOtPreview = useMemo(() => {
    let d: number | null = null;
    if (usePosDefault) {
      const fromContract = (assignedLaborQuotes ?? []).find(
        (q) => q.workMode === 'offshore' && q.contractDaily > 0,
      );
      const base = fromContract?.contractDaily || Number(currentPosition?.defaultLaborCostOffshore) || 0;
      if (base > 0) d = base;
    } else {
      d = offshoreEff?.rate ?? null;
    }
    if (d == null || !(d > 0)) return null;
    const rates = deriveOtHourlyRatesFromDailyPackage(d, 12);
    return {
      daily: d,
      normalHourly: Math.round(rates.normalHourly * 100) / 100,
      ot15Hourly: Math.round(rates.ot15Hourly * 100) / 100,
    };
  }, [
    usePosDefault,
    assignedLaborQuotes,
    currentPosition?.defaultLaborCostOffshore,
    offshoreEff?.rate,
  ]);

  const readinessComplianceOk = worker.readinessStatus === 'READY';

  return (
    <div className="space-y-6">
        <Card className="shadow-sm">
          <CardHeader className="bg-primary/5 border-b space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <CardTitle className="text-lg flex items-center gap-2 text-primary">
                <User className="h-5 w-5 shrink-0" /> ข้อมูลส่วนตัว (Personal Details)
              </CardTitle>
              {canEditWorker ? (
                <div className="flex flex-wrap items-center gap-2">
                  {isEditingProfile ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9"
                        disabled={sectionSaving || isEditingSettings}
                        onClick={onCancelEditProfile}
                      >
                        ยกเลิก
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 gap-1.5 font-semibold"
                        disabled={sectionSaving || isEditingSettings}
                        onClick={onSaveProfile}
                      >
                        {sectionSaving ? null : <Save className="h-3.5 w-3.5" />}
                        บันทึกข้อมูลส่วนตัว
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={isEditingSettings}
                      onClick={onBeginEditProfile}
                    >
                      แก้ไข
                    </Button>
                  )}
                </div>
              ) : null}
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
                ไม่พร้อมมอบหมายจากเอกสาร (Not Ready to Assign):{' '}
                <strong className="font-mono">{worker.readinessStatus}</strong> — แก้ที่แท็บ เอกสาร/ใบเซอร์ / Medical / Drug ตามเกณฑ์
              </p>
            )}
            {readinessComplianceOk && contractReady && (
              <p className="text-xs flex items-center gap-1.5 text-green-800 bg-green-50 border border-green-200 rounded-md px-2 py-1.5 w-fit">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ผ่านเกณฑ์เอกสาร และยังอยู่ในช่วงสัญญา — เข้าคิวมอบหมายได้
              </p>
            )}
            {readinessComplianceOk && !contractReady && (
              <p className="text-xs flex items-center gap-1.5 text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 w-fit">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {contractStatus.beforeStart
                  ? 'ยังไม่ถึงวันเริ่มงานตามทะเบียน'
                  : 'เลยช่วงสัญญา / สิ้นสุดการจ้างแล้ว — แก้วันที่ในกล่องตั้งค่าลูกจ้างด้านล่าง'}
              </p>
            )}
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 xl:gap-5">
              <div className="space-y-2">
                <Label className="font-bold">รหัสคนงาน (Worker Code)</Label>
                <Input disabled value={worker.workerCode || '(Auto-generated)'} className="bg-muted font-mono font-bold" />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">เลขบัตรประชาชน (ID Card No.) *</Label>
                <Input disabled={profileLocked} value={(isEditingProfile ? editedWorker.thaiNationalId : worker.thaiNationalId) ?? ''} onChange={e => setEditedWorker({...editedWorker, thaiNationalId: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">คำนำหน้าชื่อ (ภาษาไทย)</Label>
                <NameTitleSelect
                  disabled={profileLocked}
                  value={(isEditingProfile ? editedWorker.nameTitle : worker.nameTitle) ?? ''}
                  onChange={(nameTitle) => setEditedWorker({ ...editedWorker, nameTitle })}
                />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">ชื่อ (ภาษาไทย)</Label>
                <Input disabled={profileLocked} value={(isEditingProfile ? editedWorker.firstNameTh : worker.firstNameTh) ?? ''} onChange={e => setEditedWorker({...editedWorker, firstNameTh: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">นามสกุล (ภาษาไทย)</Label>
                <Input disabled={profileLocked} value={(isEditingProfile ? editedWorker.lastNameTh : worker.lastNameTh) ?? ''} onChange={e => setEditedWorker({...editedWorker, lastNameTh: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">คำนำหน้าชื่อ (ภาษาอังกฤษ)</Label>
                <NameTitleEnSelect
                  disabled={profileLocked}
                  value={(isEditingProfile ? editedWorker.nameTitleEn : worker.nameTitleEn) ?? ''}
                  onChange={(nameTitleEn: EnNameTitle | '') => setEditedWorker({ ...editedWorker, nameTitleEn })}
                />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">ชื่อ (ภาษาอังกฤษ) *</Label>
                <Input disabled={profileLocked} value={(isEditingProfile ? editedWorker.firstName : worker.firstName) ?? ''} onChange={e => setEditedWorker({...editedWorker, firstName: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">นามสกุล (ภาษาอังกฤษ) *</Label>
                <Input disabled={profileLocked} value={(isEditingProfile ? editedWorker.lastName : worker.lastName) ?? ''} onChange={e => setEditedWorker({...editedWorker, lastName: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">ชื่อเล่น (Nickname)</Label>
                <Input disabled={profileLocked} value={(isEditingProfile ? editedWorker.nickname : worker.nickname) ?? ''} onChange={e => setEditedWorker({...editedWorker, nickname: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">สัญชาติ (Nationality)</Label>
                <Input disabled={profileLocked} value={(isEditingProfile ? editedWorker.nationality : worker.nationality) ?? ''} onChange={e => setEditedWorker({...editedWorker, nationality: e.target.value})} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 xl:gap-5 items-end">
              <div className="space-y-2 min-w-0">
                <Label className="font-bold">เบอร์โทรศัพท์ (Contact Phone) *</Label>
                <Input
                  className="h-10"
                  disabled={profileLocked}
                  value={(isEditingProfile ? editedWorker.contactPhone : worker.contactPhone) ?? ''}
                  onChange={(e) => setEditedWorker({ ...editedWorker, contactPhone: e.target.value })}
                />
              </div>
              <div className="space-y-2 min-w-0">
                <Label className="font-bold flex items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0 opacity-70" /> อีเมล (ล็อกอิน)
                </Label>
                <Input
                  type="email"
                  autoComplete="off"
                  className="h-10"
                  disabled={profileLocked}
                  placeholder="name@example.com"
                  value={(isEditingProfile ? editedWorker.email : worker.email) ?? ''}
                  onChange={(e) => setEditedWorker({ ...editedWorker, email: e.target.value })}
                />
              </div>
              <div className="space-y-2 min-w-0">
                <Label className="font-bold flex flex-wrap items-center gap-2">
                  สถานะล็อกอิน
                  {worker.linkedUserId ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600 font-normal">เปิดใช้แล้ว</Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-500 text-amber-900 bg-amber-50 font-normal">
                      ยังไม่เปิดใช้
                    </Badge>
                  )}
                </Label>
                {canActivateWorkerLogin && onActivateWorkerLogin ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10 w-full font-semibold"
                    disabled={
                      activateWorkerLoginBusy ||
                      isEditingProfile ||
                      !String(worker.email ?? '').trim().includes('@')
                    }
                    onClick={() => void onActivateWorkerLogin()}
                  >
                    {activateWorkerLoginBusy ? 'กำลังดำเนินการ…' : 'เปิดใช้อีเมลล็อกอิน'}
                  </Button>
                ) : (
                  <div className="flex h-10 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
                    {worker.linkedUserId ? 'ใช้งานล็อกอินได้แล้ว' : 'ไม่มีสิทธิ์เปิดใช้'}
                  </div>
                )}
              </div>
              <div className="space-y-2 min-w-0">
                <Label className="font-bold">ตำแหน่งงานหลัก (Primary Position) *</Label>
                <Select
                  disabled={profileLocked}
                  onValueChange={(v) =>
                    setEditedWorker({
                      ...editedWorker,
                      currentPositionId: v === '__none__' ? '' : v,
                    })
                  }
                  value={
                    (isEditingProfile ? editedWorker.currentPositionId : worker.currentPositionId) || '__none__'
                  }
                >
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="เลือกตำแหน่ง" />
                  </SelectTrigger>
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
            </div>
            <p className="text-xs text-muted-foreground leading-snug -mt-2">
              พนักงานล็อกอินด้วยอีเมลได้หลังผู้ดูแล HR กด «เปิดใช้อีเมลล็อกอิน» — แก้อีเมลในทะเบียนอย่างเดียวไม่เปลี่ยน Firebase Auth จนกว่าจะกดปุ่มอีกครั้ง
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 xl:gap-5">
              <div className="space-y-2">
                <Label className="font-bold">ที่อยู่ (Residential Address)</Label>
                <Textarea
                  disabled={profileLocked}
                  rows={5}
                  className="min-h-[7.5rem] resize-y"
                  value={(isEditingProfile ? editedWorker.address : worker.address) ?? ''}
                  onChange={(e) => setEditedWorker({ ...editedWorker, address: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">ทักษะ / ความสามารถ (Skills / Trade)</Label>
                <Textarea
                  disabled={profileLocked}
                  rows={5}
                  className="min-h-[7.5rem] resize-y"
                  placeholder="เช่น Welder 6G, Rigger, Scaffolder..."
                  value={(isEditingProfile ? (editedWorker.skills ?? []) : (worker.skills ?? [])).join(', ')}
                  onChange={(e) =>
                    setEditedWorker({
                      ...editedWorker,
                      skills: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 xl:gap-5">
              <div className="space-y-2 col-span-2">
                <Label className="font-bold">ชื่อผู้ติดต่อฉุกเฉิน (Contact Name)</Label>
                <Input
                  disabled={profileLocked}
                  value={(isEditingProfile ? editedWorker.emergencyContactName : worker.emergencyContactName) ?? ''}
                  onChange={(e) => setEditedWorker({ ...editedWorker, emergencyContactName: e.target.value })}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label className="font-bold">เบอร์โทรฉุกเฉิน (Emergency Phone)</Label>
                <Input
                  disabled={profileLocked}
                  value={(isEditingProfile ? editedWorker.emergencyContactPhone : worker.emergencyContactPhone) ?? ''}
                  onChange={(e) => setEditedWorker({ ...editedWorker, emergencyContactPhone: e.target.value })}
                />
              </div>
            </div>

            <div
              className={cn(
                'grid grid-cols-1 gap-4 xl:gap-5 pt-2',
                canViewBankPayrollProfile
                  ? 'lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)]'
                  : 'lg:grid-cols-2',
              )}
            >
              {canViewBankPayrollProfile ? (
                <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/20 p-4 min-w-0">
                  <p className="text-sm font-bold flex items-center gap-2 text-blue-800 whitespace-nowrap">
                    <CreditCard className="h-4 w-4 shrink-0" /> ข้อมูลการเงิน
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-3">
                    <div className="space-y-2 min-w-0">
                      <Label className="font-bold whitespace-nowrap">ชื่อธนาคาร (Bank Name)</Label>
                      <Select
                        disabled={profileLocked}
                        value={bankNameValue ? bankNameValue : '__none__'}
                        onValueChange={(v) =>
                          setEditedWorker({
                            ...editedWorker,
                            bankName: v === '__none__' ? '' : v,
                          })
                        }
                      >
                        <SelectTrigger className="h-10 bg-background">
                          <SelectValue placeholder="เลือกธนาคาร" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— ไม่ระบุ —</SelectItem>
                          {bankNameValue && !bankNameInCatalog ? (
                            <SelectItem value={bankNameValue}>{bankNameValue} (ค่าเดิม)</SelectItem>
                          ) : null}
                          {activeBankCatalog.map((b) => (
                            <SelectItem key={b.id} value={b.nameTh}>
                              {b.nameTh}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        <Link href="/hr/bank-registry" className="text-primary underline hover:no-underline">
                          จัดการทะเบียนธนาคาร
                        </Link>
                        {activeBankCatalog.length === 0 ? ' · ยังไม่มีรายการในทะเบียน' : null}
                      </p>
                    </div>
                    <div className="space-y-2 min-w-0">
                      <Label className="font-bold whitespace-nowrap">เลขที่บัญชี (Bank Account No.)</Label>
                      <Input
                        disabled={profileLocked}
                        value={(isEditingProfile ? editedWorker.bankAccountNumber : worker.bankAccountNumber) ?? ''}
                        onChange={(e) => setEditedWorker({ ...editedWorker, bankAccountNumber: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold whitespace-nowrap">ชื่อบัญชี (Account Holder Name)</Label>
                    <Input
                      disabled={profileLocked}
                      value={(isEditingProfile ? editedWorker.bankAccountName : worker.bankAccountName) ?? ''}
                      onChange={(e) => setEditedWorker({ ...editedWorker, bankAccountName: e.target.value })}
                    />
                  </div>
                </div>
              ) : null}

              <div className="space-y-2 rounded-lg border border-emerald-100 bg-emerald-50/15 p-4 min-w-0">
                <p className="text-sm font-bold flex items-center gap-2 text-emerald-900 leading-snug">
                  <HeartPulse className="h-4 w-4 shrink-0" /> ประกันสังคม — โรงพยาบาลหลัก
                </p>
                <Label className="font-bold">โรงพยาบาลประกันสังคม</Label>
                <Select
                  disabled={profileLocked}
                  value={hospitalValue ? hospitalValue : '__none__'}
                  onValueChange={(v) =>
                    setEditedWorker({
                      ...editedWorker,
                      socialSecurityHospital: v === '__none__' ? '' : v,
                    })
                  }
                >
                  <SelectTrigger className="h-10 bg-background">
                    <SelectValue placeholder="เลือกโรงพยาบาล" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— ไม่ระบุ —</SelectItem>
                    {hospitalValue && !hospitalInCatalog ? (
                      <SelectItem value={hospitalValue}>{hospitalValue} (ค่าเดิม)</SelectItem>
                    ) : null}
                    {activeHospitalCatalog.map((h) => (
                      <SelectItem key={h.id} value={h.nameTh}>
                        {h.nameTh}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  <Link href="/hr/hospital-registry" className="text-primary underline hover:no-underline">
                    จัดการทะเบียนโรงพยาบาล
                  </Link>
                  {activeHospitalCatalog.length === 0 ? ' · ยังไม่มีรายการในทะเบียน' : null}
                </p>
              </div>

              <div className="space-y-2 rounded-lg border border-destructive/10 bg-destructive/5 p-4 min-w-0">
                <p className="text-sm font-bold flex items-center gap-2 text-destructive whitespace-nowrap">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> บันทึกทางวินัย
                </p>
                <Textarea
                  disabled={profileLocked}
                  className="min-h-[7.5rem] text-destructive border-destructive/20 focus:border-destructive"
                  placeholder="ระบุความผิดปกติ หรือเหตุการณ์สำคัญ..."
                  value={(isEditingProfile ? editedWorker.disciplinaryNotes : worker.disciplinaryNotes) ?? ''}
                  onChange={(e) => setEditedWorker({ ...editedWorker, disciplinaryNotes: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-amber-200/60 bg-amber-50/20">
          <CardHeader className="bg-amber-100/40 border-b border-amber-100 space-y-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-lg flex items-center gap-2 text-amber-900">
                  <Settings2 className="h-5 w-5" /> ตั้งค่าลูกจ้าง
                </CardTitle>
                <p className="text-xs text-amber-900/80 leading-snug">
                  ประเภทจ้าง · วันเริ่ม–สิ้นสุด · สถานะจากสัญญา · ราคาที่ใช้คำนวณค่าจ้าง
                </p>
              </div>
              {canEditWorker ? (
                <div className="flex flex-wrap items-center gap-2">
                  {isEditingSettings ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9"
                        disabled={sectionSaving || isEditingProfile}
                        onClick={onCancelEditSettings}
                      >
                        ยกเลิก
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 gap-1.5 font-semibold bg-amber-800 hover:bg-amber-800"
                        disabled={sectionSaving || isEditingProfile}
                        onClick={onSaveSettings}
                      >
                        {sectionSaving ? null : <Save className="h-3.5 w-3.5" />}
                        บันทึกตั้งค่า
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={isEditingProfile}
                      onClick={onBeginEditSettings}
                    >
                      แก้ไข
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 rounded-md border border-amber-200/70 bg-background/80 p-3">
                <Label className="font-bold">ประเภทลูกจ้าง</Label>
                <div className="flex items-center gap-2 sm:gap-3">
                  <span
                    className={cn(
                      'text-xs font-semibold whitespace-nowrap',
                      !isLumpSum ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    ลูกจ้างบริษัท
                  </span>
                  <Switch
                    checked={isLumpSum}
                    disabled={settingsLocked || engagementChangeLocked}
                    title={engagementChangeLocked ? LUMP_SUM_ENGAGEMENT_LOCKED_MESSAGE : undefined}
                    aria-label="ประเภทลูกจ้าง บริษัท หรือแบบเหมา"
                    onCheckedChange={(on) => {
                      if (engagementChangeLocked) return;
                      setEditedWorker({
                        ...editedWorker,
                        payrollEngagementKind: on ? 'LUMP_SUM' : 'COMPANY',
                      });
                    }}
                  />
                  <span
                    className={cn(
                      'text-xs font-semibold whitespace-nowrap',
                      isLumpSum ? 'text-amber-800' : 'text-muted-foreground',
                    )}
                  >
                    ลูกจ้างแบบเหมา
                  </span>
                </div>
                {engagementChangeLocked ? (
                  <p className="text-[11px] text-amber-800 leading-snug">{LUMP_SUM_ENGAGEMENT_LOCKED_MESSAGE}</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    เงื่อนไขคำนวณจ่ายเงินยังตามประเภทเดิม — เปลี่ยนได้เมื่อยังไม่ถูกมอบหมาย / ยังไม่ลงไซต์
                  </p>
                )}
              </div>

              <div className="space-y-2 rounded-md border border-amber-200/70 bg-background/80 p-3">
                <Label className="font-bold">สถานะพร้อมทำงาน (จากสัญญา)</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    className={cn(
                      'text-[11px]',
                      contractReady
                        ? 'bg-green-700 hover:bg-green-700 text-white'
                        : 'bg-amber-800 hover:bg-amber-800 text-white',
                    )}
                  >
                    {contractReady ? 'พร้อมทำงาน' : 'ไม่พร้อมทำงาน'}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {contractStatus.beforeStart
                      ? 'ยังไม่ถึงวันเริ่มงาน'
                      : contractStatus.pastEndDate
                        ? 'เลยวันสิ้นสุดสัญญาแล้ว'
                        : contractStatus.endYmd
                          ? 'ยังอยู่ในช่วงเริ่ม–สิ้นสุด'
                          : 'ยังไม่มีวันสิ้นสุด — ถือว่าอยู่ในสัญญา'}
                  </span>
                </div>
                {pastContractWhileWorking ? (
                  <p className="text-xs flex items-start gap-1.5 text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-2 py-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      <strong>เลยกำหนดสัญญา</strong> แต่ยังถูกมอบหมายงานอยู่ — ให้ฝ่ายบุคคลแก้วันสิ้นสุด
                      หรือ Unassign ออกจากงาน
                    </span>
                  </p>
                ) : null}
                {!contractStatus.startYmd ? (
                  <p className="text-[11px] text-amber-900">ยังไม่ได้ระบุวันเริ่มงาน</p>
                ) : null}
                {isLumpSum && !contractStatus.endYmd ? (
                  <p className="text-[11px] text-amber-900">ลูกจ้างแบบเหมาต้องระบุวันสิ้นสุดตามสัญญา</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-bold">วันเริ่มงาน / สิ้นสุดงาน</Label>
              <EmploymentTenureFields
                requireEndDate={isLumpSum}
                endDateHint={
                  isLumpSum
                    ? 'ตามสัญญา — แก้ให้หมดก่อนหรือหลังกำหนดได้'
                    : 'เมื่อสิ้นสุดงานระบุวันพร้อมเหตุผล (ลาออก / ให้ออก / ป่วย·อุบัติเหตุ)'
                }
                startDate={(isEditingSettings ? editedWorker.startDate : worker.startDate) || ''}
                endDate={(isEditingSettings ? editedWorker.employmentEndDate : worker.employmentEndDate) || ''}
                endReason={
                  ((isEditingSettings ? editedWorker.employmentEndReason : worker.employmentEndReason) ||
                    '') as EmploymentEndReason | ''
                }
                endReasonNote={
                  (isEditingSettings ? editedWorker.employmentEndReasonNote : worker.employmentEndReasonNote) || ''
                }
                tenures={
                  isEditingSettings
                    ? editedWorker.employmentTenures ?? worker.employmentTenures
                    : worker.employmentTenures
                }
                legacyStart={worker.startDate}
                legacyEnd={worker.employmentEndDate}
                disabled={settingsLocked}
                onChange={(patch) =>
                  setEditedWorker({
                    ...editedWorker,
                    startDate: patch.startDate,
                    employmentEndDate: patch.endDate,
                    employmentEndReason: patch.endReason,
                    employmentEndReasonNote: patch.endReasonNote,
                  })
                }
              />
            </div>

            {canViewLaborCost ? (
              <div className="space-y-4 border-t border-amber-200/70 pt-4">
              <div className="flex items-center gap-2 text-amber-950">
                <Wallet className="h-4 w-4" />
                <Label className="font-bold text-base">ต้นทุนค่าแรง (OPEC ฝั่งจ่าย)</Label>
              </div>
              <div className="space-y-2">
                <Label className="font-bold">วิธีคำนวณค่าแรง</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-lg border border-amber-200/80 bg-background p-0.5">
                    <button
                      type="button"
                      disabled={laborReadOnly}
                      className={cn(
                        'px-3 py-1.5 text-sm rounded-md transition-colors disabled:opacity-60',
                        usePosDefault
                          ? 'bg-amber-800 text-white shadow-sm'
                          : 'text-muted-foreground hover:bg-muted',
                      )}
                      onClick={() =>
                        setEditedWorker({ ...editedWorker, laborCostUsePositionDefault: true })
                      }
                    >
                      เลือกจากสัญญา
                    </button>
                    <button
                      type="button"
                      disabled={laborReadOnly}
                      className={cn(
                        'px-3 py-1.5 text-sm rounded-md transition-colors disabled:opacity-60',
                        !usePosDefault
                          ? 'bg-amber-800 text-white shadow-sm'
                          : 'text-muted-foreground hover:bg-muted',
                      )}
                      onClick={() =>
                        setEditedWorker({ ...editedWorker, laborCostUsePositionDefault: false })
                      }
                    >
                      ตั้งค่าเอง
                    </button>
                  </div>
                  <Badge
                    className={cn(
                      'text-[11px] font-medium',
                      usePosDefault
                        ? 'bg-amber-800 hover:bg-amber-800 text-white'
                        : 'border-amber-700/40 bg-amber-50 text-amber-950 hover:bg-amber-50',
                    )}
                    variant={usePosDefault ? 'default' : 'outline'}
                  >
                    ตอนนี้: {usePosDefault ? 'เลือกจากสัญญา' : 'ตั้งค่าเอง'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {usePosDefault
                    ? 'กำลังดึง OFF/ON Work จากสัญญาของลูกค้าที่ได้รับมอบหมายไปทำงาน'
                    : 'กำลังใช้ฐานที่กรอกด้านล่าง — ไม่ใช้เรทในสัญญา (ตั้งค่าเองเมื่อเรทคนนี้ไม่เท่าสัญญา)'}
                </p>
              </div>
              {usePosDefault && assignedLaborQuotes == null && (
                <p className="text-sm text-muted-foreground">กำลังอ่านสัญญาของงานที่มอบหมาย…</p>
              )}
              {usePosDefault && assignedLaborQuotes != null && assignedLaborQuotes.length === 0 && (
                <p className="text-sm rounded-md border border-amber-200 bg-amber-100/50 p-3 text-amber-900">
                  ยังไม่มีงานที่มอบหมายที่ผูกสัญญา — ตอนออกสลิปจะใช้สัญญาบนใบงานของวันนั้น
                  ถ้าวันนั้นไม่มีเรทต้นทุนในสัญญา จะใช้ฐานมาตรฐานตำแหน่ง
                </p>
              )}
              {usePosDefault && assignedLaborQuotes != null && assignedLaborQuotes.length > 0 && (
                <div className="space-y-2">
                  {assignedLaborQuotes.map((q) => (
                      <div
                        key={q.assignmentId}
                        className="text-sm rounded-md border border-amber-200/60 bg-amber-50/50 p-3 text-amber-950 space-y-1"
                      >
                        <p>
                          งาน <strong>{q.projectName || '—'}</strong>
                          {' · สัญญา '}
                          <Link href={`/main-contracts/${q.contractId}`} className="underline underline-offset-2">
                            {q.contractLabel}
                          </Link>
                        </p>
                        <p>
                          {q.positionName} · {q.workMode === 'offshore' ? 'ออฟชอร์' : 'ออนชอร์'}{' '}
                          {q.contractDaily > 0 ? (
                            <strong>฿{q.contractDaily.toLocaleString('th-TH')}</strong>
                          ) : (
                            <span>สัญญานี้ยังไม่มีเรทต้นทุนของตำแหน่งนี้</span>
                          )}
                        </p>
                      </div>
                    ))}
                </div>
              )}
              {usePosDefault && currentPosition && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  ฐานมาตรฐานตำแหน่ง {currentPosition.positionName || currentPosition.positionNameTh}{' '}
                  (ใช้เมื่อสัญญาของวันนั้นไม่มีเรท): ออนชอร์{' '}
                  {currentPosition.defaultLaborCostOnshore != null ? `฿${currentPosition.defaultLaborCostOnshore}` : '—'}{' '}
                  ออฟชอร์{' '}
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
                <p className="rounded-md border border-amber-200/70 bg-amber-50/80 p-2.5 text-amber-950 leading-relaxed">
                  <span className="font-semibold">มาตรฐานออฟชอร์ 12 ชม.</span> = 8 ชม.ปกติ + 4 ชม.OT
                  {' '}→ ฐานชม. = ราคารายวัน ÷ 14 · OT 1.5× = ฐานชม. × 1.5
                  {offshoreOtPreview ? (
                    <>
                      {' '}· ตอนนี้ ฿{offshoreOtPreview.daily.toLocaleString('th-TH')} → ปกติ ฿
                      {offshoreOtPreview.normalHourly.toLocaleString('th-TH')}/ชม. · OT ฿
                      {offshoreOtPreview.ot15Hourly.toLocaleString('th-TH')}/ชม.
                    </>
                  ) : (
                    <> (เช่น ฿1,400 → ปกติ ฿100/ชม. · OT ฿150/ชม.)</>
                  )}
                </p>
                <p>
                  ใช้คิดสลิปต่อวัน: ออนชอร์ {slipRateLabel('onshore')} · ออฟชอร์ {slipRateLabel('offshore')}
                </p>
                <p className="text-[11px]">
                  ถ้าเลือก «ตั้งค่าเอง» — ค่าแรงรวม OT (payroll + ตกเบิก) คำนวณจากฐานหน้าลูกจ้างตามสูตรด้านบน ไม่ใช้เรทในสัญญา
                </p>
              </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground border-t border-amber-200/70 pt-4">
                ไม่มีสิทธิ์ดูต้นทุนค่าแรง
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm bg-muted/20">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <History className="h-4 w-4" /> ข้อมูลระบบ (System Meta)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 text-xs">
              <div className="space-y-1">
                <span className="text-muted-foreground block">ลงทะเบียนเมื่อ</span>
                <span className="font-medium">{formatDateThaiBE(worker.createdAt)}</span>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground block">อัปเดตล่าสุด</span>
                <span className="font-medium">{formatDateTimeThaiBE(worker.updatedAt)}</span>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground block">สถานะงาน (Job Status)</span>
                <div className="flex flex-col items-start gap-0.5 min-w-0">
                  <Badge variant={jobBadge.variant} className={`text-[9px] uppercase font-bold ${jobBadge.className}`}>
                    {jobBadge.label}
                  </Badge>
                  {displayJobStatus === 'NOT_READY_TO_WORK' ? (
                    <span className="text-[10px] text-orange-800 font-medium">
                      {contractStatus.pastEndDate ? 'เลย/สิ้นสุดสัญญา' : 'ไม่พร้อมทำงาน'}
                    </span>
                  ) : displayJobStatus === 'NOT_READY_TO_ASSIGN' ? (
                    <span className="text-[10px] text-amber-800">เอกสาร/เซอร์ไม่ครบ</span>
                  ) : null}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
    </div>
  );
}
