
'use client';

import * as React from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { SidebarNav } from './sidebar-nav';
import { User, type AccessLevel, type DeptType } from '@/lib/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { LogOut, Shield, Building2 } from 'lucide-react';
import { useFirestore, useAuth } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { usePermissionProfiles, getEffectivePermissionProfileKey } from '@/hooks/use-permission-profiles';
import { signOut } from 'firebase/auth';
import { getEffectiveDepartment, getEffectiveLevel, deriveBusinessRoleKey, BUSINESS_ROLES } from '@/lib/auth-mapping';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { userMayAccessPath } from '@/lib/navigation/nav-access';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const ROLE_DEPT_LABEL_TH: Record<DeptType, string> = {
  admin: 'ผู้ดูแลระบบ',
  hr: 'งานบุคคล',
  sales: 'งานขายและสัญญา',
  operations: 'งานปฏิบัติการ',
  accounting: 'บัญชีและการเงิน',
  store: 'คลัง / จัดซื้อ',
  client: 'ลูกค้า',
};

const ROLE_LEVEL_LABEL_TH: Record<AccessLevel, string> = {
  admin: 'ผู้ดูแลระบบ',
  manager: 'ผู้จัดการ',
  officer: 'เจ้าหน้าที่',
  viewer: 'ผู้ดู',
};

interface AppShellProps {
  children: React.ReactNode;
  user: User | null;
  onLogout: () => void;
}

export function AppShell({ children, user, onLogout }: AppShellProps) {
  const firestore = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const { profiles } = usePermissionProfiles(user);
  const permissionProfile = profiles?.[0] ?? null;
  const routeAllowed = user ? userMayAccessPath(user, permissionProfile, pathname) : true;

  const handleLogout = async () => {
    if (user && firestore) {
      try {
        await updateDoc(doc(firestore, 'users', user.id), {
          lastLogoutAt: Date.now()
        });
      } catch (error) {
        console.error('Failed to log logout time', error);
      }
    }
    
    try {
      await signOut(auth);
    } catch (e) {
      console.error('Failed to sign out from Firebase Auth', e);
    }
    
    localStorage.removeItem('opsflow_user');
    if (onLogout) onLogout();
    router.push('/');
  };

  if (!user) return <>{children}</>;

  const dept = getEffectiveDepartment(user);
  const level = getEffectiveLevel(user);
  const resolvedRoleKey = deriveBusinessRoleKey(user);
  const roleLine = BUSINESS_ROLES[resolvedRoleKey];

  // Primary profile identification for simple display (canonical doc id vs legacy casing on user doc)
  const effectiveProfileKey = getEffectivePermissionProfileKey(user);
  const primaryProfile =
    (effectiveProfileKey && profiles?.find((p) => p.profileKey === effectiveProfileKey)) || profiles?.[0];

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <SidebarNav user={user} profiles={profiles} />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b bg-card/95 px-4 backdrop-blur transition-[width,height] ease-linear">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <div className="h-4 w-px bg-border mx-2" />
              <div className="flex flex-col">
                <h1 className="font-bold text-foreground hidden sm:inline-block leading-tight">OPEC OpsFlow</h1>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Enterprise Manpower Management</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="hidden md:flex flex-col items-end max-w-[250px]">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black truncate text-primary">{user.displayName}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-muted-foreground font-bold tracking-tighter flex items-center gap-1 max-w-[220px] justify-end text-right leading-tight">
                    <Building2 className="h-2.5 w-2.5 shrink-0" />
                    <span className="normal-case">
                      {roleLine ? (
                        <>
                          <span className="text-foreground font-semibold">{roleLine.labelTh}</span>
                          <span className="text-muted-foreground font-medium"> · {roleLine.labelEn}</span>
                          <span className="block text-[8px] text-muted-foreground font-bold mt-0.5 tracking-wide normal-case">
                            {ROLE_DEPT_LABEL_TH[roleLine.dept] ?? roleLine.dept} ·{' '}
                            {ROLE_LEVEL_LABEL_TH[roleLine.level] ?? roleLine.level}
                          </span>
                        </>
                      ) : (
                        <span className="uppercase">
                          {ROLE_DEPT_LABEL_TH[dept] ?? dept} / {ROLE_LEVEL_LABEL_TH[level] ?? level}
                        </span>
                      )}
                    </span>
                  </span>
                  {(roleLine || primaryProfile) && (
                    <Badge
                      variant="secondary"
                      title={roleLine?.labelEn ?? primaryProfile?.profileNameEn}
                      className="text-[9px] h-4 py-0 px-1.5 bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1 font-black max-w-[200px]"
                    >
                      <Shield className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">
                        {roleLine?.labelTh ?? primaryProfile?.profileNameTh ?? 'ผู้ใช้งาน'}
                      </span>
                      {profiles && profiles.length > 1 && (
                        <span className="ml-0.5 shrink-0 opacity-60">+{profiles.length - 1}</span>
                      )}
                    </Badge>
                  )}
                </div>
              </div>
              
              <Avatar className="h-9 w-9 ring-2 ring-primary/10 border-2 border-white shadow-sm">
                <AvatarFallback className="bg-primary text-primary-foreground font-black text-xs">
                  {user.displayName.charAt(0)}
                </AvatarFallback>
              </Avatar>
              
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" title="ออกจากระบบ" className="h-9 w-9 rounded-full hover:bg-destructive/10 hover:text-destructive">
                    <LogOut className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>ยืนยันการออกจากระบบ</AlertDialogTitle>
                    <AlertDialogDescription>
                      คุณต้องการออกจากระบบ OpsFlow ใช่หรือไม่?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={handleLogout}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      ตกลง
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </header>
          <main className="min-w-0 flex-1 p-6">
            {!routeAllowed ? (
              <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-20 text-center">
                <p className="text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงหน้านี้</p>
                <Button asChild variant="default">
                  <Link href="/">กลับแดชบอร์ด</Link>
                </Button>
              </div>
            ) : (
              children
            )}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
