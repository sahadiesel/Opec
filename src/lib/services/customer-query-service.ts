'use client';

import { 
  Firestore, 
  collection, 
  query, 
  where, 
  Query, 
  DocumentData,
  orderBy
} from 'firebase/firestore';
import { User } from '@/lib/types';
import { isClient } from '@/lib/permissions';
import { lastDayOfCalendarMonth } from '@/lib/timesheet/wave-month-utils';

/**
 * Service providing reusable Firestore query scoping for the Customer Portal.
 * Ensures that external clients are strictly limited to data matching their identity.
 */
export class CustomerQueryService {
  constructor(private db: Firestore) {}

  /**
   * Scopes a base collection query by customerId if the user is a client.
   * If the user is internal staff, it returns the collection (or a broader query).
   */
  private applyCustomerScope(
    collectionName: string, 
    user: User | null
  ): Query<DocumentData> | null {
    if (!user) return null;
    const colRef = collection(this.db, collectionName);

    const isCustomer = isClient(user);

    if (isCustomer) {
      if (!user.customerId) {
        console.warn(`User ${user.email} is marked as customer but has no customerId.`);
        // Return a query that will always be empty for safety
        return query(colRef, where('customerId', '==', 'UNAUTHORIZED_ID_BLOCK'));
      }
      return query(colRef, where('customerId', '==', user.customerId));
    }

    // For internal staff, return the full collection (unscoped)
    return colRef;
  }

  /**
   * Scoped query for Deployment Waves.
   */
  getScopedWavesQuery(user: User | null) {
    const q = this.applyCustomerScope('waves', user);
    return q ? query(q, orderBy('createdAt', 'desc')) : null;
  }

  /**
   * Scoped query for Mobilizations (Assignments).
   */
  getScopedAssignmentsQuery(user: User | null) {
    const q = this.applyCustomerScope('mobilizations', user);
    return q ? query(q, orderBy('updatedAt', 'desc')) : null;
  }

  /**
   * Scoped query for Worker Acceptance records.
   */
  getScopedAcceptancesQuery(user: User | null) {
    const q = this.applyCustomerScope('worker_wave_acceptances', user);
    return q ? query(q, orderBy('createdAt', 'desc')) : null;
  }

  /**
   * Scoped query for Daily Timesheets.
   * Note: This only handles IDENTITY scoping. Operational filtering (status) is added by the caller.
   */
  getScopedTimesheetsQuery(user: User | null) {
    const q = this.applyCustomerScope('daily_timesheets', user);
    return q ? query(q, orderBy('date', 'desc')) : null;
  }

  /**
   * Daily timesheets for one calendar month (yyyy-MM), portal customer only.
   * Uses composite index customerId + date (desc).
   */
  getScopedDailyTimesheetsForMonth(user: User | null, yearMonth: string): Query<DocumentData> | null {
    if (!user || !isClient(user) || !user.customerId) return null;
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) return null;
    const monthStart = `${yearMonth}-01`;
    const monthEnd = lastDayOfCalendarMonth(yearMonth);
    const colRef = collection(this.db, 'daily_timesheets');
    return query(
      colRef,
      where('customerId', '==', user.customerId),
      where('date', '>=', monthStart),
      where('date', '<=', monthEnd),
      orderBy('date', 'desc'),
    );
  }

  /**
   * Scoped query for Purchase Orders.
   */
  getScopedPOsQuery(user: User | null) {
    const q = this.applyCustomerScope('purchase_orders', user);
    return q ? query(q, orderBy('createdAt', 'desc')) : null;
  }

  /**
   * Scoped query for Main Contracts.
   */
  getScopedContractsQuery(user: User | null) {
    const q = this.applyCustomerScope('main_contracts', user);
    return q ? query(q, orderBy('createdAt', 'desc')) : null;
  }

  /**
   * Scoped query for Quotations.
   */
  getScopedQuotationsQuery(user: User | null) {
    const q = this.applyCustomerScope('quotations', user);
    return q ? query(q, orderBy('createdAt', 'desc')) : null;
  }
}
