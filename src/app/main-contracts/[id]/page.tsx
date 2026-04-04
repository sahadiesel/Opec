'use client';

import { useState, use, useMemo, useCallback, useEffect } from 'react';
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
import { doc, collection, query, where, addDoc, orderBy, getDocs } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { MainContract, PositionRate, PurchaseOrder, Customer, Position, User } from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { canView, canEdit } from '@/lib/permissions';
import { isSystemAdmin, isHrManager } from '@/lib/permission-core';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';
import { useAppUser } from '@/hooks/use-app-user';
import { sortPositionRatesByDisplayName } from '@/lib/position-display';

import { ContractPoTab } from './_components/contract-po-tab';
import { ContractLogsTab } from './_components/contract-logs-tab';
import { ContractAddRateDialog } from './_components/contract-add-rate-dialog';
import { ContractEditRateDialog } from './_components/contract-edit-rate-dialog';
import { ContractSupplementDialog } from './_components/contract-supplement-dialog';
import {
  buildSpecialDaysStrings,
  OVERTIME_RULE_OPTIONS,
  resolveContractHolidaySchedule,
} from '@/lib/contract-position-rate-extras';
import type { CalendarHolidayEntry, OvertimeRuleKey, WeeklyRestPattern } from '@/lib/contract-position-rate-extras';
import { ContractHolidayScheduleSection } from './_components/contract-holiday-schedule-section';
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

const DEFAULT_OT_KEY: OvertimeRuleKey = 'MULT_1_5';
const DEFAULT_OT_LABEL = OVERTIME_RULE_OPTIONS.find((o) => o.key === DEFAULT_OT_KEY)!;

