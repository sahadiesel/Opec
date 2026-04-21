'use client';

import { useState, use, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { 
  Plus, 
  Trash2, 
  Save, 
  Users, 
  FileText, 
  ShoppingCart, 
  ArrowLeft,
  Building2,
  ExternalLink,
  KeyRound,
  UserPlus,
  Lock,
  Loader2,
  CheckCircle2,
  Info,
  XCircle,
  FileSignature,
  Pencil
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
import { useFirestore, useDoc, useCollection, useMemoFirebase, useAuth } from '@/firebase';
import { sendPasswordResetEmail, type ActionCodeSettings } from 'firebase/auth';
import { isSystemAdmin, isOperationsPillarExecutive } from '@/lib/permission-core';
import { formatDateRangeThaiBE, formatStoredDateThaiBE } from '@/lib/date-thai';
import { doc, collection, query, where, addDoc, updateDoc, deleteDoc, getDocs, writeBatch, limit } from 'firebase/firestore';
import { 
  Customer, 
  ContactPerson, 
  MainContract, 
  PurchaseOrder, 
  User, 
  PortalRole,
  Assignment,
  Wave,
  WorkerWaveAcceptance,
  DailyTimesheet,
  Quotation
} from '@/lib/types';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { CustomerProvisioningService } from '@/lib/services/customer-provisioning-service';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageGuidance } from '@/components/layout/page-guidance';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAppUser } from '@/hooks/use-app-user';
import { canView, canEdit, canDelete } from '@/lib/permissions';

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();
  const canViewCustomers = useMemo(() => canView(currentUser, 'customers'), [currentUser]);
  const canEditCustomers = useMemo(() => canEdit(currentUser, 'customers'), [currentUser]);
  const canDeleteCustomers = useMemo(() => canDelete(currentUser, 'customers'), [currentUser]);

  const [isEditing, setIsEditing] = useState(false);
  const [editedCust, setEditedCust] = useState<Partial<Customer>>({});
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [newContact, setNewContact] = useState<Partial<ContactPerson>>({
    name: '',
    role: '',
    department: '',
    phone: '',
    email: '',
    isPrimary: false,
    contractId: '',
  });

  const [editingContact, setEditingContact] = useState<(ContactPerson & { id: string }) | null>(null);
  const [isEditContactOpen, setIsEditContactOpen] = useState(false);

  // Provisioning State
  const [isProvisioningOpen, setIsProvisioningOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newPortalUser, setNewPortalUser] = useState({
    email: '',
    displayName: '',
    portalRole: 'viewer' as PortalRole
  });

  const [isPortalEditOpen, setIsPortalEditOpen] = useState(false);
  const [portalEditUser, setPortalEditUser] = useState<User | null>(null);
  const [portalEditDisplayName, setPortalEditDisplayName] = useState('');
  const [portalEditRole, setPortalEditRole] = useState<PortalRole>('viewer');
  const [isPortalEditSaving, setIsPortalEditSaving] = useState(false);

  // --- Data Queries ---

  const custRef = useMemoFirebase(
    () => (firestore && canViewCustomers ? doc(firestore, 'customers', id) : null),
    [firestore, id, canViewCustomers]
  );
  const { data: customer, isLoading: isCustLoading } = useDoc<Customer>(custRef as any);

  const contactsQuery = useMemoFirebase(() => (firestore && canViewCustomers ? collection(firestore, 'customers', id, 'contact_persons') : null), [firestore, id, canViewCustomers]);
  const { data: contacts } = useCollection<ContactPerson>(contactsQuery as any);

  const contractsQuery = useMemoFirebase(() => {
    if (!firestore || !canViewCustomers) return null;
    return query(collection(firestore, 'main_contracts'), where('customerId', '==', id));
  }, [firestore, id, canViewCustomers]);
  const { data: customerContracts } = useCollection<MainContract>(contractsQuery as any);

  const poQuery = useMemoFirebase(() => {
    if (!firestore || !canViewCustomers) return null;
    return query(collection(firestore, 'purchase_orders'), where('customerId', '==', id));
  }, [firestore, id, canViewCustomers]);
  const { data: customerPOs } = useCollection<PurchaseOrder>(poQuery as any);

  // users list: Firestore rules allow list only for canManageSystem (admin)
  const portalUsersQuery = useMemoFirebase(() => {
    const canListPortalUsers =
      !!currentUser && (isSystemAdmin(currentUser) || isOperationsPillarExecutive(currentUser));
    if (!firestore || !canListPortalUsers || !canViewCustomers) return null;
    return query(collection(firestore, 'users'), where('customerId', '==', id), where('userType', '==', 'customer_portal'));
  }, [firestore, id, currentUser, canViewCustomers]);
  const { data: portalUsers } = useCollection<User>(portalUsersQuery as any);

  const quosQuery = useMemoFirebase(() => {
    if (!firestore || !canViewCustomers) return null;
    return query(collection(firestore, 'quotations'), where('customerId', '==', id));
  }, [firestore, id, canViewCustomers]);
  const { data: customerQuos } = useCollection<Quotation>(quosQuery as any);

  // --- Operational Queries for Summary ---

  const asgnQuery = useMemoFirebase(() => {
    if (!firestore || !canViewCustomers) return null;
    return query(collection(firestore, 'mobilizations'), where('customerId', '==', id), where('deploymentStatus', '==', 'ACTIVE'));
  }, [firestore, id, canViewCustomers]);
  const { data: activeAssignments } = useCollection<Assignment>(asgnQuery as any);

  const wavesQuery = useMemoFirebase(() => {
    if (!firestore || !canViewCustomers) return null;
    return query(collection(firestore, 'waves'), where('customerId', '==', id), where('status', '==', 'ACTIVE'));
  }, [firestore, id, canViewCustomers]);
  const { data: activeWaves } = useCollection<Wave>(wavesQuery as any);

  const acceptQuery = useMemoFirebase(() => {
    if (!firestore || !canViewCustomers) return null;
    return query(collection(firestore, 'worker_wave_acceptances'), where('customerId', '==', id), where('status', '==', 'pending'));
  }, [firestore, id, canViewCustomers]);
  const { data: pendingAcceptances } = useCollection<WorkerWaveAcceptance>(acceptQuery as any);

  const tsQuery = useMemoFirebase(() => {
    if (!firestore || !canViewCustomers) return null;
    return query(collection(firestore, 'daily_timesheets'), where('customerId', '==', id), where('status', '==', 'OPS_REVIEWED'));
  }, [firestore, id, canViewCustomers]);
  const { data: pendingTimesheets } = useCollection<DailyTimesheet>(tsQuery as any);

  // --- Actions ---

  const handleSaveMaster = async () => {
    if (!canEditCustomers) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขข้อมูลลูกค้า' });
      return;
    }
    if (!custRef) return;
    const normalizedBranchNo = editedCust.branchType === 'branch' ? (editedCust.branchNo || '').trim() : '00000';
    if (editedCust.branchType === 'branch' && !normalizedBranchNo) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'กรุณาระบุเลขสาขา' });
      return;
    }
    const { id: _docId, ...dataWithoutId } = editedCust as Partial<Customer> & { id?: string };
    try {
      await updateDoc(custRef, { ...dataWithoutId, branchNo: normalizedBranchNo, updatedAt: Date.now() } as Partial<Customer>);
      setIsEditing(false);
      toast({ title: "บันทึกสำเร็จ", description: "ข้อมูลลูกค้าถูกอัปเดตเรียบร้อยแล้ว" });
    } catch (err: any) {
      console.error('saveMaster error:', err);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: err?.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูลลูกค้า' });
    }
  };

  /** ลิงก์รีเซ็ตรหัสจาก Firebase — ต้องใส่ continue URL ให้ตรงโดเมนที่ลงใน Firebase Console → Auth → Authorized domains */
  const buildPasswordResetActionSettings = (): ActionCodeSettings => ({
    url: typeof window !== 'undefined' ? `${window.location.origin}/` : 'http://localhost:9003/',
    handleCodeInApp: false,
  });

  const sendPasswordResetToPortalEmail = async (emailRaw: string) => {
    const email = emailRaw.trim().toLowerCase();
    if (!email) throw new Error('ไม่มีอีเมล');
    await sendPasswordResetEmail(auth, email, buildPasswordResetActionSettings());
  };

  const handleProvisionPortalUser = async () => {
    if (!firestore || !currentUser || !customer) return;
    if (!newPortalUser.email || !newPortalUser.displayName) {
      toast({ variant: "destructive", title: "ข้อมูลไม่ครบ", description: "กรุณาระบุอีเมลและชื่อแสดงผล" });
      return;
    }

    const createdEmail = newPortalUser.email.trim().toLowerCase();

    setIsSubmitting(true);
    const service = new CustomerProvisioningService(firestore);
    try {
      const { tempPassword } = await service.createCustomerPortalUser({
        ...newPortalUser,
        email: createdEmail,
        customerId: id,
        adminUser: currentUser
      });

      setIsProvisioningOpen(false);
      setNewPortalUser({ email: '', displayName: '', portalRole: 'viewer' });

      let resetEmailOk = false;
      let resetEmailErr = '';
      try {
        await sendPasswordResetToPortalEmail(createdEmail);
        resetEmailOk = true;
      } catch (e: unknown) {
        console.error('[Portal] sendPasswordResetEmail after provision:', e);
        const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: string }).code) : '';
        resetEmailErr = code || (e instanceof Error ? e.message : 'unknown');
      }

      toast({
        title: 'สร้างบัญชีลูกค้าสำเร็จ',
        description: resetEmailOk
          ? `ส่งลิงก์ตั้งรหัสไปที่ ${createdEmail} แล้ว — รหัสชั่วคราวสำรองสำหรับแอดมิน: ${tempPassword}`
          : `รหัสชั่วคราว: ${tempPassword} — ส่งอีเมลอัตโนมัติไม่สำเร็จ (${resetEmailErr}) กดไอคอนกุญแจที่รายการ หรือตรวจ Firebase Auth (Authorized domains / Email template)`,
        duration: resetEmailOk ? 9000 : 14000,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Provisioning Error';
      toast({ variant: 'destructive', title: 'Provisioning Error', description: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = (user: User) => {
    if (!firestore || !currentUser) return;
    const service = new CustomerProvisioningService(firestore);
    if (user.isActive) {
      service.deactivateUser(user.id, 'Manually deactivated by admin', currentUser);
      toast({ title: "ระงับการใช้งานสำเร็จ" });
    } else {
      service.activateUser(user.id, currentUser);
      toast({ title: "เปิดการใช้งานสำเร็จ" });
    }
  };

  const openPortalUserEdit = (user: User) => {
    setPortalEditUser(user);
    setPortalEditDisplayName(user.displayName || '');
    setPortalEditRole((user.portalRole as PortalRole) || 'viewer');
    setIsPortalEditOpen(true);
  };

  const handleSavePortalUserEdit = async () => {
    if (!firestore || !portalEditUser || !canEditCustomers) return;
    const name = portalEditDisplayName.trim();
    if (!name) {
      toast({ variant: 'destructive', title: 'กรุณาระบุชื่อแสดงผล' });
      return;
    }
    setIsPortalEditSaving(true);
    try {
      await updateDoc(doc(firestore, 'users', portalEditUser.id), {
        displayName: name,
        portalRole: portalEditRole,
        updatedAt: Date.now(),
      });
      toast({
        title: 'บันทึกข้อมูลบัญชีพอร์ทัลแล้ว',
        description:
          portalEditRole === 'approver'
            ? 'Approver — อนุมัติ billing บนใบแจ้งหนี้ได้'
            : 'Viewer — ดูอย่างเดียว',
      });
      setIsPortalEditOpen(false);
      setPortalEditUser(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: msg });
    } finally {
      setIsPortalEditSaving(false);
    }
  };

  /** ส่งลิงก์ตั้งรหัสใหม่ไปที่อีเมลล็อกอินของลูกค้า (Firebase Auth) */
  const handleSendPortalPasswordReset = async (user: User) => {
    if (!canEditCustomers) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์' });
      return;
    }
    const email = user.email?.trim();
    if (!email) {
      toast({ variant: 'destructive', title: 'ไม่มีอีเมล', description: 'บัญชีนี้ไม่มีอีเมลสำหรับรีเซ็ต' });
      return;
    }
    try {
      await sendPasswordResetToPortalEmail(email);
      toast({
        title: 'ส่งลิงก์รีเซ็ตรหัสแล้ว',
        description: `ให้ลูกค้าเช็กอีเมล ${email} และโฟลเดอร์สแปม — ถ้าไม่ได้รับ ตรวจ Firebase Console → Authentication → Templates และ Authorized domains`,
        duration: 10000,
      });
    } catch (err: unknown) {
      console.error('[Portal] sendPasswordResetEmail', err);
      const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: string }).code) : '';
      const msg = err instanceof Error ? err.message : 'ส่งไม่สำเร็จ';
      toast({
        variant: 'destructive',
        title: 'ส่งอีเมลไม่สำเร็จ',
        description: code ? `${code}: ${msg}` : msg,
        duration: 12000,
      });
    }
  };

  const handleAddContact = async () => {
    if (!canEditCustomers) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์เพิ่มผู้ติดต่อ' });
      return;
    }
    if (!firestore || !newContact.name) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ครบ', description: 'กรุณาระบุชื่อผู้ติดต่อ' });
      return;
    }
    const targetContractId = (newContact.contractId || '').trim();
    const cleanList = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean).join(', ');
    const payload: Record<string, unknown> = {
      name: newContact.name || '',
      role: newContact.role || '',
      department: newContact.department || '',
      phone: cleanList(newContact.phone || ''),
      email: cleanList(newContact.email || ''),
      isPrimary: !!newContact.isPrimary,
      notes: newContact.notes || '',
    };
    if (targetContractId) {
      payload.contractId = targetContractId;
    }
    try {
      await addDoc(collection(firestore, 'customers', id, 'contact_persons'), payload);
      setIsAddContactOpen(false);
      setNewContact({ name: '', role: '', department: '', phone: '', email: '', isPrimary: false, contractId: '' });
      toast({ title: 'เพิ่มผู้ติดต่อสำเร็จ' });
    } catch (err: any) {
      console.error('addContact error:', err);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: err?.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูลผู้ติดต่อ' });
    }
  };

  const isBizExecutive = isSystemAdmin(currentUser) || isOperationsPillarExecutive(currentUser);

  const handleEditContact = async () => {
    if (!canEditCustomers) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์', description: 'คุณไม่มีสิทธิ์แก้ไขผู้ติดต่อ' });
      return;
    }
    if (!firestore || !editingContact) return;
    const { id: contactId, ...rest } = editingContact;
    const cleanList = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean).join(', ');
    const payload: Record<string, unknown> = {
      name: rest.name || '',
      role: rest.role || '',
      department: rest.department || '',
      phone: cleanList(rest.phone || ''),
      email: cleanList(rest.email || ''),
      isPrimary: !!rest.isPrimary,
      notes: rest.notes || '',
    };
    const cid = (rest.contractId || '').trim();
    if (cid) payload.contractId = cid;
    try {
      await updateDoc(
        doc(firestore, 'customers', id, 'contact_persons', contactId),
        payload as Partial<ContactPerson>
      );
      setIsEditContactOpen(false);
      setEditingContact(null);
      toast({ title: 'แก้ไขผู้ติดต่อสำเร็จ' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: err?.message || 'ไม่สามารถแก้ไขผู้ติดต่อได้' });
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!firestore || !isBizExecutive || !canDeleteCustomers) return;
    if (!confirm('ยืนยันลบผู้ติดต่อนี้?')) return;
    try {
      await deleteDoc(doc(firestore, 'customers', id, 'contact_persons', contactId));
      toast({ title: 'ลบผู้ติดต่อสำเร็จ' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ', description: err?.message || 'ไม่สามารถลบผู้ติดต่อได้' });
    }
  };

  const handleDeleteQuotation = async (quoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!firestore || !isBizExecutive || !canDeleteCustomers) return;
    if (!confirm('ยืนยันลบใบเสนอราคานี้?')) return;
    try {
      await deleteDoc(doc(firestore, 'quotations', quoId));
      toast({ title: 'ลบใบเสนอราคาสำเร็จ' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ', description: err?.message || 'ไม่สามารถลบใบเสนอราคาได้' });
    }
  };

  const handleDeleteContract = async (contractId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!firestore || !currentUser || !isSystemAdmin(currentUser) || !canDeleteCustomers) return;
    if (!confirm('ยืนยันลบสัญญานี้? การลบสัญญาจะมีผลต่อข้อมูลที่อ้างอิงทั้งหมด (เฉพาะ System Admin)')) return;
    try {
      const poSnap = await getDocs(
        query(collection(firestore, 'purchase_orders'), where('contractId', '==', contractId), limit(5)),
      );
      if (!poSnap.empty) {
        toast({
          variant: 'destructive',
          title: 'ลบไม่ได้',
          description: 'มี Customer PO อ้างอิงสัญญานี้อยู่',
        });
        return;
      }
      const childSnap = await getDocs(
        query(collection(firestore, 'main_contracts'), where('parentContractId', '==', contractId), limit(5)),
      );
      if (!childSnap.empty) {
        toast({
          variant: 'destructive',
          title: 'ลบไม่ได้',
          description: 'มีสัญญาฉบับแก้/เพิ่มเติมอ้างอิงสัญญานี้',
        });
        return;
      }
      const ratesSnap = await getDocs(collection(firestore, 'main_contracts', contractId, 'position_rates'));
      const refs = [...ratesSnap.docs.map((d) => d.ref), doc(firestore, 'main_contracts', contractId)];
      const chunk = 400;
      for (let i = 0; i < refs.length; i += chunk) {
        const batch = writeBatch(firestore);
        refs.slice(i, i + chunk).forEach((r) => batch.delete(r));
        await batch.commit();
      }
      toast({ title: 'ลบสัญญาสำเร็จ' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ', description: err?.message || 'ไม่สามารถลบสัญญาได้' });
    }
  };

  const handleDeletePO = async (poId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!firestore || !isBizExecutive || !canDeleteCustomers) return;
    if (!confirm('ยืนยันลบใบสั่งซื้อนี้?')) return;
    try {
      await deleteDoc(doc(firestore, 'purchase_orders', poId));
      toast({ title: 'ลบใบสั่งซื้อสำเร็จ' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ', description: err?.message || 'ไม่สามารถลบใบสั่งซื้อได้' });
    }
  };

  const handleDeletePortalUser = async (userId: string) => {
    if (!firestore || !isBizExecutive) return;
    if (!confirm('ยืนยันลบบัญชีผู้ใช้นี้? ผู้ใช้จะไม่สามารถเข้าระบบได้อีก')) return;
    try {
      await deleteDoc(doc(firestore, 'users', userId));
      toast({ title: 'ลบบัญชีสำเร็จ' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'ลบไม่สำเร็จ', description: err?.message || 'ไม่สามารถลบบัญชีได้' });
    }
  };

  if (userLoading || !currentUser) return null;
  if (!canViewCustomers) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
      </AppShell>
    );
  }
  if (isCustLoading || !customer) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-12 w-12 text-primary animate-spin" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        {/* Header Section */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/customers"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
              <Badge variant="outline" className="font-mono text-primary bg-primary/5">{customer.customerCode || 'NO CODE'}</Badge>
              {customer.isActive ? (
                <Badge className="bg-green-600 text-white border-none">Active</Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
            </div>
            <p className="text-muted-foreground flex items-center gap-2 mt-1">
              <Building2 className="h-4 w-4" /> Tax ID: {customer.taxId || 'N/A'} | {customer.branchType === 'branch' ? `สาขา ${customer.branchNo || '-'}` : 'สำนักงานใหญ่'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditedCust(customer); setIsEditing(!isEditing); }}>
              {isEditing ? 'ยกเลิก' : 'แก้ไขข้อมูล'}
            </Button>
            {isEditing && (
              <Button className="gap-2 bg-primary font-bold shadow-md" onClick={handleSaveMaster}>
                <Save className="h-4 w-4" /> บันทึกการเปลี่ยนแปลง
              </Button>
            )}
          </div>
        </div>

        {/* Summary Area */}
        <div className="space-y-1.5 border-b border-dashed pb-4 mb-2">
          {/* Commercial Summary */}
          <div className="flex gap-8 px-2 text-[10px] uppercase font-black tracking-widest text-muted-foreground/60">
            <span>Quotations: <b className="text-primary">{customerQuos?.length || 0}</b></span>
            <span>Active Contracts: <b className="text-primary">{customerContracts?.filter(c => c.status === 'active').length || 0}</b></span>
            <span>Active POs: <b className="text-primary">{customerPOs?.filter(p => p.status === 'active').length || 0}</b></span>
            <span>Portal Users: <b className="text-primary">{portalUsers?.filter(u => u.isActive).length || 0}</b></span>
          </div>
          {/* Operations Summary */}
          <div className="flex gap-8 px-2 text-[10px] uppercase font-black tracking-widest text-muted-foreground/60">
            <span>Active Headcount: <b className="text-blue-600">{activeAssignments?.length || 0}</b></span>
            <span>Active Waves: <b className="text-blue-600">{activeWaves?.length || 0}</b></span>
            <span>Pending Approvals: <b className="text-amber-600">{(pendingAcceptances?.length || 0) + (pendingTimesheets?.length || 0)}</b></span>
          </div>
        </div>

        {/* Dashboard Tabs */}
        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid grid-cols-6 w-full md:w-fit h-auto p-1 bg-muted/50">
            <TabsTrigger value="info" className="gap-2 py-2 px-6"><Building2 className="h-4 w-4" /> ข้อมูลบริษัท</TabsTrigger>
            <TabsTrigger value="contacts" className="gap-2 py-2 px-6"><Users className="h-4 w-4" /> ผู้ติดต่อ</TabsTrigger>
            <TabsTrigger value="quotations" className="gap-2 py-2 px-6"><FileSignature className="h-4 w-4" /> ใบเสนอราคา</TabsTrigger>
            <TabsTrigger value="contracts" className="gap-2 py-2 px-6"><FileText className="h-4 w-4" /> สัญญาหลัก</TabsTrigger>
            <TabsTrigger value="pos" className="gap-2 py-2 px-6"><ShoppingCart className="h-4 w-4" /> ใบสั่งซื้อ (POs)</TabsTrigger>
            <TabsTrigger value="portal" className="gap-2 py-2 px-6"><Lock className="h-4 w-4" /> Portal Access</TabsTrigger>
          </TabsList>

          {/* Company Info Tab */}
          <TabsContent value="info" className="mt-6 space-y-6">
            <Card>
              <CardHeader><CardTitle>ข้อมูลบริษัท (Company Profile)</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>ชื่อลูกค้า / บริษัท</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedCust.name : customer.name} onChange={e => setEditedCust({...editedCust, name: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>รหัสลูกค้า</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedCust.customerCode : customer.customerCode} onChange={e => setEditedCust({...editedCust, customerCode: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>เลขประจำตัวผู้เสียภาษี</Label>
                    <Input disabled={!isEditing} value={isEditing ? editedCust.taxId : customer.taxId} onChange={e => setEditedCust({...editedCust, taxId: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>ประเภทสาขา</Label>
                    <Select
                      disabled={!isEditing}
                      value={((isEditing ? editedCust.branchType : customer.branchType) as any) || 'head_office'}
                      onValueChange={(v: 'head_office' | 'branch') => setEditedCust({ ...editedCust, branchType: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="head_office">สำนักงานใหญ่</SelectItem>
                        <SelectItem value="branch">สาขา</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {(isEditing ? editedCust.branchType : customer.branchType) === 'branch' && (
                    <div className="space-y-2">
                      <Label>เลขสาขา (Branch No.)</Label>
                      <Input
                        disabled={!isEditing}
                        value={isEditing ? (editedCust.branchNo || '') : (customer.branchNo || '')}
                        onChange={e => setEditedCust({ ...editedCust, branchNo: e.target.value })}
                      />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>เบอร์โทรศัพท์บริษัท</Label>
                      <Input disabled={!isEditing} value={isEditing ? editedCust.phone : customer.phone} onChange={e => setEditedCust({...editedCust, phone: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label>อีเมลบริษัท</Label>
                      <Input disabled={!isEditing} value={isEditing ? editedCust.email : customer.email} onChange={e => setEditedCust({...editedCust, email: e.target.value})} />
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>ที่อยู่จดทะเบียน (Registered Address)</Label>
                    <Textarea disabled={!isEditing} className="min-h-[100px]" value={isEditing ? editedCust.registeredAddress : customer.registeredAddress} onChange={e => setEditedCust({...editedCust, registeredAddress: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>ที่อยู่วางบิล (Billing Address)</Label>
                    <Textarea disabled={!isEditing} className="min-h-[100px]" value={isEditing ? editedCust.billingAddress : customer.billingAddress} onChange={e => setEditedCust({...editedCust, billingAddress: e.target.value})} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Contacts Tab */}
          <TabsContent value="contacts" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>ผู้ติดต่อหลัก (Contact Persons)</CardTitle>
                  <CardDescription>รายชื่อเจ้าหน้าที่ฝั่งลูกค้าสำหรับการประสานงาน</CardDescription>
                </div>
                <Dialog open={isAddContactOpen} onOpenChange={setIsAddContactOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2"><Plus className="h-4 w-4" /> เพิ่มผู้ติดต่อ</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>เพิ่มผู้ติดต่อ</DialogTitle>
                      <DialogDescription>เพิ่มผู้ติดต่อระดับลูกค้า หรือผูกเฉพาะสัญญาหลักได้จากหน้าจอนี้</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3 py-2">
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="text-xs"
                          onClick={() =>
                            setNewContact((prev) => ({
                              ...prev,
                              name: prev.name || customer.name,
                              phone: prev.phone || customer.phone || '',
                              email: prev.email || customer.email || '',
                              department: prev.department || 'client',
                            }))
                          }
                        >
                          ดึงข้อมูลจากลูกค้า
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-2">
                          <Label>ชื่อผู้ติดต่อ</Label>
                          <Input value={newContact.name || ''} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
                        </div>
                        <div className="grid gap-2">
                          <Label>ตำแหน่ง</Label>
                          <Input value={newContact.role || ''} onChange={(e) => setNewContact({ ...newContact, role: e.target.value })} />
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label>โทรศัพท์</Label>
                        {(newContact.phone || '').split(',').map((p, i, arr) => (
                          <div key={i} className="flex gap-1">
                            <Input value={p.trim()} placeholder="เบอร์โทรศัพท์" onChange={(e) => {
                              const parts = (newContact.phone || '').split(',');
                              parts[i] = e.target.value;
                              setNewContact({ ...newContact, phone: parts.join(',') });
                            }} />
                            {arr.length > 1 && (
                              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive" onClick={() => {
                                const parts = (newContact.phone || '').split(',').filter((_, j) => j !== i);
                                setNewContact({ ...newContact, phone: parts.join(',') });
                              }}><XCircle className="h-4 w-4" /></Button>
                            )}
                          </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" className="w-fit text-xs gap-1" onClick={() => setNewContact({ ...newContact, phone: (newContact.phone || '') + ',' })}>
                          <Plus className="h-3 w-3" /> เพิ่มเบอร์
                        </Button>
                      </div>
                      <div className="grid gap-2">
                        <Label>อีเมล</Label>
                        {(newContact.email || '').split(',').map((e, i, arr) => (
                          <div key={i} className="flex gap-1">
                            <Input value={e.trim()} placeholder="อีเมล" onChange={(ev) => {
                              const parts = (newContact.email || '').split(',');
                              parts[i] = ev.target.value;
                              setNewContact({ ...newContact, email: parts.join(',') });
                            }} />
                            {arr.length > 1 && (
                              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive" onClick={() => {
                                const parts = (newContact.email || '').split(',').filter((_, j) => j !== i);
                                setNewContact({ ...newContact, email: parts.join(',') });
                              }}><XCircle className="h-4 w-4" /></Button>
                            )}
                          </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" className="w-fit text-xs gap-1" onClick={() => setNewContact({ ...newContact, email: (newContact.email || '') + ',' })}>
                          <Plus className="h-3 w-3" /> เพิ่มอีเมล
                        </Button>
                      </div>
                      <div className="grid gap-2">
                        <Label>สัญญาที่ผูก (ถ้าเว้นว่าง = ใช้ได้ทุกสัญญา)</Label>
                        <Select value={newContact.contractId || 'all'} onValueChange={(v) => setNewContact({ ...newContact, contractId: v === 'all' ? '' : v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">ทุกสัญญา (Customer-level)</SelectItem>
                            {customerContracts?.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.contractNumber} - {c.title}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAddContactOpen(false)}>ยกเลิก</Button>
                      <Button onClick={handleAddContact}>บันทึกผู้ติดต่อ</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">ชื่อ-นามสกุล</TableHead>
                      <TableHead>ตำแหน่ง/แผนก</TableHead>
                      <TableHead>เบอร์โทรศัพท์</TableHead>
                      <TableHead>อีเมล</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts?.map(contact => (
                      <TableRow key={contact.id}>
                        <TableCell className="pl-6 font-bold text-primary">{contact.name}</TableCell>
                        <TableCell className="text-xs">{contact.role}{contact.department ? ` (${contact.department})` : ''}</TableCell>
                        <TableCell className="text-xs">
                          {(contact.phone || '').split(',').map(p => p.trim()).filter(Boolean).map((p, i) => (
                            <div key={i}>{p}</div>
                          ))}
                        </TableCell>
                        <TableCell className="text-xs">
                          {(contact.email || '').split(',').map(e => e.trim()).filter(Boolean).map((e, i) => (
                            <div key={i}>{e}</div>
                          ))}
                        </TableCell>
                        <TableCell>
                          {contact.contractId ? (
                            <Badge variant="outline" className="mr-1 text-[10px]">เฉพาะสัญญา</Badge>
                          ) : null}
                          {contact.isPrimary && <Badge className="bg-blue-600 text-white border-none">Primary</Badge>}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="แก้ไข"
                              onClick={() => { setEditingContact(contact); setIsEditContactOpen(true); }}>
                              <Pencil className="h-4 w-4 text-primary" />
                            </Button>
                            {isBizExecutive && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="ลบ"
                                onClick={() => handleDeleteContact(contact.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!contacts || contacts.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">ยังไม่มีข้อมูลผู้ติดต่อ</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            {/* Edit Contact Dialog */}
            <Dialog open={isEditContactOpen} onOpenChange={(open) => { setIsEditContactOpen(open); if (!open) setEditingContact(null); }}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>แก้ไขผู้ติดต่อ</DialogTitle>
                  <DialogDescription>แก้ไขข้อมูลผู้ติดต่อสำหรับลูกค้า</DialogDescription>
                </DialogHeader>
                {editingContact && (
                  <div className="grid gap-3 py-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-2">
                        <Label>ชื่อผู้ติดต่อ</Label>
                        <Input value={editingContact.name || ''} onChange={e => setEditingContact({ ...editingContact, name: e.target.value })} />
                      </div>
                      <div className="grid gap-2">
                        <Label>ตำแหน่ง</Label>
                        <Input value={editingContact.role || ''} onChange={e => setEditingContact({ ...editingContact, role: e.target.value })} />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label>โทรศัพท์</Label>
                      {(editingContact.phone || '').split(',').map((p, i, arr) => (
                        <div key={i} className="flex gap-1">
                          <Input value={p.trim()} placeholder="เบอร์โทรศัพท์" onChange={(ev) => {
                            const parts = (editingContact.phone || '').split(',');
                            parts[i] = ev.target.value;
                            setEditingContact({ ...editingContact, phone: parts.join(',') });
                          }} />
                          {arr.length > 1 && (
                            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive" onClick={() => {
                              const parts = (editingContact.phone || '').split(',').filter((_, j) => j !== i);
                              setEditingContact({ ...editingContact, phone: parts.join(',') });
                            }}><XCircle className="h-4 w-4" /></Button>
                          )}
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" className="w-fit text-xs gap-1" onClick={() => setEditingContact({ ...editingContact, phone: (editingContact.phone || '') + ',' })}>
                        <Plus className="h-3 w-3" /> เพิ่มเบอร์
                      </Button>
                    </div>
                    <div className="grid gap-2">
                      <Label>อีเมล</Label>
                      {(editingContact.email || '').split(',').map((e, i, arr) => (
                        <div key={i} className="flex gap-1">
                          <Input value={e.trim()} placeholder="อีเมล" onChange={(ev) => {
                            const parts = (editingContact.email || '').split(',');
                            parts[i] = ev.target.value;
                            setEditingContact({ ...editingContact, email: parts.join(',') });
                          }} />
                          {arr.length > 1 && (
                            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive" onClick={() => {
                              const parts = (editingContact.email || '').split(',').filter((_, j) => j !== i);
                              setEditingContact({ ...editingContact, email: parts.join(',') });
                            }}><XCircle className="h-4 w-4" /></Button>
                          )}
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" className="w-fit text-xs gap-1" onClick={() => setEditingContact({ ...editingContact, email: (editingContact.email || '') + ',' })}>
                        <Plus className="h-3 w-3" /> เพิ่มอีเมล
                      </Button>
                    </div>
                    <div className="grid gap-2">
                      <Label>แผนก</Label>
                      <Input value={editingContact.department || ''} onChange={e => setEditingContact({ ...editingContact, department: e.target.value })} />
                    </div>
                    <div className="grid gap-2">
                      <Label>สัญญาที่ผูก</Label>
                      <Select value={editingContact.contractId || 'all'} onValueChange={v => setEditingContact({ ...editingContact, contractId: v === 'all' ? '' : v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">ทุกสัญญา (Customer-level)</SelectItem>
                          {customerContracts?.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.contractNumber} - {c.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsEditContactOpen(false)}>ยกเลิก</Button>
                  <Button onClick={handleEditContact}>บันทึกการแก้ไข</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Quotations Tab */}
          <TabsContent value="quotations" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>ประวัติการเสนอราคา (Quotation History)</CardTitle>
                  <CardDescription>รายการใบเสนอราคาที่ส่งให้ลูกค้าเพื่อพิจารณา</CardDescription>
                </div>
                <Button variant="outline" asChild><Link href="/quotations">จัดการทั้งหมด <ExternalLink className="h-4 w-4 ml-2" /></Link></Button>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">เลขที่</TableHead>
                      <TableHead>หัวข้อโครงการ</TableHead>
                      <TableHead>วันที่ออก</TableHead>
                      <TableHead className="text-right">มูลค่ารวม</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerQuos?.map(quo => (
                      <TableRow key={quo.id} className="cursor-pointer hover:bg-muted/5" onClick={() => router.push(`/quotations/${quo.id}`)}>
                        <TableCell className="pl-6 font-mono font-bold text-primary">{quo.quotationNo}</TableCell>
                        <TableCell className="text-sm font-medium">{quo.projectTitle}</TableCell>
                        <TableCell className="text-xs">{formatStoredDateThaiBE(quo.issueDate)}</TableCell>
                        <TableCell className="text-right font-bold text-primary">฿{(quo.grandTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell>
                          <Badge variant={quo.status === 'accepted' ? 'default' : 'outline'} className={quo.status === 'accepted' ? 'bg-green-600 text-white border-none' : ''}>
                            {quo.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="แก้ไข"
                              onClick={(e) => { e.stopPropagation(); router.push(`/quotations/${quo.id}`); }}>
                              <Pencil className="h-4 w-4 text-primary" />
                            </Button>
                            {isBizExecutive && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="ลบ"
                                onClick={(e) => handleDeleteQuotation(quo.id, e)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!customerQuos || customerQuos.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">ไม่พบประวัติใบเสนอราคา</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Main Contracts Tab */}
          <TabsContent value="contracts" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>สัญญาหลัก (Master Agreements)</CardTitle>
                  <CardDescription>รายการสัญญา MSA ที่กำหนดฐานราคาจ้างงาน</CardDescription>
                </div>
                <Button variant="outline" asChild><Link href="/main-contracts">ไปที่ระบบสัญญา <ExternalLink className="h-4 w-4 ml-2" /></Link></Button>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">เลขที่สัญญา</TableHead>
                      <TableHead>หัวข้อสัญญา</TableHead>
                      <TableHead>ระยะเวลา</TableHead>
                      <TableHead>สกุลเงิน</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerContracts?.map(contract => {
                      const isLocked = contract.status === 'revised' || contract.status === 'closed' || contract.status === 'expired';
                      return (
                        <TableRow key={contract.id} className="cursor-pointer hover:bg-muted/5" onClick={() => router.push(`/main-contracts/${contract.id}`)}>
                          <TableCell className="pl-6 font-mono font-bold text-primary">{contract.contractNumber}</TableCell>
                          <TableCell className="font-medium text-sm">
                            <div className="flex flex-col gap-1">
                              <span>{contract.title}</span>
                              {(contract.contractType || 'master') === 'supplemental' && (
                                <Badge variant="outline" className="w-fit text-[10px]">Supplemental</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-[10px]">
                            {formatDateRangeThaiBE(contract.startDate, contract.endDate)}
                          </TableCell>
                          <TableCell>{contract.currency}</TableCell>
                          <TableCell>
                            <Badge variant={contract.status === 'active' ? 'default' : 'secondary'} className={contract.status === 'active' ? 'bg-green-600 text-white border-none' : ''}>{contract.status.toUpperCase()}</Badge>
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <div className="flex justify-end gap-1">
                              {isLocked ? (
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="ล็อกแล้ว — ไปสร้างสัญญาเพิ่มเติม"
                                  onClick={(e) => { e.stopPropagation(); router.push(`/main-contracts/${contract.id}`); }}>
                                  <Lock className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              ) : (
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="แก้ไข"
                                  onClick={(e) => { e.stopPropagation(); router.push(`/main-contracts/${contract.id}`); }}>
                                  <Pencil className="h-4 w-4 text-primary" />
                                </Button>
                              )}
                              {isSystemAdmin(currentUser) && !isLocked && contract.status !== 'active' && (
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="ลบ (Admin)"
                                  onClick={(e) => handleDeleteContract(contract.id, e)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {(!customerContracts || customerContracts.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground italic">ไม่พบสัญญาหลัก</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Customer POs Tab */}
          <TabsContent value="pos" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>ใบสั่งซื้อจากลูกค้า (Purchase Orders)</CardTitle>
                  <CardDescription>รายการโควต้าพนักงานและงบประมาณโครงการ</CardDescription>
                </div>
                <Button variant="outline" asChild><Link href="/purchase-orders">ไปที่ระบบใบสั่งซื้อ <ExternalLink className="h-4 w-4 ml-2" /></Link></Button>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">รหัส PO</TableHead>
                      <TableHead>โครงการ</TableHead>
                      <TableHead>ระยะเวลา</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerPOs?.map(po => (
                      <TableRow key={po.id} className="cursor-pointer hover:bg-muted/5" onClick={() => router.push(`/purchase-orders/${po.id}`)}>
                        <TableCell className="pl-6 font-mono font-bold text-primary">{po.poCode}</TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">{po.title}</span>
                            <span className="text-[10px] text-muted-foreground uppercase">{po.projectName}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-[10px]">
                          {formatDateRangeThaiBE(po.startDate, po.endDate)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={po.status === 'active' ? 'default' : 'secondary'} className={po.status === 'active' ? 'bg-green-600 text-white border-none' : ''}>{po.status.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="แก้ไข"
                              onClick={(e) => { e.stopPropagation(); router.push(`/purchase-orders/${po.id}`); }}>
                              <Pencil className="h-4 w-4 text-primary" />
                            </Button>
                            {isBizExecutive && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="ลบ"
                                onClick={(e) => handleDeletePO(po.id, e)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!customerPOs || customerPOs.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">ไม่พบใบสั่งซื้อ</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Portal Access Tab */}
          <TabsContent value="portal" className="mt-6 space-y-6">
            {!isBizExecutive && (
              <Alert className="bg-amber-50 border-amber-200">
                <Info className="h-4 w-4 text-amber-700" />
                <AlertTitle className="text-amber-800">ต้องใช้สิทธิ์ผู้บริหารระบบหรือหัวหน้าปฏิบัติการ</AlertTitle>
                <AlertDescription className="text-amber-700">
                  การเพิ่ม/เปิดใช้งานบัญชีลูกค้า ต้องทำโดย System Admin หรือผู้บริหารกลุ่มปฏิบัติการ (เช่น Operations Manager)
                  เพื่อให้ผู้ใช้ใหม่ได้รับ customerId และสิทธิ์ client_user ครบถ้วน
                </AlertDescription>
              </Alert>
            )}
            <PageGuidance 
              title="การจัดการสิทธิ์ลูกค้า (Customer Portal Guidance)"
              tips={[
                "คุณสามารถสร้างบัญชีผู้ใช้ให้พนักงานฝั่งลูกค้าเพื่อเข้าดูสัญญา PO กำลังพล timesheet และเอกสารการเงิน — พอร์ทัลออกแบบให้เรียบง่าย สลับ EN/TH ได้",
                "บัญชี 'Approver' อนุมัติ billing บนใบแจ้งหนี้ (commercial invoice) — 'Viewer' ดูได้อย่างเดียว — กดปุ่ม แก้ไข ในรายการเมื่อลูกค้าเปลี่ยนผู้รับผิดชอบ/ตำแหน่ง",
                "อีเมลรีเซ็ตรหัสจาก Firebase — ถ้าไม่เข้า inbox ให้เช็กสแปม และใน Firebase Console → Authentication → Settings → Authorized domains ต้องมีโดเมนที่ใช้รันแอป (เช่น localhost:9003 ตอนพัฒนา)",
                "สิทธิ์จำกัดตาม Customer ID ของบริษัทนี้เท่านั้น — หลังสร้างบัญชีระบบจะพยายามส่งลิงก์ตั้งรหัสไปที่อีเมลลูกค้า (แจ้งรหัสชั่วคราวใน toast เป็นสำรอง)",
                "EN: Use Edit on each row for name + Approver/Viewer; password reset uses Firebase email — check spam & Authorized domains.",
              ]}
            />

            <Card className="shadow-md border-none overflow-hidden">
              <CardHeader className="bg-primary/5 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 text-primary">
                    <Lock className="h-5 w-5 text-primary" /> บัญชีผู้ใช้งานระบบลูกค้า (Customer Accounts)
                  </CardTitle>
                  <CardDescription className="space-y-1">
                    <span className="block">จัดการการเข้าถึงระบบ Customer Portal สำหรับบริษัทนี้</span>
                    <span className="block text-xs text-muted-foreground">
                      Use this tab to issue usernames (email) and roles — Approver / Viewer — for this company&apos;s portal.
                    </span>
                  </CardDescription>
                </div>
                <Dialog open={isProvisioningOpen} onOpenChange={setIsProvisioningOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2 h-10 px-6 bg-primary font-bold shadow-sm" disabled={!isBizExecutive}>
                      <UserPlus className="h-4 w-4" /> สร้างบัญชีลูกค้าใหม่
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>สร้างบัญชี Customer Portal</DialogTitle>
                      <DialogDescription>ระบุข้อมูลเจ้าหน้าที่ฝั่งลูกค้าเพื่อออกสิทธิ์การเข้าใช้งาน</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label className="font-bold">ชื่อแสดงผล (Contact Name)</Label>
                        <Input 
                          placeholder="เช่น คุณสมชาย (PTT Representative)" 
                          value={newPortalUser.displayName} 
                          onChange={e => setNewPortalUser({...newPortalUser, displayName: e.target.value})} 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">อีเมลเข้าใช้งาน (Login Email)</Label>
                        <Input 
                          type="email" 
                          placeholder="customer@company.com" 
                          value={newPortalUser.email} 
                          onChange={e => setNewPortalUser({...newPortalUser, email: e.target.value})} 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold">บทบาทในพอร์ทัล (Portal Role)</Label>
                        <Select 
                          value={newPortalUser.portalRole} 
                          onValueChange={(v: any) => setNewPortalUser({...newPortalUser, portalRole: v})}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="viewer">Viewer (ดูข้อมูลได้อย่างเดียว)</SelectItem>
                            <SelectItem value="approver">Approver (มีอำนาจอนุมัติงาน/เวลา)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsProvisioningOpen(false)} disabled={isSubmitting}>ยกเลิก</Button>
                      <Button onClick={handleProvisionPortalUser} className="bg-primary font-bold shadow-md" disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                        ยืนยันการสร้างบัญชี
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog open={isPortalEditOpen} onOpenChange={(open) => { setIsPortalEditOpen(open); if (!open) setPortalEditUser(null); }}>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>แก้ไขบัญชีพอร์ทัลลูกค้า</DialogTitle>
                      <DialogDescription>
                        ปรับชื่อที่แสดงและบทบาท Viewer/Approver เมื่อลูกค้าเปลี่ยนผู้รับผิดชอบ — อีเมลล็อกอินแก้ไขไม่ได้จากที่นี่ (ต้องใช้ Firebase Auth ระดับผู้ดูแลระบบ)
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        <Label>อีเมล (Login ID)</Label>
                        <Input value={portalEditUser?.email || ''} disabled className="bg-muted/50" />
                      </div>
                      <div className="space-y-2">
                        <Label>ชื่อแสดงผล</Label>
                        <Input
                          value={portalEditDisplayName}
                          onChange={(e) => setPortalEditDisplayName(e.target.value)}
                          placeholder="ชื่อผู้ติดต่อ / ตำแหน่ง"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>บทบาทพอร์ทัล</Label>
                        <Select value={portalEditRole} onValueChange={(v) => setPortalEditRole(v as PortalRole)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="viewer">Viewer (ดูข้อมูล)</SelectItem>
                            <SelectItem value="approver">Approver (อนุมัติ billing / รายการที่เปิดใช้)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsPortalEditOpen(false)} disabled={isPortalEditSaving}>
                        ยกเลิก
                      </Button>
                      <Button onClick={() => void handleSavePortalUserEdit()} disabled={isPortalEditSaving}>
                        {isPortalEditSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        บันทึก
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 py-4">ชื่อผู้ใช้งาน</TableHead>
                      <TableHead>อีเมล (Login ID)</TableHead>
                      <TableHead>บทบาท (Role)</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right pr-6">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {portalUsers?.map(user => (
                      <TableRow key={user.id} className="hover:bg-muted/20">
                        <TableCell className="pl-6 font-bold text-primary">{user.displayName}</TableCell>
                        <TableCell className="text-xs font-medium">{user.email}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize bg-blue-50 text-blue-700 border-blue-200 text-[10px] font-bold">
                            {user.portalRole || 'viewer'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={user.isActive ? "bg-green-600 text-white border-none" : "bg-slate-300"}>
                            {user.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end flex-wrap gap-1">
                            {canEditCustomers && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1 text-xs"
                                onClick={() => openPortalUserEdit(user)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                แก้ไข
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="ส่งลิงก์รีเซ็ตรหัสทางอีเมล"
                              disabled={!canEditCustomers}
                              onClick={() => void handleSendPortalPasswordReset(user)}
                            >
                              <KeyRound className="h-4 w-4 text-primary" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              className={`h-8 w-8 ${user.isActive ? "text-destructive" : "text-green-600"}`}
                              onClick={() => handleToggleActive(user)}
                              title={user.isActive ? 'ระงับการใช้งาน' : 'เปิดการใช้งาน'}
                            >
                              {user.isActive ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                            </Button>
                            {isBizExecutive && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="ลบบัญชี"
                                onClick={() => handleDeletePortalUser(user.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!portalUsers || portalUsers.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-20 text-muted-foreground italic">
                          ยังไม่มีบัญชีผู้ใช้งานระบบลูกค้าสำหรับบริษัทนี้
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
