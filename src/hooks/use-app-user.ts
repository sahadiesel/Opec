'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, DocumentReference, DocumentData, setDoc } from 'firebase/firestore';
import { useFirestore, useUser } from '@/firebase';
import { useDoc } from '@/firebase/firestore/use-doc';
import type { User } from '@/lib/types';
import { sanitizeFirestorePayload } from '@/lib/utils';

/**
 * Primary app user profile: prefers live Firestore `users/{uid}`; localStorage is cache/fallback only.
 */
export function useAppUser() {
  const { user: authUser, isUserLoading: authLoading } = useUser();
  const firestore = useFirestore();

  const userDocRef = useMemo((): DocumentReference<DocumentData> | null => {
    if (!firestore || !authUser?.uid) return null;
    return doc(firestore, 'users', authUser.uid);
  }, [firestore, authUser?.uid]);

  const { data: firestoreUser, isLoading: docLoading, error: userDocError } = useDoc<User>(userDocRef);

  const [cachedUser, setCachedUser] = useState<User | null>(null);
  const bootstrapAttempted = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('opsflow_user');
      if (raw) setCachedUser(JSON.parse(raw) as User);
    } catch {
      setCachedUser(null);
    }
  }, [authUser?.uid]);

  useEffect(() => {
    if (firestoreUser) {
      try {
        localStorage.setItem('opsflow_user', JSON.stringify(firestoreUser));
      } catch {
        /* ignore quota */
      }
    }
  }, [firestoreUser]);

  /** First-time Auth user: create default internal Firestore profile (matches firestore.rules bootstrap). */
  useEffect(() => {
    if (!firestore || !authUser?.uid) return;
    if (docLoading) return;
    if (firestoreUser) {
      bootstrapAttempted.current = false;
      return;
    }
    if (userDocError) return;
    if (bootstrapAttempted.current) return;
    bootstrapAttempted.current = true;

    const uid = authUser.uid;
    const now = Date.now();
    const payload = sanitizeFirestorePayload({
      id: uid,
      email: authUser.email || '',
      displayName: authUser.displayName || 'User',
      phone: '',
      userType: 'internal' as const,
      user_type: 'internal',
      status: 'active',
      role: 'operations_officer',
      assignedRoleKey: 'operations_officer' as const,
      assignedRoleKeys: ['operations_officer'] as const,
      department: 'operations',
      level: 'officer' as const,
      roleIds: [],
      isActive: true,
      approvalStatus: 'ACTIVE' as const,
      createdAt: now,
      updatedAt: now,
    });

    setDoc(doc(firestore, 'users', uid), payload, { merge: true }).catch(() => {
      bootstrapAttempted.current = false;
    });
  }, [firestore, authUser, docLoading, firestoreUser, userDocError]);

  /**
   * Never trust localStorage for RBAC after Firestore user doc fails (e.g. permission-denied),
   * or after load completes with no server doc — avoids "UI says HR / Save says denied".
   */
  const currentUser = useMemo(() => {
    if (firestoreUser) return firestoreUser;
    if (docLoading && authUser) return cachedUser;
    if (userDocError) return null;
    return null;
  }, [firestoreUser, docLoading, authUser, cachedUser, userDocError]);

  const isLoading =
    authLoading || (!!authUser && docLoading && !firestoreUser && !cachedUser);

  return {
    currentUser,
    authUser,
    isLoading,
    isFromFirestore: !!firestoreUser,
    userDocError,
  };
}
