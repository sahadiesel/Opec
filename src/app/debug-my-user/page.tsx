'use client';

/**
 * Debug page (any signed-in user) — แสดง raw fields ใน `users/{my uid}` กับการประเมิน gate ของ Firestore rules
 * เพื่อช่วยหา field ที่หายระหว่าง roll-out rules ใหม่ (ไม่มี side effect)
 */
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  collectionGroup,
  doc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { useFirestore, useUser, useDoc, useMemoFirebase } from '@/firebase';

function asString(v: unknown): string {
  if (v == null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export default function MyUserDocDebugPage() {
  const firestore = useFirestore();
  const { user: firebaseUser, isUserLoading } = useUser();

  const userRef = useMemoFirebase(() => {
    if (!firestore || !firebaseUser?.uid) return null;
    return doc(firestore, 'users', firebaseUser.uid);
  }, [firestore, firebaseUser?.uid]);

  const { data: userDoc, isLoading, error } = useDoc<Record<string, any>>(userRef as any);

  const fieldList = useMemo(() => {
    if (!userDoc) return [] as Array<{ key: string; value: unknown }>;
    const all = Object.keys(userDoc as Record<string, unknown>)
      .filter((k) => k !== 'id')
      .sort();
    return all.map((k) => ({ key: k, value: (userDoc as Record<string, unknown>)[k] }));
  }, [userDoc]);

  const ruleEval = useMemo(() => {
    if (!userDoc) return null;
    const d = userDoc as Record<string, any>;

    const userTypeInternal =
      d.user_type === 'internal' ||
      d.user_type === 'INTERNAL' ||
      (typeof d.userType === 'string' && d.userType.toLowerCase() === 'internal') ||
      (!('user_type' in d) && !('userType' in d));

    const isPortal =
      d.user_type === 'customer_portal' ||
      d.user_type === 'CUSTOMER_PORTAL' ||
      d.userType === 'customer_portal';

    const statusActive =
      d.status === 'active' ||
      d.status === 'ACTIVE' ||
      d.approvalStatus === 'ACTIVE' ||
      d.approvalStatus === 'APPROVED' ||
      d.approvalStatus === 'active' ||
      ((!('status' in d) || d.status == null) &&
        (!('approvalStatus' in d) || d.approvalStatus == null) &&
        d.isActive === true);

    const adminIndicators = {
      assignedRoleKey: d.assignedRoleKey === 'system_admin' || d.assignedRoleKey === 'admin_admin',
      permissionProfileKey: d.permissionProfileKey === 'system_admin' || d.permissionProfileKey === 'admin_admin',
      permissionProfileKeys:
        Array.isArray(d.permissionProfileKeys) &&
        d.permissionProfileKeys.some((x: string) => ['system_admin', 'admin_admin'].includes(x)),
      roleIds:
        Array.isArray(d.roleIds) &&
        d.roleIds.some((x: string) => ['system_admin', 'admin_admin'].includes(x)),
      role: d.role === 'system_admin' || d.role === 'admin_admin',
      accessGroup: typeof d.accessGroup === 'string' && d.accessGroup.toLowerCase() === 'admin',
    };
    const anyAdmin = Object.values(adminIndicators).some(Boolean);

    return {
      isInternalTypeData: userTypeInternal && !isPortal,
      isCustomerPortalData: isPortal,
      isActiveStatus: statusActive,
      isInternalStaffDoc: userTypeInternal && !isPortal,
      isInternalUser: userTypeInternal && !isPortal && statusActive,
      isAdmin: userTypeInternal && !isPortal && statusActive && anyAdmin,
      adminIndicators,
    };
  }, [userDoc]);

  const [probes, setProbes] = useState<Array<{ name: string; ok: boolean; count?: number; error?: string }>>([]);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    if (!firestore || !firebaseUser?.uid) return;
    let cancelled = false;
    setProbing(true);
    const queries: Array<{ name: string; build: () => any }> = [
      { name: "collection('purchase_orders') where status in [active,ACTIVE]", build: () => query(collection(firestore, 'purchase_orders'), where('status', 'in', ['active', 'ACTIVE']), limit(1)) },
      { name: "collection('main_contracts') where status in [active,...]", build: () => query(collection(firestore, 'main_contracts'), where('status', 'in', ['active', 'ACTIVE', 'revised', 'REVISED']), limit(1)) },
      { name: "collection('po_active_bundles')", build: () => query(collection(firestore, 'po_active_bundles'), limit(1)) },
      { name: "collectionGroup('po_lines')", build: () => query(collectionGroup(firestore, 'po_lines'), limit(1)) },
      { name: "collection('waves')", build: () => query(collection(firestore, 'waves'), limit(1)) },
      { name: "collection('mobilizations')", build: () => query(collection(firestore, 'mobilizations'), limit(1)) },
      { name: "collection('positions')", build: () => query(collection(firestore, 'positions'), limit(1)) },
      { name: "collection('customers')", build: () => query(collection(firestore, 'customers'), limit(1)) },
    ];

    (async () => {
      const out: Array<{ name: string; ok: boolean; count?: number; error?: string }> = [];
      for (const q of queries) {
        try {
          const snap = await getDocs(q.build());
          out.push({ name: q.name, ok: true, count: snap.size });
        } catch (e: any) {
          out.push({ name: q.name, ok: false, error: e?.code ? `${e.code} — ${e.message}` : String(e?.message ?? e) });
        }
        if (cancelled) return;
        setProbes([...out]);
      }
      if (!cancelled) setProbing(false);
    })();

    return () => { cancelled = true; };
  }, [firestore, firebaseUser?.uid]);

  if (isUserLoading || !firebaseUser) {
    return <div style={{ padding: 24 }}>Loading auth…</div>;
  }

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', maxWidth: 980 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>users/{firebaseUser.uid}</h1>
      <p style={{ fontSize: 12, marginBottom: 16, color: '#555' }}>
        debug page — แสดงค่า field ใน user doc ของผู้ใช้ปัจจุบัน + ประเมิน gate ของ Firestore rules
      </p>

      {isLoading && <div>Loading doc…</div>}
      {error && (
        <pre style={{ background: '#fee', padding: 12 }}>
          ERROR: {(error as Error)?.message ?? String(error)}
        </pre>
      )}

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          Live Firestore probes {probing ? '(running…)' : '(done)'}
        </h2>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={{ padding: 6, textAlign: 'left', border: '1px solid #ddd' }}>Query</th>
              <th style={{ padding: 6, textAlign: 'left', border: '1px solid #ddd' }}>Result</th>
              <th style={{ padding: 6, textAlign: 'left', border: '1px solid #ddd' }}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {probes.map((p) => (
              <tr key={p.name}>
                <td style={{ padding: 6, border: '1px solid #ddd' }}>{p.name}</td>
                <td
                  style={{
                    padding: 6,
                    border: '1px solid #ddd',
                    color: p.ok ? '#0a0' : '#c00',
                    fontWeight: 700,
                  }}
                >
                  {p.ok ? 'OK' : 'DENIED'}
                </td>
                <td style={{ padding: 6, border: '1px solid #ddd', whiteSpace: 'pre-wrap', fontSize: 11 }}>
                  {p.ok ? `${p.count} row(s)` : p.error}
                </td>
              </tr>
            ))}
            {probes.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: 8, color: '#888' }}>(probing…)</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {ruleEval && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Production rule gate evaluation</h2>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              {Object.entries({
                'isInternalTypeData (รับ list ที่ใช้ isInternalStaffDoc)': ruleEval.isInternalTypeData,
                'isCustomerPortalData (must be false)': !ruleEval.isCustomerPortalData,
                'isActiveStatus (status/approvalStatus/isActive)': ruleEval.isActiveStatus,
                'isInternalStaffDoc()': ruleEval.isInternalStaffDoc,
                'isInternalUser()': ruleEval.isInternalUser,
                'isAdmin()': ruleEval.isAdmin,
              }).map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: '4px 12px', border: '1px solid #ddd' }}>{k}</td>
                  <td
                    style={{
                      padding: '4px 12px',
                      border: '1px solid #ddd',
                      color: v ? '#0a0' : '#c00',
                      fontWeight: 700,
                    }}
                  >
                    {v ? 'PASS' : 'FAIL'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12 }}>admin indicators (ต้องผ่านหนึ่งข้อ)</summary>
            <pre style={{ background: '#f7f7f7', padding: 8, fontSize: 11 }}>
              {JSON.stringify(ruleEval.adminIndicators, null, 2)}
            </pre>
          </details>
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Raw field values</h2>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={{ padding: 6, textAlign: 'left', border: '1px solid #ddd' }}>Field</th>
              <th style={{ padding: 6, textAlign: 'left', border: '1px solid #ddd' }}>Type</th>
              <th style={{ padding: 6, textAlign: 'left', border: '1px solid #ddd' }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {fieldList.map(({ key, value }) => (
              <tr key={key}>
                <td style={{ padding: 6, border: '1px solid #ddd', fontWeight: 600 }}>{key}</td>
                <td style={{ padding: 6, border: '1px solid #ddd', color: '#666' }}>
                  {Array.isArray(value) ? 'array' : typeof value}
                </td>
                <td style={{ padding: 6, border: '1px solid #ddd', whiteSpace: 'pre-wrap' }}>
                  {asString(value)}
                </td>
              </tr>
            ))}
            {fieldList.length === 0 && !isLoading && (
              <tr>
                <td colSpan={3} style={{ padding: 12, color: '#888' }}>(empty)</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
