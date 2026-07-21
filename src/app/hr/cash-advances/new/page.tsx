'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, ChevronDown, Loader2, Search } from 'lucide-react';
import Link from 'next/link';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { addDoc, collection } from 'firebase/firestore';
import { useAppUser } from '@/hooks/use-app-user';
import { canCreate } from '@/lib/permissions';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { resolveSubjectLinkedUserId } from '@/lib/hr/linked-personnel';
import type { CashAdvanceRequest, OfficeStaff, User, Worker } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { filterActiveWorkersForSelection } from '@/lib/hr/worker-active';
import { filterActiveOfficeStaffForSelection } from '@/lib/hr/office-staff-active';
import { cn } from '@/lib/utils';

function workerPickLabel(w: Worker): string {
  return `${w.firstName ?? ''} ${w.lastName ?? ''}`.trim() + ` — ${w.workerCode ?? ''}`;
}

function staffPickLabel(s: OfficeStaff): string {
  return `${s.fullName ?? ''} — ${s.staffCode ?? ''}`;
}

/** ค้นหาได้ทั้งชื่อและรหัส — รองรับหลายคำ (ทุกคำต้องตรงบางจุดใน haystack) */
function matchesNameSearch(haystack: string, query: string): boolean {
  const t = query.trim();
  if (!t) return true;
  const hay = haystack.toLowerCase().normalize('NFC');
  const tokens = t
    .toLowerCase()
    .normalize('NFC')
    .split(/\s+/)
    .filter(Boolean);
  return tokens.every((tok) => hay.includes(tok));
}

