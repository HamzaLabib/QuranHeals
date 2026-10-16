export type Size = { width: number; height: number };

/** Size changes this close together (a rotation's several layouts, a window being dragged) are applied once, at the end. */
export const RESIZE_SETTLE_MS = 120;

/**
 * Applies measured sizes so the Mushaf page is refitted (its text re-measured) once per rotation or resize, at the final
 * size, never at an intermediate one:
 * - the first measurement is applied at once (the reader opening);
 * - a later change is applied once no other change has followed for RESIZE_SETTLE_MS: a rotation reports several
 *   layouts within a few milliseconds, and a dragged window (iPad Stage Manager, Android freeform or split screen) a
 *   stream of them; only the last size is applied;
 * - unless `settle(next, applied)` says otherwise (phone-sized windows): then every change is applied at once, as before.
 * Measured on an Android 17 tablet emulator (development build, 2026-10-16): applying a rotation's first layout at
 * once and holding the rest rendered the page twice and delayed its refit by 1–5 s; one render at the end does not.
 */
export function createResizeSettler(
  apply: (size: Size) => void,
  options: { delayMs?: number; settle?: (next: Size, applied: Size) => boolean } = {},
) {
  const delay = options.delayMs ?? RESIZE_SETTLE_MS;
  const settle = options.settle ?? (() => true);
  let applied: Size | null = null;
  let pending: Size | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const same = (a: Size | null, b: Size) => a !== null && a.width === b.width && a.height === b.height;
  const commit = (size: Size) => {
    pending = null;
    if (same(applied, size)) return;
    applied = size;
    apply(size);
  };
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return {
    measure(size: Size) {
      if (applied === null || !settle(size, applied)) {
        cancel();
        commit(size);
        return;
      }
      pending = size;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (pending) commit(pending);
      }, delay);
    },
    cancel,
  };
}
