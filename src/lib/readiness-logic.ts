import { dbService } from './db-service';
import { PositionRequirement, WorkerCertificate, WorkerMedicalRecord, WorkerDrugTest, ReadinessStatus } from './types';

/**
 * Calculates the readiness status for a worker based on position requirements, 
 * medical records, and drug tests.
 */
export async function calculateWorkerReadiness(workerId: string, positionId: string): Promise<ReadinessStatus> {
  // 1. Get position requirements from specialized collections
  const certReqs = await dbService.getByQuery<PositionRequirement>('position_certificate_requirements', 'positionId', positionId);
  const ppeReqs = await dbService.getByQuery<PositionRequirement>('position_ppe_requirements', 'positionId', positionId);
  
  // 2. Get worker data
  const certs = await dbService.getByQuery<WorkerCertificate>('worker_certificates', 'workerId', workerId);
  const medicals = await dbService.getByQuery<WorkerMedicalRecord>('worker_medical_records', 'workerId', workerId);
  const drugs = await dbService.getByQuery<WorkerDrugTest>('worker_drug_tests', 'workerId', workerId);

  // A. Check Certificates
  for (const req of certReqs) {
    const hasValidCert = certs.some(c => 
      c.name.toLowerCase().trim() === req.name.toLowerCase().trim() && 
      c.expiryDate > Date.now()
    );
    if (!hasValidCert) return 'MISSING_CERTIFICATE';
  }

  // B. Check Medical (valid within 1 year or according to record)
  const latestMedical = medicals.sort((a, b) => b.checkDate - a.checkDate)[0];
  if (!latestMedical) return 'MEDICAL_EXPIRED';
  if (latestMedical.result !== 'pass' || latestMedical.expiryDate < Date.now()) {
    return 'MEDICAL_EXPIRED';
  }

  // C. Check Drug Test (must be within last 6 months)
  const latestDrug = drugs.sort((a, b) => b.testDate - a.testDate)[0];
  const sixMonthsAgo = Date.now() - (180 * 24 * 60 * 60 * 1000);
  if (!latestDrug || latestDrug.result !== 'negative' || latestDrug.testDate < sixMonthsAgo) {
    return 'DOCUMENT_MISSING';
  }

  // If all checks pass
  return 'READY';
}
