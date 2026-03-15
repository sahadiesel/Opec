
'use client';

import * as React from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { SidebarNav } from './sidebar-nav';
import { User } from '@/lib/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { useFirestore } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { getEffectiveDepartment, getEffectiveLevel } from '@/lib/auth-mapping';
import { useRouter } from 'next/navigation';
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
    
    // Clear global session
    localStorage.removeItem('opsflow_user');
    
    // Call the provided onLogout callback (to clear local state if applicable)
    if (onLogout) {
      onLogout();
    }
    
    // Redirect to home/login page
    router.push('/');
  };

  if (!user) return <>{children}</>;

  const dept = getEffectiveDepartment(user);
  const level = getEffectiveLevel(user);
  
  const deptDisplay = dept.toUpperCase();
  const levelDisplay = level.toUpperCase();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <SidebarNav userDept={dept} userLevel={level} />
        <SidebarInset>
          <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b bg-card/95 px-4 backdrop-blur transition-[width,height] ease-linear">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <div className="h-4 w-px bg-border mx-2" />
              <h1 className="font-semibold text-foreground">ระบบจัดการกำลังคน (OpsFlow)</h1>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden md:flex flex-col items-end max-w-[200px]">
                <span className="text-sm font-medium truncate w-full text-right">{user.displayName}</span>
                <span className="text-[10px] text-muted-foreground uppercase truncate w-full text-right">
                  {deptDisplay} / {levelDisplay}
                </span>
              </div>
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {user.displayName.charAt(0)}
                </AvatarFallback>
              </Avatar>
              
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" title="ออกจากระบบ">
                    <LogOut className="h-5 w-5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>ยืนยันการออกจากระบบ</AlertDialogTitle>
                    <AlertDialogDescription>
                      คุณต้องการออกจากระบบใช่หรือไม่?
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
