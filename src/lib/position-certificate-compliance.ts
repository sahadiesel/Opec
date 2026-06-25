import type {
  PositionCertificateRequirement,
  WorkerCertificate,
  WorkerDocument,
} from '@/lib/types';
import { isStoredExpiryPast } from '@/lib/date-thai';

export type PositionCertReqDisplayRow =
  | { kind: 'standalone'; req: PositionCertificateRequirement }
  | {
      kind: 'or_group';
      groupKey: string;
      label: string;
      reqs: PositionCertificateRequirement[];
    };

function reqType(req: PositionCertificateRequirement): 'certificate' | 'document' {
  return req.requirementType || 'certificate';
}

function codesMatch(a: string | undefined, b: string | undefined): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

function normalizeCredentialLabel(s: string | undefined): string {
  return (s || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function certStatusIsValid(status: string | undefined): boolean {
  return (status || '').trim().toLowerCase() === 'valid';
}

/** จับคู่ใบเซอร์กับเกณฑ์ตำแหน่ง — code, ชื่อ, หรือ template ใน catalog */
export function findWorkerCertificateForRequirement(
  req: PositionCertificateRequirement,
  certificates: WorkerCertificate[],
): WorkerCertificate | undefined {
  return certificates.find((c) => certificateMatchesRequirement(c, req));
}

export function findWorkerDocumentForRequirement(
  req: PositionCertificateRequirement,
  documents: WorkerDocument[],
): WorkerDocument | undefined {
  return documents.find((d) => documentMatchesRequirement(d, req));
}

function certificateMatchesRequirement(cert: WorkerCertificate, req: PositionCertificateRequirement): boolean {
  if (codesMatch(cert.certificateCode, req.certificateCode)) return true;
  if (normalizeCredentialLabel(cert.certificateName) === normalizeCredentialLabel(req.certificateName)) {
    return true;
  }
  return false;
}

function documentMatchesRequirement(doc: WorkerDocument, req: PositionCertificateRequirement): boolean {
  if (codesMatch(doc.documentType, req.certificateCode)) return true;
  return false;
}

export function workerHasValidCertificateRequirement(
  req: PositionCertificateRequirement,
  certificates: WorkerCertificate[],
  documents: WorkerDocument[],
  now = Date.now(),
): boolean {
  const requiresExpiry = req.hasExpiry ?? true;
  const type = reqType(req);

  if (type === 'document') {
    const matchedDoc = findWorkerDocumentForRequirement(req, documents);
    if (!matchedDoc) return false;
    if (!requiresExpiry) return true;
    return !isStoredExpiryPast(matchedDoc.expiryDate, now);
  }

  const certRecord = findWorkerCertificateForRequirement(req, certificates);
  if (!certRecord || !certStatusIsValid(certRecord.status)) return false;
  if (!requiresExpiry) return true;
  return !isStoredExpiryPast(certRecord.expiryDate, now);
}

/** แยก mandatory เป็น standalone (AND) กับกลุ่ม OR */
export function partitionMandatoryCertificateRequirements(
  reqs: PositionCertificateRequirement[],
): {
  standalone: PositionCertificateRequirement[];
  orGroups: Map<string, PositionCertificateRequirement[]>;
} {
  const mandatory = reqs.filter((r) => r.required);
  const standalone: PositionCertificateRequirement[] = [];
  const orGroups = new Map<string, PositionCertificateRequirement[]>();

  for (const req of mandatory) {
    const gk = (req.alternativeGroupKey || '').trim();
    if (gk) {
      const list = orGroups.get(gk) || [];
      list.push(req);
      orGroups.set(gk, list);
    } else {
      standalone.push(req);
    }
  }
  return { standalone, orGroups };
}

export function mandatoryCertificateComplianceMet(
  mandatoryReqs: PositionCertificateRequirement[],
  certificates: WorkerCertificate[],
  documents: WorkerDocument[],
  now = Date.now(),
  /** ข้าม req ที่ policy ไม่ใช้ (เช่น BOSIET บน onshore) */
  skipReq?: (req: PositionCertificateRequirement) => boolean,
): boolean {
  const { standalone, orGroups } = partitionMandatoryCertificateRequirements(mandatoryReqs);

  for (const req of standalone) {
    if (skipReq?.(req)) continue;
    if (!workerHasValidCertificateRequirement(req, certificates, documents, now)) {
      return false;
    }
  }

  for (const [, groupReqs] of orGroups) {
    const applicable = groupReqs.filter((r) => !skipReq?.(r));
    if (applicable.length === 0) continue;
    const anyValid = applicable.some((req) =>
      workerHasValidCertificateRequirement(req, certificates, documents, now),
    );
    if (!anyValid) return false;
  }

  return true;
}

/** รายการที่ยังไม่ครบ — OR group ที่ยังไม่ผ่านคืนเป็น 1 รายการ (ใช้ req แรกเป็นตัวแทน) */
export function getUnsatisfiedMandatoryCertificateRequirements(
  mandatoryReqs: PositionCertificateRequirement[],
  certificates: WorkerCertificate[],
  documents: WorkerDocument[],
  now = Date.now(),
): PositionCertificateRequirement[] {
  const missing: PositionCertificateRequirement[] = [];
  const { standalone, orGroups } = partitionMandatoryCertificateRequirements(mandatoryReqs);

  for (const req of standalone) {
    if (!workerHasValidCertificateRequirement(req, certificates, documents, now)) {
      missing.push(req);
    }
  }

  for (const [, groupReqs] of orGroups) {
    const anyValid = groupReqs.some((req) =>
      workerHasValidCertificateRequirement(req, certificates, documents, now),
    );
    if (!anyValid) {
      missing.push(groupReqs[0]);
    }
  }

  return missing;
}

/**
 * เกณฑ์บังคับที่ยังไม่มีเรคอร์ดในระบบ — ใช้แถว «ตามตำแหน่ง» เท่านั้น
 * (ถ้ามีใบแล้วแต่หมดอายุ/ไม่ valid ให้แก้ที่แถวเดิม ไม่สร้างแถวซ้ำ)
 */
export function getMandatoryRequirementsWithNoWorkerRecord(
  mandatoryReqs: PositionCertificateRequirement[],
  certificates: WorkerCertificate[],
  documents: WorkerDocument[],
  now = Date.now(),
): PositionCertificateRequirement[] {
  const unsatisfied = getUnsatisfiedMandatoryCertificateRequirements(
    mandatoryReqs,
    certificates,
    documents,
    now,
  );
  return unsatisfied.filter((req) => {
    if (reqType(req) === 'document') {
      return !findWorkerDocumentForRequirement(req, documents);
    }
    return !findWorkerCertificateForRequirement(req, certificates);
  });
}

export function groupPositionCertificateRequirementsForDisplay(
  reqs: PositionCertificateRequirement[] | null | undefined,
): PositionCertReqDisplayRow[] {
  const list = reqs || [];
  const rows: PositionCertReqDisplayRow[] = [];
  const orSeen = new Set<string>();

  for (const req of list) {
    const gk = (req.alternativeGroupKey || '').trim();
    if (!gk) {
      rows.push({ kind: 'standalone', req });
      continue;
    }
    if (orSeen.has(gk)) continue;
    orSeen.add(gk);
    const groupReqs = list.filter((r) => (r.alternativeGroupKey || '').trim() === gk);
    const label =
      (groupReqs.find((r) => (r.alternativeGroupLabel || '').trim())?.alternativeGroupLabel || '').trim() ||
      groupReqs.map((r) => r.certificateName).join(' / ');
    rows.push({ kind: 'or_group', groupKey: gk, label, reqs: groupReqs });
  }

  return rows;
}

export function orGroupMemberSummary(reqs: PositionCertificateRequirement[]): string {
  return reqs.map((r) => r.certificateName || r.certificateCode).filter(Boolean).join(' · ');
}

export function slugAlternativeGroupKey(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `or_${base || 'group'}_${Date.now()}`;
}
