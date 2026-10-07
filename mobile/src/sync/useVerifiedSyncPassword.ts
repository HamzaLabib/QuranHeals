import { useCallback, useEffect, useRef, useState } from 'react';
import type { VerifyPassphrase } from './syncKeyManager';

type Checked = { value: string; verify: VerifyPassphrase; valid: boolean };
const isChecked = (checked: Checked | null, value: string, verify: VerifyPassphrase) =>
  checked?.value === value && checked.verify === verify;

/** Debounce costly KDF work and discard verification of superseded input.
 * A KDF cannot be cancelled and shares the JS thread with everything else,
 * so at most one runs at a time: input that changed meanwhile is verified
 * next (only its latest value), and an already-checked value never again.
 * No new-password length rule is applied to legacy unlock passwords. */
export function useVerifiedSyncPassword(value: string, verify?: VerifyPassphrase) {
  const [result, setResult] = useState<Checked | null>(null);
  const latest = useRef({ value, verify });
  const lastChecked = useRef<Checked | null>(null);
  const running = useRef(false);
  const rerun = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async () => {
    if (running.current) {
      rerun.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        rerun.current = false;
        const { value, verify } = latest.current;
        if (!verify || !value || isChecked(lastChecked.current, value, verify)) continue;
        const valid = await verify(value).catch(() => false);
        lastChecked.current = { value, verify, valid };
        if (mounted.current) setResult(lastChecked.current);
      } while (rerun.current && mounted.current);
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    latest.current = { value, verify };
    if (!verify || !value || isChecked(lastChecked.current, value, verify)) return;
    const timer = setTimeout(() => void run(), 300);
    return () => clearTimeout(timer);
  }, [value, verify, run]);

  const checked = !!value && !!verify && isChecked(result, value, verify);
  return {
    verified: checked && result!.valid,
    incorrect: checked && !result!.valid,
    /** Input that is waiting for, or undergoing, verification. */
    checking: !!value && !!verify && !checked,
  };
}
