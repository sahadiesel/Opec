'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, orderBy, query } from 'firebase/firestore';
import {
  ChevronRight,
  FileSignature,
  Info,
  Loader2,
  Plus,
  Wrench,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { DocumentListFilterBar } from '@/components/documents/document-list-filter-bar';
import { DocumentStatusFilterSelect } from '@/components/documents/document-status-filter-select';
import {
  buildYearCeOptions,
  currentMonthMm,
  currentYearCe,
  ymMatchesYearMonthScope,
} from '@/lib/date/year-month-scope-filter';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PageGuidance } from '@/components/layout/page-guidance';
import {
  EquipmentRentalContractDetailsFields,
  EquipmentRentalLineItemsEditor,
  detailsDraftToInput,
  emptyEquipmentRentalDetailsDraft,
  emptyEquipmentRentalLineDraft,
} from '@/components/rent-contracts/equipment-rental-contract-form-fields';
import { useAppUser } from '@/hooks/use-app-user';
import {
  resolveOpecLessorFromCompanyProfile,
  useCompanyDocumentProfile,
} from '@/hooks/use-company-document-profile';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { canManageEquipmentRentalContracts } from '@/lib/permissions';
import type { Customer, EquipmentRentalContract, EquipmentRentalContractStatus, User } from '@/lib/types';
import {
  createEquipmentRentalContract,
  syncDueEquipmentRentalInvoicesForAllActive,
} from '@/lib/services/equipment-rental-contract-service';
import { formatYmdRangeThaiBE } from '@/lib/date-thai';

function statusBadge(status: EquipmentRentalContractStatus) {
  const label: Record<EquipmentRentalContractStatus, string> = {
    DRAFT: 'ร่าง',
    ACTIVE: 'ใช้งาน',
    CANCELLED: 'ยกเลิก',
    EXPIRED: 'สิ้นสุด',
  };
  if (status === 'ACTIVE') return <Badge className="bg-emerald-600 text-[10px]">{label[status]}</Badge>;
  if (status === 'CANCELLED') return <Badge variant="destructive" className="text-[10px]">{label[status]}</Badge>;
  return <Badge variant="outline" className="text-[10px]">{label[status]}</Badge>;
}

