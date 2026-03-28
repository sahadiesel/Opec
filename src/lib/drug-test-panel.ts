import type { DrugTestPanelSubstance, WorkerDrugTest } from '@/lib/types';
import { formatOptionalDateThaiBE } from '@/lib/date-thai';

export const DRUG_TEST_PANEL_DOC_PATH = ['system', 'drug_test_panel'] as const;

export type DrugPanelSummaryKind = 'pending' | 'partial' | 'pass' | 'positive' | 'none_panel';

export interface DrugPanelWorkerFields {
  drugPanelSummaryKind: DrugPanelSummaryKind;
  drugPanelSummaryText: string;
  drugPanelPassedCount: number;
  drugPanelTotalCount: number;
  /** true เมื่อแผงครบทุกสารและผลทุกตัวเป็น negative */
  readinessDrugOk: boolean;
}

export function displayLocation(t: WorkerDrugTest): string {
  if (t.testLocationType === 'OTHER' && (t.testLocationOther || '').trim()) {
    return t.testLocationOther!.trim();
  }
  if (t.testLocationType === 'OPEC') return 'OPEC';
  if (t.laboratory) return t.laboratory;
  return t.testLocationType === 'OTHER' ? 'อื่นๆ' : 'OPEC';
}

/** ผลล่าสุดต่อ substanceKey (เรียง testDate) */
export function getLatestDrugTestBySubstance(tests: WorkerDrugTest[]): Map<string, WorkerDrugTest> {
  const map = new Map<string, WorkerDrugTest>();
  const sorted = [...tests].sort((a, b) => Number(b.testDate || 0) - Number(a.testDate || 0));
  for (const t of sorted) {
    const key = t.substanceKey || '_legacy';
    if (!map.has(key)) map.set(key, t);
  }
  return map;
}

export function computeDrugPanelWorkerFields(
  panelSubstances: DrugTestPanelSubstance[],
  tests: WorkerDrugTest[]
): DrugPanelWorkerFields {
  const total = panelSubstances.length;
  if (total === 0) {
    return {
      drugPanelSummaryKind: 'none_panel',
      drugPanelSummaryText: '—',
      drugPanelPassedCount: 0,
      drugPanelTotalCount: 0,
      readinessDrugOk: true,
    };
  }

  const latestByKey = getLatestDrugTestBySubstance(tests);
  let passCount = 0;
  let positiveAny = false;
  let pendingAny = false;

  for (const s of panelSubstances) {
    const row = latestByKey.get(s.id);
    if (!row) {
      pendingAny = true;
      continue;
    }
    const r = row.result;
    if (r === 'positive') {
      positiveAny = true;
    } else if (r === 'negative') {
      passCount += 1;
    } else {
      pendingAny = true;
    }
  }

  if (positiveAny) {
    return {
      drugPanelSummaryKind: 'positive',
      drugPanelSummaryText: 'POSITIVE',
      drugPanelPassedCount: passCount,
      drugPanelTotalCount: total,
      readinessDrugOk: false,
    };
  }

  if (passCount === total) {
    return {
      drugPanelSummaryKind: 'pass',
      drugPanelSummaryText: 'PASS',
      drugPanelPassedCount: total,
      drugPanelTotalCount: total,
      readinessDrugOk: true,
    };
  }

  if (passCount === 0 && !pendingAny) {
    return {
      drugPanelSummaryKind: 'pending',
      drugPanelSummaryText: 'รอตรวจสอบ',
      drugPanelPassedCount: 0,
      drugPanelTotalCount: total,
      readinessDrugOk: false,
    };
  }

  if (passCount === 0) {
    return {
      drugPanelSummaryKind: 'pending',
      drugPanelSummaryText: 'รอตรวจสอบ',
      drugPanelPassedCount: 0,
      drugPanelTotalCount: total,
      readinessDrugOk: false,
    };
  }

  return {
    drugPanelSummaryKind: 'partial',
    drugPanelSummaryText: `${passCount}/${total} pass`,
    drugPanelPassedCount: passCount,
    drugPanelTotalCount: total,
    readinessDrugOk: false,
  };
}

export function formatDrugTestRowLabel(t: WorkerDrugTest): string {
  const name = t.substanceLabelSnapshot || t.substanceKey || 'สาร';
  const dateStr = t.testDate ? formatOptionalDateThaiBE(t.testDate, '—') : '—';
  const loc = displayLocation(t);
  const res =
    t.result === 'negative' ? 'NEGATIVE' : t.result === 'positive' ? 'POSITIVE' : 'NONE';
  return `${name} | ${dateStr} | ${loc} | ${res}`;
}
