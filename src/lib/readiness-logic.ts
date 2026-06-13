import {
  Worker,
  WorkerCertificate,
  WorkerMedicalRecord,
  WorkerDrugTest,
  PositionCertificateRequirement,
  ReadinessStatus,
  JobMode,
  DrugTestPanelSubstance,
} from './types';
import { getPolicy } from './policy/engine';

/**
 * Calculates a worker's readiness status based on their records and position-level policy.
 */
export async function calculateWorkerReadiness(
  worker: Worker,
  certificates: WorkerCertificate[],
  medicalRecords: WorkerMedicalRecord[],
  drugTests: WorkerDrugTest[],
  mandatoryReqs: PositionCertificateRequirement[],
  mode: JobMode,
  /** รายการสารจาก settings — ไม่บล็อก readiness (ตรวจที่ mobilization) */
  drugPanelSubstances: DrugTestPanelSubstance[] = []
): Promise<ReadinessStatus> {
  const now = Date.now();
  const policy = getPolicy(mode);

  // 1. Check Mandatory Certificates based on Job Mode
  for (const req of mandatoryReqs) {
    // Only check Offshore specific certs if in Offshore mode
    const isBOSIET = req.certificateCode === 'BOSIET' || req.certificateName.includes('BOSIET');
    if (isBOSIET && !policy.readinessRules.requiresBOSIET) continue;

    const hasValidCert = certificates.some(c => 
      (c.certificateCode === req.certificateCode || c.certificateName === req.certificateName) && 
      c.expiryDate > now && 
      c.status === 'valid'
    );
    if (!hasValidCert) return 'MISSING_CERTIFICATE';
  }

  // 2. Check Medical Records
  const latestMedical = medicalRecords
    .filter(m => m.status === 'fit_for_duty')
    .sort(
      (a, b) =>
        new Date(b.recordDate ?? 0).getTime() - new Date(a.recordDate ?? 0).getTime()
    )[0];

  if (!latestMedical) return 'MEDICAL_EXPIRED';
  
  const medExpiry = new Date(latestMedical.expiryDate).getTime();
  if (medExpiry < now) return 'MEDICAL_EXPIRED';

  // Drug panel: ไม่บล็อก readiness/assign — ตรวจที่ขั้น mobilization แทน

  return 'READY';
}
