import { useEffect, useState } from 'react';
import type { VerifyPassphrase } from './syncKeyManager';

/** Debounce costly KDF work and discard verification of superseded input.
 * No new-password length rule is applied to legacy unlock passwords. */
export function useVerifiedSyncPassword(value: string, verify?: VerifyPassphrase) {
  const [result, setResult] = useState<{ value: string; verify: VerifyPassphrase; valid: boolean } | null>(null);
  useEffect(() => {
    if (!verify || !value) return;
    let active = true;
    const timer = setTimeout(() => {
      void verify(value).catch(() => false).then((valid) => {
        if (active) setResult({ value, verify, valid });
      });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [value, verify]);
  const checked = !!value && result?.value === value && result.verify === verify;
  return { verified: checked && result.valid, incorrect: checked && !result.valid };
}
