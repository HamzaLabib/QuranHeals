/**
 * Mushaf pager (MushafZoomView): a page opened by a jump is drawn where it is shown, from its first frame.
 *
 * On Android (2026-10-16) a page opened from far away (a link, the selector) was sometimes drawn but off screen until
 * the next drag. A newly mounted slot takes its first position from the strip's centre as the UI thread has it at
 * render time, the previous page, and the strip re-centres afterwards. The slot's animated style then has to catch
 * up, which it did not always do. This Reanimated mock follows the 4.x semantics that matter here:
 * - a style is computed once, when its view mounts (later only by its live updater);
 * - a shared value written from React (render or effects) reaches the UI thread later (here: flushUI());
 * - written on the UI thread (gestures, animation callbacks), it applies at once;
 * - a slot's updater follows only the changes made after it is attached (its effect), and its start-up run is taken
 *   as lost, the failure seen on the device.
 * Where a slot sits is therefore its first style, unless one of its inputs changed after it was attached.
 */
import { createElement, useEffect, useState, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SV = { get: () => unknown; set: (v: unknown) => void; version: number };
type Handlers = Record<string, (...args: unknown[]) => void>;
const ui = vi.hoisted(() => ({ depth: 0, queue: [] as (() => void)[], reads: null as Set<unknown> | null, pans: [] as { handlers: Handlers }[] }));
const onUI = <T,>(fn: () => T): T => {
  ui.depth += 1;
  try { return fn(); } finally { ui.depth -= 1; }
};
const flushUI = () => {
  while (ui.queue.length) onUI(ui.queue.shift()!);
};

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  return { StyleSheet: { create: (s: unknown) => s }, View: (props: { children?: ReactNode }) => h('View', props, props.children) };
});
vi.mock('react-native-gesture-handler', () => {
  const builder = () => {
    const gesture = { handlers: {} as Handlers };
    const api: Record<string, unknown> = new Proxy({}, {
      get: (_t, prop: string) => (prop === '__g' ? gesture : (...args: unknown[]) => {
        if (/^on[A-Z]/.test(prop)) gesture.handlers[prop] = args[0] as (...a: unknown[]) => void;
        return api;
      }),
    });
    return api;
  };
  return {
    GestureDetector: ({ gesture, children }: { gesture: { gestures: { __g: { handlers: Handlers } }[] }; children: ReactNode }) => {
      // Simultaneous(pinch, drag, swipe, swipeDown, doubleTap): the third is the page swipe.
      ui.pans.push(gesture.gestures[2].__g);
      return children;
    },
    Gesture: { Pinch: builder, Pan: builder, Tap: builder, Simultaneous: (...gestures: unknown[]) => ({ gestures }) },
  };
});
vi.mock('react-native-reanimated', async () => {
  const { createElement: h, useEffect: effect, useRef } = await import('react');
  return {
    default: { View: (props: { children?: ReactNode }) => h('AnimatedView', props, props.children) },
    useSharedValue: (initial: unknown) => {
      const ref = useRef<SV | null>(null);
      if (!ref.current) {
        let value = initial;
        const sv: SV = {
          version: 0,
          get: () => { ui.reads?.add(sv); return value; },
          set: (next) => {
            const apply = () => { value = next; sv.version += 1; };
            if (ui.depth > 0) apply();
            else ui.queue.push(apply);
          },
        };
        ref.current = sv;
      }
      return ref.current;
    },
    useAnimatedStyle: (updater: () => Record<string, unknown>) => {
      const mount = useRef<{ first: Record<string, unknown>; inputs: SV[]; attached: number[] | null } | null>(null);
      if (!mount.current) {
        ui.reads = new Set();
        const first = updater();
        const inputs = [...ui.reads] as SV[];
        ui.reads = null;
        mount.current = { first, inputs, attached: null };
      }
      const m = mount.current;
      // Attached on the UI thread after the view's effects, as startMapper.
      effect(() => { ui.queue.push(() => { m.attached ??= m.inputs.map((sv) => sv.version); }); }, [m]);
      const shown = () => {
        const changed = m.attached !== null && m.inputs.some((sv, i) => sv.version > m.attached![i]);
        return changed ? updater() : m.first;
      };
      return Object.defineProperty({ ...m.first }, '__shown', { value: shown });
    },
    withTiming: (value: number, _config?: unknown, done?: (finished: boolean) => void) => {
      if (done) queueMicrotask(() => onUI(() => done(true)));
      return value;
    },
    cancelAnimation: () => {},
    Easing: { out: (e: unknown) => e, cubic: 'cubic' },
  };
});
// From the UI thread to React (JS): writes made there go through the queue, as on a device.
vi.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
    const depth = ui.depth;
    ui.depth = 0;
    try { fn(...args); } finally { ui.depth = depth; }
  },
}));

const { MushafZoomView } = await import('@/components/MushafZoomView');

const W = 390;
let root: ReactTestRenderer;
let navigate: (page: number) => void = () => {};
let setFullScreen: (on: boolean) => void = () => {};
const mounts = new Map<number, number>();

/** One page's drawing; counts its mounts (a redraw remounts it). */
function Page({ n }: { n: number }) {
  useEffect(() => { mounts.set(n, (mounts.get(n) ?? 0) + 1); }, [n]);
  return createElement('Page', { n });
}

