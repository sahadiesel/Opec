'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  type Firestore,
} from 'firebase/firestore';
import type {
  MainContract,
  MobCycleBillingReview,
  Position,
  PositionRate,
} from '@/lib/types';
import {
  getEffectiveMobDemobLocations,
  resolveMatrixSellRate,
} from '@/lib/commercial/position-rate-matrix';
import type { GeneratedBillingLine } from '@/lib/services/billing-line-generator';

export interface TripMobDemobMember {
  mobCycleId: string;
  workerId: string;
  workerName: string;
  positionId: string;
}

export interface TripMobDemobLocationOption {
  key: string;
  label: string;
}

export type TripMobDemobLocationChoice =
  | { kind: 'not_required' }
  | { kind: 'auto'; mobLocationKey: string; label: string }
  | { kind: 'prompt'; options: TripMobDemobLocationOption[] }
  | { kind: 'error'; message: string };

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function loadTripMobDemobMembers(
  db: Firestore,
  mobCycleIds: readonly string[],
): Promise<TripMobDemobMember[]> {
  const members: TripMobDemobMember[] = [];
  for (const mobCycleId of mobCycleIds) {
    const snap = await getDoc(doc(db, 'mob_cycle_billing_reviews', mobCycleId));
    if (!snap.exists()) continue;
    const review = snap.data() as MobCycleBillingReview;
    const positionId = String(review.positionId || '').trim();
    if (!positionId) continue;
    members.push({
      mobCycleId,
      workerId: review.workerId,
      workerName: review.workerNameSnapshot || review.workerId,
      positionId,
    });
  }
  return members;
}

export async function loadContractPositionRatesByPositionId(
  db: Firestore,
  contractId: string,
): Promise<Map<string, PositionRate>> {
  const snap = await getDocs(
    collection(db, 'main_contracts', contractId, 'position_rates'),
  );
  const map = new Map<string, PositionRate>();
  for (const d of snap.docs) {
    const rate = { id: d.id, ...(d.data() as object) } as PositionRate;
    if (!rate.active) continue;
    map.set(rate.positionId, rate);
  }
  return map;
}

function mobDemobRateForMember(
  rate: PositionRate | undefined,
  mobLocationKey: string,
): number | null {
  if (!rate) return null;
  return resolveMatrixSellRate(rate, 'offshore_mob_demob_round_trip', {
    mobLocationKey,
  });
}

/** จุด mob/demob ที่ทุกคนในชุดมีอัตราในตารางสัญญา */
export function listValidTripMobDemobLocations(
  contract: Pick<MainContract, 'mobDemobLocations'>,
  members: TripMobDemobMember[],
  ratesByPosition: Map<string, PositionRate>,
): TripMobDemobLocationOption[] {
  if (members.length === 0) return [];
  const locations = getEffectiveMobDemobLocations(contract);
  return locations.filter((loc) =>
    members.every((m) => {
      const amt = mobDemobRateForMember(ratesByPosition.get(m.positionId), loc.key);
      return amt != null && amt > 0;
    }),
  );
}

export async function resolveTripMobDemobLocationChoice(
  db: Firestore,
  contractId: string,
  mobCycleIds: readonly string[],
): Promise<TripMobDemobLocationChoice> {
  const mcSnap = await getDoc(doc(db, 'main_contracts', contractId));
  if (!mcSnap.exists()) {
    return { kind: 'error', message: 'ไม่พบสัญญาหลักของ PO' };
  }
  const contract = { id: mcSnap.id, ...(mcSnap.data() as object) } as MainContract;
  if (!contract.tripBillMobDemobFee) {
    return { kind: 'not_required' };
  }

  const members = await loadTripMobDemobMembers(db, mobCycleIds);
  if (members.length === 0) {
    return { kind: 'error', message: 'ไม่พบสมาชิกในชุดวางบิล — ซิงก์ชุดวางบิลก่อนสร้าง invoice' };
  }

  const ratesByPosition = await loadContractPositionRatesByPositionId(db, contractId);
  const options = listValidTripMobDemobLocations(contract, members, ratesByPosition);

  if (options.length === 0) {
    const missing = members.filter((m) => !ratesByPosition.has(m.positionId));
    if (missing.length > 0) {
      return {
        kind: 'error',
        message: `สัญญากำหนดให้คิดค่า MOB แต่ไม่พบอัตราตำแหน่งในตารางราคา (${missing.map((m) => m.workerName).join(', ')})`,
      };
    }
    return {
      kind: 'error',
      message:
        'สัญญากำหนดให้คิดค่า MOB แต่ไม่มีจุด Mob/Demob ที่ทุกคนในชุดมีอัตรา — ตรวจตารางราคา offshore (Mob/Demob round trip)',
    };
  }

  if (options.length === 1) {
    return { kind: 'auto', mobLocationKey: options[0]!.key, label: options[0]!.label };
  }

  return { kind: 'prompt', options };
}

