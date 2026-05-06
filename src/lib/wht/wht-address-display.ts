const THAI_CHAR = /[\u0E00-\u0E7F]/;

function hasThaiScript(s: string): boolean {
  return THAI_CHAR.test(s);
}

/** จุดเริ่มของบล็อกที่อยู่ไทย (รวมเลขที่แบบ 4/11-4/12 หน้า ถ.) */
function thaiAddressBlockStart(s: string, thaiIdx: number): number {
  let start = thaiIdx;
  const head = s.slice(0, thaiIdx);
  const hn = head.match(/((?:\d+\/)+\d+(?:-\d+(?:\/\d+)+)?)\s*$/);
  if (hn && hn.index !== undefined && !/[A-Za-z]{4,}/.test(hn[1])) {
    start = hn.index;
  }
  return start;
}

/**
 * ใช้ในช่อง «ที่อยู่ (ภาษาไทย)» บนใบหัก ม.50
 * - ตัดส่วน Latin ทั้งหมดก่อนอักษรไทยตัวแรก
 * - ตัดท้ายที่เป็นคำ/วลีอังกฤษต่อท้าย (เช่น Province, Road)
 * - ใช้ซ้ำได้กับ snapshot เก่าที่บันทึกข้อความปนไว้ใน addressTh
 */
export function whtCertificateThaiAddressDisplay(raw: string | undefined | null): string {
  let s = (raw ?? '').trim();
  if (!s) return '—';
  const thaiIdx = s.search(THAI_CHAR);
  if (thaiIdx < 0) return s;

  const start = thaiAddressBlockStart(s, thaiIdx);
  s = s.slice(start).trim();

  for (let n = 0; n < 24; n++) {
    const m = s.match(/\s+([A-Za-z#][A-Za-z\s,.;\-\/#']*)$/);
    if (!m || m.index === undefined) break;
    const chunk = m[1].trim();
    if (hasThaiScript(chunk)) break;
    if (/^[\d\s,.;\-\/#']+$/.test(chunk)) break;
    s = s.slice(0, m.index).trim().replace(/[,;\s]+$/, '');
  }
  return s.trim() || '—';
}

/** ส่วนภาษาอังกฤษก่อนบล็อกที่อยู่ไทย — เติมช่องที่อยู่ EN เมื่อแยกจากฟิลด์ปน */
export function whtCertificateEnglishLeadFromMixed(raw: string | undefined | null): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  const thaiIdx = t.search(THAI_CHAR);
  if (thaiIdx <= 0) return '';
  const start = thaiAddressBlockStart(t, thaiIdx);
  return t.slice(0, start).trim().replace(/[,;\s·]+$/, '');
}
