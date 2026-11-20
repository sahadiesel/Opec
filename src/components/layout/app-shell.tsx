
'use client';

import * as React from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { companyNavBarStyle, COMPANY_NAV_BAR_HEIGHT } from '@/components/company-site/nav-bar-style';
import { SidebarNav } from './sidebar-nav';
import { User } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { LogOut, Shield, Mail } from 'lucide-react';
import { useFirestore, useAuth } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { usePermissionProfiles, getEffectivePermissionProfileKey } from '@/hooks/use-permission-profiles';
import { signOut } from 'firebase/auth';
import { markFirestoreLoggingOut } from '@/firebase/firestore/suppress-logout-permission-error';
import { deriveBusinessRoleKey, BUSINESS_ROLES } from '@/lib/auth-mapping';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { userMayAccessPath } from '@/lib/navigation/nav-access';
import { isClient } from '@/lib/permissions';
import { fixExecutiveSpelling } from '@/lib/executive-display-fix';
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

/** Z.com SmarterMail webmail (opec.co.th) — open in new tab; login is separate from OpsFlow. */
const COMPANY_WEBMAIL_URL = 'https://mailpro-04.zth.netdesignhost.com';

function OpsFlowTopBar({
  user,
  profiles,
  onLogout,
}: {
  user: User;
  profiles: { profileKey?: string; profileNameEn?: string; profileNameTh?: string }[] | null;
  onLogout: () => void;
}) {
  const { state, isMobile } = useSidebar();
  const patternOffset = isMobile
    ? '0px'
    : state === 'collapsed'
      ? 'calc(var(--sidebar-width-icon) * -1)'
      : 'calc(var(--sidebar-width) * -1)';

  const resolvedRoleKey = deriveBusinessRoleKey(user);
  const roleLine = BUSINESS_ROLES[resolvedRoleKey];
  const effectiveProfileKey = getEffectivePermissionProfileKey(user);
  const primaryProfile =
    (effectiveProfileKey && profiles?.find((p) => p.profileKey === effectiveProfileKey)) || profiles?.[0];

  return (
    <header
      className="sticky top-0 z-30 flex shrink-0 items-center justify-between px-4 shadow-[0_4px_15px_rgba(11,25,44,0.08)]"
      style={{ ...companyNavBarStyle(patternOffset), height: COMPANY_NAV_BAR_HEIGHT }}
    >
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <div className="mx-2 h-4 w-px bg-border" />
        <div className="flex flex-col">
          <h1 className="hidden text-[26px] font-bold leading-tight text-[#1a56c4] sm:inline-block">
            Offshore Power Engineering Corporation Co.,Ltd.
          </h1>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Enterprise Manpower Management
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden max-w-[220px] flex-col items-end md:flex">
          <span className="truncate text-sm font-black text-primary">{fixExecutiveSpelling(user.displayName)}</span>
          {(roleLine || primaryProfile) && (
            <Badge
              variant="secondary"
              title={roleLine?.labelEn ?? primaryProfile?.profileNameEn}
              className="mt-0.5 flex h-4 max-w-[200px] items-center gap-1 border-blue-100 bg-blue-50 px-1.5 py-0 text-[9px] font-black text-blue-700"
            >
              <Shield className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{roleLine?.labelTh ?? primaryProfile?.profileNameTh ?? 'ผู้ใช้งาน'}</span>
              {profiles && profiles.length > 1 && <span className="ml-0.5 shrink-0 opacity-60">+{profiles.length - 1}</span>}
            </Badge>
          )}
        </div>

        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-full text-orange-600 hover:bg-orange-50 hover:text-orange-700"
        >
          <a
            href={COMPANY_WEBMAIL_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="เปิดอีเมลบริษัท (Webmail)"
            aria-label="เปิดอีเมลบริษัท"
          >
            <Mail className="h-7 w-7" />
          </a>
        </Button>

        <Avatar className="h-[72px] w-[72px] border-2 border-white shadow-sm ring-2 ring-primary/10">
          {user.profilePhotoUrl ? <AvatarImage src={user.profilePhotoUrl} alt="" className="object-cover" /> : null}
          <AvatarFallback className="bg-primary text-2xl font-black text-primary-foreground">
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
              <AlertDialogDescription>คุณต้องการออกจากระบบ OpsFlow ใช่หรือไม่?</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction onClick={onLogout} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                ตกลง
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </header>
  );
}

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
    markFirestoreLoggingOut();
    localStorage.removeItem('opsflow_user');

    if (user && firestore) {
      // updateDoc resolves only on server ack — on slow mobile networks that can stall sign-out indefinitely.
      const write = updateDoc(doc(firestore, 'users', user.id), {
        lastLogoutAt: Date.now(),
      }).catch(() => {
        /* ignore during logout */
      });
      await Promise.race([write, new Promise((resolve) => setTimeout(resolve, 1500))]);
    }

    router.push('/ops');

    try {
      await signOut(auth);
    } catch (e) {
      console.error('Failed to sign out from Firebase Auth', e);
    }

    if (onLogout) onLogout();
  };

  if (!user) return <>{children}</>;

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <SidebarNav user={user} profiles={profiles} />
        <SidebarInset className="min-w-0">
          <OpsFlowTopBar user={user} profiles={profiles} onLogout={handleLogout} />
          <main className="min-w-0 flex-1 p-6">
            {!routeAllowed ? (
              <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-20 text-center">
                <p className="text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึงหน้านี้</p>
                <Button asChild variant="default">
                  <Link href={isClient(user) ? '/client-portal/dashboard' : '/ops'}>
                    {isClient(user) ? 'ไปพอร์ทัลลูกค้า' : 'กลับแดชบอร์ด'}
                  </Link>
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
