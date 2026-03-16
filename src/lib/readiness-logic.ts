import { 
  Worker, 
  WorkerCertificate, 
  WorkerMedicalRecord, 
  WorkerDrugTest, 
  PositionCertificateRequirement, 
  ReadinessStatus,
  JobMode
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
  mode: JobMode
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
    .sort((a, b) => new Date(b.recordDate).getTime() - new Date(a.recordDate).getTime())[0];

  if (!latestMedical) return 'MEDICAL_EXPIRED';
  
  const medExpiry = new Date(latestMedical.expiryDate).getTime();
  if (medExpiry < now) return 'MEDICAL_EXPIRED';

  // 3. Check Drug Test (valid 6 months per offshore policy usually)
  const latestDrug = drugTests
    .filter(d => d.result === 'pass')
    .sort((a, b) => new Date(b.testDate).getTime() - new Date(a.testDate).getTime())[0];

  if (!latestDrug) return 'DRUG_TEST_EXPIRED';
  
  const drugTestDate = new Date(latestDrug.testDate).getTime();
  const drugExpiryLimit = drugTestDate + (policy.readinessRules.drugTestValidityMonths * 30 * 24 * 60 * 60 * 1000);
  
  if (drugExpiryLimit < now) return 'DRUG_TEST_EXPIRED';

  return 'READY';
}
