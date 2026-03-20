'use client';

import { 
  Firestore, 
  collection, 
  doc, 
  query, 
  where, 
  orderBy, 
  CollectionReference,
  Query
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

  // --- Collection Accessors ---

  private getSalesTermsCollection(): CollectionReference {
    return collection(this.db, 'sales_contract_terms');
  }

  private getLaborCostTermsCollection(): CollectionReference {
    return collection(this.db, 'labor_cost_contract_terms');
  }

  private getRateConditionsCollection(): CollectionReference {
    return collection(this.db, 'rate_conditions');
  }

  // --- Sales Contract Terms ---

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
          purchaseOrderId: validated.purchaseOrderId,
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
      afterSummary: `Updated sales contract term details`
    });
  }

  // --- Labor Cost Contract Terms ---

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
          purchaseOrderId: validated.relatedPurchaseOrderId,
          afterSummary: `Created labor cost term`
        });
      }
    });

    return promise;
  }

  async updateLaborCostTerm(id: string, data: Partial<LaborCostContractTerm>, user: User) {
    const docRef = doc(this.getLaborCostTermsCollection(), id);
    const updateData = {
      ...data,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    };
    
    updateDocumentNonBlocking(docRef, updateData);
    
    writeAuditLog(this.db, user, {
      actionType: 'UPDATE',
      entityType: 'LaborCostContractTerm',
      entityId: id,
      sourceModule: 'commercial',
      changedFields: Object.keys(data),
      afterSummary: `Updated labor cost term details`
    });
  }

  // --- Rate Conditions ---

  async createRateCondition(data: Partial<RateCondition>, user: User) {
    const validated = RateConditionSchema.parse({
      ...data,
      isActive: data.isActive ?? true,
      requiresApproval: data.requiresApproval ?? false,
      displayOrder: data.displayOrder ?? 0,
      effectiveDate: data.effectiveDate || new Date().toISOString().split('T')[0],
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
          contractTermId: validated.parentType === 'SALES_CONTRACT' || validated.parentType === 'LABOR_COST_CONTRACT' ? validated.parentId : undefined,
          sourceModule: 'commercial',
          afterSummary: `Added rate condition for ${validated.parentType}`
        });
      }
    });

    return promise;
  }

  async updateRateCondition(id: string, data: Partial<RateCondition>, user: User) {
    const docRef = doc(this.getRateConditionsCollection(), id);
    const updateData = {
      ...data,
      updatedAt: Date.now(),
    };
    
    updateDocumentNonBlocking(docRef, updateData);
    
    writeAuditLog(this.db, user, {
      actionType: 'UPDATE',
      entityType: 'RateCondition',
      entityId: id,
      sourceModule: 'commercial',
      linkedIds: [data.parentId || 'unknown'],
      changedFields: Object.keys(data),
      afterSummary: `Updated rate condition details`
    });
  }

  // --- Query Helpers (Reactive Hooks should consume these queries) ---

  queryActiveSalesTermsByCustomer(customerId: string): Query {
    return query(
      this.getSalesTermsCollection(),
      where('customerId', '==', customerId),
      where('status', '==', 'ACTIVE'),
      orderBy('effectiveDate', 'desc')
    );
  }

  queryActiveSalesTermsByPO(poId: string): Query {
    return query(
      this.getSalesTermsCollection(),
      where('purchaseOrderId', '==', poId),
      where('status', '==', 'ACTIVE')
    );
  }

  queryActiveLaborCostTermsByPO(poId: string): Query {
    return query(
      this.getLaborCostTermsCollection(),
      where('relatedPurchaseOrderId', '==', poId),
      where('status', '==', 'ACTIVE')
    );
  }

  queryRateConditionsByParent(parentType: string, parentId: string): Query {
    return query(
      this.getRateConditionsCollection(),
      where('parentType', '==', parentType),
      where('parentId', '==', parentId),
      where('isActive', '==', true),
      orderBy('displayOrder', 'asc')
    );
  }
}
