'use client';

import { useState, type ReactNode } from 'react';
import { useFirebaseApp } from '@/firebase';
import { openStorageDownloadUrl } from '@/lib/storage/open-storage-download-url';
import { cn } from '@/lib/utils';

type StorageProofLinkProps = {
  url: string;
  children: ReactNode;
  className?: string;
  title?: string;
};

/**
 * ลิงก์เปิดหลักฐานจาก Firebase Storage
 * ใช้ SDK รีเฟรช download URL ก่อนเปิด — กัน 403 เมื่อเปิดแท็บใหม่โดยไม่มี auth
 */
export function StorageProofLink({ url, children, className, title }: StorageProofLinkProps) {
  const app = useFirebaseApp();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      title={title}
      disabled={busy || !url}
      className={cn(
        'text-primary font-semibold underline text-xs text-left disabled:opacity-60',
        className,
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!app || !url || busy) return;
        setBusy(true);
        void openStorageDownloadUrl(app, url)
          .catch((err) => {
            console.error(err);
            // fallback: ลองเปิดลิงก์เดิม
            window.open(url, '_blank', 'noopener,noreferrer');
          })
          .finally(() => setBusy(false));
      }}
    >
      {busy ? 'กำลังเปิด…' : children}
    </button>
  );
}
