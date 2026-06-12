'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { fmtBaht, renderWageStatusBadge } from '@/components/accounting/withholding-wht-pay-tax-ui';
import {
  employerContribStatusLabel,
  ssoRemitStatusLabel,
} from '@/lib/payroll/payroll-sso-payment-model';

export type PayrollSsoTableRow = {
  rowKey: string;
  batchLabel: string;
  batchSubLabel?: string;
  earnerName: string;
  earnerId: string;
  paymentYmd: string;
  paid: number;
  sso: number;
  employerContrib: number;
  wagePaid: boolean;
  wageLabel: string;
  ssoRemitPaid: boolean;
  employerContribPaid: boolean;
  openHref: string;
  ssoPayable: boolean;
  employerPayable: boolean;
};

export type PayrollSsoPayKind = 'sso_remit' | 'employer_contrib';

export function renderSsoRemitStatusBadge(wagePaid: boolean, remitPaid: boolean) {
  const label = ssoRemitStatusLabel(wagePaid, remitPaid);
  if (!wagePaid) return <span className="text-xs text-muted-foreground">—</span>;
  if (remitPaid) {
    return <Badge className="bg-red-600 hover:bg-red-600 text-white border-transparent">{label}</Badge>;
  }
  return (
    <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50">
      {label}
    </Badge>
  );
}

export function renderEmployerContribStatusBadge(wagePaid: boolean, contribPaid: boolean) {
  const label = employerContribStatusLabel(wagePaid, contribPaid);
  if (!wagePaid) return <span className="text-xs text-muted-foreground">—</span>;
  if (contribPaid) {
    return (
      <Badge className="bg-amber-500 hover:bg-amber-500 text-white border-transparent">{label}</Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-400 text-amber-800 bg-amber-50">
      {label}
    </Badge>
  );
}

export const SSO_LIST_TABLE_COLGROUP = (showSelect: boolean) => (
  <colgroup>
    {showSelect ? <col className="w-[44px]" /> : null}
    <col className="w-[11%]" />
    <col className="w-[16%]" />
    <col className="w-[9%]" />
    <col className="w-[8%]" />
    <col className="w-[8%]" />
    <col className="w-[8%]" />
    <col className="w-[8%]" />
    <col className="w-[8%]" />
    <col className="w-[8%]" />
    <col className="w-[56px]" />
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
  const selectableRows = rows.filter((r) => r.ssoPayable || r.employerPayable);

  return (
    <div className="rounded-md border">
      <Table className="table-fixed w-full">
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
            <TableHead>วันที่จ่าย</TableHead>
            <TableHead className="text-right">ยอดจ่าย</TableHead>
            <TableHead>สถานะจ่ายค่าจ้าง</TableHead>
            <TableHead className="text-right">ยอด ปส.</TableHead>
            <TableHead>สถานะ ปส.</TableHead>
            <TableHead className="text-right">ยอดสมทบ</TableHead>
            <TableHead>สถานะสมทบ</TableHead>
            <TableHead className="text-right pr-2"> </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const selectable = r.ssoPayable || r.employerPayable;
            const allPaid = r.wagePaid && r.ssoRemitPaid && r.employerContribPaid;
            return (
              <TableRow key={r.rowKey}>
                {canPay ? (
                  <TableCell className="w-11 pl-3 align-middle">
                    {allPaid ? (
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
                  <div className="truncate text-xs text-muted-foreground font-mono">{r.earnerId}</div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">{r.paymentYmd}</TableCell>
                <TableCell className="text-right tabular-nums text-sm">{fmtBaht(r.paid)}</TableCell>
                <TableCell>{renderWageStatusBadge(r.wageLabel, r.wagePaid)}</TableCell>
                <TableCell className="text-right tabular-nums text-sm font-medium text-red-700">
                  {fmtBaht(r.sso)}
                </TableCell>
                <TableCell>{renderSsoRemitStatusBadge(r.wagePaid, r.ssoRemitPaid)}</TableCell>
                <TableCell className="text-right tabular-nums text-sm font-medium text-amber-800">
                  {fmtBaht(r.employerContrib)}
                </TableCell>
                <TableCell>{renderEmployerContribStatusBadge(r.wagePaid, r.employerContribPaid)}</TableCell>
                <TableCell className="text-right pr-2">
                  <Link
                    href={r.openHref}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    เปิด
                    <ExternalLink className="h-3.5 w-3.5" />
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

export function PayrollSsoPayButtons({
  canPay,
  selectedSsoCount,
  selectedEmployerCount,
  onPaySso,
  onPayEmployer,
}: {
  canPay: boolean;
  selectedSsoCount: number;
  selectedEmployerCount: number;
  onPaySso: () => void;
  onPayEmployer: () => void;
}) {
  if (!canPay) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 shrink-0">
      <Button
        type="button"
        variant="secondary"
        className="h-auto gap-2 px-4 py-3"
        disabled={selectedSsoCount === 0}
        onClick={onPaySso}
      >
        จ่ายประกันสังคม ({selectedSsoCount})
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="h-auto gap-2 px-4 py-3"
        disabled={selectedEmployerCount === 0}
        onClick={onPayEmployer}
      >
        จ่ายเงินสมทบ ({selectedEmployerCount})
      </Button>
    </div>
  );
}
