'use client';

import { useMemo, useRef, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Download, Upload, Pencil } from 'lucide-react';
import type { ContractMobDemobLocation, MainContract, Position, PositionRate } from '@/lib/types';
import {
  buildRateSheetColumns,
  readRateSheetCell,
  type RateSheetColumnDef,
  type RateSheetSide,
} from '@/lib/commercial/position-rate-matrix';
import {
  buildRateSheetExportRows,
  downloadRateSheetExcel,
  parseRateSheetWorkbook,
  buildImportPayloadForRate,
  resolvePositionForImportRow,
} from '@/lib/commercial/position-rate-matrix-excel';
import { useToast } from '@/hooks/use-toast';

export interface ContractRateSheetSpreadsheetProps {
  contract: Pick<MainContract, 'contractNumber' | 'title' | 'currency' | 'laborCostBaselinesByPositionId'>;
  rates: PositionRate[];
  positions: Position[] | null;
  mobDemobLocations: ContractMobDemobLocation[];
  canEditSell: boolean;
  canEditCost: boolean;
  canViewCost: boolean;
  canMutate: boolean;
  onCommitCell: (
    rate: PositionRate,
    side: RateSheetSide,
    col: RateSheetColumnDef,
    value: number | undefined,
  ) => void;
  onBulkImport: (
    updates: { rateId: string; payload: Record<string, unknown>; positionLabel: string }[],
  ) => Promise<{ applied: number; skipped: number; warnings: string[] }>;
  onEditRate?: (rateId: string) => void;
}

