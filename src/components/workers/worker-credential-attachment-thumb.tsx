'use client';

import { FileImage } from 'lucide-react';
import { isPdfAttachment } from '@/lib/storage/worker-credential-attachment';
import { cn } from '@/lib/utils';

type AttachmentMeta = {
  downloadUrl?: string;
  contentType?: string;
  fileName?: string;
};

type WorkerCredentialAttachmentThumbProps = {
  attachment?: AttachmentMeta;
  className?: string;
};

/** แสดงเอกสารแนบเป็นภาพย่อในตาราง — รูปและ PDF ใช้สไตล์เดียวกัน */
export function WorkerCredentialAttachmentThumb({
  attachment,
  className,
}: WorkerCredentialAttachmentThumbProps) {
  const url = attachment?.downloadUrl;
  if (!url) return null;

  const isPdf = isPdfAttachment(attachment);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex flex-col items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-blue-700 hover:bg-blue-100',
        className,
      )}
      title={isPdf ? 'เปิด PDF' : 'เปิดเอกสารแนบ'}
    >
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded border border-blue-100 bg-white">
        {isPdf ? (
          <iframe
            src={`${url}#page=1&toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            title="PDF preview"
            className="pointer-events-none absolute left-0 top-0 h-[400%] w-[400%] max-w-none origin-top-left scale-[0.25] border-0"
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={url} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold">
        <FileImage className="h-3 w-3" /> ดูเอกสาร
      </span>
    </a>
  );
}
