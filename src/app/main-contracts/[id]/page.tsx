'use client';

import { useState, use, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Plus, 
  Trash2, 
  Save, 
  FileText, 
  ShoppingCart, 
  ArrowLeft,
  CircleDollarSign,
  Briefcase,
  Building2,
  ExternalLink,
  Loader2,
  ShieldAlert,
  History
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
import { doc, collection, query, where, addDoc, orderBy, getDocs } from 'firebase/firestore';
import { updateDocumentNonBlocking, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { MainContract, PositionRate, PurchaseOrder, Customer, Position, User } from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { canView, canEdit } from '@/lib/permissions';
import { isSystemAdmin } from '@/lib/permission-core';
import { formatDateThaiBE, formatDateRangeThaiBE, formatDateTimeThaiBE } from '@/lib/date-thai';
import { DatePickerThaiBE } from '@/components/date/date-picker-thai-be';

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
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { user: firebaseUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

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
  const canEditCostSide = useMemo(() => canModify && !isSalesRole, [canModify, isSalesRole]);
  const canViewCostFields = useMemo(() => !isSalesRole, [isSalesRole]);
  const canApproveContract = useMemo(() => {
    if (!currentUser) return false;
    const level = (currentUser.accessLevel || currentUser.level || '').toLowerCase();
    return isSystemAdmin(currentUser) || level === 'manager' || level === 'admin';
  }, [currentUser]);

  const mcRef = useMemoFirebase(() => (firestore && isAuthorized ? doc(firestore, 'main_contracts', id) : null), [firestore, id, isAuthorized]);
  const { data: contract, isLoading: isMCLoading } = useDoc<MainContract>(mcRef as any);

  const ratesQuery = useMemoFirebase(() => (firestore && isAuthorized ? collection(firestore, 'main_contracts', id, 'position_rates') : null), [firestore, id, isAuthorized]);
  const { data: rates } = useCollection<PositionRate>(ratesQuery as any);

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

  const [isEditing, setIsEditing] = useState(false);
  const [editedMC, setEditedMC] = useState<Partial<MainContract>>({});

  const [isAddRateOpen, setIsAddRateOpen] = useState(false);
  const [newRate, setNewRate] = useState<Partial<PositionRate>>({
    billingUnit: 'daily',
    active: true,
    sellRate: 0,
    costBaseline: 0,
    overtimeRule: '1.5x of Hourly Rate',
    normalWorkHours: 8,
    sellOtRules: { afterShift: 1.5, holiday: 1.0, publicHoliday: 1.0, sunday: 1.0, sundayOt: 1.5 },
    costOtRules: { afterShift: 1.5, holiday: 1.0, publicHoliday: 1.0, sunday: 1.0, sundayOt: 1.5 },
    sellSpecialDays: [],
    costSpecialDays: []
  });
  const [sellSpecialDaysText, setSellSpecialDaysText] = useState('');
  const [costSpecialDaysText, setCostSpecialDaysText] = useState('');
  const [isAddSupplementOpen, setIsAddSupplementOpen] = useState(false);
  const [isCreatingSupplement, setIsCreatingSupplement] = useState(false);
  const [supplementTitle, setSupplementTitle] = useState('');
  const [isCreatingRevision, setIsCreatingRevision] = useState(false);

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

  useEffect(() => {
    if (!canModify || !contract) return;
    if (!rates || !allPositions) return;
    updateContractCostingStatus();
    // keep costing readiness synced whenever rates/positions change
  }, [rates, allPositions, canModify, contract]);

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

    const nextStatus = 'pending';
    updateDocumentNonBlocking(mcRef, {
      ...editedMC,
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

  const updateContractCostingStatus = () => {
    if (!mcRef) return;
    const allPosIds = new Set((allPositions || []).map((p) => p.id));
    const completeCostPosIds = new Set(
      (rates || [])
        .filter((r) => allPosIds.has(r.positionId) && Number(r.costBaseline || 0) > 0)
        .map((r) => r.positionId)
    );
    const missingCount = Math.max(0, allPosIds.size - completeCostPosIds.size);
    const costingStatus = missingCount === 0 ? 'COMPLETE' : 'INCOMPLETE';
    updateDocumentNonBlocking(mcRef, {
      costingStatus,
      costingMissingPositionsCount: missingCount,
      costingUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    });
  };

  const handleAddRate = () => {
    if (!ratesQuery || !canModify) return;
    if (contract?.status !== 'pending') {
      toast({
        variant: 'destructive',
        title: 'ไม่สามารถแก้ฉบับนี้ได้',
        description: 'กรุณาแก้ไขเฉพาะสัญญาฉบับ Pending',
      });
      return;
    }
    const parsedSellSpecialDays = sellSpecialDaysText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedCostSpecialDays = costSpecialDaysText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const normalizedSellRate = canEditSellSide ? Number(newRate.sellRate) || 0 : 0;
    const normalizedCostBaseline = canEditCostSide ? Number(newRate.costBaseline) || 0 : 0;
    const policySell = effectiveRatePolicy.sell || {};
    const policyCost = effectiveRatePolicy.cost || {};

    addDocumentNonBlocking(ratesQuery, {
      ...newRate,
      positionId: newRate.positionId || '',
      sellRate: normalizedSellRate,
      costBaseline: normalizedCostBaseline,
      billingUnit: newRate.billingUnit || 'daily',
      normalWorkHours: newRate.normalWorkHours || 8,
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
      sellSpecialDays: parsedSellSpecialDays,
      costSpecialDays: parsedCostSpecialDays,
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
    setNewRate({
      billingUnit: 'daily',
      active: true,
      sellRate: 0,
      costBaseline: 0,
      overtimeRule: '1.5x of Hourly Rate',
      normalWorkHours: 8,
      sellOtRules: { afterShift: 1.5, holiday: 1.0, publicHoliday: 1.0, sunday: 1.0, sundayOt: 1.5 },
      costOtRules: { afterShift: 1.5, holiday: 1.0, publicHoliday: 1.0, sunday: 1.0, sundayOt: 1.5 },
      sellSpecialDays: [],
      costSpecialDays: [],
    });
    setSellSpecialDaysText('');
    setCostSpecialDaysText('');
    updateContractCostingStatus();
    toast({ title: "เพิ่มอัตราราคาสำเร็จ" });
  };

  const deleteRate = (rateId: string) => {
    if (!firestore || !canModify) return;
    if (contract?.status !== 'pending') {
      toast({
        variant: 'destructive',
        title: 'ไม่สามารถแก้ฉบับนี้ได้',
        description: 'กรุณาแก้ไขเฉพาะสัญญาฉบับ Pending',
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
      updateContractCostingStatus();
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

  if (isUserLoading || !currentUser) return null;

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

  const formatDiffSummary = (raw?: string) => {
    if (!raw) return '-';
    try {
      const parsed = JSON.parse(raw) as Record<string, any>;
      const labels: Record<string, string> = {
        title: 'ชื่อสัญญา',
        startDate: 'วันที่เริ่ม',
        endDate: 'วันที่สิ้นสุด',
        billingTerms: 'Billing Terms',
        paymentTerms: 'Payment Terms',
        notes: 'หมายเหตุ',
        positionId: 'ตำแหน่งงาน',
        sellRate: 'ราคาขาย',
        costBaseline: 'ราคาต้นทุน',
        normalWorkHours: 'ชั่วโมงงานปกติ',
      };
      const rows = Object.entries(parsed).map(([key, value]) => {
        const label = labels[key] || key;
        const formattedValue =
          (key === 'startDate' || key === 'endDate') && typeof value === 'number'
            ? formatDateThaiBE(value)
            : String(value ?? '-');
        return `${label}: ${formattedValue}`;
      });
      return rows.join('\n');
    } catch {
      return raw;
    }
  };

  const formatValueByKey = (key: string, value: any) => {
    if (value === undefined || value === null || value === '') return '-';
    if ((key === 'startDate' || key === 'endDate') && typeof value === 'number') {
      return formatDateThaiBE(value);
    }
    if ((key === 'sellRate' || key === 'costBaseline') && typeof value === 'number') {
      return value.toLocaleString();
    }
    return String(value);
  };

  const formatDiffPairs = (beforeRaw?: string, afterRaw?: string) => {
    if (!beforeRaw && !afterRaw) return '-';
    try {
      const beforeObj = beforeRaw ? (JSON.parse(beforeRaw) as Record<string, any>) : {};
      const afterObj = afterRaw ? (JSON.parse(afterRaw) as Record<string, any>) : {};
      const labels: Record<string, string> = {
        title: 'ชื่อสัญญา',
        startDate: 'วันที่เริ่ม',
        endDate: 'วันที่สิ้นสุด',
        billingTerms: 'Billing Terms',
        paymentTerms: 'Payment Terms',
        notes: 'หมายเหตุ',
        positionId: 'ตำแหน่งงาน',
        sellRate: 'ราคาขาย',
        costBaseline: 'ราคาต้นทุน',
        normalWorkHours: 'ชั่วโมงงานปกติ',
      };
      const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]));
      const changedOnly = keys.filter((k) => JSON.stringify(beforeObj[k]) !== JSON.stringify(afterObj[k]));
      if (changedOnly.length === 0) return '-';
      return changedOnly
        .map((k) => `${labels[k] || k}: ${formatValueByKey(k, beforeObj[k])} -> ${formatValueByKey(k, afterObj[k])}`)
        .join('\n');
    } catch {
      return `${beforeRaw || '-'} -> ${afterRaw || '-'}`;
    }
  };

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
                <Button variant="outline" disabled={!canModify} onClick={() => { setEditedMC(contract); setIsEditing(!isEditing); }}>
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
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label>ฝั่งลูกค้า (Billing): OT / Holiday / Public Holiday / Sunday / Sunday OT</Label>
                      <div className="grid grid-cols-5 gap-2">
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.sell.otAfterShift} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, otAfterShift: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.sell.holiday} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, holiday: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.sell.publicHoliday} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, publicHoliday: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.sell.sunday} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, sunday: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.sell.sundayOt} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, sundayOt: Number(e.target.value) || 0 } } })} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>ฝั่งลูกจ้าง (Payroll): OT / Holiday / Public Holiday / Sunday / Sunday OT</Label>
                      <div className="grid grid-cols-5 gap-2">
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.cost.otAfterShift} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, otAfterShift: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.cost.holiday} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, holiday: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.cost.publicHoliday} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, publicHoliday: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.cost.sunday} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, sunday: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.cost.sundayOt} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, sundayOt: Number(e.target.value) || 0 } } })} />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label>Billing: Standby / Mob / Demob / Travel</Label>
                      <div className="grid grid-cols-4 gap-2">
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.sell.standby} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, standby: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.sell.mobilization} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, mobilization: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.sell.demobilization} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, demobilization: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.sell.travel} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, sell: { ...effectiveRatePolicy.sell, travel: Number(e.target.value) || 0 } } })} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Payroll: Standby / Mob / Demob / Travel</Label>
                      <div className="grid grid-cols-4 gap-2">
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.cost.standby} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, standby: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.cost.mobilization} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, mobilization: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.cost.demobilization} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, demobilization: Number(e.target.value) || 0 } } })} />
                        <Input type="number" step="0.1" disabled={!isEditing || !isPendingContract || isSupplementalContract} value={effectiveRatePolicy.cost.travel} onChange={e => setEditedMC({ ...editedMC, rateMultiplierPolicy: { ...effectiveRatePolicy, cost: { ...effectiveRatePolicy.cost, travel: Number(e.target.value) || 0 } } })} />
                      </div>
                    </div>
                  </div>
                </div>

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
                  <CardDescription>กำหนดราคาขายและฐานต้นทุนสำหรับตำแหน่งงานภายใต้สัญญานี้</CardDescription>
                  {(contract.contractType || 'master') === 'supplemental' && (
                    <div className="mt-2">
                      <Badge variant="outline">
                        สัญญาเพิ่มเติม (inherit วันหยุด/OT จากสัญญาแม่: {contract.inheritTermsFromContractId || contract.parentContractId})
                      </Badge>
                    </div>
                  )}
                  {Number((contract as any).costingMissingPositionsCount || 0) > 0 && (
                    <div className="mt-2">
                      <Badge variant="destructive">
                        ต้นทุนยังไม่ครบ {Number((contract as any).costingMissingPositionsCount || 0)} ตำแหน่ง
                      </Badge>
                    </div>
                  )}
                </div>
                {canModify && isPendingContract && (
                  <div className="flex items-center gap-2">
                    <Dialog open={isAddSupplementOpen} onOpenChange={setIsAddSupplementOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline" className="gap-2">
                          <Plus className="h-4 w-4" /> เอกสารสัญญาเพิ่มเติม
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle>สร้างสัญญาเพิ่มเติมตำแหน่ง</DialogTitle>
                          <DialogDescription>
                            จะสร้างเป็นเอกสารสัญญาอีกฉบับ (แสดงแยกในรายการสัญญาลูกค้า) และ inherit เงื่อนไขวันหยุด/OT เดิม
                          </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-3 py-2">
                          <div className="grid gap-2">
                            <Label>ชื่อสัญญาเพิ่มเติม</Label>
                            <Input
                              value={supplementTitle}
                              onChange={(e) => setSupplementTitle(e.target.value)}
                              placeholder={`เช่น เพิ่มตำแหน่งงาน - ${contract.title}`}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            สถานะเริ่มต้นเป็น Pending และต้องเปลี่ยนเป็น Active ก่อนใช้งาน downstream
                          </p>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setIsAddSupplementOpen(false)}>ยกเลิก</Button>
                          <Button onClick={handleCreateSupplementContract} disabled={isCreatingSupplement || !supplementTitle.trim()}>
                            {isCreatingSupplement ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            สร้างเอกสารเพิ่มเติม
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    <Dialog open={isAddRateOpen} onOpenChange={setIsAddRateOpen}>
                      <DialogTrigger asChild>
                        <Button className="gap-2" disabled={contract.status === 'active'}>
                          <Plus className="h-4 w-4" /> เพิ่มอัตราราคา
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>กำหนดอัตราราคาใหม่</DialogTitle>
                        <DialogDescription>เลือกตำแหน่งและระบุราคาตามเงื่อนไขสัญญา</DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label>ตำแหน่งงาน (Position)</Label>
                          <Select onValueChange={v => setNewRate({...newRate, positionId: v})} value={newRate.positionId}>
                            <SelectTrigger><SelectValue placeholder="เลือกตำแหน่ง..." /></SelectTrigger>
                            <SelectContent>
                              {allPositions?.map(p => (
                                <SelectItem key={p.id} value={p.id}>{p.positionName}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label>ราคาขาย (Sell Rate)</Label>
                            <Input
                              type="number"
                              disabled={!canEditSellSide || isSupplementalContract}
                              value={newRate.sellRate}
                              onChange={e => setNewRate({...newRate, sellRate: parseFloat(e.target.value)})}
                            />
                          </div>
                          {canViewCostFields && (
                            <div className="grid gap-2">
                              <Label>ต้นทุนอ้างอิง (Cost Baseline)</Label>
                              <Input
                                type="number"
                                disabled={!canEditCostSide || isSupplementalContract}
                                value={newRate.costBaseline}
                                onChange={e => setNewRate({...newRate, costBaseline: parseFloat(e.target.value)})}
                              />
                            </div>
                          )}
                        </div>
                        <div className="grid gap-2">
                          <Label>ชั่วโมงงานปกติ/วัน (Normal Hours)</Label>
                          <Select disabled={isSupplementalContract} onValueChange={v => setNewRate({...newRate, normalWorkHours: Number(v) as 8 | 12})} value={String(newRate.normalWorkHours || 8)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="8">8 ชั่วโมง</SelectItem>
                              <SelectItem value="12">12 ชั่วโมง</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label>หน่วยการคิดเงิน</Label>
                            <Select onValueChange={v => setNewRate({...newRate, billingUnit: v as any})} value={newRate.billingUnit}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="daily">Daily (รายวัน)</SelectItem>
                                <SelectItem value="monthly">Monthly (รายเดือน)</SelectItem>
                                <SelectItem value="hourly">Hourly (รายชั่วโมง)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2">
                            <Label>กฎการคิดโอที (OT Rule)</Label>
                            <Input value={newRate.overtimeRule} onChange={e => setNewRate({...newRate, overtimeRule: e.target.value})} />
                          </div>
                        </div>
                        <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-2">
                          <p className="font-semibold text-foreground">กฎตัวคูณ OT/วันหยุด ของสัญญาฉบับนี้จะถูกใช้กับเรทตำแหน่งอัตโนมัติ</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-muted-foreground">
                            <div>
                              <p>ฝั่งขาย: OT {Number(effectiveRatePolicy.sell.otAfterShift ?? 1.5)}x, วันหยุด {Number(effectiveRatePolicy.sell.holiday ?? 1)}x, นขต. {Number(effectiveRatePolicy.sell.publicHoliday ?? 1)}x, อาทิตย์ {Number(effectiveRatePolicy.sell.sunday ?? 1)}x, OT อาทิตย์ {Number(effectiveRatePolicy.sell.sundayOt ?? 1.5)}x</p>
                            </div>
                            {canViewCostFields && (
                              <div>
                                <p>ฝั่งต้นทุน: OT {Number(effectiveRatePolicy.cost.otAfterShift ?? 1.5)}x, วันหยุด {Number(effectiveRatePolicy.cost.holiday ?? 1)}x, นขต. {Number(effectiveRatePolicy.cost.publicHoliday ?? 1)}x, อาทิตย์ {Number(effectiveRatePolicy.cost.sunday ?? 1)}x, OT อาทิตย์ {Number(effectiveRatePolicy.cost.sundayOt ?? 1.5)}x</p>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label>วันพิเศษฝั่งขาย (คั่นด้วย , หรือขึ้นบรรทัด)</Label>
                            <Textarea
                              disabled={!canEditSellSide || isSupplementalContract}
                              value={sellSpecialDaysText}
                              onChange={e => setSellSpecialDaysText(e.target.value)}
                              placeholder="เช่น Sunday Off, Songkran Day 1"
                            />
                          </div>
                          {canViewCostFields && (
                            <div className="grid gap-2">
                              <Label>วันพิเศษฝั่งต้นทุน</Label>
                              <Textarea
                                disabled={!canEditCostSide || isSupplementalContract}
                                value={costSpecialDaysText}
                                onChange={e => setCostSpecialDaysText(e.target.value)}
                                placeholder="เช่น Sunday OT, Travel Day"
                              />
                            </div>
                          )}
                        </div>
                        <div className="grid gap-2">
                          <Label>หมายเหตุ</Label>
                          <Input value={newRate.notes || ''} onChange={e => setNewRate({...newRate, notes: e.target.value})} />
                        </div>
                      </div>
                      <DialogFooter className="sticky bottom-0 bg-background pt-3">
                        <Button variant="outline" onClick={() => setIsAddRateOpen(false)}>ยกเลิก</Button>
                        <Button
                          onClick={handleAddRate}
                          disabled={
                            !newRate.positionId
                            || (!canEditSellSide && !canEditCostSide)
                            || (canEditSellSide && !newRate.sellRate)
                            || (canEditCostSide && !newRate.costBaseline)
                          }
                        >
                          บันทึกอัตราราคา
                        </Button>
                      </DialogFooter>
                      </DialogContent>
                    </Dialog>
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
                      {canModify && <TableHead className="text-right">จัดการ</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rates?.map(r => {
                      const pos = allPositions?.find(p => p.id === r.positionId);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-semibold text-primary">{pos?.positionName || r.positionId}</TableCell>
                          <TableCell className="text-green-600 font-bold">{contract.currency} {r.sellRate.toLocaleString()}</TableCell>
                          {canViewCostFields && <TableCell className="text-muted-foreground">{contract.currency} {r.costBaseline.toLocaleString()}</TableCell>}
                          <TableCell>{r.normalWorkHours || 8} ชม.</TableCell>
                          <TableCell className="capitalize">{r.billingUnit}</TableCell>
                          <TableCell>
                            <Badge variant={r.active ? 'outline' : 'secondary'} className={r.active ? 'text-green-600 border-green-200' : ''}>
                              {r.active ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          {canModify && isPendingContract && (
                            <TableCell className="text-right">
                              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteRate(r.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                    {!rates?.length && (
                      <TableRow>
                        <TableCell
                          colSpan={5 + (canViewCostFields ? 1 : 0) + (canModify ? 1 : 0)}
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
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Customer POs ที่อ้างอิงสัญญานี้</CardTitle>
                  <CardDescription>รายการใบสั่งซื้อบริการกำลังคนภายใต้สัญญาฉบับนี้</CardDescription>
                </div>
                {canModify && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    asChild={contract.status === 'active'}
                    disabled={contract.status !== 'active'}
                  >
                    {contract.status === 'active' ? (
                      <Link href={`/purchase-orders?contractId=${id}&customerId=${contract.customerId}`}>
                        <Plus className="h-4 w-4" /> สร้าง Customer PO ใหม่
                      </Link>
                    ) : (
                      <span><Plus className="h-4 w-4 inline mr-1" /> สร้าง Customer PO ใหม่ (ต้อง Active ก่อน)</span>
                    )}
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เลขที่ Customer PO</TableHead>
                      <TableHead>หัวข้อ / โครงการ</TableHead>
                      <TableHead>ระยะเวลา</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerPOs?.map(po => (
                      <TableRow key={po.id}>
                        <TableCell className="font-mono font-bold">{po.poCode}</TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">{po.title}</span>
                            <span className="text-xs text-muted-foreground">{po.projectName || 'No Project Name'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatDateRangeThaiBE(po.startDate, po.endDate)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={po.status === 'active' ? 'default' : 'secondary'}>{po.status.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="gap-2" onClick={() => router.push(`/purchase-orders/${po.id}`)}>
                            <ExternalLink className="h-4 w-4" /> ดูรายละเอียด
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!customerPOs?.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบ Customer PO ที่อ้างอิงสัญญานี้</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>ประวัติการแก้ไขสัญญา (Contract Change Logs)</CardTitle>
                <CardDescription>บันทึกการแก้ไขราคา/วันสัญญา/การอนุมัติ พร้อมผู้ดำเนินการและค่าก่อน-หลัง</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เวลา</TableHead>
                      <TableHead>ผู้แก้ไข</TableHead>
                      <TableHead>ประเภท</TableHead>
                      <TableHead>ฟิลด์ที่เปลี่ยน</TableHead>
                      <TableHead>ก่อนแก้</TableHead>
                      <TableHead>หลังแก้</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changeLogs?.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs whitespace-nowrap">{formatDateTimeThaiBE(log.eventAt)}</TableCell>
                        <TableCell className="text-sm font-medium">{log.actorName || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{log.actionType}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{(log.changedFields || []).join(', ') || '-'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[300px] whitespace-pre-wrap align-top">
                          {formatDiffPairs(log.beforeSummary, log.afterSummary)}
                        </TableCell>
                        <TableCell className="text-xs max-w-[300px] whitespace-pre-wrap align-top">
                          {formatDiffSummary(log.afterSummary)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!changeLogs?.length && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">
                          ยังไม่มีประวัติการแก้ไขสัญญา
                        </TableCell>
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
