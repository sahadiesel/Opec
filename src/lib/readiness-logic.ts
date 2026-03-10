import { 
  Worker, 
  WorkerCertificate, 
  WorkerMedicalRecord, 
  WorkerDrugTest, 
  PositionRequirement, 
  ReadinessStatus 
} from './types';

/**
 * Calculates a worker's readiness status based on their records and position requirements.
 */
export function calculateWorkerReadiness(
  worker: Worker,
  certificates: WorkerCertificate[],
  medicalRecords: WorkerMedicalRecord[],
  drugTests: WorkerDrugTest[],
  positionRequirements: PositionRequirement[]
): ReadinessStatus {
  const now = Date.now();

  // 1. Check Mandatory Certificates
  const mandatoryCerts = positionRequirements.filter(r => r.type === 'certificate' && r.isMandatory);
  for (const req of mandatoryCerts) {
    const hasValidCert = certificates.some(c => 
      c.certificateName.toLowerCase() === req.name.toLowerCase() && 
      c.expiryDate > now && 
      c.isVerified
    );
    if (!hasValidCert) return 'MISSING_CERTIFICATE';
  }

  // 2. Check Medical Records (valid for 1 year usually, but checking expiryDate field)
  const latestMedical = medicalRecords.sort((a, b) => b.checkDate - a.checkDate)[0];
  if (!latestMedical || latestMedical.expiryDate < now || latestMedical.result !== 'pass') {
    return 'MEDICAL_EXPIRED';
  }

  // 3. Check Drug Test (valid if within last 6 months usually, result must be negative)
  const latestDrug = drugTests.sort((a, b) => b.testDate - a.testDate)[0];
  const sixMonthsAgo = now - (180 * 24 * 60 * 60 * 1000);
  if (!latestDrug || latestDrug.testDate < sixMonthsAgo || latestDrug.result !== 'negative') {
    return 'DOCUMENT_MISSING'; // Using DOCUMENT_MISSING as a catch-all for missing/invalid drug/misc docs
  }

  return 'READY';
}
