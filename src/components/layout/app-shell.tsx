
'use client';

import * as React from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { SidebarNav } from './sidebar-nav';
import { User } from '@/lib/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { LogOut, Shield, AlertTriangle, Info, Settings2, Building2 } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useAuth } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { usePermissionProfiles } from '@/hooks/use-permission-profiles';
import { signOut } from 'firebase/auth';
import { getEffectiveDepartment, getEffectiveLevel } from '@/lib/auth-mapping';
import { isSystemAdmin } from '@/lib/permission-core';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface AppShellProps {
  children: React.ReactNode;
  user: User | null;
  onLogout: () => void;
}

export function AppShell({ children, user, onLogout }: AppShellProps) {
  const firestore = useFirestore();
  const auth = useAuth();
  const router = useRouter();

  const { profiles, isLoading: isProfilesLoading } = usePermissionProfiles(user);

  const profileKeys = React.useMemo(() => {
    if (!user) return [] as string[];
    const keys = user.permissionProfileKeys || [];
    if (user.permissionProfileKey && !keys.includes(user.permissionProfileKey)) {
      return [...keys, user.permissionProfileKey];
    }
    return keys;
  }, [user]);

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
  const isAdmin = isSystemAdmin(user);
  
  const isLegacy = !user.permissionProfileKeys || user.permissionProfileKeys.length === 0;
  const isProfileMissing = profileKeys.length > 0 && !isProfilesLoading && (!profiles || profiles.length === 0);
  const isContextMissing = !user.department || !user.level;

  // Primary profile identification for simple display
  const primaryProfile = profiles?.find(p => p.profileKey === user.permissionProfileKey) || profiles?.[0];

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
              {/* Discrete System Admin Utilities */}
              {isAdmin && (
                <div className="flex items-center gap-2 mr-2">
                  {(isLegacy || isProfileMissing || isContextMissing) && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-amber-600 hover:bg-amber-50"
                            onClick={() => router.push('/system-admin/permission-audit')}
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[300px]">
                          <div className="space-y-2 p-1">
                            <p className="font-bold text-xs flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> System Migration Status</p>
                            <div className="text-[10px] space-y-1">
                              {isLegacy && <p>• บัญชีนี้ใช้สิทธิ์รูปแบบเดิม (Legacy Mode)</p>}
                              {isProfileMissing && <p>• ไม่พบเอกสาร Profile Matrix ในฐานข้อมูล</p>}
                              {isContextMissing && <p>• ข้อมูลแผนกหรือระดับไม่สมบูรณ์</p>}
                            </div>
                            <p className="text-[9px] text-muted-foreground italic border-t pt-1 mt-1">คลิกเพื่อไปยังหน้าตรวจสอบสิทธิ์</p>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              )}

              <div className="hidden md:flex flex-col items-end max-w-[250px]">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black truncate text-primary">{user.displayName}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tighter flex items-center gap-1">
                    <Building2 className="h-2.5 w-2.5" /> {dept} / {level}
                  </span>
                  {primaryProfile && (
                    <Badge variant="secondary" className="text-[9px] h-4 py-0 px-1 bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1 font-black">
                      <Shield className="h-2.5 w-2.5" /> {primaryProfile.profileNameEn}
                      {profiles && profiles.length > 1 && <span className="ml-0.5 opacity-60">+{profiles.length - 1}</span>}
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
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
