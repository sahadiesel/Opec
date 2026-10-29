'use client';

import { useState } from 'react';
import { doc } from 'firebase/firestore';
import { Loader2, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { getEffectiveAccessLevel, isSystemAdmin } from '@/lib/permission-core';
import {
  attachAuthorizedSignature,
  requestDocumentSignature,
} from '@/lib/services/document-signature-request-service';
import type {
  AuthorizedSignatoryMark,
  DocumentSignatureSourceCollection,
  User,
} from '@/lib/types';
import { authorizedSignatureReady } from '@/lib/types/document-signature';

export function AuthorizedSignatoryActions({
  sourceCollection,
  sourceId,
  documentNo,
  documentLabel,
  mark,
  currentUser,
  tone = 'default',
}: {
  sourceCollection: DocumentSignatureSourceCollection;
  sourceId: string;
  documentNo: string;
  documentLabel: string;
  mark?: AuthorizedSignatoryMark | null;
  currentUser: User;
  tone?: 'default' | 'onDark';
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const level = getEffectiveAccessLevel(currentUser);
  const isManager = isSystemAdmin(currentUser) || level === 'admin' || level === 'manager';
  const isOfficer = level === 'officer';
  const ready = authorizedSignatureReady(mark);
  const pending = mark?.status === 'PENDING';

  const userRef = useMemoFirebase(
    () => (firestore && isManager ? doc(firestore, 'users', currentUser.id) : null),
    [firestore, isManager, currentUser.id],
  );
  const { data: self } = useDoc<User>(userRef as never);

  if (!isManager && !isOfficer) return null;

  const btnClass =
    tone === 'onDark'
      ? 'w-full border-white/40 bg-white/10 text-white hover:bg-white/20 font-semibold'
      : 'gap-2';
  const noteClass = tone === 'onDark' ? 'text-[11px] text-white/80' : 'text-[11px] text-muted-foreground';

  const attach = async () => {
    if (!firestore) return;
    const url = (self?.signatureImageUrl || currentUser.signatureImageUrl || '').trim();
    if (!url) {
      toast({
        variant: 'destructive',
        title: 'ยังไม่มีลายเซ็น',
        description: 'อัปโหลดลายเซ็นในหน้าจัดการผู้ใช้งานก่อน',
      });
      return;
    }
    setBusy(true);
    try {
      await attachAuthorizedSignature(firestore, {
        sourceCollection,
        sourceId,
        actor: currentUser,
        signatureImageUrl: url,
        openRequestId: pending ? mark?.requestId : undefined,
      });
      toast({ title: 'แนบลายเซ็นแล้ว', description: 'ตอนพิมพ์เลือก “ลายเซ็น” เพื่อใส่ลงเอกสาร' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'แนบไม่สำเร็จ',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const request = async () => {
    if (!firestore || pending) return;
    setBusy(true);
    try {
      await requestDocumentSignature(firestore, {
        sourceCollection,
        sourceId,
        documentNo,
        documentLabel,
        actor: currentUser,
      });
      toast({ title: 'ส่งขออนุมัติลายเซ็นแล้ว', description: 'รอผู้จัดการอนุมัติในศูนย์อนุมัติ' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'ส่งคำขอไม่สำเร็จ',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={tone === 'onDark' ? 'space-y-2' : 'flex flex-col items-stretch gap-1'}>
      {ready ? (
        <p className={noteClass}>
          มีลายเซ็นผู้มีอำนาจแล้ว{mark?.signerName ? ` · ${mark.signerName}` : ''}
        </p>
      ) : null}
      {pending ? <p className={noteClass}>รออนุมัติลายเซ็นจากผู้จัดการ</p> : null}
      {mark?.status === 'REJECTED' ? <p className={noteClass}>คำขอลายเซ็นถูกปฏิเสธ — ส่งขอใหม่ได้</p> : null}
      {isManager ? (
        <Button type="button" variant="outline" className={btnClass} disabled={busy} onClick={() => void attach()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PenLine className="mr-2 h-4 w-4" />}
          แนบลายเซ็นต์
        </Button>
      ) : null}
      {isOfficer && !ready ? (
        <Button type="button" variant="outline" className={btnClass} disabled={busy || pending} onClick={() => void request()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PenLine className="mr-2 h-4 w-4" />}
          ขออนุมัติลายเซ็นต์
        </Button>
      ) : null}
    </div>
  );
}
