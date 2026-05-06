/**
 * ออกเลขที่หนังสือรับรองหัก ณ ที่จ่ายเมื่อข้อมูลขาด (ซ่อมเอกสารเก่า / ข้อมูลไม่ครบ)
 */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import type { User, WithholdingCertificateDocument } from '@/lib/types';
import { generateNextDocumentCode } from '@/lib/services/numbering-service';
import {
  buildWhtElectronicDataFromDocument,
  stripUndefinedForFirestore,
} from '@/lib/wht/wht-certificate-build';
import { buildWhtAuditLogEntry } from '@/lib/wht/wht-certificate-audit';
import {
  effectiveWhtCertificateDocumentNo,
  validateWhtCertificateForOfficialIssue,
} from '@/lib/wht/wht-certificate-validation';
import { timestampToHtmlDateValue } from '@/lib/date-thai';

export async function assignWhtCertificateNumberIfMissing(params: {
  firestore: Firestore;
  certRef: DocumentReference;
  wht: WithholdingCertificateDocument;
  currentUser: User;
}): Promise<{ certificateNo: string }> {
  const { firestore, certRef, wht, currentUser } = params;

  if (effectiveWhtCertificateDocumentNo(wht)) {
    throw new Error('เอกสารมีเลขที่แล้ว');
  }
  if (wht.documentStatus === 'CANCELLED') {
    throw new Error('เอกสารถูกยกเลิกแล้ว — ออกเลขที่ไม่ได้');
  }

  const errs = validateWhtCertificateForOfficialIssue(wht);
  if (errs.length) {
    throw new Error(errs.join(' '));
  }

  const actorName = currentUser.displayName?.trim() || currentUser.email || currentUser.id;
  const issueYmd =
    (wht.paymentIssueDate || '').trim() ||
    (wht.paymentDate || '').trim() ||
    timestampToHtmlDateValue(Date.now());
  const issueDate = new Date(`${issueYmd}T12:00:00`);

  const { code: certificateNo } = await generateNextDocumentCode(firestore, 'wht_certificate_50', {
    actor: actorName,
    userId: currentUser.id,
    date: issueDate,
  });

  const electronic = buildWhtElectronicDataFromDocument({
    ...wht,
    certificateNo,
    paymentIssueDate: issueYmd,
  });

  const now = Date.now();
  const patch: Record<string, unknown> = {
    certificateNo,
    paymentIssueDate: issueYmd,
    whtElectronicData: stripUndefinedForFirestore({
      ...electronic,
      xmlExportStatus: 'NOT_EXPORTED',
    }),
    updatedAt: now,
    updatedByUid: currentUser.id,
    updatedByName: actorName,
  };

  if (wht.documentStatus !== 'ISSUED') {
    patch.documentStatus = 'ISSUED';
    patch.issuedAt = now;
    patch.issuedByUid = currentUser.id;
    patch.issuedByName = actorName;
  }

  await updateDoc(certRef, stripUndefinedForFirestore(patch) as Record<string, unknown>);

  const logRef = doc(collection(firestore, 'withholding_certificate_documents', wht.id, 'audit_logs'));
  await setDoc(
    logRef,
    stripUndefinedForFirestore({
      id: logRef.id,
      ...buildWhtAuditLogEntry({
        documentId: wht.id,
        action: 'ISSUE_WHT',
        actorId: currentUser.id,
        actorName,
        payloadSummary: { repairMissingCertificateNo: true, certificateNo },
      }),
    }),
  );

  return { certificateNo };
}
