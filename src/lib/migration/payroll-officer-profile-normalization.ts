import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDoc, getDocs, setDoc, writeBatch, type WriteBatch } from 'firebase/firestore';
import { getBaselineProfiles } from '@/lib/permissions';

const TARGET_ROLE = 'payroll_officer';
const LEGACY_PROFILE = 'hr_officer';
const CANONICAL_PROFILE = 'payroll_officer';

export interface PayrollProfileNormalizationEntry {
  collection: 'users' | 'permission_profiles';
  documentId: string;
  status: 'patched' | 'skipped';
  reason: string;
  updatedFields: string[];
}

export interface PayrollProfileNormalizationReport {
  timestamp: number;
  actorUid: string;
  dryRun: boolean;
  usersProcessed: number;
  usersPatched: number;
  usersSkipped: number;
  profilesProcessed: number;
  profilesPatched: number;
  profilesSkipped: number;
  entries: PayrollProfileNormalizationEntry[];
  errors: string[];
}

function shouldPatchPayrollProfileMismatch(data: Record<string, any>): boolean {
  const assignedRoleKey = data.assignedRoleKey;
  const roleId = data.roleId;
  const assignedRoleKeys = Array.isArray(data.assignedRoleKeys) ? data.assignedRoleKeys : [];
  const roleIds = Array.isArray(data.roleIds) ? data.roleIds : [];
  const currentProfile = data.permissionProfileKey;

  const isPayrollRole =
    assignedRoleKey === TARGET_ROLE ||
    roleId === TARGET_ROLE ||
    assignedRoleKeys.includes(TARGET_ROLE) ||
    roleIds.includes(TARGET_ROLE);

  return isPayrollRole && currentProfile === LEGACY_PROFILE;
}

function buildUserPatch(data: Record<string, any>, actorUid: string): Record<string, any> {
  const patch: Record<string, any> = {
    permissionProfileKey: CANONICAL_PROFILE,
    updatedAt: Date.now(),
    updatedBy: actorUid,
  };

  const profileKeys = Array.isArray(data.permissionProfileKeys) ? [...data.permissionProfileKeys] : [];
  if (profileKeys.length === 0) {
    patch.permissionProfileKeys = [CANONICAL_PROFILE];
  } else {
    patch.permissionProfileKeys = profileKeys.map((v) => (v === LEGACY_PROFILE ? CANONICAL_PROFILE : v));
  }

  return patch;
}

export async function runPayrollOfficerProfileNormalization(
  db: Firestore,
  options: { actorUid: string; dryRun?: boolean }
): Promise<PayrollProfileNormalizationReport> {
  const { actorUid, dryRun = true } = options;
  const report: PayrollProfileNormalizationReport = {
    timestamp: Date.now(),
    actorUid,
    dryRun,
    usersProcessed: 0,
    usersPatched: 0,
    usersSkipped: 0,
    profilesProcessed: 0,
    profilesPatched: 0,
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

  const queueUpdate = (ref: any, payload: Record<string, any>) => {
    if (dryRun || !batch) return;
    batch.update(ref, payload);
    pendingOps += 1;
  };

  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    report.usersProcessed = usersSnap.size;

    for (const d of usersSnap.docs) {
      const data = d.data() as Record<string, any>;
      if (!shouldPatchPayrollProfileMismatch(data)) {
        report.usersSkipped += 1;
        report.entries.push({
          collection: 'users',
          documentId: d.id,
          status: 'skipped',
          reason: 'not_target_mismatch',
          updatedFields: [],
        });
        continue;
      }

      const patch = buildUserPatch(data, actorUid);
      queueUpdate(doc(db, 'users', d.id), patch);
      report.usersPatched += 1;
      report.entries.push({
        collection: 'users',
        documentId: d.id,
        status: 'patched',
        reason: 'payroll_role_with_legacy_hr_profile',
        updatedFields: Object.keys(patch),
      });
      if (pendingOps >= 400) await commitBatch();
    }

    // Ensure payroll_officer profile exists and points to payroll_officer template.
    report.profilesProcessed = 1;
    const payrollProfileRef = doc(db, 'permission_profiles', CANONICAL_PROFILE);
    const payrollProfileSnap = await getDoc(payrollProfileRef);
    const baselinePayroll = getBaselineProfiles().find((p) => p.profileKey === CANONICAL_PROFILE);

    if (!baselinePayroll) {
      report.profilesSkipped += 1;
      report.entries.push({
        collection: 'permission_profiles',
        documentId: CANONICAL_PROFILE,
        status: 'skipped',
        reason: 'baseline_missing',
        updatedFields: [],
      });
    } else if (!payrollProfileSnap.exists()) {
      const payload = {
        ...baselinePayroll,
        id: CANONICAL_PROFILE,
        profileKey: CANONICAL_PROFILE,
        primaryRoleTemplateKey: TARGET_ROLE,
        updatedAt: Date.now(),
        updatedBy: actorUid,
      };
      if (!dryRun) {
        await setDoc(payrollProfileRef, payload, { merge: true });
      }
      report.profilesPatched += 1;
      report.entries.push({
        collection: 'permission_profiles',
        documentId: CANONICAL_PROFILE,
        status: 'patched',
        reason: 'created_missing_payroll_profile',
        updatedFields: ['profileKey', 'primaryRoleTemplateKey'],
      });
    } else {
      const data = payrollProfileSnap.data() as Record<string, any>;
      if (data.primaryRoleTemplateKey !== TARGET_ROLE || data.profileKey !== CANONICAL_PROFILE) {
        const patch = {
          profileKey: CANONICAL_PROFILE,
          primaryRoleTemplateKey: TARGET_ROLE,
          updatedAt: Date.now(),
          updatedBy: actorUid,
        };
        queueUpdate(payrollProfileRef, patch);
        report.profilesPatched += 1;
        report.entries.push({
          collection: 'permission_profiles',
          documentId: CANONICAL_PROFILE,
          status: 'patched',
          reason: 'fixed_profile_template_binding',
          updatedFields: Object.keys(patch),
        });
      } else {
        report.profilesSkipped += 1;
        report.entries.push({
          collection: 'permission_profiles',
          documentId: CANONICAL_PROFILE,
          status: 'skipped',
          reason: 'already_canonical',
          updatedFields: [],
        });
      }
    }

    await commitBatch();
  } catch (e: any) {
    report.errors.push(e?.message || 'Unknown normalization error');
  }

  return report;
}

