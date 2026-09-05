'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { COMPACT_LIST_TABLE } from '@/components/ui/table-density';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { fmtBaht, renderWageStatusBadge } from '@/components/accounting/withholding-wht-pay-tax-ui';
import { cn } from '@/lib/utils';
import { formatYmdLocalThaiBE } from '@/lib/date-thai';
import {
  employerContribStatusLabel,
  ssoCombinedRemitAmount,
} from '@/lib/payroll/payroll-sso-payment-model';

export type PayrollSsoTableRow = {
  rowKey: string;
  batchLabel: string;
  batchSubLabel?: string;
  earnerName: string;
  earnerId: string;
  paymentYmd: string;
  paid: number;
  /** ยอด ปกส. บนสลิปบรรทัดนี้ (อาจไม่ใช่ยอดนำส่งรายเดือน) */
  lineSso: number;
  /** ยอด ปกส. ที่แสดง/จ่าย — เฉพาะ leader ของคน+เดือน */
  sso: number;
  employerContrib: number;
  wagePaid: boolean;
  wageLabel: string;
  ssoRemitPaid: boolean;
  employerContribPaid: boolean;
  openHref: string;
  ssoPayable: boolean;
  employerPayable: boolean;
  /** กลุ่มคน+เดือน — แถว follower ไม่ให้เลือกจ่ายซ้ำ */
  groupKey?: string;
  isGroupLeader?: boolean;
  groupSize?: number;
  memberRowKeys?: string[];
};

export type PayrollSsoPayKind = 'sso_remit' | 'employer_contrib';

/** จำนวนประกันสังคมแสดงเป็นเงินบาทเต็มเสมอ ไม่มี .00 */
export function fmtSsoBaht(amount: number): string {
  const wholeBaht = Math.ceil(Math.max(0, Number(amount) || 0));
  return `฿${wholeBaht.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`;
}

