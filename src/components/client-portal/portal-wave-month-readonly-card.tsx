'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
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
  mobilizationsEligibleForWaveMonthGrid,
  resolveTimesheetForWaveMonthCell,
  sumWorkHoursForWaveMonthRow,
  timesheetWaveMonthCellDisplay,
  timesheetEventCellBadgeClasses,
} from '@/lib/timesheet/wave-month-utils';
import { poTimesheetScopeId } from '@/lib/constants/timesheet-po-scope';
import {
  buildPortalPoMonthRosterAssignments,
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
  poMonthDailySheets,
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
  /** ทุกแถว `daily_timesheets` ในเดือนที่มี `purchaseOrderId` = PO นี้ — รองรับ `waveId` = PO scope เหมือนหน้า wave-month ภายใน */
  poMonthDailySheets: DailyTimesheet[];
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

  const days = listDaysInMonth(monthYm);

  const sheetsByWaveWorker = useMemo(() => {
    const m = new Map<string, DailyTimesheet[]>();
    for (const t of poMonthDailySheets) {
      const k = `${t.waveId}|${t.workerId}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [poMonthDailySheets]);

  const rawPoId = (po?.id ?? wave.poId ?? '').trim();
  const poScopeWaveId = poTimesheetScopeId(rawPoId || wave.poId);

  const rosterAssignments = useMemo(
    () => mobilizationsEligibleForWaveMonthGrid(waveAssignments, monthYm, poMonthDailySheets),
    [waveAssignments, monthYm, poMonthDailySheets],
  );

  const rosterRows = useMemo(() => {
    return rosterAssignments
      .map((asgn) => {
        const wid = asgn.workerId;
        return {
          workerId: wid,
          name: workerDisplayName(wid, asgn, poMonthDailySheets),
          positionId: workerPositionIdForRoster(wid, asgn, poMonthDailySheets),
          rosterAssignment: asgn,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [rosterAssignments, poMonthDailySheets]);

  const rowWorkTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const rw of rosterRows) {
      const alternateMobIds = waveAssignments
        .filter((x) => x.workerId === rw.workerId && x.id !== rw.rosterAssignment.id)
        .map((x) => x.id);
      m.set(
        `${rw.workerId}|${rw.rosterAssignment.id}`,
        sumWorkHoursForWaveMonthRow(
          rw.rosterAssignment,
          wave.id,
          rw.workerId,
          rw.rosterAssignment.id,
          days,
          sheetsByWaveWorker,
          poMonthDailySheets,
          poScopeWaveId,
          alternateMobIds,
          { onlyWithinMobWindow: true },
        ),
      );
    }
    return m;
  }, [
    rosterRows,
    waveAssignments,
    wave.id,
    days,
    sheetsByWaveWorker,
    poMonthDailySheets,
    poScopeWaveId,
  ]);

  const waveSheetRowCount = useMemo(() => {
    const rosterIds = new Set(rosterRows.map((r) => r.workerId));
    return poMonthDailySheets.filter(
      (t) =>
        rosterIds.has(t.workerId) &&
        (t.waveId === wave.id ||
          t.waveId === poScopeWaveId ||
          waveAssignments.some((a) => a.id === t.assignmentId)),
    ).length;
  }, [poMonthDailySheets, rosterRows, wave.id, poScopeWaveId, waveAssignments]);

  const snap = monthReview?.timesheetPhotoAttachments;
  const fromBundle = bundle?.attachments ?? [];
  const displayPhotos: WaveMonthTimesheetPhotoAttachment[] =
    snap && snap.length > 0 ? snap : fromBundle;

  const poLabel = formatCustomerPoNumberForPortal(po ?? undefined, po?.id ?? wave.poId);

  const summaryText = t('tsMonthlySummary')
    .replace('{month}', monthYm)
    .replace('{people}', String(rosterRows.length))
    .replace('{rows}', String(waveSheetRowCount));

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
        {rosterRows.length === 0 ? (
          <p className="text-center text-muted-foreground py-10 px-4 text-sm">{t('tsMonthlyNoRoster')}</p>
        ) : (
          <>
            <Table className="min-w-max text-xs [&_th]:h-auto [&_th]:min-h-0 [&_th]:py-1 [&_th]:px-1.5 [&_td]:p-1 [&_td]:py-0.5">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="sticky left-0 z-20 w-[9rem] min-w-[7.5rem] max-w-[10rem] bg-muted/95 font-bold shadow-[2px_0_4px_rgba(0,0,0,0.06)] px-2">
                    {t('tsColWorker')}
                  </TableHead>
                  {days.map((d) => (
                    <TableHead key={d} className="px-0.5 text-center w-7 min-w-[1.75rem] font-mono text-[10px]" title={d}>
                      {d.slice(8, 10)}
                    </TableHead>
                  ))}
                  <TableHead className="text-center font-bold min-w-[5.75rem] w-[5.75rem] shrink-0 px-2 text-[10px] leading-tight">
                    {t('tsMonthlyTotalCol')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rosterRows.map((rw) => {
                  const posText =
                    rw.positionId && (positionLabels[rw.positionId] || rw.positionId).trim();
                  const alternateMobIds = waveAssignments
                    .filter((x) => x.workerId === rw.workerId && x.id !== rw.rosterAssignment.id)
                    .map((x) => x.id);
                  const totalH =
                    rowWorkTotals.get(`${rw.workerId}|${rw.rosterAssignment.id}`) ?? 0;
                  return (
                  <TableRow key={`${rw.workerId}-${rw.rosterAssignment.id}`}>
                    <TableCell className="sticky left-0 z-10 bg-background text-xs shadow-[2px_0_4px_rgba(0,0,0,0.06)] max-w-[10rem] px-2 py-0.5">
                      <div className="flex flex-col gap-0 leading-tight">
                        <span className="font-medium truncate" title={rw.name}>
                          {rw.name}
                        </span>
                        {posText ? (
                          <span
                            className="text-[10px] font-normal text-muted-foreground line-clamp-1 truncate"
                            title={posText}
                          >
                            {posText}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    {days.map((d) => {
                      const ts = resolveTimesheetForWaveMonthCell(
                        wave.id,
                        rw.workerId,
                        d,
                        rw.rosterAssignment.id,
                        sheetsByWaveWorker,
                        poMonthDailySheets,
                        poScopeWaveId,
                        rw.rosterAssignment,
                        alternateMobIds,
                      );
                      const cellLabel = timesheetWaveMonthCellDisplay(ts);
                      return (
                        <TableCell key={d} className="px-0.5 text-center text-[11px] leading-none">
                          {ts ? (
                            <span className="inline-flex max-w-full justify-center">
                              <span
                                className={cn(
                                  'inline-flex items-center justify-center rounded-sm border px-1 py-px text-[11px] font-medium leading-none min-w-[1.125rem]',
                                  timesheetEventCellBadgeClasses(ts.eventType, ts.status),
                                )}
                              >
                                {cellLabel}
                              </span>
                            </span>
                          ) : (
                            <span className="inline-flex min-w-[1.125rem] items-center justify-center font-medium text-muted-foreground/80 text-[11px] leading-none py-px">
                              {' - '}
                            </span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center font-bold tabular-nums text-xs min-w-[5.75rem] w-[5.75rem] shrink-0 px-2 py-0.5">
                      {totalH}
                    </TableCell>
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

/**
 * PO + เดือน (พอร์ทัล): ตารางเดียวรวมทุก wave / mobilization ภายใต้ PO — สอดคล้องสรุปรายเดือนฝั่ง OPEC ไม่แยกการ์ดตามเวฟ
 */
export function PortalPoMonthUnifiedReadonlyCard({
  po,
  monthYm,
  poMonthDailySheets,
  assignmentsForPo,
  headerActions,
  t,
}: {
  po: PurchaseOrder;
  monthYm: string;
  poMonthDailySheets: DailyTimesheet[];
  assignmentsForPo: Assignment[];
  /** e.g. internal-only portal parity tools */
  headerActions?: ReactNode;
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
        /* portal อาจอ่าน positions ไม่ได้ */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore]);

  const days = listDaysInMonth(monthYm);

  const sheetsByWaveWorker = useMemo(() => {
    const m = new Map<string, DailyTimesheet[]>();
    for (const row of poMonthDailySheets) {
      const k = `${row.waveId}|${row.workerId}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(row);
    }
    return m;
  }, [poMonthDailySheets]);

  const rawPoId = (po.id || '').trim();
  const poScopeWaveId = poTimesheetScopeId(rawPoId);

  const rosterAssignments = useMemo(
    () =>
      buildPortalPoMonthRosterAssignments(assignmentsForPo, monthYm, rawPoId, poMonthDailySheets),
    [assignmentsForPo, monthYm, rawPoId, poMonthDailySheets],
  );

  const rosterRows = useMemo(() => {
    return rosterAssignments
      .map((asgn) => {
        const wid = asgn.workerId;
        return {
          workerId: wid,
          name: workerDisplayName(wid, asgn, poMonthDailySheets),
          positionId: workerPositionIdForRoster(wid, asgn, poMonthDailySheets),
          rosterAssignment: asgn,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [rosterAssignments, poMonthDailySheets]);

  const monthPrefix = `${monthYm}-`;
  const alternateMobIdsByRowKey = useMemo(() => {
    const sheetIdsByWorker = new Map<string, Set<string>>();
    for (const ts of poMonthDailySheets) {
      if (!ts.date.startsWith(monthPrefix)) continue;
      const aid = ts.assignmentId?.trim();
      if (!aid) continue;
      const set = sheetIdsByWorker.get(ts.workerId) ?? new Set<string>();
      set.add(aid);
      sheetIdsByWorker.set(ts.workerId, set);
    }
    const out = new Map<string, string[]>();
    for (const rw of rosterRows) {
      const wid = rw.workerId;
      const rid = rw.rosterAssignment.id;
      const fromMob = assignmentsForPo
        .filter((x) => x.workerId === wid && x.id !== rid)
        .map((x) => x.id);
      const fromTs = [...(sheetIdsByWorker.get(wid) ?? [])].filter((id) => id !== rid);
      out.set(`${wid}|${rid}`, [...new Set([...fromMob, ...fromTs])]);
    }
    return out;
  }, [rosterRows, assignmentsForPo, poMonthDailySheets, monthPrefix]);

  const rowWorkTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const rw of rosterRows) {
      const waveId = rw.rosterAssignment.waveId;
      const rowKey = `${rw.workerId}|${rw.rosterAssignment.id}`;
      const alternateMobIds = alternateMobIdsByRowKey.get(rowKey) ?? [];
      m.set(
        rowKey,
        sumWorkHoursForWaveMonthRow(
          rw.rosterAssignment,
          waveId,
          rw.workerId,
          rw.rosterAssignment.id,
          days,
          sheetsByWaveWorker,
          poMonthDailySheets,
          poScopeWaveId,
          alternateMobIds,
          { onlyWithinMobWindow: true },
        ),
      );
    }
    return m;
  }, [
    rosterRows,
    days,
    sheetsByWaveWorker,
    poMonthDailySheets,
    poScopeWaveId,
    alternateMobIdsByRowKey,
  ]);

  const monthSheetRowCount = useMemo(() => {
    const rosterIds = new Set(rosterRows.map((r) => r.workerId));
    return poMonthDailySheets.filter((row) => rosterIds.has(row.workerId)).length;
  }, [poMonthDailySheets, rosterRows]);

  const poLabel = formatCustomerPoNumberForPortal(po, po.id);

  const summaryText = t('tsMonthlySummary')
    .replace('{month}', monthYm)
    .replace('{people}', String(rosterRows.length))
    .replace('{rows}', String(monthSheetRowCount));

  return (
    <Card className="overflow-hidden scroll-mt-4">
      <CardHeader className="border-b bg-muted/30 py-4 space-y-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-base flex flex-wrap items-center gap-x-2 gap-y-1">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="font-mono">{poLabel}</span>
              <span className="font-mono text-primary">{monthYm}</span>
              <Badge variant="outline" className="text-[10px] font-normal border-emerald-600/50 text-emerald-800">
                {t('tsHubApprovedBadge')}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">{t('tsPoMonthUnifiedSection')}</CardDescription>
          </div>
          {headerActions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{headerActions}</div> : null}
        </div>
        <p className="text-sm text-muted-foreground">{summaryText}</p>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        {rosterRows.length === 0 ? (
          <p className="text-center text-muted-foreground py-10 px-4 text-sm">{t('tsPoMonthUnifiedEmpty')}</p>
        ) : (
          <>
            <Table className="min-w-max text-xs [&_th]:h-auto [&_th]:min-h-0 [&_th]:py-1 [&_th]:px-1.5 [&_td]:p-1 [&_td]:py-0.5">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="sticky left-0 z-20 w-[9rem] min-w-[7.5rem] max-w-[10rem] bg-muted/95 font-bold shadow-[2px_0_4px_rgba(0,0,0,0.06)] px-2">
                    {t('tsColWorker')}
                  </TableHead>
                  {days.map((d) => (
                    <TableHead key={d} className="px-0.5 text-center w-7 min-w-[1.75rem] font-mono text-[10px]" title={d}>
                      {d.slice(8, 10)}
                    </TableHead>
                  ))}
                  <TableHead className="text-center font-bold min-w-[5.75rem] w-[5.75rem] shrink-0 px-2 text-[10px] leading-tight">
                    {t('tsMonthlyTotalCol')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rosterRows.map((rw) => {
                  const posText =
                    rw.positionId && (positionLabels[rw.positionId] || rw.positionId).trim();
                  const waveId = rw.rosterAssignment.waveId;
                  const rowKey = `${rw.workerId}|${rw.rosterAssignment.id}`;
                  const alternateMobIds = alternateMobIdsByRowKey.get(rowKey) ?? [];
                  const totalH = rowWorkTotals.get(rowKey) ?? 0;
                  return (
                    <TableRow key={`${rw.workerId}-${rw.rosterAssignment.id}`}>
                      <TableCell className="sticky left-0 z-10 bg-background text-xs shadow-[2px_0_4px_rgba(0,0,0,0.06)] max-w-[10rem] px-2 py-0.5">
                        <div className="flex flex-col gap-0 leading-tight">
                          <span className="font-medium truncate" title={rw.name}>
                            {rw.name}
                          </span>
                          {posText ? (
                            <span
                              className="text-[10px] font-normal text-muted-foreground line-clamp-1 truncate"
                              title={posText}
                            >
                              {posText}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      {days.map((d) => {
                        const ts = resolveTimesheetForWaveMonthCell(
                          waveId,
                          rw.workerId,
                          d,
                          rw.rosterAssignment.id,
                          sheetsByWaveWorker,
                          poMonthDailySheets,
                          poScopeWaveId,
                          rw.rosterAssignment,
                          alternateMobIds,
                        );
                        const cellLabel = timesheetWaveMonthCellDisplay(ts);
                        return (
                          <TableCell key={d} className="px-0.5 text-center text-[11px] leading-none">
                            {ts ? (
                              <span className="inline-flex max-w-full justify-center">
                                <span
                                  className={cn(
                                    'inline-flex items-center justify-center rounded-sm border px-1 py-px text-[11px] font-medium leading-none min-w-[1.125rem]',
                                    timesheetEventCellBadgeClasses(ts.eventType, ts.status),
                                  )}
                                >
                                  {cellLabel}
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex min-w-[1.125rem] items-center justify-center font-medium text-muted-foreground/80 text-[11px] leading-none py-px">
                                {' - '}
                              </span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center font-bold tabular-nums text-xs min-w-[5.75rem] w-[5.75rem] shrink-0 px-2 py-0.5">
                        {totalH}
                      </TableCell>
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
