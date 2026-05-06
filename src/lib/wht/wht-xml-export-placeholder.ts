/**
 * Placeholder สำหรับ e-Withholding / XML — ยังไม่ใช่สคีมากรมสรรพากรอย่างเป็นทางการ
 *
 * This is an internal XML-ready payload. Official RD schema mapping must be added when
 * e-Withholding/e-Tax integration is implemented.
 */

import type { WithholdingCertificateDocument, WhtElectronicData } from '@/lib/types';
import { effectiveWhtCertificateDocumentNo } from '@/lib/wht/wht-certificate-validation';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** สร้าง XML ภายใน (กลาง) จาก snapshot เอกสาร — ใช้ทดสอบ / เตรียม pipeline */
export function generateInternalWhtCertificateXml(doc: WithholdingCertificateDocument): string {
  const e = doc.whtElectronicData || {};
  const payer = doc.payer;
  const payee = doc.payee;
  return `<?xml version="1.0" encoding="UTF-8"?>
<WHTCertificate xmlns="urn:opec:opsflow:wht-certificate:internal-v1">
  <DocumentNo>${escapeXml(e.documentNo || doc.certificateNo || '')}</DocumentNo>
  <IssueDate>${escapeXml(e.issueDate || doc.paymentIssueDate || '')}</IssueDate>
  <PaymentDate>${escapeXml(e.paymentDate || doc.paymentDate || '')}</PaymentDate>
  <Payer>
    <TaxId>${escapeXml(payer.taxId)}</TaxId>
    <Name>${escapeXml(payer.legalNameTh)}</Name>
    <Branch>${escapeXml(payer.branchType)}</Branch>
    <BranchNo>${escapeXml(payer.branchNo || '')}</BranchNo>
    <Address>${escapeXml(payer.addressTh)}</Address>
  </Payer>
  <Payee>
    <TaxId>${escapeXml(payee.taxId || '')}</TaxId>
    <Name>${escapeXml(payee.displayName)}</Name>
    <Branch>${escapeXml(payee.branchType)}</Branch>
    <BranchNo>${escapeXml(payee.branchNo || '')}</BranchNo>
    <Address>${escapeXml(payee.addressTh)}</Address>
    <Country>${escapeXml(payee.countryCode || 'TH')}</Country>
  </Payee>
  <Income>
    <Code>${escapeXml(doc.incomeTypeCode)}</Code>
    <Description>${escapeXml(doc.incomeTypeDisplayTh)}</Description>
    <FormType>${escapeXml(doc.withholdingFormType)}</FormType>
  </Income>
  <Tax>
    <Condition>${escapeXml(doc.taxCondition)}</Condition>
    <Rate>${doc.withholdingTaxRatePercent}</Rate>
    <Base>${doc.withholdingTaxBase}</Base>
    <Amount>${doc.withholdingTaxAmount}</Amount>
    <NetPaid>${doc.netPaidAmount}</NetPaid>
    <Gross>${doc.grossAmount}</Gross>
    <Vat>${doc.vatAmount}</Vat>
    <BeforeVat>${doc.amountBeforeVat}</BeforeVat>
  </Tax>
  <Payment>
    <Method>${escapeXml(doc.paymentMethod)}</Method>
    <Bank>${escapeXml(doc.sendingBankName || doc.bankName || '')}</Bank>
    <Reference>${escapeXml(doc.paymentReferenceNo || '')}</Reference>
    <VendorBill>${escapeXml(doc.referenceVendorBillNo)}</VendorBill>
  </Payment>
</WHTCertificate>
`;
}

/** API เตรียมไว้ตามสเปก — คืน XML string + meta */
export function generateWhtXmlPayload(_documentId: string, doc: WithholdingCertificateDocument): {
  xml: string;
  generatedAt: number;
} {
  return { xml: generateInternalWhtCertificateXml(doc), generatedAt: Date.now() };
}

export function validateWhtBeforeExport(doc: WithholdingCertificateDocument): string[] {
  const errs: string[] = [];
  if (doc.documentStatus !== 'ISSUED') errs.push('ต้องออกเอกสาร (ISSUED) ก่อนเตรียม XML');
  if (!effectiveWhtCertificateDocumentNo(doc)) errs.push('ต้องมีเลขที่หนังสือรับรอง');
  return errs;
}

export function markWhtReadyForExportMerge(existingElectronic: WhtElectronicData): {
  xmlExportStatus: WithholdingCertificateDocument['xmlExportStatus'];
  whtElectronicData: WhtElectronicData;
  updatedAt: number;
} {
  return {
    xmlExportStatus: 'READY_FOR_EXPORT',
    whtElectronicData: {
      ...existingElectronic,
      xmlExportStatus: 'READY_FOR_EXPORT',
    },
    updatedAt: Date.now(),
  };
}

export interface WhtXmlExportLogEntry {
  id: string;
  documentId: string;
  xmlPayloadSnippet?: string;
  status: string;
  createdAt: number;
  createdByUid?: string;
}

/** โครงสร้าง log ที่จะเขียนลง subcollection `xml_export_logs` — ผู้เรียกทำ setDoc */
export function buildXmlExportLogEntry(
  docId: string,
  xml: string,
  actorUid: string,
  status: string,
): Omit<WhtXmlExportLogEntry, 'id'> & { id?: string } {
  return {
    documentId: docId,
    xmlPayloadSnippet: xml.slice(0, 8000),
    status,
    createdAt: Date.now(),
    createdByUid: actorUid,
  };
}

/**
 * เตรียมข้อมูลเขียน log การ export XML (ผู้เรียกใช้ setDoc ที่ xml_export_logs)
 * This is an internal XML-ready payload. Official RD schema mapping must be added when
 * e-Withholding/e-Tax integration is implemented.
 */
export function saveXmlExportLog(
  _whtCertificateId: string,
  payloadXml: string,
  status: string,
  actorUid: string,
): Omit<WhtXmlExportLogEntry, 'id'> {
  return buildXmlExportLogEntry(_whtCertificateId, payloadXml, actorUid, status);
}
