import * as XLSX from 'xlsx';
import type { ContractMobDemobLocation, MainContract, Position, PositionRate, PositionRateMatrix } from '@/lib/types';
import {
  buildRateSheetColumns,
  parseRateSheetNumber,
  patchRateSheetCell,
  type RateSheetColumnDef,
  type RateSheetSide,
  preparePositionRateMatrixPayload,
  sanitizePositionRateMatrix,
} from '@/lib/commercial/position-rate-matrix';

const META_SHEET = '_meta';
const POSITION_ID_HEADER = 'position_id';
const POSITION_NAME_HEADER = 'position_name';
const SIDE_HEADER = 'side';

export interface RateSheetExportRow {
  positionId: string;
  positionName: string;
  side: RateSheetSide;
  values: Record<string, number | undefined>;
}

export interface RateSheetImportRow {
  positionId?: string;
  positionName: string;
  side: RateSheetSide;
  values: Record<string, number | undefined>;
}

export interface RateSheetImportResult {
  rows: RateSheetImportRow[];
  warnings: string[];
  side: RateSheetSide | null;
  columns: RateSheetColumnDef[];
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}

function sideFromCell(raw: unknown): RateSheetSide | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'sell' || s === 'cost') return s;
  if (s === 'ขาย' || s === 'ราคาขาย') return 'sell';
  if (s === 'ต้นทุน' || s === 'cost') return 'cost';
  return null;
}

function matchColumnByHeader(
  header: string,
  columns: RateSheetColumnDef[],
  mobLocations: ContractMobDemobLocation[],
): RateSheetColumnDef | null {
  const norm = normalizeHeader(header);
  if (!norm || norm === POSITION_ID_HEADER || norm === POSITION_NAME_HEADER || norm === SIDE_HEADER) {
    return null;
  }

  const byExcel = columns.find((c) => c.excelKey === norm);
  if (byExcel) return byExcel;

  const byId = columns.find((c) => c.id === norm);
  if (byId) return byId;

  for (const col of columns) {
    if (normalizeHeader(col.label) === norm || normalizeHeader(col.shortLabel) === norm) return col;
  }

  for (const loc of mobLocations) {
    const mobNorm = normalizeHeader(loc.label);
    if (mobNorm === norm || norm.includes(loc.key)) {
      return columns.find((c) => c.mobKey === loc.key) ?? null;
    }
  }

  return null;
}

export function buildRateSheetExportRows(
  rates: PositionRate[],
  positions: Position[],
  side: RateSheetSide,
  mobLocations: ContractMobDemobLocation[],
  readCell: (
    rate: PositionRate,
    col: RateSheetColumnDef,
  ) => number | undefined,
): RateSheetExportRow[] {
  const columns = buildRateSheetColumns(mobLocations);
  return rates.map((rate) => {
    const pos = positions.find((p) => p.id === rate.positionId);
    const values: Record<string, number | undefined> = {};
    for (const col of columns) {
      values[col.excelKey] = readCell(rate, col);
    }
    return {
      positionId: rate.positionId,
      positionName: (pos?.positionName || pos?.positionNameTh || rate.positionId).trim(),
      side,
      values,
    };
  });
}

