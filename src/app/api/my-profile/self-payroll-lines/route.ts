import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from '@/lib/server/firebase-admin-app';
import {
  fetchOfficeStaffPayrollLinesAdmin,
  fetchWorkerPayrollLinesAdmin,
  verifySelfPayrollSubject,
  type SelfPayrollSubjectKind,
} from '@/lib/server/self-payroll-lines';

export const runtime = 'nodejs';

function parseKind(raw: string | null): SelfPayrollSubjectKind | null {
  if (raw === 'office_staff' || raw === 'worker') return raw;
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return NextResponse.json({ error: 'ต้องมี Authorization Bearer token' }, { status: 401 });
    }

    const kind = parseKind(req.nextUrl.searchParams.get('kind'));
    const subjectId = (req.nextUrl.searchParams.get('subjectId') || '').trim();
    if (!kind || !subjectId) {
      return NextResponse.json({ error: 'kind และ subjectId จำเป็น' }, { status: 400 });
    }

    const app = getFirebaseAdminApp();
    const decoded = await getAuth(app).verifyIdToken(token);
    const db = getFirestore(app);

    const verified = await verifySelfPayrollSubject(db, decoded.uid, kind, subjectId);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }

    const lines =
      kind === 'office_staff'
        ? await fetchOfficeStaffPayrollLinesAdmin(db, subjectId, verified.linkedUserId)
        : await fetchWorkerPayrollLinesAdmin(db, subjectId, verified.linkedUserId);

    return NextResponse.json({ lines });
  } catch (e: unknown) {
    console.error('[api/my-profile/self-payroll-lines]', e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg || 'โหลดข้อมูลไม่สำเร็จ' }, { status: 500 });
  }
}