function Reader({ start }: { start: number }) {
  const [page, setPage] = useState(start);
  const [full, setFull] = useState(false);
  navigate = setPage;
  setFullScreen = setFull;
  return createElement(MushafZoomView, {
    viewport: { width: W, height: full ? 800 : 700 },
    page: { width: W, height: full ? 760 : 660 },
    centered: full,
    current: page,
    lastPage: 604,
    renderPage: (n: number) => createElement(Page, { n }),
    onSwipe: (delta: -1 | 1) => setPage((p) => Math.min(604, Math.max(1, p + delta))),
  });
}

type Shown = { __shown: () => { transform: { translateX: number }[] } };
const slots = () => root.root.findAll((n) => typeof n.type === 'string' && /^mushaf-pager-\d+$/.test(String(n.props.testID)));
const slot = (n: number) => slots().find((s) => s.props.testID === `mushaf-pager-${n}`)!;
/** Where page n's slot actually sits now (0: on screen; ±W: beside it). */
const at = (n: number) => ([slot(n).props.style].flat(3).find((s) => s && (s as Shown).__shown) as Shown).__shown().transform[0].translateX;
const shownPages = () => slots().map((s) => Number(String(s.props.testID).slice('mushaf-pager-'.length))).sort((a, b) => a - b);

/** Everything React and the UI thread have queued, done. */
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await act(async () => { flushUI(); await Promise.resolve(); });
  }
};
const open = async (start: number) => {
  await act(async () => { root = create(createElement(Reader, { start })); });
  await settle();
};
const jump = async (page: number) => {
  await act(async () => { navigate(page); });
  await settle();
};
/** A finger swipe past the turn distance: +1 the next page (left to right), -1 the previous. */
const swipe = async (direction: 1 | -1) => {
  const g = ui.pans[ui.pans.length - 1];
  await act(async () => {
    onUI(() => {
      g.handlers.onBegin({ translationX: 0, translationY: 0 });
      g.handlers.onStart({ translationX: direction * 17, translationY: 0 });
      g.handlers.onUpdate({ translationX: direction * 200, translationY: 0 });
      g.handlers.onEnd({ translationX: direction * 200, translationY: 0, velocityX: 0 }, true);
      g.handlers.onFinalize({ translationX: direction * 200, translationY: 0 }, true);
    });
  });
  await settle();
};
/** The page is on screen; its neighbours wait one page to the side (the next to the left). */
const expectShown = (page: number) => {
  expect(at(page)).toBe(0);
  if (page < 604) expect(at(page + 1)).toBe(-W);
  if (page > 1) expect(at(page - 1)).toBe(W);
  expect(shownPages()).toEqual([page - 1, page, page + 1].filter((n) => n >= 1 && n <= 604));
};

beforeEach(() => {
  ui.depth = 0;
  ui.queue.length = 0;
  ui.pans.length = 0;
  mounts.clear();
});
afterEach(async () => {
  await act(async () => root?.unmount());
});

describe('Mushaf pager: a page opened by a jump is on screen from its first frame', () => {
  it('rapid jumps between distant pages: each lands on screen, with its neighbours beside it', async () => {
    await open(100);
    expectShown(100);
    for (const p of [560, 5, 307, 2, 604, 1, 450, 50, 187, 3, 400, 100]) {
      await jump(p);
      expectShown(p);
    }
  });

  it('jumps made faster than the UI thread follows (no frame between them) still end on screen', async () => {
    await open(300);
    await act(async () => { navigate(560); });
    await act(async () => { navigate(2); });
    await act(async () => { navigate(604); });
    await settle();
    expectShown(604);
  });

  it('pages 1 and 2 (the opening pages): from far away, between each other, and by swipe', async () => {
    await open(560);
    await jump(1);
    expectShown(1);
    await jump(2); // the page beside, opened without a swipe
    expectShown(2);
    await jump(604);
    expectShown(604);
    await jump(2);
    expectShown(2);
    await swipe(-1); // right to left: the previous page, 1
    expectShown(1);
    await swipe(1);
    expectShown(2);
  });

  it('normal and full-screen reading: switching never redraws the page or moves it; jumps in either mode land on screen', async () => {
    await open(560);
    const before = mounts.get(560);
    for (const full of [true, false, true]) {
      await act(async () => { setFullScreen(full); });
      await settle();
      expectShown(560);
    }
    expect(mounts.get(560)).toBe(before);
    await jump(1); // in full screen
    expectShown(1);
    await act(async () => { setFullScreen(false); });
    await settle();
    await jump(604);
    expectShown(604);
  });

  it('repeated navigation: swipes keep the very drawing that slid in; jumps, swipes and returns all land on screen', async () => {
    await open(100);
    for (let round = 0; round < 3; round++) {
      await jump(500);
      expectShown(500);
      const drawnBeside = mounts.get(501);
      await swipe(1);
      expectShown(501);
      expect(mounts.get(501)).toBe(drawnBeside); // the page that slid in, not drawn again
      await swipe(-1);
      expectShown(500);
      await jump(3);
      expectShown(3);
      await jump(100);
      expectShown(100);
    }
  });

  it('one page on or back without a swipe (a screen reader`s page action): the page and both new neighbours in place', async () => {
    await open(200);
    for (const p of [201, 202, 201, 200, 199]) {
      await jump(p);
      expectShown(p);
    }
  });
});
