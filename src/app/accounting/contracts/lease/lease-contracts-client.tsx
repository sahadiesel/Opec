'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, orderBy, query } from 'firebase/firestore';
import { ArrowLeft, Building2, Car, FileSignature, Loader2, Plus, Search } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAppUser } from '@/hooks/use-app-user';
import { useCompanyDocumentProfile } from '@/hooks/use-company-document-profile';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { canView } from '@/lib/permissions';
import { isAccountingManager, isAccountingOfficer, isSystemAdmin } from '@/lib/permission-core';
import type { LeaseContractKind, RentalContract, RentalContractStatus, User, Vendor } from '@/lib/types';
import { createRentalContract } from '@/lib/services/rental-contract-service';

function statusBadge(status: RentalContractStatus) {
  const label: Record<RentalContractStatus, string> = {
    DRAFT: 'ร่าง',
    PENDING_APPROVAL: 'รออนุมัติ',
    ACTIVE: 'ใช้งาน',
    REJECTED: 'ส่งกลับ',
    CANCELLED: 'ยกเลิก',
    EXPIRED: 'สิ้นสุด',
  };
  if (status === 'ACTIVE') return <Badge className="bg-emerald-600">{label[status]}</Badge>;
  if (status === 'PENDING_APPROVAL') return <Badge className="bg-amber-600">{label[status]}</Badge>;
  if (status === 'CANCELLED' || status === 'REJECTED') return <Badge variant="destructive">{label[status]}</Badge>;
  return <Badge variant="outline">{label[status]}</Badge>;
}

function matchesLeaseKind(row: RentalContract, kind: LeaseContractKind): boolean {
  if (kind === 'VEHICLE') return row.leaseKind === 'VEHICLE';
  return row.leaseKind !== 'VEHICLE';
}

const TITLES: Record<LeaseContractKind, { title: string; subtitle: string }> = {
  PROPERTY: {
    title: '1.1 สัญญาเช่าบ้าน/อาคาร/โรงงาน',
    subtitle: 'OPEC เป็นผู้เช่า · กรอกที่ตั้งทรัพย์สินและเงื่อนไขค่าเช่า',
  },
  VEHICLE: {
    title: '1.2 สัญญาเช่ารถยนต์',
    subtitle: 'OPEC เป็นผู้เช่า · กรอกยี่ห้อ ทะเบียน ค่าเช่าล่วงหน้า และเงินประกัน',
  },
};

