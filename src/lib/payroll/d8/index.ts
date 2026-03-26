/**
 * D8 Payroll Engine — policy + calculation + snapshot ตอน generate
 * ไม่ควรคำนวณยอด net/tax/ss ใหม่ตอนเปิดหน้า; อ่านจาก snapshot บนบรรทัด
 */
export { D8_ENGINE_VERSION } from './constants';
export { batchStatusToD8Lifecycle, runStatusToD8Lifecycle } from './lifecycle';
export { embeddedDefaultPayrollPolicies } from './embedded-policies';
export {
  resolvePayrollPoliciesForDate,
  policiesAppliedList,
  type ResolvedPayrollPolicies,
  type PayrollScope,
} from './policies';
export { loadPayrollPoliciesFromFirestore } from './policy-loader';
export { computeOfficePayrollLineD8, type OfficePayrollD8Input } from './office-engine';
export { computeWorkerPayrollLineD8, type WorkerPayrollD8Input } from './worker-engine';
