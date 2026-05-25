'use client';

/**
 * เมทริกซ์สิทธิ์ตามเมนู (Menu-based Permission Matrix) — แก้ไขได้
 *
 * แสดงและให้ admin ปรับสิทธิ์ที่ ROLE × MENU
 * - Baseline: คำนวณจาก `getPermissions()` (`src/lib/permissions.ts`)
 * - Override: เก็บใน localStorage ผ่าน hook `useMenuPermissionOverrides`
 * - แสดง diff indicator ที่ cell ที่ถูก override
 * - ปุ่ม Save / Discard / Reset (cell/role/all) / Export JSON / Import JSON
 *
 * หมายเหตุ: ค่า override ยัง **ไม่มีผล** กับ Firestore rules จริง — เก็บไว้ก่อนสำหรับ iterate
 * เมื่อพร้อมจะนำ matrix นี้ไป generate firestore.rules ภายหลัง
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ShieldAlert,
  ShieldCheck,
  Eye,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Info,
  LockKeyhole,
  ExternalLink,
  Save,
  Undo2,
  RefreshCcw,
  Download,
  Upload,
  AlertTriangle,
  CircleDot,
  FileCode2,
} from 'lucide-react';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import type { BusinessRoleKey, ModulePermission, User } from '@/lib/types';
import { isAdminUser, getFieldsForBusinessRole } from '@/lib/auth-mapping';
import { ACTIVE_BUSINESS_ROLE_KEYS, ROLE_CATALOG } from '@/lib/roles/role-catalog';
import { getPermissions } from '@/lib/permissions';
import {
  MENU_PERMISSION_GROUPS,
  type MenuPermissionGroup,
  type MenuPermissionItem,
} from '@/lib/navigation/menu-permission-map';
import { useMenuPermissionOverrides } from '@/hooks/use-menu-permission-overrides';
import {
  CAPABILITY_KEYS,
  type CapabilityCell,
  type CapabilityKey,
} from '@/lib/permissions/menu-matrix-overrides';
import { generateRulesPreview } from '@/lib/permissions/generate-rules-from-matrix';
import { MODULE_FIRESTORE_SPECS } from '@/lib/permissions/module-to-firestore-paths';
import { cn } from '@/lib/utils';

/** สร้าง User mock จาก roleKey เพื่อใช้คำนวณ baseline permission */
function buildMockUser(roleKey: BusinessRoleKey): User {
  const fields = getFieldsForBusinessRole(roleKey);
  return {
    id: `__matrix_mock_${roleKey}`,
    email: `${roleKey}@example.local`,
    displayName: ROLE_CATALOG[roleKey].displayNameTh,
    phone: '0000000000',
    approvalStatus: 'ACTIVE',
    isActive: true,
    userType: roleKey === 'client_user' ? 'customer_portal' : 'internal',
    customerId: roleKey === 'client_user' ? '__matrix_customer__' : undefined,
    portalRole: roleKey === 'client_user' ? 'viewer' : undefined,
    createdAt: 0,
    updatedAt: 0,
    ...fields,
  } as User;
}

function toCell(p: ModulePermission): CapabilityCell {
  return {
    view: !!p.view,
    create: !!p.create,
    edit: !!p.edit,
    delete: !!p.delete,
    approve: !!p.approve,
  };
}

const ROLE_TO_GROUP_HEADER: Record<BusinessRoleKey, string> = {
  system_admin: 'Admin',
  hr_manager: 'HR',
  hr_officer: 'HR',
  payroll_officer: 'HR',
  sales_manager: 'Sales',
  sales_officer: 'Sales',
  store_officer: 'Store',
  operations_manager: 'Operations',
  operations_officer: 'Operations',
  timekeeper: 'Operations',
  accounting_manager: 'Accounting',
  accounting_officer: 'Accounting',
  client_user: 'Client Portal',
  employee_self: 'Self',
};

