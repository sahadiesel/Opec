import type { PrintDocumentLocale } from '@/lib/documents/document-print-i18n';
import type { Quotation, QuotationCreditCountFrom, QuotationPaymentKind } from '@/lib/types';

export const QUOTATION_CREDIT_COUNT_FROM_OPTIONS: {
  value: QuotationCreditCountFrom;
  th: string;
  en: string;
}[] = [
  { value: 'delivery', th: 'ส่งสินค้า', en: 'delivery' },
  { value: 'billing', th: 'วางบิล', en: 'billing' },
  { value: 'invoice_date', th: 'วันที่ออกใบแจ้งหนี้', en: 'the invoice date' },
  { value: 'goods_receipt', th: 'รับสินค้า', en: 'receipt of goods' },
  { value: 'custom', th: 'ระบุเอง', en: 'custom' },
];

export type QuotationPaymentDraft = Pick<
  Quotation,
  'paymentKind' | 'paymentCreditDays' | 'paymentCountFrom' | 'paymentCountFromCustom'
>;

export function quotationPaymentTermError(value: QuotationPaymentDraft): string | null {
  if (value.paymentKind !== 'credit') return null;
  const days = Number(value.paymentCreditDays);
  if (!Number.isInteger(days) || days < 1) {
    return 'กรุณาระบุจำนวนวันเครดิตเป็นจำนวนเต็มอย่างน้อย 1 วัน';
  }
  if (!value.paymentCountFrom) return 'กรุณาระบุว่าเครดิตนับจากอะไร';
  if (value.paymentCountFrom === 'custom' && !(value.paymentCountFromCustom || '').trim()) {
    return 'กรุณาระบุว่าเครดิตนับจากอะไร';
  }
  return null;
}

function countFromPhrase(value: QuotationPaymentDraft, locale: PrintDocumentLocale): string {
  if (value.paymentCountFrom === 'custom') return (value.paymentCountFromCustom || '').trim();
  const found = QUOTATION_CREDIT_COUNT_FROM_OPTIONS.find((o) => o.value === value.paymentCountFrom);
  if (!found || found.value === 'custom') return '';
  return locale === 'en' ? found.en : found.th;
}

/** บรรทัดที่พิมพ์ในช่องเงื่อนไข เช่น "การจ่ายเงิน : เครดิต 30 วัน นับจากส่งสินค้า" */
export function formatQuotationPaymentTermLine(
  value: QuotationPaymentDraft,
  locale: PrintDocumentLocale = 'th',
): string {
  if (value.paymentKind === 'cash') {
    return locale === 'en' ? 'Term of payment : Cash' : 'การจ่ายเงิน : เงินสด (Cash)';
  }
  if (value.paymentKind !== 'credit') return '';
  const days = Number(value.paymentCreditDays);
  const from = countFromPhrase(value, locale);
  if (!Number.isInteger(days) || days < 1 || !from) return '';
  if (locale === 'en') return `Term of payment : Credit ${days} days from ${from}`;
  return `การจ่ายเงิน : เครดิต ${days} วัน นับจาก${from}`;
}

const EXISTING_TERM_LINE = /^(term of payment|การจ่ายเงิน)\s*:/i;

/** ใส่บรรทัดการจ่ายเงินไว้ต้นหมายเหตุ โดยไม่ซ้ำกับบรรทัดเดิมที่ผู้ใช้พิมพ์ไว้ */
export function quotationNotesWithPaymentTerm(
  quotation: QuotationPaymentDraft & { notes?: string },
  locale: PrintDocumentLocale,
): string {
  const term = formatQuotationPaymentTermLine(quotation, locale);
  const notes = (quotation.notes || '').replace(/\r\n/g, '\n').trim();
  if (!term) return notes;
  if (!notes) return term;
  const lines = notes.split('\n');
  if (EXISTING_TERM_LINE.test(lines[0].trim())) {
    lines[0] = term;
    return lines.join('\n').trim();
  }
  return `${term}\n${notes}`;
}

/** รวมค่าการจ่ายเงินเข้า state โดยล้างวัน/นับจาก เมื่อสลับกลับเป็นเงินสด */
export function mergeQuotationPayment<T extends QuotationPaymentDraft>(
  prev: T,
  next: QuotationPaymentDraft,
): T {
  const copy = { ...prev };
  delete copy.paymentKind;
  delete copy.paymentCreditDays;
  delete copy.paymentCountFrom;
  delete copy.paymentCountFromCustom;
  if (next.paymentKind === 'cash') return { ...copy, paymentKind: 'cash' };
  if (next.paymentKind === 'credit') {
    return {
      ...copy,
      paymentKind: 'credit',
      ...(typeof next.paymentCreditDays === 'number' ? { paymentCreditDays: next.paymentCreditDays } : {}),
      ...(next.paymentCountFrom ? { paymentCountFrom: next.paymentCountFrom } : {}),
      ...(next.paymentCountFrom === 'custom'
        ? { paymentCountFromCustom: next.paymentCountFromCustom || '' }
        : {}),
    };
  }
  return copy;
}

/** ค่าที่เขียนตอนสร้างเอกสาร — ไม่ใส่ฟิลด์เครดิตเมื่อเลือกเงินสด */
export function quotationPaymentCreateFields(
  value: QuotationPaymentDraft,
): Record<string, string | number> {
  if (value.paymentKind === 'credit') {
    const fields: Record<string, string | number> = {
      paymentKind: 'credit',
      paymentCreditDays: Number(value.paymentCreditDays),
      paymentCountFrom: value.paymentCountFrom || '',
    };
    if (value.paymentCountFrom === 'custom') {
      fields.paymentCountFromCustom = (value.paymentCountFromCustom || '').trim();
    }
    return fields;
  }
  return { paymentKind: 'cash' satisfies QuotationPaymentKind };
}

const PAYMENT_KEYS = [
  'paymentKind',
  'paymentCreditDays',
  'paymentCountFrom',
  'paymentCountFromCustom',
] as const;

/** ล้างฟิลด์เครดิตค้างเมื่อสลับเป็นเงินสด ก่อนส่งเอกสารใหม่ (revision) */
export function stripStaleQuotationPaymentFields<T extends Record<string, unknown>>(
  record: T,
  value: QuotationPaymentDraft,
): T {
  if (value.paymentKind !== 'cash' && value.paymentKind !== 'credit') return record;
  const next: Record<string, unknown> = { ...record };
  for (const key of PAYMENT_KEYS) delete next[key];
  Object.assign(next, quotationPaymentCreateFields(value));
  return next as T;
}
