
'use client';

import { Firestore, collection, doc, setDoc, CollectionReference } from 'firebase/firestore';
import { CustomerIssue, User } from '@/lib/types';
import { CustomerIssueSchema } from '@/lib/validations/dispute-schemas';
import { writeAuditLog } from './audit-service';

/**
 * Service for managing Client-side issues and dispute requests.
 */
export class DisputeService {
  constructor(private db: Firestore) {}

  private getCollection(): CollectionReference {
    return collection(this.db, 'customer_issues');
  }

  /**
   * Records a new issue reported by a customer.
   */
  async reportIssue(data: Partial<CustomerIssue>, user: User) {
    if (!user.customerId) throw new Error('Unauthorized: Client user must have customerId');

    const issueRef = doc(this.getCollection());
    const now = Date.now();

    const validated = CustomerIssueSchema.parse({
      ...data,
      id: issueRef.id,
      customerId: user.customerId,
      status: 'OPEN',
      createdBy: user.displayName,
      createdById: user.id,
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(issueRef, validated);

    // Audit for OPEC staff
    await writeAuditLog(this.db, user, {
      actionType: 'REPORT_ISSUE',
      entityType: 'CustomerIssue',
      entityId: issueRef.id,
      entityLabel: `${validated.category}: ${validated.referenceNo}`,
      sourceModule: 'client',
      linkedIds: [validated.referenceId, user.customerId],
      afterSummary: `Customer reported an issue with ${validated.category} ${validated.referenceNo}`
    });

    return issueRef.id;
  }
}