export function renderEmployerContribStatusBadge(wagePaid: boolean, contribPaid: boolean, ssoRemitPaid: boolean) {
  const bothPaid = contribPaid && ssoRemitPaid;
  const label = bothPaid
    ? 'จ่ายแล้ว'
    : !wagePaid
      ? '—'
      : contribPaid || ssoRemitPaid
        ? 'จ่ายบางส่วน'
        : employerContribStatusLabel(wagePaid, false);
  if (!wagePaid) return <span className="text-xs text-muted-foreground">—</span>;
  if (bothPaid) {
    return (
      <Badge className="bg-amber-500 hover:bg-amber-500 text-white border-transparent">{label}</Badge>
    );
  }
  if (contribPaid || ssoRemitPaid) {
    return (
      <Badge variant="outline" className="border-amber-400 text-amber-800 bg-amber-50">
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-400 text-amber-800 bg-amber-50">
      {employerContribStatusLabel(wagePaid, false)}
    </Badge>
  );
}

const SSO_BATCH_COL_WIDTH = '11%';
const SSO_NAME_COL_WIDTH = '15%';
const SSO_DATE_COL_WIDTH = '8%';
/** 6 equal columns: ยอดจ่าย → เปิด */
const SSO_EQUAL_SIX_COL_WIDTH = '11%';

const SSO_EQUAL_COL_HEAD =
  'px-2 py-0 text-xs font-medium leading-snug align-middle whitespace-normal break-words';
const SSO_EQUAL_COL_CELL = 'px-2 py-0 align-middle max-w-0 leading-tight';

export const SSO_LIST_TABLE_COLGROUP = (showSelect: boolean) => (
  <colgroup>
    {showSelect ? <col style={{ width: 44 }} /> : null}
    <col style={{ width: SSO_BATCH_COL_WIDTH }} />
    <col style={{ width: SSO_NAME_COL_WIDTH }} />
    <col style={{ width: SSO_DATE_COL_WIDTH }} />
    <col style={{ width: SSO_EQUAL_SIX_COL_WIDTH }} />
    <col style={{ width: SSO_EQUAL_SIX_COL_WIDTH }} />
    <col style={{ width: SSO_EQUAL_SIX_COL_WIDTH }} />
    <col style={{ width: SSO_EQUAL_SIX_COL_WIDTH }} />
    <col style={{ width: SSO_EQUAL_SIX_COL_WIDTH }} />
    <col style={{ width: SSO_EQUAL_SIX_COL_WIDTH }} />
  </colgroup>
);

export function PayrollSsoListTable({
  rows,
  canPay,
  selectedKeys,
  onSelectedKeysChange,
}: {
  rows: PayrollSsoTableRow[];
  canPay: boolean;
  selectedKeys: Set<string>;
  onSelectedKeysChange: (next: Set<string>) => void;
}) {
  const selectableRows = rows.filter(
    (r) => (r.isGroupLeader !== false) && (r.ssoPayable || r.employerPayable),
  );

  return (
    <div className="rounded-md border">
      <Table className={cn('table-fixed w-full', COMPACT_LIST_TABLE)}>
        {SSO_LIST_TABLE_COLGROUP(canPay)}
        <TableHeader>
          <TableRow>
            {canPay ? (
              <TableHead className="w-11 pl-3">
                <Checkbox
                  checked={
                    selectableRows.length > 0 &&
                    selectableRows.every((r) => selectedKeys.has(r.rowKey))
                  }
                  onCheckedChange={(v) => {
                    if (v === true) {
                      onSelectedKeysChange(new Set(selectableRows.map((r) => r.rowKey)));
                    } else {
                      onSelectedKeysChange(new Set());
                    }
                  }}
                  aria-label="เลือกทั้งหมดที่พร้อมจ่าย"
                />
              </TableHead>
            ) : null}
            <TableHead>ชุดจ่าย / งวด</TableHead>
            <TableHead>ผู้มีเงินได้</TableHead>
            <TableHead className="whitespace-nowrap">วันที่จ่าย</TableHead>
            <TableHead className={cn(SSO_EQUAL_COL_HEAD, 'text-right')} title="ยอดเงินได้ก่อนหัก ภงด. และ ปกส.">
              ยอดจ่าย
            </TableHead>
            <TableHead className={cn(SSO_EQUAL_COL_HEAD, 'text-center')}>สถานะจ่ายค่าจ้าง</TableHead>
            <TableHead className={cn(SSO_EQUAL_COL_HEAD, 'text-right')}>ยอด ปกส.</TableHead>
            <TableHead className={cn(SSO_EQUAL_COL_HEAD, 'text-right')}>ปกส.+สมทบ</TableHead>
            <TableHead className={cn(SSO_EQUAL_COL_HEAD, 'text-center')}>สถานะ ปกส.+สมทบ</TableHead>
            <TableHead className={cn(SSO_EQUAL_COL_HEAD, 'text-center')}> </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const isLeader = r.isGroupLeader !== false;
            const selectable = isLeader && (r.ssoPayable || r.employerPayable);
            const allPaid = r.wagePaid && r.ssoRemitPaid && r.employerContribPaid;
            const groupNote =
              (r.groupSize ?? 1) > 1
                ? isLeader
                  ? `รวม ${r.groupSize} ชุดจ่ายในเดือน — ยอด ปกส. จากสลิปล่าสุด`
                  : 'รวมกับสลิปล่าสุดในเดือนเดียวกัน'
                : null;
            return (
              <TableRow
                key={r.rowKey}
                className={cn(!isLeader && (r.groupSize ?? 1) > 1 && 'bg-muted/20')}
              >
                {canPay ? (
                  <TableCell className="w-11 pl-3 align-middle">
                    {!isLeader ? (
                      <span className="text-muted-foreground text-xs" title={groupNote ?? undefined}>
                        ↳
                      </span>
                    ) : allPaid ? (
                      <span className="text-muted-foreground text-xs" title="จ่ายครบแล้ว">
                        ✓
                      </span>
                    ) : selectable ? (
                      <Checkbox
                        checked={selectedKeys.has(r.rowKey)}
                        onCheckedChange={(v) => {
                          const on = v === true;
                          onSelectedKeysChange(
                            (() => {
                              const next = new Set(selectedKeys);
                              if (on) next.add(r.rowKey);
                              else next.delete(r.rowKey);
                              return next;
                            })(),
                          );
                        }}
                        aria-label={`เลือก ${r.earnerName}`}
                      />
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell className="text-xs">
                  <div className="font-mono truncate" title={r.batchLabel}>
                    {r.batchLabel}
                  </div>
                  {r.batchSubLabel ? (
                    <div className="truncate text-muted-foreground">{r.batchSubLabel}</div>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-0">
                  <div className="truncate font-medium" title={r.earnerName}>
                    {r.earnerName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground font-mono" title="เลขบัตรประชาชน">
                    {r.earnerId}
                  </div>
                  {groupNote ? (
                    <div className="truncate text-[10px] text-muted-foreground" title={groupNote}>
                      {groupNote}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">{formatYmdLocalThaiBE(r.paymentYmd)}</TableCell>
                <TableCell className={cn(SSO_EQUAL_COL_CELL, 'text-right tabular-nums text-sm')}>
                  {fmtBaht(r.paid)}
                </TableCell>
                <TableCell className={cn(SSO_EQUAL_COL_CELL, 'text-center')}>
                  {renderWageStatusBadge(r.wageLabel, r.wagePaid)}
                </TableCell>
                <TableCell
                  className={cn(SSO_EQUAL_COL_CELL, 'text-right tabular-nums text-sm font-medium text-red-700')}
                >
                  {isLeader ? (
                    fmtSsoBaht(r.sso)
                  ) : (
                    <span className="text-muted-foreground text-xs" title={`บนสลิป: ${fmtSsoBaht(r.lineSso)}`}>
                      —
                    </span>
                  )}
                </TableCell>
                <TableCell
                  className={cn(SSO_EQUAL_COL_CELL, 'text-right tabular-nums text-sm font-semibold text-amber-900')}
                >
                  {isLeader ? (
                    fmtSsoBaht(ssoCombinedRemitAmount(r.sso))
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className={cn(SSO_EQUAL_COL_CELL, 'text-center')}>
                  {isLeader ? (
                    renderEmployerContribStatusBadge(r.wagePaid, r.employerContribPaid, r.ssoRemitPaid)
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className={cn(SSO_EQUAL_COL_CELL, 'text-center')}>
                  <Link
                    href={r.openHref}
                    className="inline-flex items-center justify-center gap-1 text-sm text-primary hover:underline"
                  >
                    เปิด
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function PayrollSsoPayButton({
  canPay,
  selectedCount,
  onPay,
}: {
  canPay: boolean;
  selectedCount: number;
  onPay: () => void;
}) {
  if (!canPay) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      className="h-10 shrink-0 gap-2 px-4 whitespace-nowrap"
      disabled={selectedCount === 0}
      onClick={onPay}
    >
      จ่าย ปกส.+สมทบ ({selectedCount})
    </Button>
  );
}
