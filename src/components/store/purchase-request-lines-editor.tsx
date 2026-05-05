'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Trash2, Plus, PackageSearch, Search } from 'lucide-react';
import type { PurchaseLineEntryMode, StoreItem } from '@/lib/types';
import { formatStoreItemLabel } from '@/lib/types';
import { roundMoney2 } from '@/lib/ops/purchase-payment-milestones';

export type PrLineDraft = {
  key: string;
  itemDescription: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  storeItemId?: string;
};

export function newLine(): PrLineDraft {
  return {
    key: crypto.randomUUID(),
    itemDescription: '',
    quantity: 1,
    unitPrice: 0,
    amount: 0,
  };
}

export function PurchaseRequestLinesEditor({
  lineEntryMode,
  onLineEntryModeChange,
  lines,
  onLinesChange,
  storeItems,
  readOnly,
}: {
  lineEntryMode: PurchaseLineEntryMode;
  onLineEntryModeChange: (m: PurchaseLineEntryMode) => void;
  lines: PrLineDraft[];
  onLinesChange: (next: PrLineDraft[]) => void;
  storeItems: StoreItem[] | undefined;
  readOnly: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTargetKey, setPickerTargetKey] = useState<string | null>(null);
  const [pickerQ, setPickerQ] = useState('');

  const pickerItems = useMemo(() => {
    const qq = pickerQ.trim().toLowerCase();
    const list = (storeItems || []).filter((s) => s.active);
    if (!qq) return list.slice(0, 60);
    return list
      .filter(
        (s) =>
          s.itemName.toLowerCase().includes(qq) ||
          (s.itemCode || '').toLowerCase().includes(qq) ||
          (s.variantSpecification || '').toLowerCase().includes(qq)
      )
      .slice(0, 60);
  }, [storeItems, pickerQ]);

  const updateLine = (key: string, patch: Partial<PrLineDraft>) => {
    onLinesChange(
      lines.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        if ('quantity' in patch || 'unitPrice' in patch) {
          next.amount = roundMoney2(Number(next.quantity) * Number(next.unitPrice));
        }
        return next;
      })
    );
  };

  const removeLine = (key: string) => {
    onLinesChange(lines.filter((l) => l.key !== key));
  };

  const openPickerForLine = (key: string) => {
    setPickerTargetKey(key);
    setPickerQ('');
    setPickerOpen(true);
  };

  const applyStoreItem = (item: StoreItem) => {
    if (!pickerTargetKey) return;
    const desc = formatStoreItemLabel(item);
    onLinesChange(
      lines.map((l) => {
        if (l.key !== pickerTargetKey) return l;
        const qty = Number(l.quantity) || 1;
        const up = Number(l.unitPrice) || 0;
        return {
          ...l,
          itemDescription: desc,
          storeItemId: item.id,
          amount: roundMoney2(qty * up),
        };
      })
    );
    setPickerOpen(false);
    setPickerTargetKey(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Label className="text-base font-semibold">รายการสั่งซื้อ</Label>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={lineEntryMode === 'INVENTORY' ? 'default' : 'outline'}
              onClick={() => onLineEntryModeChange('INVENTORY')}
            >
              <PackageSearch className="mr-1 h-4 w-4" />
              จากคลัง
            </Button>
            <Button
              type="button"
              size="sm"
              variant={lineEntryMode === 'SERVICE' ? 'default' : 'outline'}
              onClick={() => onLineEntryModeChange('SERVICE')}
            >
              คีย์มือ / จ้าง
            </Button>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {lineEntryMode === 'INVENTORY'
          ? 'เลือกรายการจากทะเบียนคลัง — ถ้ายังไม่มี SKU ให้เพิ่มที่ทะเบียนคลังก่อน'
          : 'กรอกรายการและจำนวนราคาเอง'}
      </p>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-10 text-center">ลำดับ</TableHead>
              <TableHead className="min-w-[200px]">รายการ</TableHead>
              <TableHead className="w-24 text-right">จำนวน</TableHead>
              <TableHead className="w-28 text-right">ราคา/หน่วย</TableHead>
              <TableHead className="w-32 text-right">รวม</TableHead>
              {!readOnly && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, idx) => (
              <TableRow key={line.key}>
                <TableCell className="text-center text-muted-foreground">{idx + 1}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    {readOnly ? (
                      <span className="text-sm font-medium">{line.itemDescription || '—'}</span>
                    ) : lineEntryMode === 'INVENTORY' ? (
                      <div className="flex flex-wrap gap-1">
                        <Input
                          value={line.itemDescription}
                          readOnly
                          className="flex-1 min-w-[140px] bg-muted/30"
                          placeholder="เลือกจากคลัง…"
                        />
                        <Button type="button" size="sm" variant="secondary" onClick={() => openPickerForLine(line.key)}>
                          <Search className="h-4 w-4 mr-1" />
                          ค้นหา
                        </Button>
                      </div>
                    ) : (
                      <Input
                        value={line.itemDescription}
                        onChange={(e) => updateLine(line.key, { itemDescription: e.target.value, storeItemId: undefined })}
                        placeholder="ระบุรายการ"
                      />
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Input
                    className="text-right tabular-nums"
                    inputMode="decimal"
                    readOnly={readOnly}
                    disabled={readOnly}
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: parseFloat(e.target.value) || 0 })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="text-right tabular-nums"
                    inputMode="decimal"
                    readOnly={readOnly}
                    disabled={readOnly}
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.key, { unitPrice: parseFloat(e.target.value) || 0 })}
                  />
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {line.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </TableCell>
                {!readOnly && (
                  <TableCell>
                    <Button type="button" size="icon" variant="ghost" onClick={() => removeLine(line.key)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onLinesChange([...lines, newLine()])}
          className="gap-1"
        >
          <Plus className="h-4 w-4" /> เพิ่มบรรทัด
        </Button>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>เลือกรายการจากคลัง</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="ค้นหารหัส / ชื่อ / รุ่น…"
            value={pickerQ}
            onChange={(e) => setPickerQ(e.target.value)}
            className="mb-2"
          />
          <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
            {pickerItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/70"
                onClick={() => applyStoreItem(item)}
              >
                <div className="font-medium">{formatStoreItemLabel(item)}</div>
                <div className="text-xs text-muted-foreground font-mono">{item.itemCode}</div>
              </button>
            ))}
            {pickerItems.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">ไม่พบรายการ — ลองคำค้นหรือเพิ่มที่ทะเบียนคลัง</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPickerOpen(false)}>
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