export function LeaseContractsClient({ leaseKind }: { leaseKind: LeaseContractKind }) {
  const router = useRouter();
  const { currentUser, isLoading } = useAppUser();
  const { profile: companyProfile } = useCompanyDocumentProfile();
  const firestore = useFirestore();
  const { toast } = useToast();
  const authorized = !!currentUser && canView(currentUser, 'accounts_payable');
  const canCreate =
    !!currentUser &&
    (isSystemAdmin(currentUser) || isAccountingManager(currentUser) || isAccountingOfficer(currentUser));
  const meta = TITLES[leaseKind];
  const tenantNameFromSystem = companyProfile?.companyNameTh?.trim() || '';

  const contractsQuery = useMemoFirebase(
    () =>
      firestore && authorized
        ? query(collection(firestore, 'rental_contracts'), orderBy('createdAt', 'desc'))
        : null,
    [firestore, authorized],
  );
  const vendorsQuery = useMemoFirebase(
    () => (firestore && authorized ? query(collection(firestore, 'vendors'), orderBy('vendorName', 'asc')) : null),
    [firestore, authorized],
  );
  const { data: contracts, isLoading: contractsLoading } = useCollection<RentalContract>(contractsQuery as never);
  const { data: vendors } = useCollection<Vendor>(vendorsQuery as never);

  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [description, setDescription] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [propertyCategory, setPropertyCategory] = useState<'HOUSE' | 'BUILDING' | 'FACTORY' | 'OTHER'>('BUILDING');
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [vehiclePlateNo, setVehiclePlateNo] = useState('');
  const [leaseDurationMonths, setLeaseDurationMonths] = useState('');
  const [advanceRentMonths, setAdvanceRentMonths] = useState('0');
  const [securityDepositAmount, setSecurityDepositAmount] = useState('0');
  const [madeAtLocation, setMadeAtLocation] = useState('');
  const [contractDate, setContractDate] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [paymentDay, setPaymentDay] = useState('1');
  const [whtRate, setWhtRate] = useState('5');
  const [notes, setNotes] = useState('');

  const visible = useMemo(() => {
    const scoped = (contracts ?? []).filter((row) => matchesLeaseKind(row, leaseKind));
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((row) =>
      [
        row.contractNo,
        row.lessorVendorName,
        row.rentedItemDescription,
        row.vehicleBrand,
        row.vehiclePlateNo,
        row.propertyAddress,
        row.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [contracts, search, leaseKind]);

  const resetForm = () => {
    setVendorId('');
    setDescription('');
    setPropertyAddress('');
    setPropertyCategory('BUILDING');
    setVehicleBrand('');
    setVehiclePlateNo('');
    setLeaseDurationMonths('');
    setAdvanceRentMonths('0');
    setSecurityDepositAmount('0');
    setMadeAtLocation('');
    setContractDate('');
    setMonthlyRent('');
    setStartDate('');
    setEndDate('');
    setPaymentDay('1');
    setWhtRate('5');
    setNotes('');
  };

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    const lessor = (vendors ?? []).find((v) => v.id === vendorId);
    if (!lessor) {
      toast({ variant: 'destructive', title: 'กรุณาเลือกผู้ให้เช่า' });
      return;
    }
    setSaving(true);
    try {
      const id = await createRentalContract(firestore, currentUser as User, {
        leaseKind,
        lessor,
        rentedItemDescription: description,
        propertyAddress,
        propertyCategory: leaseKind === 'PROPERTY' ? propertyCategory : undefined,
        vehicleBrand,
        vehiclePlateNo,
        leaseDurationMonths: leaseDurationMonths ? Number(leaseDurationMonths) : undefined,
        advanceRentMonths: advanceRentMonths ? Number(advanceRentMonths) : undefined,
        securityDepositAmount: securityDepositAmount ? Number(securityDepositAmount) : undefined,
        madeAtLocation,
        contractDate,
        monthlyRentAmount: Number(monthlyRent),
        startDate,
        endDate,
        paymentDayOfMonth: Number(paymentDay),
        withholdingTaxRatePercent: Number(whtRate),
        notes,
      });
      setOpen(false);
      resetForm();
      toast({ title: 'สร้างสัญญาฉบับร่างแล้ว' });
      router.push(`/accounting/rental-contracts/${id}`);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'สร้างสัญญาไม่สำเร็จ',
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !currentUser) return null;

  if (!authorized) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="py-16 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าถึง</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-[1500px] space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/accounting/contracts/lease"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
                {leaseKind === 'VEHICLE' ? <Car className="h-8 w-8" /> : <Building2 className="h-8 w-8" />}
                {meta.title}
              </h1>
              <p className="text-muted-foreground">{meta.subtitle}</p>
            </div>
          </div>
          {canCreate ? (
            <Button
              onClick={() => {
                resetForm();
                setOpen(true);
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" /> สร้างสัญญา
            </Button>
          ) : null}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">รายการสัญญา</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาเลขที่สัญญา ผู้ให้เช่า หรือรายละเอียด…"
              />
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลขที่สัญญา</TableHead>
                    <TableHead>ผู้ให้เช่า</TableHead>
                    <TableHead>{leaseKind === 'VEHICLE' ? 'รถยนต์' : 'สิ่งที่เช่า'}</TableHead>
                    <TableHead className="text-right">ค่าเช่า/เดือน</TableHead>
                    <TableHead>ระยะเวลา</TableHead>
                    <TableHead>จ่ายวันที่</TableHead>
                    <TableHead>หัก ณ ที่จ่าย</TableHead>
                    <TableHead>สถานะ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => router.push(`/accounting/rental-contracts/${row.id}`)}
                    >
                      <TableCell className="font-mono font-semibold text-primary">
                        <Link href={`/accounting/rental-contracts/${row.id}`}>{row.contractNo}</Link>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {row.lessorVendorName}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[22rem] truncate" title={row.rentedItemDescription}>
                        {row.rentedItemDescription}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.monthlyRentAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{row.startDate} — {row.endDate}</TableCell>
                      <TableCell className="text-center">{row.paymentDayOfMonth}</TableCell>
                      <TableCell className="text-center">{row.withholdingTaxRatePercent}%</TableCell>
                      <TableCell>{statusBadge(row.status)}</TableCell>
                    </TableRow>
                  ))}
                  {!contractsLoading && visible.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-16 text-center text-muted-foreground">
                        ยังไม่มีสัญญาประเภทนี้
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSignature className="h-5 w-5" /> สร้าง{meta.title.replace(/^\d+\.\d+\s*/, '')}
            </DialogTitle>
            <DialogDescription>สร้างเป็นฉบับร่างก่อน แล้วส่ง Manager/Admin อนุมัติเพื่อเริ่มรอบรายเดือน</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>ผู้เช่า</Label>
              <Input
                value={tenantNameFromSystem || 'กำลังโหลดจากโปรไฟล์บริษัท…'}
                disabled
                title="ดึงจาก System → Document Header Profile (companyNameTh)"
              />
            </div>
            <div className="space-y-2">
              <Label>ทำสัญญาที่</Label>
              <Input value={madeAtLocation} onChange={(e) => setMadeAtLocation(e.target.value)} placeholder="เช่น สำนักงานใหญ่" />
            </div>
            <div className="space-y-2">
              <Label>วันที่ทำสัญญา</Label>
              <Input type="date" value={contractDate} onChange={(e) => setContractDate(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>ผู้ให้เช่า (เลือกจากคู่ค้า)</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger><SelectValue placeholder="เลือกคู่ค้า ACTIVE" /></SelectTrigger>
                <SelectContent>
                  {(vendors ?? []).filter((v) => v.status === 'ACTIVE').map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.vendorName} · {v.vendorCode}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {leaseKind === 'PROPERTY' ? (
              <>
                <div className="space-y-2">
                  <Label>ประเภททรัพย์สิน</Label>
                  <Select value={propertyCategory} onValueChange={(v) => setPropertyCategory(v as typeof propertyCategory)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HOUSE">บ้าน</SelectItem>
                      <SelectItem value="BUILDING">อาคาร</SelectItem>
                      <SelectItem value="FACTORY">โรงงาน</SelectItem>
                      <SelectItem value="OTHER">อื่นๆ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>ที่ตั้ง / ที่อยู่ทรัพย์สิน</Label>
                  <Textarea value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>รายละเอียดสิ่งที่เช่า (ถ้ามี)</Label>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="เช่น ชั้น 2 ห้องสำนักงาน" />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>ยี่ห้อรถยนต์</Label>
                  <Input value={vehicleBrand} onChange={(e) => setVehicleBrand(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>เลขทะเบียน</Label>
                  <Input value={vehiclePlateNo} onChange={(e) => setVehiclePlateNo(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>ระยะเวลาเช่า (เดือน)</Label>
                  <Input type="number" min="1" value={leaseDurationMonths} onChange={(e) => setLeaseDurationMonths(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>ชำระค่าเช่าล่วงหน้า (เดือน)</Label>
                  <Input type="number" min="0" value={advanceRentMonths} onChange={(e) => setAdvanceRentMonths(e.target.value)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>เงินประกันการเช่า (บาท)</Label>
                  <Input type="number" min="0" step="0.01" value={securityDepositAmount} onChange={(e) => setSecurityDepositAmount(e.target.value)} />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label>ราคาเช่าต่อเดือน</Label>
              <Input type="number" min="0" step="0.01" value={monthlyRent} onChange={(e) => setMonthlyRent(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>หัก ณ ที่จ่าย (%)</Label>
              <Input type="number" min="0" max="100" step="0.01" value={whtRate} onChange={(e) => setWhtRate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>เริ่มเช่า</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>สิ้นสุด</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>ครบกำหนดจ่ายวันที่ของทุกเดือน (1–31)</Label>
              <Input type="number" min="1" max="31" value={paymentDay} onChange={(e) => setPaymentDay(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>หมายเหตุ</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>ยกเลิก</Button>
            <Button onClick={() => void handleCreate()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'สร้างฉบับร่าง'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
