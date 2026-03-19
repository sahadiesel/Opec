'use client';

import { 
  Firestore, 
  collection, 
  doc, 
  query, 
  where, 
  getDocs,
  limit,
  CollectionReference 
} from 'firebase/firestore';
import { 
  WorkerPaymentProfile, 
  User 
} from '@/lib/types';
import { WorkerPaymentProfileSchema } from '@/lib/validations/worker-payment-schemas';
import { 
  addDocumentNonBlocking, 
  updateDocumentNonBlocking, 
} from '@/firebase/non-blocking-updates';
import { writeAuditLog } from './audit-service';

/**
 * Service for managing Worker Payment Profiles.
 */
export class WorkerPaymentService {
  constructor(private db: Firestore) {}

  private getCollection(): CollectionReference {
    return collection(this.db, 'worker_payment_profiles');
  }

  async createProfile(data: Partial<WorkerPaymentProfile>, user: User) {
    const validated = WorkerPaymentProfileSchema.parse({
      ...data,
      createdBy: user.displayName,
      updatedBy: user.displayName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    const promise = addDocumentNonBlocking(this.getCollection(), validated);
    
    promise.then(docRef => {
      if (docRef) {
        writeAuditLog(this.db, user, {
          actionType: 'CREATE',
          entityType: 'WorkerPaymentProfile',
          entityId: docRef.id,
          entityLabel: `Worker: ${validated.workerId}`,
          sourceModule: 'hr',
          afterSummary: `Added ${validated.paymentMethod} for worker ${validated.workerId}`
        });
      }
    });

    return promise;
  }

  async updateProfile(id: string, data: Partial<WorkerPaymentProfile>, user: User) {
    const docRef = doc(this.getCollection(), id);
    const updateData = {
      ...data,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    };
    
    updateDocumentNonBlocking(docRef, updateData);
    
    writeAuditLog(this.db, user, {
      actionType: 'UPDATE',
      entityType: 'WorkerPaymentProfile',
      entityId: id,
      sourceModule: 'hr',
      changedFields: Object.keys(data),
      afterSummary: `Updated payment profile details`
    });
  }
}
