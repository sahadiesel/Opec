import type {
  PositionCertificateRequirement,
  WorkerCertificate,
  WorkerDocument,
} from '@/lib/types';

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

export function workerHasValidCertificateRequirement(
  req: PositionCertificateRequirement,
  certificates: WorkerCertificate[],
  documents: WorkerDocument[],
  now = Date.now(),
): boolean {
  const requiresExpiry = req.hasExpiry ?? true;
  const type = reqType(req);

  if (type === 'document') {
    const matchedDoc = documents.find((d) => codesMatch(d.documentType, req.certificateCode));
    if (!matchedDoc) return false;
    if (!requiresExpiry) return true;
    return Number(matchedDoc.expiryDate || 0) > now;
  }

  const certRecord = certificates.find(
    (c) =>
      codesMatch(c.certificateCode, req.certificateCode) &&
      c.status === 'valid',
  );
  if (!certRecord) return false;
  if (!requiresExpiry) return true;
  return Number(certRecord.expiryDate || 0) > now;
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
