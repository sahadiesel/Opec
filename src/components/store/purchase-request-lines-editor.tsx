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
import { storeCatalogPickableItems } from '@/lib/store/receive-stock-select';

export type PrLineDraft = {
  key: string;
  itemDescription: string;
  /** เก็บเป็นข้อความระหว่างพิมพ์ — รองรับทศนิยม เช่น 1.5 */
  quantity: string;
  unitPrice: string;
  amount: number;
  storeItemId?: string;
  storeItemCode?: string;
};

/** แปลงค่าจากช่องกรอก PR เป็นตัวเลข (ว่าง / "." → 0) */
export function parsePrDecimal(raw: string | number | undefined | null): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const s = String(raw ?? '').trim().replace(/,/g, '');
  if (!s || s === '.' || s === '-') return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function isValidDecimalInput(raw: string): boolean {
  return raw === '' || /^\d*\.?\d*$/.test(raw);
}

function formatDecimalField(n: number): string {
  if (!Number.isFinite(n)) return '';
  return String(n);
}

export function newLine(): PrLineDraft {
  return {
    key: crypto.randomUUID(),
    itemDescription: '',
    quantity: '1',
    unitPrice: '0',
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
    const list = storeCatalogPickableItems(storeItems ?? []);
    if (!qq) return list.slice(0, 60);
    return list
      .filter((s) => {
        const label = formatStoreItemLabel(s).toLowerCase();
        return (
          label.includes(qq) ||
          s.itemName.toLowerCase().includes(qq) ||
          (s.itemCode || '').toLowerCase().includes(qq) ||
          (s.variantSpecification || '').toLowerCase().includes(qq)
        );
      })
      .slice(0, 60);
  }, [storeItems, pickerQ]);

  const updateLine = (key: string, patch: Partial<PrLineDraft>) => {
    onLinesChange(
      lines.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        if ('quantity' in patch || 'unitPrice' in patch) {
          next.amount = roundMoney2(parsePrDecimal(next.quantity) * parsePrDecimal(next.unitPrice));
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
        const qty = parsePrDecimal(l.quantity) || 1;
        const up = parsePrDecimal(l.unitPrice);
        return {
          ...l,
          itemDescription: desc,
          storeItemId: item.id,
          storeItemCode: item.itemCode,
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
                      <div className="flex flex-col gap-1">
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
                        {line.storeItemCode && (
                          <span className="text-[10px] font-mono text-muted-foreground">{line.storeItemCode}</span>
                        )}
                      </div>
                    ) : (
                      <Input
                        value={line.itemDescription}
                        onChange={(e) => updateLine(line.key, { itemDescription: e.target.value, storeItemId: undefined, storeItemCode: undefined })}
                        placeholder="ระบุรายการ"
                      />
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {readOnly ? (
                    <span className="block text-right tabular-nums text-sm">
                      {parsePrDecimal(line.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </span>
                  ) : (
                    <Input
                      type="text"
                      className="text-right tabular-nums"
                      inputMode="decimal"
                      placeholder="0"
                      value={line.quantity}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (!isValidDecimalInput(raw)) return;
                        updateLine(line.key, { quantity: raw });
                      }}
                      onBlur={() => {
                        const n = parsePrDecimal(line.quantity);
                        updateLine(line.key, { quantity: n > 0 ? formatDecimalField(n) : '' });
                      }}
                    />
                  )}
                </TableCell>
                <TableCell>
                  {readOnly ? (
                    <span className="block text-right tabular-nums text-sm">
                      {parsePrDecimal(line.unitPrice).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 4,
                      })}
                    </span>
                  ) : (
                    <Input
                      type="text"
                      className="text-right tabular-nums"
                      inputMode="decimal"
                      placeholder="0"
                      value={line.unitPrice}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (!isValidDecimalInput(raw)) return;
                        updateLine(line.key, { unitPrice: raw });
                      }}
                      onBlur={() => {
                        const n = parsePrDecimal(line.unitPrice);
                        updateLine(line.key, {
                          unitPrice: n > 0 ? formatDecimalField(roundMoney2(n)) : n === 0 ? '0' : '',
                        });
                      }}
                    />
                  )}
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
