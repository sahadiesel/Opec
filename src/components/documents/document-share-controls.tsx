'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { Loader2, Share2 } from 'lucide-react';
import { useFirestore } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { User } from '@/lib/types';
import { sanitizeFirestorePayload } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {
  buildSharePayload,
  canManageDocumentShare,
  documentIsShared,
  documentShareRecipients,
  isOfficerShareTargetUser,
  officerRoleLabel,
  type DocumentShareFields,
  type DocumentShareRecipient,
} from '@/lib/documents/document-share';

type DocumentShareControlsProps = DocumentShareFields & {
  collectionName: string;
  documentId: string;
  currentUser: User | null;
  size?: 'default' | 'sm';
  className?: string;
};

function recipientsFromDoc(docFields: DocumentShareFields): DocumentShareRecipient[] {
  const named = documentShareRecipients(docFields);
  if (named.length > 0) return named;
  return (docFields.sharedWithUids || [])
    .filter((uid) => typeof uid === 'string' && uid.trim() !== '')
    .map((uid) => ({ uid, displayName: uid }));
}

export function DocumentShareButton(props: DocumentShareControlsProps) {
  const { currentUser } = props;
  const [open, setOpen] = useState(false);
  if (!canManageDocumentShare(currentUser)) return null;

  const count = documentShareRecipients(props).length || (props.sharedWithUids || []).filter(Boolean).length;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={props.size === 'sm' ? 'sm' : 'default'}
        className={cn('gap-2 print:hidden', props.className)}
        onClick={() => setOpen(true)}
      >
        <Share2 className="h-4 w-4" />
        แชร์
        {count > 0 ? (
          <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-bold text-primary">{count}</span>
        ) : null}
      </Button>
      <DocumentShareDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function DocumentShareListMarker(props: DocumentShareControlsProps) {
  const { currentUser } = props;
  const [open, setOpen] = useState(false);
  if (!canManageDocumentShare(currentUser)) return null;
  if (!documentIsShared(props)) return null;

  const count = documentShareRecipients(props).length || (props.sharedWithUids || []).filter(Boolean).length;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          'h-8 w-8 text-sky-700 hover:bg-sky-50 hover:text-sky-800 print:hidden',
          props.className,
        )}
        title={`แชร์ให้ ${count} คน — กดเพื่อดูรายชื่อ`}
        aria-label={`แชร์ให้ ${count} คน`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <span className="relative inline-flex">
          <Share2 className="h-4 w-4" />
          {count > 1 ? (
            <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-sky-600 px-0.5 text-[9px] font-bold text-white">
              {count}
            </span>
          ) : null}
        </span>
      </Button>
      <DocumentShareDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}

function DocumentShareDialog({
  collectionName,
  documentId,
  currentUser,
  sharedWith,
  sharedWithUids,
  open,
  onOpenChange,
}: DocumentShareControlsProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [officers, setOfficers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, DocumentShareRecipient>>({});

  useEffect(() => {
    if (!open) return;
    const current = recipientsFromDoc({ sharedWith, sharedWithUids });
    const next: Record<string, DocumentShareRecipient> = {};
    for (const r of current) next[r.uid] = r;
    setSelected(next);
    setSearch('');
  }, [open, sharedWith, sharedWithUids]);

  useEffect(() => {
    if (!open || !firestore) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(firestore, 'users'));
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as object) }) as User)
          .filter(isOfficerShareTargetUser)
          .sort((a, b) =>
            (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '', 'th'),
          );
        if (!cancelled) setOfficers(list);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          toast({
            variant: 'destructive',
            title: 'โหลดรายชื่อไม่สำเร็จ',
            description: 'ไม่สามารถดึงรายชื่อ officer ได้',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, firestore, toast]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return officers;
    return officers.filter((u) => {
      const role = officerRoleLabel(u.assignedRoleKey || u.role);
      return [u.displayName, u.email, role, u.assignedRoleKey]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [officers, search]);

  const toggle = (user: User, checked: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) {
        next[user.id] = {
          uid: user.id,
          displayName: (user.displayName || user.email || '').trim() || user.id,
          roleKey: user.assignedRoleKey || user.role || undefined,
        };
      } else {
        delete next[user.id];
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!firestore || !documentId) return;
    setSaving(true);
    try {
      const payload = buildSharePayload(Object.values(selected));
      await updateDoc(
        doc(firestore, collectionName, documentId),
        sanitizeFirestorePayload({
          sharedWith: payload.sharedWith,
          sharedWithUids: payload.sharedWithUids,
        }),
      );
      toast({
        title: 'บันทึกการแชร์แล้ว',
        description:
          payload.sharedWith.length === 0
            ? 'เอกสารถูกถอนการแชร์แล้ว'
            : `แชร์ให้ ${payload.sharedWith.length} คน`,
      });
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'บันทึกไม่สำเร็จ',
        description: 'ไม่สามารถอัปเดตผู้รับแชร์ได้',
      });
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = Object.keys(selected).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>แชร์เอกสารให้ officer</DialogTitle>
          <DialogDescription>
            ผู้ที่ถูกเลือกจะเห็นเอกสารนี้ในหน้ารายการ แม้ไม่ได้เป็นผู้สร้าง
          </DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อ / อีเมล / บทบาท"
          className="h-9"
        />
        <ScrollArea className="h-72 rounded-md border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              กำลังโหลดรายชื่อ…
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              ไม่พบ officer ในระบบ
            </p>
          ) : (
            <ul className="divide-y">
              {filtered.map((u) => {
                const checked = Boolean(selected[u.id]);
                return (
                  <li key={u.id}>
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/50">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggle(u, v === true)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {u.displayName || u.email || u.id}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {officerRoleLabel(u.assignedRoleKey || u.role)}
                          {u.email ? ` · ${u.email}` : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
        <p className="text-xs text-muted-foreground">เลือกแล้ว {selectedCount} คน</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            ยกเลิก
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving || loading || !currentUser}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
