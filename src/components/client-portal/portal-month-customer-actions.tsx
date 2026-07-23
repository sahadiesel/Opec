'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, MessageSquareWarning } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
import { useToast } from '@/hooks/use-toast';
import { useFirestore } from '@/firebase';
import { useClientPortalIdentity } from '@/contexts/client-portal-user-context';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import type { PortalDictKey } from '@/lib/i18n/client-portal-dictionary';
import {
  customerApprovePoMonthReview,
  customerApproveWaveMonthReview,
  customerRequestCorrectionPoMonthReview,
  customerRequestCorrectionWaveMonthReview,
} from '@/lib/services/portal-month-timesheet-approval-service';
import type {
  PoMonthTimesheetReview,
  PortalCustomerTimesheetApprovalStatus,
  User,
  WaveMonthTimesheetReview,
} from '@/lib/types';

export function portalCustomerApprovalBadgeKey(
  status: PortalCustomerTimesheetApprovalStatus | undefined,
  managerApproved: boolean,
): PortalDictKey {
  if (status === 'approved') return 'tsCustomerApprovedBadge';
  if (status === 'correction_requested') return 'tsCustomerCorrectionRequestedBadge';
  if (managerApproved) return 'tsCustomerAwaitingApprovalBadge';
  return 'tsHubInProgressBadge';
}

export function PortalCustomerApprovalStatusBadge({
  customerApprovalStatus,
  managerApproved,
}: {
  customerApprovalStatus?: PortalCustomerTimesheetApprovalStatus;
  managerApproved: boolean;
}) {
  const { t } = usePortalLocale();
  const key = portalCustomerApprovalBadgeKey(customerApprovalStatus, managerApproved);
  if (key === 'tsCustomerApprovedBadge') {
    return (
      <Badge variant="outline" className="text-[10px] border-emerald-600/50 text-emerald-800">
        {t(key)}
      </Badge>
    );
  }
  if (key === 'tsCustomerCorrectionRequestedBadge') {
    return (
      <Badge variant="outline" className="text-[10px] border-amber-600/50 text-amber-900">
        {t(key)}
      </Badge>
    );
  }
  if (key === 'tsCustomerAwaitingApprovalBadge') {
    return (
      <Badge variant="outline" className="text-[10px] border-sky-600/50 text-sky-900">
        {t(key)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      {t(key)}
    </Badge>
  );
}

type Scope =
  | { kind: 'po'; review: PoMonthTimesheetReview; onUpdated: (next: PoMonthTimesheetReview) => void }
  | { kind: 'wave'; review: WaveMonthTimesheetReview; onUpdated: (next: WaveMonthTimesheetReview) => void };

export function PortalMonthCustomerActions(props: Scope) {
  const { review } = props;
  const firestore = useFirestore();
  const { effectiveUser: currentUser } = useClientPortalIdentity();
  const { t } = usePortalLocale();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeText, setDisputeText] = useState('');

  const isApprover = currentUser?.portalRole !== 'viewer';
  const managerApproved = review.status === 'approved';
  const customerDone = review.customerApprovalStatus === 'approved';
  const showActions = managerApproved && !customerDone;

  if (!managerApproved) {
    return (
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        {t('tsCustomerReadonlyUntilReleased')}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.03] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <PortalCustomerApprovalStatusBadge
          customerApprovalStatus={review.customerApprovalStatus}
          managerApproved
        />
        <span className="text-xs text-muted-foreground">{t('tsReadOnly')}</span>
      </div>

      {customerDone ? (
        <p className="text-sm text-emerald-800">{t('tsCustomerApprovedLead')}</p>
      ) : review.customerApprovalStatus === 'correction_requested' ? (
        <p className="text-sm text-amber-900">
          {t('tsCustomerCorrectionRequestedLead')}
          {review.customerRevisionRequestNote
            ? ` — ${review.customerRevisionRequestNote}`
            : ''}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t('tsCustomerAwaitingApprovalLead')}</p>
      )}

      {showActions && !isApprover ? (
        <p className="text-sm text-muted-foreground">{t('tsCustomerApproverOnly')}</p>
      ) : null}

      {showActions && isApprover ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={busy || !firestore || !currentUser}
            onClick={() => {
              if (!firestore || !currentUser) return;
              setBusy(true);
              void (async () => {
                try {
                  if (props.kind === 'po') {
                    await customerApprovePoMonthReview(firestore, props.review, currentUser as User);
                    props.onUpdated({
                      ...props.review,
                      customerApprovalStatus: 'approved',
                      customerApprovedAt: Date.now(),
                      customerApprovedByUid: currentUser.id,
                      customerApprovedByName:
                        currentUser.displayName || currentUser.email || currentUser.id,
                      customerApprovalSource: 'CLIENT_PORTAL',
                    });
                  } else {
                    await customerApproveWaveMonthReview(firestore, props.review, currentUser as User);
                    props.onUpdated({
                      ...props.review,
                      customerApprovalStatus: 'approved',
                      customerApprovedAt: Date.now(),
                      customerApprovedByUid: currentUser.id,
                      customerApprovedByName:
                        currentUser.displayName || currentUser.email || currentUser.id,
                      customerApprovalSource: 'CLIENT_PORTAL',
                    });
                  }
                  toast({
                    title: t('tsToastCustomerApproved'),
                    description: t('tsToastCustomerApprovedDesc'),
                  });
                } catch (e: unknown) {
                  toast({
                    variant: 'destructive',
                    title: 'Error',
                    description: e instanceof Error ? e.message : String(e),
                  });
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t('tsApproveTimesheet')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy || !firestore || !currentUser}
            onClick={() => setDisputeOpen(true)}
          >
            <MessageSquareWarning className="h-4 w-4" />
            {t('tsRequestCorrection')}
          </Button>
        </div>
      ) : null}

      <Dialog open={disputeOpen} onOpenChange={setDisputeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tsRequestCorrection')}</DialogTitle>
            <DialogDescription>{t('tsRequestCorrectionLead')}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={disputeText}
            onChange={(e) => setDisputeText(e.target.value)}
            rows={4}
            placeholder={t('tsDisputeDesc')}
          />
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setDisputeOpen(false)}>
              {t('tsCancel')}
            </Button>
            <Button
              type="button"
              disabled={busy || !disputeText.trim() || !firestore || !currentUser}
              onClick={() => {
                if (!firestore || !currentUser) return;
                setBusy(true);
                void (async () => {
                  try {
                    if (props.kind === 'po') {
                      await customerRequestCorrectionPoMonthReview(
                        firestore,
                        props.review,
                        currentUser as User,
                        disputeText,
                      );
                      props.onUpdated({
                        ...props.review,
                        customerApprovalStatus: 'correction_requested',
                        customerRevisionRequestedAt: Date.now(),
                        customerRevisionRequestNote: disputeText.trim(),
                      });
                    } else {
                      await customerRequestCorrectionWaveMonthReview(
                        firestore,
                        props.review,
                        currentUser as User,
                        disputeText,
                      );
                      props.onUpdated({
                        ...props.review,
                        customerApprovalStatus: 'correction_requested',
                        customerRevisionRequestedAt: Date.now(),
                        customerRevisionRequestNote: disputeText.trim(),
                      });
                    }
                    toast({
                      title: t('tsToastDispute'),
                      description: t('tsToastDisputeDesc'),
                    });
                    setDisputeOpen(false);
                    setDisputeText('');
                  } catch (e: unknown) {
                    toast({
                      variant: 'destructive',
                      title: 'Error',
                      description: e instanceof Error ? e.message : String(e),
                    });
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('tsSubmitQuery')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
