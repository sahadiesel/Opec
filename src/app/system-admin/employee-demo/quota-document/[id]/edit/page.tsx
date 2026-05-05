'use client';

import { use, useMemo, useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useAppUser } from '@/hooks/use-app-user';
import { useFirestore, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, query, updateDoc, where } from 'firebase/firestore';
import type { EmployeeQuotaDocument, JobMode, Position, PurchaseOrder } from '@/lib/types';
import { buildQuotaDocumentLines } from '@/lib/employee-demo/build-quota-document-lines';
import { useToast } from '@/hooks/use-toast';
import { writeAuditLog } from '@/lib/services/audit-service';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
function jobModeLabel(mode: JobMode): string {
  return mode === 'ONSHORE' ? 'Onshore' : 'Offshore';
}

export default function QuotaDocumentEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedPoIds, setSelectedPoIds] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  const docRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'employee_quota_documents', id) : null),
    [firestore, id],
  );
  const { data: quotaDoc, isLoading } = useDoc<EmployeeQuotaDocument>(docRef as any);

  const customerId = quotaDoc?.customerId ?? '';

  const posQuery = useMemoFirebase(() => {
    if (!firestore || !customerId) return null;
    return query(collection(firestore, 'purchase_orders'), where('customerId', '==', customerId));
  }, [firestore, customerId]);

  const { data: customerPOs, isLoading: posLoading } = useCollection<PurchaseOrder>(posQuery as any);

  const positionsQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, 'positions') : null),
    [firestore],
  );
  const { data: positions } = useCollection<Position>(positionsQuery as any);

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

  useEffect(() => {
    if (!quotaDoc?.purchaseOrderIds) return;
    const next: Record<string, boolean> = {};
    for (const poId of quotaDoc.purchaseOrderIds) next[poId] = true;
    setSelectedPoIds(next);
  }, [quotaDoc?.purchaseOrderIds]);

  const togglePo = useCallback((poId: string, checked: boolean) => {
    setSelectedPoIds((prev) => ({ ...prev, [poId]: checked }));
  }, []);

  const selectedIdsList = useMemo(
    () => Object.entries(selectedPoIds).filter(([, v]) => v).map(([pid]) => pid),
    [selectedPoIds],
  );

  const handleSave = async () => {
    if (!firestore || !currentUser || !quotaDoc) return;
    if (selectedIdsList.length === 0) {
      toast({
        variant: 'destructive',
        title: 'เลือก PO',
        description: 'ต้องมีอย่างน้อยหนึ่ง PO',
      });
      return;
    }

    const invalid = selectedIdsList.some((pid) => {
      const po = sortedPOs.find((p) => p.id === pid);
      return !po || po.customerId !== quotaDoc.customerId;
    });
    if (invalid) {
      toast({ variant: 'destructive', title: 'ข้อมูลไม่ถูกต้อง', description: 'กรุณาเลือกเฉพาะ PO ของลูกค้านี้' });
      return;
    }

    setIsSaving(true);
    try {
      const poById = new Map(sortedPOs.map((p) => [p.id, p]));
      const lines = await buildQuotaDocumentLines(firestore, selectedIdsList, poById, positionMap);
      const now = Date.now();
      await updateDoc(doc(firestore, 'employee_quota_documents', id), {
        purchaseOrderIds: selectedIdsList,
        lines,
        updatedAt: now,
        updatedByUserId: currentUser.id,
        updatedByDisplayName: currentUser.displayName,
      });

      await writeAuditLog(firestore, currentUser, {
        actionType: 'UPDATE',
        entityType: 'EmployeeQuotaDocument',
        entityId: id,
        entityLabel: quotaDoc.quotaDocumentNo || id,
        afterSummary: `Updated PO set (${selectedIdsList.length} PO), ${lines.length} position lines`,
        sourceModule: 'system',
        linkedIds: selectedIdsList,
      });

      toast({ title: 'บันทึกแล้ว', description: 'อัปเดตรายการ PO และโควต้าเรียบร้อย' });
      router.push(`/system-admin/employee-demo/quota-document/${id}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'บันทึกไม่สำเร็จ', description: msg });
    } finally {
      setIsSaving(false);
    }
  };

  if (userLoading || !currentUser) return null;

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="mx-auto max-w-4xl space-y-6 p-1">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" asChild className="gap-2">
            <Link href={`/system-admin/employee-demo/quota-document/${id}`}>
              <ArrowLeft className="h-4 w-4" />
              กลับรายละเอียด
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">กำลังโหลด…</p>
        ) : !quotaDoc ? (
          <Card>
            <CardHeader>
              <CardTitle>ไม่พบเอกสาร</CardTitle>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>แก้ไข PO ในเอกสารโควต้า</CardTitle>
              <CardDescription>
                เลขที่ {quotaDoc.quotaDocumentNo ?? quotaDoc.id} · {quotaDoc.customerName} ·{' '}
                {jobModeLabel(quotaDoc.quotaJobMode)} — เลือกเพิ่มหรือถอด PO แล้วกดบันทึก (ระบบคำนวณโควต้าใหม่)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Label>เลือก PO ลูกค้า (หลายใบ)</Label>
              {posLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  กำลังโหลด PO…
                </div>
              ) : sortedPOs.length === 0 ? (
                <p className="text-sm text-muted-foreground">ไม่พบ PO ของลูกค้านี้</p>
              ) : (
                <ScrollArea className="h-[280px] rounded-md border">
                  <div className="divide-y p-2">
                    {sortedPOs.map((po) => (
                      <label
                        key={po.id}
                        className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
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
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{po.title || po.projectName}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              )}

              <Button className="gap-2" onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                บันทึกการแก้ไข
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