export default function NewCashAdvancePage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { currentUser, isLoading: userLoading } = useAppUser();

  const ok = useMemo(() => !!currentUser && canCreate(currentUser, 'cash_advances'), [currentUser]);

  const workersQ = useMemoFirebase(() => {
    if (!firestore || !ok) return null;
    return collection(firestore, 'workers');
  }, [firestore, ok]);
  const staffQ = useMemoFirebase(() => {
    if (!firestore || !ok) return null;
    return collection(firestore, 'office_staff');
  }, [firestore, ok]);

  const { data: workers } = useCollection<Worker>(workersQ as any);
  const { data: staff } = useCollection<OfficeStaff>(staffQ as any);

  const workersSorted = useMemo(() => {
    if (!workers?.length) return [];
    return filterActiveWorkersForSelection(workers).sort((a, b) => {
      const na = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
      const nb = `${b.firstName ?? ''} ${b.lastName ?? ''}`.trim();
      const byName = na.localeCompare(nb, 'th', { sensitivity: 'base' });
      if (byName !== 0) return byName;
      return String(a.workerCode ?? '').localeCompare(String(b.workerCode ?? ''), undefined, {
        numeric: true,
      });
    });
  }, [workers]);

  const staffSorted = useMemo(() => {
    if (!staff?.length) return [];
    return filterActiveOfficeStaffForSelection(staff).sort((a, b) => {
      const na = (a.fullName ?? '').trim();
      const nb = (b.fullName ?? '').trim();
      const byName = na.localeCompare(nb, 'th', { sensitivity: 'base' });
      if (byName !== 0) return byName;
      return String(a.staffCode ?? '').localeCompare(String(b.staffCode ?? ''), undefined, {
        numeric: true,
      });
    });
  }, [staff]);

  const [subjectType, setSubjectType] = useState<'worker' | 'office_staff'>('office_staff');
  const [subjectId, setSubjectId] = useState('');
  const [subjectPickerOpen, setSubjectPickerOpen] = useState(false);
  const [subjectSearch, setSubjectSearch] = useState('');
  const subjectSearchRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSubjectId('');
    setSubjectSearch('');
  }, [subjectType]);

  useEffect(() => {
    if (subjectPickerOpen) {
      const id = window.setTimeout(() => subjectSearchRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [subjectPickerOpen]);

  const workersFiltered = useMemo(() => {
    return workersSorted.filter((w) =>
      matchesNameSearch(`${workerPickLabel(w)} ${w.workerCode ?? ''}`, subjectSearch),
    );
  }, [workersSorted, subjectSearch]);

  const staffFiltered = useMemo(() => {
    return staffSorted.filter((s) =>
      matchesNameSearch(`${staffPickLabel(s)} ${s.staffCode ?? ''}`, subjectSearch),
    );
  }, [staffSorted, subjectSearch]);

  const subjectName = useMemo(() => {
    if (!subjectId) return '';
    if (subjectType === 'worker') {
      const w = workers?.find((x) => x.id === subjectId);
      return w ? `${w.firstName} ${w.lastName} (${w.workerCode})` : '';
    }
    const s = staff?.find((x) => x.id === subjectId);
    return s ? `${s.fullName} (${s.staffCode})` : '';
  }, [subjectId, subjectType, workers, staff]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firestore || !currentUser || !ok) return;
    const amt = Number(amount);
    if (!subjectId.trim()) {
      toast({ variant: 'destructive', title: 'เลือกผู้เบิก' });
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ variant: 'destructive', title: 'จำนวนเงินไม่ถูกต้อง' });
      return;
    }
    setSaving(true);
    try {
      const linked = await resolveSubjectLinkedUserId(firestore, subjectType, subjectId);
      const needsConfirm = Boolean(linked);
      const { code: requestNo } = await generateNextDocumentCode(firestore, 'cash_advance', {
        actor: currentUser.displayName,
      });
      const now = Date.now();
      /** Firestore ไม่รับฟิลด์เป็น `undefined` — ใส่เฉพาะ workerId หรือ officeStaffId ฝั่งที่เลือก */
      const row: Omit<CashAdvanceRequest, 'id'> = {
        requestNo,
        subjectType,
        ...(subjectType === 'worker' ? { workerId: subjectId } : { officeStaffId: subjectId }),
        subjectNameSnapshot: subjectName || subjectId,
        amountBaht: amt,
        reason: reason.trim() || '-',
        origin: 'office',
        status: needsConfirm ? 'PENDING_SUBJECT_CONFIRMATION' : 'PENDING_PAYROLL_REVIEW',
        ...(linked ? { subjectLinkedUserId: linked } : {}),
        createdAt: now,
        createdByUid: currentUser.id,
        createdByName: currentUser.displayName || currentUser.email,
        updatedAt: now,
      };
      const ref = await addDoc(collection(firestore, 'cash_advance_requests'), row);
      toast({
        title: 'สร้างคำขอแล้ว',
        description: needsConfirm ? 'รอยืนยันจากผู้ถือบัญชี (ถ้ามีการผูก linkedUserId)' : 'ส่งเข้าคิว Payroll แล้ว',
      });
      router.push(`/hr/cash-advances/${ref.id}`);
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'สร้างไม่สำเร็จ',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  if (userLoading || !currentUser) return null;

  if (!ok) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-3xl mx-auto py-16 text-center text-muted-foreground">คุณไม่มีสิทธิ์สร้างคำขอ</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" className="gap-2 -ml-2" asChild>
          <Link href="/hr/cash-advances">
            <ArrowLeft className="h-4 w-4" /> กลับรายการ
          </Link>
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>สร้างคำขอเบิกล่วงหน้า (จากฝ่าย Office / HR)</CardTitle>
            <CardDescription>
              เมื่อมีการผูก <strong>linkedUserId</strong> ในทะเบียน — ระบบจะตั้งสถานะ «รอยืนยันผู้ถือเรื่อง» ให้กดยืนยันใน My
              Profile เพื่อเก็บ audit
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label>ประเภทผู้เบิก</Label>
                <Select value={subjectType} onValueChange={(v: 'worker' | 'office_staff') => setSubjectType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="office_staff">พนักงานออฟฟิศ</SelectItem>
                    <SelectItem value="worker">ลูกจ้าง</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cash-advance-subject-search">เลือกรายชื่อ</Label>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  พิมพ์ค้นหาชื่อหรือรหัส — รายการเรียงตามตัวอักษร
                </p>
                <Popover
                  open={subjectPickerOpen}
                  onOpenChange={(open) => {
                    setSubjectPickerOpen(open);
                    if (!open) setSubjectSearch('');
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={subjectPickerOpen}
                      className="w-full justify-between font-normal text-left min-h-10 h-auto py-2 whitespace-normal"
                    >
                      <span className={cn(!subjectId && 'text-muted-foreground')}>
                        {subjectId
                          ? (() => {
                              if (subjectType === 'worker') {
                                const w = workersSorted.find((x) => x.id === subjectId);
                                return w ? workerPickLabel(w) : 'กำลังโหลด...';
                              }
                              const s = staffSorted.find((x) => x.id === subjectId);
                              return s ? staffPickLabel(s) : 'กำลังโหลด...';
                            })()
                          : 'เลือกหรือค้นหาชื่อ...'}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-60 ml-2" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[min(100vw-2rem,22rem)]"
                    align="start"
                  >
                    <div className="flex items-center gap-2 border-b px-2 py-2">
                      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <Input
                        ref={subjectSearchRef}
                        id="cash-advance-subject-search"
                        placeholder="ค้นหาชื่อ / รหัส..."
                        value={subjectSearch}
                        onChange={(e) => setSubjectSearch(e.target.value)}
                        className="h-9 border-0 shadow-none focus-visible:ring-0 px-0"
                      />
                    </div>
                    <ScrollArea className="h-[min(55vh,280px)]">
                      <div className="p-1">
                        {subjectType === 'worker'
                          ? workersFiltered.map((w) => {
                              const label = workerPickLabel(w);
                              const selected = subjectId === w.id;
                              return (
                                <button
                                  key={w.id}
                                  type="button"
                                  className={cn(
                                    'w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                                    selected && 'bg-accent/70',
                                  )}
                                  onClick={() => {
                                    setSubjectId(w.id);
                                    setSubjectPickerOpen(false);
                                    setSubjectSearch('');
                                  }}
                                >
                                  {label}
                                </button>
                              );
                            })
                          : staffFiltered.map((s) => {
                              const label = staffPickLabel(s);
                              const selected = subjectId === s.id;
                              return (
                                <button
                                  key={s.id}
                                  type="button"
                                  className={cn(
                                    'w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                                    selected && 'bg-accent/70',
                                  )}
                                  onClick={() => {
                                    setSubjectId(s.id);
                                    setSubjectPickerOpen(false);
                                    setSubjectSearch('');
                                  }}
                                >
                                  {label}
                                </button>
                              );
                            })}
                        {(subjectType === 'worker' ? workersFiltered : staffFiltered).length === 0 && (
                          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                            ไม่พบรายชื่อที่ตรงกับคำค้น
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>จำนวนเงิน (บาท)</Label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>เหตุผล / รายละเอียด</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                บันทึกคำขอ
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
