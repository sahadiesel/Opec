'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { FileText, Waves } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFirestore } from '@/firebase';
import { waveRoundMonthLabel } from '@/lib/constants/timesheet-ui';
import {
  isWaveMonthAttachmentPdf,
  listDaysInMonth,
  timesheetCellSummary,
  timesheetEventCellBadgeClasses,
} from '@/lib/timesheet/wave-month-utils';
import {
  formatCustomerPoNumberForPortal,
  workerDisplayName,
  workerPositionIdForRoster,
} from '@/lib/client-portal/timesheet-portal-utils';
import type { PortalDictKey } from '@/lib/i18n/client-portal-dictionary';
import type {
  Assignment,
  DailyTimesheet,
  Position,
  PurchaseOrder,
  Wave,
  WaveMonthTimesheetPhotoAttachment,
  WaveMonthTimesheetPhotoBundle,
  WaveMonthTimesheetReview,
} from '@/lib/types';
import { cn } from '@/lib/utils';

export function PortalWaveMonthReadonlyCard({
  wave,
  po,
  monthYm,
  monthReview,
  reviewBadge,
  bundle,
  waveAssignments,
  waveSheets,
  hideAttachmentSection = false,
  t,
}: {
  wave: Wave;
  po?: PurchaseOrder | null;
  monthYm: string;
  /** When absent, attachments/grid still use bundle + timesheets */
  monthReview?: WaveMonthTimesheetReview | null;
  reviewBadge: 'manager' | 'billing';
  bundle?: WaveMonthTimesheetPhotoBundle | null;
  waveAssignments: Assignment[];
  waveSheets: DailyTimesheet[];
  /** When true, hide the photo/PDF block (e.g. PO+month page shows one shared bundle above). */
  hideAttachmentSection?: boolean;
  t: (k: PortalDictKey) => string;
}) {
  const firestore = useFirestore();
  const [positionLabels, setPositionLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!firestore) return;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDocs(query(collection(firestore, 'positions'), limit(500)));
        if (cancelled) return;
        const m: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const x = d.data() as Position;
          m[d.id] = (x.positionName || x.positionCode || d.id).trim();
        });
        setPositionLabels(m);
      } catch {
        /* ลูกค้าอาจอ่าน positions ไม่ได้ — ยังแสดง positionId ตัวอักษรได้ */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore]);

  const byWorkerDate = new Map<string, DailyTimesheet>();
  for (const row of waveSheets) {
    byWorkerDate.set(`${row.workerId}|${row.date}`, row);
  }

  const rowTotals = new Map<string, number>();
  for (const row of waveSheets) {
    rowTotals.set(row.workerId, (rowTotals.get(row.workerId) ?? 0) + (row.normalHours ?? 0));
  }

  const rosterWorkers = [...new Set(waveAssignments.map((x) => x.workerId).filter(Boolean))]
    .map((wid) => {
      const mob = waveAssignments.find((m) => m.workerId === wid);
      const positionId = workerPositionIdForRoster(wid, mob, waveSheets);
      return {
        workerId: wid,
        name: workerDisplayName(wid, mob, waveSheets),
        positionId,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));

  const snap = monthReview?.timesheetPhotoAttachments;
  const fromBundle = bundle?.attachments ?? [];
  const displayPhotos: WaveMonthTimesheetPhotoAttachment[] =
    snap && snap.length > 0 ? snap : fromBundle;

  const poLabel = formatCustomerPoNumberForPortal(po ?? undefined, po?.id ?? wave.poId);
  const days = listDaysInMonth(monthYm);

  const summaryText = t('tsMonthlySummary')
    .replace('{month}', monthYm)
    .replace('{people}', String(rosterWorkers.length))
    .replace('{rows}', String(waveSheets.length));

  return (
    <Card className="overflow-hidden scroll-mt-4">
      <CardHeader className="border-b bg-muted/30 py-4 space-y-3">
        <div className="space-y-1 min-w-0">
          <CardTitle className="text-base flex flex-wrap items-center gap-x-2 gap-y-1">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-mono">{poLabel}</span>
            <Waves className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-mono">{wave.waveCode}</span>
            <Badge variant="secondary" className="text-[10px] font-normal">
              {wave.status}
            </Badge>
            {reviewBadge === 'manager' ? (
              <Badge variant="outline" className="text-[10px] font-normal border-emerald-600/50 text-emerald-800">
                {t('tsHubApprovedBadge')}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] font-normal border-sky-600/50 text-sky-900">
                {t('tsHubBillingBadge')}
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            {waveRoundMonthLabel(wave)} · {wave.siteLocation || t('noData')}
          </CardDescription>
        </div>

        {!hideAttachmentSection ? (
        <div className="flex flex-col gap-2 pt-3 border-t border-dashed border-muted-foreground/30 w-full">
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
        ) : null}

        <p className="text-sm text-muted-foreground">{summaryText}</p>
        {monthReview?.periodEndDate ? (
          <p className="text-xs text-muted-foreground">
            {t('tsMonthlyClosingPeriod')}: {monthReview.periodStartDate ?? `${monthYm}-01`} – {monthReview.periodEndDate}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        {rosterWorkers.length === 0 ? (
          <p className="text-center text-muted-foreground py-10 px-4 text-sm">{t('tsMonthlyNoRoster')}</p>
        ) : (
          <>
            <Table className="min-w-max text-xs">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="sticky left-0 z-20 min-w-[160px] max-w-[220px] bg-muted/95 font-bold shadow-[2px_0_4px_rgba(0,0,0,0.06)]">
                    {t('tsColWorker')}
                  </TableHead>
                  {days.map((d) => (
                    <TableHead key={d} className="px-1 text-center w-10 font-mono" title={d}>
                      {d.slice(8, 10)}
                    </TableHead>
                  ))}
                  <TableHead className="text-center font-bold min-w-[56px]">{t('tsMonthlyTotalCol')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rosterWorkers.map((rw) => {
                  const posText =
                    rw.positionId && (positionLabels[rw.positionId] || rw.positionId).trim();
                  return (
                  <TableRow key={rw.workerId}>
                    <TableCell className="sticky left-0 z-10 bg-background text-xs shadow-[2px_0_4px_rgba(0,0,0,0.06)] min-w-[160px] max-w-[220px]">
                      <div className="flex flex-col gap-0.5 pr-1">
                        <span className="font-medium leading-snug">{rw.name}</span>
                        {posText ? (
                          <span
                            className="text-[10px] font-normal text-muted-foreground leading-tight line-clamp-2"
                            title={posText}
                          >
                            {posText}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    {days.map((d) => {
                      const ts = byWorkerDate.get(`${rw.workerId}|${d}`);
                      const cell = timesheetCellSummary(ts);
                      return (
                        <TableCell key={d} className="px-0.5 text-center font-mono text-[10px]">
                          {ts ? (
                            <span className="inline-flex max-w-full justify-center">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'h-7 min-w-[2.5rem] px-1 font-mono text-[10px] leading-tight',
                                  timesheetEventCellBadgeClasses(ts.eventType, ts.status),
                                )}
                              >
                                {cell || '—'}
                              </Badge>
                            </span>
                          ) : (
                            <span className="tabular-nums min-h-[28px] min-w-[28px] inline-block text-muted-foreground/40">
                              ·
                            </span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center font-bold text-sm">{rowTotals.get(rw.workerId) ?? 0}</TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="border-t px-4 py-3 text-xs text-muted-foreground">
              <p>{t('tsMonthlyKey')}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
