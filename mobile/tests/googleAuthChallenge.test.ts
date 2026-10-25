import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Google sign-in bound to the backend's single-use challenge (auth/googleAuth.ts). expo-auth-session is mocked the way
 * it behaves (expo-auth-session/build/AuthRequestHooks.js useLoadedAuthRequest): a new request is built, asynchronously,
 * whenever extraParams change, and the previous one stays until it is ready.
 */
const state = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  challenges: [] as (string | null)[],
  fetched: 0,
  prompted: [] as (string | undefined)[],
  /** When true, the mocked provider ignores new extraParams (a request that never carries the nonce). */
  frozen: false,
  setResponse: null as null | ((r: unknown) => void),
}));

vi.mock('react-native', () => ({ Platform: { get OS() { return state.os; } } }));
vi.mock('@/auth/googleConfig', () => ({
  readGoogleClientIds: () => ({ ios: 'ios-id', android: 'android-id', web: 'web-id' }),
  googleClientIdForPlatform: () => 'client-id',
}));
vi.mock('@/auth/authApi', () => ({
  requestSignInChallenge: async () => {
    state.fetched += 1;
    return state.challenges.shift() ?? null;
  },
}));
vi.mock('expo-auth-session/providers/google', async () => {
  const { useCallback, useEffect, useState } = await import('react');
  return {
    useIdTokenAuthRequest: (config: { extraParams?: Record<string, string> }) => {
      const key = JSON.stringify(config.extraParams ?? {});
      const [request, setRequest] = useState<{ extraParams: Record<string, string> } | null>(null);
      const [response, setResponse] = useState<unknown>(null);
      state.setResponse = setResponse;
      useEffect(() => {
        if (state.frozen && request) return;
        const next = { extraParams: JSON.parse(key) as Record<string, string> };
        void Promise.resolve().then(() => setRequest(next));
      }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
      const promptAsync = useCallback(async () => {
        state.prompted.push(request?.extraParams.nonce);
        return { type: 'dismiss' } as const;
      }, [request]);
      return [request, response, promptAsync] as const;
    },
  };
});

const { useGoogleAuthRequest, NATIVE_CHALLENGE_WAIT_MS, WEB_CHALLENGE_REFRESH_MS } = await import('@/auth/googleAuth');

type Hook = ReturnType<typeof useGoogleAuthRequest>;
let latest: Hook | null = null;
let root: ReactTestRenderer | null = null;
function Probe({ bind }: { bind: boolean }) {
  latest = useGoogleAuthRequest({ bindSignIn: bind });
  return null;
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
async function mount(bind = true) {
  await act(async () => { root = create(createElement(Probe, { bind })); });
  await flush();
}
const NONCE_A = 'a'.repeat(64);
const NONCE_B = 'b'.repeat(64);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(state, { os: 'ios', challenges: [], fetched: 0, prompted: [], frozen: false });
});
afterEach(async () => {
  vi.useRealTimers();
  if (root) await act(async () => root!.unmount());
  root = null;
});

