/**
 * English descriptions for commercial invoice lines that were generated in Thai
 * (see `billing-line-generator.ts` `descriptionForLine`).
 * Position titles may stay in Thai; standard billing phrases are translated.
 */
export function translateCommercialWaveCodeToEn(text: string): string {
  let s = text;
  if (!s) return s;

  s = s.replace(/รอบเดินทาง/g, 'Trip cycle');
  s = s.replace(/PO\+งวด\s*\(\s*รวม\s*wave\s*\)/gi, 'PO+month (all waves)');
  // PO+งวด (บางส่วน · 4 คน · รอบ 1) / (บางส่วน - 4 คน)
  s = s.replace(
    /PO\+งวด\s*\(\s*บางส่วน\s*[·\-–—]\s*(\d+)\s*คน(?:\s*[·\-–—]\s*รอบ\s*(\d+))?\s*\)/gi,
    (_m, workers: string, batch?: string) =>
      batch
        ? `PO+month (partial · ${workers} workers · round ${batch})`
        : `PO+month (partial · ${workers} workers)`,
  );
  s = s.replace(/PO\+งวด/g, 'PO+month');
  s = s.replace(/บางส่วน/g, 'partial');
  s = s.replace(/รอบ\s+(\d+)/g, 'round $1');
  s = s.replace(/(\d+)\s*คน\b/g, '$1 workers');
  return s;
}

/** Notes / TERMS on commercial invoice print — Thai phrases → English */
export function translateCommercialNotesToEn(text: string): string {
  let s = text;
  if (!s) return s;

  s = s.replace(/Partial billing\s*\(\s*อนุมัติรายคน\s*\)\s*:/gi, 'Partial billing (per-worker approval):');
  s = s.replace(/Partial billing\s*รอบ\s*(\d+)\s*:/gi, 'Partial billing round $1:');
  s = s.replace(/อนุมัติรายคน/g, 'per-worker approval');
  s = s.replace(/รอบ\s+(\d+)/g, 'round $1');
  return s;
}

export function translateCommercialLineDescriptionToEn(text: string): string {
  let s = text;
  if (!s) return s;

  const sep = String.raw`[\s·\-\u2013\u2014]*`; // middle dot, hyphen, en/em dash

  s = s.replace(/ค่า Mob\/Demob ไป-กลับ/gi, 'Mob/Demob round-trip fee');
  s = s.replace(/ และอีก (\d+) คน/g, ' and $1 more');

  // Current billing style: (รวม 12 คน-วัน · พนักงาน 6 คน) or hyphen between segments
  s = s.replace(
    new RegExp(
      String.raw`\(\s*รวม\s+(\d+)\s+คน-วัน${sep}พนักงาน\s+(\d+)\s*คน\s*\)`,
      'gi',
    ),
    '(Total $1 person-days, $2 workers)',
  );
  s = s.replace(
    new RegExp(String.raw`\(\s*รวม\s+(\d+)\s+คน-วัน\s*\)`, 'gi'),
    '(Total $1 person-days)',
  );

  // Hours + optional worker count: (รวม 96 ชม. (ชม.ปกติในแพ็กขาย) · พนักงาน 3 คน)
  s = s.replace(
    new RegExp(
      String.raw`\(\s*รวม\s+([\d.]+)\s+ชม\.\s*\(ชม\.ปกติในแพ็กขาย\)${sep}พนักงาน\s+(\d+)\s*คน\s*\)`,
      'gi',
    ),
    '(Total $1 normal pack hrs, $2 workers)',
  );
  s = s.replace(
    new RegExp(
      String.raw`\(\s*รวม\s+([\d.]+)\s+ชม\.${sep}พนักงาน\s+(\d+)\s*คน\s*\)`,
      'gi',
    ),
    '(Total $1 hrs, $2 workers)',
  );
  s = s.replace(new RegExp(String.raw`\(\s*รวม\s+([\d.]+)\s+ชม\.\s*\)`, 'gi'), '(Total $1 hrs)');

  // Legacy / alternate phrasing: N คน · X วัน (person-calendar days wording)
  s = s.replace(/\(\s*(\d+)\s*คน\s*·\s*([\d.]+)\s*วัน\s*\)/g, '($1 persons × $2 days)');
  s = s.replace(/\(\s*(\d+)\s*คน\s+([\d.]+)\s*วัน\s*\)/g, '($1 persons × $2 days)');
  s = s.replace(/\(\s*(\d+)คน\s*([\d.]+)\s*วัน\s*\)/g, '($1 persons × $2 days)');
  s = s.replace(/\(\s*(\d+)\s*คน\s*·\s*([\d.]+)\s*ชม\.\s*\)/g, '($1 persons × $2 hrs)');
  s = s.replace(/\(\s*(\d+)\s*คน\s+([\d.]+)\s*ชม\.\s*\)/g, '($1 persons × $2 hrs)');
  s = s.replace(/\(\s*(\d+)คน\s*([\d.]+)\s*ชม\.\s*\)/g, '($1 persons × $2 hrs)');
  s = s.replace(/\(\s*([\d.]+)\s*ชม\.\s*\)/g, '($1 hrs)');
  s = s.replace(/\(\s*([\d.]+)\s*วัน\s*\)/g, '($1 days)');

  s = s.replace(/ชม\.ปกติเกินกรอบ 8 ชม\. \(ขาย\)/g, 'Normal hours beyond 8 hrs (billing)');
  s = s.replace(/ทำงานวันหยุดนักขัตฤกษ์/g, 'Public holiday work');
  s = s.replace(/ทำงานวันหยุด/g, 'Weekly off-day work');
  s = s.replace(/ค่าแรงวันทำงาน/g, 'Daily wage');
  // Compound standby + mob/demob before single-word replaces (spelling variants included)
  s = s.replace(
    /สแตน(?:ด์)?บาย\s*[-—–]?\s*ดีโมบิ(?:ไลเซชัน|ลเซชั่น|ไลเซชั่น|ลเซชัน)/g,
    'Standby demobilization',
  );
  s = s.replace(
    /สแตน(?:ด์)?บาย\s*[-—–]?\s*โมบิ(?:ไลเซชัน|ลเซชั่น|ไลเซชั่น|ลเซชัน)/g,
    'Standby mobilization',
  );
  s = s.replace(/สแตนด์บาย|สแตนบาย/g, 'Standby');
  s = s.replace(/วันเดินทาง/g, 'Travel day');
  s = s.replace(/ดีโมบิ(?:ไลเซชัน|ลเซชั่น|ไลเซชั่น|ลเซชัน)/g, 'Demobilization');
  s = s.replace(/โมบิ(?:ไลเซชัน|ลเซชั่น|ไลเซชั่น|ลเซชัน)/g, 'Mobilization');
  s = s.replace(/ส่วนลด\s*\/\s*ค่าเพิ่ม/g, 'Discount / surcharge');
  s = s.replace(/\(ระบุรายละเอียด\)/g, '(specify details)');
  s = s.replace(/หน่วย/g, 'units');
  s = s.replace(/ชม\./g, 'hrs');

  return s;
}
