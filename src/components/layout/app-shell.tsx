'use client';

import * as React from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { SidebarNav } from './sidebar-nav';
import { User, PermissionProfile } from '@/lib/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { LogOut, Shield, Sparkles } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { getEffectiveDepartment, getEffectiveLevel } from '@/lib/auth-mapping';
import { useRouter } from 'next/navigation';
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

interface AppShellProps {
  children: React.ReactNode;
  user: User | null;
  onLogout: () => void;
}

export function AppShell({ children, user, onLogout }: AppShellProps) {
  const firestore = useFirestore();
  const router = useRouter();

  const profileRef = useMemoFirebase(() => {
    if (!firestore || !user?.permissionProfileKey) return null;
    return doc(firestore, 'permission_profiles', user.permissionProfileKey);
  }, [firestore, user?.permissionProfileKey]);

  const { data: profile } = useDoc<PermissionProfile>(profileRef as any);

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
    
    localStorage.removeItem('opsflow_user');
    if (onLogout) onLogout();
    router.push('/');
  };

  if (!user) return <>{children}</>;

  const dept = getEffectiveDepartment(user);
  const level = getEffectiveLevel(user);
  
  const isLegacy = !user.permissionProfileKey;

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <SidebarNav user={user} profile={profile} />
        <SidebarInset>
          <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b bg-card/95 px-4 backdrop-blur transition-[width,height] ease-linear">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <div className="h-4 w-px bg-border mx-2" />
              <h1 className="font-semibold text-foreground hidden sm:inline-block">ระบบจัดการกำลังคน (OpsFlow)</h1>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden md:flex flex-col items-end max-w-[250px]">
                <div className="flex items-center gap-2">
                  {isLegacy && (
                    <Badge variant="outline" className="text-[8px] h-4 px-1.5 bg-amber-50 text-amber-700 border-amber-200">
                      Legacy Access
                    </Badge>
                  )}
                  <span className="text-sm font-bold truncate">{user.displayName}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground uppercase font-medium">
                    {dept} / {level}
                  </span>
                  {profile && (
                    <Badge variant="secondary" className="text-[9px] h-4 py-0 px-1 bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1">
                      <Shield className="h-2 w-2" /> {profile.profileNameEn}
                    </Badge>
                  )}
                </div>
              </div>
              <Avatar className="h-8 w-8 ring-2 ring-primary/10">
                <AvatarFallback className="bg-primary text-primary-foreground font-bold">
                  {user.displayName.charAt(0)}
                </AvatarFallback>
              </Avatar>
              
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" title="ออกจากระบบ" className="hover:bg-destructive/10 hover:text-destructive">
                    <LogOut className="h-5 w-5" />
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
          <main className="flex-1 p-6">
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}