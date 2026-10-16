import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A form open while a tablet rotates (Android): the keyboard closes and the KeyboardAvoidingView is re-created, so the
 * sheet is laid out again for the new window instead of keeping the old orientation's height (found on the Android 17
 * tablet emulator, 2026-10-16). The keyboard itself (which never changes the window's width) never triggers it.
 */
const state = vi.hoisted(() => ({ os: 'android', window: { width: 800, height: 1280 }, dismiss: vi.fn() }));
vi.mock('react-native', () => ({
  Platform: { get OS() { return state.os; } },
  Keyboard: { dismiss: state.dismiss },
  useWindowDimensions: () => state.window,
}));

const { useKeyboardAvoidingKey } = await import('@/layout/useDismissKeyboardOnResize');

let root: ReactTestRenderer;
let key = '';
function Probe({ active }: { active: boolean }) {
  key = useKeyboardAvoidingKey(active);
  return null;
}
const render = async (active = true) => {
  await act(async () => { root = create(createElement(Probe, { active })); });
};
const rerender = async (window: { width: number; height: number }, active = true) => {
  state.window = window;
  await act(async () => root.update(createElement(Probe, { active })));
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.os = 'android';
  state.window = { width: 800, height: 1280 };
  state.dismiss.mockClear();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('keyboard forms across a rotation or resize', () => {
  it('Android: a rotation closes the keyboard and gives the KeyboardAvoidingView a new key', async () => {
    await render();
    expect(key).toBe('keyboard-avoiding-800');
    expect(state.dismiss).not.toHaveBeenCalled();
    await rerender({ width: 1280, height: 800 });
    expect(key).toBe('keyboard-avoiding-1280');
    expect(state.dismiss).toHaveBeenCalledTimes(1);
  });

  it('a height-only change (what a keyboard could cause) never closes it or re-creates the view', async () => {
    await render();
    await rerender({ width: 800, height: 700 });
    expect(key).toBe('keyboard-avoiding-800');
    expect(state.dismiss).not.toHaveBeenCalled();
  });

  it('a form that is mounted but not shown never touches the keyboard', async () => {
    await render(false);
    await rerender({ width: 1280, height: 800 }, false);
    expect(state.dismiss).not.toHaveBeenCalled();
  });

  it('iOS (which sends a keyboard event on rotation) keeps the keyboard', async () => {
    state.os = 'ios';
    await render();
    await rerender({ width: 1180, height: 820 });
    expect(state.dismiss).not.toHaveBeenCalled();
  });
});

describe('every Android KeyboardAvoidingView (behavior "height") is keyed to the window', () => {
  const source = (path: string) => readFileSync(resolve(__dirname, '../src', path), 'utf8');
  it('the sheets with a keyboard form', () => {
    for (const path of ['components/ReflectionSheet.tsx', 'components/ReportIssueSheet.tsx', 'components/DeleteAccountSheet.tsx', 'components/SyncPassphraseSheet.tsx', 'components/ChangeSyncPasswordSheet.tsx', 'components/MushafIndexSheet.tsx', 'components/MushafPageSelector.tsx']) {
      const file = source(path);
      const tags = file.match(/<KeyboardAvoidingView[\s>]/g)?.length ?? 0;
      expect(tags, path).toBeGreaterThan(0);
      expect(file.match(/<KeyboardAvoidingView key=\{keyboardKey\}/g)?.length, path).toBe(tags);
    }
  });
});
