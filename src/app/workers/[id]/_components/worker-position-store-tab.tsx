'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import { collection, getDocs } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type {
  Assignment,
  PositionPPERequirement,
  PositionToolRequirement,
  PositionRequirementKind,
  Worker,
} from '@/lib/types';
import {
  fulfillmentLineDocId,
  isMobilizationInStoreFulfillmentScope,
  loadFulfillmentMap,
  appliesPpeRequirement,
  appliesToolRequirement,
  thaiFulfillmentLabel,
} from '@/lib/store/mobilization-fulfillment';

type LineRow = {
  mobilizationId: string;
  projectLabel: string;
  deploymentStatus: string;
  requirementLabel: string;
  quantityRequired: number;
  quantityIssued: number;
  statusKey: 'PENDING' | 'PARTIAL' | 'ISSUED' | 'WAIVED' | 'RETURNED';
};

export function WorkerPositionStoreTab(props: {
  firestore: Firestore;
  worker: Worker;
  mobilizations: Assignment[] | undefined;
  kind: PositionRequirementKind;
}) {
  const { firestore, worker, mobilizations, kind } = props;
  const [rows, setRows] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);

  const scopedMobs = useMemo(
    () => (mobilizations || []).filter((m) => isMobilizationInStoreFulfillmentScope(m)),
    [mobilizations],
  );

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!firestore) {
        setRows([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const out: LineRow[] = [];
      for (const m of scopedMobs) {
        const ppeRef = collection(firestore, 'positions', m.positionId, 'ppe_requirements');
        const toolRef = collection(firestore, 'positions', m.positionId, 'tool_requirements');
        const [ppeSnap, toolSnap, fmap] = await Promise.all([
          getDocs(ppeRef),
          getDocs(toolRef),
          loadFulfillmentMap(firestore, m.id),
        ]);
        const posPPE = ppeSnap.docs.map((d) => ({ ...d.data(), id: d.id } as PositionPPERequirement));
        const posTools = toolSnap.docs.map((d) => ({ ...d.data(), id: d.id } as PositionToolRequirement));

        const reqs: Array<{ id: string; label: string; qty: number; kind: PositionRequirementKind }> = [];
        if (kind === 'ppe') {
          for (const p of posPPE) {
            if (!appliesPpeRequirement(p)) continue;
            reqs.push({
              id: p.id,
              label: p.itemName || p.itemCode || p.id,
              qty: Number(p.quantityDefault || 1),
              kind: 'ppe',
            });
          }
        } else {
          for (const t of posTools) {
            if (!appliesToolRequirement(t)) continue;
            reqs.push({
              id: t.id,
              label: t.itemName || t.itemCode || t.id,
              qty: Number(t.quantityDefault || 1),
              kind: 'tool',
            });
          }
        }

        for (const r of reqs) {
          const lid = fulfillmentLineDocId(r.kind, r.id);
          const line = fmap.get(lid);
          const qIssued = Number(line?.quantityIssued || 0);
          const st = line?.status || 'PENDING';
          const statusKey =
            st === 'WAIVED' || st === 'RETURNED' || st === 'ISSUED' || st === 'PARTIAL'
              ? st
              : qIssued >= r.qty
                ? 'ISSUED'
                : qIssued > 0
                  ? 'PARTIAL'
                  : 'PENDING';
          out.push({
            mobilizationId: m.id,
            projectLabel: `${m.projectName} (${m.assignmentNo || m.id.slice(0, 6)})`,
            deploymentStatus: m.deploymentStatus,
            requirementLabel: r.label,
            quantityRequired: r.qty,
            quantityIssued: qIssued,
            statusKey,
          });
        }
      }
      if (!cancelled) {
        setRows(out);
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [firestore, scopedMobs, kind]);

  const positionOnlyHint =
    scopedMobs.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        ยังไม่มีงานมอบหมายในช่วงที่ต้องเบิกคลัง — เมื่อมีการมอบหมายงาน รายการตามตำแหน่งจะแสดงที่นี่พร้อมสถานะจากแผนกสโตร์
      </p>
    ) : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{kind === 'ppe' ? 'รายการ PPE ตามงานมอบหมาย' : 'รายการอุปกรณ์ตามงานมอบหมาย'}</CardTitle>
          <CardDescription>
            ดึงจากตำแหน่งในแต่ละ mobilization และสถานะที่สโตร์บันทึก (เบิก / ไม่ประสงค์เบิก / คืน)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {positionOnlyHint}
          {loading ? (
            <p className="text-sm text-muted-foreground">กำลังโหลดรายการ…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {scopedMobs.length === 0
                ? '—'
                : kind === 'ppe'
                  ? 'ไม่มีรายการ PPE บังคับสำหรับตำแหน่งในงานที่เปิดอยู่'
                  : 'ไม่มีรายการอุปกรณ์ที่อนุญาตเบิกสำหรับตำแหน่งในงานที่เปิดอยู่'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>งาน / โครงการ</TableHead>
                  <TableHead>รายการ</TableHead>
                  <TableHead className="text-right">ต้องการ</TableHead>
                  <TableHead className="text-right">เบิกแล้ว</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead>ขั้นงาน</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.mobilizationId}-${r.requirementLabel}-${i}`}>
                    <TableCell className="font-medium text-sm">{r.projectLabel}</TableCell>
                    <TableCell>{r.requirementLabel}</TableCell>
                    <TableCell className="text-right">{r.quantityRequired}</TableCell>
                    <TableCell className="text-right">{r.quantityIssued}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {thaiFulfillmentLabel(r.statusKey, r.quantityRequired, r.quantityIssued)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.deploymentStatus}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground">
            ตำแหน่งหลักในประวัติ: {worker.currentPositionId ? worker.currentPositionId : '—'} (สถานะเบิกผูกกับแต่ละงานมอบหมาย)
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