export default function RentContractsPage() {
  const router = useRouter();
  const { currentUser, isLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { profile: companyProfile } = useCompanyDocumentProfile();
  const authorized = !!currentUser && canManageEquipmentRentalContracts(currentUser);
  const canCreateContract = authorized;

  const contractsQuery = useMemoFirebase(() => {
    if (!firestore || !authorized) return null;
    return query(collection(firestore, 'equipment_rental_contracts'), orderBy('createdAt', 'desc'));
  }, [firestore, authorized]);
  const { data: contracts, isLoading: loadingContracts } = useCollection<EquipmentRentalContract>(
    contractsQuery as any,
  );

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !authorized) return null;
    return query(collection(firestore, 'customers'), orderBy('name', 'asc'));
  }, [firestore, authorized]);
  const { data: customers } = useCollection<Customer>(customersQuery as any);

  const [search, setSearch] = useState('');
  const [yearFilterCe, setYearFilterCe] = useState(() => currentYearCe());
  const [monthScope, setMonthScope] = useState(() => currentMonthMm());
  const [statusFilter, setStatusFilter] = useState<'all' | EquipmentRentalContractStatus>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [billingDay, setBillingDay] = useState('1');
  const [vatPercent, setVatPercent] = useState('7');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([emptyEquipmentRentalLineDraft()]);
  const [details, setDetails] = useState(emptyEquipmentRentalDetailsDraft());

  useEffect(() => {
    if (!firestore || !currentUser || !authorized) return;
    let cancelled = false;
    setSyncing(true);
    void (async () => {
      try {
        const n = await syncDueEquipmentRentalInvoicesForAllActive(firestore, currentUser as User);
        if (!cancelled && n > 0) {
          toast({
            title: 'สร้างใบแจ้งหนี้อัตโนมัติ',
            description: `ครบกำหนดวางบิล ${n} ใบ — ดูได้ที่รายการใบแจ้งหนี้`,
          });
        }
      } catch {
        /* ignore sync errors on list open */
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, currentUser, authorized, toast]);

  useEffect(() => {
    const lessor = resolveOpecLessorFromCompanyProfile(companyProfile);
    setDetails((prev) => ({
      ...prev,
      lessorName: lessor.lessorName,
      lessorAddress: lessor.lessorAddress,
      lessorTaxId: lessor.lessorTaxId,
      lessorAuthorizedSignatory: lessor.lessorAuthorizedSignatory || prev.lessorAuthorizedSignatory,
    }));
  }, [companyProfile]);

  useEffect(() => {
    const customer = (customers ?? []).find((c) => c.id === customerId);
    if (!customer) return;
    setDetails((prev) => ({
      ...prev,
      customerAddressSnapshot: customer.registeredAddress || customer.billingAddress || prev.customerAddressSnapshot,
      customerTaxIdSnapshot: customer.taxId || prev.customerTaxIdSnapshot,
    }));
  }, [customerId, customers]);

  const yearOptionsCe = useMemo(
    () =>
      buildYearCeOptions(
        (contracts ?? []).map((c) => String(c.startDate || '').slice(0, 7) || String(c.createdAt || '').slice(0, 7)),
      ),
    [contracts],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (contracts ?? []).filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      const ym = String(c.startDate || '').slice(0, 7);
      if (!ymMatchesYearMonthScope(ym, yearFilterCe, monthScope)) return false;
      if (!q) return true;
      return (
        c.contractNo?.toLowerCase().includes(q) ||
        c.title?.toLowerCase().includes(q) ||
        c.customerNameSnapshot?.toLowerCase().includes(q)
      );
    });
  }, [contracts, search, statusFilter, yearFilterCe, monthScope]);

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    const customer = (customers ?? []).find((c) => c.id === customerId);
    if (!customer) {
      toast({ variant: 'destructive', title: 'เลือกลูกค้าผู้เช่า' });
      return;
    }
    setSaving(true);
    try {
      const lessor = resolveOpecLessorFromCompanyProfile(companyProfile);
      const id = await createEquipmentRentalContract(firestore, currentUser as User, {
        customer: {
          id: customer.id,
          name: customer.name,
          registeredAddress: customer.registeredAddress,
          billingAddress: customer.billingAddress,
          taxId: customer.taxId,
        },
        title,
        startDate,
        endDate,
        billingDayOfMonth: Number(billingDay) || 1,
        vatRatePercent: Number(vatPercent) || 0,
        notes,
        lineItems: lines.map((l) => ({
          description: l.description,
          brand: l.brand,
          serialNumber: l.serialNumber,
          size: l.size,
          horsepower: l.horsepower,
          quantity: Number(l.quantity) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          unit: l.unit,
          ratePeriod: l.ratePeriod,
        })),
        details: {
          ...detailsDraftToInput(details),
          lessorName: lessor.lessorName,
          lessorAddress: lessor.lessorAddress || null,
          lessorTaxId: lessor.lessorTaxId || null,
          lessorAuthorizedSignatory: lessor.lessorAuthorizedSignatory || null,
          lessorIsIndividual: false,
        },
      });
      setCreateOpen(false);
      toast({ title: 'สร้างสัญญาเช่าแล้ว' });
      router.push(`/rent-contracts/${id}`);
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'สร้างไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !currentUser) return null;
  if (!authorized) {
    return (
      <AppShell user={currentUser as User} onLogout={() => {}}>
        <div className="max-w-5xl mx-auto py-10 text-center text-muted-foreground text-sm">
          คุณไม่มีสิทธิ์เข้าถึงเมนูนี้
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="space-y-4 max-w-[1600px] mx-auto text-sm">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-primary flex items-center gap-2">
                <Wrench className="h-5 w-5 shrink-0" /> สัญญาเช่า (Rent contracts)
              </h1>
              <PageGuidance
                compact
                title="แนวทางใช้งาน"
                tips={[
                  'OPEC เป็นผู้ให้เช่าเครื่องมือ/อุปกรณ์แก่ลูกค้า ตามแบบสัญญาเช่าเครื่องจักรกล',
                  'กรอกรายละเอียดเครื่อง (ชนิด ยี่ห้อ หมายเลข ขนาด แรงม้า) และช่องว่างตามข้อสัญญา',
                  'พิมพ์เอกสารสัญญาจากหน้ารายละเอียด · เมื่อถึงวันวางบิลระบบสร้างใบแจ้งหนี้อัตโนมัติ',
                ]}
              />
              {syncing && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> ซิงก์ใบแจ้งหนี้…
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground max-w-3xl leading-snug">
              OPEC เป็นผู้ให้เช่า · แบบสัญญาเช่าเครื่องจักรกล · วางบิลรายเดือนอัตโนมัติ
            </p>
          </div>

          {canCreateContract && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 h-9">
                  <Plus className="h-4 w-4" /> สร้างสัญญาเช่าใหม่
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
                <DialogHeader className="space-y-1 pb-0">
                  <DialogTitle className="text-base">สร้างสัญญาเช่าเครื่องจักรกล (OPEC ผู้ให้เช่า)</DialogTitle>
                  <DialogDescription className="text-xs">
                    กรอกลูกค้าผู้เช่า รายการเครื่องจักรตามแบบสัญญา ค่าเช่า และเงื่อนไขช่องว่างข้อ ๓–๒๕
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-1">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">ลูกค้าผู้เช่า</Label>
                      <Select value={customerId} onValueChange={setCustomerId}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="เลือกลูกค้า…" />
                        </SelectTrigger>
                        <SelectContent>
                          {(customers ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">ชื่อสัญญา</Label>
                      <Input
                        className="h-8 text-xs"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="เช่น เช่าเครื่องจักร — โครงการ ABC"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">วันเริ่ม</Label>
                      <Input type="date" className="h-8 text-xs" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">วันสิ้นสุด</Label>
                      <Input type="date" className="h-8 text-xs" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">วันวางบิล (1–31)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={31}
                        className="h-8 text-xs"
                        value={billingDay}
                        onChange={(e) => setBillingDay(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">VAT %</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        className="h-8 text-xs"
                        value={vatPercent}
                        onChange={(e) => setVatPercent(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">รายการเครื่องจักรกล (ข้อ ๒)</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setLines((prev) => [...prev, emptyEquipmentRentalLineDraft()])}
                      >
                        <Plus className="h-3 w-3 mr-1" /> เพิ่มรายการ
                      </Button>
                    </div>
                    <EquipmentRentalLineItemsEditor lines={lines} onChange={setLines} />
                    <p className="text-[10px] text-muted-foreground">
                      ราคาแบบรายวันจะคำนวณยอดวางบิลรายเดือนด้วยฐาน 30 วัน ตามข้อ ๗ ของสัญญา
                    </p>
                  </div>

                  <EquipmentRentalContractDetailsFields value={details} onChange={setDetails} />

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">หมายเหตุเพิ่มเติม</Label>
                    <Textarea
                      className="text-xs min-h-[72px]"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                    ยกเลิก
                  </Button>
                  <Button size="sm" disabled={saving} onClick={() => void handleCreate()}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileSignature className="h-4 w-4 mr-1" />}
                    บันทึก
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <Alert className="bg-muted/40 border-muted py-2">
          <Info className="h-4 w-4" />
          <AlertTitle className="text-sm font-semibold">การวางบิลอัตโนมัติ</AlertTitle>
          <AlertDescription className="text-xs">
            เมื่องวด ACTIVE และถึงวันวางบิลของเดือน ระบบสร้างใบแจ้งหนี้ DRAFT ให้ — จากนั้นออกใบกำกับภาษีและใบเสร็จรับเงินตามเมนูเดิม
          </AlertDescription>
        </Alert>

        <DocumentListFilterBar
          idPrefix="rent-contracts"
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="ค้นหาเลขสัญญา ชื่อสัญญา หรือลูกค้า…"
          yearCe={yearFilterCe}
          monthScope={monthScope}
          yearOptionsCe={yearOptionsCe}
          onYearCeChange={setYearFilterCe}
          onMonthScopeChange={setMonthScope}
          extraFilters={
            <DocumentStatusFilterSelect
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as 'all' | EquipmentRentalContractStatus)}
              options={[
                { value: 'DRAFT', label: 'ร่าง' },
                { value: 'ACTIVE', label: 'ใช้งาน' },
                { value: 'EXPIRED', label: 'สิ้นสุด' },
                { value: 'CANCELLED', label: 'ยกเลิก' },
              ]}
            />
          }
        />

        <Card className="shadow-sm border overflow-hidden">
          <CardContent className="p-0">
            {loadingContracts ? (
              <div className="py-16 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Table className="text-xs [&_th]:h-8 [&_th]:px-3 [&_th]:py-1.5 [&_td]:px-3 [&_td]:py-1.5">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-semibold">รหัสสัญญา</TableHead>
                    <TableHead className="font-semibold">ชื่อสัญญา</TableHead>
                    <TableHead className="font-semibold">ลูกค้า</TableHead>
                    <TableHead className="font-semibold">ระยะเวลา</TableHead>
                    <TableHead className="font-semibold text-right">ค่าเช่า/เดือน</TableHead>
                    <TableHead className="font-semibold text-center">วันวางบิล</TableHead>
                    <TableHead className="font-semibold">สถานะ</TableHead>
                    <TableHead className="text-right font-semibold">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => router.push(`/rent-contracts/${c.id}`)}
                    >
                      <TableCell className="font-mono text-[11px] font-semibold text-primary">
                        {c.contractNo}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate">{c.title}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{c.customerNameSnapshot}</TableCell>
                      <TableCell className="whitespace-nowrap text-[11px]">
                        {formatYmdRangeThaiBE(c.startDate, c.endDate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        ฿{(Number(c.monthlyRentAmount) || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">{c.billingDayOfMonth}</TableCell>
                      <TableCell>{statusBadge(c.status)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          asChild
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link href={`/rent-contracts/${c.id}`}>
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground italic">
                        ยังไม่มีสัญญาเช่า
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
