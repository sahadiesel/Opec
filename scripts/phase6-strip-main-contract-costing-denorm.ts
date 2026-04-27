/**
 * เฟส 6 — ลบ field denorm แบบเก่า `costingStatus` / `costingMissingPositionsCount` / `costingUpdatedAt`
 * ออกจากเอกสาร `main_contracts/*` (ฐานต้นทุนแรงอ้าง /positions แล้ว)
 *
 * ต้อง auth ฝั่ง server — เหมือน phase1/phase5
 *
 * Usage:
 *   npx tsx scripts/phase6-strip-main-contract-costing-denorm.ts
 *   npx tsx scripts/phase6-strip-main-contract-costing-denorm.ts --dry-run
 *   npx tsx scripts/phase6-strip-main-contract-costing-denorm.ts --contract=MAIN_CONTRACT_ID
 */

import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { resolveFirebaseProjectId } from './resolve-firebase-project-id';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length) || undefined;
  return undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const FIELDS = ['costingStatus', 'costingMissingPositionsCount', 'costingUpdatedAt'] as const;
const BATCH_SIZE = 400;

async function main() {
  const onlyContract = argValue('contract');
  const dryRun = hasFlag('dry-run');

  if (!getApps().length) {
    const projectId = resolveFirebaseProjectId();
    try {
      initializeApp({
        credential: applicationDefault(),
        ...(projectId ? { projectId } : {}),
      });
    } catch {
      initializeApp(projectId ? { projectId } : undefined);
    }
  }
  const db = getFirestore();

  const mainRefs: DocumentReference[] = onlyContract
    ? [db.doc(`main_contracts/${onlyContract}`)]
    : (await db.collection('main_contracts').get()).docs.map((d) => d.ref);

  if (onlyContract && !(await mainRefs[0]!.get()).exists) {
    console.error(`No document main_contracts/${onlyContract}`);
    process.exit(1);
  }

  const toStrip: DocumentReference[] = [];
  for (const mRef of mainRefs) {
    const snap = await mRef.get();
    if (!snap.exists) continue;
    const d = snap.data() || {};
    if (FIELDS.some((k) => Object.prototype.hasOwnProperty.call(d, k))) {
      toStrip.push(mRef);
    }
  }

  console.log(
    JSON.stringify(
      { dryRun, contractFilter: onlyContract ?? 'ALL', mainContractDocs: mainRefs.length, docsToStrip: toStrip.length },
      null,
      2,
    ),
  );

  if (dryRun || !toStrip.length) {
    if (dryRun) console.log('\n(dry-run: ไม่ได้เขียน Firestore)');
    return;
  }

  const patch = Object.fromEntries(FIELDS.map((k) => [k, FieldValue.delete()]));
  for (let i = 0; i < toStrip.length; i += BATCH_SIZE) {
    const chunk = toStrip.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const ref of chunk) {
      batch.update(ref, patch);
    }
    await batch.commit();
  }
  console.log(`Done. Stripped ${FIELDS.join(', ')} on ${toStrip.length} main_contract document(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
