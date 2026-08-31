import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { HrAttendanceManagePageContent } from './attendance-manage-content';

export default function HrAttendanceManagePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] w-full items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }
    >
      <HrAttendanceManagePageContent />
    </Suspense>
  );
}
