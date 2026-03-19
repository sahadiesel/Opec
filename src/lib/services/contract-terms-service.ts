'use client';

import { 
  Firestore, 
  collection, 
  doc, 
  CollectionReference, 
  DocumentReference 
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
    return addDocumentNonBlocking(this.getSalesTermsCollection(), validated);
  }

  async updateSalesTerm(id: string, data: Partial<SalesContractTerm>, user: User) {
    const docRef = doc(this.getSalesTermsCollection(), id);
    const updateData = {
      ...data,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    };
    // Note: We don't parse the full schema on update to allow partial updates
    return updateDocumentNonBlocking(docRef, updateData);
  }

  async deleteSalesTerm(id: string) {
    const docRef = doc(this.getSalesTermsCollection(), id);
    return deleteDocumentNonBlocking(docRef);
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
    return addDocumentNonBlocking(this.getLaborCostTermsCollection(), validated);
  }

  async updateLaborCostTerm(id: string, data: Partial<LaborCostContractTerm>, user: User) {
    const docRef = doc(this.getLaborCostTermsCollection(), id);
    const updateData = {
      ...data,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    };
    return updateDocumentNonBlocking(docRef, updateData);
  }

  async deleteLaborCostTerm(id: string) {
    const docRef = doc(this.getLaborCostTermsCollection(), id);
    return deleteDocumentNonBlocking(docRef);
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
    return addDocumentNonBlocking(this.getRateConditionsCollection(), validated);
  }

  async updateRateCondition(id: string, data: Partial<RateCondition>, user: User) {
    const docRef = doc(this.getRateConditionsCollection(), id);
    // Note: RateCondition doesn't have system fields like updatedAt in the type, 
    // but we can add them if the model is expanded later.
    return updateDocumentNonBlocking(docRef, data);
  }

  async deleteRateCondition(id: string) {
    const docRef = doc(this.getRateConditionsCollection(), id);
    return deleteDocumentNonBlocking(docRef);
  }
}
