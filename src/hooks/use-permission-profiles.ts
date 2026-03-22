'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  FirestoreError,
  QuerySnapshot,
  DocumentData,
} from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { User, PermissionProfile } from '@/lib/types';
import type { WithId } from '@/firebase/firestore/use-collection';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';

/** Effective profile key: primary field first, else first transitional array entry (no aggregation). */
export function getEffectivePermissionProfileKey(user: User | null): string | null {
  if (!user) return null;
  if (user.permissionProfileKey) return user.permissionProfileKey;
  const first = user.permissionProfileKeys?.[0];
  return first ?? null;
}

/**
 * Loads at most one permission_profiles row for the user (no multi-profile merge).
 */
export function usePermissionProfiles(user: User | null) {
  const firestore = useFirestore();

  const profileKey = useMemo(() => getEffectivePermissionProfileKey(user), [user]);

  const [profile, setProfile] = useState<WithId<PermissionProfile> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  useEffect(() => {
    if (!firestore || !profileKey) {
      setProfile(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const q = query(
      collection(firestore, 'permission_profiles'),
      where('profileKey', '==', profileKey)
    );

    const unsub = onSnapshot(
      q,
      (snapshot: QuerySnapshot<DocumentData>) => {
        const first = snapshot.docs[0];
        if (first) {
          setProfile({ ...(first.data() as PermissionProfile), id: first.id });
        } else {
          setProfile(null);
        }
        setIsLoading(false);
      },
      (err: FirestoreError) => {
        const contextualError = new FirestorePermissionError({
          operation: 'list',
          path: 'permission_profiles',
        });
        setError(contextualError);
        setProfile(null);
        setIsLoading(false);
        errorEmitter.emit('permission-error', contextualError);
      }
    );

    return () => unsub();
  }, [firestore, profileKey]);

  const profiles = useMemo(
    () => (profile ? [profile] : null),
    [profile]
  );

  return { profile, profiles, isLoading, error };
}
