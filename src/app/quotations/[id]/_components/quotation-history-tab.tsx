'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { History } from 'lucide-react';
import type { Quotation } from '@/lib/types';
import { formatDateTimeThaiBE } from '@/lib/date-thai';

interface QuotationHistoryTabProps {
  quotation: Quotation;
}

export function QuotationHistoryTab({ quotation }: QuotationHistoryTabProps) {
  return (
    <Card className="shadow-sm border-none bg-white">
      <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" /> ประวัติกิจกรรม (Audit Log)</CardTitle></CardHeader>
      <CardContent className="space-y-6 py-10">
        <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative pb-4">
          <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-primary" />
          <div className="text-sm">
            <p className="font-bold uppercase text-primary">LATEST STATUS: {quotation.status.toUpperCase()}</p>
            <p className="text-xs text-muted-foreground">{formatDateTimeThaiBE(quotation.updatedAt)}</p>
            <p className="text-xs mt-1 font-medium">Edited by {quotation.updatedBy || 'System'}</p>
          </div>
        </div>
        <div className="flex gap-4 border-l-2 border-primary/20 pl-4 relative">
          <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-slate-300" />
          <div className="text-sm">
            <p className="font-bold uppercase text-muted-foreground">DOCUMENT CREATED</p>
            <p className="text-xs text-muted-foreground">{formatDateTimeThaiBE(quotation.createdAt)}</p>
            <p className="text-xs mt-1 font-medium">Initiated by {quotation.createdBy}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
