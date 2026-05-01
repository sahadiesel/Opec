'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Building2 } from 'lucide-react';
import type { MainContract, Position } from '@/lib/types';

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
  const contractsSorted = [...(contracts ?? [])].sort((a, b) =>
    (a.contractNumber || a.id).localeCompare(b.contractNumber || b.id, 'th'),
  );

  const addRow = () => {
    const first = contractsSorted[0];
    onChange([
      ...rows,
      {
        contractId: first?.id || '',
        customerId: first?.customerId,
        contractLabel: first?.contractNumber || first?.title,
        onshore: undefined,
        offshore: undefined,
      },
    ]);
  };

  const patchRow = (index: number, patch: Partial<Row>) => {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange(next);
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  const onPickContract = (index: number, contractId: string) => {
    const mc = contractsSorted.find((c) => c.id === contractId);
    patchRow(index, {
      contractId,
      customerId: mc?.customerId,
      contractLabel: mc?.contractNumber || mc?.title || contractId,
    });
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
          ระบุฐานบาท/วัน Onshore และ Offshore ต่อสัญญาหลัก — เมื่อ timesheet มี contractId ตรงกัน ระบบจะใช้ค่าจากแถวนี้ก่อนฐานทั่วไปของตำแหน่ง
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {!disabled && (
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addRow}>
            <Plus className="h-4 w-4" /> เพิ่มสัญญา
          </Button>
        )}
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
                  {disabled
                    ? 'ยังไม่มีรายการต่อสัญญา — ใช้ฐาน Onshore/Offshore ด้านบน'
                    : 'ยังไม่มีรายการ — กด «เพิ่มสัญญา» แล้วเลือกสัญญาหลัก'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, index) => {
                const mcRow = contractsSorted.find((c) => c.id === row.contractId);
                const cid = row.customerId || mcRow?.customerId;
                const cust = (cid && customerNameById.get(cid)) || '—';
                return (
                  <TableRow key={`${row.contractId}-${index}`}>
                    <TableCell className="align-top">
                      {disabled ? (
                        <div className="space-y-1">
                          <p className="font-mono text-xs font-semibold">
                            {row.contractLabel || row.contractId || '—'}
                          </p>
                          <p className="text-[11px] text-muted-foreground">ลูกค้า: {cust}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label className="text-[10px] text-muted-foreground">สัญญาหลัก</Label>
                          <Select
                            value={row.contractId || ''}
                            onValueChange={(v) => onPickContract(index, v)}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="เลือกสัญญา…" />
                            </SelectTrigger>
                            <SelectContent>
                              {contractsSorted.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.contractNumber || c.id}{' '}
                                  <span className="text-muted-foreground text-xs">
                                    ({customerNameById.get(c.customerId) || c.customerId})
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top max-w-[140px]">
                      <Input
                        className="font-mono h-9"
                        inputMode="decimal"
                        disabled={disabled}
                        placeholder="—"
                        value={row.onshore != null && row.onshore > 0 ? String(row.onshore) : ''}
                        onChange={(e) =>
                          patchRow(index, { onshore: parseMoney(e.target.value) })
                        }
                      />
                    </TableCell>
                    <TableCell className="align-top max-w-[140px]">
                      <Input
                        className="font-mono h-9"
                        inputMode="decimal"
                        disabled={disabled}
                        placeholder="—"
                        value={row.offshore != null && row.offshore > 0 ? String(row.offshore) : ''}
                        onChange={(e) =>
                          patchRow(index, { offshore: parseMoney(e.target.value) })
                        }
                      />
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {!disabled && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive h-8 w-8"
                          onClick={() => removeRow(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
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
