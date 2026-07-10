'use client';

import { useState, use, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Trash2, 
  Save, 
  FileText, 
  ShoppingCart, 
  ArrowLeft,
  CircleDollarSign,
  Building2,
  Loader2,
  ShieldAlert,
  History,
  Pencil,
} from 'lucide-react';
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, query, where, addDoc, orderBy, getDocs, deleteField } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { MainContract, PositionRate, PurchaseOrder, Customer, Position, User, ContractMobDemobLocation, ContractBillingMode } from '@/lib/types';
import Link from 'next/link';
import { billingModeLabel } from '@/lib/commercial/resolve-billing-mode';
import { useToast } from '@/hooks/use-toast';
import { canView, canEdit } from '@/lib/permissions';
import { isSystemAdmin, isHrManager, isOperationManager, isSalesManager, canEditMasterContractCostBaseline } from '@/lib/permission-core';
import { userMatchesBusinessRoleKey } from '@/lib/role-key-normalizer';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { useAppUser } from '@/hooks/use-app-user';
import { sortPositionRatesByDisplayName } from '@/lib/position-display';

import { ContractPoTab } from './_components/contract-po-tab';
import { ContractLogsTab } from './_components/contract-logs-tab';
import { ContractAddRateDialog } from './_components/contract-add-rate-dialog';
import { ContractEditRateDialog } from './_components/contract-edit-rate-dialog';
import { RateConditionsEditor } from '@/components/commercial/rate-conditions-editor';
import {
  buildSpecialDaysStrings,
  OVERTIME_RULE_OPTIONS,
  resolveContractHolidaySchedule,
} from '@/lib/contract-position-rate-extras';
import type { CalendarHolidayEntry, OvertimeRuleKey, WeeklyRestPattern } from '@/lib/contract-position-rate-extras';
import { ContractHolidayScheduleSection } from './_components/contract-holiday-schedule-section';
import { resolveSafeInternalReturnPath } from '@/lib/navigation/safe-return-path';
import {
  effectiveNormalWorkHoursOffshore,
  effectiveNormalWorkHoursOnshore,
  effectiveSellOnshore,
  effectiveSellOffshore,
  legacySellRateMirror,
  normalizeNormalWorkHoursFields,
} from '@/lib/commercial/position-rate-sell';
import {
  createEmptyPositionRateMatrix,
  getEffectiveMobDemobLocations,
  patchRateSheetCell,
  preparePositionRateMatrixPayload,
  sanitizeMobDemobLocations,
  sanitizePositionRateMatrix,
} from '@/lib/commercial/position-rate-matrix';
import type { RateSheetColumnDef, RateSheetSide } from '@/lib/commercial/position-rate-matrix';
import { ContractMobDemobLocationsSection } from './_components/contract-mob-demob-locations-section';
import { ContractRateSheetSpreadsheet } from './_components/contract-rate-sheet-spreadsheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** ต้นทุนที่ใช้จริงต่อวัน */
function effectiveLaborOnshore(pos: Position, contract: MainContract, positionId: string): number {
  const raw = contract.laborCostBaselinesByPositionId?.[positionId]?.onshore;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return 0;
}

function effectiveLaborOffshore(pos: Position, contract: MainContract, positionId: string): number {
  const raw = contract.laborCostBaselinesByPositionId?.[positionId]?.offshore;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return 0;
}

const DEFAULT_OT_KEY: OvertimeRuleKey = 'MULT_1_5';
const DEFAULT_OT_LABEL = OVERTIME_RULE_OPTIONS.find((o) => o.key === DEFAULT_OT_KEY)!;

function createInitialNewRateForm(): Partial<PositionRate> {
  return {
    billingUnit: 'daily',
    active: true,
    sellRate: 0,
    overtimeRuleKey: DEFAULT_OT_KEY,
    overtimeRule: `${DEFAULT_OT_LABEL.label} — ${DEFAULT_OT_LABEL.description}`,
    normalWorkHoursOnshore: 8,
    normalWorkHoursOffshore: 12,
    normalWorkHours: 12,
    sellOtRules: { afterShift: 1.5, holiday: 1.0, publicHoliday: 1.0, sunday: 1.0, sundayOt: 1.5 },
    costOtRules: { afterShift: 1.5, holiday: 1.0, publicHoliday: 1.0, sunday: 1.0, sundayOt: 1.5 },
    sellSpecialDays: [],
    costSpecialDays: [],
    rateMatrix: createEmptyPositionRateMatrix(),
  };
}

type ContractChangeLog = {
  id: string;
  actionType: string;
  changedFields?: string[];
  beforeSummary?: string;
  afterSummary?: string;
  actorUserId?: string;
  actorName?: string;
  actorRoleKey?: string;
  rateId?: string;
  positionId?: string;
  eventAt: number;
};

type MainContractTab = 'info' | 'rates' | 'pos' | 'logs';
type RatesViewMode = 'summary' | 'sheet';

function parseMainContractTab(raw: string | null): MainContractTab | null {
  if (raw === 'info' || raw === 'rates' || raw === 'pos' || raw === 'logs') return raw;
  return null;
}

const DEFAULT_RATE_POLICY: NonNullable<MainContract['rateMultiplierPolicy']> = {
  sell: {
    otAfterShift: 1.5,
    holiday: 1,
    publicHoliday: 1,
    sunday: 1,
    sundayOt: 1.5,
    standby: 0.5,
    mobilization: 1,
    demobilization: 1,
    travel: 1,
  },
  cost: {
    otAfterShift: 1.5,
    holiday: 1,
    publicHoliday: 1,
    sunday: 1,
    sundayOt: 1.5,
    standby: 0.5,
    mobilization: 1,
    demobilization: 1,
    travel: 1,
  },
};