async function loadPositionLabels(
  db: Firestore,
  positionIds: string[],
): Promise<Map<string, string>> {
  const uniq = [...new Set(positionIds.filter(Boolean))];
  const map = new Map<string, string>();
  await Promise.all(
    uniq.map(async (pid) => {
      const snap = await getDoc(doc(db, 'positions', pid));
      if (snap.exists()) {
        const p = snap.data() as Position;
        const label = String(
          p.positionName || p.positionNameTh || p.positionNameEn || pid,
        ).trim();
        map.set(pid, label || pid);
      } else {
        map.set(pid, pid);
      }
    }),
  );
  return map;
}

/** บรรทัดค่า Mob/Demob ไป-กลับ — 1 คนต่อ 1 trip */
export async function generateTripMobDemobBillingLines(
  db: Firestore,
  contract: Pick<MainContract, 'mobDemobLocations'>,
  members: TripMobDemobMember[],
  ratesByPosition: Map<string, PositionRate>,
  mobLocationKey: string,
): Promise<{ lines: GeneratedBillingLine[]; warnings: string[] }> {
  const warnings: string[] = [];
  const locations = getEffectiveMobDemobLocations(contract);
  const loc = locations.find((l) => l.key === mobLocationKey);
  const locLabel = loc?.label || mobLocationKey;

  const positionLabels = await loadPositionLabels(
    db,
    members.map((m) => m.positionId),
  );

  type Acc = {
    positionId: string;
    unitPrice: number;
    workerIds: Set<string>;
    workerNames: string[];
    mobCycleIds: string[];
  };
  const accMap = new Map<string, Acc>();

  for (const member of members) {
    const rate = ratesByPosition.get(member.positionId);
    const unitPrice = mobDemobRateForMember(rate, mobLocationKey);
    if (unitPrice == null || unitPrice <= 0) {
      warnings.push(
        `${member.workerName} — ไม่มีอัตรา Mob/Demob @ ${locLabel} ในตารางสัญญา (ข้าม)`,
      );
      continue;
    }
    const up = roundMoney(unitPrice);
    const key = `${member.positionId}__${up}`;
    let acc = accMap.get(key);
    if (!acc) {
      acc = {
        positionId: member.positionId,
        unitPrice: up,
        workerIds: new Set(),
        workerNames: [],
        mobCycleIds: [],
      };
      accMap.set(key, acc);
    }
    acc.workerIds.add(member.workerId);
    acc.workerNames.push(member.workerName);
    acc.mobCycleIds.push(member.mobCycleId);
  }

  const lines: GeneratedBillingLine[] = [];
  for (const acc of accMap.values()) {
    const qty = acc.workerIds.size;
    const amount = roundMoney(acc.unitPrice * qty);
    const title = positionLabels.get(acc.positionId) || acc.positionId;
    const workerBit =
      acc.workerNames.length <= 3
        ? acc.workerNames.join(', ')
        : `${acc.workerNames.slice(0, 2).join(', ')} และอีก ${acc.workerNames.length - 2} คน`;
    lines.push({
      description: `${title} — ค่า Mob/Demob ไป-กลับ (${locLabel}) · ${qty} trip · ${workerBit}`,
      referenceType: 'TIMESHEET',
      positionId: acc.positionId,
      eventType: 'trip_mob_demob_round_trip',
      timesheetIds: [],
      quantity: qty,
      unitPrice: acc.unitPrice,
      amount,
    });
  }

  if (lines.length === 0) {
    warnings.push('ไม่สร้างบรรทัดค่า MOB — ไม่มีอัตราที่ใช้ได้สำหรับสมาชิกในชุด');
  }

  return { lines, warnings };
}
