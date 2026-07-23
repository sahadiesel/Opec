'use client';

import { useMemo } from 'react';
import { doc } from 'firebase/firestore';
import { FileText, Loader2 } from 'lucide-react';
import { PortalWaveMonthReadonlyCard } from '@/components/client-portal/portal-wave-month-readonly-card';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { isWaveMonthAttachmentPdf } from '@/lib/timesheet/wave-month-utils';
import {
  formatCustomerPoNumberForPortal,
  formatYearMonthLabel,
} from '@/lib/client-portal/timesheet-portal-utils';
import type { PortalDictKey } from '@/lib/i18n/client-portal-dictionary';
import type { Assignment, DailyTimesheet, PoMonthTimesheetReview, PoMonthTimesheetPhotoBundle, PurchaseOrder, Wave } from '@/lib/types';
import { PortalCustomerApprovalStatusBadge } from '@/components/client-portal/portal-month-customer-actions';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import type { PortalLocale } from '@/lib/i18n/client-portal-dictionary';

export function PortalPoMonthDocHeaderCard({
  po,
  yearMonth,
  monthReview,
  bundle,
  locale,
  t,
}: {
  po: PurchaseOrder | null | undefined;
  yearMonth: string;
  monthReview: PoMonthTimesheetReview;
  bundle?: PoMonthTimesheetPhotoBundle | null;
  locale: PortalLocale;
  t: (k: PortalDictKey) => string;
}) {
  const snap = monthReview.timesheetPhotoAttachments;
  const fromBundle = bundle?.attachments ?? [];
  const displayPhotos = snap && snap.length > 0 ? snap : fromBundle;
  const poLabel = formatCustomerPoNumberForPortal(po, monthReview.poId);
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/30 space-y-3">
        <div className="space-y-1 min-w-0">
          <CardTitle className="text-base flex flex-wrap items-center gap-x-2 gap-y-1">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-mono">{poLabel}</span>
            <span className="font-mono text-primary">
              {formatYearMonthLabel(yearMonth, locale)}
            </span>
            {monthReview.status === 'approved' ? (
              <Badge variant="outline" className="text-[10px] font-normal border-emerald-600/50 text-emerald-800">
                {t('tsHubApprovedBadge')}
              </Badge>
            ) : null}
            <PortalCustomerApprovalStatusBadge
              customerApprovalStatus={monthReview.customerApprovalStatus}
              managerApproved={monthReview.status === 'approved'}
            />
          </CardTitle>
        </div>
        <div className="flex flex-col gap-2 pt-1 border-t border-dashed border-muted-foreground/30 w-full">
          <p className="text-xs font-medium text-muted-foreground">{t('tsMonthlyAttachments')}</p>
          {displayPhotos.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {displayPhotos.map((att) => (
                <div key={att.id}>
                  {isWaveMonthAttachmentPdf(att) ? (
                    <a
                      href={att.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded border bg-muted/50 text-[9px] text-muted-foreground hover:bg-muted"
                    >
                      <FileText className="h-6 w-6 shrink-0 text-primary" />
                      <span className="line-clamp-2 px-0.5 text-center leading-tight">PDF</span>
                    </a>
                  ) : (
                    <a href={att.downloadUrl} target="_blank" rel="noopener noreferrer" className="block">
                      <img
                        src={att.downloadUrl}
                        alt={att.fileName}
                        className="h-16 w-16 rounded border object-cover"
                      />
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('tsMonthlyNoAttach')}</p>
          )}
        </div>
        {monthReview.periodEndDate ? (
          <p className="text-xs text-muted-foreground">
            {t('tsMonthlyClosingPeriod')}: {monthReview.periodStartDate ?? `${yearMonth}-01`} – {monthReview.periodEndDate}
          </p>
        ) : null}
      </CardHeader>
    </Card>
  );
}

export function PortalPoMonthWaveBlock({
  waveId,
  po,
  yearMonth,
  poMonthDailySheets,
  t,
}: {
  waveId: string;
  po: PurchaseOrder | null | undefined;
  yearMonth: string;
  poMonthDailySheets: DailyTimesheet[];
  t: (k: PortalDictKey) => string;
}) {
  const firestore = useFirestore();
  const { effectiveUser: currentUser } = useClientPortalIdentity();
  const waveRef = useMemo(
    () => (firestore && waveId ? doc(firestore, 'waves', waveId) : null),
    [firestore, waveId],
  );
  const { data: wave, isLoading: waveLoading } = useDoc<Wave>(waveRef as any);
  const queryService = useMemo(
    () => (firestore ? new CustomerQueryService(firestore) : null),
    [firestore],
  );
  const asgnQuery = useMemoFirebase(
    () => queryService?.getScopedAssignmentsQuery(currentUser),
    [queryService, currentUser],
  );
  const { data: allAssignments, isLoading: mLoading } = useCollection<Assignment>(asgnQuery as any);
  const waveAssignments = useMemo(
    () => (allAssignments ?? []).filter((a) => a.waveId === waveId),
    [allAssignments, waveId],
  );

  if (waveLoading || mLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('tsMonthlyLoading')}
      </div>
    );
  }
  if (!wave || wave.customerId !== currentUser?.customerId) {
    return null;
  }

  return (
    <PortalWaveMonthReadonlyCard
      wave={wave}
      po={po}
      monthYm={yearMonth}
      monthReview={null}
      reviewBadge="manager"
      bundle={null}
      hideAttachmentSection
      waveAssignments={waveAssignments}
      poMonthDailySheets={poMonthDailySheets}
      t={t}
    />
  );
}

export function resolveWaveIdsForPoMonth(
  review: PoMonthTimesheetReview | null,
  waves: Wave[] | null | undefined,
  poId: string,
): string[] {
  const fromReview = (review?.relatedWaveIds ?? []).map((x) => x?.trim()).filter(Boolean) as string[];
  if (fromReview.length > 0) {
    return [...new Set(fromReview)];
  }
  return [...new Set((waves ?? []).filter((w) => w.poId === poId).map((w) => w.id))].sort();
}
