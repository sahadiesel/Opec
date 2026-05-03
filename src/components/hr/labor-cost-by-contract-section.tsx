'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Building2, Trash2 } from 'lucide-react';
import type { MainContract, Position } from '@/lib/types';
import { mainContractsForLaborCostRegistry } from '@/lib/payroll/position-labor-cost-contract-rows';

type Row = NonNullable<Position['laborCostByContract']>[number];

type Props = {
  rows: Row[];
  isEditing: boolean;
  canView: boolean;
  canEdit: boolean;
  contracts: MainContract[] | undefined;
  customerNameById: Map<string, string>;
  onChange: (next: Row[]) => void;
};

function parseMoney(raw: string): number | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function LaborCostByContractSection({
  rows,
  isEditing,
  canView,
  canEdit,
  contracts,
  customerNameById,
  onChange,
}: Props) {
  if (!canView) return null;

  const disabled = !isEditing || !canEdit;

  const activeContractIds = useMemo(
    () => new Set(mainContractsForLaborCostRegistry(contracts ?? []).map((c) => c.id)),
    [contracts],
  );

  const patchRow = (index: number, patch: Partial<Row>) => {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange(next);
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  return (
    <Card className="border-amber-200/60 bg-amber-50/20 shadow-sm">
      <CardHeader className="bg-amber-100/30 border-b border-amber-100/80">
        <div className="flex flex-wrap items-center gap-2">
          <Building2 className="h-5 w-5 text-amber-900" />
          <CardTitle className="text-lg text-amber-950">ต้นทุนค่าแรงตามสัญญา (ทะเบียนตำแหน่ง)</CardTitle>
          <Badge variant="outline" className="text-[10px] border-amber-800/25 text-amber-950">
            payroll × timesheet.contractId
          </Badge>
        </div>
        <CardDescription className="text-amber-950/85">
          แสดงสัญญาหลักที่สถานะยังใช้งานได้ครบทุกฉบับ — กำหนดบาท/วัน Onshore และ Offshore ต่อสัญญาสำหรับตำแหน่งนี้ เมื่อ timesheet อ้าง{' '}
          <code className="text-xs">contractId</code> ตรงกัน ระบบจะใช้ค่าจากแถวนี้ก่อนค่ามาตรฐานของตำแหน่งด้านบน
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">สัญญา / ลูกค้า</TableHead>
              <TableHead>Onshore (บาท/วัน)</TableHead>
              <TableHead>Offshore (บาท/วัน)</TableHead>
              <TableHead className="w-[52px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-sm text-muted-foreground py-8 text-center">
                  ยังไม่มีสัญญาหลักในระบบ — เพิ่มสัญญาที่เมนูสัญญาหลักก่อน แล้วกลับมากำหนดค่าต่อแถว
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, index) => {
                const cid = row.customerId;
                const cust = (cid && customerNameById.get(cid)) || '—';
                const isOrphan = Boolean(row.contractId && !activeContractIds.has(row.contractId));
                return (
                  <TableRow key={`${row.contractId}-${index}`}>
                    <TableCell className="align-top">
                      <div className="space-y-1">
                        <p className="font-mono text-xs font-semibold">{row.contractLabel || row.contractId || '—'}</p>
                        <p className="text-[11px] text-muted-foreground">ลูกค้า: {cust}</p>
                        {isOrphan ? (
                          <p className="text-[10px] text-amber-800">สัญญาปิด/หมดอายุแล้ว — ลบแถวได้ถ้าไม่ใช้</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top max-w-[140px]">
                      <Input
                        className="font-mono h-9"
                        inputMode="decimal"
                        disabled={disabled}
                        placeholder="—"
                        value={row.onshore != null ? String(row.onshore) : ''}
                        onChange={(e) => patchRow(index, { onshore: parseMoney(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="align-top max-w-[140px]">
                      <Input
                        className="font-mono h-9"
                        inputMode="decimal"
                        disabled={disabled}
                        placeholder="—"
                        value={row.offshore != null ? String(row.offshore) : ''}
                        onChange={(e) => patchRow(index, { offshore: parseMoney(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {!disabled && isOrphan ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive h-8 w-8"
                          title="ลบแถวสัญญาที่ไม่ใช้ในระบบแล้ว"
                          onClick={() => removeRow(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
