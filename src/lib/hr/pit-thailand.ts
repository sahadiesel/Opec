/**
 * อัตราภาษีเงินได้บุคคลธรรมดาแบบขั้นบันได (ฐานเงินได้สุทธิรายปี)
 * อ้างอิงหลักเกณฑ์กรมสรรพากร — ตัวเลขช่วงเงินได้และยอดบวกสะสมใช้สำหรับคำนวณในระบบสลิป/งวด
 * (ตรวจสอบปีภาษีกับประกาศฉบับล่าสุดเมื่อมีการปรับอัตรา)
 */

/** ขั้นบันไดแบบ marginal — ภาษีรวม = Σ (min(n,to) - from) × rate สำหรับทุกขั้นที่ n แตะ */
export type PitProgressiveBand = {
  fromBaht: number;
  /** null = ไม่มีเพดานบน (ใช้กับขั้นสุดท้าย) */
  toBaht: number | null;
  /** อัตราส่วนเกิน from ในช่วงนี้ (0–100) */
  ratePercent: number;
};

/** ค่าเริ่มต้นสอดคล้องตารางอ้างอิงเดิมของระบบ */
export const DEFAULT_PIT_PROGRESSIVE_BANDS: PitProgressiveBand[] = [
  { fromBaht: 0, toBaht: 150_000, ratePercent: 0 },
  { fromBaht: 150_000, toBaht: 300_000, ratePercent: 5 },
  { fromBaht: 300_000, toBaht: 500_000, ratePercent: 10 },
  { fromBaht: 500_000, toBaht: 750_000, ratePercent: 15 },
  { fromBaht: 750_000, toBaht: 1_000_000, ratePercent: 20 },
  { fromBaht: 1_000_000, toBaht: 2_000_000, ratePercent: 25 },
  { fromBaht: 2_000_000, toBaht: 5_000_000, ratePercent: 30 },
  { fromBaht: 5_000_000, toBaht: null, ratePercent: 35 },
];

function formatBaht(n: number): string {
  return n.toLocaleString('th-TH');
}

/** สร้างข้อความแสดงช่วงจากแถวติดกัน */
export function pitBandsToReferenceRows(
  bands: PitProgressiveBand[]
): { rangeLabel: string; rateLabel: string; formulaNote: string }[] {
  const sorted = [...bands].sort((a, b) => a.fromBaht - b.fromBaht);
  return sorted.map((b) => {
    const rateLabel = b.ratePercent === 0 ? 'ยกเว้น (0%)' : `${b.ratePercent}%`;
    let rangeLabel: string;
    if (b.toBaht == null) {
      rangeLabel = `${formatBaht(b.fromBaht + 1)} ขึ้นไป`;
    } else if (b.fromBaht === 0) {
      rangeLabel = `0 – ${formatBaht(b.toBaht)}`;
    } else {
      rangeLabel = `${formatBaht(b.fromBaht + 1)} – ${formatBaht(b.toBaht)}`;
    }
    const formulaNote =
      b.ratePercent === 0
        ? 'ภาษี = 0'
        : `หักภาษีในอัตรา ${b.ratePercent}% ส่วนที่เกิน ${formatBaht(b.fromBaht)} ถึง${b.toBaht == null ? ' …' : ` ${formatBaht(b.toBaht)}`}`;
    return { rangeLabel, rateLabel, formulaNote };
  });
}

/** ตารางอ้างอิงเริ่มต้นสำหรับ UI */
export const THAI_PIT_REFERENCE_ROWS = pitBandsToReferenceRows(DEFAULT_PIT_PROGRESSIVE_BANDS);

/**
 * คำนวณภาษีรายปีจากขั้นบันไดที่กำหนด (เงินได้สุทธิหลังหักลดหย่อนแล้ว)
 */
export function calculateAnnualPITFromProgressiveBands(
  netAssessableIncomeAnnual: number,
  bands: PitProgressiveBand[]
): number {
  const n = Math.max(0, netAssessableIncomeAnnual);
  if (!bands.length) return 0;
  const sorted = [...bands].sort((a, b) => a.fromBaht - b.fromBaht);
  let tax = 0;
  for (const b of sorted) {
    if (n <= b.fromBaht) break;
    const top = b.toBaht == null ? n : Math.min(n, b.toBaht);
    const slice = top - b.fromBaht;
    if (slice > 0) {
      tax += slice * (b.ratePercent / 100);
    }
  }
  return tax;
}

