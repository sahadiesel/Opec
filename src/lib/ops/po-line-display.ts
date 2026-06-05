import type { POLine, Position } from '@/lib/types';
import { formatDateThaiBE, timestampToHtmlDateValue } from '@/lib/date-thai';
import { positionListPrimaryName, type PositionDoc } from '@/lib/position-display';

const PO_LINE_STATUS_LABEL: Record<POLine['status'], string> = {
  active: 'ใช้งาน',
  cancelled: 'ยกเลิก',
  completed: 'ปิดแล้ว',
};

/** ป้ายเลือกบรรทัด PO — ไม่แสดง Firestore doc id เป็นหลัก */
export function formatPoLineSiteOptionLabel(
  line: Pick<
    POLine,
    'id' | 'positionId' | 'workLocation' | 'quantity' | 'startDate' | 'endDate' | 'billingUnitSnapshot' | 'status'
  >,
  options?: {
    position?: Position | PositionDoc | null;
    lineIndex?: number;
  },
): string {
  const chunks: string[] = [];

  const loc = (line.workLocation || '').trim();
  if (loc) chunks.push(loc);

  const posName = options?.position ? positionListPrimaryName(options.position as PositionDoc) : '';
  if (posName) chunks.push(posName);

  const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
  if (qty > 0) {
    const unit = (line.billingUnitSnapshot || 'คน').trim() || 'คน';
    chunks.push(`${qty} ${unit}`);
  }

  const startYmd = line.startDate ? timestampToHtmlDateValue(line.startDate) : '';
  const endYmd = line.endDate ? timestampToHtmlDateValue(line.endDate) : '';
  if (startYmd && endYmd) {
    chunks.push(`${formatDateThaiBE(startYmd)}–${formatDateThaiBE(endYmd)}`);
  } else if (startYmd) {
    chunks.push(`เริ่ม ${formatDateThaiBE(startYmd)}`);
  }

  if (line.status && line.status !== 'active') {
    chunks.push(PO_LINE_STATUS_LABEL[line.status] ?? line.status);
  }

  const lineNo =
    options?.lineIndex != null && Number.isFinite(options.lineIndex)
      ? `บรรทัด ${options.lineIndex + 1}`
      : null;

  if (chunks.length > 0) {
    return lineNo ? `${lineNo}: ${chunks.join(' · ')}` : chunks.join(' · ');
  }

  if (lineNo) return `${lineNo} (${line.id.slice(0, 6)}…)`;
  return `บรรทัด PO (${line.id.slice(0, 8)}…)`;
}
