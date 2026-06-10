import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from '@/lib/server/firebase-admin-app';
import {
  applyMoneyReceiptWhtFix,
  scanMoneyReceiptWhtFixes,
} from '@/lib/migrations/fix-money-receipt-wht-amounts';

export const runtime = 'nodejs';

function effectiveRoleFromUserDoc(d: Record<string, unknown> | undefined): string {
  if (!d) return '';
  const role = typeof d.role === 'string' ? d.role.trim().toLowerCase() : '';
  if (role) return role;
  const ak = typeof d.assignedRoleKey === 'string' ? d.assignedRoleKey.trim().toLowerCase() : '';
  if (ak) return ak;
  const aks = Array.isArray(d.assignedRoleKeys) ? d.assignedRoleKeys[0] : null;
  return typeof aks === 'string' ? aks.trim().toLowerCase() : '';
}

function callerMayFixReceipt(d: Record<string, unknown> | undefined): boolean {
  const r = effectiveRoleFromUserDoc(d);
  return r === 'system_admin' || r === 'accounting_manager' || r === 'accounting_officer';
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return NextResponse.json({ error: 'ต้องมี Authorization Bearer token' }, { status: 401 });
    }

    let body: { receiptId?: string; includeCashbook?: boolean };
    try {
      body = (await req.json()) as { receiptId?: string; includeCashbook?: boolean };
    } catch {
      return NextResponse.json({ error: 'รูปแบบคำขอไม่ถูกต้อง' }, { status: 400 });
    }

    const receiptId = typeof body.receiptId === 'string' ? body.receiptId.trim() : '';
    if (!receiptId) {
      return NextResponse.json({ error: 'receiptId จำเป็น' }, { status: 400 });
    }

    const app = getFirebaseAdminApp();
    const adminAuth = getAuth(app);
    const db = getFirestore(app);

    const decoded = await adminAuth.verifyIdToken(token);
    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    const callerData = callerSnap.data();
    if (!callerMayFixReceipt(callerData)) {
      return NextResponse.json({ error: 'เฉพาะบัญชี/ผู้ดูแลระบบ' }, { status: 403 });
    }

    const { plans, skipped } = await scanMoneyReceiptWhtFixes(db, { receiptId });
    if (plans.length === 0) {
      const reason = skipped[0]?.reason ?? 'ไม่พบรายการที่ต้องแก้';
      return NextResponse.json({ error: reason }, { status: 400 });
    }

    const actorName =
      (typeof callerData?.displayName === 'string' && callerData.displayName.trim()) ||
      decoded.email ||
      decoded.uid;

    const result = await applyMoneyReceiptWhtFix(db, plans[0]!, {
      includeCashbook: body.includeCashbook === true,
      actorUid: decoded.uid,
      actorName,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[receipts/fix-wht-amount]', e);
    const msg = e instanceof Error ? e.message : 'แก้ใบเสร็จไม่สำเร็จ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
