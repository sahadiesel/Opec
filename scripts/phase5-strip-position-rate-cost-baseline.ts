/**
 * เฟส 5 — ลบ field `costBaseline` ออกจากทุกเอกสาร `main_contracts/{id}/position_rates/*`
 * (ต้นทุนแรง OPEC กำหนดที่ /positions แล้ว; สคริปต์นี้ one-time หลัง deploy รหัสเฟส 5)
 *
 * ต้อง auth ฝั่ง server (Service Account) เช่น
 *   set GOOGLE_APPLICATION_CREDENTIALS=path\\to-sa.json
 *   หรือ `gcloud auth application-default login`
 *
 * Usage:
 *   npx tsx scripts/phase5-strip-position-rate-cost-baseline.ts
 *   npx tsx scripts/phase5-strip-position-rate-cost-baseline.ts --dry-run
 *   npx tsx scripts/phase5-strip-position-rate-cost-baseline.ts --contract=MAIN_CONTRACT_ID
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

  const mainRefs = onlyContract
    ? [db.doc(`main_contracts/${onlyContract}`)]
    : (await db.collection('main_contracts').get()).docs.map((d) => d.ref);

  if (onlyContract && !(await mainRefs[0]!.get()).exists) {
    console.error(`No document main_contracts/${onlyContract}`);
    process.exit(1);
  }

  const toStrip: DocumentReference[] = [];

  for (const mRef of mainRefs) {
    const rates = await mRef.collection('position_rates').get();
    for (const d of rates.docs) {
      if (!Object.prototype.hasOwnProperty.call(d.data() || {}, 'costBaseline')) continue;
      toStrip.push(d.ref);
    }
  }
  console.log(
    JSON.stringify(
      {
        dryRun,
        contractFilter: onlyContract ?? 'ALL',
        mainContractDocs: mainRefs.length,
        positionRateDocsToStrip: toStrip.length,
      },
      null,
      2,
    ),
  );

  if (dryRun || !toStrip.length) {
    if (dryRun) console.log('\n(dry-run: ไม่ได้เขียน Firestore)');
    return;
  }

  for (let i = 0; i < toStrip.length; i += BATCH_SIZE) {
    const chunk = toStrip.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const ref of chunk) {
      batch.update(ref, { costBaseline: FieldValue.delete() });
    }
    await batch.commit();
  }
  console.log(`Done. Stripped costBaseline on ${toStrip.length} position_rates document(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
