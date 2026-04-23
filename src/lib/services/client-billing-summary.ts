'use client';

import type { Firestore } from 'firebase/firestore';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { generateBillingLines, type BillingLineGenerationResult } from '@/lib/services/billing-line-generator';

/**
 * ผลลัพธ์ต่อ PO จาก {@link generateBillableSummaryForClientAndPeriod} — ใช้ logic เดียวกับใบวางบิล (ทุก Wave ใต้ PO ในงวด)
 */
export type PerPoBillableSummary = {
  poId: string;
  result: BillingLineGenerationResult;
};

/**
 * ดึงข้อมูล **Daily Timesheet** ที่เกี่ยวกับ labor billing มาสรุป **รวมอัตโนมัติตาม PO ของลูกค้า** โดยไม่จำกัดราย **Wave** รายเดียว
 *
 * **ลำดับการทำงาน (ไม่แตะโครงสร้าง / ไม่ต้องเปลี่ยนชื่อ Wave):**
 * 1. หาเอกสาร `purchase_orders` ที่ `customerId` ตรงกับ `customerId` ที่ส่ง
 * 2. กับแต่ละ `poId` เรียก `generateBillingLines` กับ `waveId` = `undefined` — ฝั่ง `daily_timesheets` จะถูก filter แค่
 *    `purchaseOrderId` + ช่วง `date` + `readyForBilling` **ไม่**ใส่เงื่อนไข `waveId` ดังนั้นรวมทุก row ไม่ว่าจะลงมาจาก Wave ใดที่ผูกกับ PO นี้
 * 3. ส่งกลับเป็น array ราย **PO** พร้อม `BillingLineGenerationResult` แยกกันต่อ PO (สำหรับ UI / รายงาน)
 *
 * **ข้อจำกัด/หมายเหตุ:**
 * - ไม่เพิ่ม/ลบ/เปลี่ยนชื่อฟิลด์ Firestore; Wave / mobilization / flow เดิมยังทำงานเดิม
 * - PO สายใบเสนอราคา (quotation) มักไม่มียอด timesheet แบบ labor ในงวด — รายการนั้นจะไม่อยู่ในผลลัพธ์ (ไม่ error)
 *
 * @see `generateBillingLines` ใน `billing-line-generator.ts` — จุดที่ `waveId` เป็น `undefined` หมายถึงไม่กรอง wave
 */
export async function generateBillableSummaryForClientAndPeriod(
  db: Firestore,
  customerId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PerPoBillableSummary[]> {
  const cid = (customerId || '').trim();
  if (!cid) return [];
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    return [];
  }

  const posSnap = await getDocs(
    query(collection(db, 'purchase_orders'), where('customerId', '==', cid)),
  );

  const withData: PerPoBillableSummary[] = [];
  for (const d of posSnap.docs) {
    const poId = d.id;
    const result = await generateBillingLines(db, poId, periodStart, periodEnd, undefined);
    if (result.lines.length > 0 || result.timesheetCount > 0) {
      withData.push({ poId, result });
    }
  }

  withData.sort((a, b) => a.poId.localeCompare(b.poId));
  return withData;
}

/**
 * รวมยอดรวมจาก {@link generateBillableSummaryForClientAndPeriod} สำหรับแสดงบน UI โดยไม่สร้างเอกสาร
 */
export function sumClientBillableSummary(rows: PerPoBillableSummary[]): {
  totalAmount: number;
  timesheetCount: number;
  lineCount: number;
} {
  let totalAmount = 0;
  let timesheetCount = 0;
  let lineCount = 0;
  for (const { result } of rows) {
    totalAmount += result.totalAmount;
    timesheetCount += result.timesheetCount;
    lineCount += result.lines.length;
  }
  return { totalAmount, timesheetCount, lineCount };
}
