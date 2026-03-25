'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFirestore, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { User, DrugTestPanelConfig, DrugTestPanelSubstance } from '@/lib/types';
import { isSystemAdmin } from '@/lib/permissions';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, FlaskConical, Save } from 'lucide-react';
import { DRUG_TEST_PANEL_DOC_PATH } from '@/lib/drug-test-panel';

const PANEL_DOC_ID = DRUG_TEST_PANEL_DOC_PATH[1];

export default function DrugTestPanelSettingsPage() {
  const firestore = useFirestore();
  const { toast } = useToast();
  const { isUserLoading } = useUser();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [rows, setRows] = useState<DrugTestPanelSubstance[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const s = localStorage.getItem('opsflow_user');
    if (s) {
      try {
        setCurrentUser(JSON.parse(s));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const panelRef = useMemoFirebase(
    () => (firestore ? doc(firestore, DRUG_TEST_PANEL_DOC_PATH[0], PANEL_DOC_ID) : null),
    [firestore]
  );
  const { data: panelDoc, isLoading } = useDoc<DrugTestPanelConfig>(panelRef as any);

  useEffect(() => {
    if (panelDoc?.substances && Array.isArray(panelDoc.substances)) {
      setRows(panelDoc.substances);
    } else {
      setRows([]);
    }
  }, [panelDoc]);

  const isAdmin = useMemo(() => isSystemAdmin(currentUser), [currentUser]);

  const addRow = () => {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `sub_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    setRows((r) => [...r, { id, label: '' }]);
  };

  const removeRow = (id: string) => setRows((r) => r.filter((x) => x.id !== id));

  const handleSave = async () => {
    if (!firestore || !currentUser) return;
    const cleaned = rows
      .map((x) => ({ id: x.id, label: x.label.trim() }))
      .filter((x) => x.label.length > 0);
    setIsSaving(true);
    try {
      await setDoc(
        doc(firestore, DRUG_TEST_PANEL_DOC_PATH[0], PANEL_DOC_ID),
        {
          substances: cleaned,
          updatedAt: Date.now(),
          updatedBy: currentUser.displayName || currentUser.email,
        } as DrugTestPanelConfig,
        { merge: true }
      );
      toast({ title: 'บันทึกแล้ว', description: 'รายการสารสำหรับแผงตรวจถูกอัปเดต' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsSaving(false);
    }
  };

  if (isUserLoading || !currentUser) return null;

  if (!isAdmin) {
    return (
      <AppShell user={currentUser} onLogout={() => {}}>
        <div className="p-8 text-center text-muted-foreground">จำกัดเฉพาะผู้ดูแลระบบ</div>
      </AppShell>
    );
  }

  return (
    <AppShell user={currentUser} onLogout={() => {}}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <FlaskConical className="h-7 w-7" />
            ตั้งค่าแผงตรวจสารเสพติด
          </h1>
          <p className="text-muted-foreground mt-1">
            กำหนดรายการสารที่ต้องตรวจ — หน้าบันทึกผลคนงานและสรุปบนแดชบอร์ดจะอ้างอิงจากรายการนี้
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>รายการสาร (Substances)</CardTitle>
            <CardDescription>เพิ่ม/ลบแถวได้ตามนโยบายองค์กร (ไม่มีวันหมดอายุในระบบ)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="py-12 flex justify-center text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {rows.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">ยังไม่มีรายการ — กด &quot;เพิ่มสาร&quot; เพื่อเริ่ม</p>
                  )}
                  {rows.map((row, idx) => (
                    <div key={row.id} className="flex gap-2 items-end">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs text-muted-foreground">ชื่อสาร #{idx + 1}</Label>
                        <Input
                          value={row.label}
                          onChange={(e) =>
                            setRows((r) => r.map((x) => (x.id === row.id ? { ...x, label: e.target.value } : x)))
                          }
                          placeholder="เช่น Amphetamine, Cannabis, ฯลฯ"
                        />
                      </div>
                      <Button type="button" variant="outline" size="icon" onClick={() => removeRow(row.id)} className="shrink-0">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={addRow} className="gap-2">
                    <Plus className="h-4 w-4" /> เพิ่มสาร
                  </Button>
                  <Button type="button" onClick={handleSave} disabled={isSaving} className="gap-2">
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    บันทึกการตั้งค่า
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
