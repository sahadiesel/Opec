'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ChevronRight, Home, Info, Loader2, RefreshCw } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import type { RentalContract, RentalPayable } from '@/lib/types';
import { generateDueRentalPayables } from '@/lib/services/rental-contract-service';
import { YearMonthScopeSelects } from '@/components/accounting/year-month-scope-selects';
import {
  buildYearCeOptions,
  currentYearCe,
  describeYearMonthScopeFilter,
  ymMatchesYearMonthScope,
} from '@/lib/date/year-month-scope-filter';
import { useToast } from '@/hooks/use-toast';
import { formatPayrollYearMonthMmYyyyThaiBE, formatYmdLocalThaiBE } from '@/lib/date-thai';

function rentalDueYm(p: RentalPayable): string | null {
  const d = (p.dueDate || '').trim().slice(0, 7);
  return /^\d{4}-\d{2}$/.test(d) ? d : null;
}

/**
 * คิวรอจ่ายตามสัญญาเช่า (rental_payables) — โชว์คู่กับใบรับวางบิล PO ในหน้าบัญชีทำจ่าย
 */
export function RentalPayablesPayoutSection({ enabled }: { enabled: boolean }) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [yearFilterCe, setYearFilterCe] = useState(() => currentYearCe());
  /** ค่าเริ่มต้น 3 เดือนย้อนหลัง — เห็นรอบค้างจ่ายได้กว้างกว่ากรองเดือนเดียว */
  const [monthScope, setMonthScope] = useState(() => 'LAST_3');
  const [healing, setHealing] = useState(false);
  const [healNote, setHealNote] = useState<string | null>(null);
  const autoHealKeyRef = useRef<string>('');

  const pendingQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(collection(firestore, 'rental_payables'), where('status', '==', 'PENDING'));
  }, [firestore, enabled]);

  const contractsQ = useMemoFirebase(() => {
    if (!firestore || !enabled) return null;
    return query(collection(firestore, 'rental_contracts'), where('status', '==', 'ACTIVE'));
  }, [firestore, enabled]);

  const { data: pendingPayables, isLoading } = useCollection<RentalPayable>(pendingQ as any);
  const { data: activeContracts } = useCollection<RentalContract>(contractsQ as any);

  const activeContractIdsKey = useMemo(
    () =>
      (activeContracts || [])
        .map((c) => c.id)
        .sort()
        .join('|'),
    [activeContracts],
  );

  const healDuePayables = async () => {
    if (!firestore || !activeContracts?.length) {
      setHealNote('ไม่มีสัญญาเช่าสถานะใช้งาน');
      return;
    }
    setHealing(true);
    try {
      let created = 0;
      for (const c of activeContracts) {
        created += await generateDueRentalPayables(firestore, c);
      }
      setHealNote(
        created > 0
          ? `สร้างรอบครบกำหนดใหม่ ${created} รายการ`
          : 'ไม่มีรอบใหม่ที่ต้องสร้าง (ครบแล้วหรือยังไม่ถึงวันครบกำหนด)',
      );
      if (created > 0) {
        toast({
          title: 'อัปเดตรอบค่าเช่าแล้ว',
          description: `สร้าง ${created} รายการรอจ่ายตามสัญญา`,
        });
      }
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'สร้างรอบค่าเช่าไม่สำเร็จ',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setHealing(false);
    }
  };

  useEffect(() => {
    if (!firestore || !enabled || !activeContractIdsKey || !activeContracts?.length) return;
    if (autoHealKeyRef.current === activeContractIdsKey) return;
    autoHealKeyRef.current = activeContractIdsKey;
    let cancelled = false;
    void (async () => {
      try {
        let created = 0;
        for (const c of activeContracts) {
          if (cancelled) return;
          created += await generateDueRentalPayables(firestore, c);
        }
        if (!cancelled && created > 0) {
          setHealNote(`สร้างรอบครบกำหนดใหม่ ${created} รายการอัตโนมัติ`);
        }
      } catch {
        /* ignore auto-heal errors — user can refresh manually */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, enabled, activeContractIdsKey, activeContracts]);

  const yearOptionsCe = useMemo(() => {
    const set = new Set<string>();
    (pendingPayables || []).forEach((p) => {
      const ym = rentalDueYm(p);
      if (ym) set.add(ym);
    });
    return buildYearCeOptions(set);
  }, [pendingPayables]);

  const filtered = useMemo(() => {
    const list = pendingPayables || [];
    return list
      .filter((p) => ymMatchesYearMonthScope(rentalDueYm(p), yearFilterCe, monthScope))
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  }, [pendingPayables, yearFilterCe, monthScope]);

  const sumGross = useMemo(
    () => filtered.reduce((s, p) => s + (Number(p.grossAmount) || 0), 0),
    [filtered],
  );

  if (!enabled) return null;

  return (
    <div className="space-y-3">
      <Alert className="border-sky-200 bg-sky-50/80 dark:border-sky-900/40 dark:bg-sky-950/20">
        <Info className="h-4 w-4 text-sky-800 dark:text-sky-300" />
        <AlertTitle className="text-sm font-semibold text-sky-950 dark:text-sky-100">
          รอจ่ายตามสัญญาเช่า
        </AlertTitle>
        <AlertDescription className="text-xs sm:text-sm text-sky-900 dark:text-sky-200/90 space-y-1">
          <p>
            ระบบสร้างรอบค่าเช่าอัตโนมัติเมื่อสัญญาเป็นสถานะใช้งาน และเมื่อถึงวันครบกำหนด — ไม่ต้องผ่านเมนูรับวางบิล
            PO · กด «ทำจ่าย» ที่หน้ารายละเอียดสัญญา
          </p>
          {healNote ? <p className="font-medium">{healNote}</p> : null}
        </AlertDescription>
      </Alert>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <YearMonthScopeSelects
          idPrefix="rental-payout"
          yearCe={yearFilterCe}
          monthScope={monthScope}
          yearOptionsCe={yearOptionsCe}
          onYearCeChange={setYearFilterCe}
          onMonthScopeChange={setMonthScope}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={healing || !activeContracts?.length}
          onClick={() => void healDuePayables()}
        >
          {healing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          ดึงรอบครบกำหนด
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Home className="h-5 w-5 text-primary" />
            รายการรอจ่ายตามสัญญาเช่า
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">กำลังโหลด…</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">เอกสาร</TableHead>
                    <TableHead>สัญญา / งวด</TableHead>
                    <TableHead>ผู้ให้เช่า</TableHead>
                    <TableHead className="text-right">ก่อนภาษี</TableHead>
                    <TableHead className="text-right">VAT</TableHead>
                    <TableHead className="text-right">รวมในใบ</TableHead>
                    <TableHead className="text-right">สุทธิโอน</TableHead>
                    <TableHead>วันครบกำหนด</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead className="text-right pr-6">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => {
                    const href = `/accounting/rental-contracts/${p.contractId}`;
                    return (
                      <TableRow key={p.id} className="hover:bg-muted/40">
                        <TableCell className="pl-6 font-mono text-xs font-bold text-primary">
                          <Link href={href} className="underline-offset-2 hover:underline">
                            {p.contractNo}/{formatPayrollYearMonthMmYyyyThaiBE(p.periodMonth)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-medium">{p.contractNo}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[220px]">
                            {p.description}
                          </div>
                        </TableCell>
                        <TableCell>{p.vendorName || '—'}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          ฿{(
                            Number(p.baseRentAmount) ||
                            Math.max(0, (Number(p.grossAmount) || 0) - (Number(p.vatAmount) || 0))
                          ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          ฿{(Number(p.vatAmount) || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          ฿{(Number(p.grossAmount) || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">
                          ฿{(Number(p.netPayableAmount) || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{formatYmdLocalThaiBE(p.dueDate)}</TableCell>
                        <TableCell>
                          <Badge className="bg-amber-600">รอจ่าย</Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button type="button" variant="ghost" size="icon" asChild>
                            <Link href={href} title="เปิดสัญญาเพื่อทำจ่าย">
                              <ChevronRight className="h-5 w-5" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                        ไม่มีรอบค่าเช่ารอจ่ายใน{' '}
                        {describeYearMonthScopeFilter(yearFilterCe, monthScope)}
                        {(pendingPayables?.length ?? 0) > 0
                          ? ' — ลองเปลี่ยนปี/เดือน หรือกด «ดึงรอบครบกำหนด»'
                          : ' — ตรวจว่าสัญญาเป็นสถานะใช้งานและถึงวันครบกำหนดแล้ว'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {filtered.length > 0 ? (
                <div className="border-t px-6 py-3 bg-muted/25 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <span className="text-muted-foreground">
                    รวมในใบ (ก่อนหัก ณ ที่จ่าย) {filtered.length} รายการ ·{' '}
                    {describeYearMonthScopeFilter(yearFilterCe, monthScope)}
                  </span>
                  <span className="font-mono font-bold tabular-nums">
                    ฿{sumGross.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
