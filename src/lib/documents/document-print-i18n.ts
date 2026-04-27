/** Locale for standard document print (PDF/browser print), independent of UI language */

export type PrintDocumentLocale = 'th' | 'en';

export const PRINT_DOC_LOCALE_STORAGE_KEY = 'opec_document_print_locale';

export function readStoredPrintLocale(): PrintDocumentLocale {
  if (typeof window === 'undefined') return 'th';
  try {
    const v = window.localStorage.getItem(PRINT_DOC_LOCALE_STORAGE_KEY);
    return v === 'en' ? 'en' : 'th';
  } catch {
    return 'th';
  }
}

export function writeStoredPrintLocale(locale: PrintDocumentLocale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRINT_DOC_LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

/** Labels and short phrases used across PO / commercial / tax / quotation prints */
export const printDocStrings = {
  th: {
    tel: 'โทร.',
    email: 'อีเมล',
    taxId: 'เลขประจำตัวผู้เสียภาษี',
    docDate: 'วันที่เอกสาร',
    /** หัว meta พิมพ์ — วันที่ออก (ไทยเท่านั้น) */
    dateIssued: 'วันที่ออก :',
    docNo: 'เลขที่เอกสาร',
    validUntil: 'ใช้ได้ถึง',
    currency: 'สกุลเงิน',
    subtotal: 'รวมเป็นเงิน',
    vat: 'ภาษีมูลค่าเพิ่ม',
    wht: 'หัก ณ ที่จ่าย',
    grandTotal: 'ยอดสุทธิรวม',
    discount: 'ส่วนลด',
    taxableBase: 'รวมเป็นเงิน (ฐานภาษี)',
    colNo: '#',
    description: 'รายการ',
    qty: 'จำนวน',
    unit: 'หน่วย',
    unitPrice: 'ราคา/หน่วย',
    amount: 'รวมเงิน',
    customerInfo: 'ข้อมูลลูกค้า',
    customerBuyer: 'ข้อมูลลูกค้า (ผู้ซื้อ)',
    vendorInfo: 'ข้อมูลคู่ค้า (ผู้ขาย)',
    timesheetPeriod: 'ช่วง timesheet',
    billingPeriod: 'ช่วงเรียกเก็บ',
    refBillingNote: 'อ้างอิงใบวางบิล',
    contact: 'ติดต่อ',
    reference: 'อ้างอิง',
    projectTitle: 'หัวข้อโครงการ',
    notes: 'หมายเหตุ',
    status: 'สถานะ',
    voidedDoc: 'เอกสารถูกยกเลิกแล้ว',
    commercialNotTaxInvoice:
      'เอกสารนี้เป็นใบแจ้งหนี้เรียกเก็บค่าบริการ — ไม่ใช่ใบกำกับภาษีตามประมวลรัษฎากร',
    whtNoneThisDoc: 'ไม่มีตามการตั้งค่าเอกสารนี้',
    paymentTerms: 'เงื่อนไขการชำระเงิน',
    purchaseType: 'เงื่อนไขการซื้อ',
    noMilestones: '— ยังไม่มีแผนงวดในระบบ —',
    milestoneDue: 'ครบกำหนด',
    milestoneLabel: 'งวดที่',
    termsNotes: 'เงื่อนไขและหมายเหตุ',
    signPreparedBy: 'ผู้จัดทำเอกสาร',
    signPreparedPurchasing: 'ผู้จัดทำเอกสาร (จัดซื้อ)',
    signApproverOps: 'ผู้อนุมัติ (ผู้จัดการปฏิบัติการ)',
    signCustomerConfirm: 'ลูกค้า (ยืนยันยอด)',
    signCustomerAuth: 'ผู้มีอำนาจลงนาม (ลูกค้า)',
    signPreparedAccounting: 'ผู้จัดทำเอกสาร (บัญชี)',
    signPreparedSales: 'ผู้จัดทำเอกสาร (ฝ่ายขาย)',
    signAcceptQuotation: 'กรุณาลงนามและประทับตราเพื่อยืนยันการรับใบเสนอราคา',
    approvedElectronically: 'เอกสารผ่านการอนุมัติด้วยระบบอิเล็กทรอนิกส์',
    billingApproved: 'อนุมัติ billing เมื่อ',
    confirmedTotals: 'ยืนยันยอดเมื่อ',
    printStamp: 'พิมพ์เมื่อ',
    noLines: 'ไม่มีรายการ',
    whtRateNote: '(ฐานก่อน VAT ต่องวด — สุทธิจ่าย = ยอดงวดรวม VAT − หัก ณ ที่จ่าย)',
    quotationPartyFooter: 'ผู้รับเอกสาร (ลูกค้า)',
    documentRefTitle: 'อ้างอิงเอกสาร',
    docRefLine1: '1.1 เลขที่สัญญา',
    docRefLine2: '1.2 เลขที่ PO ลูกค้า',
    docRefLine3: '1.3 Wave',
    /** เมื่อบรรทัดอ้างอิงยาวเกิน — ไม่มีเลข 1.1 / ใช้คู่กับ docRefLine2Compact */
    docRefLine1Compact: 'เลขที่สัญญา',
    docRefLine2Compact: 'เลขที่ PO',
    docRefLine3Compact: 'Wave',
    /** แถวที่ 1 เมื่อใบแจ้งหนี้มาจาก PO สายใบเสนอราคา */
    docRefLine1Quotation: '1.1 เลขที่ใบเสนอราคา',
    docRefLine1QuotationCompact: 'เลขที่ QT',
    /** แถบ Wave เมื่อเป็นสายใบเสนอราคา (ไม่มี Wave) */
    docRefWaveQuotationPlaceholder: '— (สายใบเสนอราคา)',
  },
  en: {
    tel: 'Tel.',
    email: 'Email',
    taxId: 'Tax ID',
    docDate: 'Document date',
    dateIssued: 'Date issued :',
    docNo: 'Document no.',
    validUntil: 'Valid until',
    currency: 'Currency',
    subtotal: 'Subtotal',
    vat: 'VAT',
    wht: 'Withholding tax',
    grandTotal: 'Grand total',
    discount: 'Discount',
    taxableBase: 'Taxable amount',
    colNo: '#',
    description: 'Description',
    qty: 'Qty',
    unit: 'Unit',
    unitPrice: 'Unit price',
    amount: 'Amount',
    customerInfo: 'Customer',
    customerBuyer: 'Customer',
    vendorInfo: 'Vendor',
    timesheetPeriod: 'Timesheet period',
    billingPeriod: 'Billing period',
    refBillingNote: 'Billing note ref.',
    contact: 'Contact',
    reference: 'Reference',
    projectTitle: 'Project / subject',
    notes: 'Notes',
    status: 'Status',
    voidedDoc: 'This document has been voided.',
    commercialNotTaxInvoice:
      'This is a service billing document — not a tax invoice under the Revenue Code.',
    whtNoneThisDoc: 'No withholding tax per this document’s settings.',
    paymentTerms: 'Payment terms',
    purchaseType: 'Purchase type',
    noMilestones: '— No payment milestones in the system —',
    milestoneDue: 'Due',
    milestoneLabel: 'Installment',
    termsNotes: 'Terms & notes',
    signPreparedBy: 'Prepared by',
    signPreparedPurchasing: 'Prepared by (Purchasing)',
    signApproverOps: 'Approved by (Operations Manager)',
    signCustomerConfirm: 'Customer (billing confirmation)',
    signCustomerAuth: 'Authorized signatory (Customer)',
    signPreparedAccounting: 'Prepared by (Accounting)',
    signPreparedSales: 'Prepared by (Sales)',
    signAcceptQuotation: 'Please sign and stamp to accept this quotation.',
    approvedElectronically: 'Document approved electronically',
    billingApproved: 'Billing approved on',
    confirmedTotals: 'Totals confirmed on',
    printStamp: 'Printed',
    noLines: 'No line items',
    whtRateNote: '(pre-VAT base per installment; net = installment incl. VAT − WHT)',
    quotationPartyFooter: 'Customer / Recipient',
    documentRefTitle: 'Document reference',
    docRefLine1: '1.1 Contract no.',
    docRefLine2: '1.2 Customer PO no.',
    docRefLine3: '1.3 Wave',
    docRefLine1Compact: 'Contract no.',
    docRefLine2Compact: 'PO no.',
    docRefLine3Compact: 'Wave',
    docRefLine1Quotation: '1.1 Quotation no.',
    docRefLine1QuotationCompact: 'Quotation no.',
    docRefWaveQuotationPlaceholder: '— (Quotation — no Wave)',
  },
} as const;

export type PrintDocStrKey = keyof typeof printDocStrings.th;

export function printT(locale: PrintDocumentLocale, key: PrintDocStrKey): string {
  return printDocStrings[locale][key];
}
