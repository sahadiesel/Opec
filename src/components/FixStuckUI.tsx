'use client';

import { useEffect } from 'react';

/**
 * A defensive utility component that prevents the UI from getting stuck
 * due to uncleaned 'pointer-events: none' or 'overflow: hidden' on the body.
 * This can happen if a Radix dialog/sheet is unmounted or fails to clean up during state transitions.
 */
export function FixStuckUI() {
  useEffect(() => {
    // Use an interval to check periodically if the UI is stuck.
    // This is safer than MutationObserver for catching edge cases where cleanup hooks fail.
    const interval = setInterval(() => {
      // Check if any standard Shadcn/Radix overlay elements are present in the DOM.
      const hasOverlay = document.querySelector('[role="dialog"], [role="menu"], .fixed.inset-0.z-50');
      
      if (!hasOverlay) {
        // If no overlay is detected, ensure the body is interactive.
        if (document.body.style.pointerEvents === 'none') {
          console.warn('[OpsFlow FixStuckUI] Detected stuck pointer-events: none. Restoring interactivity...');
          document.body.style.pointerEvents = 'auto';
        }
        
        // Ensure scroll is restored if it was locked.
        // We only reset if pointer-events is also stuck, to avoid interfering with legitimate layouts.
        if (document.body.style.overflow === 'hidden' && document.body.style.pointerEvents === 'auto') {
          // document.body.style.overflow = '';
        }
      }
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  return null;
}
