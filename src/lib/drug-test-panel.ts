import type {
  Assignment,
  ChecklistItemStatus,
  DrugTestPanelSubstance,
  WaveMonthTimesheetPhotoAttachment,
  WorkerDrugTest,
  WorkerDrugTestKitResult,
} from '@/lib/types';
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

/** ชุดตรวจที่แสดงต่อรอบ — รายการใหม่ใช้ kitResults, รายการเก่ายังเป็น substanceKey เดียว */
export function kitResultsForDisplay(t: WorkerDrugTest): WorkerDrugTestKitResult[] {
  if (Array.isArray(t.kitResults) && t.kitResults.length > 0) {
    return t.kitResults.filter((k) => Boolean(k.substanceKey));
  }
  if (t.substanceKey) {
    return [
      {
        substanceKey: t.substanceKey,
        substanceLabelSnapshot: t.substanceLabelSnapshot || t.substanceKey,
        result: t.result,
      },
    ];
  }
  return [];
}

export function listWorkerDrugTestAttachments(t: WorkerDrugTest): WaveMonthTimesheetPhotoAttachment[] {
  if (Array.isArray(t.attachments) && t.attachments.length > 0) return t.attachments;
  if (t.attachment?.downloadUrl) return [t.attachment];
  return [];
}

export function formatDrugTestBloodPressure(t: WorkerDrugTest): string {
  const s = Number(t.bloodPressureSystolic);
  const d = Number(t.bloodPressureDiastolic);
  if (!Number.isFinite(s) || !Number.isFinite(d) || s <= 0 || d <= 0) return '—';
  return `${s}/${d} mmHg`;
}

/** แตก kitResults เป็นแถวต่อชุด — ให้ mob / สรุปแผงยังนับผลรายชุดได้ */
export function expandDrugTestsForSubstanceLookup(tests: WorkerDrugTest[]): WorkerDrugTest[] {
  const out: WorkerDrugTest[] = [];
  for (const t of tests) {
    const kits = kitResultsForDisplay(t);
    if (kits.length > 1 || (kits.length === 1 && Array.isArray(t.kitResults) && t.kitResults.length > 0)) {
      for (const k of kits) {
        out.push({
          ...t,
          substanceKey: k.substanceKey,
          substanceLabelSnapshot: k.substanceLabelSnapshot || t.substanceLabelSnapshot,
          result: k.result,
        });
      }
    } else {
      out.push(t);
    }
  }
  return out;
}

/** ผลล่าสุดต่อ substanceKey (เรียง testDate) */
export function getLatestDrugTestBySubstance(tests: WorkerDrugTest[]): Map<string, WorkerDrugTest> {
  const map = new Map<string, WorkerDrugTest>();
  const sorted = [...expandDrugTestsForSubstanceLookup(tests)].sort(
    (a, b) => coerceTestDateMs(b.testDate) - coerceTestDateMs(a.testDate),
  );
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
    .filter((t) => Boolean(t.substanceKey) || kitResultsForDisplay(t).length > 0)
    .sort((a, b) => {
      const ta = Number(a.recordedAt || a.createdAt || a.testDate || 0);
      const tb = Number(b.recordedAt || b.createdAt || b.testDate || 0);
      if (tb !== ta) return tb - ta;
      return (b.id || '').localeCompare(a.id || '');
    });
}

/** บรรทัดที่บันทึกล่าสุด (ใช้ mob checklist) */
export function getLatestDrugTestRecord(tests: WorkerDrugTest[]): WorkerDrugTest | undefined {
  return sortDrugTestsNewestFirst(tests)[0];
}

function timestampToBangkokYmd(ms: number): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** สถานะ valid/expired ต่อแถวผลตรวจ — อิง negative + ไม่เกิน DRUG_TEST_VALIDITY_DAYS วันหลังวันตรวจ */
export function computeDrugTestRowValidityStatus(
  test: WorkerDrugTest,
  referenceYmd: string = thailandTodayYmd(),
): DrugTestRowValidityStatus {
  if (test.result !== 'negative') return 'n/a';
  const testMs = coerceTestDateMs(test.testDate);
  if (testMs <= 0) return 'n/a';
  const testYmd = timestampToBangkokYmd(testMs);
  if (!testYmd) return 'n/a';
  const days = calendarDaysBetweenYmd(testYmd, referenceYmd);
  if (days == null || days < 0) return 'expired';
  if (days > DRUG_TEST_VALIDITY_DAYS) return 'expired';
  return 'valid';
}

/** Valid ของรอบตรวจ — มีอย่างน้อยหนึ่งชุด NEGATIVE และยังอยู่ในช่วง 10 วัน */
export function computeDrugTestRecordValidityStatus(
  test: WorkerDrugTest,
  referenceYmd: string = thailandTodayYmd(),
): DrugTestRowValidityStatus {
  const kits = kitResultsForDisplay(test);
  if (kits.some((k) => k.result === 'negative')) {
    return computeDrugTestRowValidityStatus({ ...test, result: 'negative' }, referenceYmd);
  }
  return computeDrugTestRowValidityStatus(test, referenceYmd);
}

export function drugTestRowValidityLabelTh(status: DrugTestRowValidityStatus): string {
  if (status === 'valid') return 'Valid';
  if (status === 'expired') return 'Expired';
  return '—';
}

function normalizeDrugLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[-–—_/]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function coerceTestDateMs(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { toMillis?: () => number }).toMillis === 'function') {
    const ms = (raw as { toMillis: () => number }).toMillis();
    return Number.isFinite(ms) ? ms : 0;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** จับคู่ผลตรวจล่าสุดกับรายการในแผงปัจจุบัน (id ก่อน แล้ว fallback ชื่อ snapshot) */
export function resolveLatestPanelDrugTest(
  substance: DrugTestPanelSubstance,
  tests: WorkerDrugTest[],
): WorkerDrugTest | undefined {
  const latestByKey = getLatestDrugTestBySubstance(tests);
  const byId = latestByKey.get(substance.id);
  if (byId) return byId;

  const labelNorm = normalizeDrugLabel(substance.label || '');
  if (!labelNorm) return undefined;

  const candidates = tests.filter((t) => {
    if (!t.substanceKey) return false;
    const snap = normalizeDrugLabel(t.substanceLabelSnapshot || '');
    return snap === labelNorm;
  });
  if (candidates.length === 0) return undefined;

  return [...candidates].sort(
    (a, b) => coerceTestDateMs(b.testDate) - coerceTestDateMs(a.testDate),
  )[0];
}

/**
 * ความพร้อม mob ตามแผงปัจจุบัน
 * 1) ครบทุกแถวในแผง = negative + valid หรือ
 * 2) มีอย่างน้อยหนึ่งผล Valid ในแผง (เช่น ชุดตรวจรวม 7-in-1) และไม่มี positive — ตรวจใหม่ผ่านแล้วให้ mob ได้
 * 3) fallback เมื่อแผงเปลี่ยน id/ชื่อ: ผลล่าสุด overall เป็น Valid และไม่มี positive ในชุดล่าสุดต่อสาร
 */
export function computeCurrentPanelDrugMobReady(
  panelSubstances: DrugTestPanelSubstance[],
  tests: WorkerDrugTest[],
  referenceYmd: string = thailandTodayYmd(),
): boolean {
  if (panelSubstances.length === 0) return true;

  let anyPositiveOnPanel = false;
  let allStrictOk = true;
  let anyValidOnPanel = false;

  for (const s of panelSubstances) {
    const row = resolveLatestPanelDrugTest(s, tests);
    if (row?.result === 'positive') anyPositiveOnPanel = true;
    const ok =
      !!row &&
      row.result === 'negative' &&
      computeDrugTestRowValidityStatus(row, referenceYmd) === 'valid';
    if (ok) anyValidOnPanel = true;
    else allStrictOk = false;
  }

  if (anyPositiveOnPanel) return false;
  if (allStrictOk) return true;
  // ตรวจใหม่ Valid อย่างน้อยหนึ่งแถวที่จับคู่แผง → อนุญาต mob (ชุดรวมครอบคลุมแถวอื่นที่หมดอายุ/ยังไม่ครบ)
  if (anyValidOnPanel) return true;

  const latestOverall = getLatestDrugTestRecord(tests);
  if (
    latestOverall &&
    latestOverall.result === 'negative' &&
    computeDrugTestRowValidityStatus(latestOverall, referenceYmd) === 'valid'
  ) {
    const latestByKey = getLatestDrugTestBySubstance(tests);
    for (const row of latestByKey.values()) {
      if (row.result === 'positive') return false;
    }
    return true;
  }

  return false;
}

/** @deprecated ใช้ computeCurrentPanelDrugMobReady — คงชื่อเดิมให้ call site เดิม */
export function computeDrugPanelMobDrugOk(
  panelSubstances: DrugTestPanelSubstance[],
  tests: WorkerDrugTest[],
  mobReferenceDateYmd?: string,
): boolean {
  void mobReferenceDateYmd;
  return computeCurrentPanelDrugMobReady(panelSubstances, tests, thailandTodayYmd());
}

export const MOB_DRUG_TEST_GATE_MESSAGE_TH =
  'ผลตรวจสารเสพติดยังไม่ Valid — ตรวจใหม่ให้ NEGATIVE และอยู่ในช่วง 10 วัน แล้วจึง mob ได้';

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

/**
 * วันอ้างอิง validity — ใช้วันนี้ (Asia/Bangkok) ให้ตรงทะเบียนลูกจ้าง
 * ไม่ย้อนไปวันมอบหมาย/mob เก่าที่ทำให้ผล valid กลายเป็น expired
 */
export function resolveDrugTestValidityReferenceYmd(_mobReferenceDateYmd?: string): string {
  return thailandTodayYmd();
}

/** Pass = มีผล Valid ในแผง (หรือชุดล่าสุด Valid) — ตรวจใหม่ผ่านแล้วให้ mob ได้; positive = fail */
export function computeMobDrugTestChecklistStatus(
  panelSubstances: DrugTestPanelSubstance[],
  tests: WorkerDrugTest[],
  _mobReferenceDateYmd?: string,
): ChecklistItemStatus {
  if (panelSubstances.length === 0) return 'pass';
  const referenceYmd = thailandTodayYmd();

  if (computeCurrentPanelDrugMobReady(panelSubstances, tests, referenceYmd)) return 'pass';

  for (const s of panelSubstances) {
    const row = resolveLatestPanelDrugTest(s, tests);
    if (row?.result === 'positive') return 'fail';
  }
  const latestByKey = getLatestDrugTestBySubstance(tests);
  for (const row of latestByKey.values()) {
    if (row.result === 'positive') return 'fail';
  }
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
