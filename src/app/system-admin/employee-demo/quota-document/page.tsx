'use client';

import { useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, query, setDoc, where, orderBy, limit } from 'firebase/firestore';
import {
  Customer,
  EmployeeQuotaDocument,
  JobMode,
  Position,
  PurchaseOrder,
} from '@/lib/types';
import { buildQuotaDocumentLines } from '@/lib/employee-demo/build-quota-document-lines';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FileText, Building2, Eye, Pencil } from 'lucide-react';
import { writeAuditLog } from '@/lib/services/audit-service';
import { cn } from '@/lib/utils';
import { formatDateThaiBE, formatTimeThaiBE } from '@/lib/date-thai';

function jobModeLabel(mode: JobMode): string {
  return mode === 'ONSHORE' ? 'Onshore' : 'Offshore';
}

function displayDocNo(d: Pick<EmployeeQuotaDocument, 'id' | 'quotaDocumentNo'>): string {
  return d.quotaDocumentNo?.trim() || d.id;
}

export default function EmployeeDemoQuotaDocumentPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [customerId, setCustomerId] = useState<string>('');
  const [quotaJobMode, setQuotaJobMode] = useState<JobMode>('OFFSHORE');
  const [selectedPoIds, setSelectedPoIds] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  const listQuery = useMemoFirebase(
    () =>
      firestore
        ? query(
            collection(firestore, 'employee_quota_documents'),
            orderBy('createdAt', 'desc'),
            limit(100),
          )
        : null,
    [firestore],
  );
  const { data: quotaDocs, isLoading: listLoading } = useCollection<EmployeeQuotaDocument>(listQuery as any);

  const customersQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, 'customers') : null),
    [firestore],
  );
  const { data: customers, isLoading: customersLoading } = useCollection<Customer>(customersQuery as any);

  const positionsQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, 'positions') : null),
    [firestore],
  );
  const { data: positions } = useCollection<Position>(positionsQuery as any);

  const posQuery = useMemoFirebase(() => {
    if (!firestore || !customerId) return null;
    return query(collection(firestore, 'purchase_orders'), where('customerId', '==', customerId));
  }, [firestore, customerId]);

  const { data: customerPOs, isLoading: posLoading } = useCollection<PurchaseOrder>(posQuery as any);

  const sortedCustomers = useMemo(
    () =>
      [...(customers ?? [])].sort((a, b) => {
        const inactive = (x: Customer) => (x.isActive === false ? 1 : 0);
        const d = inactive(a) - inactive(b);
        return d !== 0 ? d : a.name.localeCompare(b.name, 'th');
      }),
    [customers],
  );

  const sortedPOs = useMemo(() => {
    const list = [...(customerPOs ?? [])].filter((p) => p.status !== 'closed');
    list.sort((a, b) => (a.poCode || '').localeCompare(b.poCode || '', undefined, { numeric: true }));
    return list;
  }, [customerPOs]);

  const positionMap = useMemo(() => {
    const m = new Map<string, Position>();
    for (const p of positions ?? []) m.set(p.id, p);
    return m;
  }, [positions]);

  const selectedCustomer = useMemo(
    () => sortedCustomers.find((c) => c.id === customerId),
    [sortedCustomers, customerId],
  );

  const togglePo = useCallback((poId: string, checked: boolean) => {
    setSelectedPoIds((prev) => ({ ...prev, [poId]: checked }));
  }, []);

  const selectedIdsList = useMemo(
    () => Object.entries(selectedPoIds).filter(([, v]) => v).map(([id]) => id),
    [selectedPoIds],
  );

  const resetCreateForm = useCallback(() => {
    setCustomerId('');
    setQuotaJobMode('OFFSHORE');
    setSelectedPoIds({});
  }, []);

  const onCustomerChange = (value: string) => {
    setCustomerId(value);
    setSelectedPoIds({});
  };

  const handleCreate = async () => {
    if (!firestore || !currentUser) return;
    if (!customerId) {
      toast({ variant: 'destructive', title: 'เลือกลูกค้า', description: 'กรุณาเลือกลูกค้าก่อนสร้างเอกสาร' });
      return;
    }
    if (selectedIdsList.length === 0) {
      toast({
        variant: 'destructive',
        title: 'เลือก PO',
        description: 'เลือกอย่างน้อยหนึ่งใบสั่งซื้อลูกค้า (Customer PO)',
      });
      return;
    }

    const invalidPo = selectedIdsList.some((pid) => {
      const po = sortedPOs.find((p) => p.id === pid);
      return !po || po.customerId !== customerId;
    });
    if (invalidPo) {
      toast({ variant: 'destructive', title: 'ข้อมูล PO ไม่สอดคล้อง', description: 'กรุณาเลือก PO ใหม่' });
      return;
    }

    setIsSaving(true);
    try {
      const { code: quotaDocumentNo } = await generateNextDocumentCode(firestore, 'employee_quota_document', {
        actor: currentUser.displayName,
        userId: currentUser.id,
      });

      const poById = new Map(sortedPOs.map((p) => [p.id, p]));
      const lines = await buildQuotaDocumentLines(firestore, selectedIdsList, poById, positionMap);

      const docRef = doc(collection(firestore, 'employee_quota_documents'));
      const now = Date.now();
      const payload = {
        quotaDocumentNo,
        customerId,
        customerName: selectedCustomer?.name ?? '',
        quotaJobMode,
        purchaseOrderIds: [...selectedIdsList],
        lines,
        createdAt: now,
        updatedAt: now,
        createdByUserId: currentUser.id,
        createdByDisplayName: currentUser.displayName,
      };
      await setDoc(docRef, payload);

      await writeAuditLog(firestore, currentUser, {
        actionType: 'CREATE',
        entityType: 'EmployeeQuotaDocument',
        entityId: docRef.id,
        entityLabel: quotaDocumentNo,
        afterSummary: `Quota doc ${quotaDocumentNo} from ${selectedIdsList.length} PO(s), ${lines.length} position line(s)`,
        sourceModule: 'system',
        linkedIds: selectedIdsList,
      });

      toast({
        title: 'สร้างเอกสารโควต้าแล้ว',
        description: `${quotaDocumentNo} · ${lines.length} ตำแหน่ง · ${selectedIdsList.length} PO`,
      });

      resetCreateForm();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'สร้างไม่สำเร็จ', description: msg });
    } finally {
      setIsSaving(false);
    }
  };

  if (userLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-5xl space-y-8 p-1">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-primary">
            <FileText className="h-7 w-7" />
            สร้างเอกสารโควต้า
          </h1>
          <p className="text-sm text-muted-foreground">
            เลือกลูกค้า ประเภทโควต้า Onshore/Offshore และ PO หลายใบ — ระบบจะรวมจำนวนตามตำแหน่งจากทุกบรรทัด PO ที่ยัง active
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              เงื่อนไขการสร้าง
            </CardTitle>
            <CardDescription>ขั้นตอน: ลูกค้า → ประเภทโควต้า → เลือก PO → กดสร้าง (หลังสร้างฟอร์มจะถูกเคลียร์)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>1. เลือกลูกค้า</Label>
              <Select value={customerId} onValueChange={onCustomerChange} disabled={customersLoading}>
                <SelectTrigger className="max-w-lg">
                  <SelectValue placeholder={customersLoading ? 'กำลังโหลด…' : '— เลือกลูกค้า —'} />
                </SelectTrigger>
                <SelectContent>
                  {sortedCustomers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.customerCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label>2. ประเภทโควต้าลูกจ้าง (ใช้อ้างอิงราคา)</Label>
              <RadioGroup
                value={quotaJobMode}
                onValueChange={(v) => setQuotaJobMode(v as JobMode)}
                className="flex flex-wrap gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="ONSHORE" id="qm-onshore" />
                  <Label htmlFor="qm-onshore" className="cursor-pointer font-normal">
                    Onshore
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="OFFSHORE" id="qm-offshore" />
                  <Label htmlFor="qm-offshore" className="cursor-pointer font-normal">
                    Offshore
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label>3. เลือก PO ลูกค้า (เลือกได้หลายใบ)</Label>
              {!customerId ? (
                <p className="text-sm text-muted-foreground">เลือกลูกค้าก่อน แล้วรายการ PO จะแสดงด้านล่าง</p>
              ) : posLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  กำลังโหลด PO…
                </div>
              ) : sortedPOs.length === 0 ? (
                <p className="text-sm text-muted-foreground">ไม่พบ PO ของลูกค้านี้ (หรือถูกปิดทั้งหมด)</p>
              ) : (
                <ScrollArea className="h-[220px] rounded-md border">
                  <div className="divide-y p-2">
                    {sortedPOs.map((po) => (
                      <label
                        key={po.id}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50',
                        )}
                      >
                        <Checkbox
                          checked={!!selectedPoIds[po.id]}
                          onCheckedChange={(c) => togglePo(po.id, c === true)}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-semibold">{po.poCode}</span>
                            <Badge variant={po.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
                              {po.status}
                            </Badge>
                            {po.poWorkMode ? (
                              <Badge variant="outline" className="text-[10px]">
                                PO: {jobModeLabel(po.poWorkMode)}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{po.title || po.projectName}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>

            <Button className="gap-2" onClick={handleCreate} disabled={isSaving || !customerId}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              สร้างเอกสารโควต้า
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">รายการเอกสารโควต้า</CardTitle>
            <CardDescription>เรียงจากวันที่สร้างล่าสุด — กดดูรายละเอียดหรือแก้ไข PO</CardDescription>
          </CardHeader>
          <CardContent>
            {listLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <Loader2 className="h-4 w-4 animate-spin" />
                กำลังโหลดรายการ…
              </div>
            ) : !quotaDocs?.length ? (
              <p className="text-sm text-muted-foreground py-4">ยังไม่มีเอกสาร</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เลขที่เอกสาร</TableHead>
                    <TableHead>วันที่สร้าง</TableHead>
                    <TableHead>ลูกค้า</TableHead>
                    <TableHead>โควต้า</TableHead>
                    <TableHead className="text-right">จำนวน PO</TableHead>
                    <TableHead className="text-right w-[200px]">การทำงาน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotaDocs.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-sm font-medium">{displayDocNo(row)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {row.createdAt
                          ? `${formatDateThaiBE(row.createdAt)} ${formatTimeThaiBE(row.createdAt)}`
                          : '—'}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-sm">{row.customerName}</TableCell>
                      <TableCell className="text-sm">{jobModeLabel(row.quotaJobMode)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.purchaseOrderIds?.length ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" className="h-8 gap-1" asChild>
                            <Link href={`/system-admin/employee-demo/quota-document/${row.id}`}>
                              <Eye className="h-3.5 w-3.5" />
                              รายละเอียด
                            </Link>
                          </Button>
                          <Button variant="secondary" size="sm" className="h-8 gap-1" asChild>
                            <Link href={`/system-admin/employee-demo/quota-document/${row.id}/edit`}>
                              <Pencil className="h-3.5 w-3.5" />
                              แก้ไข
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
