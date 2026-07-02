'use client';

import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import type { WorkerMonthClosureStatus, WorkerMonthTimesheetClosure } from '@/lib/types';
import {
  isWorkerMonthClosureGridLocked,
  workerMonthClosureStatusLabelTh,
} from '@/lib/timesheet/worker-month-closure';
import { ChevronDown } from 'lucide-react';

function statusBadgeVariant(status: WorkerMonthClosureStatus | undefined): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'approved':
      return 'default';
    case 'pending_manager_review':
      return 'secondary';
    case 'deferred':
      return 'outline';
    case 'rejected':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function WorkerMonthClosureCell(props: {
  closure: WorkerMonthTimesheetClosure | undefined;
  canEdit: boolean;
  selected: boolean;
  selectable: boolean;
  onSelectedChange: (checked: boolean) => void;
  onMarkDeferred: () => void;
  onClearDeferred: () => void;
  busy?: boolean;
}) {
  const { closure, canEdit, selected, selectable, onSelectedChange, onMarkDeferred, onClearDeferred, busy } = props;
  const status = closure?.status;
  const locked = isWorkerMonthClosureGridLocked(status);

  return (
    <div className="flex items-center gap-1.5 min-w-[7.5rem]">
      {selectable ? (
        <Checkbox
          checked={selected}
          disabled={!canEdit || busy || locked || status === 'deferred'}
          onCheckedChange={(v) => onSelectedChange(v === true)}
          aria-label="เลือกปิดงวด"
        />
      ) : null}
      {canEdit && !locked ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={busy}
              className="inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium hover:bg-muted/60 disabled:opacity-50"
            >
              <Badge variant={statusBadgeVariant(status)} className="text-[10px] px-1.5 py-0">
                {workerMonthClosureStatusLabelTh(status)}
              </Badge>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="text-xs">
            {status === 'deferred' ? (
              <DropdownMenuItem onClick={onClearDeferred}>กลับเป็นพร้อมปิดงวด</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onMarkDeferred}>รอ timesheet</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Badge variant={statusBadgeVariant(status)} className="text-[10px] px-1.5 py-0">
          {workerMonthClosureStatusLabelTh(status)}
        </Badge>
      )}
    </div>
  );
}

export function workerMonthClosureSummaryText(
  closures: WorkerMonthTimesheetClosure[],
  totalWorkers: number,
): string {
  const byStatus = (s: WorkerMonthClosureStatus) => closures.filter((c) => c.status === s).length;
  const approved = byStatus('approved');
  const pending = byStatus('pending_manager_review');
  const locked = byStatus('entry_locked');
  const deferred = byStatus('deferred');
  const open = totalWorkers - closures.length + byStatus('open') + byStatus('rejected');
  const openApprox = Math.max(0, totalWorkers - approved - pending - locked - deferred);

  return `${approved} อนุมัติ · ${pending} รอผู้จัดการ · ${locked} ปิดแล้ว · ${deferred} รอ timesheet · ~${openApprox} เปิด`;
}
