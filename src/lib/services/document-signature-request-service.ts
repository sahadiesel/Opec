'use client';

import { collection, doc, writeBatch, type Firestore } from 'firebase/firestore';
import type {
  AuthorizedSignatoryMark,
  DocumentSignatureRequest,
  DocumentSignatureSourceCollection,
  User,
} from '@/lib/types';

function actorName(actor: User): string {
  return (actor.displayName || actor.email || actor.id).trim();
}

function markPayload(mark: AuthorizedSignatoryMark): AuthorizedSignatoryMark {
  const out: AuthorizedSignatoryMark = {
    status: mark.status,
    updatedAt: mark.updatedAt,
  };
  if (mark.signerUid) out.signerUid = mark.signerUid;
  if (mark.signerName) out.signerName = mark.signerName;
  if (mark.signatureImageUrl) out.signatureImageUrl = mark.signatureImageUrl;
  if (mark.requestId) out.requestId = mark.requestId;
  return out;
}

/** ผู้จัดการแนบลายเซ็นของตนเองลงเอกสาร — officer ที่พิมพ์ทีหลังไม่ต้องขออนุมัติ */
export async function attachAuthorizedSignature(
  db: Firestore,
  params: {
    sourceCollection: DocumentSignatureSourceCollection;
    sourceId: string;
    actor: User;
    signatureImageUrl: string;
    openRequestId?: string;
  },
): Promise<void> {
  const url = params.signatureImageUrl.trim();
  if (!url) throw new Error('ยังไม่มีไฟล์ลายเซ็น — อัปโหลดที่หน้าจัดการผู้ใช้งานก่อน');
  const now = Date.now();
  const name = actorName(params.actor);
  const batch = writeBatch(db);
  batch.update(doc(db, params.sourceCollection, params.sourceId), {
    authorizedSignatory: markPayload({
      status: 'ATTACHED',
      signerUid: params.actor.id,
      signerName: name,
      signatureImageUrl: url,
      ...(params.openRequestId ? { requestId: params.openRequestId } : {}),
      updatedAt: now,
    }),
    updatedAt: now,
  });
  if (params.openRequestId) {
    batch.update(doc(db, 'document_signature_requests', params.openRequestId), {
      status: 'APPROVED',
      decidedByUid: params.actor.id,
      decidedByName: name,
      decidedAt: now,
    });
  }
  await batch.commit();
}

/** Officer ส่งขอให้ผู้จัดการอนุมัติลายเซ็นผู้มีอำนาจลงนาม */
export async function requestDocumentSignature(
  db: Firestore,
  params: {
    sourceCollection: DocumentSignatureSourceCollection;
    sourceId: string;
    documentNo: string;
    documentLabel: string;
    actor: User;
  },
): Promise<string> {
  const now = Date.now();
  const name = actorName(params.actor);
  const reqRef = doc(collection(db, 'document_signature_requests'));
  const request: DocumentSignatureRequest = {
    id: reqRef.id,
    status: 'PENDING',
    sourceCollection: params.sourceCollection,
    sourceId: params.sourceId,
    documentNo: params.documentNo,
    documentLabel: params.documentLabel,
    requestedByUid: params.actor.id,
    requestedByName: name,
    requestedAt: now,
  };
  const batch = writeBatch(db);
  batch.set(reqRef, request);
  batch.update(doc(db, params.sourceCollection, params.sourceId), {
    authorizedSignatory: markPayload({
      status: 'PENDING',
      requestId: reqRef.id,
      updatedAt: now,
    }),
    updatedAt: now,
  });
  await batch.commit();
  return reqRef.id;
}

export async function decideDocumentSignature(
  db: Firestore,
  request: DocumentSignatureRequest,
  actor: User,
  decision: 'APPROVED' | 'REJECTED',
  signatureImageUrl?: string,
): Promise<void> {
  const url = (signatureImageUrl || '').trim();
  if (decision === 'APPROVED' && !url) {
    throw new Error('ยังไม่มีไฟล์ลายเซ็น — อัปโหลดที่หน้าจัดการผู้ใช้งานก่อนจึงจะอนุมัติได้');
  }
  const now = Date.now();
  const name = actorName(actor);
  const batch = writeBatch(db);
  batch.update(doc(db, 'document_signature_requests', request.id), {
    status: decision,
    decidedByUid: actor.id,
    decidedByName: name,
    decidedAt: now,
  });
  const mark: AuthorizedSignatoryMark =
    decision === 'APPROVED'
      ? {
          status: 'APPROVED',
          signerUid: actor.id,
          signerName: name,
          signatureImageUrl: url,
          requestId: request.id,
          updatedAt: now,
        }
      : {
          status: 'REJECTED',
          requestId: request.id,
          updatedAt: now,
        };
  batch.update(doc(db, request.sourceCollection, request.sourceId), {
    authorizedSignatory: markPayload(mark),
    updatedAt: now,
  });
  await batch.commit();
}
