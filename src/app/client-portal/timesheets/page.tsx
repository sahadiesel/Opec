'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  FileText,
  Search,
  Filter,
  Calendar,
  ChevronRight,
  FileCheck,
  MessageSquareWarning,
  Loader2,
  Lock,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { DailyTimesheet, DailyTimesheetStatus } from '@/lib/types';
import type { PortalDictKey } from '@/lib/i18n/client-portal-dictionary';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { CustomerQueryService } from '@/lib/services/customer-query-service';
import { DisputeService } from '@/lib/services/dispute-service';
import { ExceptionRequestService } from '@/lib/services/exception-request-service';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { usePortalLocale } from '@/contexts/portal-locale-context';
import { useAppUser } from '@/hooks/use-app-user';

/** Shown in portal after operational review — filter client-side so query only needs index customerId + date. */
const PORTAL_TIMESHEET_STATUSES: DailyTimesheetStatus[] = [
  'CLIENT_APPROVED',
  'VERIFIED_PAPER',
  'LOCKED',
  'OPS_REVIEWED',
  'HR_APPROVED',
  'SUBMITTED',
];

function eventTypeLabel(t: (k: PortalDictKey) => string, eventType: string): string {
  const map: Record<string, PortalDictKey> = {
    work_day: 'evWork',
    travel_day: 'evTravel',
    standby_day: 'evStandby',
    off_day_worked: 'evOffWorked',
  };
  const key = map[eventType];
  return key ? t(key) : eventType;
}