function createInitialNewRateForm(): Partial<PositionRate> {
  return {
    billingUnit: 'daily',
    active: true,
    sellRate: 0,
    costBaseline: 0,
    overtimeRuleKey: DEFAULT_OT_KEY,
    overtimeRule: `${DEFAULT_OT_LABEL.label} — ${DEFAULT_OT_LABEL.description}`,
    normalWorkHours: 8,
    sellOtRules: { afterShift: 1.5, holiday: 1.0, publicHoliday: 1.0, sunday: 1.0, sundayOt: 1.5 },
    costOtRules: { afterShift: 1.5, holiday: 1.0, publicHoliday: 1.0, sunday: 1.0, sundayOt: 1.5 },
    sellSpecialDays: [],
    costSpecialDays: [],
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
  eventAt: number;
};

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
    return currentUser.department === 'sales'
      || currentUser.assignedRoleKey === 'sales_manager'
      || currentUser.assignedRoleKey === 'sales_officer'
      || currentUser.roleId === 'sales_manager'
      || currentUser.roleId === 'sales_officer';
  }, [currentUser]);
  const isHRRole = useMemo(() => {
    if (!currentUser) return false;
    return currentUser.department === 'hr'
      || currentUser.assignedRoleKey === 'hr_manager'
      || currentUser.assignedRoleKey === 'hr_officer'
      || currentUser.roleId === 'hr_manager'
      || currentUser.roleId === 'hr_officer';
  }, [currentUser]);
  const canEditSellSide = useMemo(() => canModify && !isHRRole, [canModify, isHRRole]);
  /** Labour cost baseline: System Admin or HR Manager only (not sales, not hr_officer, not operations). */
  const canEditCostSide = useMemo(
    () => canModify && (isSystemAdmin(currentUser) || isHrManager(currentUser)),
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
    if (canApproveContract || isSystemAdmin(currentUser) || isHrManager(currentUser)) return true;
    const rk = `${currentUser.assignedRoleKey || ''} ${currentUser.roleId || ''}`.toLowerCase();
    return rk.includes('manager');
  }, [currentUser, canModify, canApproveContract]);
  /** กฎตัวคูณหลัง Active: Admin / HR Manager */
  const canEditActiveContractMultipliers = useMemo(
    () => canModify && (isSystemAdmin(currentUser) || isHrManager(currentUser)),
    [canModify, currentUser],
  );

  const mcRef = useMemoFirebase(() => (firestore && isAuthorized ? doc(firestore, 'main_contracts', id) : null), [firestore, id, isAuthorized]);
  const { data: contract, isLoading: isMCLoading } = useDoc<MainContract>(mcRef as any);

  const ratesQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'main_contracts', id, 'position_rates') : null), [firestore, id, isAuthorized]);
  const { data: rates } = useCollection<PositionRate>(ratesQuery as any);

  const [isEditing, setIsEditing] = useState(false);
  const [editedMC, setEditedMC] = useState<Partial<MainContract>>({});

  const [isAddRateOpen, setIsAddRateOpen] = useState(false);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [addRatePositionDuplicate, setAddRatePositionDuplicate] = useState<PositionRate | null>(null);
  const [newRate, setNewRate] = useState<Partial<PositionRate>>(() => createInitialNewRateForm());
  const [activeHolidayDraft, setActiveHolidayDraft] = useState<{
    sellWeekly: WeeklyRestPattern;
    costWeekly: WeeklyRestPattern;
    sellCal: CalendarHolidayEntry[];
    costCal: CalendarHolidayEntry[];
  } | null>(null);
  const [activeMultDraft, setActiveMultDraft] = useState<NonNullable<MainContract['rateMultiplierPolicy']> | null>(null);
  const [isAddSupplementOpen, setIsAddSupplementOpen] = useState(false);
  const [isCreatingSupplement, setIsCreatingSupplement] = useState(false);
  const [supplementTitle, setSupplementTitle] = useState('');
  const [isCreatingRevision, setIsCreatingRevision] = useState(false);

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
    if (contract) setEditedMC(contract);
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
      eventAt: Date.now(),
    });
  };

  const stripRevisionSuffix = (no: string) => no.replace(/R\d+$/i, '');
  const stripSupplementSuffix = (no: string) => no.replace(/-\d{2}(?:R\d+)?$/i, '');
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

  const resolveNextSupplementNo = async (rootMasterNo: string) => {
    if (!firestore) return `${rootMasterNo}-01`;
    const snapshot = await getDocs(collection(firestore, 'main_contracts'));
    let maxSeq = 0;
    snapshot.forEach((d) => {
      const raw = String((d.data() as any).contractNumber || '');
      const m = raw.match(new RegExp(`^${rootMasterNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-([0-9]{2})(?:R\\d+)?$`, 'i'));
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]) || 0);
    });
    return `${rootMasterNo}-${String(maxSeq + 1).padStart(2, '0')}`;
  };

  const computedContractCosting = useMemo(() => {
    const ratesWithSell = (rates || []).filter((r) => Number(r.sellRate || 0) > 0);
    const missingCostCount = ratesWithSell.filter((r) => Number(r.costBaseline || 0) <= 0).length;
    return {
      costingStatus: missingCostCount === 0 ? 'COMPLETE' : 'INCOMPLETE',
      costingMissingPositionsCount: missingCostCount,
    };
  }, [rates]);

  useEffect(() => {
    if (!canModify || !mcRef || !contract) return;
    if (
      contract.costingMissingPositionsCount === computedContractCosting.costingMissingPositionsCount &&
      contract.costingStatus === computedContractCosting.costingStatus
    ) {
      return;
    }
    updateDocumentNonBlocking(mcRef, {
      ...computedContractCosting,
      costingUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }, [computedContractCosting, contract, canModify, mcRef]);

  useEffect(() => {
    if (!contract) {
      setActiveHolidayDraft(null);
      setActiveMultDraft(null);
      return;
    }
    const active = contract.status === 'active';
    const supp = (contract.contractType || 'master') === 'supplemental';
    if (!active || supp) {
      setActiveHolidayDraft(null);
      setActiveMultDraft(null);
      return;
    }
    const r = resolveContractHolidaySchedule(contract);
    setActiveHolidayDraft({
      sellWeekly: r.sellWeekly,
      costWeekly: r.costWeekly,
      sellCal: [...r.sellHolidays],
      costCal: [...r.costHolidays],
    });
    const pol = contract.rateMultiplierPolicy || DEFAULT_RATE_POLICY;
    setActiveMultDraft({
      sell: { ...DEFAULT_RATE_POLICY.sell, ...pol.sell },
      cost: { ...DEFAULT_RATE_POLICY.cost, ...pol.cost },
    });
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
    if ((editedMC.paymentTerms ?? '') !== (contract.paymentTerms ?? '')) changedFields.push('paymentTerms');
    if ((editedMC.notes ?? '') !== (contract.notes ?? '')) changedFields.push('notes');
    if (JSON.stringify(editedMC.rateMultiplierPolicy || null) !== JSON.stringify(contract.rateMultiplierPolicy || null)) {
      changedFields.push('rateMultiplierPolicy');
    }
    const mergedH = { ...contract, ...editedMC } as MainContract;
    const hSched = resolveContractHolidaySchedule(mergedH);
    const sellW = mergedH.contractSellWeeklyRestPattern ?? hSched.sellWeekly;
    const costW = mergedH.contractCostWeeklyRestPattern ?? hSched.costWeekly;
    const sellCal = mergedH.contractSellCalendarHolidays ?? hSched.sellHolidays;
    const costCal = mergedH.contractCostCalendarHolidays ?? hSched.costHolidays;
    const contractSellSpecialDays = buildSpecialDaysStrings(sellW, sellCal);
    const contractCostSpecialDays = buildSpecialDaysStrings(costW, costCal);
    if (
      JSON.stringify({
        w: sellW,
        c: costW,
        sc: sellCal,
        cc: costCal,
      }) !==
      JSON.stringify({
        w: contract.contractSellWeeklyRestPattern ?? resolveContractHolidaySchedule(contract).sellWeekly,
        c: contract.contractCostWeeklyRestPattern ?? resolveContractHolidaySchedule(contract).costWeekly,
        sc: contract.contractSellCalendarHolidays ?? resolveContractHolidaySchedule(contract).sellHolidays,
        cc: contract.contractCostCalendarHolidays ?? resolveContractHolidaySchedule(contract).costHolidays,
      })
    ) {
      changedFields.push('contractHolidaySchedule');
    }

    const nextStatus = 'pending';
    updateDocumentNonBlocking(mcRef, {
      ...editedMC,
      contractSellWeeklyRestPattern: sellW,
      contractCostWeeklyRestPattern: costW,
      contractSellCalendarHolidays: sellCal,
      contractCostCalendarHolidays: costCal,
      contractSellSpecialDays,
      contractCostSpecialDays,
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
          notes: contract.notes || '',
          rateMultiplierPolicy: contract.rateMultiplierPolicy || null,
        }),
        afterSummary: JSON.stringify({
          title: editedMC.title,
          startDate: editedMC.startDate,
          endDate: editedMC.endDate,
          billingTerms: editedMC.billingTerms,
          paymentTerms: editedMC.paymentTerms,
          notes: editedMC.notes || '',
          rateMultiplierPolicy: editedMC.rateMultiplierPolicy || null,
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
    const contractCostSpecialDays = buildSpecialDaysStrings(activeHolidayDraft.costWeekly, activeHolidayDraft.costCal);
    updateDocumentNonBlocking(mcRef, {
      contractSellWeeklyRestPattern: activeHolidayDraft.sellWeekly,
      contractCostWeeklyRestPattern: activeHolidayDraft.costWeekly,
      contractSellCalendarHolidays: activeHolidayDraft.sellCal,
      contractCostCalendarHolidays: activeHolidayDraft.costCal,
      contractSellSpecialDays,
      contractCostSpecialDays,
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
      rateMultiplierPolicy: activeMultDraft,
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

  const handleApproveContract = async () => {
    if (!mcRef || !canApproveContract || !contract) return;
    if (computedContractCosting.costingStatus !== 'COMPLETE' || computedContractCosting.costingMissingPositionsCount > 0) {
      toast({
        variant: 'destructive',
        title: 'อนุมัติไม่ได้',
        description:
          'ยังมีตำแหน่งที่มีราคาขายแล้วแต่ไม่มีต้นทุน — กรุณากรอกต้นทุนให้ครบก่อนอนุมัติ',
      });
      return;
    }
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
        const { id: _drop, ...rateData } = rate as PositionRate;
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
    if (!ratesQuery || !canModify || !contract) return;
    const canMutateRates =
      contract.status === 'pending' ||
      (contract.status === 'active' && (contract.contractType || 'master') === 'supplemental');
    if (!canMutateRates) {
      toast({
        variant: 'destructive',
        title: 'ไม่สามารถเพิ่มตำแหน่งในสัญญาหลักที่ Active',
        description: 'เพิ่มตำแหน่งใหม่ผ่านสัญญาเพิ่มเติมเท่านั้น',
      });
      return;
    }
    const dupForPosition = rates?.find((r) => r.positionId === newRate.positionId);
    if (dupForPosition) {
      setAddRatePositionDuplicate(dupForPosition);
      return;
    }
    const otKey = (newRate.overtimeRuleKey || DEFAULT_OT_KEY) as OvertimeRuleKey;

    const normalizedSellRate = canEditSellSide ? Number(newRate.sellRate) || 0 : 0;
    const normalizedCostBaseline = canEditCostSide ? Number(newRate.costBaseline) || 0 : 0;
    const policySell = effectiveRatePolicy.sell || {};
    const policyCost = effectiveRatePolicy.cost || {};
    const otOpt = OVERTIME_RULE_OPTIONS.find((o) => o.key === otKey);

    addDocumentNonBlocking(ratesQuery, {
      ...newRate,
      positionId: newRate.positionId || '',
      sellRate: normalizedSellRate,
      costBaseline: normalizedCostBaseline,
      billingUnit: newRate.billingUnit || 'daily',
      normalWorkHours: newRate.normalWorkHours || 8,
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
        costBaseline: normalizedCostBaseline,
        normalWorkHours: newRate.normalWorkHours || 8,
      }),
    });
    setIsAddRateOpen(false);
    setNewRate(createInitialNewRateForm());
    toast({ title: "เพิ่มอัตราราคาสำเร็จ" });
  };

  const handleUpdatePositionRate = (rateId: string, payload: Record<string, unknown>) => {
    if (!firestore || !canModify || !contract) return;
    const canMutateRates =
      contract.status === 'pending' ||
      (contract.status === 'active' && (contract.contractType || 'master') === 'supplemental');
    if (!canMutateRates) {
      toast({
        variant: 'destructive',
        title: 'ไม่สามารถแก้ราคาในสัญญาหลักที่ Active',
        description: 'แก้รายละเอียดราคาตำแหน่งได้เฉพาะฉบับ Pending หรือสัญญาเพิ่มเติมที่ Active',
      });
      return;
    }
    updateDocumentNonBlocking(doc(firestore, 'main_contracts', id, 'position_rates', rateId), payload);
    addContractChangeLog({
      actionType: 'UPDATE_POSITION_RATE',
      changedFields: ['position_rates'],
      beforeSummary: `rate_id=${rateId}`,
      afterSummary: JSON.stringify(Object.keys(payload)),
    });
    toast({ title: 'บันทึกอัตราราคาแล้ว' });
  };

  const deleteRate = (rateId: string) => {
    if (!firestore || !canModify || !contract) return;
    const canMutateRates =
      contract.status === 'pending' ||
      (contract.status === 'active' && (contract.contractType || 'master') === 'supplemental');
    if (!canMutateRates) {
      toast({
        variant: 'destructive',
        title: 'ไม่สามารถลบรายการในสัญญาหลักที่ Active',
        description: 'ลบหรือปรับตำแหน่งผ่านสัญญาเพิ่มเติม / ฉบับแก้ไข Pending',
      });
      return;
    }
    if (confirm('ยืนยันการลบอัตราราคานี้?')) {
      const existing = rates?.find(r => r.id === rateId);
      deleteDocumentNonBlocking(doc(firestore, 'main_contracts', id, 'position_rates', rateId));
      addContractChangeLog({
        actionType: 'DELETE_POSITION_RATE',
        changedFields: ['position_rates'],
        beforeSummary: existing ? JSON.stringify({
          positionId: existing.positionId,
          sellRate: existing.sellRate,
          costBaseline: existing.costBaseline,
        }) : 'unknown_rate',
        afterSummary: 'deleted',
      });
      toast({ title: "ลบข้อมูลสำเร็จ" });
    }
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

  const handleCreateSupplementContract = async () => {
    if (!firestore || !currentUser || !contract) return;
    if (!supplementTitle.trim()) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'กรุณาระบุชื่อสัญญาเพิ่มเติม' });
      return;
    }
    setIsCreatingSupplement(true);
    try {
      const rootMasterNo = stripSupplementSuffix(stripRevisionSuffix(contract.contractNumber));
      const finalNo = await resolveNextSupplementNo(rootMasterNo);
      const payload: Partial<MainContract> = {
        contractNumber: finalNo,
        contractType: 'supplemental',
        parentContractId: contract.id,
        inheritTermsFromContractId: contract.id,
        customerId: contract.customerId,
        title: supplementTitle.trim(),
        projectId: contract.projectId || '',
        startDate: contract.startDate,
        endDate: contract.endDate,
        status: 'pending',
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
        notes: `Supplemental contract inheriting holiday/OT terms from ${contract.contractNumber}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const docRef = await addDoc(collection(firestore, 'main_contracts'), payload);
      setIsAddSupplementOpen(false);
      setSupplementTitle('');
      toast({
        title: 'สร้างสัญญาเพิ่มเติมสำเร็จ',
        description: `เลขที่: ${finalNo} (สถานะ Pending - ต้อง Active ก่อนเปิดงานต่อ)`,
      });
      router.push(`/main-contracts/${docRef.id}`);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'สร้างสัญญาเพิ่มเติมไม่สำเร็จ',
        description: error?.message || 'ไม่สามารถสร้างเอกสารสัญญาเพิ่มเติมได้',
      });
    } finally {
      setIsCreatingSupplement(false);
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
  const multCostDisabled =
    isSupplementalContract ||
    (isActiveContract ? !canEditActiveContractMultipliers : !isEditing || !isPendingContract || !canEditCostSide);
  const policySellLive = isActiveContract && activeMultDraft ? activeMultDraft.sell : effectiveRatePolicy.sell;
  const policyCostLive = isActiveContract && activeMultDraft ? activeMultDraft.cost : effectiveRatePolicy.cost;

  const canMutatePositionRates =
    isPendingContract ||
    (isActiveContract && isSupplementalContract);
  const masterActiveRatesLocked = isActiveContract && !isSupplementalContract;

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
              <Button
                className="gap-2 bg-green-600 hover:bg-green-700"
                disabled={
                  computedContractCosting.costingStatus !== 'COMPLETE' ||
                  computedContractCosting.costingMissingPositionsCount > 0
                }
                onClick={handleApproveContract}
              >
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

        <Tabs defaultValue="info" className="w-full">
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

                <div className="space-y-3 rounded-lg border p-4">
                  <div>
                    <Label className="text-base font-semibold">กฎตัวคูณประจำสัญญา (ใช้กับสัญญานี้และสัญญาเพิ่มเติม)</Label>
                    {isSupplementalContract && (
                      <p className="text-xs text-muted-foreground mt-1">
                        สัญญาเพิ่มเติมจะ inherit กฎตัวคูณจากสัญญาหลักอัตโนมัติ
                      </p>
                    )}
                    {isActiveContract && !isSupplementalContract && (
                      <p className="text-xs text-amber-800 mt-1">
                        สัญญา Active: แก้กฎตัวคูณได้เฉพาะ Admin / HR Manager แล้วกด &quot;บันทึกกฎตัวคูณ&quot; ด้านล่าง
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label>ฝั่งลูกค้า (Billing): OT / Holiday / Public Holiday / Sunday / Sunday OT</Label>
                      <div className="grid grid-cols-5 gap-2">
                        <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.otAfterShift} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, sell: { ...activeMultDraft.sell, otAfterShift: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, otAfterShift: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.holiday} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, sell: { ...activeMultDraft.sell, holiday: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, holiday: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.publicHoliday} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, sell: { ...activeMultDraft.sell, publicHoliday: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, publicHoliday: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.sunday} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, sell: { ...activeMultDraft.sell, sunday: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, sunday: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.sundayOt} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, sell: { ...activeMultDraft.sell, sundayOt: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, sundayOt: v } } }); }} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>ฝั่งลูกจ้าง (Payroll): OT / Holiday / Public Holiday / Sunday / Sunday OT</Label>
                      <p className="text-[10px] text-muted-foreground">ฉบับ Pending: แก้ฝั่งนี้ได้เฉพาะ Admin / HR Manager — สัญญา Active: Admin / HR Manager แก้ได้ทั้งสองฝั่ง</p>
                      <div className="grid grid-cols-5 gap-2">
                        <Input type="number" step="0.1" disabled={multCostDisabled} value={policyCostLive.otAfterShift} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, cost: { ...activeMultDraft.cost, otAfterShift: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, otAfterShift: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multCostDisabled} value={policyCostLive.holiday} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, cost: { ...activeMultDraft.cost, holiday: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, holiday: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multCostDisabled} value={policyCostLive.publicHoliday} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, cost: { ...activeMultDraft.cost, publicHoliday: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, publicHoliday: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multCostDisabled} value={policyCostLive.sunday} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, cost: { ...activeMultDraft.cost, sunday: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, sunday: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multCostDisabled} value={policyCostLive.sundayOt} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, cost: { ...activeMultDraft.cost, sundayOt: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, sundayOt: v } } }); }} />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label>Billing: Standby / Mob / Demob / Travel</Label>
                      <div className="grid grid-cols-4 gap-2">
                        <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.standby} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, sell: { ...activeMultDraft.sell, standby: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, standby: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.mobilization} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, sell: { ...activeMultDraft.sell, mobilization: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, mobilization: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.demobilization} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, sell: { ...activeMultDraft.sell, demobilization: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, demobilization: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multSellDisabled} value={policySellLive.travel} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, sell: { ...activeMultDraft.sell, travel: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, travel: v } } }); }} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Payroll: Standby / Mob / Demob / Travel</Label>
                      <div className="grid grid-cols-4 gap-2">
                        <Input type="number" step="0.1" disabled={multCostDisabled} value={policyCostLive.standby} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, cost: { ...activeMultDraft.cost, standby: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, standby: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multCostDisabled} value={policyCostLive.mobilization} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, cost: { ...activeMultDraft.cost, mobilization: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, mobilization: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multCostDisabled} value={policyCostLive.demobilization} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, cost: { ...activeMultDraft.cost, demobilization: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, demobilization: v } } }); }} />
                        <Input type="number" step="0.1" disabled={multCostDisabled} value={policyCostLive.travel} onChange={(e) => { const v = Number(e.target.value) || 0; if (isActiveContract && activeMultDraft) setActiveMultDraft({ ...activeMultDraft, cost: { ...activeMultDraft.cost, travel: v } }); else setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, travel: v } } }); }} />
                      </div>
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
                      sellWeeklyPattern={activeHolidayDraft.sellWeekly}
                      setSellWeeklyPattern={(v) => setActiveHolidayDraft((d) => (d ? { ...d, sellWeekly: v } : d))}
                      costWeeklyPattern={activeHolidayDraft.costWeekly}
                      setCostWeeklyPattern={(v) => setActiveHolidayDraft((d) => (d ? { ...d, costWeekly: v } : d))}
                      sellCalendarHolidays={activeHolidayDraft.sellCal}
                      setSellCalendarHolidays={(fn) =>
                        setActiveHolidayDraft((d) => {
                          if (!d) return d;
                          const next = typeof fn === 'function' ? fn(d.sellCal) : d.sellCal;
                          return { ...d, sellCal: next };
                        })
                      }
                      costCalendarHolidays={activeHolidayDraft.costCal}
                      setCostCalendarHolidays={(fn) =>
                        setActiveHolidayDraft((d) => {
                          if (!d) return d;
                          const next = typeof fn === 'function' ? fn(d.costCal) : d.costCal;
                          return { ...d, costCal: next };
                        })
                      }
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
                      sellWeeklyPattern={holidayResolved.sellWeekly}
                      setSellWeeklyPattern={(v) => setEditedMC({ ...editedMC, contractSellWeeklyRestPattern: v })}
                      costWeeklyPattern={holidayResolved.costWeekly}
                      setCostWeeklyPattern={(v) => setEditedMC({ ...editedMC, contractCostWeeklyRestPattern: v })}
                      sellCalendarHolidays={holidayResolved.sellHolidays}
                      setSellCalendarHolidays={(fn) => {
                        const base = holidayResolved.sellHolidays;
                        const next = typeof fn === 'function' ? fn(base) : base;
                        setEditedMC({ ...editedMC, contractSellCalendarHolidays: next });
                      }}
                      costCalendarHolidays={holidayResolved.costHolidays}
                      setCostCalendarHolidays={(fn) => {
                        const base = holidayResolved.costHolidays;
                        const next = typeof fn === 'function' ? fn(base) : base;
                        setEditedMC({ ...editedMC, contractCostCalendarHolidays: next });
                      }}
                    />
                    {isPendingContract && !isEditing && (
                      <p className="text-xs text-muted-foreground">กด &quot;แก้ไขข้อมูล&quot; เพื่อแก้วันหยุด (บันทึกรวมกับปุ่มบันทึกสัญญา)</p>
                    )}
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
                    ราคาขาย/ต้นทุนเป็นของแต่ละสัญญา (สัญญา A กับ B ตำแหน่งเดียวกันอาจต่างกัน) — ฐานจ่าย payroll ผูกกับ PO/สัญญาที่คนงานถูก assign
                    {masterActiveRatesLocked && (
                      <span className="block mt-1 text-amber-800 font-medium">
                        สัญญาหลัก Active: ล็อกจำนวนตำแหน่งและราคา — เพิ่มตำแหน่งใหม่ผ่านสัญญาเพิ่มเติมเท่านั้น (วันหยุด/กฎตัวคูณแก้ที่แท็บข้อมูลสัญญาหลัก)
                      </span>
                    )}
                    {contract.commercialTermsOwner === 'sales' && canViewCostFields && (
                      <span className="block mt-1 text-amber-700 font-medium">สัญญานี้เริ่มจากฝ่ายขาย: ลงราคาขายได้ที่นี่ ต้นทุนค่าแรงให้ HR Manager / Admin กรอก</span>
                    )}
                  </CardDescription>
                  {(contract.contractType || 'master') === 'supplemental' && (
                    <div className="mt-2">
                      <Badge variant="outline">
                        สัญญาเพิ่มเติม (inherit วันหยุด/OT จากสัญญาแม่: {contract.inheritTermsFromContractId || contract.parentContractId})
                      </Badge>
                    </div>
                  )}
                  {Number(contract.costingMissingPositionsCount || 0) > 0 && (
                    <div className="mt-2">
                      <Badge variant="destructive">
                        มีราคาขายแล้วแต่ยังไม่มีต้นทุน {Number(contract.costingMissingPositionsCount || 0)} ตำแหน่ง (จำเป็นต่อ payroll)
                      </Badge>
                    </div>
                  )}
                </div>
                {canModify && (
                  <div className="flex flex-wrap items-center gap-2">
                    {!isSupplementalContract && (
                      <ContractSupplementDialog
                        open={isAddSupplementOpen}
                        onOpenChange={setIsAddSupplementOpen}
                        supplementTitle={supplementTitle}
                        setSupplementTitle={setSupplementTitle}
                        contractTitle={contract.title}
                        isCreating={isCreatingSupplement}
                        onCreate={handleCreateSupplementContract}
                      />
                    )}
                    {canMutatePositionRates && (
                      <>
                        <ContractAddRateDialog
                          open={isAddRateOpen}
                          onOpenChange={setIsAddRateOpen}
                          newRate={newRate}
                          setNewRate={setNewRate}
                          onAddPositionIdChange={applyAddPositionId}
                          allPositions={allPositions ?? null}
                          canEditSellSide={canEditSellSide}
                          canEditCostSide={canEditCostSide}
                          canViewCostFields={canViewCostFields}
                          isSupplementalContract={isSupplementalContract}
                          contractStatusActive={masterActiveRatesLocked}
                          onAddRate={handleAddRate}
                        />
                        <ContractEditRateDialog
                          open={editingRateId !== null}
                          onOpenChange={(open) => {
                            if (!open) setEditingRateId(null);
                          }}
                          rate={editingRateRow}
                          allPositions={allPositions ?? null}
                          effectiveRatePolicy={effectiveRatePolicy}
                          canEditSellSide={canEditSellSide}
                          canEditCostSide={canEditCostSide}
                          canViewCostFields={canViewCostFields}
                          isSupplementalContract={isSupplementalContract}
                          onSave={handleUpdatePositionRate}
                        />
                      </>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ตำแหน่งงาน</TableHead>
                      <TableHead>ราคาขาย (Sell)</TableHead>
                      {canViewCostFields && <TableHead>ต้นทุน (Cost)</TableHead>}
                      <TableHead>ชม.ปกติ</TableHead>
                      <TableHead>หน่วย</TableHead>
                      <TableHead>สถานะ</TableHead>
                      {canModify && canMutatePositionRates && <TableHead className="text-right">จัดการ</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ratesSortedByPosition?.map(r => {
                      const pos = allPositions?.find(p => p.id === r.positionId);
                      const sellMissingCost = Number(r.sellRate || 0) > 0 && Number(r.costBaseline || 0) <= 0;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-semibold text-primary">
                            <div className="flex flex-col gap-1">
                              <span>{(pos?.positionName || pos?.positionNameTh) || r.positionId}</span>
                              {sellMissingCost && canViewCostFields && (
                                <Badge variant="outline" className="w-fit text-[10px] border-amber-500 text-amber-800">รอต้นทุน</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-green-600 font-bold">
                            {canMutatePositionRates && canEditSellSide && firestore ? (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">{contract.currency}</span>
                                <Input
                                  type="number"
                                  className="h-8 w-24 font-bold text-green-600"
                                  defaultValue={r.sellRate}
                                  key={`${r.id}-sell-${r.sellRate}`}
                                  disabled={isSupplementalContract}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value) || 0;
                                    if (v === Number(r.sellRate)) return;
                                    updateDocumentNonBlocking(doc(firestore, 'main_contracts', id, 'position_rates', r.id), {
                                      sellRate: v,
                                      updatedAt: Date.now(),
                                    });
                                  }}
                                />
                              </div>
                            ) : (
                              <>{contract.currency} {r.sellRate.toLocaleString()}</>
                            )}
                          </TableCell>
                          {canViewCostFields && (
                            <TableCell className="text-muted-foreground">
                              {canMutatePositionRates && canEditCostSide && firestore ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-xs">{contract.currency}</span>
                                  <Input
                                    type="number"
                                    className="h-8 w-24"
                                    defaultValue={r.costBaseline}
                                    key={`${r.id}-cost-${r.costBaseline}`}
                                    disabled={isSupplementalContract}
                                    onBlur={(e) => {
                                      const v = Number(e.target.value) || 0;
                                      if (v === Number(r.costBaseline)) return;
                                      updateDocumentNonBlocking(doc(firestore, 'main_contracts', id, 'position_rates', r.id), {
                                        costBaseline: v,
                                        updatedAt: Date.now(),
                                      });
                                    }}
                                  />
                                </div>
                              ) : (
                                <>{contract.currency} {r.costBaseline.toLocaleString()}</>
                              )}
                            </TableCell>
                          )}
                          <TableCell>{r.normalWorkHours || 8} ชม.</TableCell>
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
                                disabled={isSupplementalContract}
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
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pos" className="mt-6">
            <ContractPoTab
              contract={contract}
              contractId={id}
              customerPOs={customerPOs ?? null}
              canModify={canModify}
              onNavigatePO={(poId) => router.push(`/purchase-orders/${poId}`)}
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
