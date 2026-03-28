'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ShieldCheck, 
  Search, 
  Filter, 
  Lock, 
  Building2, 
  UserCheck, 
  AlertTriangle, 
  Loader2, 
  ChevronRight,
  Mail,
  Clock,
  KeyRound,
  UserPlus,
  UserCog,
  RefreshCw
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { User, Customer, BusinessRoleKey } from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, orderBy, doc, writeBatch } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { isAdminUser, getMigratedUserFields } from '@/lib/auth-mapping';
import { PageGuidance } from '@/components/layout/page-guidance';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDateTimeThaiBE } from '@/lib/date-thai';

export default function CustomerPortalAdminPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [isRepairing, setIsRepairing] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isUserAdmin = useMemo(() => isAdminUser(currentUser), [currentUser]);

  // Queries
  const portalUsersQuery = useMemoFirebase(() => {
    if (!firestore || !isUserAdmin) return null;
    return query(collection(firestore, 'users'), where('userType', '==', 'customer_portal'), orderBy('createdAt', 'desc'));
  }, [firestore, isUserAdmin]);
  const { data: portalUsers, isLoading: isUsersLoading } = useCollection<User>(portalUsersQuery as any);

  const customersQuery = useMemoFirebase(() => (firestore ? collection(firestore, 'customers') : null), [firestore]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const filteredUsers = useMemo(() => {
    if (!portalUsers) return [];
    return portalUsers.filter(u => {
      const name = u.displayName || '';
      const email = u.email || '';
      const customer = customers?.find(c => c.id === u.customerId)?.name || '';
      
      const combined = `${name} ${email} ${customer}`.toLowerCase();
      return combined.includes(searchTerm.toLowerCase());
    });
  }, [portalUsers, customers, searchTerm]);

  const handleRepairAllPortal = async () => {
    if (!firestore || !portalUsers) return;
    setIsRepairing(true);
    const batch = writeBatch(firestore);
    
    try {
      portalUsers.forEach(u => {
        const fields = getMigratedUserFields(u);
        batch.update(doc(firestore, 'users', u.id), fields);
      });
      await batch.commit();
      toast({ title: "Portal Roles Repaired", description: `Updated ${portalUsers.length} portal accounts.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Repair Failed", description: e.message });
    } finally {
      setIsRepairing(false);
    }
  };

  if (isUserLoading || !currentUser) return null;

  if (!isUserAdmin) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldCheck className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Restricted</h2>
          <p className="text-muted-foreground">Only system administrators can manage portal accounts.</p>
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
              <Lock className="h-8 w-8 text-primary" /> จัดการพอร์ทัลลูกค้า (Customer Portal Management)
            </h1>
            <p className="text-muted-foreground text-lg italic">
              ควบคุมการเข้าถึงระบบสำหรับลูกค้าภายนอก และตรวจสอบสถานะบัญชีรายบริษัท (Portal security and access control).
            </p>
          </div>
          <Button variant="outline" className="gap-2 h-11 border-primary text-primary font-bold" onClick={handleRepairAllPortal} disabled={isRepairing}>
            {isRepairing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync All Portal Roles
          </Button>
        </div>

        <PageGuidance 
          title="ความปลอดภัยของข้อมูลลูกค้า (Data Isolation Policy)"
          tips={[
            "บัญชีประเภทพอร์ทัลลูกค้าจะถูกจำกัดสิทธิ์ (Sandboxed) ให้เห็นเฉพาะข้อมูลใน Customer ID ของตนเองเท่านั้น",
            "การกำหนดสิทธิ์ไม่ต้องใช้ Profile Matrix รายบุคคล แต่จะใช้ Template อัตโนมัติตาม Portal Role (Approver/Viewer)",
            "หากต้องการแก้ไขข้อมูลบริษัทหรือผู้ติดต่อหลัก ให้ไปที่เมนู 'ทะเบียนลูกค้า' (Customers Directory)"
          ]}
        />

        <div className="flex items-center gap-3 bg-card p-4 rounded-lg border shadow-sm">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="ค้นหาตามชื่อผู้ใช้, อีเมล หรือชื่อบริษัท..." 
              className="pl-9 h-11" 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <Button variant="outline" className="h-11 gap-2"><Filter className="h-4 w-4" /> ตัวกรอง</Button>
        </div>

        <Card className="shadow-lg border-none overflow-hidden">
          <CardContent className="p-0">
            {isUsersLoading ? (
              <div className="py-20 text-center animate-pulse italic">กำลังดึงข้อมูลบัญชีลูกค้า...</div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6 py-4 font-bold">ชื่อผู้ใช้ (Contact Name)</TableHead>
                    <TableHead className="font-bold">บริษัทลูกค้า (Customer)</TableHead>
                    <TableHead className="font-bold">สิทธิ์การใช้งาน (Role)</TableHead>
                    <TableHead className="font-bold">สถานะ</TableHead>
                    <TableHead className="font-bold">เข้าสู่ระบบครั้งสุดท้าย</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => {
                    const customer = customers?.find(c => c.id === u.customerId);
                    return (
                      <TableRow key={u.id} className="hover:bg-muted/20 transition-all group">
                        <TableCell className="pl-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-primary">{u.displayName}</span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-medium">
                              <Mail className="h-2.5 w-2.5" /> {u.email}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm font-semibold">{customer?.name || 'Unknown Company'}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize bg-blue-50 text-blue-700 border-blue-200 text-[10px] font-bold">
                            {u.portalRole || 'viewer'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={u.isActive ? "bg-green-600" : "bg-slate-300"}>
                            {u.isActive ? 'ACTIVE' : 'INACTIVE'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {u.lastLoginAt ? formatDateTimeThaiBE(u.lastLoginAt) : 'ไม่เคยเข้าใช้งาน'}
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" title="Edit Access" className="opacity-0 group-hover:opacity-100" onClick={() => router.push('/users')}>
                              <UserCog className="h-4 w-4 text-primary" />
                            </Button>
                            <Button variant="ghost" size="sm" className="gap-2 group-hover:text-primary" asChild>
                              <Link href={`/customers/${u.customerId}`}>
                                ดูบริษัท <ChevronRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredUsers.length === 0 && !isUsersLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-20 text-muted-foreground italic">
                        ไม่พบข้อมูลบัญชีผู้ใช้ระบบลูกค้า
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