export default function ClientTimesheetViewPage() {
  const { currentUser, isLoading: userLoading } = useAppUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { t } = usePortalLocale();

  const [searchTerm, setSearchTerm] = useState('');
  const [isDisputeOpen, setIsDisputeOpen] = useState(false);
  const [isExceptionOpen, setIsExceptionOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedTs, setSelectedTs] = useState<DailyTimesheet | null>(null);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const tsQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser) return null;
    const service = new CustomerQueryService(firestore);
    return service.getScopedTimesheetsQuery(currentUser);
  }, [firestore, currentUser]);

  const { data: timesheetsRaw, isLoading: isTsLoading, error: tsError } =
    useCollection<DailyTimesheet>(tsQuery as any);

  const timesheets = useMemo(() => {
    if (!timesheetsRaw) return null;
    return timesheetsRaw.filter((ts) => PORTAL_TIMESHEET_STATUSES.includes(ts.status));
  }, [timesheetsRaw]);

  const filteredTimesheets = useMemo(() => {
    if (!timesheets) return [];
    const q = searchTerm.trim().toLowerCase();
    if (!q) return timesheets;
    return timesheets.filter((ts) => {
      const name = (ts.workerNameSnapshot || '').toLowerCase();
      const slip = (ts.sourceDocumentNo || '').toLowerCase();
      const date = (ts.date || '').toLowerCase();
      return name.includes(q) || slip.includes(q) || date.includes(q);
    });
  }, [timesheets, searchTerm]);

  const handleReportIssue = async () => {
    if (!selectedTs || !comment || !firestore || !currentUser) return;
    setIsSubmitting(true);
    try {
      const service = new DisputeService(firestore);
      await service.reportIssue(
        {
          category: 'TIMESHEET',
          referenceId: selectedTs.id,
          referenceNo: selectedTs.sourceDocumentNo || `TS-${selectedTs.date}`,
          description: comment,
        },
        currentUser
      );
      toast({
        title: t('tsToastDispute'),
        description: t('tsToastDisputeDesc'),
      });
      setIsDisputeOpen(false);
      setComment('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestException = async () => {
    if (!selectedTs || !comment || !firestore || !currentUser) return;
    setIsSubmitting(true);
    try {
      const service = new ExceptionRequestService(firestore);
      await service.createRequest({
        type: 'TIMESHEET_CORRECTION',
        referenceId: selectedTs.id,
        referenceNo: selectedTs.sourceDocumentNo || `TS-${selectedTs.date}`,
        reason: comment,
        user: currentUser,
      });
      toast({
        title: t('tsToastExc'),
        description: t('tsToastExcDesc'),
      });
      setIsExceptionOpen(false);
      setComment('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDetail = (row: DailyTimesheet) => {
    setSelectedTs(row);
    setIsDetailOpen(true);
  };

  if (userLoading) {
    return <p className="text-sm text-muted-foreground">{t('tsLoading')}</p>;
  }

  if (!currentUser) {
    return null;
  }

  if (tsError) {
    return (
      <p className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        {tsError.message || String(tsError)}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-primary sm:text-2xl">
          <FileText className="h-7 w-7 shrink-0" />
          {t('tsTitle')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('tsSubtitle')}</p>
      </div>

      <Card className="border-primary/15 bg-primary/[0.03]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{t('tsPolicyTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• {t('tsPolicy1')}</p>
          <p>• {t('tsPolicy2')}</p>
          <p>• {t('tsPolicy3')}</p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('tsSearchPlaceholder')}
            className="h-10 pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button variant="outline" className="h-10 shrink-0 gap-2" type="button" disabled>
          <Filter className="h-4 w-4" />
          {t('tsFilter')}
        </Button>
      </div>

      <Card className="overflow-hidden border-zinc-200 shadow-sm">
        <CardHeader className="border-b bg-muted/30 py-4">
          <CardTitle className="text-base">{t('tsActivityTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isTsLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">{t('tsLoading')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('tsColDate')}</TableHead>
                  <TableHead>{t('tsColWorker')}</TableHead>
                  <TableHead>{t('tsColSlip')}</TableHead>
                  <TableHead>{t('tsColEvent')}</TableHead>
                  <TableHead className="text-center">{t('tsColHours')}</TableHead>
                  <TableHead className="text-right">{t('tsColStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTimesheets.map((ts) => {
                  const isLocked = ts.status === 'LOCKED' || ts.status === 'HR_APPROVED';
                  return (
                    <TableRow
                      key={ts.id}
                      className={`cursor-pointer transition-colors ${isLocked ? 'bg-muted/30' : 'hover:bg-muted/40'}`}
                      onClick={() => openDetail(ts)}
                    >
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                          {ts.date}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{ts.workerNameSnapshot}</p>
                          <p className="text-[10px] uppercase text-muted-foreground">{ts.positionId}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {ts.sourceDocumentNo ? (
                          <span className="font-mono text-xs font-medium text-primary">{ts.sourceDocumentNo}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {eventTypeLabel(t, ts.eventType)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-sm font-semibold">{ts.normalHours}h</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isLocked && <Lock className="h-3.5 w-3.5 text-amber-600" aria-hidden />}
                          <Badge
                            variant={ts.status === 'VERIFIED_PAPER' ? 'default' : 'outline'}
                            className="text-[10px] uppercase"
                          >
                            {ts.status === 'VERIFIED_PAPER' ? 'VERIFIED' : ts.status}
                          </Badge>
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-40" />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredTimesheets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                      {t('tsNoRows')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl border-t-4 border-t-primary">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <FileCheck className="h-5 w-5 text-primary" />
              {t('tsDetailTitle')}
            </DialogTitle>
            <DialogDescription>{t('tsReadOnly')}</DialogDescription>
          </DialogHeader>

          {selectedTs && (
            <div className="space-y-4 py-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">{t('tsColWorker')}</Label>
                  <p className="font-semibold text-primary">{selectedTs.workerNameSnapshot}</p>
                  <p className="text-xs uppercase text-muted-foreground">{selectedTs.positionId}</p>
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">{t('tsColDate')}</Label>
                  <p className="flex items-center gap-2 font-medium">
                    <Calendar className="h-4 w-4" />
                    {selectedTs.date}
                  </p>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">{t('tsColEvent')}</p>
                  <Badge variant="secondary" className="text-[10px]">
                    {eventTypeLabel(t, selectedTs.eventType)}
                  </Badge>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">{t('tsColHours')}</p>
                  <p className="text-lg font-bold text-primary">{selectedTs.normalHours}h</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">{t('tsColStatus')}</p>
                  <Badge className="bg-green-600 text-[10px] uppercase">{selectedTs.status}</Badge>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-primary/10 bg-primary/5 p-4">
                <h4 className="flex items-center gap-2 text-xs font-semibold uppercase text-primary">
                  <ShieldCheck className="h-4 w-4" />
                  {t('tsEvidenceSection')}
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-[10px] font-medium uppercase text-muted-foreground">{t('tsColSlip')}</span>
                    <p className="font-mono font-medium text-primary">{selectedTs.sourceDocumentNo || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium uppercase text-muted-foreground">{t('tsSourceLabel')}</span>
                    <p className="font-medium">{selectedTs.sourceType || 'PAPER'}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {selectedTs.status === 'LOCKED' || selectedTs.status === 'HR_APPROVED' ? (
                  <Button
                    variant="outline"
                    className="flex-1 border-amber-200 text-amber-800 hover:bg-amber-50"
                    onClick={() => {
                      setIsDetailOpen(false);
                      setIsExceptionOpen(true);
                    }}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {t('tsSpecialCorrection')}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setIsDetailOpen(false);
                      setIsDisputeOpen(true);
                    }}
                  >
                    <MessageSquareWarning className="mr-2 h-4 w-4" />
                    {t('tsReportIssue')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isDisputeOpen} onOpenChange={setIsDisputeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tsDisputeTitle')}</DialogTitle>
            <DialogDescription>{t('tsDisputeDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {selectedTs && (
              <div className="space-y-1 rounded-lg bg-muted p-3 text-xs">
                <p>
                  <b>{t('tsColWorker')}:</b> {selectedTs.workerNameSnapshot}
                </p>
                <p>
                  <b>{t('tsColDate')}:</b> {selectedTs.date}
                </p>
                <p>
                  <b>{t('tsColSlip')}:</b> {selectedTs.sourceDocumentNo || '—'}
                </p>
              </div>
            )}
            <Textarea
              placeholder={t('tsDisputeDesc')}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDisputeOpen(false)} disabled={isSubmitting}>
              {t('tsCancel')}
            </Button>
            <Button onClick={() => void handleReportIssue()} disabled={isSubmitting || !comment}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('tsSubmitQuery')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isExceptionOpen} onOpenChange={setIsExceptionOpen}>
        <DialogContent className="border-t-4 border-t-amber-500">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-amber-600" />
              {t('tsExceptionTitle')}
            </DialogTitle>
            <DialogDescription>{t('tsExceptionDesc')}</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={t('tsExceptionDesc')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsExceptionOpen(false)} disabled={isSubmitting}>
              {t('tsCancel')}
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => void handleRequestException()}
              disabled={isSubmitting || !comment}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('tsSubmitHr')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
