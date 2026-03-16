/**
 * OPEC OpsFlow - Policy Engine
 * Centralized business rules for Onshore and Offshore operations.
 */

import { JobMode, ReadinessStatus } from '@/lib/types';

export interface PolicyDefinition {
  mode: JobMode;
  readinessRules: {
    requiresBOSIET: boolean;
    requiresOGUK: boolean;
    requiresH2S: boolean;
    requiresInduction: boolean;
    medicalValidityYears: number;
    drugTestValidityMonths: number;
  };
  payrollRules: {
    payBasis: 'DAY_RATE' | 'HOURLY' | 'MONTHLY';
    travelDayPayRate: number; // e.g., 0.5 for 50%
    standbyDayPayRate: number;
    isRotationBased: boolean;
  };
  billingRules: {
    billTravelDays: boolean;
    billMobilizationFee: boolean;
    overtimeMultiplier: number;
  };
}

const OFFSHORE_POLICY: PolicyDefinition = {
  mode: 'OFFSHORE',
  readinessRules: {
    requiresBOSIET: true,
    requiresOGUK: true,
    requiresH2S: true,
    requiresInduction: true,
    medicalValidityYears: 2,
    drugTestValidityMonths: 6,
  },
  payrollRules: {
    payBasis: 'DAY_RATE',
    travelDayPayRate: 0.5,
    standbyDayPayRate: 1.0,
    isRotationBased: true,
  },
  billingRules: {
    billTravelDays: true,
    billMobilizationFee: true,
    overtimeMultiplier: 1.5,
  }
};

const ONSHORE_POLICY: PolicyDefinition = {
  mode: 'ONSHORE',
  readinessRules: {
    requiresBOSIET: false,
    requiresOGUK: false,
    requiresH2S: false,
    requiresInduction: true,
    medicalValidityYears: 1,
    drugTestValidityMonths: 12,
  },
  payrollRules: {
    payBasis: 'HOURLY',
    travelDayPayRate: 1.0,
    standbyDayPayRate: 0.0,
    isRotationBased: false,
  },
  billingRules: {
    billTravelDays: false,
    billMobilizationFee: false,
    overtimeMultiplier: 1.5,
  }
};

/**
 * Resolves the active policy for a given mode.
 */
export function getPolicy(mode: JobMode): PolicyDefinition {
  return mode === 'OFFSHORE' ? OFFSHORE_POLICY : ONSHORE_POLICY;
}

/**
 * Determines if a specific document is mandatory based on policy.
 */
export function isDocumentMandatory(docCode: string, mode: JobMode): boolean {
  const policy = getPolicy(mode);
  switch (docCode.toUpperCase()) {
    case 'BOSIET': return policy.readinessRules.requiresBOSIET;
    case 'OGUK': return policy.readinessRules.requiresOGUK;
    case 'H2S': return policy.readinessRules.requiresH2S;
    case 'INDUCTION': return policy.readinessRules.requiresInduction;
    default: return false;
  }
}