/**
 * คำนวณภาษีเงินได้บุคคลธรรมดา รายปี จากฐานเงินได้สุทธิ (หลังหักลดหย่อนแล้ว — ฝั่งเรียกต้องส่งยอดที่ถูกต้องตามงวด)
 * ใช้ตารางค่าเริ่มต้น — ถ้ามีตั้งค่าใน payroll_policies ให้ใช้ calculateAnnualPITFromProgressiveBands
 */
export function calculateThaiAnnualPIT(netAssessableIncomeAnnual: number): number {
  return calculateAnnualPITFromProgressiveBands(netAssessableIncomeAnnual, DEFAULT_PIT_PROGRESSIVE_BANDS);
}

/** อัตราหักประกันสังคมฝั่งลูกจ้าง (% ของค่าจ้างที่นำมาคำนวณ) — ตรวจสอบเพดานต่อเดือนตามปีกับกฎ กสร. */
export const DEFAULT_SOCIAL_SECURITY_EMPLOYEE_RATE_PERCENT = 5;

/**
 * เพดานเงินค่าจ้างสำหรับคำนวณประกันสังคมต่อเดือน (บาท) — ปรับตามประกาศ กสร. แต่ละปี
 * ค่าเริ่มต้นใช้เป็นฐานใน UI เท่านั้น ระบบคำนวณจริงควรอ่านจากตั้งค่าหรือปีภาษี
 */
export const DEFAULT_SOCIAL_SECURITY_MONTHLY_CEILING_BAHT = 15_000;

export function cloneDefaultPitBands(): PitProgressiveBand[] {
  return DEFAULT_PIT_PROGRESSIVE_BANDS.map((b) => ({ ...b }));
}

/**
 * ผูกค่า from ของแต่ละขั้นให้ต่อเนื่องจากค่า "ถึง" ของขั้นก่อนหน้า (เกณฑ์ภาษีแบบขั้นบันได)
 * ขั้นแรก from = 0 — ใน UI จะแสดงช่วงเริ่มที่ 1 บาทถัดจากเพดาน (ผ่าน pitBandsToReferenceRows)
 */
export function rechainPitBandsFromTops(bands: PitProgressiveBand[]): PitProgressiveBand[] {
  if (bands.length === 0) return bands;
  const out = bands.map((b) => ({ ...b }));
  out[0] = { ...out[0], fromBaht: 0 };
  for (let i = 1; i < out.length; i++) {
    const prevTo = out[i - 1].toBaht;
    if (prevTo != null && Number.isFinite(prevTo)) {
      out[i] = { ...out[i], fromBaht: Math.round(prevTo) };
    }
  }
  return out;
}

export function normalizePitBands(input: unknown): PitProgressiveBand[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: PitProgressiveBand[] = [];
  for (const row of input) {
    if (!row || typeof row !== 'object') return null;
    const o = row as Record<string, unknown>;
    const fromBaht = Math.round(Number(o.fromBaht));
    const ratePercent = Number(o.ratePercent);
    if (!Number.isFinite(fromBaht) || fromBaht < 0) return null;
    if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) return null;
    let toBaht: number | null;
    if (o.toBaht === null || o.toBaht === undefined || o.toBaht === '') {
      toBaht = null;
    } else {
      const t = Math.round(Number(o.toBaht));
      if (!Number.isFinite(t) || t <= 0) return null;
      toBaht = t;
    }
    out.push({ fromBaht, toBaht, ratePercent });
  }
  const sorted = [...out].sort((a, b) => a.fromBaht - b.fromBaht);
  const chained = rechainPitBandsFromTops(sorted);
  for (let i = 0; i < chained.length; i++) {
    const b = chained[i];
    const isLast = i === chained.length - 1;
    if (b.toBaht != null) {
      if (!Number.isFinite(b.toBaht) || b.toBaht <= b.fromBaht) return null;
    } else if (!isLast) {
      return null;
    }
    if (!isLast && b.toBaht == null) return null;
  }
  return chained;
}
