'use client';

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

interface PageGuidanceProps {
  title?: string;
  tips: string[];
}

/**
 * Reusable component for providing operational guidance and tips on pages.
 * Supports Thai-first bilingual content and follows the system's professional style.
 */
export function PageGuidance({ title = "คำแนะนำการใช้งาน (Usage Tips)", tips }: PageGuidanceProps) {
  return (
    <Alert className="bg-blue-50 border-blue-200 text-blue-800 shadow-sm">
      <Info className="h-5 w-5 text-blue-600" />
      <AlertTitle className="font-bold text-lg">{title}</AlertTitle>
      <AlertDescription className="text-sm space-y-1 mt-1.5">
        {tips.map((tip, i) => (
          <p key={i} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />
            <span>{tip}</span>
          </p>
        ))}
      </AlertDescription>
    </Alert>
  );
}