export default function MainContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const isAuthorized = useMemo(() => !!currentUser && canView(currentUser, 'main_contracts'), [currentUser]);
  const canModify = useMemo(() => !!currentUser && canEdit(currentUser, 'main_contracts'), [currentUser]);
  const isSalesRole = useMemo(() => {
    if (!currentUser) return false;
    return (
      currentUser.department === 'sales' ||
      userMatchesBusinessRoleKey(
        currentUser.assignedRoleKey,
        'sales_manager',
        'sales_officer'
      )
    );
  }, [currentUser]);
  const isHRRole = useMemo(() => {
    if (!currentUser) return false;
    return (
      currentUser.department === 'hr'
      || currentUser.assignedRoleKey === 'hr_manager'
      || currentUser.assignedRoleKey === 'hr_officer'
    );
  }, [currentUser]);
  const canEditSellSide = useMemo(() => canModify && !isHRRole, [canModify, isHRRole]);
  /** ต้นทุนในสัญญา: Admin / HR Manager / Operations Manager (+ manager ในกลุ่ม operations ตามเอกสาร; ไม่ให้ทีมขาย) */
  const canEditCostSide = useMemo(
    () => canModify && canEditMasterContractCostBaseline(currentUser),
    [canModify, currentUser],
  );
  const canViewCostFields = useMemo(() => !isSalesRole, [isSalesRole]);
  const canApproveContract = useMemo(() => {
    if (!currentUser) return false;
    const level = (currentUser.accessLevel || currentUser.level || '').toLowerCase();
    return isSystemAdmin(currentUser) || level === 'manager' || level === 'admin';
  }, [currentUser]);
  /** วันหยุดสัญญา: ผู้จัดการ (ทั้งสองฝั่ง) — ไม่ผูกแยกขาย/ต้นทุน */
  const canEditContractHolidaySchedule = useMemo(() => {
    if (!currentUser || !canModify) return false;
    if (canApproveContract || isHrManager(currentUser) || isOperationManager(currentUser)) return true;
    const rk = `${currentUser.assignedRoleKey || ''} ${currentUser.roleId || ''}`.toLowerCase();
    return rk.includes('manager');
  }, [currentUser, canModify, canApproveContract]);
  /** กฎตัวคูณหลัง Active: Admin / HR Manager / Operations Manager */
  const canEditActiveContractMultipliers = useMemo(
    () =>
      canModify &&
      (isSystemAdmin(currentUser) || isHrManager(currentUser) || isOperationManager(currentUser)),
    [canModify, currentUser],
  );

  const canEditActivePositionRates = useMemo(() => {
    if (!currentUser) return false;
    return (
      isSystemAdmin(currentUser) ||
      isSalesManager(currentUser) ||
      isOperationManager(currentUser)
    );
  }, [currentUser]);

  const mcRef = useMemoFirebase(() => (firestore && isAuthorized ? doc(firestore, 'main_contracts', id) : null), [firestore, id, isAuthorized]);
  const { data: contract, isLoading: isMCLoading } = useDoc<MainContract>(mcRef as any);

  const ratesQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'main_contracts', id, 'position_rates') : null), [firestore, id, isAuthorized]);
  const { data: rates } = useCollection<PositionRate>(ratesQuery as any);

  const [isEditing, setIsEditing] = useState(false);
  const [editedMC, setEditedMC] = useState<Partial<MainContract>>({});
  const [billingModeDraft, setBillingModeDraft] = useState<ContractBillingMode>('MONTHLY');
  const [tripBillMobDemobFeeDraft, setTripBillMobDemobFeeDraft] = useState(false);

  const [isAddRateOpen, setIsAddRateOpen] = useState(false);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [addRatePositionDuplicate, setAddRatePositionDuplicate] = useState<PositionRate | null>(null);
  const [newRate, setNewRate] = useState<Partial<PositionRate>>(() => createInitialNewRateForm());
  const [activeHolidayDraft, setActiveHolidayDraft] = useState<{
    sellWeekly: WeeklyRestPattern;
    sellCal: CalendarHolidayEntry[];
  } | null>(null);
  /** เฉพาะฝั่งขาย — ฝั่งค่าจ้างย้ายไป HR Settings */
  const [activeMultDraft, setActiveMultDraft] = useState<
    NonNullable<MainContract['rateMultiplierPolicy']>['sell'] | null
  >(null);
  const [activeMobDraft, setActiveMobDraft] = useState<ContractMobDemobLocation[] | null>(null);
  const [isCreatingRevision, setIsCreatingRevision] = useState(false);
  const [activeTab, setActiveTab] = useState<MainContractTab>('info');
  const [ratesViewMode, setRatesViewMode] = useState<RatesViewMode>('sheet');

  useEffect(() => {
    const tab = parseMainContractTab(new URLSearchParams(window.location.search).get('tab'));
    if (tab) setActiveTab(tab);
  }, []);

  const applyAddPositionId = useCallback((positionId: string) => {
    setNewRate((prev) => ({ ...prev, positionId }));
    const existing = rates?.find((r) => r.positionId === positionId);
    if (existing) setAddRatePositionDuplicate(existing);
    else setAddRatePositionDuplicate(null);
  }, [rates]);

  const logsQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'main_contracts', id, 'change_logs'), orderBy('eventAt', 'desc'));
  }, [firestore, id, isAuthorized]);
  const { data: changeLogs } = useCollection<ContractChangeLog>(logsQuery as any);

  const poQuery = useMemoFirebase(() => {
    if (!firestore || !isAuthorized) return null;
    return query(collection(firestore, 'purchase_orders'), where('contractId', '==', id));
  }, [firestore, id, isAuthorized]);
  const { data: customerPOs } = useCollection<PurchaseOrder>(poQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'customers') : null), [firestore, isAuthorized]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const positionsQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'positions') : null), [firestore, isAuthorized]);
  const { data: allPositions } = useCollection<Position>(positionsQuery as any);
  const inheritedPolicyContractRef = useMemoFirebase(() => {
    if (!firestore || !isAuthorized || !contract) return null;
    const inheritId = contract.inheritTermsFromContractId || contract.parentContractId;
    if ((contract.contractType || 'master') !== 'supplemental' || !inheritId) return null;
    return doc(firestore, 'main_contracts', inheritId);
  }, [firestore, isAuthorized, contract]);
  const { data: inheritedPolicyContract } = useDoc<MainContract>(inheritedPolicyContractRef as any);

  const ratesSortedByPosition = useMemo(() => {
    if (!rates) return rates;
    return sortPositionRatesByDisplayName(rates, allPositions ?? null);
  }, [rates, allPositions]);

  const duplicateAlertPositionLabel = useMemo(() => {
    if (!addRatePositionDuplicate) return '';
    const p = allPositions?.find((x) => x.id === addRatePositionDuplicate.positionId);
    return (p?.positionName || p?.positionNameTh) || addRatePositionDuplicate.positionId;
  }, [addRatePositionDuplicate, allPositions]);

  useEffect(() => {
    if (!isAddRateOpen) setAddRatePositionDuplicate(null);
  }, [isAddRateOpen]);

  useEffect(() => {
    // Sync form only when contract snapshot changes.
    // Edit mode now toggles explicit setEditedMC on edit/cancel actions.
    if (contract) {
      setEditedMC(contract);
      setBillingModeDraft(contract.billingMode ?? 'MONTHLY');
      setTripBillMobDemobFeeDraft(contract.tripBillMobDemobFee === true);
    }
  }, [contract]);

  useEffect(() => {
    if (!contract || !mcRef) return;
    const isExpiredByDate = Number(contract.endDate || 0) > 0 && Number(contract.endDate) < Date.now();
    if (isExpiredByDate && contract.status !== 'closed') {
      updateDocumentNonBlocking(mcRef, {
        status: 'closed',
        updatedAt: Date.now(),
      });
      addContractChangeLog({
        actionType: 'AUTO_CLOSE_EXPIRED_CONTRACT',
        changedFields: ['status'],
        beforeSummary: `status=${contract.status}`,
        afterSummary: 'status=closed',
      });
    }
  }, [contract, mcRef]);

  const addContractChangeLog = async (payload: Record<string, any>) => {
    if (!firestore || !currentUser) return;
    await addDoc(collection(firestore, 'main_contracts', id, 'change_logs'), {
      ...payload,
      actorUserId: currentUser.id,
      actorName: currentUser.displayName,
      actorRoleKey: currentUser.assignedRoleKey || currentUser.roleId || '',
      eventAt: Date.now(),
    });
  };

  const stripRevisionSuffix = (no: string) => no.replace(/R\d+$/i, '');
  const getRevisionBaseNo = (no: string) => stripRevisionSuffix(no);

  const resolveNextRevisionNo = async (baseNo: string) => {
    if (!firestore) return 1;
    const snapshot = await getDocs(collection(firestore, 'main_contracts'));
    let maxRev = 0;
    snapshot.forEach((d) => {
      const raw = String((d.data() as any).contractNumber || '');
      const m = raw.match(new RegExp(`^${baseNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}R(\\d+)$`, 'i'));
      if (m) maxRev = Math.max(maxRev, Number(m[1]) || 0);
    });
    return maxRev + 1;
  };

  const positionLabel = useCallback(
    (positionId: string) => {
      const pos = allPositions?.find((p) => p.id === positionId);
      return pos?.positionName || pos?.positionNameTh || positionId;
    },
    [allPositions],
  );

  const contractAllowsPositionRateMutation = useCallback(
    (c: MainContract) => {
      const historical =
        c.status === 'revised' || c.status === 'closed' || c.status === 'expired';
      if (!canModify || historical) return false;
      if (c.status === 'pending') return true;
      if (c.status === 'active') return canEditActivePositionRates;
      return false;
    },
    [canModify, canEditActivePositionRates],
  );

  const showActiveRatesLockedToast = () => {
    toast({
      variant: 'destructive',
      title: 'ไม่มีสิทธิ์แก้ไขอัตราราคา',
      description: 'สัญญา Active แก้ไขได้เฉพาะ Sales Manager / Operation Manager / Admin',
    });
  };

  useEffect(() => {
    if (!contract) {
      setActiveHolidayDraft(null);
      setActiveMultDraft(null);
      setActiveMobDraft(null);
      return;
    }
    const active = contract.status === 'active';
    const supp = (contract.contractType || 'master') === 'supplemental';
    if (!active || supp) {
      setActiveHolidayDraft(null);
      setActiveMultDraft(null);
      setActiveMobDraft(null);
      return;
    }
    const r = resolveContractHolidaySchedule(contract);
    setActiveHolidayDraft({
      sellWeekly: r.sellWeekly,
      sellCal: [...r.sellHolidays],
    });
    const pol = contract.rateMultiplierPolicy || DEFAULT_RATE_POLICY;
    setActiveMultDraft({ ...DEFAULT_RATE_POLICY.sell, ...pol.sell });
    setActiveMobDraft(getEffectiveMobDemobLocations(contract).map((loc) => ({ ...loc })));
  }, [contract]);

  const handleSaveMaster = async () => {
    if (!mcRef || !canModify || !contract) return;
    if (contract.status !== 'pending') {
      toast({
        variant: 'destructive',
        title: 'ไม่สามารถแก้ฉบับนี้ได้',
        description: 'กรุณาสร้างฉบับแก้ไข Pending ก่อน แล้วค่อยบันทึกข้อมูล',
      });
      return;
    }
    const changedFields: string[] = [];
    if ((editedMC.title ?? '') !== (contract.title ?? '')) changedFields.push('title');
    if ((editedMC.startDate ?? 0) !== (contract.startDate ?? 0)) changedFields.push('startDate');
    if ((editedMC.endDate ?? 0) !== (contract.endDate ?? 0)) changedFields.push('endDate');
    if ((editedMC.billingTerms ?? '') !== (contract.billingTerms ?? '')) changedFields.push('billingTerms');
    if ((editedMC.billingMode ?? 'MONTHLY') !== (contract.billingMode ?? 'MONTHLY')) changedFields.push('billingMode');
    if ((editedMC.tripBillMobDemobFee === true) !== (contract.tripBillMobDemobFee === true)) {
      changedFields.push('tripBillMobDemobFee');
    }
    if ((editedMC.paymentTerms ?? '') !== (contract.paymentTerms ?? '')) changedFields.push('paymentTerms');
    if ((editedMC.vatPercent ?? 7) !== (contract.vatPercent ?? 7)) changedFields.push('vatPercent');
    if ((editedMC.notes ?? '') !== (contract.notes ?? '')) changedFields.push('notes');
    if ((editedMC.serviceAgreementNo ?? '').trim() !== (contract.serviceAgreementNo ?? '').trim()) {
      changedFields.push('serviceAgreementNo');
    }
    const sellPolicyBefore = contract.rateMultiplierPolicy?.sell ?? DEFAULT_RATE_POLICY.sell;
    const sellPolicyAfter = editedMC.rateMultiplierPolicy?.sell ?? sellPolicyBefore;
    if (JSON.stringify(sellPolicyAfter) !== JSON.stringify(sellPolicyBefore)) {
      changedFields.push('rateMultiplierPolicySell');
    }
    const mergedH = { ...contract, ...editedMC } as MainContract;
    const hSched = resolveContractHolidaySchedule(mergedH);
    const sellW = mergedH.contractSellWeeklyRestPattern ?? hSched.sellWeekly;
    const sellCal = mergedH.contractSellCalendarHolidays ?? hSched.sellHolidays;
    const contractSellSpecialDays = buildSpecialDaysStrings(sellW, sellCal);
    if (
      JSON.stringify({
        w: sellW,
        sc: sellCal,
      }) !==
      JSON.stringify({
        w: contract.contractSellWeeklyRestPattern ?? resolveContractHolidaySchedule(contract).sellWeekly,
        sc: contract.contractSellCalendarHolidays ?? resolveContractHolidaySchedule(contract).sellHolidays,
      })
    ) {
      changedFields.push('contractHolidayScheduleSell');
    }

    const mobLocsBefore = sanitizeMobDemobLocations(contract.mobDemobLocations);
    const mobLocsAfter = sanitizeMobDemobLocations(editedMC.mobDemobLocations);
    if (JSON.stringify(mobLocsAfter) !== JSON.stringify(mobLocsBefore)) {
      changedFields.push('mobDemobLocations');
    }

    const nextStatus = 'pending';
    const mergedSellPolicy = {
      ...sellPolicyAfter,
    };
    updateDocumentNonBlocking(mcRef, {
      ...editedMC,
      contractSellWeeklyRestPattern: sellW,
      contractSellCalendarHolidays: sellCal,
      contractSellSpecialDays,
      contractCostWeeklyRestPattern: contract.contractCostWeeklyRestPattern,
      contractCostCalendarHolidays: contract.contractCostCalendarHolidays,
      contractCostSpecialDays: contract.contractCostSpecialDays,
      ...(mobLocsAfter ? { mobDemobLocations: mobLocsAfter } : { mobDemobLocations: deleteField() }),
      rateMultiplierPolicy: {
        sell: mergedSellPolicy,
        cost: contract.rateMultiplierPolicy?.cost ?? DEFAULT_RATE_POLICY.cost,
      },
      status: nextStatus,
      lastSubmittedAt: Date.now(),
      lastSubmittedBy: currentUser?.displayName || 'System',
      updatedAt: Date.now(),
    });
    if (changedFields.length > 0) {
      await addContractChangeLog({
        actionType: 'UPDATE_CONTRACT_HEADER',
        changedFields,
        beforeSummary: JSON.stringify({
          title: contract.title,
          startDate: contract.startDate,
          endDate: contract.endDate,
          billingTerms: contract.billingTerms,
          paymentTerms: contract.paymentTerms,
          vatPercent: contract.vatPercent ?? 7,
          notes: contract.notes || '',
          serviceAgreementNo: contract.serviceAgreementNo || '',
          rateMultiplierPolicy: contract.rateMultiplierPolicy || null,
        }),
        afterSummary: JSON.stringify({
          title: editedMC.title,
          startDate: editedMC.startDate,
          endDate: editedMC.endDate,
          billingTerms: editedMC.billingTerms,
          paymentTerms: editedMC.paymentTerms,
          vatPercent: editedMC.vatPercent ?? 7,
          notes: editedMC.notes || '',
          serviceAgreementNo: editedMC.serviceAgreementNo || '',
          rateMultiplierPolicy: {
            sell: mergedSellPolicy,
            cost: contract.rateMultiplierPolicy?.cost ?? DEFAULT_RATE_POLICY.cost,
          },
        }),
      });
    }
    setIsEditing(false);
    toast({
      title: "บันทึกสำเร็จ",
      description: nextStatus === 'pending'
        ? "บันทึกเป็นร่างแก้ไขแล้ว รออนุมัติอีกครั้ง"
        : "ข้อมูลสัญญาหลักถูกอัปเดตแล้ว",
    });
  };

  const handleSaveActiveContractHolidays = () => {
    if (!mcRef || !contract || !activeHolidayDraft || !canEditContractHolidaySchedule) return;
    if (contract.status !== 'active' || (contract.contractType || 'master') === 'supplemental') return;
    const contractSellSpecialDays = buildSpecialDaysStrings(activeHolidayDraft.sellWeekly, activeHolidayDraft.sellCal);
    updateDocumentNonBlocking(mcRef, {
      contractSellWeeklyRestPattern: activeHolidayDraft.sellWeekly,
      contractSellCalendarHolidays: activeHolidayDraft.sellCal,
      contractSellSpecialDays,
      updatedAt: Date.now(),
    });
    addContractChangeLog({
      actionType: 'UPDATE_CONTRACT_HOLIDAYS',
      changedFields: ['contractHolidaySchedule'],
      beforeSummary: 'active_contract',
      afterSummary: contractSellSpecialDays.join(';'),
    });
    toast({ title: 'บันทึกวันหยุดสัญญาแล้ว' });
  };

  const handleSaveActiveContractMultipliers = () => {
    if (!mcRef || !contract || !activeMultDraft || !canEditActiveContractMultipliers) return;
    if (contract.status !== 'active' || (contract.contractType || 'master') === 'supplemental') return;
    updateDocumentNonBlocking(mcRef, {
      rateMultiplierPolicy: {
        ...contract.rateMultiplierPolicy,
        sell: activeMultDraft,
      },
      updatedAt: Date.now(),
    });
    addContractChangeLog({
      actionType: 'UPDATE_CONTRACT_MULTIPLIERS',
      changedFields: ['rateMultiplierPolicy'],
      beforeSummary: 'active_contract',
      afterSummary: 'rateMultiplierPolicy',
    });
    toast({ title: 'บันทึกกฎตัวคูณสัญญาแล้ว' });
  };

  const handleSaveActiveMobDemobLocations = () => {
    if (!mcRef || !contract || !activeMobDraft || !canEditActiveContractMultipliers) return;
    if (contract.status !== 'active' || (contract.contractType || 'master') === 'supplemental') return;
    const sanitized = sanitizeMobDemobLocations(activeMobDraft);
    updateDocumentNonBlocking(mcRef, {
      ...(sanitized ? { mobDemobLocations: sanitized } : { mobDemobLocations: deleteField() }),
      updatedAt: Date.now(),
    });
    addContractChangeLog({
      actionType: 'UPDATE_MOB_DEMOB_LOCATIONS',
      changedFields: ['mobDemobLocations'],
      beforeSummary: JSON.stringify(getEffectiveMobDemobLocations(contract)),
      afterSummary: JSON.stringify(sanitized ?? []),
    });
    toast({ title: 'บันทึกจุด Mob/Demob แล้ว' });
  };

  const handleSaveBillingMode = () => {
    if (!mcRef || !contract || !canModify) return;
    if (contract.status !== 'active') return;
    updateDocumentNonBlocking(mcRef, {
      billingMode: billingModeDraft,
      tripBillMobDemobFee: tripBillMobDemobFeeDraft,
      updatedAt: Date.now(),
    });
    addContractChangeLog({
      actionType: 'UPDATE_CONTRACT_HEADER',
      changedFields: ['billingMode', 'tripBillMobDemobFee'],
      beforeSummary: `${contract.billingMode ?? 'MONTHLY'} · mobFee=${contract.tripBillMobDemobFee === true}`,
      afterSummary: `${billingModeDraft} · mobFee=${tripBillMobDemobFeeDraft}`,
    });
    toast({
      title: 'บันทึกโหมดวางบิลแล้ว',
      description:
        billingModeDraft === 'TRIP'
          ? 'ออก invoice จากเมนู «ทำใบแจ้งหนี้แบบ Trip»'
          : 'ออก invoice จากเมนู «ทำใบแจ้งหนี้แบบ Monthly» (ปิด PO+เดือน)',
    });
  };

  const handleApproveContract = async () => {
    if (!mcRef || !canApproveContract || !contract) return;
    updateDocumentNonBlocking(mcRef, {
      status: 'active',
      approvedAt: Date.now(),
      approvedBy: currentUser?.displayName || 'System',
      updatedAt: Date.now(),
    });
    await addContractChangeLog({
      actionType: 'APPROVE_CONTRACT',
      changedFields: ['status'],
      beforeSummary: `status=${contract.status}`,
      afterSummary: 'status=active',
    });
    if (contract.parentContractId) {
      const parentRef = doc(firestore!, 'main_contracts', contract.parentContractId);
      updateDocumentNonBlocking(parentRef, {
        status: 'revised',
        supersededByContractId: contract.id,
        updatedAt: Date.now(),
      });
      // Master revision approved: keep supplemental document numbers,
      // but align inherited term fields to latest approved master.
      if ((contract.contractType || 'master') === 'master') {
        const supplementsSnap = await getDocs(
          query(collection(firestore!, 'main_contracts'), where('parentContractId', '==', contract.parentContractId))
        );
        supplementsSnap.forEach((s) => {
          const d = s.data() as Partial<MainContract>;
          if ((d.contractType || 'master') === 'supplemental') {
            updateDocumentNonBlocking(doc(firestore!, 'main_contracts', s.id), {
              startDate: contract.startDate,
              endDate: contract.endDate,
              currency: contract.currency,
              billingTerms: contract.billingTerms,
              paymentTerms: contract.paymentTerms,
              rateMultiplierPolicy: contract.rateMultiplierPolicy || DEFAULT_RATE_POLICY,
              contractSellWeeklyRestPattern: contract.contractSellWeeklyRestPattern,
              contractCostWeeklyRestPattern: contract.contractCostWeeklyRestPattern,
              contractSellCalendarHolidays: contract.contractSellCalendarHolidays,
              contractCostCalendarHolidays: contract.contractCostCalendarHolidays,
              contractSellSpecialDays: contract.contractSellSpecialDays,
              contractCostSpecialDays: contract.contractCostSpecialDays,
              inheritTermsFromContractId: contract.id,
              updatedAt: Date.now(),
            });
          }
        });
      }
    }
    toast({ title: 'อนุมัติสัญญาแล้ว', description: 'สัญญาถูกเปิดใช้งานเป็น Active แล้ว' });
  };

  const createPendingRevisionFromActive = async (overrideHeader?: Partial<MainContract>, overrideRates?: Partial<PositionRate>[]) => {
    if (!firestore || !currentUser || !contract) return null;
    setIsCreatingRevision(true);
    try {
      const baseNo = getRevisionBaseNo(contract.contractNumber);
      const nextRev = await resolveNextRevisionNo(baseNo);
      const finalNo = `${baseNo}R${nextRev}`;
      const pendingPayload: Partial<MainContract> = {
        ...contract,
        ...overrideHeader,
        contractNumber: finalNo,
        status: 'pending',
        parentContractId: contract.id,
        lastSubmittedAt: Date.now(),
        lastSubmittedBy: currentUser.displayName,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const revisionRef = await addDoc(collection(firestore, 'main_contracts'), pendingPayload);
      const sourceRates = overrideRates || rates || [];
      for (const rate of sourceRates) {
        const { id: _drop, costBaseline: _cb, ...rateData } = rate as PositionRate;
        await addDoc(collection(firestore, 'main_contracts', revisionRef.id, 'position_rates'), {
          ...rateData,
          active: true,
        });
      }
      await addContractChangeLog({
        actionType: 'CREATE_PENDING_REVISION',
        changedFields: ['status', 'contract_revision'],
        beforeSummary: `source_contract=${contract.contractNumber}, status=active`,
        afterSummary: `new_contract=${finalNo}, status=pending`,
      });
      toast({
        title: 'สร้างฉบับแก้ไขสำเร็จ',
        description: `สร้างฉบับ Pending: ${finalNo} แล้ว`,
      });
      router.push(`/main-contracts/${revisionRef.id}`);
      return revisionRef.id;
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'สร้างฉบับแก้ไขไม่สำเร็จ',
        description: error?.message || 'กรุณาลองใหม่อีกครั้ง',
      });
      return null;
    } finally {
      setIsCreatingRevision(false);
    }
  };

  const handleAddRate = () => {
    if (!ratesQuery || !contract) return;
    if (!contractAllowsPositionRateMutation(contract)) {
      showActiveRatesLockedToast();
      return;
    }
    const dupForPosition = rates?.find((r) => r.positionId === newRate.positionId);
    if (dupForPosition) {
      setAddRatePositionDuplicate(dupForPosition);
      return;
    }
    const otKey = (newRate.overtimeRuleKey || DEFAULT_OT_KEY) as OvertimeRuleKey;

    const onSell =
      canEditSellSide && Number.isFinite(Number(newRate.sellRateOnshore)) && Number(newRate.sellRateOnshore) > 0
        ? Number(newRate.sellRateOnshore)
        : undefined;
    const offSell =
      canEditSellSide && Number.isFinite(Number(newRate.sellRateOffshore)) && Number(newRate.sellRateOffshore) > 0
        ? Number(newRate.sellRateOffshore)
        : undefined;
    const sanitizedMatrix = sanitizePositionRateMatrix(newRate.rateMatrix);
    const matrixSync = preparePositionRateMatrixPayload(
      { ...newRate, sellRateOnshore: onSell, sellRateOffshore: offSell, rateMatrix: sanitizedMatrix },
      { syncLegacySell: canEditSellSide },
    );
    const normalizedSellRate = canEditSellSide
      ? (matrixSync.sellRate ?? legacySellRateMirror({ ...newRate, sellRateOnshore: onSell, sellRateOffshore: offSell }))
      : 0;
    const finalOnSell = matrixSync.sellRateOnshore ?? onSell;
    const finalOffSell = matrixSync.sellRateOffshore ?? offSell;

    const onshoreCostStr = String(sanitizedMatrix?.cost?.onshore?.workingDay ?? '').trim();
    const offshoreCostStr = String(sanitizedMatrix?.cost?.offshore?.workingDay ?? '').trim();
    if (canEditCostSide && (onshoreCostStr || offshoreCostStr)) {
      commitLaborBaseline(newRate.positionId || '', 'onshore', onshoreCostStr, 0);
      commitLaborBaseline(newRate.positionId || '', 'offshore', offshoreCostStr, 0);
    }

    const { costBaseline: _dropCost, ...newRateFields } = newRate;
    const policySell = effectiveRatePolicy.sell || {};
    const policyCost = effectiveRatePolicy.cost || {};
    const otOpt = OVERTIME_RULE_OPTIONS.find((o) => o.key === otKey);

    addDocumentNonBlocking(ratesQuery, {
      ...newRateFields,
      positionId: newRate.positionId || '',
      sellRate: normalizedSellRate,
      ...(finalOnSell != null ? { sellRateOnshore: finalOnSell } : {}),
      ...(finalOffSell != null ? { sellRateOffshore: finalOffSell } : {}),
      ...(sanitizedMatrix ? { rateMatrix: sanitizedMatrix } : {}),
      billingUnit: newRate.billingUnit || 'daily',
      ...normalizeNormalWorkHoursFields(newRate),
      overtimeRuleKey: otKey,
      overtimeRule: newRate.overtimeRule?.trim() || (otOpt ? `${otOpt.label} — ${otOpt.description}` : otKey),
      sellOtRules: {
        afterShift: Number(policySell.otAfterShift ?? 1.5),
        holiday: Number(policySell.holiday ?? 1),
        publicHoliday: Number(policySell.publicHoliday ?? 1),
        sunday: Number(policySell.sunday ?? 1),
        sundayOt: Number(policySell.sundayOt ?? 1.5),
      },
      costOtRules: {
        afterShift: Number(policyCost.otAfterShift ?? 1.5),
        holiday: Number(policyCost.holiday ?? 1),
        publicHoliday: Number(policyCost.publicHoliday ?? 1),
        sunday: Number(policyCost.sunday ?? 1),
        sundayOt: Number(policyCost.sundayOt ?? 1.5),
      },
      active: true,
      notes: newRate.notes || ''
    });
    addContractChangeLog({
      actionType: 'ADD_POSITION_RATE',
      changedFields: ['position_rates'],
      beforeSummary: 'new_rate',
      afterSummary: JSON.stringify({
        positionId: newRate.positionId,
        sellRate: normalizedSellRate,
        ...normalizeNormalWorkHoursFields(newRate),
      }),
    });
    setIsAddRateOpen(false);
    setNewRate(createInitialNewRateForm());
    toast({ title: "เพิ่มอัตราราคาสำเร็จ" });
  };

  const handleUpdatePositionRate = (rateId: string, payload: Record<string, unknown>) => {
    if (!firestore || !contract) return;
    if (!contractAllowsPositionRateMutation(contract)) {
      showActiveRatesLockedToast();
      return;
    }
    const existing = rates?.find((r) => r.id === rateId);
    updateDocumentNonBlocking(doc(firestore, 'main_contracts', id, 'position_rates', rateId), payload);
    addContractChangeLog({
      actionType: 'UPDATE_POSITION_RATE',
      changedFields: Object.keys(payload).filter((k) => k !== 'updatedAt'),
      rateId,
      positionId: existing?.positionId,
      beforeSummary: existing
        ? JSON.stringify({
            position: positionLabel(existing.positionId),
            sellRate: existing.sellRate,
            sellRateOnshore: existing.sellRateOnshore,
            sellRateOffshore: existing.sellRateOffshore,
            billingUnit: existing.billingUnit,
            normalWorkHoursOnshore: effectiveNormalWorkHoursOnshore(existing),
            normalWorkHoursOffshore: effectiveNormalWorkHoursOffshore(existing),
            overtimeRuleKey: existing.overtimeRuleKey,
            notes: existing.notes || '',
          })
        : `rate_id=${rateId}`,
      afterSummary: JSON.stringify({
        position: existing ? positionLabel(existing.positionId) : rateId,
        ...payload,
      }),
    });
    toast({ title: 'บันทึกอัตราราคาแล้ว' });
  };

  const commitRateSheetCell = useCallback(
    (
      rate: PositionRate,
      side: RateSheetSide,
      col: RateSheetColumnDef,
      value: number | undefined,
    ) => {
      if (!firestore || !contract) return;
      if (!contractAllowsPositionRateMutation(contract)) {
        showActiveRatesLockedToast();
        return;
      }
      if (side === 'sell' && !canEditSellSide) return;
      if (side === 'cost' && !canEditCostSide) return;

      const matrix = patchRateSheetCell(rate.rateMatrix, side, col, value);
      const payload: Record<string, unknown> = { updatedAt: Date.now() };
      if (matrix) payload.rateMatrix = matrix;
      else payload.rateMatrix = deleteField();

      if (side === 'sell') {
        const sync = preparePositionRateMatrixPayload({ ...rate, rateMatrix: matrix }, { syncLegacySell: true });
        if (sync.sellRate != null) payload.sellRate = sync.sellRate;
        if (sync.sellRateOnshore != null) payload.sellRateOnshore = sync.sellRateOnshore;
        else if (col.category === 'onshore_working_day' && value == null) payload.sellRateOnshore = deleteField();
        if (sync.sellRateOffshore != null) payload.sellRateOffshore = sync.sellRateOffshore;
        else if (col.category === 'offshore_working_day' && value == null) payload.sellRateOffshore = deleteField();
      }

      updateDocumentNonBlocking(doc(firestore, 'main_contracts', id, 'position_rates', rate.id), payload);
      addContractChangeLog({
        actionType: 'UPDATE_RATE_SHEET_CELL',
        changedFields: ['rateMatrix', ...(side === 'sell' ? ['sellRate', 'sellRateOnshore', 'sellRateOffshore'] : [])],
        rateId: rate.id,
        positionId: rate.positionId,
        beforeSummary: JSON.stringify({ side, col: col.excelKey, matrix: rate.rateMatrix ?? null }),
        afterSummary: JSON.stringify({ side, col: col.excelKey, value: value ?? null, matrix: matrix ?? null }),
      });
    },
    [
      firestore,
      contract,
      contractAllowsPositionRateMutation,
      canEditSellSide,
      canEditCostSide,
      id,
      showActiveRatesLockedToast,
    ],
  );

  const handleRateSheetBulkImport = useCallback(
    async (updates: { rateId: string; payload: Record<string, unknown>; positionLabel: string }[]) => {
      if (!firestore || !contract) return { applied: 0, skipped: updates.length, warnings: ['ไม่มีสิทธิ์'] };
      if (!contractAllowsPositionRateMutation(contract)) {
        showActiveRatesLockedToast();
        return { applied: 0, skipped: updates.length, warnings: [] };
      }

      let applied = 0;
      for (const u of updates) {
        updateDocumentNonBlocking(
          doc(firestore, 'main_contracts', id, 'position_rates', u.rateId),
          u.payload,
        );
        addContractChangeLog({
          actionType: 'IMPORT_RATE_SHEET_ROW',
          changedFields: Object.keys(u.payload).filter((k) => k !== 'updatedAt'),
          rateId: u.rateId,
          beforeSummary: 'excel_import',
          afterSummary: JSON.stringify({ position: u.positionLabel, ...u.payload }),
        });
        applied++;
      }
      return { applied, skipped: 0, warnings: [] };
    },
    [firestore, contract, contractAllowsPositionRateMutation, id, showActiveRatesLockedToast],
  );

  const deleteRate = (rateId: string) => {
    if (!firestore || !contract) return;
    if (!contractAllowsPositionRateMutation(contract)) {
      showActiveRatesLockedToast();
      return;
    }
    if (confirm('ยืนยันการลบอัตราราคานี้?')) {
      const existing = rates?.find(r => r.id === rateId);
      deleteDocumentNonBlocking(doc(firestore, 'main_contracts', id, 'position_rates', rateId));
      addContractChangeLog({
        actionType: 'DELETE_POSITION_RATE',
        changedFields: ['position_rates'],
        positionId: existing?.positionId,
        rateId,
        beforeSummary: existing
          ? JSON.stringify({
              positionId: existing.positionId,
              sellRate: existing.sellRate,
            })
          : 'unknown_rate',
        afterSummary: 'deleted',
      });
      toast({ title: "ลบข้อมูลสำเร็จ" });
    }
  };

  const handleLaborBaselineBlur = (positionId: string, field: 'onshore' | 'offshore', raw: string) => {
    if (!firestore || !canEditCostSide || !contract) return;
    if (contract.status === 'active' && !canEditActivePositionRates) return;
    const n = parseFloat(raw.trim());
    const prev = contract.laborCostBaselinesByPositionId || {};
    const prevRow = prev[positionId] || {};
    const row = { ...prevRow };
    if (Number.isFinite(n) && n > 0) {
      row[field] = n;
    } else {
      delete row[field];
    }
    const next: Record<string, { onshore?: number; offshore?: number }> = { ...prev };
    if (Object.keys(row).length === 0) {
      delete next[positionId];
    } else {
      next[positionId] = row;
    }
    updateDocumentNonBlocking(doc(firestore, 'main_contracts', id), {
      laborCostBaselinesByPositionId: next,
      updatedAt: Date.now(),
    });
    addContractChangeLog({
      actionType: 'UPDATE_LABOR_BASELINE',
      changedFields: [`laborCostBaselinesByPositionId.${positionId}.${field}`],
      positionId,
      beforeSummary: JSON.stringify({
        position: positionLabel(positionId),
        onshore: prevRow.onshore,
        offshore: prevRow.offshore,
      }),
      afterSummary: JSON.stringify({
        position: positionLabel(positionId),
        onshore: row.onshore,
        offshore: row.offshore,
      }),
    });
  };

  /** บันทึกต้นทุนสัญญา — ว่างหรือเท่าฐานตำแหน่ง = ล้างทับ (ใช้ค่า Position) */
  const commitLaborBaseline = (
    positionId: string,
    field: 'onshore' | 'offshore',
    raw: string,
    positionDefault: number,
  ) => {
    const v = parseFloat(raw.trim());
    if (!Number.isFinite(v) || v <= 0) {
      handleLaborBaselineBlur(positionId, field, '');
      return;
    }
    if (positionDefault > 0 && Math.abs(v - positionDefault) < 1e-9) {
      handleLaborBaselineBlur(positionId, field, '');
      return;
    }
    handleLaborBaselineBlur(positionId, field, String(v));
  };

  const handleDeleteDraftContract = async () => {
    if (!firestore || !currentUser || !contract) return;
    if (!isSystemAdmin(currentUser) || contract.status !== 'pending') return;
    if (!confirm('ยืนยันการลบสัญญาฉบับร่างนี้?')) return;

    try {
      (rates || []).forEach((rate) => {
        deleteDocumentNonBlocking(doc(firestore, 'main_contracts', id, 'position_rates', rate.id));
      });
      deleteDocumentNonBlocking(doc(firestore, 'main_contracts', id));
      toast({ title: 'ลบเอกสารฉบับร่างแล้ว' });
      router.push('/main-contracts');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'ลบเอกสารไม่สำเร็จ',
        description: error?.message || 'กรุณาลองใหม่',
      });
    }
  };

  if (isUserLoading || userLoading || !currentUser) return null;

  if (!isAuthorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Denied (จำกัดสิทธิ์เฉพาะผู้จัดการ)</h2>
          <p className="text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงรายละเอียดสัญญาหลัก กรุณาติดต่อหัวหน้าแผนก</p>
        </div>
      </AppShell>
    );
  }

  if (isMCLoading || !contract) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  const customer = customers?.find(c => c.id === contract.customerId);
  const isPendingContract = contract.status === 'pending';
  const isActiveContract = contract.status === 'active';
  const isHistoricalLockedContract = contract.status === 'revised' || contract.status === 'closed' || contract.status === 'expired';
  const isSupplementalContract = (contract.contractType || 'master') === 'supplemental';
  const effectiveRatePolicy: NonNullable<MainContract['rateMultiplierPolicy']> = (() => {
    const source = isSupplementalContract
      ? inheritedPolicyContract?.rateMultiplierPolicy || contract.rateMultiplierPolicy
      : (isEditing ? editedMC.rateMultiplierPolicy : contract.rateMultiplierPolicy);
    return {
      sell: { ...DEFAULT_RATE_POLICY.sell, ...(source?.sell || {}) },
      cost: { ...DEFAULT_RATE_POLICY.cost, ...(source?.cost || {}) },
    };
  })();

  const editingRateRow =
    editingRateId && rates ? (rates.find((r) => r.id === editingRateId) ?? null) : null;

  const multSellDisabled =
    isSupplementalContract ||
    (isActiveContract ? !canEditActiveContractMultipliers : !isEditing || !isPendingContract);
  const policySellLive = isActiveContract && activeMultDraft ? activeMultDraft : effectiveRatePolicy.sell;

  const mobLocationsLive: ContractMobDemobLocation[] = (() => {
    if (isSupplementalContract) return getEffectiveMobDemobLocations(inheritedPolicyContract || contract);
    if (isActiveContract && activeMobDraft) return activeMobDraft;
    if (isPendingContract && isEditing) {
      return getEffectiveMobDemobLocations({ mobDemobLocations: editedMC.mobDemobLocations });
    }
    return getEffectiveMobDemobLocations(contract);
  })();
  const mobLocationsDisabled =
    isSupplementalContract ||
    (isActiveContract ? !canEditActiveContractMultipliers : !isEditing || !isPendingContract);

  const canMutatePositionRates =
    contractAllowsPositionRateMutation(contract);

  const holidayScheduleSource = ((): MainContract => {
    if (isSupplementalContract) return (inheritedPolicyContract || contract) as MainContract;
    if (isPendingContract && isEditing) return { ...contract, ...editedMC } as MainContract;
    return contract;
  })();
  const holidayResolved = resolveContractHolidaySchedule(holidayScheduleSource);

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/main-contracts"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{contract.title}</h1>
              <Badge variant="outline" className="font-mono text-primary border-primary/20">{contract.contractNumber}</Badge>
              <Badge variant={contract.status === 'active' ? 'default' : 'secondary'}>{contract.status.toUpperCase()}</Badge>
            </div>
            <p className="text-muted-foreground flex items-center gap-2 mt-1">
              <Building2 className="h-4 w-4" /> {customer?.name || 'Loading customer...'}
            </p>
            {contract.serviceAgreementNo?.trim() ? (
              <p className="text-sm text-muted-foreground mt-1">
                เลขที่สัญญาลูกค้า (Service Agreement No.):{' '}
                <span className="font-mono font-medium text-foreground">{contract.serviceAgreementNo}</span>
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            {isActiveContract ? (
              <Button
                variant="outline"
                disabled={!canModify || isCreatingRevision}
                onClick={() => createPendingRevisionFromActive()}
              >
                {isCreatingRevision ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                สร้างฉบับแก้ไข (Pending)
              </Button>
            ) : isPendingContract ? (
              <>
                <Button
                  variant="outline"
                  disabled={!canModify}
                  onClick={() => {
                    if (isEditing) {
                      setEditedMC(contract);
                      setIsEditing(false);
                    } else {
                      const r = resolveContractHolidaySchedule(contract);
                      setEditedMC({
                        ...contract,
                        contractSellWeeklyRestPattern: contract.contractSellWeeklyRestPattern ?? r.sellWeekly,
                        contractCostWeeklyRestPattern: contract.contractCostWeeklyRestPattern ?? r.costWeekly,
                        contractSellCalendarHolidays:
                          contract.contractSellCalendarHolidays?.length ? contract.contractSellCalendarHolidays : [...r.sellHolidays],
                        contractCostCalendarHolidays:
                          contract.contractCostCalendarHolidays?.length ? contract.contractCostCalendarHolidays : [...r.costHolidays],
                      });
                      setIsEditing(true);
                    }
                  }}
                >
                  {isEditing ? 'ยกเลิก' : 'แก้ไขข้อมูล'}
                </Button>
                {isSystemAdmin(currentUser) && (
                  <Button variant="destructive" onClick={handleDeleteDraftContract}>
                    ลบฉบับร่าง
                  </Button>
                )}
              </>
            ) : (
              <Button variant="outline" disabled={isHistoricalLockedContract}>
                เอกสารประวัติ (ล็อก)
              </Button>
            )}
            {isPendingContract && canApproveContract && (
              <Button className="gap-2 bg-green-600 hover:bg-green-700" onClick={handleApproveContract}>
                อนุมัติสัญญา (Approve)
              </Button>
            )}
            {isEditing && isPendingContract && (
              <Button className="gap-2" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึก
              </Button>
            )}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as MainContractTab)} className="w-full">
          <TabsList className="grid grid-cols-4 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="info" className="gap-2 py-2 px-6"><FileText className="h-4 w-4" /> ข้อมูลสัญญาหลัก</TabsTrigger>
            <TabsTrigger value="rates" className="gap-2 py-2 px-6"><CircleDollarSign className="h-4 w-4" /> อัตราราคาตามตำแหน่ง</TabsTrigger>
            <TabsTrigger value="pos" className="gap-2 py-2 px-6"><ShoppingCart className="h-4 w-4" /> Customer PO</TabsTrigger>
            <TabsTrigger value="logs" className="gap-2 py-2 px-6"><History className="h-4 w-4" /> ประวัติแก้ไข</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6">
            <Card>
              <CardHeader><CardTitle>รายละเอียดสัญญาหลัก (Master Agreement Header)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>ชื่อสัญญา (Contract Title)</Label>
                    <Input disabled={!isEditing || !isPendingContract} value={isEditing ? editedMC.title : contract.title} onChange={e => setEditedMC({...editedMC, title: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>รหัสสัญญา (Contract Code)</Label>
                    <Input disabled value={contract.contractNumber} />
                  </div>
                  <div className="space-y-2">
                    <Label>เลขที่สัญญาของลูกค้า (Service Agreement No.)</Label>
                    <Input
                      disabled={!isEditing || !isPendingContract}
                      value={
                        isEditing && isPendingContract
                          ? (editedMC.serviceAgreementNo ?? '')
                          : (contract.serviceAgreementNo ?? '')
                      }
                      onChange={(e) => setEditedMC({ ...editedMC, serviceAgreementNo: e.target.value })}
                      placeholder="เลขที่เอกสารอ้างอิงฝั่งลูกค้า"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>ลูกค้า (Customer)</Label>
                    <Select disabled={!isEditing || !isPendingContract} onValueChange={v => setEditedMC({...editedMC, customerId: v})} value={isEditing ? editedMC.customerId : contract.customerId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {customers?.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>รหัสโครงการ (Project ID - ถ้ามี)</Label>
                    <Input disabled={!isEditing || !isPendingContract} value={isEditing ? editedMC.projectId : contract.projectId} onChange={e => setEditedMC({...editedMC, projectId: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>วันที่เริ่มสัญญา</Label>
                      <DatePickerThaiBE
                        disabled={!isEditing || !isPendingContract || isSupplementalContract}
                        value={isEditing ? editedMC.startDate ?? contract.startDate : contract.startDate}
                        onChange={(ts) => setEditedMC({ ...editedMC, startDate: ts })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>วันที่สิ้นสุดสัญญา</Label>
                      <DatePickerThaiBE
                        disabled={!isEditing || !isPendingContract || isSupplementalContract}
                        value={isEditing ? editedMC.endDate ?? contract.endDate : contract.endDate}
                        onChange={(ts) => setEditedMC({ ...editedMC, endDate: ts })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>สกุลเงิน (Currency)</Label>
                      <Select disabled={!isEditing || !isPendingContract || isSupplementalContract} onValueChange={v => setEditedMC({...editedMC, currency: v})} value={isEditing ? editedMC.currency : contract.currency}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="THB">THB</SelectItem>
                          <SelectItem value="USD">USD</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>สถานะสัญญา</Label>
                    <Input disabled value={`${contract.status.toUpperCase()} (ระบบกำหนดอัตโนมัติ)`} />
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>เงื่อนไขการวางบิล (Billing Terms)</Label>
                    <Input disabled={!isEditing || !isPendingContract || isSupplementalContract} value={isEditing ? editedMC.billingTerms : contract.billingTerms} onChange={e => setEditedMC({...editedMC, billingTerms: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เงื่อนไขการชำระเงิน (Payment Terms)</Label>
                    <Input disabled={!isEditing || !isPendingContract || isSupplementalContract} value={isEditing ? editedMC.paymentTerms : contract.paymentTerms} onChange={e => setEditedMC({...editedMC, paymentTerms: e.target.value})} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                  <div className="space-y-2">
                    <Label>โหมดวางบิล (Billing Mode)</Label>
                    <Select
                      disabled={
                        !canModify ||
                        isSupplementalContract ||
                        (isPendingContract ? !isEditing : !isActiveContract)
                      }
                      value={
                        isPendingContract && isEditing
                          ? (editedMC.billingMode ?? contract.billingMode ?? 'MONTHLY')
                          : isActiveContract
                            ? billingModeDraft
                            : (contract.billingMode ?? 'MONTHLY')
                      }
                      onValueChange={(v) => {
                        const mode = v as ContractBillingMode;
                        if (isPendingContract && isEditing) {
                          setEditedMC({ ...editedMC, billingMode: mode });
                        } else if (isActiveContract) {
                          setBillingModeDraft(mode);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MONTHLY">MONTHLY — ปิด PO+เดือน แล้วออก invoice รวม</SelectItem>
                        <SelectItem value="TRIP">TRIP — วางบิลตามรอบ M1→D1 (หลายคนต่อ invoice ได้)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      ปัจจุบัน: {billingModeLabel(
                        isPendingContract && isEditing
                          ? (editedMC.billingMode ?? contract.billingMode)
                          : isActiveContract
                            ? billingModeDraft
                            : contract.billingMode,
                      )}
                      {' · '}
                      Payroll ปิดรายเดือนเหมือนเดิมทั้งสองโหมด
                    </p>
                    {isActiveContract && canModify && !isSupplementalContract && (
                      <Button type="button" variant="secondary" size="sm" onClick={handleSaveBillingMode}>
                        บันทึกการตั้งค่าวางบิล Trip
                      </Button>
                    )}
                  </div>
                  {(contract.billingMode === 'TRIP' ||
                    billingModeDraft === 'TRIP' ||
                    editedMC.billingMode === 'TRIP') && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/30 space-y-3">
                      <p className="font-medium text-amber-900 dark:text-amber-100">ทำใบแจ้งหนี้แบบ Trip</p>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        หลังปิด Payroll รายเดือน → ไปที่{' '}
                        <Link href="/accounting/trip-billing" className="font-medium text-primary underline">
                          ทำใบแจ้งหนี้แบบ Trip
                        </Link>
                        {' '}→ เลือก PO → ซิงก์ → อนุมัติชุด → สร้าง Invoice
                      </p>
                      <div className="space-y-2 max-w-md pt-1 border-t border-amber-200/80 dark:border-amber-800">
                        <Label>คิดค่า Mob/Demob ไป-กลับ (MOB fee) ใน invoice Trip</Label>
                        <Select
                          disabled={
                            !canModify ||
                            isSupplementalContract ||
                            (isPendingContract ? !isEditing : !isActiveContract)
                          }
                          value={
                            isPendingContract && isEditing
                              ? editedMC.tripBillMobDemobFee === true
                                ? 'yes'
                                : 'no'
                              : isActiveContract
                                ? tripBillMobDemobFeeDraft
                                  ? 'yes'
                                  : 'no'
                                : contract.tripBillMobDemobFee === true
                                  ? 'yes'
                                  : 'no'
                          }
                          onValueChange={(v) => {
                            const enabled = v === 'yes';
                            if (isPendingContract && isEditing) {
                              setEditedMC({ ...editedMC, tripBillMobDemobFee: enabled });
                            } else if (isActiveContract) {
                              setTripBillMobDemobFeeDraft(enabled);
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="no">ไม่มี — ไม่เพิ่มบรรทัดค่า MOB</SelectItem>
                            <SelectItem value="yes">มี — 1 คน / 1 trip = 1 ค่า MOB (จากตารางราคา)</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          อัตราดึงจากคอลัมน์ Mob/Demob ในตารางราคา offshore — ถ้ามีหลายจุด (เช่น Songkhla / Sattahip)
                          ระบบจะถามตอนสร้าง invoice
                        </p>
                      </div>
                    </div>
                  )}
                  {(contract.billingMode === 'MONTHLY' ||
                    billingModeDraft === 'MONTHLY' ||
                    editedMC.billingMode === 'MONTHLY' ||
                    (!contract.billingMode && billingModeDraft !== 'TRIP' && editedMC.billingMode !== 'TRIP')) && (
                    <div className="rounded-lg border border-slate-200 bg-muted/40 p-4 text-sm">
                      <p className="font-medium">ใบแจ้งหนี้แบบ Monthly</p>
                      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                        หลังปิด PO+เดือน →{' '}
                        <Link href="/draft-invoices" className="font-medium text-primary underline">
                          ทำใบแจ้งหนี้แบบ Monthly
                        </Link>
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-2 max-w-xs">
                  <Label>อัตรา VAT (%) — ใช้คำนวณใบแจ้งหนี้เรียกเก็บ (อ้างอิงสัญญานี้)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    disabled={!isEditing || !isPendingContract || isSupplementalContract}
                    value={isEditing ? (editedMC.vatPercent ?? contract.vatPercent ?? 7) : (contract.vatPercent ?? 7)}
                    onChange={(e) => setEditedMC({ ...editedMC, vatPercent: Number(e.target.value) })}
                  />
                </div>

                <div className="space-y-3 rounded-lg border p-4">
                  <div>
                    <Label className="text-base font-semibold">กฎตัวคูณประจำสัญญา — ฝั่งลูกค้า (Billing)</Label>
                    {isSupplementalContract && (
                      <p className="text-xs text-muted-foreground mt-1">
                        สัญญาเพิ่มเติมจะ inherit กฎตัวคูณจากสัญญาหลักอัตโนมัติ
                      </p>
                    )}
                    {isActiveContract && !isSupplementalContract && (
                      <p className="text-xs text-amber-800 mt-1">
                        สัญญา Active: แก้ได้เฉพาะ Admin / HR Manager / Operations Manager แล้วกด &quot;บันทึกกฎตัวคูณ&quot; ด้านล่าง
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      ตัวคูณค่าจ้าง (Payroll) และปฏิทินวันหยุดฝั่งลูกจ้างถูกย้ายไปที่{' '}
                      <Link href="/hr/settings" className="font-medium text-primary underline">
                        HR → ตั้งค่า
                      </Link>{' '}
                      — ใช้ร่วมทุกสัญญา
                    </p>
                  </div>
                  <div className="space-y-2 max-w-3xl">
                    <Label>OT / Holiday / Public Holiday / Sunday / Sunday OT</Label>
                    <div className="grid grid-cols-5 gap-2">
                      <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.otAfterShift} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, otAfterShift: v }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, otAfterShift: v } } }); }} />
                      <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.holiday} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, holiday: v }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, holiday: v } } }); }} />
                      <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.publicHoliday} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, publicHoliday: v }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, publicHoliday: v } } }); }} />
                      <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.sunday} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, sunday: v }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, sunday: v } } }); }} />
                      <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.sundayOt} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, sundayOt: v }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, sundayOt: v } } }); }} />
                    </div>
                  </div>
                  <div className="space-y-2 max-w-3xl">
                    <Label>Standby / Mob / Demob / Travel</Label>
                    <div className="grid grid-cols-4 gap-2">
                      <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.standby} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, standby: v }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, standby: v } } }); }} />
                      <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.mobilization} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, mobilization: v }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, mobilization: v } } }); }} />
                      <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.demobilization} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, demobilization: v }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, demobilization: v } } }); }} />
                      <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.travel} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, travel: v }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, travel: v } } }); }} />
                    </div>
                  </div>
                  {isActiveContract && !isSupplementalContract && canEditActiveContractMultipliers && (
                    <Button type="button" variant="secondary" size="sm" onClick={handleSaveActiveContractMultipliers}>
                      บันทึกกฎตัวคูณ (Active)
                    </Button>
                  )}
                </div>

                {isSupplementalContract ? (
                  <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                    <Label className="text-base font-semibold">วันหยุด / วันพิเศษ (จากสัญญาหลัก)</Label>
                    <p className="text-xs text-muted-foreground">
                      สัญญาเพิ่มเติมใช้ชุดวันหยุดเดียวกับสัญญาที่ inherit — แก้ไขที่สัญญาหลักที่ Active / ฉบับแก้ไข Pending
                    </p>
                    <ContractHolidayScheduleSection
                      disabled
                      canViewCostFields={canViewCostFields}
                      showPayrollSide={false}
                      sellWeeklyPattern={holidayResolved.sellWeekly}
                      setSellWeeklyPattern={() => {}}
                      costWeeklyPattern={holidayResolved.costWeekly}
                      setCostWeeklyPattern={() => {}}
                      sellCalendarHolidays={holidayResolved.sellHolidays}
                      setSellCalendarHolidays={(_fn) => {}}
                      costCalendarHolidays={holidayResolved.costHolidays}
                      setCostCalendarHolidays={(_fn) => {}}
                    />
                  </div>
                ) : isActiveContract && activeHolidayDraft ? (
                  <div className="space-y-3">
                    <ContractHolidayScheduleSection
                      disabled={!canEditContractHolidaySchedule}
                      canViewCostFields={canViewCostFields}
                      showPayrollSide={false}
                      sellWeeklyPattern={activeHolidayDraft.sellWeekly}
                      setSellWeeklyPattern={(v) => setActiveHolidayDraft((d) => (d ? { ...d, sellWeekly: v } : d))}
                      costWeeklyPattern="none"
                      setCostWeeklyPattern={() => {}}
                      sellCalendarHolidays={activeHolidayDraft.sellCal}
                      setSellCalendarHolidays={(fn) =>
                        setActiveHolidayDraft((d) => {
                          if (!d) return d;
                          const next = typeof fn === 'function' ? fn(d.sellCal) : d.sellCal;
                          return { ...d, sellCal: next };
                        })
                      }
                      costCalendarHolidays={[]}
                      setCostCalendarHolidays={() => {}}
                    />
                    {canEditContractHolidaySchedule && (
                      <Button type="button" variant="secondary" size="sm" onClick={handleSaveActiveContractHolidays}>
                        บันทึกวันหยุดสัญญา (Active)
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <ContractHolidayScheduleSection
                      disabled={!isPendingContract || !isEditing || !canEditContractHolidaySchedule}
                      canViewCostFields={canViewCostFields}
                      showPayrollSide={false}
                      sellWeeklyPattern={holidayResolved.sellWeekly}
                      setSellWeeklyPattern={(v) => setEditedMC({ ...editedMC, contractSellWeeklyRestPattern: v })}
                      costWeeklyPattern={holidayResolved.costWeekly}
                      setCostWeeklyPattern={() => {}}
                      sellCalendarHolidays={holidayResolved.sellHolidays}
                      setSellCalendarHolidays={(fn) => {
                        const base = holidayResolved.sellHolidays;
                        const next = typeof fn === 'function' ? fn(base) : base;
                        setEditedMC({ ...editedMC, contractSellCalendarHolidays: next });
                      }}
                      costCalendarHolidays={holidayResolved.costHolidays}
                      setCostCalendarHolidays={() => {}}
                    />
                    {isPendingContract && !isEditing && (
                      <p className="text-xs text-muted-foreground">กด &quot;แก้ไขข้อมูล&quot; เพื่อแก้วันหยุด (บันทึกรวมกับปุ่มบันทึกสัญญา)</p>
                    )}
                  </div>
                )}

                {currentUser && (
                  <ContractMobDemobLocationsSection
                    locations={mobLocationsLive}
                    disabled={mobLocationsDisabled}
                    showSaveButton={isActiveContract && !isSupplementalContract && canEditActiveContractMultipliers}
                    onSave={handleSaveActiveMobDemobLocations}
                    onChange={(next) => {
                      if (isActiveContract && activeMobDraft) {
                        setActiveMobDraft(next);
                        return;
                      }
                      setEditedMC({ ...editedMC, mobDemobLocations: next });
                    }}
                  />
                )}

                {currentUser && (
                  <div className="space-y-3 rounded-lg border bg-muted/10 p-4">
                    <div>
                      <Label className="text-base font-semibold">เงื่อนไขอัตราขายราย Event (ฝั่งลูกค้า)</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        ผูกกับสัญญานี้โดยตรง (parent = สัญญาหลัก) — ใช้คู่กับราคา/ตัวคูณด้านบนและ PO; ไม่ต้องสร้าง Sales Terms แยก
                      </p>
                    </div>
                    <RateConditionsEditor
                      parentType="SALES_CONTRACT"
                      parentId={contract.id}
                      appliesTo="SALES"
                      user={currentUser as User}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>หมายเหตุสัญญา</Label>
                  <Textarea disabled={!isEditing || !isPendingContract} value={isEditing ? editedMC.notes : contract.notes} onChange={e => setEditedMC({...editedMC, notes: e.target.value})} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rates" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>อัตราราคาตามตำแหน่ง (Position Rates Management)</CardTitle>
                  <CardDescription>
                    ราคา<strong>ขาย</strong>ต่อตำแหน่งเป็นของสัญญา — <strong>ต้นทุนค่าแรง</strong> แสดงเป็นตัวเลข Onshore / Offshore ต่อวัน (ทับในสัญญาได้;
                    ถ้าไม่ทับใช้ฐานจาก{' '}
                    <Link href="/positions" className="font-medium text-primary underline">
                      ตำแหน่งงาน
                    </Link>
                    ) — Operations / HR / Admin แก้ต้นทุนตามสิทธิ์
                    {isActiveContract && !canMutatePositionRates && canModify && (
                      <span className="block mt-1 text-amber-800 font-medium">
                        สัญญา Active: แก้ไขอัตราราคาได้เฉพาะ Sales Manager / Operation Manager / Admin
                      </span>
                    )}
                    {isActiveContract && canMutatePositionRates && (
                      <span className="block mt-1 text-emerald-800 font-medium">
                        สัญญา Active: แก้ไขอัตราได้ผ่านปุ่มแก้ไข (ดินสอ) — ระบบบันทึก log ว่าใครแก้ไขเมื่อไหร่ (แท็บประวัติแก้ไข)
                      </span>
                    )}
                    {contract.commercialTermsOwner === 'sales' && (
                      <span className="block mt-1 text-amber-700 font-medium">
                        สัญญานี้เริ่มจากฝ่ายขาย: ลงราคาขายต่อตำแหน่งได้ที่นี่ — ต้นทุนค่าแรงฝั่ง Operations/HR แก้ในคอลัมน์ต้นทุน (หรือฐานที่ตำแหน่ง)
                      </span>
                    )}
                  </CardDescription>
                  {(contract.contractType || 'master') === 'supplemental' && (
                    <div className="mt-2">
                      <Badge variant="outline">
                        สัญญาเพิ่มเติม (inherit วันหยุด/OT จากสัญญาแม่: {contract.inheritTermsFromContractId || contract.parentContractId})
                      </Badge>
                    </div>
                  )}
                </div>
                {canModify && (
                  <div className="flex flex-wrap items-center gap-2">
                    {canMutatePositionRates && (
                      <>
                        <ContractAddRateDialog
                          open={isAddRateOpen}
                          onOpenChange={setIsAddRateOpen}
                          newRate={newRate}
                          setNewRate={setNewRate}
                          onAddPositionIdChange={applyAddPositionId}
                          allPositions={allPositions ?? null}
                          mobDemobLocations={mobLocationsLive}
                          canEditSellSide={canEditSellSide}
                          canEditCostSide={canEditCostSide}
                          canViewCostFields={canViewCostFields}
                          isSupplementalContract={isSupplementalContract}
                          canAddRates={canMutatePositionRates}
                          onAddRate={handleAddRate}
                        />
                        <ContractEditRateDialog
                          open={editingRateId !== null}
                          onOpenChange={(open) => {
                            if (!open) setEditingRateId(null);
                          }}
                          rate={editingRateRow}
                          allPositions={allPositions ?? null}
                          mobDemobLocations={mobLocationsLive}
                          effectiveRatePolicy={effectiveRatePolicy}
                          canEditSellSide={canEditSellSide}
                          canEditCostSide={canEditCostSide}
                          canViewCostFields={canViewCostFields}
                          isSupplementalContract={isSupplementalContract}
                          laborCostOnshore={
                            editingRateRow && allPositions?.find((p) => p.id === editingRateRow.positionId)
                              ? effectiveLaborOnshore(
                                  allPositions.find((p) => p.id === editingRateRow.positionId)!,
                                  contract,
                                  editingRateRow.positionId,
                                )
                              : 0
                          }
                          laborCostOffshore={
                            editingRateRow && allPositions?.find((p) => p.id === editingRateRow.positionId)
                              ? effectiveLaborOffshore(
                                  allPositions.find((p) => p.id === editingRateRow.positionId)!,
                                  contract,
                                  editingRateRow.positionId,
                                )
                              : 0
                          }
                          positionDefaultLaborOnshore={
                            editingRateRow
                              ? Number(allPositions?.find((p) => p.id === editingRateRow.positionId)?.defaultLaborCostOnshore) || 0
                              : 0
                          }
                          positionDefaultLaborOffshore={
                            editingRateRow
                              ? Number(allPositions?.find((p) => p.id === editingRateRow.positionId)?.defaultLaborCostOffshore) || 0
                              : 0
                          }
                          onSave={handleUpdatePositionRate}
                          onSaveLaborBaseline={(positionId, onshoreRaw, offshoreRaw, defaults) => {
                            commitLaborBaseline(positionId, 'onshore', onshoreRaw, defaults.onshore);
                            commitLaborBaseline(positionId, 'offshore', offshoreRaw, defaults.offshore);
                          }}
                        />
                      </>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <Tabs value={ratesViewMode} onValueChange={(v) => setRatesViewMode(v as RatesViewMode)}>
                  <TabsList>
                    <TabsTrigger value="sheet">Rate Sheet (Spreadsheet)</TabsTrigger>
                    <TabsTrigger value="summary">สรุป / ชม.ปกติ</TabsTrigger>
                  </TabsList>

                  <TabsContent value="sheet" className="mt-4">
                    <ContractRateSheetSpreadsheet
                      contract={contract}
                      rates={ratesSortedByPosition ?? []}
                      positions={allPositions ?? null}
                      mobDemobLocations={mobLocationsLive}
                      canEditSell={canEditSellSide}
                      canEditCost={canEditCostSide}
                      canViewCost={canViewCostFields}
                      canMutate={canMutatePositionRates}
                      onCommitCell={commitRateSheetCell}
                      onBulkImport={handleRateSheetBulkImport}
                      onEditRate={canMutatePositionRates ? setEditingRateId : undefined}
                    />
                  </TabsContent>

                  <TabsContent value="summary" className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ตำแหน่งงาน</TableHead>
                      <TableHead className="min-w-[10rem]">
                        <span className="flex flex-col gap-0.5">
                          <span>ราคาขาย (Sell)</span>
                          <span className="text-[10px] font-normal text-muted-foreground">Onshore · Offshore</span>
                        </span>
                      </TableHead>
                      {canViewCostFields && (
                        <TableHead className="min-w-[10rem]">
                          <span className="flex flex-col gap-0.5">
                            <span>ต้นทุนค่าแรง</span>
                            <span className="text-[10px] font-normal text-muted-foreground">Onshore · Offshore</span>
                          </span>
                        </TableHead>
                      )}
                      <TableHead className="min-w-[5rem]">
                        <span className="flex flex-col gap-0.5">
                          <span>ชม.ปกติ</span>
                          <span className="text-[10px] font-normal text-muted-foreground">Onshore · Offshore</span>
                        </span>
                      </TableHead>
                      <TableHead>หน่วย</TableHead>
                      <TableHead>สถานะ</TableHead>
                      {canModify && canMutatePositionRates && <TableHead className="text-right">จัดการ</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ratesSortedByPosition?.map(r => {
                      const pos = allPositions?.find(p => p.id === r.positionId);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-semibold text-primary">
                            <div className="flex flex-col gap-1">
                              <span>{(pos?.positionName || pos?.positionNameTh) || r.positionId}</span>
                            </div>
                          </TableCell>
                          <TableCell className="align-top text-green-600 font-bold">
                            <div className="flex flex-col gap-1.5">
                              <span className="flex items-center gap-1">
                                <span className="text-[10px] font-semibold text-muted-foreground min-w-[3.75rem] shrink-0">
                                  Onshore
                                </span>
                                {effectiveSellOnshore(r) > 0 ? (
                                  <>
                                    <span className="text-xs text-muted-foreground font-normal">{contract.currency} </span>
                                    {effectiveSellOnshore(r).toLocaleString()}
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="text-[10px] font-semibold text-muted-foreground min-w-[3.75rem] shrink-0">
                                  Offshore
                                </span>
                                {effectiveSellOffshore(r) > 0 ? (
                                  <>
                                    <span className="text-xs text-muted-foreground font-normal">{contract.currency} </span>
                                    {effectiveSellOffshore(r).toLocaleString()}
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </span>
                            </div>
                          </TableCell>
                          {canViewCostFields && (
                            <TableCell className="align-top">
                              {pos ? (
                                <div className="flex flex-col gap-1.5">
                                  {(() => {
                                    const onEff = effectiveLaborOnshore(pos, contract, r.positionId);
                                    const offEff = effectiveLaborOffshore(pos, contract, r.positionId);
                                    return (
                                      <>
                                        <div className="flex items-center gap-1 text-amber-700 font-bold">
                                          <span className="text-[10px] font-semibold text-muted-foreground min-w-[3.75rem] shrink-0">
                                            Onshore
                                          </span>
                                          <span className="text-xs text-muted-foreground font-normal">{contract.currency}</span>
                                          <span>
                                            {onEff > 0 ? onEff.toLocaleString() : '—'}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-1 text-amber-700 font-bold">
                                          <span className="text-[10px] font-semibold text-muted-foreground min-w-[3.75rem] shrink-0">
                                            Offshore
                                          </span>
                                          <span className="text-xs text-muted-foreground font-normal">{contract.currency}</span>
                                          <span>
                                            {offEff > 0 ? offEff.toLocaleString() : '—'}
                                          </span>
                                        </div>
                                      </>
                                    );
                                  })()}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="align-top">
                            <div className="flex flex-col gap-1.5 text-sm tabular-nums">
                              <span className="flex items-center gap-1">
                                <span className="text-[10px] font-semibold text-muted-foreground min-w-[3.75rem] shrink-0">
                                  Onshore
                                </span>
                                {effectiveNormalWorkHoursOnshore(r)} ชม.
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="text-[10px] font-semibold text-muted-foreground min-w-[3.75rem] shrink-0">
                                  Offshore
                                </span>
                                {effectiveNormalWorkHoursOffshore(r)} ชม.
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="capitalize">{r.billingUnit}</TableCell>
                          <TableCell>
                            <Badge variant={r.active ? 'outline' : 'secondary'} className={r.active ? 'text-green-600 border-green-200' : ''}>
                              {r.active ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          {canModify && canMutatePositionRates && (
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-primary"
                                title="แก้ไขรายละเอียด / วันหยุด"
                                onClick={() => setEditingRateId(r.id)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteRate(r.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                    {!ratesSortedByPosition?.length && (
                      <TableRow>
                        <TableCell
                          colSpan={5 + (canViewCostFields ? 1 : 0) + (canModify && canMutatePositionRates ? 1 : 0)}
                          className="text-center py-10 text-muted-foreground italic"
                        >
                          ยังไม่มีการกำหนดอัตราราคาในสัญญานี้
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pos" className="mt-6">
            <ContractPoTab
              contract={contract}
              contractId={id}
              customerPOs={customerPOs ?? null}
              canModify={canModify}
              onNavigatePO={(poId) =>
                router.push(
                  `/purchase-orders/${poId}?returnTo=${encodeURIComponent(`/main-contracts/${id}?tab=pos`)}`,
                )
              }
            />
          </TabsContent>

          <TabsContent value="logs" className="mt-6">
            <ContractLogsTab changeLogs={changeLogs ?? null} />
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog
        open={!!addRatePositionDuplicate}
        onOpenChange={(open) => {
          if (!open) {
            if (addRatePositionDuplicate) {
              setNewRate(createInitialNewRateForm());
            }
            setAddRatePositionDuplicate(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ตำแหน่งงานซ้ำกับรายการในสัญญา</AlertDialogTitle>
            <AlertDialogDescription className="text-left space-y-2">
              <span className="block">
                ตำแหน่ง <strong>{duplicateAlertPositionLabel || 'ที่เลือก'}</strong> มีอัตราราคาในสัญญานี้แล้ว
                ไม่สามารถเพิ่มซ้ำได้
              </span>
              <span className="block text-sm">
                ต้องการเปิดแก้ไขรายการเดิม หรือล้างฟอร์มเพื่อเลือกตำแหน่งอื่น?
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel
              className="mt-0"
              onClick={() => {
                setNewRate(createInitialNewRateForm());
                setAddRatePositionDuplicate(null);
              }}
            >
              ล้างฟอร์ม / เลือกใหม่
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const row = addRatePositionDuplicate;
                setAddRatePositionDuplicate(null);
                setIsAddRateOpen(false);
                setNewRate(createInitialNewRateForm());
                if (row) setEditingRateId(row.id);
              }}
            >
              แก้ไขรายการเดิม
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
