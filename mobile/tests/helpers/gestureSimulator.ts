/**
 * Drives the gestures a GestureDetector was given (recorded by a
 * react-native-gesture-handler mock: each Gesture.X() keeps its callbacks and
 * settings) with a stream of finger samples, through the same state machine
 * react-native-gesture-handler 2 runs natively, so a test exercises the
 * activation rules (activeOffset, failOffset, maxPointers, enabled) and the
 * callback order, not just a hand-called onEnd:
 *
 *   touch down        → BEGAN      (onBegin)
 *   past a failOffset → FAILED     (onFinalize(e, false)), never onStart/onEnd
 *   past activeOffset → ACTIVE     (onStart, then onUpdate on every move)
 *   too many fingers  → CANCELLED if active (onEnd(e, false)), else FAILED
 *   system cancel     → CANCELLED if active (onEnd(e, false)), else FAILED
 *   finger lifted     → END if active (onEnd(e, true), onFinalize(e, true)), else FAILED
 *
 * Offsets follow the library's documented ranges: [a, b] activates (or fails)
 * outside a..b; a single p ≥ 0 means beyond +p, p < 0 beyond -p. A pan with
 * no activation criteria starts after 10 pt (UIPanGestureRecognizer's slop).
 * Velocities come from the last two samples, in pt/s, as the native event's.
 *
 * Optionally it also models the iOS navigation stack around the screen
 * (react-native-screens 4.26, ios/RNSScreenStack.mm): its back swipe receives
 * the same touches unless the screen's gestureEnabled is false; it is
 * full-screen when fullScreenGestureEnabled is true or unset on iOS 26+
 * (isFullScreenSwipeEffectivelyEnabled), otherwise from the leading 20-pt edge
 * only; it begins on a mostly horizontal move toward "back" (rightwards, or
 * leftwards under RTL), and then cancels every touch in the screen
 * (cancelTouchesInParent, and UIKit's cancelsTouchesInView).
 *
 * This is a model, not a device: it cannot replace a test on a phone.
 */
export type RecordedGesture = { kind: 'pinch' | 'pan' | 'tap'; handlers: Record<string, (...args: unknown[]) => void>; config: Record<string, unknown> };

/** One finger sample: screen position (pt), time (ms); `pointers` defaults to 1; `scale` for two-finger samples. */
export type TouchSample = { x: number; y: number; t: number; pointers?: number; scale?: number };

export type NavigationStack = {
  /** The route's options, as given to the native stack. */
  options: { gestureEnabled?: boolean; fullScreenGestureEnabled?: boolean };
  iosVersion: number;
  rtl?: boolean;
  screenWidth: number;
  /** Whether there is a screen to go back to (Home beneath the reader). */
  canGoBack?: boolean;
};

export type TouchResult = {
  /** The navigation stack took the touch (the page's gestures were cancelled; the screen starts going back). */
  stackTookTouch: boolean;
  /** Each gesture's final state, by its kind and order. */
  states: string[];
};

type State = 'idle' | 'began' | 'active' | 'failed' | 'cancelled' | 'ended';

const outside = (value: number, range: unknown): boolean => {
  if (range === undefined) return false;
  if (Array.isArray(range)) return value < range[0] || value > range[1];
  const p = range as number;
  return p >= 0 ? value > p : value < p;
};

/** Two taps within this, each without moving, make a double tap (the library's default maxDelay). */
const DOUBLE_TAP_DELAY = 500;
const TAP_SLOP = 10;
const PAN_SLOP = 10;
const EDGE = 20;
const tapHistory = new WeakMap<RecordedGesture, { count: number; lastUp: number }>();

