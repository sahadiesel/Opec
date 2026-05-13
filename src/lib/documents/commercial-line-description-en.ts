/**
 * English descriptions for commercial invoice lines that were generated in Thai
 * (see `billing-line-generator.ts` `descriptionForLine`).
 * Position titles may stay in Thai; standard billing phrases are translated.
 */
export function translateCommercialLineDescriptionToEn(text: string): string {
  let s = text;
  if (!s) return s;

  const sep = String.raw`[\s·\-\u2013\u2014]*`; // middle dot, hyphen, en/em dash

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
  s = s.replace(/สแตนด์บาย|สแตนบาย/g, 'Standby');
  s = s.replace(/วันเดินทาง/g, 'Travel day');
  s = s.replace(/โมบิไลเซชัน/g, 'Mobilization');
  s = s.replace(/ดีโมบิไลเซชัน/g, 'Demobilization');
  s = s.replace(/หน่วย/g, 'units');
  s = s.replace(/ชม\./g, 'hrs');

  return s;
}
