'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Info } from 'lucide-react';

interface PageGuidanceProps {
  title?: string;
  tips: string[];
  /** ปุ่มมุมขวา — กดแล้วเปิด Popover (ไม่แสดงรายละเอียดในหน้าโดยตรง) */
  compact?: boolean;
}

function GuidanceTipsList({ tips }: { tips: string[] }) {
  return (
    <div className="text-xs space-y-1.5 leading-snug">
      {tips.map((tip, i) => (
        <p key={i} className="flex items-start gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />
          <span>{tip}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Reusable component for providing operational guidance and tips on pages.
 * Supports Thai-first bilingual content and follows the system's professional style.
 */
export function PageGuidance({ title = 'คำแนะนำการใช้งาน (Usage Tips)', tips, compact = false }: PageGuidanceProps) {
  if (compact) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            <Info className="h-3.5 w-3.5 text-blue-600" />
            {title}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(28rem,92vw)] max-h-[min(70vh,32rem)] overflow-y-auto p-3 text-xs">
          <p className="font-semibold text-sm text-foreground mb-1.5">{title}</p>
          <GuidanceTipsList tips={tips} />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
      <Info className="h-5 w-5 text-blue-600" />
      <AlertTitle className="font-bold text-lg">{title}</AlertTitle>
      <AlertDescription className="text-sm space-y-1 mt-1.5">
        <GuidanceTipsList tips={tips} />
      </AlertDescription>
    </Alert>
  );
}
