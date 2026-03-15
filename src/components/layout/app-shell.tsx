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

interface AppShellProps {
  children: React.ReactNode;
  user: User | null;
  onLogout: () => void;
}

export function AppShell({ children, user, onLogout }: AppShellProps) {
  const firestore = useFirestore();

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
    onLogout();
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
              <Button variant="ghost" size="icon" onClick={handleLogout}>
                <LogOut className="h-5 w-5" />
              </Button>
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
