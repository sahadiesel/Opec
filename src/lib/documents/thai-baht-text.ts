/**
 * แปลงจำนวนเงินเป็นข้อความไทย (บาท/สตางค์) สำหรับแสดงใต้ยอดสุทธิบนเอกสารพิมพ์
 */

const DIGIT = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];

/** จำนวนเต็ม 1–999999 (ไม่รวมล้าน — ใช้ร่วมกับล้านแยก) */
function belowMillion(n: number): string {
  if (n <= 0) return '';
  const s = String(n).padStart(6, '0');
  const d = s.split('').map((c) => parseInt(c, 10));
  let out = '';
  const u = ['แสน', 'หมื่น', 'พัน', 'ร้อย', 'สิบ', ''];
  for (let i = 0; i < 6; i++) {
    const v = d[i];
    if (v === 0) continue;
    if (i === 4) {
      if (v === 1) out += 'สิบ';
      else if (v === 2) out += 'ยี่สิบ';
      else out += DIGIT[v] + 'สิบ';
    } else if (i === 5) {
      out += v === 1 && d[4] !== 0 ? 'เอ็ด' : DIGIT[v];
    } else {
      if (i === 2 && v === 1) out += 'หนึ่งพัน';
      else out += DIGIT[v] + u[i];
    }
  }
  return out;
}

function integerToThai(n: number): string {
  if (!Number.isFinite(n) || n < 0) return 'ศูนย์';
  if (n === 0) return 'ศูนย์';
  if (n >= 1_000_000) {
    const m = Math.floor(n / 1_000_000);
    const r = n % 1_000_000;
    return integerToThai(m) + 'ล้าน' + (r ? belowMillion(r) : '');
  }
  return belowMillion(n) || 'ศูนย์';
}

/** เช่น (ห้าพันสามร้อยห้าสิบบาทถ้วน) */
export function amountToThaiBahtText(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const baht = Math.floor(rounded);
  const satang = Math.round((rounded - baht) * 100);
  let t = '(' + integerToThai(baht) + 'บาท';
  if (satang === 0) {
    t += 'ถ้วน)';
  } else {
    t += integerToThai(satang) + 'สตางค์)';
  }
  return t;
}
