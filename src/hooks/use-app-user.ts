'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, DocumentReference, DocumentData } from 'firebase/firestore';
import { useFirestore, useUser } from '@/firebase';
import { useDoc } from '@/firebase/firestore/use-doc';
import type { User } from '@/lib/types';

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

  const { data: firestoreUser, isLoading: docLoading } = useDoc<User>(userDocRef);

  const [cachedUser, setCachedUser] = useState<User | null>(null);

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

  const currentUser = firestoreUser ?? cachedUser;
  const isLoading =
    authLoading || (!!authUser && docLoading && !firestoreUser && !cachedUser);

  return {
    currentUser,
    authUser,
    isLoading,
    isFromFirestore: !!firestoreUser,
  };
}