export function runTouch(gestures: RecordedGesture[], samples: TouchSample[], opts: { stack?: NavigationStack; systemCancelAt?: number } = {}): TouchResult {
  const first = samples[0];
  const states: State[] = gestures.map(() => 'idle');
  const on = (g: RecordedGesture, name: string, ...args: unknown[]) => g.handlers[name]?.(...args);
  let prev = first;
  const event = (s: TouchSample) => ({
    x: s.x, y: s.y, absoluteX: s.x, absoluteY: s.y,
    translationX: s.x - first.x, translationY: s.y - first.y,
    velocityX: s.t > prev.t ? ((s.x - prev.x) / (s.t - prev.t)) * 1000 : 0,
    velocityY: s.t > prev.t ? ((s.y - prev.y) / (s.t - prev.t)) * 1000 : 0,
    numberOfPointers: s.pointers ?? 1,
    scale: s.scale ?? 1, focalX: s.x, focalY: s.y,
  });
  const enabled = (g: RecordedGesture) => g.config.enabled !== false;
  const cancelAll = (e: ReturnType<typeof event>) => {
    gestures.forEach((g, i) => {
      if (states[i] === 'active') { states[i] = 'cancelled'; on(g, 'onEnd', e, false); on(g, 'onFinalize', e, false); }
      else if (states[i] === 'began') { states[i] = 'failed'; on(g, 'onFinalize', e, false); }
    });
  };

  // The navigation stack's back swipe, if modelled.
  const stack = opts.stack;
  const stackReceives = Boolean(stack && stack.options.gestureEnabled !== false && (stack.canGoBack ?? true));
  const fullScreen = stack ? stack.options.fullScreenGestureEnabled ?? stack.iosVersion >= 26 : false;
  const fromEdge = stack ? (stack.rtl ? first.x > stack.screenWidth - EDGE : first.x < EDGE) : false;
  let stackTookTouch = false;
  // The release carries the finger's last movement (translation and velocity), as the native event does.
  let lastMove = event(first);

  // Touch down.
  gestures.forEach((g, i) => {
    if (!enabled(g)) return;
    if (g.kind === 'pinch' && (first.pointers ?? 1) < 2) return;
    states[i] = 'began';
    on(g, 'onBegin', event(first));
  });

  for (let k = 1; k < samples.length; k++) {
    const s = samples[k];
    const e = event(s);
    prev = s;
    lastMove = e;
    if (opts.systemCancelAt === k) { cancelAll(e); break; }
    if (stackReceives && !stackTookTouch && (fullScreen || fromEdge)) {
      const back = stack!.rtl ? -e.translationX : e.translationX;
      if (back > PAN_SLOP && Math.abs(e.translationX) > Math.abs(e.translationY)) {
        stackTookTouch = true;
        cancelAll(e);
        break;
      }
    }
    gestures.forEach((g, i) => {
      if (!enabled(g)) return;
      const pointers = s.pointers ?? 1;
      if (g.kind === 'pinch') {
        if (states[i] === 'idle' && pointers >= 2) { states[i] = 'began'; on(g, 'onBegin', e); }
        if (states[i] === 'began' && pointers >= 2 && Math.abs((s.scale ?? 1) - 1) > 0) { states[i] = 'active'; on(g, 'onStart', e); }
        if (states[i] === 'active') on(g, 'onUpdate', e);
        return;
      }
      if (g.kind === 'tap') {
        if (states[i] === 'began' && Math.hypot(e.translationX, e.translationY) > TAP_SLOP) { states[i] = 'failed'; on(g, 'onFinalize', e, false); }
        return;
      }
      // Pan.
      if (states[i] !== 'began' && states[i] !== 'active') return;
      const maxPointers = (g.config.maxPointers as number | undefined) ?? 10;
      if (pointers > maxPointers) {
        if (states[i] === 'active') { states[i] = 'cancelled'; on(g, 'onEnd', e, false); on(g, 'onFinalize', e, false); }
        else { states[i] = 'failed'; on(g, 'onFinalize', e, false); }
        return;
      }
      if (states[i] === 'began') {
        if (outside(e.translationX, g.config.failOffsetX) || outside(e.translationY, g.config.failOffsetY)) {
          states[i] = 'failed';
          on(g, 'onFinalize', e, false);
          return;
        }
        const criteria = ['activeOffsetX', 'activeOffsetY'].some((key) => key in g.config);
        const activate = criteria
          ? outside(e.translationX, g.config.activeOffsetX) || outside(e.translationY, g.config.activeOffsetY)
          : Math.hypot(e.translationX, e.translationY) > PAN_SLOP;
        if (!activate) return;
        states[i] = 'active';
        on(g, 'onStart', e);
      }
      on(g, 'onUpdate', e);
    });
  }

  // Finger(s) lifted.
  if (!stackTookTouch && opts.systemCancelAt === undefined) {
    const last = samples[samples.length - 1];
    const e = lastMove;
    gestures.forEach((g, i) => {
      if (g.kind === 'tap' && states[i] === 'began') {
        const history = tapHistory.get(g);
        const count = history && first.t - history.lastUp <= DOUBLE_TAP_DELAY ? history.count + 1 : 1;
        const needed = (g.config.numberOfTaps as number | undefined) ?? 1;
        if (count >= needed) { states[i] = 'ended'; tapHistory.delete(g); on(g, 'onStart', e); on(g, 'onEnd', e, true); on(g, 'onFinalize', e, true); }
        else { states[i] = 'idle'; tapHistory.set(g, { count, lastUp: last.t }); }
        return;
      }
      if (states[i] === 'active') { states[i] = 'ended'; on(g, 'onEnd', e, true); on(g, 'onFinalize', e, true); }
      else if (states[i] === 'began') { states[i] = 'failed'; on(g, 'onFinalize', e, false); }
    });
  }
  return { stackTookTouch, states: gestures.map((g, i) => `${g.kind}:${states[i]}`) };
}

/**
 * A one-finger drag from (x, y) by (dx, dy) over `ms`, sampled every ~16 ms like a
 * touchscreen (60 Hz), at constant speed: a deliberate swipe.
 */
export function drag(x: number, y: number, dx: number, dy: number, ms = 200): TouchSample[] {
  const steps = Math.max(2, Math.round(ms / 16));
  return Array.from({ length: steps + 1 }, (_, i) => ({ x: x + (dx * i) / steps, y: y + (dy * i) / steps, t: (ms * i) / steps }));
}

/**
 * A quick flick: most of the distance in the last few samples, released still moving fast.
 */
export function flick(x: number, y: number, dx: number, dy = 0): TouchSample[] {
  const fractions = [0, 0.1, 0.35, 0.7, 1];
  return fractions.map((f, i) => ({ x: x + dx * f, y: y + dy * f, t: i * 16 }));
}