const GROUP_HEADER_COLOR: Record<string, string> = {
  Admin: 'bg-rose-100 text-rose-900 border-rose-300',
  HR: 'bg-amber-100 text-amber-900 border-amber-300',
  Sales: 'bg-purple-100 text-purple-900 border-purple-300',
  Operations: 'bg-blue-100 text-blue-900 border-blue-300',
  Store: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  Accounting: 'bg-cyan-100 text-cyan-900 border-cyan-300',
  'Client Portal': 'bg-slate-100 text-slate-900 border-slate-300',
  Self: 'bg-zinc-100 text-zinc-900 border-zinc-300',
};

interface CapabilityMeta {
  key: CapabilityKey;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  enabledClass: string;
  disabledClass: string;
}

const CAPABILITY_META: CapabilityMeta[] = [
  {
    key: 'view',
    label: 'ดู',
    shortLabel: 'V',
    icon: Eye,
    enabledClass: 'bg-slate-100 text-slate-800 border-slate-400',
    disabledClass: 'bg-muted/20 text-muted-foreground/40 border-muted line-through',
  },
  {
    key: 'create',
    label: 'สร้าง',
    shortLabel: 'C',
    icon: Plus,
    enabledClass: 'bg-emerald-100 text-emerald-800 border-emerald-400',
    disabledClass: 'bg-muted/20 text-muted-foreground/40 border-muted line-through',
  },
  {
    key: 'edit',
    label: 'แก้ไข',
    shortLabel: 'E',
    icon: Pencil,
    enabledClass: 'bg-amber-100 text-amber-800 border-amber-400',
    disabledClass: 'bg-muted/20 text-muted-foreground/40 border-muted line-through',
  },
  {
    key: 'delete',
    label: 'ลบ',
    shortLabel: 'D',
    icon: Trash2,
    enabledClass: 'bg-rose-100 text-rose-800 border-rose-400',
    disabledClass: 'bg-muted/20 text-muted-foreground/40 border-muted line-through',
  },
  {
    key: 'approve',
    label: 'อนุมัติ',
    shortLabel: 'A',
    icon: CheckCircle2,
    enabledClass: 'bg-violet-100 text-violet-800 border-violet-400',
    disabledClass: 'bg-muted/20 text-muted-foreground/40 border-muted line-through',
  },
];

function summarizeCell(cell: CapabilityCell): { label: string; tone: 'none' | 'view' | 'edit' | 'full' } {
  if (!cell.view) return { label: 'ไม่มีสิทธิ์', tone: 'none' };
  if (cell.delete && cell.approve && cell.edit && cell.create) {
    return { label: 'เต็มรูปแบบ', tone: 'full' };
  }
  if (cell.approve && cell.edit) return { label: 'แก้ไข + อนุมัติ', tone: 'full' };
  if (cell.create || cell.edit) return { label: 'แก้ไขได้', tone: 'edit' };
  return { label: 'ดูอย่างเดียว', tone: 'view' };
}

interface CapabilityBadgesProps {
  cell: CapabilityCell;
  baseline: CapabilityCell;
  editable?: boolean;
  onToggle?: (cap: CapabilityKey) => void;
}

