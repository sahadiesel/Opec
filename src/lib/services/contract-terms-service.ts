'use client';

import { 
  Firestore, 
  collection, 
  doc, 
  CollectionReference, 
} from 'firebase/firestore';
import { 
  SalesContractTerm, 
  LaborCostContractTerm, 
  RateCondition,
  User
} from '@/lib/types';
import { 
  SalesContractTermSchema, 
  LaborCostContractTermSchema, 
  RateConditionSchema 
} from '@/lib/validations/contract-schemas';
import { 
  addDocumentNonBlocking, 
  updateDocumentNonBlocking, 
  deleteDocumentNonBlocking 
} from '@/firebase/non-blocking-updates';
import { writeAuditLog } from './audit-service';

/**
 * Service for managing Sales and Labor Cost Contract Terms and their Rate Conditions.
 */
export class ContractTermsService {
  constructor(private db: Firestore) {}

  // --- Sales Contract Terms ---

  getSalesTermsCollection(): CollectionReference {
    return collection(this.db, 'sales_contract_terms');
  }

  async createSalesTerm(data: Partial<SalesContractTerm>, user: User) {
    const validated = SalesContractTermSchema.parse({
      ...data,
      createdBy: user.displayName,
      updatedBy: user.displayName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    const promise = addDocumentNonBlocking(this.getSalesTermsCollection(), validated);
    
    promise.then(docRef => {
      if (docRef) {
        writeAuditLog(this.db, user, {
          actionType: 'CREATE',
          entityType: 'SalesContractTerm',
          entityId: docRef.id,
          entityLabel: validated.contractNo,
          sourceModule: 'commercial',
          afterSummary: `Created sales term: ${validated.title}`
        });
      }
    });

    return promise;
  }

  async updateSalesTerm(id: string, data: Partial<SalesContractTerm>, user: User) {
    const docRef = doc(this.getSalesTermsCollection(), id);
    const updateData = {
      ...data,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    };
    
    updateDocumentNonBlocking(docRef, updateData);
    
    writeAuditLog(this.db, user, {
      actionType: 'UPDATE',
      entityType: 'SalesContractTerm',
      entityId: id,
      sourceModule: 'commercial',
      changedFields: Object.keys(data),
      afterSummary: `Updated sales term fields`
    });
  }

  // --- Labor Cost Contract Terms ---

  getLaborCostTermsCollection(): CollectionReference {
    return collection(this.db, 'labor_cost_contract_terms');
  }

  async createLaborCostTerm(data: Partial<LaborCostContractTerm>, user: User) {
    const validated = LaborCostContractTermSchema.parse({
      ...data,
      createdBy: user.displayName,
      updatedBy: user.displayName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    const promise = addDocumentNonBlocking(this.getLaborCostTermsCollection(), validated);
    
    promise.then(docRef => {
      if (docRef) {
        writeAuditLog(this.db, user, {
          actionType: 'CREATE',
          entityType: 'LaborCostContractTerm',
          entityId: docRef.id,
          entityLabel: validated.title,
          sourceModule: 'commercial',
          afterSummary: `Created labor cost term`
        });
      }
    });

    return promise;
  }

  // --- Rate Conditions ---

  getRateConditionsCollection(): CollectionReference {
    return collection(this.db, 'rate_conditions');
  }

  async createRateCondition(data: Partial<RateCondition>, user: User) {
    const validated = RateConditionSchema.parse({
      ...data,
      isActive: data.isActive ?? true,
      requiresApproval: data.requiresApproval ?? false,
      displayOrder: data.displayOrder ?? 0,
    });
    
    const promise = addDocumentNonBlocking(this.getRateConditionsCollection(), validated);
    
    promise.then(docRef => {
      if (docRef) {
        writeAuditLog(this.db, user, {
          actionType: 'CREATE',
          entityType: 'RateCondition',
          entityId: docRef.id,
          entityLabel: `${validated.eventType} (${validated.calculationMethod})`,
          linkedIds: [validated.parentId],
          sourceModule: 'commercial'
        });
      }
    });

    return promise;
  }
}
