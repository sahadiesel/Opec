import { dbService } from './db-service';
import { PositionRequirement, WorkerCertificate, WorkerMedicalRecord, WorkerDrugTest } from './types';

export async function checkWorkerReadiness(workerId: string, positionId: string): Promise<boolean> {
  // Get position requirements
  const reqs = await dbService.getByQuery<PositionRequirement>('position_requirements', 'positionId', positionId);
  
  // Get worker data
  const certs = await dbService.getByQuery<WorkerCertificate>('worker_certificates', 'workerId', workerId);
  const medicals = await dbService.getByQuery<WorkerMedicalRecord>('worker_medical_records', 'workerId', workerId);
  const drugs = await dbService.getByQuery<WorkerDrugTest>('worker_drug_tests', 'workerId', workerId);

  // 1. Check Certificates
  const certReqs = reqs.filter(r => r.type === 'certificate');
  for (const req of certReqs) {
    const hasValidCert = certs.some(c => 
      c.name.toLowerCase() === req.name.toLowerCase() && 
      c.expiryDate > Date.now()
    );
    if (!hasValidCert) return false;
  }

  // 2. Check Medical (valid within 1 year for offshore)
  const latestMedical = medicals.sort((a, b) => b.checkDate - a.checkDate)[0];
  if (!latestMedical || latestMedical.result !== 'pass' || latestMedical.expiryDate < Date.now()) {
    return false;
  }

  // 3. Check Drug Test (must be within last 6 months)
  const latestDrug = drugs.sort((a, b) => b.testDate - a.testDate)[0];
  const sixMonthsAgo = Date.now() - (180 * 24 * 60 * 60 * 1000);
  if (!latestDrug || latestDrug.result !== 'negative' || latestDrug.testDate < sixMonthsAgo) {
    return false;
  }

  return true;
}