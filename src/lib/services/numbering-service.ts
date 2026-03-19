'use client';

/**
 * @fileOverview Centralized document numbering service.
 * Ensures sequential, unique numbers using Firestore transactions.
 * Required for financial and operational compliance.
 */

import { Firestore, doc, runTransaction } from 'firebase/firestore';

/**
 * Atomicly generates the next sequential number for a given document type.
 * 
 * @param db Firestore instance
 * @param sequenceKey Unique ID for the sequence (e.g. 'billing_note_2024')
 * @param prefix Text prefix for the ID (e.g. 'BN-2024-')
 * @param padding Number of digits to pad with zeros (default 4)
 * @returns Final formatted document number (e.g. 'BN-2024-0042')
 */
export async function generateNextNumber(
  db: Firestore, 
  sequenceKey: string, 
  prefix: string, 
  padding: number = 4
): Promise<string> {
  const seqRef = doc(db, 'number_sequences', sequenceKey);
  
  return await runTransaction(db, async (transaction) => {
    const seqSnap = await transaction.get(seqRef);
    let nextNum = 1;
    
    if (seqSnap.exists()) {
      const data = seqSnap.data();
      nextNum = (data.lastNumber || 0) + 1;
      transaction.update(seqRef, {
        lastNumber: nextNum,
        updatedAt: Date.now()
      });
    } else {
      transaction.set(seqRef, {
        id: sequenceKey,
        prefix,
        lastNumber: nextNum,
        updatedAt: Date.now(),
        createdAt: Date.now()
      });
    }
    
    const paddedNum = nextNum.toString().padStart(padding, '0');
    return `${prefix}${paddedNum}`;
  });
}
