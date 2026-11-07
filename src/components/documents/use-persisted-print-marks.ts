'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type PrintMarkPrefs = {
  preparer: boolean;
  authorized: boolean;
  stamp: boolean;
};

function storageKey(kind: string, id: string): string {
  return `opec-print-marks:${kind}:${id}`;
}

function readPrefs(kind: string, id: string): PrintMarkPrefs {
  if (typeof window === 'undefined') return { preparer: false, authorized: false, stamp: false };
  try {
    const raw = window.localStorage.getItem(storageKey(kind, id));
    if (!raw) return { preparer: false, authorized: false, stamp: false };
    const parsed = JSON.parse(raw) as Partial<PrintMarkPrefs>;
    const authorized = parsed.authorized === true;
    return {
      preparer: parsed.preparer === true,
      authorized,
      stamp: authorized && parsed.stamp === true,
    };
  } catch {
    return { preparer: false, authorized: false, stamp: false };
  }
}

function writePrefs(kind: string, id: string, prefs: PrintMarkPrefs) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(kind, id), JSON.stringify(prefs));
}

/** จำติ๊กลายเซ็น/ตรายางของเอกสารนี้ไว้ จนกว่าจะติ๊กออก */
export function usePersistedPrintMarks(kind: string, id: string | null | undefined) {
  const [includePreparerSignature, setPreparerState] = useState(false);
  const [includeAuthorizedSignature, setAuthorizedState] = useState(false);
  const [includeStamp, setStampState] = useState(false);
  const prefsRef = useRef<PrintMarkPrefs>({ preparer: false, authorized: false, stamp: false });

  useEffect(() => {
    if (!id) return;
    const saved = readPrefs(kind, id);
    prefsRef.current = saved;
    setPreparerState(saved.preparer);
    setAuthorizedState(saved.authorized);
    setStampState(saved.stamp);
  }, [kind, id]);

  const apply = useCallback(
    (next: PrintMarkPrefs) => {
      const stamp = next.authorized && next.stamp;
      const clean = { preparer: next.preparer, authorized: next.authorized, stamp };
      prefsRef.current = clean;
      setPreparerState(clean.preparer);
      setAuthorizedState(clean.authorized);
      setStampState(clean.stamp);
      if (id) writePrefs(kind, id, clean);
    },
    [kind, id],
  );

  const setIncludePreparerSignature = useCallback(
    (value: boolean) => apply({ ...prefsRef.current, preparer: value }),
    [apply],
  );
  const setIncludeAuthorizedSignature = useCallback(
    (value: boolean) =>
      apply({
        ...prefsRef.current,
        authorized: value,
        stamp: value ? prefsRef.current.stamp : false,
      }),
    [apply],
  );
  const setIncludeStamp = useCallback(
    (value: boolean) => {
      if (!prefsRef.current.authorized) return;
      apply({ ...prefsRef.current, stamp: value });
    },
    [apply],
  );

  return {
    includePreparerSignature,
    setIncludePreparerSignature,
    includeAuthorizedSignature,
    setIncludeAuthorizedSignature,
    includeStamp,
    setIncludeStamp,
  };
}
