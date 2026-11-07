'use client';

import { useState } from 'react';
import { Loader2, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useFirestore } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { getEffectiveAccessLevel, isSystemAdmin } from '@/lib/permission-core';
import { requestDocumentSignature } from '@/lib/services/document-signature-request-service';
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
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const level = getEffectiveAccessLevel(currentUser);
  const canRequest = isSystemAdmin(currentUser) || level === 'admin' || level === 'manager' || level === 'officer';
  const ready = authorizedSignatureReady(mark);
  const pending = mark?.status === 'PENDING';

  if (!canRequest) return null;

  const btnClass =
    tone === 'onDark'
      ? 'w-full border-white/40 bg-white/10 text-white hover:bg-white/20 font-semibold'
      : 'gap-2';
  const noteClass = tone === 'onDark' ? 'text-[11px] text-white/80' : 'text-[11px] text-muted-foreground';

  const submit = async () => {
    if (!firestore || pending) return;
    setBusy(true);
    try {
      await requestDocumentSignature(firestore, {
        sourceCollection,
        sourceId,
        documentNo,
        documentLabel,
        actor: currentUser,
        note,
      });
      setOpen(false);
      setNote('');
      toast({
        title: 'ส่งขออนุมัติลายเซ็นแล้ว',
        description: 'รายการไปอยู่ที่ศูนย์อนุมัติ → รออนุมัติการเซ็นต์เอกสาร',
      });
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
          ผู้อนุมัติ{mark?.signerName ? `: ${mark.signerName}` : 'บันทึกแล้ว'}
        </p>
      ) : null}
      {pending ? <p className={noteClass}>รออนุมัติลายเซ็นจากศูนย์อนุมัติ</p> : null}
      {mark?.status === 'REJECTED' ? <p className={noteClass}>คำขอลายเซ็นถูกปฏิเสธ — ส่งขอใหม่ได้</p> : null}
      <Button
        type="button"
        variant="outline"
        className={btnClass}
        disabled={busy || pending}
        onClick={() => setOpen(true)}
      >
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PenLine className="mr-2 h-4 w-4" />}
        ขออนุมัติลายเซ็นต์
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ขออนุมัติลายเซ็น</DialogTitle>
            <DialogDescription>
              {documentLabel} เลขที่ {documentNo} — ผู้ที่กดอนุมัติในศูนย์อนุมัติจะถูกบันทึกชื่อและลายเซ็นลงเอกสาร
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ข้อความถึงผู้อนุมัติ (ไม่จำเป็น)"
            rows={4}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="button" disabled={busy} onClick={() => void submit()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              ขออนุมัติ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