export function ContractRateSheetSpreadsheet({
  contract,
  rates,
  positions,
  mobDemobLocations,
  canEditSell,
  canEditCost,
  canViewCost,
  canMutate,
  onCommitCell,
  onBulkImport,
  onEditRate,
}: ContractRateSheetSpreadsheetProps) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [side, setSide] = useState<RateSheetSide>('sell');
  const [showOffshore, setShowOffshore] = useState(true);
  const [showOnshore, setShowOnshore] = useState(true);
  const [showMob, setShowMob] = useState(true);
  const [importing, setImporting] = useState(false);

  const canEditCurrentSide = side === 'sell' ? canEditSell : canEditCost;
  const editable = canMutate && canEditCurrentSide;

  const columns = useMemo(
    () =>
      buildRateSheetColumns(mobDemobLocations, {
        includeOffshore: showOffshore,
        includeOnshore: showOnshore,
        includeMob: showMob,
      }),
    [mobDemobLocations, showOffshore, showOnshore, showMob],
  );

  const offshoreCols = columns.filter((c) => c.group === 'offshore');
  const onshoreCols = columns.filter((c) => c.group === 'onshore');

  const posList = positions ?? [];

  const readCell = (rate: PositionRate, col: RateSheetColumnDef) => {
    const pos = posList.find((p) => p.id === rate.positionId);
    return readRateSheetCell(rate, side, col, { contract, position: pos });
  };

  const handleExport = () => {
    const rows = buildRateSheetExportRows(rates, posList, side, mobDemobLocations, (rate, col) =>
      readCell(rate, col),
    );
    downloadRateSheetExcel(contract, side, rows, mobDemobLocations);
    toast({ title: 'Export สำเร็จ', description: `ดาวน์โหลด rate-sheet (${side}) แล้ว` });
  };

  const handleImportFile = async (file: File) => {
    if (!canMutate || !canEditCurrentSide) {
      toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์นำเข้า' });
      return;
    }
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseRateSheetWorkbook(buf, mobDemobLocations);
      if (parsed.side && parsed.side !== side) {
        setSide(parsed.side);
      }
      const importSide = parsed.side ?? side;
      if (importSide === 'sell' && !canEditSell) {
        toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์นำเข้าราคาขาย' });
        return;
      }
      if (importSide === 'cost' && !canEditCost) {
        toast({ variant: 'destructive', title: 'ไม่มีสิทธิ์นำเข้าต้นทุน' });
        return;
      }

      const updates: { rateId: string; payload: Record<string, unknown>; positionLabel: string }[] = [];
      const warnings = [...parsed.warnings];

      for (const row of parsed.rows) {
        const { rate, position, warning } = resolvePositionForImportRow(row, rates, posList);
        if (warning) warnings.push(warning);
        if (!rate) continue;
        const payload = buildImportPayloadForRate(rate, row.side, row.values, mobDemobLocations);
        updates.push({
          rateId: rate.id,
          payload,
          positionLabel: (position?.positionName || position?.positionNameTh || row.positionName).trim(),
        });
      }

      if (updates.length === 0) {
        toast({
          variant: 'destructive',
          title: 'นำเข้าไม่สำเร็จ',
          description: warnings.slice(0, 3).join(' · ') || 'ไม่มีแถวที่อัปเดตได้',
        });
        return;
      }

      const result = await onBulkImport(updates);
      toast({
        title: 'นำเข้า Rate Sheet แล้ว',
        description: `อัปเดต ${result.applied} ตำแหน่ง · ข้าม ${result.skipped}${result.warnings.length ? ` · ${result.warnings.length} คำเตือน` : ''}`,
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'อ่านไฟล์ไม่สำเร็จ',
        description: e instanceof Error ? e.message : 'รูปแบบไฟล์ไม่ถูกต้อง',
      });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (rates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center border rounded-lg bg-muted/20">
        ยังไม่มีอัตราราคา — กด &quot;เพิ่มอัตราราคา&quot; ก่อน แล้วกลับมาใช้ Rate Sheet
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-muted/10 p-4">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">มุมมอง</Label>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={side === 'sell' ? 'default' : 'outline'}
              disabled={!canEditSell && side !== 'sell'}
              onClick={() => setSide('sell')}
            >
              ราคาขาย (Sell)
            </Button>
            {canViewCost && (
              <Button
                type="button"
                size="sm"
                variant={side === 'cost' ? 'default' : 'outline'}
                disabled={!canEditCost && side !== 'cost'}
                onClick={() => setSide('cost')}
              >
                ต้นทุน (Cost)
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">แสดงคอลัมน์</Label>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={showOffshore} onCheckedChange={(v) => setShowOffshore(v === true)} />
              Offshore
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={showOnshore} onCheckedChange={(v) => setShowOnshore(v === true)} />
              Onshore
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={showMob} onCheckedChange={(v) => setShowMob(v === true)} />
              Mob/Demob
            </label>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 ml-auto">
          <Button type="button" size="sm" variant="outline" className="gap-1" onClick={handleExport}>
            <Download className="h-4 w-4" /> Export Excel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="gap-1"
            disabled={!editable || importing}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" /> {importing ? 'กำลังนำเข้า…' : 'Import Excel'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
            }}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        สกุลเงิน: <strong>{contract.currency}</strong> — กดปุ่ม <Pencil className="inline h-3 w-3" /> แก้ไขเพื่อบันทึกอัตรา
        {!canMutate && ' (โหมดดูอย่างเดียว)'}
      </p>

      <div className="overflow-x-auto rounded-lg border max-h-[min(70vh,900px)]">
        <Table>
          <TableHeader className="sticky top-0 z-20 bg-background shadow-sm">
            <TableRow>
              <TableHead className="sticky left-0 z-30 bg-background min-w-[10rem] border-r">ตำแหน่ง</TableHead>
              {showOffshore && offshoreCols.length > 0 && (
                <TableHead
                  colSpan={offshoreCols.length}
                  className="text-center bg-sky-50/80 text-sky-900 border-x text-xs font-semibold"
                >
                  Offshore Daily Rate ({contract.currency})
                </TableHead>
              )}
              {showOnshore && onshoreCols.length > 0 && (
                <TableHead
                  colSpan={onshoreCols.length}
                  className="text-center bg-emerald-50/80 text-emerald-900 border-x text-xs font-semibold"
                >
                  Onshore Daily Rate ({contract.currency})
                </TableHead>
              )}
              {onEditRate && canMutate && (
                <TableHead className="w-10 sticky right-0 bg-background border-l" />
              )}
            </TableRow>
            <TableRow>
              <TableHead className="sticky left-0 z-30 bg-muted/60 border-r text-[10px] text-center">#</TableHead>
              {columns.map((col) => (
                <TableHead
                  key={col.id}
                  className={`text-[10px] text-center whitespace-nowrap px-1 min-w-[4.5rem] ${
                    col.group === 'offshore' ? 'bg-sky-50/40' : 'bg-emerald-50/40'
                  }`}
                  title={col.label}
                >
                  {col.shortLabel}
                </TableHead>
              ))}
              {onEditRate && canMutate && <TableHead className="sticky right-0 bg-muted/60 border-l text-center" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((rate, idx) => {
              const pos = posList.find((p) => p.id === rate.positionId);
              const label = (pos?.positionName || pos?.positionNameTh || rate.positionId).trim();
              return (
                <TableRow key={rate.id} className={!rate.active ? 'opacity-50' : undefined}>
                  <TableCell className="sticky left-0 z-10 bg-background border-r font-medium text-sm">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-primary font-semibold leading-tight">{label}</span>
                      <span className="text-[10px] text-muted-foreground">#{idx + 1}</span>
                      {!rate.active && (
                        <Badge variant="secondary" className="w-fit text-[9px] py-0">
                          inactive
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  {columns.map((col) => {
                    const val = readCell(rate, col);
                    return (
                      <TableCell
                        key={col.id}
                        className={`p-0.5 ${col.group === 'offshore' ? 'bg-sky-50/20' : 'bg-emerald-50/20'}`}
                      >
                        <span
                          className={`block text-center text-xs px-1 py-1 tabular-nums ${
                            side === 'sell' ? 'font-medium text-green-700' : 'font-medium text-amber-800'
                          }`}
                        >
                          {val != null && val > 0 ? val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                        </span>
                      </TableCell>
                    );
                  })}
                  {onEditRate && canMutate && (
                    <TableCell className="sticky right-0 bg-background border-l p-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => onEditRate(rate.id)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
