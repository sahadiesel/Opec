'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type {
  BillingRetroChoices,
  BillingReversalWorkerPrompt,
} from '@/lib/commercial/billing-reversal-days';

function WorkerChoiceList({
  prompts,
  choiceByWorker,
  idPrefix,
  onChange,
}: {
  prompts: BillingReversalWorkerPrompt[];
  choiceByWorker: Record<string, boolean>;
  idPrefix: string;
  onChange: (workerId: string, include: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      {prompts.map((prompt) => {
        const value = choiceByWorker[prompt.workerId] ? 'yes' : 'no';
        return (
          <div key={`${idPrefix}-${prompt.workerId}`} className="rounded-md border p-3">
            <p className="text-sm font-medium">{prompt.workerName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {prompt.days.map((day) => `${day.dateLabel} ${day.eventLabel}`).join(' · ')}
              {` · ${prompt.days.length} วัน`}
            </p>
            <RadioGroup
              className="mt-2"
              value={value}
              onValueChange={(next) => onChange(prompt.workerId, next === 'yes')}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem id={`${idPrefix}-${prompt.workerId}-yes`} value="yes" />
                <Label htmlFor={`${idPrefix}-${prompt.workerId}-yes`}>วางบิลวันนี้</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id={`${idPrefix}-${prompt.workerId}-no`} value="no" />
                <Label htmlFor={`${idPrefix}-${prompt.workerId}-no`}>ไม่วางบิลวันนี้</Label>
              </div>
            </RadioGroup>
          </div>
        );
      })}
    </div>
  );
}

export function BillingReversalConfirmDialog({
  reversalPrompts,
  addedDayPrompts,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  reversalPrompts: BillingReversalWorkerPrompt[] | null;
  addedDayPrompts: BillingReversalWorkerPrompt[] | null;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (choices: BillingRetroChoices) => void;
}) {
  const reversals = reversalPrompts ?? [];
  const addedDays = addedDayPrompts ?? [];
  const promptKey = [
    ...reversals.map((prompt) => `r:${prompt.workerId}`),
    ...addedDays.map((prompt) => `a:${prompt.workerId}`),
  ].join('|');
  const [reversalChoice, setReversalChoice] = useState<Record<string, boolean>>({});
  const [addedChoice, setAddedChoice] = useState<Record<string, boolean>>({});
  const [syncedKey, setSyncedKey] = useState('');
  if (promptKey !== syncedKey) {
    const nextReversal: Record<string, boolean> = {};
    const nextAdded: Record<string, boolean> = {};
    for (const prompt of reversals) nextReversal[prompt.workerId] = false;
    for (const prompt of addedDays) nextAdded[prompt.workerId] = false;
    setSyncedKey(promptKey);
    setReversalChoice(nextReversal);
    setAddedChoice(nextAdded);
  }

  const open = reversals.length + addedDays.length > 0;
  const both = reversals.length > 0 && addedDays.length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {both
              ? 'ยืนยันวันที่มีการแก้ไขหลังจ่ายค่าแรง'
              : addedDays.length > 0
                ? 'มีวันที่จ่ายลูกจ้างเพิ่มเติมจากที่จ่ายค่าแรงไปแล้ว'
                : 'มีวันที่หักเงินคืนจากลูกจ้าง'}
          </DialogTitle>
          <DialogDescription>
            {both
              ? 'ยืนยันทีละคนว่าจะนำวันที่หักเงินคืน หรือวันที่จ่ายเพิ่ม มาวางบิลลูกค้าหรือไม่'
              : addedDays.length > 0
                ? 'วันที่เหล่านี้จ่ายให้ลูกจ้างเพิ่มหลังจ่ายค่าแรงไปแล้ว จะวางบิลลูกค้าเพิ่มเติมหรือไม่ ยืนยันทีละคน'
                : 'วันที่เหล่านี้บันทึกหักเงินคืนเพราะลูกค้าไม่จ่าย ต้องการนำวันที่ลงเวลานั้นมาวางบิลหรือไม่ ยืนยันทีละคน'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
          {reversals.length > 0 ? (
            <section className="space-y-2">
              {both ? (
                <div>
                  <p className="text-sm font-semibold">มีวันที่หักเงินคืนจากลูกจ้าง</p>
                  <p className="text-xs text-muted-foreground">
                    บันทึกหักเงินคืนเพราะลูกค้าไม่จ่าย จะนำวันที่ลงเวลานั้นมาวางบิลหรือไม่
                  </p>
                </div>
              ) : null}
              <WorkerChoiceList
                prompts={reversals}
                choiceByWorker={reversalChoice}
                idPrefix="reversal"
                onChange={(workerId, include) =>
                  setReversalChoice((prev) => ({ ...prev, [workerId]: include }))
                }
              />
            </section>
          ) : null}
          {addedDays.length > 0 ? (
            <section className="space-y-2">
              {both ? (
                <div>
                  <p className="text-sm font-semibold">มีวันที่จ่ายลูกจ้างเพิ่มเติมจากที่จ่ายค่าแรงไปแล้ว</p>
                  <p className="text-xs text-muted-foreground">จะวางบิลลูกค้าเพิ่มเติมหรือไม่</p>
                </div>
              ) : null}
              <WorkerChoiceList
                prompts={addedDays}
                choiceByWorker={addedChoice}
                idPrefix="added"
                onChange={(workerId, include) =>
                  setAddedChoice((prev) => ({ ...prev, [workerId]: include }))
                }
              />
            </section>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              onConfirm({
                reversalIncludeByWorkerId: reversalChoice,
                addedDayIncludeByWorkerId: addedChoice,
              })
            }
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
