'use client';

import { useState, type ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/** Shared single-line ใบหักฯ dialog shell — domain dialogs pass title/description + panel children. */
export function PayrollWhtSingleDialog({
  title,
  description,
  disabled,
  disabledTitle,
  children,
}: {
  title: string;
  description: ReactNode;
  disabled?: boolean;
  disabledTitle?: string;
  children: (open: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1 whitespace-nowrap"
          disabled={disabled}
          title={disabledTitle}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          ใบหักฯ
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto w-[calc(100vw-1rem)] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children(open)}
      </DialogContent>
    </Dialog>
  );
}
