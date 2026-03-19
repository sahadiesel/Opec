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
  deleteDocumentNonBlocking 
} from '@/firebase/non-blocking-updates';

/**
 * Service for managing Worker Payment Profiles.
 */
export class WorkerPaymentService {
  constructor(private db: Firestore) {}

  /**
   * Internal helper to get the collection reference.
   */
  private getCollection(): CollectionReference {
    return collection(this.db, 'worker_payment_profiles');
  }

  /**
   * Creates a new payment profile for a worker.
   */
  async createProfile(data: Partial<WorkerPaymentProfile>, user: User) {
    const validated = WorkerPaymentProfileSchema.parse({
      ...data,
      createdBy: user.displayName,
      updatedBy: user.displayName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return addDocumentNonBlocking(this.getCollection(), validated);
  }

  /**
   * Updates an existing payment profile.
   */
  async updateProfile(id: string, data: Partial<WorkerPaymentProfile>, user: User) {
    const docRef = doc(this.getCollection(), id);
    const updateData = {
      ...data,
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    };
    return updateDocumentNonBlocking(docRef, updateData);
  }

  /**
   * Deletes a payment profile.
   */
  async deleteProfile(id: string) {
    const docRef = doc(this.getCollection(), id);
    return deleteDocumentNonBlocking(docRef);
  }

  /**
   * Helper to get the current active primary payment profile for a worker.
   * This is used for payroll processing and disbursement.
   */
  async getActivePrimaryProfile(workerId: string): Promise<WorkerPaymentProfile | null> {
    const q = query(
      this.getCollection(),
      where('workerId', '==', workerId),
      where('isPrimary', '==', true),
      where('status', '==', 'ACTIVE'),
      limit(1)
    );

    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    return { 
      ...snapshot.docs[0].data(), 
      id: snapshot.docs[0].id 
    } as WorkerPaymentProfile;
  }
}
