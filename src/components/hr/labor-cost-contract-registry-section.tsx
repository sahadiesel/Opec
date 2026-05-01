'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, Table2 } from 'lucide-react';
import type { Customer, MainContract, Position } from '@/lib/types';

export type LaborCostContractRow = NonNullable<Position['laborCostByContract']>[number];

type Props = {
  rows: LaborCostContractRow[];
  onChange: (rows: LaborCostContractRow[]) => void;
  contracts: MainContract[] | null | undefined;
  customers: Customer[] | null | undefined;
  disabled: boolean;
};

function parseMoney(raw: string): number | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function LaborCostContractRegistrySection({
  rows,
  onChange,
  contracts,
  customers,
  disabled,
}: Props) {
  const addRow = () => {
    onChange([...rows, { contractId: '', onshore: undefined, offshore: undefined }]);
  };

  const removeRow = (idx: number) => {
    onChange(rows.filter((_, i) => i !== idx));
  };

  const patchRow = (idx: number, patch: Partial<LaborCostContractRow>) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange(next);
  };

  const contractOptions = (contracts || []).filter((c) => c.status === 'active' || !c.status);

  return (
    <Card className="border-amber-200/60 bg-amber-50/20 shadow-sm">
      <CardHeader className="bg-amber-100/30 border-b border-amber-100/80">
        <div className="flex flex-wrap items-center gap-2">
          <Table2 className="h-5 w-5 text-amber-900" />
          <CardTitle className="text-lg text-amber-950">ทะเบียนต้นทุนตามสัญญา (ตำแหน่งนี้)</CardTitle>
        </div>
        <CardDescription className="text-amber-950/80">
          ระบุฐาน onshore/offshore ต่อสัญญา+ลูกค้า — payroll จะจับคู่กับ <code className="text-xs">timesheet.contractId</code> ก่อนฐานสัญญาทั่วไป
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4 space-y-3">
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addRow} disabled={disabled}>
            <Plus className="h-4 w-4" /> เพิ่มแถว
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีแถว — ใช้ฐาน Onshore/Offshore ด้านบนตามเดิม</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>สัญญาหลัก</TableHead>
                <TableHead>ลูกค้า</TableHead>
                <TableHead className="text-right">Onshore / วัน</TableHead>
                <TableHead className="text-right">Offshore / วัน</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, idx) => {
                const mc = contractOptions.find((c) => c.id === row.contractId);
                const custName =
                  (row.customerId && customers?.find((x) => x.id === row.customerId)?.name) ||
                  (mc?.customerId && customers?.find((x) => x.id === mc.customerId)?.name) ||
                  '—';
                return (
                  <TableRow key={`${row.contractId}-${idx}`}>
                    <TableCell className="align-top min-w-[200px]">
                      <Select
                        disabled={disabled}
                        value={row.contractId || ''}
                        onValueChange={(v) => {
                          const c = contractOptions.find((x) => x.id === v);
                          patchRow(idx, {
                            contractId: v,
                            customerId: c?.customerId,
                            contractLabel: c ? `${c.contractNumber} — ${c.title}`.trim() : undefined,
                          });
                        }}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="เลือกสัญญา..." />
                        </SelectTrigger>
                        <SelectContent>
                          {contractOptions.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.contractNumber} — {c.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground align-top pt-3">{custName}</TableCell>
                    <TableCell className="align-top">
                      <Input
                        className="h-9 font-mono text-right"
                        inputMode="decimal"
                        disabled={disabled}
                        placeholder="บาท"
                        value={row.onshore != null && row.onshore > 0 ? String(row.onshore) : ''}
                        onChange={(e) => patchRow(idx, { onshore: parseMoney(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <Input
                        className="h-9 font-mono text-right"
                        inputMode="decimal"
                        disabled={disabled}
                        placeholder="บาท"
                        value={row.offshore != null && row.offshore > 0 ? String(row.offshore) : ''}
                        onChange={(e) => patchRow(idx, { offshore: parseMoney(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        disabled={disabled}
                        onClick={() => removeRow(idx)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
