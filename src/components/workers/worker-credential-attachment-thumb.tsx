'use client';

import { useEffect, useState } from 'react';
import { FileImage, FileText, Loader2 } from 'lucide-react';
import { useFirebaseApp } from '@/firebase';
import { isPdfAttachment } from '@/lib/storage/worker-credential-attachment';
import {
  openStorageDownloadUrl,
  resolveStorageAttachmentUrl,
} from '@/lib/storage/open-storage-download-url';
import { cn } from '@/lib/utils';

type AttachmentMeta = {
  downloadUrl?: string;
  storagePath?: string;
  contentType?: string;
  fileName?: string;
};

type WorkerCredentialAttachmentThumbProps = {
  attachment?: AttachmentMeta;
  className?: string;
};

/** แสดงเอกสารแนบเป็นภาพย่อในตาราง — รีเฟรช download URL ผ่าน SDK ก่อนแสดง/เปิด */
export function WorkerCredentialAttachmentThumb({
  attachment,
  className,
}: WorkerCredentialAttachmentThumbProps) {
  const app = useFirebaseApp();
  const rawUrl = attachment?.downloadUrl;
  const storagePath = attachment?.storagePath;
  const hasFile = Boolean(rawUrl || storagePath);
  const isPdf = isPdfAttachment(attachment);

  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreviewFailed(false);
    setDisplayUrl(null);
    if (!app || !hasFile) return;

    void resolveStorageAttachmentUrl(app, {
      downloadUrl: rawUrl,
      storagePath,
    })
      .then((url) => {
        if (!cancelled) setDisplayUrl(url);
      })
      .catch(() => {
        if (!cancelled && rawUrl) setDisplayUrl(rawUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [app, hasFile, rawUrl, storagePath]);

  if (!hasFile) return null;

  const open = () => {
    if (!app || opening) return;
    const seed = displayUrl || rawUrl;
    if (!seed && !storagePath) return;
    setOpening(true);
    void openStorageDownloadUrl(app, seed || '', storagePath)
      .catch((err) => {
        console.error(err);
        if (seed) window.open(seed, '_blank', 'noopener,noreferrer');
      })
      .finally(() => setOpening(false));
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={opening}
      className={cn(
        'inline-flex flex-col items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-blue-700 hover:bg-blue-100 disabled:opacity-60',
        className,
      )}
      title={isPdf ? 'เปิด PDF' : 'เปิดเอกสารแนบ'}
    >
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded border border-blue-100 bg-white flex items-center justify-center">
        {!displayUrl && !previewFailed ? (
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        ) : isPdf || previewFailed || !displayUrl ? (
          <FileText className="h-6 w-6 text-blue-600" />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={displayUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setPreviewFailed(true)}
          />
        )}
      </div>
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold">
        {opening ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileImage className="h-3 w-3" />}
        {opening ? 'กำลังเปิด…' : 'ดูเอกสาร'}
      </span>
    </button>
  );
}
