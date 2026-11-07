/**
 * Rules release id for a Firestore database.
 * firebase-admin 12.7 `releaseFirestoreRulesetFromSource` / `getFirestoreRuleset`
 * always use `cloud.firestore`, which is only the `(default)` database.
 * Named databases use `cloud.firestore/<databaseId>` (same as firebase-tools).
 */
export function firestoreRulesReleaseName(databaseId) {
  const id = typeof databaseId === 'string' ? databaseId.trim() : '';
  if (!id || id === '(default)') return 'cloud.firestore';
  return `cloud.firestore/${id}`;
}
