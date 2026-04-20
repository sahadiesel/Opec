/**
 * English descriptions for commercial invoice lines that were generated in Thai
 * (see `billing-line-generator.ts` `descriptionForLine`).
 * Position titles may stay in Thai; standard billing phrases are translated.
 */
export function translateCommercialLineDescriptionToEn(text: string): string {
  let s = text;
  if (!s) return s;

  // People + days / hours inside parentheses — run before phrase replacements
  s = s.replace(/\(\s*(\d+)\s*คน\s*·\s*([\d.]+)\s*วัน\s*\)/g, '($1 Persons $2 Days)');
  s = s.replace(/\(\s*(\d+)\s*คน\s+([\d.]+)\s*วัน\s*\)/g, '($1 Persons $2 Days)');
  s = s.replace(/\(\s*(\d+)คน\s*([\d.]+)\s*วัน\s*\)/g, '($1 Persons $2 Days)');
  s = s.replace(/\(\s*(\d+)\s*คน\s*·\s*([\d.]+)\s*ชม\.\s*\)/g, '($1 Persons $2 hrs)');
  s = s.replace(/\(\s*(\d+)\s*คน\s+([\d.]+)\s*ชม\.\s*\)/g, '($1 Persons $2 hrs)');
  s = s.replace(/\(\s*(\d+)คน\s*([\d.]+)\s*ชม\.\s*\)/g, '($1 Persons $2 hrs)');
  s = s.replace(/\(\s*([\d.]+)\s*ชม\.\s*\)/g, '($1 hrs)');
  s = s.replace(/\(\s*([\d.]+)\s*วัน\s*\)/g, '($1 Days)');

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