/** Export one side (sell or cost) to .xlsx workbook bytes. */
export function exportRateSheetToWorkbook(
  contract: Pick<MainContract, 'contractNumber' | 'title'>,
  side: RateSheetSide,
  rows: RateSheetExportRow[],
  mobLocations: ContractMobDemobLocation[],
): ArrayBuffer {
  const columns = buildRateSheetColumns(mobLocations);
  const headerRow = [POSITION_ID_HEADER, POSITION_NAME_HEADER, SIDE_HEADER, ...columns.map((c) => c.excelKey)];
  const dataRows = rows.map((r) => [
    r.positionId,
    r.positionName,
    side,
    ...columns.map((c) => r.values[c.excelKey] ?? ''),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  const meta = XLSX.utils.aoa_to_sheet([
    ['contractNumber', contract.contractNumber],
    ['contractTitle', contract.title],
    ['side', side],
    ['exportedAt', new Date().toISOString()],
    ['mobLocationKeys', mobLocations.map((l) => l.key).join(',')],
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, side === 'sell' ? 'Sell Rates' : 'Cost Rates');
  XLSX.utils.book_append_sheet(wb, meta, META_SHEET);
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

export function downloadRateSheetExcel(
  contract: Pick<MainContract, 'contractNumber' | 'title'>,
  side: RateSheetSide,
  rows: RateSheetExportRow[],
  mobLocations: ContractMobDemobLocation[],
): void {
  const buf = exportRateSheetToWorkbook(contract, side, rows, mobLocations);
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const safeNo = (contract.contractNumber || 'contract').replace(/[^\w.-]+/g, '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rate-sheet_${safeNo}_${side}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseRateSheetWorkbook(
  buffer: ArrayBuffer,
  mobLocations: ContractMobDemobLocation[],
): RateSheetImportResult {
  const warnings: string[] = [];
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName =
    wb.SheetNames.find((n) => n !== META_SHEET && !n.startsWith('_')) ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return { rows: [], warnings: ['ไม่พบ sheet ข้อมูล'], side: null, columns: [] };
  }

  const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: '' });
  if (aoa.length < 2) {
    return { rows: [], warnings: ['ไฟล์ว่างหรือมีแค่ header'], side: null, columns: [] };
  }

  const headerCells = (aoa[0] || []).map((h) => String(h ?? '').trim());
  let detectedSide: RateSheetSide | null = null;

  const metaSheet = wb.Sheets[META_SHEET];
  if (metaSheet) {
    const metaAoa = XLSX.utils.sheet_to_json<(string | number)[]>(metaSheet, { header: 1, defval: '' });
    for (const row of metaAoa) {
      const key = String(row[0] ?? '').trim();
      const val = String(row[1] ?? '').trim();
      if (key === 'side') detectedSide = sideFromCell(val);
    }
  }

  const columns = buildRateSheetColumns(mobLocations);
  const colMap: { index: number; col: RateSheetColumnDef }[] = [];
  headerCells.forEach((h, i) => {
    const col = matchColumnByHeader(h, columns, mobLocations);
    if (col) colMap.push({ index: i, col });
  });

  const rows: RateSheetImportRow[] = [];
  for (let ri = 1; ri < aoa.length; ri++) {
    const row = aoa[ri] || [];
    const positionIdIdx = headerCells.findIndex((h) => normalizeHeader(h) === POSITION_ID_HEADER);
    const positionNameIdx = headerCells.findIndex((h) => normalizeHeader(h) === POSITION_NAME_HEADER);
    const sideIdx = headerCells.findIndex((h) => normalizeHeader(h) === SIDE_HEADER);

    const positionId =
      positionIdIdx >= 0 ? String(row[positionIdIdx] ?? '').trim() : '';
    const positionName =
      positionNameIdx >= 0
        ? String(row[positionNameIdx] ?? '').trim()
        : String(row[0] ?? '').trim();
    if (!positionId && !positionName) continue;

    const rowSide = sideIdx >= 0 ? sideFromCell(row[sideIdx]) : detectedSide;
    if (!rowSide) {
      warnings.push(`แถว ${ri + 1}: ไม่ระบุ side (sell/cost) — ข้าม`);
      continue;
    }
    if (detectedSide && rowSide !== detectedSide) {
      warnings.push(`แถว ${ri + 1}: side ไม่ตรงกับไฟล์ (${rowSide})`);
    }
    detectedSide = detectedSide ?? rowSide;

    const values: Record<string, number | undefined> = {};
    for (const { index, col } of colMap) {
      const raw = row[index];
      const num =
        typeof raw === 'number'
          ? raw > 0
            ? raw
            : undefined
          : parseRateSheetNumber(String(raw ?? ''));
      if (num != null) values[col.excelKey] = num;
    }

    rows.push({
      positionId: positionId || undefined,
      positionName,
      side: rowSide,
      values,
    });
  }

  return { rows, warnings, side: detectedSide, columns };
}

export function applyImportRowToMatrix(
  existingMatrix: PositionRateMatrix | undefined,
  side: RateSheetSide,
  values: Record<string, number | undefined>,
  mobLocations: ContractMobDemobLocation[],
): PositionRateMatrix | undefined {
  const columns = buildRateSheetColumns(mobLocations);
  let matrix = existingMatrix;
  for (const col of columns) {
    const v = values[col.excelKey];
    if (v === undefined) continue;
    matrix = patchRateSheetCell(matrix, side, col, v);
  }
  return sanitizePositionRateMatrix(matrix);
}

export function buildImportPayloadForRate(
  rate: PositionRate,
  side: RateSheetSide,
  values: Record<string, number | undefined>,
  mobLocations: ContractMobDemobLocation[],
): Record<string, unknown> {
  const rateMatrix = applyImportRowToMatrix(rate.rateMatrix, side, values, mobLocations);
  const payload: Record<string, unknown> = { updatedAt: Date.now() };
  if (rateMatrix) payload.rateMatrix = rateMatrix;
  if (side === 'sell') {
    const sync = preparePositionRateMatrixPayload({ ...rate, rateMatrix }, { syncLegacySell: true });
    if (sync.sellRate != null) payload.sellRate = sync.sellRate;
    if (sync.sellRateOnshore != null) payload.sellRateOnshore = sync.sellRateOnshore;
    if (sync.sellRateOffshore != null) payload.sellRateOffshore = sync.sellRateOffshore;
  }
  return payload;
}

export function resolvePositionForImportRow(
  row: RateSheetImportRow,
  rates: PositionRate[],
  positions: Position[],
): { rate: PositionRate | null; position: Position | null; warning?: string } {
  if (row.positionId) {
    const rate = rates.find((r) => r.positionId === row.positionId) ?? null;
    const position = positions.find((p) => p.id === row.positionId) ?? null;
    if (!rate) return { rate: null, position, warning: `ไม่พบอัตราราคาสำหรับ position_id=${row.positionId}` };
    return { rate, position };
  }

  const nameNorm = row.positionName.trim().toLowerCase();
  const position =
    positions.find(
      (p) =>
        (p.positionName || '').trim().toLowerCase() === nameNorm ||
        (p.positionNameTh || '').trim().toLowerCase() === nameNorm ||
        (p.positionNameEn || '').trim().toLowerCase() === nameNorm,
    ) ?? null;
  if (!position) {
    return { rate: null, position: null, warning: `ไม่พบตำแหน่ง "${row.positionName}"` };
  }
  const rate = rates.find((r) => r.positionId === position.id) ?? null;
  if (!rate) {
    return {
      rate: null,
      position,
      warning: `มีตำแหน่ง "${row.positionName}" แต่ยังไม่มีอัตราราคาในสัญญา — เพิ่มตำแหน่งก่อน`,
    };
  }
  return { rate, position };
}
