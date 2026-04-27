'use client';

import { useRef, type ReactNode } from 'react';
import type { PayslipViewModel } from '@/lib/payroll/payslip-model';
import { PayslipDocument } from '@/components/payroll/payslip-document';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Printer, Receipt } from 'lucide-react';

export function PayslipDialog({
  model,
  trigger,
  title = 'สลิปเงินเดือน',
}: {
  model: PayslipViewModel;
  trigger?: ReactNode;
  title?: string;
}) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=900,height=1200');
    if (!w) return;
    const node = printRef.current;
    if (!node) return;
    w.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Payslip</title>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap" rel="stylesheet"/>
      <style>
        body { font-family: "Sarabun", system-ui, sans-serif; margin: 16px; color: #111827; background: #fff; }
        @media print { body { margin: 0; } }
      </style>
      </head><body>${node.innerHTML}</body></html>`,
    );
    w.document.close();

    const runPrint = () => {
      w.focus();
      w.print();
      w.close();
    };

    const whenImagesReady = (doc: Document) => {
      const imgs = Array.from(doc.getElementsByTagName('img'));
      return Promise.all(
        imgs.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) {
                resolve();
                return;
              }
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            }),
        ),
      );
    };

    void (async () => {
      if (w.document.readyState === 'loading') {
        await new Promise<void>((r) => w.addEventListener('load', () => r(), { once: true }));
      }
      await whenImagesReady(w.document);
      requestAnimationFrame(() => {
        runPrint();
      });
    })();
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm" className="gap-1">
            <Receipt className="h-3.5 w-3.5" /> สลิป
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>ข้อมูลจาก Payroll Line (snapshot)</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 print:hidden">
          <Button type="button" variant="secondary" size="sm" className="gap-1" onClick={handlePrint}>
            <Printer className="h-3.5 w-3.5" /> พิมพ์ / บันทึก PDF
          </Button>
        </div>
        <div ref={printRef}>
          <PayslipDocument model={model} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