describe('Google sign-in challenge, iOS and Android (no gesture rule)', () => {
  it.each(['ios', 'android'] as const)('%s: nothing is fetched until the tap; the prompt then carries a fresh challenge', async (os) => {
    state.os = os;
    state.challenges = [NONCE_A];
    await mount();
    expect(state.fetched).toBe(0); // a guest merely opening Settings asks the backend for nothing
    let done!: Promise<unknown>;
    await act(async () => { done = latest![2](); });
    await flush();
    await act(async () => { await done; });
    expect(state.fetched).toBe(1);
    expect(state.prompted).toEqual([NONCE_A]);
  });

  it('every attempt gets its own challenge (a failed or cancelled one is never reused)', async () => {
    state.challenges = [NONCE_A, NONCE_B];
    await mount();
    for (let i = 0; i < 2; i++) {
      let done!: Promise<unknown>;
      await act(async () => { done = latest![2](); });
      await flush();
      await act(async () => { await done; });
    }
    expect(state.prompted).toEqual([NONCE_A, NONCE_B]);
  });

  it('without a challenge (offline, older backend) it prompts at once, unbound, as before', async () => {
    state.challenges = [null];
    await mount();
    await act(async () => { await latest![2](); });
    expect(state.prompted).toEqual([undefined]);
  });

  it('if the bound request never appears, it prompts unbound after the wait instead of hanging', async () => {
    vi.useFakeTimers();
    state.challenges = [NONCE_A];
    await mount();
    state.frozen = true;
    let done!: Promise<unknown>;
    await act(async () => { done = latest![2](); });
    await flush();
    expect(state.prompted).toEqual([]);
    await act(async () => { vi.advanceTimersByTime(NATIVE_CHALLENGE_WAIT_MS); });
    await act(async () => { await done; });
    expect(state.prompted).toEqual([undefined]);
  });

  it('after a bound attempt, a retry without a challenge prompts with NO nonce, never the used one (it would be a replay)', async () => {
    state.challenges = [NONCE_A, null];
    await mount();
    for (let i = 0; i < 2; i++) {
      let done!: Promise<unknown>;
      await act(async () => { done = latest![2](); });
      await flush();
      await act(async () => { await done; });
    }
    expect(state.prompted).toEqual([NONCE_A, undefined]);
  });

  it('a second tap supersedes a waiting first one: one prompt, and the first settles as dismissed', async () => {
    state.challenges = [NONCE_A, NONCE_B];
    await mount();
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = latest![2]();
      second = latest![2]();
    });
    await flush();
    await act(async () => { await Promise.all([first, second]); });
    expect(await first).toEqual({ type: 'dismiss' });
    expect(state.prompted).toEqual([NONCE_B]);
  });

  it('leaving the screen while a prompt waits cancels it: Google never opens afterwards', async () => {
    vi.useFakeTimers();
    state.challenges = [NONCE_A];
    await mount();
    state.frozen = true;
    let done!: Promise<unknown>;
    await act(async () => { done = latest![2](); });
    await flush();
    await act(async () => root!.unmount());
    root = null;
    await act(async () => { vi.advanceTimersByTime(NATIVE_CHALLENGE_WAIT_MS * 3); });
    expect(await done).toEqual({ type: 'dismiss' });
    expect(state.prompted).toEqual([]);
  });

  it('re-authentication (not bound) never fetches a challenge', async () => {
    state.challenges = [NONCE_A];
    await mount(false);
    await act(async () => { await latest![2](); });
    expect(state.fetched).toBe(0);
    expect(state.prompted).toEqual([undefined]);
  });
});

describe('Google sign-in challenge, web (the popup must open from the tap itself)', () => {
  it('fetches ahead while the button is shown, and the tap prompts synchronously with it (no fetch on the tap)', async () => {
    state.os = 'web';
    state.challenges = [NONCE_A];
    await mount();
    await flush();
    expect(state.fetched).toBe(1);
    const fetchedBeforeTap = state.fetched;
    await act(async () => { void latest![2](); });
    expect(state.fetched).toBe(fetchedBeforeTap);
    expect(state.prompted).toEqual([NONCE_A]);
  });

  it('a finished attempt gets a new challenge, and an unused one is refreshed before it expires', async () => {
    vi.useFakeTimers();
    state.os = 'web';
    state.challenges = [NONCE_A, NONCE_B, 'c'.repeat(64)];
    await mount();
    await flush();
    expect(state.fetched).toBe(1);
    await act(async () => { state.setResponse!({ type: 'dismiss' }); });
    await flush();
    expect(state.fetched).toBe(2);
    await act(async () => { vi.advanceTimersByTime(WEB_CHALLENGE_REFRESH_MS); });
    await flush();
    expect(state.fetched).toBe(3);
    expect(WEB_CHALLENGE_REFRESH_MS).toBeLessThan(10 * 60 * 1000); // the backend's expiry
  });

  it('when not bound (signed in, or re-authentication), nothing is fetched on web either', async () => {
    state.os = 'web';
    await mount(false);
    await flush();
    expect(state.fetched).toBe(0);
  });
});
