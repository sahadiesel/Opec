/**
 * หน่วยของรายการเอกสาร — รูปแบบเดียวกับใบเสนอราคา
 * เอกสารเก่าที่ฝังหน่วยท้ายคำอธิบายเป็น `ชื่อ (EA)` หรือ `ชื่อ (EA) — หมายเหตุ` ยังแยกออกมาแสดงได้
 */

const TRAILING_UNIT = /^(.*\S)\s+\(([^()]+)\)(\s+—\s+[\s\S]*)?$/;

function isUnitToken(token: string): boolean {
  const unit = token.trim();
  if (!unit || unit.length > 24) return false;
  if ((unit.match(/\s/g) || []).length > 1) return false;
  if (/person-day|คน-วัน|total|รวม/i.test(unit)) return false;
  return true;
}

export function splitEmbeddedUnit(description: string): { description: string; unit: string } | null {
  const m = TRAILING_UNIT.exec(description.trim());
  if (!m || !isUnitToken(m[2])) return null;
  return { description: `${m[1]}${m[3] ?? ''}`, unit: m[2].trim() };
}

/** คำอธิบายไม่ซ้ำหน่วย และค่าสำหรับคอลัมน์หน่วย */
export function presentDocumentLineUnit(line: {
  description?: string;
  unit?: string;
}): { description: string; unit: string } {
  const raw = (line.description || '—').replace(/\r\n/g, '\n');
  const stored = (line.unit || '').trim();
  const split = splitEmbeddedUnit(raw);
  if (stored) {
    if (split && split.unit.toLowerCase() === stored.toLowerCase()) {
      return { description: split.description, unit: stored };
    }
    return { description: raw, unit: stored };
  }
  if (split) return split;
  return { description: raw, unit: '—' };
}
