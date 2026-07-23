import { arrayUnion, doc, type Firestore, updateDoc } from 'firebase/firestore';

/**
 * Grant a customer portal read of this worker's profile/docs via `assignedCustomerIds`.
 * Idempotent — safe to call on assignment create, ACTIVE, or admin portal preview.
 */
export async function ensureWorkerAssignedCustomerId(
  firestore: Firestore,
  workerId: string,
  customerId: string,
): Promise<void> {
  const wid = (workerId || '').trim();
  const cid = (customerId || '').trim();
  if (!wid || !cid) return;
  await updateDoc(doc(firestore, 'workers', wid), {
    assignedCustomerIds: arrayUnion(cid),
    updatedAt: Date.now(),
  });
}

/** Best-effort fan-out; failures for individual workers are ignored. */
export async function ensureWorkersAssignedCustomerId(
  firestore: Firestore,
  workerIds: string[],
  customerId: string,
): Promise<void> {
  const cid = (customerId || '').trim();
  if (!cid) return;
  const unique = [...new Set(workerIds.map((id) => (id || '').trim()).filter(Boolean))];
  await Promise.all(
    unique.map(async (wid) => {
      try {
        await ensureWorkerAssignedCustomerId(firestore, wid, cid);
      } catch {
        /* permission or missing worker — skip */
      }
    }),
  );
}
