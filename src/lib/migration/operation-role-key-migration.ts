/**
 * Operation role-key canonicalization migration.
 *
 * Execution order (safe rollout):
 * 1) Deploy app/rules that still normalize legacy plural keys.
 * 2) Run this migration (dry-run first, then apply).
 * 3) Verify users + permission_profiles + auth-claim sync inputs.
 * 4) Remove temporary legacy normalization later.
 */

import type { Firestore } from 'firebase/firestore';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';

const OP_ROLE_CANONICAL_MAP: Record<string, string> = {
  operations_manager: 'operation_manager',
  operations_officer: 'operation_officer',
};

function toCanonicalOperationRole(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return OP_ROLE_CANONICAL_MAP[value] ?? value;
}

function shallowEqualArray(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export interface OperationRoleKeyMigrationEntry {
  collection: 'users' | 'permission_profiles';
  documentId: string;
  legacyValues: string[];
  mappedValues: string[];
  status: 'patched' | 'skipped';
  updatedFields: string[];
  clonedToProfileId?: string;
  deactivatedLegacyProfile?: boolean;
}

export interface OperationRoleKeyMigrationReport {
  timestamp: number;
  actorUid: string;
  dryRun: boolean;
  usersProcessed: number;
  usersPatched: number;
  usersSkipped: number;
  profilesProcessed: number;
  profilesPatched: number;
  profilesCloned: number;
  profilesSkipped: number;
  entries: OperationRoleKeyMigrationEntry[];
  errors: string[];
}

function patchUserDoc(data: Record<string, any>): Record<string, any> {
  const patch: Record<string, any> = {};

  const scalarFields = [
    'assignedRoleKey',
    'roleId',
    'permissionProfileKey',
    'primaryRoleTemplateKey',
  ] as const;

  for (const field of scalarFields) {
    const current = data[field];
    if (typeof current !== 'string') continue;
    const canonical = toCanonicalOperationRole(current);
    if (canonical && canonical !== current) {
      patch[field] = canonical;
    }
  }

  const arrayFields = ['assignedRoleKeys', 'roleIds', 'permissionProfileKeys'] as const;
  for (const field of arrayFields) {
    const current = data[field];
    if (!Array.isArray(current)) continue;
    let changed = false;
    const replaced = current.map((item) => {
      if (typeof item !== 'string') return item;
      const mapped = toCanonicalOperationRole(item);
      if (mapped !== item) changed = true;
      return mapped ?? item;
    });
    if (changed && !shallowEqualArray(replaced, current)) patch[field] = replaced;
  }

  return patch;
}

function collectLegacyPluralValuesFromUserDoc(data: Record<string, any>): string[] {
  const found: string[] = [];
  const scalarFields = ['assignedRoleKey', 'roleId', 'permissionProfileKey', 'primaryRoleTemplateKey'] as const;
  for (const field of scalarFields) {
    const current = data[field];
    if (typeof current !== 'string') continue;
    if (current === 'operations_manager' || current === 'operations_officer') found.push(current);
  }
  const arrayFields = ['assignedRoleKeys', 'roleIds', 'permissionProfileKeys'] as const;
  for (const field of arrayFields) {
    const current = data[field];
    if (!Array.isArray(current)) continue;
    for (const item of current) {
      if (item === 'operations_manager' || item === 'operations_officer') found.push(item);
    }
  }
  return found;
}

function patchPermissionProfileDoc(data: Record<string, any>): Record<string, any> {
  const patch: Record<string, any> = {};
  const scalarFields = ['profileKey', 'primaryRoleTemplateKey'] as const;
  for (const field of scalarFields) {
    const current = data[field];
    if (typeof current !== 'string') continue;
    const canonical = toCanonicalOperationRole(current);
    if (canonical && canonical !== current) {
      patch[field] = canonical;
    }
  }
  return patch;
}

function collectLegacyPluralValuesFromProfileDoc(docId: string, data: Record<string, any>): string[] {
  const found: string[] = [];
  if (docId === 'operations_manager' || docId === 'operations_officer') found.push(docId);
  const scalarFields = ['profileKey', 'primaryRoleTemplateKey'] as const;
  for (const field of scalarFields) {
    const current = data[field];
    if (current === 'operations_manager' || current === 'operations_officer') found.push(current);
  }
  return found;
}

export async function runOperationRoleKeyMigration(
  db: Firestore,
  options: { actorUid: string; dryRun?: boolean }
): Promise<OperationRoleKeyMigrationReport> {
  const { actorUid, dryRun = true } = options;
  const report: OperationRoleKeyMigrationReport = {
    timestamp: Date.now(),
    actorUid,
    dryRun,
    usersProcessed: 0,
    usersPatched: 0,
    usersSkipped: 0,
    profilesProcessed: 0,
    profilesPatched: 0,
    profilesCloned: 0,
    profilesSkipped: 0,
    entries: [],
    errors: [],
  };

  let batch: WriteBatch | null = dryRun ? null : writeBatch(db);
  let pendingOps = 0;
  const commitBatch = async () => {
    if (dryRun || !batch || pendingOps === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    pendingOps = 0;
  };
  const queueUpdate = (ref: any, patch: Record<string, any>) => {
    if (dryRun || !batch) return;
    batch.update(ref, patch);
    pendingOps += 1;
  };
  const queueSet = (ref: any, payload: Record<string, any>) => {
    if (dryRun || !batch) return;
    batch.set(ref, payload);
    pendingOps += 1;
  };

  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    report.usersProcessed = usersSnap.size;
    for (const d of usersSnap.docs) {
      const data = d.data() as Record<string, any>;
      const legacyValues = collectLegacyPluralValuesFromUserDoc(data);
      const patch = patchUserDoc(data);
      if (Object.keys(patch).length === 0) {
        report.usersSkipped += 1;
        report.entries.push({
          collection: 'users',
          documentId: d.id,
          legacyValues,
          mappedValues: [],
          status: 'skipped',
          updatedFields: [],
        });
        continue;
      }
      patch.updatedAt = Date.now();
      patch.updatedBy = actorUid;
      report.usersPatched += 1;
      report.entries.push({
        collection: 'users',
        documentId: d.id,
        legacyValues,
        mappedValues: legacyValues.map((v) => OP_ROLE_CANONICAL_MAP[v]).filter(Boolean),
        status: 'patched',
        updatedFields: Object.keys(patch),
      });
      queueUpdate(doc(db, 'users', d.id), patch);
      if (pendingOps >= 400) await commitBatch();
    }

    const profilesSnap = await getDocs(collection(db, 'permission_profiles'));
    report.profilesProcessed = profilesSnap.size;
    for (const d of profilesSnap.docs) {
      const data = d.data() as Record<string, any>;
      const legacyValues = collectLegacyPluralValuesFromProfileDoc(d.id, data);
      const patch = patchPermissionProfileDoc(data);
      const canonicalId = toCanonicalOperationRole(d.id);
      let clonedToProfileId: string | undefined;
      let deactivatedLegacyProfile = false;

      if (canonicalId && canonicalId !== d.id) {
        const canonicalRef = doc(db, 'permission_profiles', canonicalId);
        const canonicalSnap = await getDoc(canonicalRef);
        if (!canonicalSnap.exists()) {
          const clonePayload = {
            ...data,
            ...patch,
            id: canonicalId,
            profileKey: canonicalId,
            primaryRoleTemplateKey: canonicalId,
            migratedFromProfileKey: d.id,
            updatedAt: Date.now(),
            updatedBy: actorUid,
          };
          queueSet(canonicalRef, clonePayload);
          report.profilesCloned += 1;
          clonedToProfileId = canonicalId;
        }

        const legacyPatch = {
          isActive: false,
          migrationDeprecated: true,
          replacedByProfileKey: canonicalId,
          updatedAt: Date.now(),
          updatedBy: actorUid,
        };
        queueUpdate(doc(db, 'permission_profiles', d.id), legacyPatch);
        deactivatedLegacyProfile = true;
        report.profilesPatched += 1;
        report.entries.push({
          collection: 'permission_profiles',
          documentId: d.id,
          legacyValues,
          mappedValues: legacyValues.map((v) => OP_ROLE_CANONICAL_MAP[v] ?? v),
          status: 'patched',
          updatedFields: Object.keys(legacyPatch),
          clonedToProfileId,
          deactivatedLegacyProfile,
        });
        if (pendingOps >= 400) await commitBatch();
        continue;
      }

      if (Object.keys(patch).length > 0) {
        patch.updatedAt = Date.now();
        patch.updatedBy = actorUid;
        queueUpdate(doc(db, 'permission_profiles', d.id), patch);
        report.profilesPatched += 1;
        report.entries.push({
          collection: 'permission_profiles',
          documentId: d.id,
          legacyValues,
          mappedValues: legacyValues.map((v) => OP_ROLE_CANONICAL_MAP[v]).filter(Boolean),
          status: 'patched',
          updatedFields: Object.keys(patch),
        });
        if (pendingOps >= 400) await commitBatch();
      } else {
        report.profilesSkipped += 1;
        report.entries.push({
          collection: 'permission_profiles',
          documentId: d.id,
          legacyValues,
          mappedValues: [],
          status: 'skipped',
          updatedFields: [],
        });
      }
    }

    await commitBatch();
  } catch (e: any) {
    report.errors.push(e?.message || 'Unknown migration error');
  }

  return report;
}
