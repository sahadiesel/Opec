'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  doc,
  onSnapshot,
  FirestoreError,
  DocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase';
import { User, PermissionProfile } from '@/lib/types';
import type { WithId } from '@/firebase/firestore/use-collection';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';
import { shouldSuppressFirestorePermissionError } from '@/firebase/firestore/suppress-logout-permission-error';
import { normalizePermissionProfileDocumentId } from '@/lib/role-key-normalizer';

/** Effective profile key: primary field first, else first transitional array entry (no aggregation). */
export function getEffectivePermissionProfileKey(user: User | null): string | null {
  if (!user) return null;
  const raw = user.permissionProfileKey ?? user.permissionProfileKeys?.[0] ?? null;
  return normalizePermissionProfileDocumentId(raw);
}

/**
 * Loads at most one permission_profiles row for the user (no multi-profile merge).
 * Reads the document directly by ID to comply with security rules that deny listing.
 */
export function usePermissionProfiles(user: User | null) {
  const firestore = useFirestore();
  const { user: firebaseUser, isUserLoading } = useUser();

  const profileKey = useMemo(() => getEffectivePermissionProfileKey(user), [user]);

  const [profile, setProfile] = useState<WithId<PermissionProfile> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  useEffect(() => {
    // Guard against logout race: local app user may still exist briefly,
    // but firebase auth can already be null. Never query profiles when unauthenticated.
    if (!firestore || !profileKey || isUserLoading || !firebaseUser) {
      setProfile(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Read direct by ID since 'list' is restricted in rules
    const docRef = doc(firestore, 'permission_profiles', profileKey);

    const unsub = onSnapshot(
      docRef,
      (snapshot: DocumentSnapshot<DocumentData>) => {
        if (snapshot.exists()) {
          setProfile({ ...(snapshot.data() as PermissionProfile), id: snapshot.id });
        } else {
          setProfile(null);
        }
        setIsLoading(false);
      },
      (err: FirestoreError) => {
        if (shouldSuppressFirestorePermissionError(err)) {
          setProfile(null);
          setIsLoading(false);
          setError(null);
          return;
        }
        const contextualError = new FirestorePermissionError({
          operation: 'get',
          path: `permission_profiles/${profileKey}`,
        });
        setError(contextualError);
        setProfile(null);
        setIsLoading(false);
        errorEmitter.emit('permission-error', contextualError);
      }
    );

    return () => unsub();
  }, [firestore, profileKey, firebaseUser, isUserLoading]);

  const profiles = useMemo(() => (profile ? [profile] : null), [profile]);

  return { profile, profiles, isLoading, error };
}
