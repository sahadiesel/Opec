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

/**
 * จำติ๊กลายเซ็น/ตรายางของเอกสารนี้ไว้ จนกว่าจะติ๊กออก
 *
 * `authorizedReady` — เอกสารมีลายเซ็นผู้มีอำนาจลงนามที่แนบหรืออนุมัติแล้วหรือไม่
 * (`undefined` = เอกสารยังโหลดไม่เสร็จ) ถ้ายังไม่มีลายเซ็น:
 * ติ๊กลายเซ็นผู้มีอำนาจลงนามและตรายางไม่ได้ และติ๊กที่เคยจำไว้จะถูกเอาออก
 * ต้องติ๊กใหม่เองหลังลายเซ็นได้รับอนุมัติ
 */
export function usePersistedPrintMarks(
  kind: string,
  id: string | null | undefined,
  authorizedReady: boolean | undefined,
) {
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

  /** ไม่มีลายเซ็นผู้มีอำนาจลงนาม — เอาติ๊กที่จำไว้ออก (ต้องอยู่หลัง effect ที่อ่านค่าที่จำไว้) */
  useEffect(() => {
    if (authorizedReady !== false) return;
    if (!prefsRef.current.authorized && !prefsRef.current.stamp) return;
    apply({ ...prefsRef.current, authorized: false, stamp: false });
  }, [authorizedReady, apply]);

  const setIncludePreparerSignature = useCallback(
    (value: boolean) => apply({ ...prefsRef.current, preparer: value }),
    [apply],
  );
  const setIncludeAuthorizedSignature = useCallback(
    (value: boolean) => {
      const on = value && authorizedReady === true;
      apply({
        ...prefsRef.current,
        authorized: on,
        stamp: on ? prefsRef.current.stamp : false,
      });
    },
    [apply, authorizedReady],
  );
  const setIncludeStamp = useCallback(
    (value: boolean) => {
      if (!prefsRef.current.authorized || authorizedReady !== true) return;
      apply({ ...prefsRef.current, stamp: value });
    },
    [apply, authorizedReady],
  );

  const authorizedOn = includeAuthorizedSignature && authorizedReady === true;
  return {
    includePreparerSignature,
    setIncludePreparerSignature,
    includeAuthorizedSignature: authorizedOn,
    setIncludeAuthorizedSignature,
    includeStamp: authorizedOn && includeStamp,
    setIncludeStamp,
  };
}
