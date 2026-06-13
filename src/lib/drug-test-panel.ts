import type { Assignment, ChecklistItemStatus, DrugTestPanelSubstance, WorkerDrugTest } from '@/lib/types';
import { formatOptionalDateThaiBE, timestampToHtmlDateValue } from '@/lib/date-thai';
import { thailandTodayYmd } from '@/lib/ops/mobilization-final-clearance';

export const DRUG_TEST_PANEL_DOC_PATH = ['system', 'drug_test_panel'] as const;

/** ผลตรวจ negative ใช้ได้ไม่เกินกี่วันปฏิทินหลังวันตรวจ (วันที่ 11 = expired) */
export const DRUG_TEST_VALIDITY_DAYS = 10;

export type DrugPanelSummaryKind = 'pending' | 'partial' | 'pass' | 'positive' | 'none_panel';

export type DrugTestRowValidityStatus = 'valid' | 'expired' | 'n/a';

export interface DrugPanelWorkerFields {
  drugPanelSummaryKind: DrugPanelSummaryKind;
  drugPanelSummaryText: string;
  drugPanelPassedCount: number;
  drugPanelTotalCount: number;
  /** @deprecated ไม่ใช้กับ readiness/assign — เก็บไว้เพื่อ backward compat */
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
      readinessDrugOk: true,
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
      readinessDrugOk: true,
    };
  }

  if (passCount === 0) {
    return {
      drugPanelSummaryKind: 'pending',
      drugPanelSummaryText: 'รอตรวจสอบ',
      drugPanelPassedCount: 0,
      drugPanelTotalCount: total,
      readinessDrugOk: true,
    };
  }

  return {
    drugPanelSummaryKind: 'partial',
    drugPanelSummaryText: `${passCount}/${total} pass`,
    drugPanelPassedCount: passCount,
    drugPanelTotalCount: total,
    readinessDrugOk: true,
  };
}

function ymdToUtcDayIndex(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/** จำนวนวันปฏิทิน fromYmd → toYmd (to − from) */
export function calendarDaysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  const a = ymdToUtcDayIndex(fromYmd);
  const b = ymdToUtcDayIndex(toYmd);
  if (a == null || b == null) return null;
  return b - a;
}

/** บันทึกการตรวจทั้งหมด — ล่าสุดอยู่บนสุด */
export function sortDrugTestsNewestFirst(tests: WorkerDrugTest[]): WorkerDrugTest[] {
  return [...tests]
    .filter((t) => Boolean(t.substanceKey))
    .sort((a, b) => {
      const ta = Number(a.createdAt || a.testDate || 0);
      const tb = Number(b.createdAt || b.testDate || 0);
      if (tb !== ta) return tb - ta;
      return (b.id || '').localeCompare(a.id || '');
    });
}

/** บรรทัดที่บันทึกล่าสุด (ใช้ mob checklist) */
export function getLatestDrugTestRecord(tests: WorkerDrugTest[]): WorkerDrugTest | undefined {
  return sortDrugTestsNewestFirst(tests)[0];
}

/** สถานะ valid/expired ต่อแถวผลตรวจ — อิง negative + ไม่เกิน DRUG_TEST_VALIDITY_DAYS วันหลังวันตรวจ */
export function computeDrugTestRowValidityStatus(
  test: WorkerDrugTest,
  referenceYmd: string = thailandTodayYmd(),
): DrugTestRowValidityStatus {
  if (test.result !== 'negative') return 'n/a';
  if (test.testDate == null || test.testDate <= 0) return 'n/a';
  const testYmd = timestampToHtmlDateValue(test.testDate);
  if (!testYmd) return 'n/a';
  const days = calendarDaysBetweenYmd(testYmd, referenceYmd);
  if (days == null || days < 0) return 'expired';
  if (days > DRUG_TEST_VALIDITY_DAYS) return 'expired';
  return 'valid';
}

export function drugTestRowValidityLabelTh(status: DrugTestRowValidityStatus): string {
  if (status === 'valid') return 'Valid';
  if (status === 'expired') return 'Expired';
  return '—';
}

/** ครบแผง + negative ล่าสุดทุกสาร + ยังไม่ expired ณ วันอ้างอิง */
export function computeDrugPanelMobDrugOk(
  panelSubstances: DrugTestPanelSubstance[],
  tests: WorkerDrugTest[],
  referenceYmd: string,
): boolean {
  if (panelSubstances.length === 0) return true;
  const latestByKey = getLatestDrugTestBySubstance(tests);
  for (const s of panelSubstances) {
    const row = latestByKey.get(s.id);
    if (!row || row.result !== 'negative') return false;
    if (computeDrugTestRowValidityStatus(row, referenceYmd) !== 'valid') return false;
  }
  return true;
}

export const MOB_DRUG_TEST_GATE_MESSAGE_TH =
  'ผลตรวจสารเสพติดหมดอายุหรือยังไม่ครบแผง — ตรวจใหม่ให้สถานะ valid ก่อนยืนยันเดินทาง / mob / เริ่มงาน';

export function resolveMobReferenceDateYmd(
  assignment: Pick<Assignment, 'mobStandbyDate' | 'mobilizationDate' | 'assignedDate' | 'startDate'>,
): string {
  for (const raw of [
    assignment.mobStandbyDate,
    assignment.mobilizationDate,
    assignment.assignedDate,
    assignment.startDate,
  ]) {
    const t = (raw || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  }
  return thailandTodayYmd();
}

/** Pass = แผงครบ negative และยัง valid ภายใน DRUG_TEST_VALIDITY_DAYS วันหลังวันตรวจ ณ วัน mob */
export function computeMobDrugTestChecklistStatus(
  panelSubstances: DrugTestPanelSubstance[],
  tests: WorkerDrugTest[],
  mobReferenceDateYmd: string,
): ChecklistItemStatus {
  if (panelSubstances.length === 0) return 'pass';
  if (computeDrugPanelMobDrugOk(panelSubstances, tests, mobReferenceDateYmd)) return 'pass';

  const latestByKey = getLatestDrugTestBySubstance(tests);
  let anyPositive = false;
  for (const s of panelSubstances) {
    const row = latestByKey.get(s.id);
    if (!row) continue;
    if (row.result === 'positive') anyPositive = true;
  }
  if (anyPositive) return 'fail';
  return 'missing';
}

export function formatDrugTestRowLabel(t: WorkerDrugTest): string {
  const name = t.substanceLabelSnapshot || t.substanceKey || 'สาร';
  const dateStr = t.testDate ? formatOptionalDateThaiBE(t.testDate, '—') : '—';
  const loc = displayLocation(t);
  const res =
    t.result === 'negative' ? 'NEGATIVE' : t.result === 'positive' ? 'POSITIVE' : 'NONE';
  return `${name} | ${dateStr} | ${loc} | ${res}`;
}
