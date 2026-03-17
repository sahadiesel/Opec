'use client';

import * as React from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { SidebarNav } from './sidebar-nav';
import { User, PermissionProfile } from '@/lib/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { LogOut, Shield, AlertTriangle, Info, Settings2 } from 'lucide-react';
import { useFirestore, useDoc, useMemoFirebase, useAuth } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { getEffectiveDepartment, getEffectiveLevel, isAdminUser } from '@/lib/auth-mapping';
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

  const profileRef = useMemoFirebase(() => {
    if (!firestore || !user?.permissionProfileKey) return null;
    return doc(firestore, 'permission_profiles', user.permissionProfileKey);
  }, [firestore, user?.permissionProfileKey]);

  const { data: profile, isLoading: isProfileLoading } = useDoc<PermissionProfile>(profileRef as any);

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
  const isAdmin = isAdminUser(user);
  
  const isLegacy = !user.permissionProfileKey;
  const isProfileMissing = user.permissionProfileKey && !isProfileLoading && !profile;
  const isContextMissing = !user.department || !user.level;

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <SidebarNav user={user} profile={profile} />
        <SidebarInset>
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
                      <Tooltip shadow-md>
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
                  <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tighter">
                    {dept} / {level}
                  </span>
                  {profile && (
                    <Badge variant="secondary" className="text-[9px] h-4 py-0 px-1 bg-blue-50 text-blue-700 border-blue-100 flex items-center gap-1">
                      <Shield className="h-2 w-2" /> {profile.profileNameEn}
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
          <main className="flex-1 p-6">
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}