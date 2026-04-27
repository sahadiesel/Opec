/**
 * เฟส 1 — backfill ต้นทุนแรงจาก main_contract/position_rates → positions + ตรา migration ราย workers
 *
 * ต้อง auth ฝั่ง server (Service Account) เช่น
 *   set GOOGLE_APPLICATION_CREDENTIALS=path\\to-sa.json
 * หรือ `gcloud auth application-default login`
 *
 * Usage:
 *   npx tsx scripts/phase1-labor-cost-migration.ts --contract=MAIN_CONTRACT_ID
 *   npx tsx scripts/phase1-labor-cost-migration.ts --contract=ID --dry-run
 *   npx tsx scripts/phase1-labor-cost-migration.ts --contract=ID --force
 *   npx tsx scripts/phase1-labor-cost-migration.ts --contract=ID --skip-workers
 *   npx tsx scripts/phase1-labor-cost-migration.ts --contract=ID --offshore-only
 *   (ราคาเดิม costBaseline → defaultLaborCostOffshore เท่านั้น ไม่แต่ defaultLaborCostOnshore)
 */

import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, type DocumentReference, type DocumentData } from 'firebase-admin/firestore';
import {
  planBackfillsForRates,
  shouldApplyToPosition,
  shouldApplyToPositionOffshoreOnly,
  shouldStampWorkerMigration,
} from '../src/lib/migrations/phase1-labor-cost-backfill';
import type { Position, PositionRate } from '../src/lib/types';
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

function toRate(docId: string, data: DocumentData): (PositionRate & { id: string }) | null {
  const positionId = typeof data.positionId === 'string' ? data.positionId : null;
  if (!positionId) return null;
  return {
    id: docId,
    positionId,
    sellRate: Number(data.sellRate ?? 0) || 0,
    costBaseline: Number(data.costBaseline ?? 0) || 0,
    billingUnit: data.billingUnit === 'monthly' || data.billingUnit === 'hourly' ? data.billingUnit : 'daily',
    active: data.active !== false,
    overtimeRule: typeof data.overtimeRule === 'string' ? data.overtimeRule : '',
    ...data,
  } as PositionRate & { id: string };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function main() {
  const contractId = argValue('contract');
  if (!contractId) {
    console.error('Required: --contract=MAIN_CONTRACT_ID');
    process.exit(1);
  }
  const dryRun = hasFlag('dry-run');
  const force = hasFlag('force');
  const skipWorkers = hasFlag('skip-workers');
  const offshoreOnly = hasFlag('offshore-only');

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
  const contractRef = db.doc(`main_contracts/${contractId}`);
  const cSnap = await contractRef.get();
  if (!cSnap.exists) {
    console.error(`No document main_contracts/${contractId}`);
    process.exit(1);
  }

  const ratesSnap = await contractRef.collection('position_rates').get();
  const rates: Array<PositionRate & { id: string }> = [];
  for (const d of ratesSnap.docs) {
    const r = toRate(d.id, d.data());
    if (r) rates.push(r);
  }
  const { planned, skipped: skippedRates } = planBackfillsForRates(rates, { onlyActive: true, offshoreOnly });
  const positionLog: Array<{
    positionId: string;
    action: 'update' | 'skip' | 'skip_missing_doc';
    detail?: string;
  }> = [];
  const now = Date.now();

  type PosOp = {
    ref: DocumentReference;
    onshore: number;
    offshore: number;
    offshoreOnly?: boolean;
  };
  const posOps: PosOp[] = [];

  for (const plan of planned) {
    const pref = db.doc(`positions/${plan.positionId}`);
    const pSnap = await pref.get();
    if (!pSnap.exists) {
      positionLog.push({ positionId: plan.positionId, action: 'skip_missing_doc' });
      continue;
    }
    const pos = { id: pSnap.id, ...pSnap.data() } as Position;
    const isOff = plan.offshoreOnly === true;
    if (isOff) {
      if (!shouldApplyToPositionOffshoreOnly(pos, force)) {
        positionLog.push({ positionId: plan.positionId, action: 'skip', detail: 'offshore_already_set' });
        continue;
      }
    } else if (!shouldApplyToPosition(pos, force)) {
      positionLog.push({ positionId: plan.positionId, action: 'skip', detail: 'has_defaults' });
      continue;
    }
    posOps.push({
      ref: pref,
      onshore: plan.defaultLaborCostOnshore,
      offshore: plan.defaultLaborCostOffshore,
      offshoreOnly: plan.offshoreOnly,
    });
    positionLog.push({ positionId: plan.positionId, action: 'update' });
  }

  if (!dryRun && posOps.length) {
    await Promise.all(
      chunkArray(posOps, 400).map((chunk) => {
        if (!chunk.length) return Promise.resolve();
        const b = db.batch();
        for (const o of chunk) {
          if (o.offshoreOnly) {
            b.update(o.ref, {
              defaultLaborCostOffshore: o.offshore,
              updatedAt: now,
            });
          } else {
            b.update(o.ref, {
              defaultLaborCostOnshore: o.onshore,
              defaultLaborCostOffshore: o.offshore,
              updatedAt: now,
            });
          }
        }
        return b.commit();
      }),
    );
  }

  let workersStamped = 0;
  const workerLog: Array<{ workerId: string; action: 'stamp' | 'skip' }> = [];
  let workersTotal: number | null = null;
  if (!skipWorkers) {
    const wSnap = await db.collection('workers').get();
    workersTotal = wSnap.size;
    const toStamp: DocumentReference[] = [];
    for (const doc of wSnap.docs) {
      const w = doc.data() as { laborCostMigratedFromMainContractId?: string; laborCostMigratedAt?: number };
      if (!shouldStampWorkerMigration(w, contractId, force)) {
        workerLog.push({ workerId: doc.id, action: 'skip' });
        continue;
      }
      toStamp.push(doc.ref);
      workerLog.push({ workerId: doc.id, action: 'stamp' });
    }
    workersStamped = toStamp.length;
    if (!dryRun && toStamp.length) {
      const patch = {
        laborCostMigratedFromMainContractId: contractId,
        laborCostMigratedAt: now,
        updatedAt: now,
      };
      await Promise.all(
        chunkArray(toStamp, 400).map((chunk) => {
          if (!chunk.length) return Promise.resolve();
          const b = db.batch();
          for (const ref of chunk) {
            b.update(ref, patch);
          }
          return b.commit();
        }),
      );
    }
  }

  const report = {
    mainContract: contractId,
    mainContractNumber: (cSnap.data() as { contractNumber?: string } | undefined)?.contractNumber,
    dryRun,
    force,
    skipWorkers,
    offshoreOnly,
    positionRatesTotal: rates.length,
    plannedFromRates: planned.length,
    positionUpdates: posOps.length,
    skippedRates,
    positionLog: positionLog.slice(0, 200),
    positionLogTruncated: positionLog.length > 200,
    workersTotal,
    workersStamped,
    workerLogSample: workerLog.slice(0, 100),
    workerLogTruncated: workerLog.length > 100,
  };

  console.log(JSON.stringify(report, null, 2));
  if (dryRun) {
    console.log('\n(dry-run: ไม่ได้เขียน Firestore)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
