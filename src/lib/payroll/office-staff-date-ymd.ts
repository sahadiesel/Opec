const BE_YEAR_OFFSET = 543;

/**
 * แปลงค่าวันที่จากทะเบียนพนักงาน → yyyy-MM-dd (ปฏิทิน ค.ศ., Asia/Bangkok)
 * รองรับ yyyy-MM-dd, ปี พ.ศ. (25xx), epoch ms, และ Firestore Timestamp
 */
export function normalizeStaffDateYmd(value: unknown): string | null {
  if (value == null || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return msToBangkokYmd(value);
  }

  if (typeof value === 'object' && value !== null) {
    if ('toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
      const d = (value as { toDate: () => Date }).toDate();
      return msToBangkokYmd(d.getTime());
    }
    if ('seconds' in value) {
      const sec = Number((value as { seconds: number }).seconds);
      if (Number.isFinite(sec)) return msToBangkokYmd(sec * 1000);
    }
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return msToBangkokYmd(raw.length <= 10 ? n * 1000 : n);
  }

  const iso = raw.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;

  let year = Number(m[1]);
  const month = m[2];
  const day = m[3];
  if (!Number.isFinite(year)) return null;

  // ปี พ.ศ. ที่เก็บผิดรูปแบบ เช่น 2569-06-04
  if (year >= 2400 && year <= 2600) {
    year -= BE_YEAR_OFFSET;
  }

  if (year < 1990 || year > 2100) return null;
  return `${year}-${month}-${day}`;
}

function msToBangkokYmd(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const ymd = new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}
