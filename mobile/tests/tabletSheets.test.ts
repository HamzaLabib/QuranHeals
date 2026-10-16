import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGES } from '@/localization/messages';

/** Bottom sheets on phones and tablets: the same sheet, centred and at most 560 pt wide on a tablet-sized window. */
const state = vi.hoisted(() => ({ window: { width: 390, height: 844 } }));

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  return {
    Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
    StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
    Modal: ({ visible, children, ...rest }: { visible: boolean; children: unknown }) => (visible ? h('Modal', rest, children as never) : null),
    ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View',
    useWindowDimensions: () => state.window,
  };
});
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 24, bottom: 20, left: 0, right: 0 }) }));
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette, useThemeName: () => 'light', useThemedStyles: (factory: (colors: unknown) => unknown) => factory(lightPalette) };
});
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: 'en', messages: MESSAGES.en }) }));

const { ConfirmSheet } = await import('@/components/ConfirmSheet');
const { SheetSafeArea } = await import('@/layout/SheetSafeArea');

let root: ReactTestRenderer;
const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean));
const sheetStyle = () => flat(root.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'confirm')[0].props.style);
const render = async (element: ReturnType<typeof createElement>) => {
  await act(async () => { root = create(element); });
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.window = { width: 390, height: 844 };
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

const confirm = createElement(ConfirmSheet, { visible: true, testID: 'confirm', title: 'Delete?', cancelLabel: 'Cancel', confirmLabel: 'Delete', onConfirm: () => undefined, onCancel: () => undefined });

describe('a positioned bottom sheet (ConfirmSheet)', () => {
  it('phones: edge to edge, exactly as before', async () => {
    for (const width of [320, 390, 440, 599]) {
      state.window = { width, height: 844 };
      await render(confirm);
      expect(sheetStyle()).toMatchObject({ position: 'absolute', left: 0, right: 0, bottom: 0 });
      await act(async () => root.unmount());
    }
  });

  it('tablets, portrait and landscape: centred, 560 pt wide', async () => {
    for (const [width, height] of [[744, 1133], [820, 1180], [1180, 820], [1376, 1032]]) {
      state.window = { width, height };
      await render(confirm);
      const style = sheetStyle();
      expect(style.left).toBe((width - 560) / 2);
      expect(style.right).toBe((width - 560) / 2);
      expect(width - style.left - style.right).toBe(560);
      await act(async () => root.unmount());
    }
  });

  it('follows a rotation while open', async () => {
    state.window = { width: 820, height: 1180 };
    await render(confirm);
    expect(sheetStyle().left).toBe(130);
    state.window = { width: 1180, height: 820 };
    // useWindowDimensions re-renders the sheet on a real device; here a new element does.
    await act(async () => root.update(createElement(ConfirmSheet, { ...(confirm.props as object) } as never)));
    expect(sheetStyle().left).toBe(310);
    expect(root.root.findAll((n) => n.props.testID === 'confirm-cancel' && typeof n.type === 'string')).toHaveLength(1);
  });
});

describe('a sheet in a flex column (SheetSafeArea)', () => {
  const safeArea = () => root.root.findByType('SafeAreaView' as never);
  it('phones: only its own style; tablets: centred, 560 pt at most', async () => {
    await render(createElement(SheetSafeArea, { style: { maxHeight: '85%', width: '100%' }, edges: ['bottom'] }));
    expect(flat(safeArea().props.style)).toEqual({ maxHeight: '85%', width: '100%' });
    expect(safeArea().props.edges).toEqual(['bottom']);
    await act(async () => root.unmount());
    state.window = { width: 1180, height: 820 };
    await render(createElement(SheetSafeArea, { style: { maxHeight: '85%', width: '100%' } }));
    expect(flat(safeArea().props.style)).toEqual({ maxHeight: '85%', width: '100%', maxWidth: 560, alignSelf: 'center' });
  });
});
