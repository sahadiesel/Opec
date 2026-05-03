import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from '@/lib/server/firebase-admin-app';
import type { User as AppUser } from '@/lib/types';
import { getFieldsForBusinessRole, normalizeUserAuthorizationFields } from '@/lib/auth-mapping';
import { sanitizeFirestorePayload } from '@/lib/utils';

export const runtime = 'nodejs';

const DEFAULT_PASSWORD = 'opecopec';

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (!t || !t.includes('@')) return null;
  return t;
}

function effectiveRoleFromUserDoc(d: Record<string, unknown> | undefined): string {
  if (!d) return '';
  const role = typeof d.role === 'string' ? d.role.trim().toLowerCase() : '';
  if (role) return role;
  const ak = typeof d.assignedRoleKey === 'string' ? d.assignedRoleKey.trim().toLowerCase() : '';
  if (ak) return ak;
  const aks = Array.isArray(d.assignedRoleKeys) ? d.assignedRoleKeys[0] : null;
  return typeof aks === 'string' ? aks.trim().toLowerCase() : '';
}

function callerMayActivateWorkerLogin(d: Record<string, unknown> | undefined): boolean {
  const r = effectiveRoleFromUserDoc(d);
  const allowed = new Set([
    'system_admin',
    'hr_manager',
    'hr_officer',
    'operations_manager',
    'payroll_officer',
  ]);
  return allowed.has(r);
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return NextResponse.json({ error: 'ต้องมี Authorization Bearer token' }, { status: 401 });
    }

    let body: { workerId?: string; loginEmail?: string };
    try {
      body = (await req.json()) as { workerId?: string; loginEmail?: string };
    } catch {
      return NextResponse.json({ error: 'รูปแบบคำขอไม่ถูกต้อง' }, { status: 400 });
    }

    const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : '';
    const loginEmail = normalizeEmail(body.loginEmail);
    if (!workerId || !loginEmail) {
      return NextResponse.json({ error: 'workerId และ loginEmail (รูปแบบอีเมล) จำเป็น' }, { status: 400 });
    }

    const app = getFirebaseAdminApp();
    const adminAuth = getAuth(app);
    const db = getFirestore(app);

    const decoded = await adminAuth.verifyIdToken(token);
    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    const callerData = callerSnap.data();
    if (!callerMayActivateWorkerLogin(callerData)) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์เปิดใช้บัญชีล็อกอินลูกจ้าง' }, { status: 403 });
    }

    const workerRef = db.collection('workers').doc(workerId);
    const workerSnap = await workerRef.get();
    if (!workerSnap.exists) {
      return NextResponse.json({ error: 'ไม่พบทะเบียนคนงาน' }, { status: 404 });
    }

    const worker = workerSnap.data()!;
    const displayName =
      `${worker.firstName ?? ''} ${worker.lastName ?? ''}`.trim() || loginEmail;
    const now = Date.now();

    let uid = typeof worker.linkedUserId === 'string' ? worker.linkedUserId.trim() : '';

    if (uid) {
      try {
        await adminAuth.updateUser(uid, {
          email: loginEmail,
          password: DEFAULT_PASSWORD,
          displayName,
        });
      } catch (e: unknown) {
        const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
        return NextResponse.json(
          { error: code || 'อัปเดตบัญชี Firebase ไม่สำเร็จ' },
          { status: 409 },
        );
      }

      await db
        .collection('users')
        .doc(uid)
        .set(
          sanitizeFirestorePayload({
            email: loginEmail,
            displayName,
            updatedAt: now,
            mustResetPassword: true,
          }) as Record<string, unknown>,
          { merge: true },
        );
    } else {
      try {
        const cred = await adminAuth.createUser({
          email: loginEmail,
          password: DEFAULT_PASSWORD,
          displayName,
        });
        uid = cred.uid;
      } catch (e: unknown) {
        const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
        if (code === 'auth/email-already-in-use') {
          return NextResponse.json(
            { error: 'อีเมลนี้ถูกใช้ลงทะเบียนในระบบแล้ว — ใช้อีเมลอื่นหรือผูกบัญชีเดิมในทะเบียน' },
            { status: 409 },
          );
        }
        return NextResponse.json({ error: code || 'สร้างบัญชี Firebase ไม่สำเร็จ' }, { status: 400 });
      }

      const roleFields = getFieldsForBusinessRole('employee_self');
      const draft: Partial<AppUser> = {
        id: uid,
        email: loginEmail,
        displayName,
        ...roleFields,
        isActive: true,
        approvalStatus: 'ACTIVE',
        mustResetPassword: true,
        createdAt: now,
        updatedAt: now,
      };
      const userPayload = normalizeUserAuthorizationFields(draft);
      await db.collection('users').doc(uid).set(sanitizeFirestorePayload(userPayload as Record<string, unknown>));
    }

    await workerRef.set(
      sanitizeFirestorePayload({
        linkedUserId: uid,
        email: loginEmail,
        loginEmailActivatedAt: now,
        updatedAt: now,
      }) as Record<string, unknown>,
      { merge: true },
    );

    return NextResponse.json({ ok: true, uid, loginEmail });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[activate-login]', e);
    const localCredHint =
      msg.includes('Could not load the default credentials') ||
      msg.includes('metadata.google.internal') ||
      msg.includes('ENOTFOUND')
        ? 'บนเครื่องพัฒนาให้ตั้ง GOOGLE_APPLICATION_CREDENTIALS (path ไฟล์ Service Account) หรือ FIREBASE_SERVICE_ACCOUNT_JSON ใน .env.local — ดู comment ใน src/lib/server/firebase-admin-app.ts'
        : null;
    return NextResponse.json(
      { error: localCredHint ?? msg },
      { status: 500 },
    );
  }
}
