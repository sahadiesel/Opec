
'use client';

import { useState, useEffect, useMemo } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  SearchCheck, 
  AlertTriangle, 
  ShieldAlert, 
  UserCheck, 
  CheckCircle2, 
  XCircle, 
  Info,
  ChevronRight,
  Filter,
  Users,
  Shield,
  Search,
  ArrowRight,
  ExternalLink,
  History,
  Lock,
  Download,
  Zap,
  RefreshCw
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { 
  User, 
  PermissionProfile, 
  ModulePermission,
  DeptType,
  AccessLevel
} from '@/lib/types';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isAdminUser, inferDeptAndLevel } from '@/lib/auth-mapping';
import { getPermissions, SYSTEM_MODULES, NO_ACCESS } from '@/lib/permissions';
import { getEffectivePermissionProfileKey } from '@/hooks/use-permission-profiles';
import { useRouter } from 'next/navigation';

export default function PermissionAuditPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const firestore = useFirestore();

  // Navigation state
  const [activeTab, setActiveTab] = useState('users');

  // Filters state
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [problemOnly, setProblemOnly] = useState(false);

  // Explorer state
  const [explorerType, setExplorerType] = useState<'user' | 'profile'>('user');
  const [selectedExplorerId, setSelectedExplorerId] = useState<string>('');

  useEffect(() => {
    const stored = localStorage.getItem('opsflow_user');
    if (stored) setCurrentUser(JSON.parse(stored));
  }, []);

  const isUserAdmin = useMemo(() => isAdminUser(currentUser), [currentUser]);

  // Queries
  const usersQuery = useMemoFirebase(() => {
    if (!firestore || !isUserAdmin) return null;
    return collection(firestore, 'users');
  }, [firestore, isUserAdmin]);
  const { data: users, isLoading: isUsersLoading } = useCollection<User>(usersQuery as any);

  const profilesQuery = useMemoFirebase(() => {
    if (!firestore || !isUserAdmin) return null;
    return query(collection(firestore, 'permission_profiles'), orderBy('profileKey', 'asc'));
  }, [firestore, isUserAdmin]);
  const { data: profiles, isLoading: isProfilesLoading } = useCollection<PermissionProfile>(profilesQuery as any);

  // Computed data
  const auditData = useMemo(() => {
    if (!users || !profiles) return [];
    
    return users.map(user => {
      const { dept, level } = inferDeptAndLevel(user);
      const effectiveKey = getEffectivePermissionProfileKey(user);
      const matchedProfiles = effectiveKey
        ? profiles.filter((p) => p.profileKey === effectiveKey)
        : [];
      
      let effectiveSummary = 'Missing Profile';
      let status: 'ok' | 'warning' | 'error' = 'warning';
      let badges: string[] = [];

      if (isAdminUser(user)) {
        effectiveSummary = 'Admin (Bypass)';
        status = 'ok';
        badges.push('Admin Bypass');
      } else if (effectiveKey) {
        if (matchedProfiles.length > 0) {
          effectiveSummary = 'Profile bound';
          status = 'ok';
          if (matchedProfiles.some((p) => !p.isActive)) {
            badges.push('Inactive profile');
            status = 'warning';
          }
        } else {
          effectiveSummary = 'Profile Not Found';
          status = 'error';
        }
      } else {
        effectiveSummary = 'Legacy Fallback';
        status = 'warning';
        badges.push('Legacy Fallback');
      }

      return {
        ...user,
        derivedDept: dept,
        derivedLevel: level,
        effectiveSummary,
        status,
        badges,
        profileCount: matchedProfiles.length,
        hasProblems: status !== 'ok'
      };
    });
  }, [users, profiles]);

  const filteredUsers = useMemo(() => {
    return auditData.filter(u => {
      const name = u.displayName || '';
      const email = u.email || '';
      const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           email.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesDept = deptFilter === 'ALL' || u.derivedDept === deptFilter;
      const matchesLevel = levelFilter === 'ALL' || u.derivedLevel === levelFilter;
      const matchesProblem = !problemOnly || u.hasProblems;
      
      return matchesSearch && matchesDept && matchesLevel && matchesProblem;
    });
  }, [auditData, searchTerm, deptFilter, levelFilter, problemOnly]);

  const profileStats = useMemo(() => {
    if (!profiles || !users) return [];
    return profiles.map(p => ({
      ...p,
      userCount: users.filter(u => getEffectivePermissionProfileKey(u) === p.profileKey).length
    }));
  }, [profiles, users]);

  const explorerPermissions = useMemo(() => {
    if (!selectedExplorerId) return null;
    
    if (explorerType === 'user') {
      const user = users?.find(u => u.id === selectedExplorerId);
      if (!user) return null;
      const effectiveKey = getEffectivePermissionProfileKey(user);
      const effectiveProfile =
        effectiveKey && profiles ? profiles.find((p) => p.profileKey === effectiveKey) : undefined;

      const permissions: Record<string, ModulePermission> = {};
      SYSTEM_MODULES.forEach(m => {
        permissions[m.key] = getPermissions(user, m.key as any, effectiveProfile ?? null);
      });
      return permissions;
    } else {
      const profile = profiles?.find(p => p.id === selectedExplorerId);
      return profile?.permissions || null;
    }
  }, [explorerType, selectedExplorerId, users, profiles]);

  if (isUserLoading || !currentUser) return null;

  if (!isUserAdmin) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-50" />
          <h2 className="text-xl font-bold">Access Restricted</h2>
          <p className="text-muted-foreground">Only system administrators can access the permission audit tools.</p>
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
              <SearchCheck className="h-8 w-8 text-primary" /> ตรวจสอบสิทธิ์การใช้งาน (Permission Audit)
            </h1>
            <p className="text-muted-foreground text-lg">ตรวจสอบสิทธิ์การเข้าถึงจริง (effective permission profile — transitional)</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2 h-11" onClick={() => router.push('/system-admin/permission-matrix')}>
              <RefreshCw className="h-4 w-4" /> Go to Matrix Tool
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-4 w-full md:w-[800px] h-auto p-1 bg-muted/50">
            <TabsTrigger value="users" className="gap-2 py-2">1. สรุปรายผู้ใช้ (User Summary)</TabsTrigger>
            <TabsTrigger value="problems" className="gap-2 py-2">2. ตรวจพบความผิดปกติ (Health)</TabsTrigger>
            <TabsTrigger value="profiles" className="gap-2 py-2">3. สรุปโปรไฟล์ (Profiles)</TabsTrigger>
            <TabsTrigger value="explorer" className="gap-2 py-2">4. เครื่องมือตรวจสอบ (Explorer)</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-6 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
              <div className="flex flex-wrap items-center gap-3 flex-1">
                <div className="relative w-full max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Search name or email..." 
                    className="pl-9"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger className="w-[160px]"><SelectValue placeholder="Department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกแผนก</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="hr">HR</SelectItem>
                    <SelectItem value="operations">Operations</SelectItem>
                    <SelectItem value="sales">Sales</SelectItem>
                    <SelectItem value="accounting">Accounting</SelectItem>
                    <SelectItem value="store">Store</SelectItem>
                    <SelectItem value="client">Client</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={levelFilter} onValueChange={setLevelFilter}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Level" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">ทุกระดับ</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="officer">Officer</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button 
                  variant={problemOnly ? "destructive" : "outline"}
                  onClick={() => setProblemOnly(!problemOnly)}
                  className="gap-2"
                >
                  <AlertTriangle className="h-4 w-4" /> ปัญหาสิทธิ์ ({auditData.filter(u => u.hasProblems).length})
                </Button>
              </div>
            </div>

            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0">
                {isUsersLoading ? (
                  <div className="py-20 text-center animate-pulse">Loading Audit Data...</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6 py-4">ผู้ใช้งาน (User)</TableHead>
                        <TableHead>แผนก / ระดับ</TableHead>
                        <TableHead>Profile</TableHead>
                        <TableHead>สิทธิ์การเข้าถึงจริง (Effective Access)</TableHead>
                        <TableHead className="text-right pr-6">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((u) => (
                        <TableRow key={u.id} className="hover:bg-muted/20">
                          <TableCell className="pl-6 py-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-sm text-primary">{u.displayName}</span>
                              <span className="text-[10px] text-muted-foreground">{u.email}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Badge variant="outline" className="text-[9px] capitalize">{u.derivedDept}</Badge>
                              <Badge variant="secondary" className="text-[9px] capitalize">{u.derivedLevel}</Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-mono text-[10px]">{u.profileCount > 0 ? 'bound' : '—'}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-black ${u.status === 'error' ? 'text-red-600' : u.status === 'warning' ? 'text-amber-600' : 'text-green-700'}`}>
                                {u.effectiveSummary}
                              </span>
                              {u.badges.map(b => (
                                <Badge key={b} variant="outline" className="text-[8px] h-4 py-0 px-1 bg-slate-50 text-slate-600">{b}</Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <Button variant="ghost" size="icon" onClick={() => {
                              setExplorerType('user');
                              setSelectedExplorerId(u.id);
                              setActiveTab('explorer');
                            }}>
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="problems" className="mt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="border-l-8 border-l-red-600">
                <CardHeader>
                  <CardTitle className="text-red-700 flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5" /> ตรวจพบจุดเสี่ยง (Security Risks)
                  </CardTitle>
                  <CardDescription>รายการที่ต้องได้รับการแก้ไขเพื่อให้ระบบสิทธิ์สมบูรณ์</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {auditData.filter(u => u.status === 'error').map(u => (
                    <div key={u.id} className="p-3 border rounded-lg bg-red-50 flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-red-900">{u.displayName}</p>
                        <p className="text-xs text-red-700 flex items-center gap-1 font-medium">
                          <AlertTriangle className="h-3 w-3" /> {u.effectiveSummary}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => router.push('/users')}>Fix</Button>
                    </div>
                  ))}
                  {auditData.filter(u => u.status === 'error').length === 0 && (
                    <p className="text-center text-muted-foreground italic py-10">No critical risks detected.</p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-l-8 border-l-amber-500">
                <CardHeader>
                  <CardTitle className="text-amber-700 flex items-center gap-2">
                    <Info className="h-5 w-5" /> Legacy Logic Items
                  </CardTitle>
                  <CardDescription>ผู้ใช้ที่ยังไม่ได้รับการย้ายเข้าสู่โครงสร้างสิทธิ์แบบโปรไฟล์เต็มรูปแบบ</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {auditData.filter(u => u.status === 'warning').map(u => (
                    <div key={u.id} className="p-3 border rounded-lg bg-amber-50 flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-amber-900">{u.displayName}</p>
                        <p className="text-xs text-amber-700">{u.effectiveSummary}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => router.push('/users')}>Update</Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="profiles" className="mt-6 space-y-6">
            <Card className="shadow-lg border-none overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6 py-4">Profile Name</TableHead>
                      <TableHead>Profile Key</TableHead>
                      <TableHead>Dept / Level</TableHead>
                      <TableHead className="text-center">Users</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Updated</TableHead>
                      <TableHead className="text-right pr-6">Explorer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profileStats.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="pl-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-primary">{p.profileNameEn}</span>
                            <span className="text-[10px] text-muted-foreground">{p.profileNameTh}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-primary font-bold">{p.profileKey}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Badge variant="outline" className="text-[9px] uppercase">{p.department}</Badge>
                            <Badge variant="secondary" className="text-[9px] uppercase">{p.level}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={p.userCount > 0 ? "default" : "secondary"}>{p.userCount}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={p.isActive ? "bg-green-600" : "bg-slate-300"}>
                            {p.isActive ? 'ACTIVE' : 'INACTIVE'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">
                          {new Date(p.updatedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" onClick={() => {
                            setExplorerType('profile');
                            setSelectedExplorerId(p.id);
                            setActiveTab('explorer');
                          }}>
                            <SearchCheck className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="explorer" className="mt-6 space-y-6">
            <Card className="shadow-md">
              <CardHeader className="bg-muted/30">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-primary" /> Effective Permissions Explorer</CardTitle>
                    <CardDescription>วิเคราะห์สิทธิ์การเข้าถึงจริงรายโมดูล (จากโปรไฟล์เดียวที่ผูกกับผู้ใช้ — ชั่วคราวจนกว่าจะย้ายเป็น accessGroup)</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Select value={explorerType} onValueChange={(v: any) => {
                      setExplorerType(v);
                      setSelectedExplorerId('');
                    }}>
                      <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User Mode</SelectItem>
                        <SelectItem value="profile">Profile Mode</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    <Select value={selectedExplorerId} onValueChange={setSelectedExplorerId}>
                      <SelectTrigger className="w-[300px]">
                        <SelectValue placeholder={explorerType === 'user' ? "Select User to Audit..." : "Select Profile to Inspect..."} />
                      </SelectTrigger>
                      <SelectContent>
                        {explorerType === 'user' ? (
                          users?.map(u => <SelectItem key={u.id} value={u.id}>{u.displayName} ({u.email})</SelectItem>)
                        ) : (
                          profiles?.map(p => <SelectItem key={p.id} value={p.id}>{p.profileKey} ({p.profileNameEn})</SelectItem>)
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 border-t">
                {!selectedExplorerId ? (
                  <div className="py-20 text-center text-muted-foreground italic">
                    <SearchCheck className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    Select a target above to explore effective permissions
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6 py-3 font-bold text-[10px] uppercase">Module / Capability</TableHead>
                        <TableHead className="text-center font-bold text-[10px] uppercase w-[80px]">View</TableHead>
                        <TableHead className="text-center font-bold text-[10px] uppercase w-[80px]">Create</TableHead>
                        <TableHead className="text-center font-bold text-[10px] uppercase w-[80px]">Edit</TableHead>
                        <TableHead className="text-center font-bold text-[10px] uppercase w-[80px]">Delete</TableHead>
                        <TableHead className="text-center font-bold text-[10px] uppercase w-[80px]">Approve</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {SYSTEM_MODULES.map(mod => {
                        const perms = explorerPermissions?.[mod.key] || { ...NO_ACCESS };
                        return (
                          <TableRow key={mod.key} className="hover:bg-muted/10">
                            <TableCell className="pl-6 py-2">
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-primary">{mod.label}</span>
                                <span className="text-[9px] text-muted-foreground uppercase tracking-widest">{mod.group}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center"><PermissionCell active={perms.view} /></TableCell>
                            <TableCell className="text-center"><PermissionCell active={perms.create} /></TableCell>
                            <TableCell className="text-center"><PermissionCell active={perms.edit} /></TableCell>
                            <TableCell className="text-center"><PermissionCell active={perms.delete} /></TableCell>
                            <TableCell className="text-center"><PermissionCell active={perms.approve} /></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function PermissionCell({ active }: { active: boolean }) {
  return active ? (
    <div className="flex justify-center"><CheckCircle2 className="h-4 w-4 text-green-600" /></div>
  ) : (
    <div className="flex justify-center"><XCircle className="h-4 w-4 text-muted-foreground/20" /></div>
  );
}
