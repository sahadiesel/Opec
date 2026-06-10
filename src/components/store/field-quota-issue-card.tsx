'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import type { Assignment, Position, PositionPPERequirement, PositionToolRequirement, Worker } from '@/lib/types';
import { formatStoreItemLabel } from '@/lib/types';
import type { FieldQuotaPendingLine } from '@/lib/store/field-quota-pending-lines';
import { resolveFieldLineStoreItem } from '@/lib/store/field-quota-pending-lines';

export type FieldQuotaIssueCardModel = {
  assignment: Assignment;
  worker?: Worker;
  position?: Position;
  pendingLines: FieldQuotaPendingLine[];
};

type FieldQuotaIssueCardProps = {
  card: FieldQuotaIssueCardModel;
  lineKey: (assignmentId: string, lineDocId: string) => string;
  fieldLineQty: Record<string, string>;
  setFieldLineQty: Dispatch<SetStateAction<Record<string, string>>>;
  fieldLineSkuId: Record<string, string>;
  setFieldLineSkuId: Dispatch<SetStateAction<Record<string, string>>>;
  fieldActionKey: string | null;
  onIssue: (assignment: Assignment, line: FieldQuotaPendingLine) => void;
  onWaive: (assignment: Assignment, line: FieldQuotaPendingLine) => void;
};

export function FieldQuotaIssueCard({
  card,
  lineKey,
  fieldLineQty,
  setFieldLineQty,
  fieldLineSkuId,
  setFieldLineSkuId,
  fieldActionKey,
  onIssue,
  onWaive,
}: FieldQuotaIssueCardProps) {
  return (
    <Card className="border-primary/15 shadow-sm">
      <CardHeader className="py-4 bg-primary/5 border-b border-primary/10">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              {card.worker
                ? `${card.worker.firstName} ${card.worker.lastName} (${card.worker.workerCode})`
                : `Worker ${card.assignment.workerId}`}
            </CardTitle>
            <CardDescription className="mt-1">
              {card.assignment.projectName} · {card.assignment.assignmentNo} ·{' '}
              <Badge variant="outline" className="text-[10px]">
                {card.assignment.deploymentStatus}
              </Badge>
            </CardDescription>
            <p className="text-xs text-muted-foreground mt-1">
              ตำแหน่ง:{' '}
              <span className="font-semibold text-foreground">
                {card.position?.positionNameTh || card.position?.positionName || card.assignment.positionId}
              </span>
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ประเภท</TableHead>
              <TableHead>รายการ</TableHead>
              <TableHead className="text-right">คงเหลือ/ต้องการ</TableHead>
              <TableHead className="text-right">จำนวนเบิก</TableHead>
              <TableHead className="text-right w-[220px]">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {card.pendingLines.map((line) => {
              const lk = lineKey(card.assignment.id, line.lineDocId);
              const remaining = line.quantityRequired - line.quantityIssued;
              const picked = resolveFieldLineStoreItem(line, lk, fieldLineSkuId);
              const candidates =
                line.candidateItems && line.candidateItems.length > 0
                  ? line.candidateItems
                  : line.defaultItem
                    ? [line.defaultItem]
                    : [];
              const busy = fieldActionKey === lk;
              return (
                <TableRow key={line.lineDocId}>
                  <TableCell>
                    <Badge variant="secondary">{line.kind === 'ppe' ? 'PPE' : 'อุปกรณ์'}</Badge>
                  </TableCell>
                  <TableCell className="min-w-[200px] max-w-[340px]">
                    <div className="font-medium text-sm">
                      {line.kind === 'ppe'
                        ? (line.req as PositionPPERequirement).itemName
                        : (line.req as PositionToolRequirement).itemName}
                    </div>
                    {candidates.length > 1 ? (
                      <div className="mt-2 space-y-1">
                        <Label className="text-[10px] text-muted-foreground">ตัดสต็อกจาก SKU (เลือกไซส์/เบอร์)</Label>
                        <Select
                          value={picked?.id ?? ''}
                          onValueChange={(id) => setFieldLineSkuId((prev) => ({ ...prev, [lk]: id }))}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder="เลือก SKU…" />
                          </SelectTrigger>
                          <SelectContent>
                            {candidates.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {formatStoreItemLabel(c)} · คงเหลือ {c.currentStock}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground leading-snug">
                          เบิกหลายครั้งได้ — ยอดรวมทุก SKU ในกลุ่มนับเข้าโควต้าเดียวกัน
                        </p>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground mt-1">
                        {picked
                          ? `SKU: ${formatStoreItemLabel(picked)} · คงเหลือ ${picked.currentStock}`
                          : 'ยังไม่มี SKU ในคลังที่จับคู่ — แก้ที่ตำแหน่งงาน'}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    เบิกแล้ว {line.quantityIssued} / {line.quantityRequired}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      className="h-9 w-20 ml-auto text-right"
                      type="number"
                      min={1}
                      max={remaining}
                      value={
                        fieldLineQty[lk] !== undefined ? fieldLineQty[lk] : String(Math.max(1, remaining))
                      }
                      onChange={(e) => setFieldLineQty((prev) => ({ ...prev, [lk]: e.target.value }))}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        className="h-8"
                        disabled={busy || !picked || remaining <= 0}
                        onClick={() => onIssue(card.assignment, line)}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        เบิก
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={busy || remaining <= 0}
                        onClick={() => onWaive(card.assignment, line)}
                      >
                        ไม่ประสงค์เบิก
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