function CapabilityBadges({ cell, baseline, editable, onToggle }: CapabilityBadgesProps) {
  return (
    <div className="flex flex-wrap gap-1">
      {CAPABILITY_META.map((meta) => {
        const enabled = !!cell[meta.key];
        const isOverridden = baseline[meta.key] !== cell[meta.key];
        const Icon = meta.icon;
        const tip = `${meta.label} — ${enabled ? 'อนุญาต' : 'ไม่อนุญาต'}${
          isOverridden ? ' (override จาก baseline)' : ''
        }`;

        const baseCls = cn(
          'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase transition-colors relative',
          enabled ? meta.enabledClass : meta.disabledClass,
          editable && 'cursor-pointer hover:ring-2 hover:ring-primary/40',
          isOverridden && 'ring-2 ring-amber-500/60',
        );

        const inner = (
          <>
            <Icon className="h-3 w-3" />
            {meta.shortLabel}
            {isOverridden && (
              <CircleDot className="h-2.5 w-2.5 absolute -top-1 -right-1 text-amber-600 fill-white" />
            )}
          </>
        );

        return (
          <TooltipProvider key={meta.key} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                {editable ? (
                  <button
                    type="button"
                    className={baseCls}
                    onClick={() => onToggle?.(meta.key)}
                    aria-label={tip}
                  >
                    {inner}
                  </button>
                ) : (
                  <span className={baseCls} aria-label={tip}>
                    {inner}
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent>
                <span className="text-xs">
                  {tip}
                  {editable ? ' · คลิกเพื่อสลับ' : ''}
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
    </div>
  );
}

function CellSummaryPill({ cell }: { cell: CapabilityCell }) {
  const s = summarizeCell(cell);
  const toneClass =
    s.tone === 'none'
      ? 'bg-muted/40 text-muted-foreground border-muted'
      : s.tone === 'view'
        ? 'bg-slate-100 text-slate-800 border-slate-300'
        : s.tone === 'edit'
          ? 'bg-amber-100 text-amber-900 border-amber-300'
          : 'bg-emerald-100 text-emerald-900 border-emerald-300';
  return (
    <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0.5', toneClass)}>
      {s.label}
    </Badge>
  );
}

export default function MenuPermissionMatrixPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const { isUserLoading } = useUser();
  const { toast } = useToast();
  const [selectedRole, setSelectedRole] = useState<BusinessRoleKey | 'all'>('all');
  const [editMode, setEditMode] = useState<boolean>(true);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [rulesPreviewOpen, setRulesPreviewOpen] = useState(false);
  const [rulesPreviewText, setRulesPreviewText] = useState('');
  const [rulesPreviewStats, setRulesPreviewStats] = useState<{ moduleCount: number; pathCount: number; predicateCount: number } | null>(null);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('opsflow_user') : null;
    if (stored) {
      try {
        setCurrentUser(JSON.parse(stored));
      } catch {
        setCurrentUser(null);
      }
    }
  }, []);

  const isAdmin = useMemo(() => isAdminUser(currentUser), [currentUser]);

  const matrixApi = useMenuPermissionOverrides({
    updatedBy: currentUser?.email ?? currentUser?.id,
  });

  /** baseline permission ของทุก (role × module) — คำนวณครั้งเดียว
   *  รวม module keys จาก เมนู UI + module-to-firestore-paths (เพื่อให้ generator ใช้ได้ครอบคลุม)
   */
  const baselineMatrix = useMemo(() => {
    const allModuleKeys = new Set<string>();
    for (const grp of MENU_PERMISSION_GROUPS) {
      for (const item of grp.items) allModuleKeys.add(item.moduleKey);
    }
    for (const spec of MODULE_FIRESTORE_SPECS) allModuleKeys.add(spec.moduleKey);

    const out: Record<string, Record<string, CapabilityCell>> = {};
    for (const rk of ACTIVE_BUSINESS_ROLE_KEYS) {
      const u = buildMockUser(rk);
      const row: Record<string, CapabilityCell> = {};
      for (const mk of allModuleKeys) {
        row[mk] = toCell(getPermissions(u, mk, null));
      }
      out[rk] = row;
    }
    return out;
  }, []);

  const rolesByHeader = useMemo(() => {
    const grouped = new Map<string, BusinessRoleKey[]>();
    for (const rk of ACTIVE_BUSINESS_ROLE_KEYS) {
      const h = ROLE_TO_GROUP_HEADER[rk];
      const arr = grouped.get(h) ?? [];
      arr.push(rk);
      grouped.set(h, arr);
    }
    return Array.from(grouped.entries());
  }, []);

  const handleSave = () => {
    matrixApi.save();
    toast({
      title: 'บันทึก overrides แล้ว',
      description: `เก็บใน browser นี้ (localStorage) — ${matrixApi.modifiedCapabilityCount} capability ทั้งหมด`,
    });
  };

  const handleDiscard = () => {
    matrixApi.discard();
    toast({
      title: 'ยกเลิกการเปลี่ยนแปลง',
      description: 'คืนค่าที่บันทึกล่าสุดแล้ว',
    });
  };

  const handleClearAll = () => {
    matrixApi.clearAll();
    toast({
      title: 'ล้าง override ทั้งหมด (working)',
      description: 'กด "บันทึก" เพื่อทำให้ผลถาวร',
    });
  };

  const handleResetRole = (roleKey: BusinessRoleKey) => {
    matrixApi.resetRole(roleKey);
    toast({
      title: `ล้าง override ของ ${ROLE_CATALOG[roleKey].displayNameTh}`,
      description: 'คืนค่า baseline จาก code — กด "บันทึก" เพื่อทำให้ถาวร',
    });
  };

  const handleExport = async () => {
    const json = matrixApi.exportJson();
    setImportJsonText(json);
    setExportDialogOpen(true);
    try {
      if (navigator?.clipboard) {
        await navigator.clipboard.writeText(json);
        toast({ title: 'คัดลอก JSON ไปยัง clipboard แล้ว' });
      }
    } catch {
      /** ignore — แสดงใน dialog แทน */
    }
  };

  const handleImport = () => {
    const ok = matrixApi.importJson(importJsonText);
    if (ok) {
      toast({
        title: 'นำเข้า override สำเร็จ',
        description: 'ดู preview ก่อนแล้วกด "บันทึก" เพื่อทำให้ถาวร',
      });
      setImportDialogOpen(false);
    } else {
      toast({
        variant: 'destructive',
        title: 'JSON ไม่ถูกต้อง',
        description: 'ต้องมี field `version` และ `overrides` ตาม schema',
      });
    }
  };

  const handlePreviewRules = async () => {
    const result = generateRulesPreview({
      overrides: matrixApi.working,
      baseline: baselineMatrix,
      generatedAt: Date.now(),
      generatedBy: currentUser?.email ?? currentUser?.id,
    });
    setRulesPreviewText(result.text);
    setRulesPreviewStats(result.stats);
    setRulesPreviewOpen(true);
    try {
      if (navigator?.clipboard) {
        await navigator.clipboard.writeText(result.text);
        toast({
          title: 'Preview พร้อม',
          description: `${result.stats.predicateCount} predicate · ${result.stats.pathCount} match block · คัดลอกแล้ว`,
        });
      }
    } catch {
      /** silent */
    }
  };

  if (isUserLoading || !currentUser) return null;

  if (!isAdmin) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
          <ShieldAlert className="h-12 w-12 text-destructive opacity-60" />
          <div>
            <h2 className="text-xl font-bold">เฉพาะผู้ดูแลระบบ</h2>
            <p className="text-muted-foreground">หน้านี้สำหรับ System Administrator เท่านั้น</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
              <LockKeyhole className="h-8 w-8" />
              เมทริกซ์สิทธิ์ตามเมนู (Menu × Role)
            </h1>
            <p className="text-muted-foreground text-base mt-1">
              ปรับสิทธิ์ของแต่ละบทบาทตามเมนูใน sidebar — คลิก badge V/C/E/D/A เพื่อสลับ
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/users" passHref>
              <Button variant="outline" size="sm" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                ไปจัดการผู้ใช้
              </Button>
            </Link>
          </div>
        </div>

        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>ค่า override นี้ยังไม่มีผลกับ Firestore rules</AlertTitle>
          <AlertDescription className="space-y-1 text-sm">
            <p>
              • ค่าที่ปรับเก็บใน <strong>localStorage ของ browser</strong> นี้เท่านั้น (key:{' '}
              <code>opsflow_menu_permission_overrides_v1</code>) — ใช้เพื่อ <strong>iterate matrix</strong>{' '}
              ว่าควรเปิดสิทธิ์อะไรให้ใคร
            </p>
            <p>
              • Baseline ของแต่ละ cell ยังคงคำนวณจาก <code>getPermissions()</code> ใน{' '}
              <code>src/lib/permissions.ts</code> — และ Firestore rules ในระบบจริงก็ยังใช้ค่านั้น
            </p>
            <p>
              • เมื่อพร้อม จะนำ matrix นี้ (Export JSON) ไป generate <code>firestore.rules</code> และ
              ปรับ <code>getPermissions()</code> ให้สอดคล้องกัน
            </p>
            <p className="text-xs text-amber-700">
              ช่องที่มี <CircleDot className="inline h-3 w-3 text-amber-600" /> วงสีเหลือง = ถูก override จาก
              baseline
            </p>
          </AlertDescription>
        </Alert>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-center gap-4">
                <div>
                  <CardTitle className="text-lg">ตัวควบคุม</CardTitle>
                  <CardDescription className="flex items-center gap-2 flex-wrap">
                    {matrixApi.isDirty ? (
                      <Badge className="bg-amber-100 text-amber-900 border-amber-300" variant="outline">
                        มีการเปลี่ยนแปลงที่ยังไม่บันทึก
                      </Badge>
                    ) : (
                      <Badge className="bg-emerald-100 text-emerald-900 border-emerald-300" variant="outline">
                        บันทึกล่าสุดแล้ว
                      </Badge>
                    )}
                    <span className="text-xs">
                      {matrixApi.modifiedCellCount} cell · {matrixApi.modifiedCapabilityCount}{' '}
                      capability ถูก override
                    </span>
                  </CardDescription>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setEditMode((v) => !v)}
                >
                  <Pencil className="h-4 w-4" />
                  {editMode ? 'ออกจากโหมดแก้ไข' : 'เข้าสู่โหมดแก้ไข'}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={handleDiscard}
                  disabled={!matrixApi.isDirty}
                >
                  <Undo2 className="h-4 w-4" />
                  ยกเลิก (Discard)
                </Button>

                <Button
                  size="sm"
                  className="gap-1"
                  onClick={handleSave}
                  disabled={!matrixApi.isDirty}
                >
                  <Save className="h-4 w-4" />
                  บันทึก (Save)
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1">
                      <RefreshCcw className="h-4 w-4" />
                      ล้าง override ทั้งหมด
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>ล้าง override ของทุกบทบาท?</AlertDialogTitle>
                      <AlertDialogDescription>
                        ทุก cell จะกลับไปใช้ baseline ที่คำนวณจาก code (
                        <code>getPermissions()</code>) — ค่าจะอยู่ใน working state ต้องกด "บันทึก"
                        เพื่อทำให้ถาวร
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
                      <AlertDialogAction onClick={handleClearAll}>ยืนยันล้าง</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={handleExport}
                >
                  <Download className="h-4 w-4" />
                  Export JSON
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => {
                    setImportJsonText('');
                    setImportDialogOpen(true);
                  }}
                >
                  <Upload className="h-4 w-4" />
                  Import JSON
                </Button>

                <Button
                  variant="default"
                  size="sm"
                  className="gap-1 bg-indigo-600 hover:bg-indigo-700"
                  onClick={handlePreviewRules}
                >
                  <FileCode2 className="h-4 w-4" />
                  Preview firestore.rules
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">มุมมอง:</span>
              <Select
                value={selectedRole}
                onValueChange={(v) => setSelectedRole(v as BusinessRoleKey | 'all')}
              >
                <SelectTrigger className="w-[320px]">
                  <SelectValue placeholder="เลือกบทบาท" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ดูทุกบทบาท (เปรียบเทียบ · read-only)</SelectItem>
                  {ACTIVE_BUSINESS_ROLE_KEYS.map((rk) => (
                    <SelectItem key={rk} value={rk}>
                      {ROLE_CATALOG[rk].displayNameTh} ({rk})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRole === 'all' && editMode && (
                <span className="text-xs text-muted-foreground italic">
                  (โหมดเปรียบเทียบทุกบทบาทเป็น read-only — เลือกบทบาทเดียวเพื่อแก้ไข)
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue={MENU_PERMISSION_GROUPS[0].label} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto">
            {MENU_PERMISSION_GROUPS.map((g) => (
              <TabsTrigger key={g.label} value={g.label} className="text-xs">
                {g.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {MENU_PERMISSION_GROUPS.map((group) => (
            <TabsContent key={group.label} value={group.label} className="space-y-4">
              {selectedRole === 'all' ? (
                <MultiRoleGroupView
                  group={group}
                  baselineMatrix={baselineMatrix}
                  matrixApi={matrixApi}
                  rolesByHeader={rolesByHeader}
                />
              ) : (
                <SingleRoleGroupView
                  group={group}
                  roleKey={selectedRole}
                  baselineMatrix={baselineMatrix}
                  matrixApi={matrixApi}
                  editable={editMode}
                  onResetRole={() => handleResetRole(selectedRole)}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              สรุปบทบาทในระบบ
            </CardTitle>
            <CardDescription>รายการบทบาทที่กำหนดได้ในหน้าจัดการผู้ใช้</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {ACTIVE_BUSINESS_ROLE_KEYS.map((rk) => {
                const entry = ROLE_CATALOG[rk];
                const header = ROLE_TO_GROUP_HEADER[rk];
                const overrideCount = Object.keys(matrixApi.working[rk] ?? {}).length;
                return (
                  <div
                    key={rk}
                    className={cn(
                      'rounded-md border p-3 text-sm space-y-1',
                      GROUP_HEADER_COLOR[header] ?? 'bg-muted/30'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{entry.displayNameTh}</span>
                      <Badge variant="outline" className="text-[10px] bg-white/60">
                        {entry.accessGroup}/{entry.accessLevel}
                      </Badge>
                    </div>
                    <div className="text-xs opacity-75">
                      <code>{rk}</code>
                    </div>
                    <div className="text-xs opacity-80">{entry.descriptionTh}</div>
                    {overrideCount > 0 && (
                      <div className="text-xs font-semibold text-amber-700">
                        ⚠ override {overrideCount} cell
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>นำเข้า Overrides (Import JSON)</DialogTitle>
            <DialogDescription>
              วาง JSON ที่ Export จากที่อื่น (หรือไฟล์ backup) — schema version{' '}
              <code>1</code>
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={importJsonText}
            onChange={(e) => setImportJsonText(e.target.value)}
            rows={14}
            placeholder='{"version": 1, "updatedAt": ..., "overrides": {...}}'
            className="font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleImport}>นำเข้า</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Export Overrides (JSON)</DialogTitle>
            <DialogDescription>
              คัดลอก JSON นี้เพื่อ backup / นำไปใช้กับ device อื่น / ส่งเข้า source control
              (ถูกคัดลอกไปยัง clipboard ให้แล้ว ถ้า browser อนุญาต)
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={importJsonText}
            readOnly
            rows={14}
            className="font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
              ปิด
            </Button>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(importJsonText);
                  toast({ title: 'คัดลอกแล้ว' });
                } catch {
                  toast({ variant: 'destructive', title: 'คัดลอกไม่สำเร็จ' });
                }
              }}
            >
              คัดลอกอีกครั้ง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rulesPreviewOpen} onOpenChange={setRulesPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode2 className="h-5 w-5 text-indigo-600" />
              Preview firestore.rules ที่ generate จาก matrix
            </DialogTitle>
            <DialogDescription className="space-y-1">
              <span>
                ผลลัพธ์เป็น <strong>text สำหรับ review/copy</strong> — ไม่ได้เขียนทับไฟล์อะไรเอง
              </span>
              {rulesPreviewStats && (
                <span className="block text-xs">
                  สร้าง {rulesPreviewStats.predicateCount} predicate · {rulesPreviewStats.pathCount} match
                  block · ครอบคลุม {rulesPreviewStats.moduleCount} module
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <Info className="h-4 w-4" />
            <AlertTitle>ขั้นตอนการนำไปใช้</AlertTitle>
            <AlertDescription>
              <ol className="list-decimal pl-5 space-y-1 text-sm">
                <li>
                  คัดลอก text ทั้งหมด → เปิด <code>firestore.rules</code>
                </li>
                <li>
                  วาง <strong>PART 1 (predicate functions)</strong> ในส่วน helper functions เดิม
                </li>
                <li>
                  วาง <strong>PART 2 (match blocks)</strong> โดยตรวจสอบเทียบกับ block เดิม:
                  เก็บ logic พิเศษ (portal scope / status guard) ไว้
                </li>
                <li>
                  รัน <code>firebase deploy --only firestore:rules</code> (รอ 503 หาย)
                </li>
                <li>
                  อัปเดต <code>getPermissions()</code> ใน <code>src/lib/permissions.ts</code>{' '}
                  ให้สอดคล้องด้วย — ไม่งั้น UI จะแสดงคนละสิทธิ์กับ Firestore
                </li>
              </ol>
            </AlertDescription>
          </Alert>

          <Textarea
            value={rulesPreviewText}
            readOnly
            rows={20}
            className="font-mono text-[11px] leading-snug"
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setRulesPreviewOpen(false)}>
              ปิด
            </Button>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(rulesPreviewText);
                  toast({ title: 'คัดลอก rules preview แล้ว' });
                } catch {
                  toast({ variant: 'destructive', title: 'คัดลอกไม่สำเร็จ' });
                }
              }}
            >
              คัดลอกอีกครั้ง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

/** มุมมอง: 1 กลุ่มเมนู × หลายบทบาท — ตารางเปรียบเทียบ (read-only) */
function MultiRoleGroupView({
  group,
  baselineMatrix,
  matrixApi,
  rolesByHeader,
}: {
  group: MenuPermissionGroup;
  baselineMatrix: Record<string, Record<string, CapabilityCell>>;
  matrixApi: ReturnType<typeof useMenuPermissionOverrides>;
  rolesByHeader: Array<[string, BusinessRoleKey[]]>;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{group.label}</CardTitle>
            <CardDescription>
              เมนูหลัก {group.items.length} รายการ — เปรียบเทียบสิทธิ์ของทุกบทบาท (read-only;
              ต้องการแก้ ให้เลือกบทบาทเดียว)
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={cn('text-xs', audienceBadgeClass(group.audience))}
          >
            {audienceLabel(group.audience)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50 sticky top-0 z-10">
                <th className="text-left p-2 border-b border-r font-semibold w-[260px] min-w-[260px] sticky left-0 bg-muted/70 z-20">
                  เมนูหลัก
                </th>
                {rolesByHeader.map(([header, roles]) => (
                  <th
                    key={header}
                    colSpan={roles.length}
                    className={cn(
                      'text-center text-xs border-b border-r p-1 font-bold',
                      GROUP_HEADER_COLOR[header] ?? 'bg-muted'
                    )}
                  >
                    {header}
                  </th>
                ))}
              </tr>
              <tr className="bg-muted/30">
                <th className="text-left p-1 border-b border-r sticky left-0 bg-muted/50 z-10" />
                {rolesByHeader.flatMap(([, roles]) =>
                  roles.map((rk) => (
                    <th
                      key={rk}
                      className="text-center p-1 border-b border-r text-[10px] font-semibold min-w-[110px]"
                      title={`${ROLE_CATALOG[rk].displayNameTh} (${rk})`}
                    >
                      <div className="leading-tight">{ROLE_CATALOG[rk].displayNameTh}</div>
                      <code className="text-[9px] text-muted-foreground font-normal">{rk}</code>
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {group.items.map((item) => (
                <tr key={item.moduleKey + (item.path ?? '')} className="hover:bg-muted/20">
                  <td className="p-2 border-b border-r align-top sticky left-0 bg-background z-10">
                    <MenuItemLabel item={item} />
                  </td>
                  {rolesByHeader.flatMap(([, roles]) =>
                    roles.map((rk) => {
                      const baseline = baselineMatrix[rk]?.[item.moduleKey];
                      if (!baseline) return <td key={rk + item.moduleKey} className="p-2 border-b border-r">—</td>;
                      const effective = matrixApi.effective(rk, item.moduleKey, baseline);
                      const isOverridden = matrixApi.hasOverrideAt(rk, item.moduleKey);
                      return (
                        <td
                          key={rk + item.moduleKey}
                          className={cn(
                            'p-2 border-b border-r align-top',
                            isOverridden && 'bg-amber-50'
                          )}
                        >
                          <CapabilityBadges cell={effective} baseline={baseline} editable={false} />
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** มุมมอง: 1 บทบาท × 1 กลุ่มเมนู — แก้ไขได้ */
function SingleRoleGroupView({
  group,
  roleKey,
  baselineMatrix,
  matrixApi,
  editable,
  onResetRole,
}: {
  group: MenuPermissionGroup;
  roleKey: BusinessRoleKey;
  baselineMatrix: Record<string, Record<string, CapabilityCell>>;
  matrixApi: ReturnType<typeof useMenuPermissionOverrides>;
  editable: boolean;
  onResetRole: () => void;
}) {
  const role = ROLE_CATALOG[roleKey];
  const header = ROLE_TO_GROUP_HEADER[roleKey];

  const totalGranted = group.items.filter((i) => {
    const baseline = baselineMatrix[roleKey]?.[i.moduleKey];
    if (!baseline) return false;
    return matrixApi.effective(roleKey, i.moduleKey, baseline).view;
  }).length;

  const overrideCount = group.items.filter((i) => matrixApi.hasOverrideAt(roleKey, i.moduleKey)).length;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{group.label}</CardTitle>
            <CardDescription>
              บทบาท: <strong>{role.displayNameTh}</strong> (<code>{roleKey}</code>) — เข้าได้{' '}
              {totalGranted}/{group.items.length} เมนูในกลุ่มนี้
              {overrideCount > 0 && (
                <span className="ml-2 text-amber-700 font-semibold">
                  · override {overrideCount} เมนูในกลุ่มนี้
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn('text-xs', GROUP_HEADER_COLOR[header] ?? 'bg-muted')}>
              {role.accessGroup}/{role.accessLevel}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              onClick={onResetRole}
              disabled={Object.keys(matrixApi.working[roleKey] ?? {}).length === 0}
            >
              <RefreshCcw className="h-3 w-3" />
              คืน baseline (ทั้งบทบาท)
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {group.items.map((item) => {
            const baseline = baselineMatrix[roleKey]?.[item.moduleKey];
            if (!baseline) return null;
            const effective = matrixApi.effective(roleKey, item.moduleKey, baseline);
            const isGranted = effective.view;
            const isOverridden = matrixApi.hasOverrideAt(roleKey, item.moduleKey);
            return (
              <div
                key={item.moduleKey + (item.path ?? '')}
                className={cn(
                  'rounded-md border p-3 space-y-2 transition-colors',
                  isGranted ? 'bg-background' : 'bg-muted/30 opacity-90',
                  isOverridden && 'ring-2 ring-amber-400 border-amber-300 bg-amber-50/40'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <MenuItemLabel item={item} />
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <CellSummaryPill cell={effective} />
                    {isOverridden && (
                      <button
                        type="button"
                        className="text-[10px] text-amber-700 underline hover:text-amber-900"
                        onClick={() => matrixApi.resetCell(roleKey, item.moduleKey)}
                      >
                        คืน baseline เมนูนี้
                      </button>
                    )}
                  </div>
                </div>
                <CapabilityBadges
                  cell={effective}
                  baseline={baseline}
                  editable={editable}
                  onToggle={(cap) => matrixApi.toggle(roleKey, item.moduleKey, cap, baseline)}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function MenuItemLabel({ item }: { item: MenuPermissionItem }) {
  return (
    <div className="space-y-0.5">
      <div className="font-semibold text-foreground leading-tight">{item.label}</div>
      <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
        {item.path && <code>{item.path}</code>}
        <code className="bg-muted/40 px-1 rounded">{item.moduleKey}</code>
      </div>
      {item.note && <div className="text-[11px] text-muted-foreground italic">↳ {item.note}</div>}
    </div>
  );
}

function audienceLabel(a: MenuPermissionGroup['audience']): string {
  switch (a) {
    case 'admin':
      return 'แสดงเฉพาะ Admin';
    case 'accounting':
      return 'แสดงเฉพาะ Accounting + Admin';
    case 'client':
      return 'แสดงเฉพาะ Client Portal';
    default:
      return 'Internal Users';
  }
}

function audienceBadgeClass(a: MenuPermissionGroup['audience']): string {
  switch (a) {
    case 'admin':
      return 'bg-rose-100 text-rose-900 border-rose-300';
    case 'accounting':
      return 'bg-cyan-100 text-cyan-900 border-cyan-300';
    case 'client':
      return 'bg-slate-100 text-slate-900 border-slate-300';
    default:
      return 'bg-blue-100 text-blue-900 border-blue-300';
  }
}
