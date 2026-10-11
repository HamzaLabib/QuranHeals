import { beforeEach, describe, expect, it, vi } from 'vitest';

/** services/shareImage.ts: capture sizing, single vs. multi-card sharing, and write-only saving (native modules mocked). */

const state = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android',
  capture: vi.fn(),
  release: vi.fn(),
  isAvailable: vi.fn(),
  shareAsync: vi.fn(),
  shareFiles: vi.fn(),
  hasMultiModule: true,
  getPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  saveToLibrary: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { get OS() { return state.os; } } }));
vi.mock('react-native-view-shot', () => ({ captureRef: state.capture, releaseCapture: state.release }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: state.isAvailable, shareAsync: state.shareAsync }));
vi.mock('expo-media-library/legacy', () => ({
  getPermissionsAsync: state.getPermissions,
  requestPermissionsAsync: state.requestPermissions,
  saveToLibraryAsync: state.saveToLibrary,
}));
vi.mock('@/services/shareFilesModule', () => ({
  loadNativeShareFilesModule: () => (state.hasMultiModule ? { shareFilesAsync: state.shareFiles } : null),
}));

const { captureCardImage, releaseCardImages, saveCardImages, shareCardImages, toFileUrl } = await import('@/services/shareImage');

beforeEach(() => {
  state.os = 'ios';
  state.hasMultiModule = true;
  state.capture.mockReset().mockResolvedValue('file:///cache/card.png');
  state.release.mockReset();
  state.isAvailable.mockReset().mockResolvedValue(true);
  state.shareAsync.mockReset().mockResolvedValue(undefined);
  state.shareFiles.mockReset().mockResolvedValue(undefined);
  state.getPermissions.mockReset().mockResolvedValue({ granted: true, canAskAgain: true });
  state.requestPermissions.mockReset().mockResolvedValue({ granted: true, canAskAgain: true });
  state.saveToLibrary.mockReset().mockResolvedValue(undefined);
});

describe('capture', () => {
  const view = { current: {} as never };

  it('iOS: PNG temp file at the laid-out size (no point-based resize)', async () => {
    await captureCardImage(view, { width: 1080, height: 1920 }, 'quran-heals-94-5-1');
    expect(state.capture).toHaveBeenCalledWith(view, { format: 'png', result: 'tmpfile' });
  });

  it('Android: exact pixel size and a readable file name', async () => {
    state.os = 'android';
    await captureCardImage(view, { width: 1080, height: 1350 }, 'quran-heals-94-5-1');
    expect(state.capture).toHaveBeenCalledWith(view, { format: 'png', result: 'tmpfile', width: 1080, height: 1350, fileName: 'quran-heals-94-5-1' });
  });

  it('refuses to capture a card that is not mounted', async () => {
    await expect(captureCardImage({ current: null }, { width: 1080, height: 1080 }, 'x-y-z')).rejects.toThrow();
    expect(state.capture).not.toHaveBeenCalled();
  });
});

describe('sharing', () => {
  it('one card goes through the system share sheet as a PNG', async () => {
    await expect(shareCardImages(['file:///a.png'], 'Share Ayah')).resolves.toBe('shared');
    expect(state.shareAsync).toHaveBeenCalledWith('file:///a.png', { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share Ayah' });
    expect(state.shareFiles).not.toHaveBeenCalled();
  });

  it('several cards go together, in order, through one share sheet', async () => {
    const uris = ['file:///1.png', 'file:///2.png', 'file:///3.png'];
    await expect(shareCardImages(uris, 'Share Ayah')).resolves.toBe('shared');
    expect(state.shareFiles).toHaveBeenCalledWith(uris, 'Share Ayah');
    expect(state.shareAsync).not.toHaveBeenCalled();
  });

  it('a binary without the multi-file module never falls back to sharing one card of several', async () => {
    state.hasMultiModule = false;
    await expect(shareCardImages(['file:///1.png', 'file:///2.png'], 'Share Ayah')).resolves.toBe('multiple-unavailable');
    expect(state.shareAsync).not.toHaveBeenCalled();
  });

  it('reports when the device cannot share at all', async () => {
    state.isAvailable.mockResolvedValueOnce(false);
    await expect(shareCardImages(['file:///a.png'], 'Share Ayah')).resolves.toBe('unavailable');
  });
});

describe('saving', () => {
  it('asks only for write (add-only) access, only when needed, then saves every card in order', async () => {
    state.getPermissions.mockResolvedValueOnce({ granted: false, canAskAgain: true });
    await expect(saveCardImages(['file:///1.png', 'file:///2.png'])).resolves.toEqual({ status: 'saved', count: 2 });
    expect(state.getPermissions).toHaveBeenCalledWith(true);
    expect(state.requestPermissions).toHaveBeenCalledWith(true);
    expect(state.saveToLibrary.mock.calls).toEqual([['file:///1.png'], ['file:///2.png']]);
  });

  it('does not prompt again when access is already granted', async () => {
    await saveCardImages(['file:///1.png']);
    expect(state.requestPermissions).not.toHaveBeenCalled();
  });

  it('a refusal saves nothing and says whether the system will ask again', async () => {
    state.getPermissions.mockResolvedValueOnce({ granted: false, canAskAgain: false });
    await expect(saveCardImages(['file:///1.png'])).resolves.toEqual({ status: 'denied', canAskAgain: false });
    expect(state.requestPermissions).not.toHaveBeenCalled();
    expect(state.saveToLibrary).not.toHaveBeenCalled();
  });
});

describe('iOS capture paths', () => {
  const IOS_PATH = '/private/var/mobile/Containers/Data/Application/ABC/tmp/ReactNative/1F2E.png';

  it('a bare path (what view-shot returns on iOS) is shared and saved as a file:// URL', async () => {
    await shareCardImages([IOS_PATH], 'Share Ayah');
    expect(state.shareAsync.mock.calls[0][0]).toBe(`file://${IOS_PATH}`);
    await shareCardImages([IOS_PATH, IOS_PATH], 'Share Ayah');
    expect(state.shareFiles.mock.calls[0][0]).toEqual([`file://${IOS_PATH}`, `file://${IOS_PATH}`]);
    await saveCardImages([IOS_PATH]);
    expect(state.saveToLibrary).toHaveBeenCalledWith(`file://${IOS_PATH}`);
  });

  it('Android file:// URIs pass through; cleanup keeps the original string view-shot expects', () => {
    expect(toFileUrl('file:///data/user/0/com.quranheals.app/cache/card.png')).toBe('file:///data/user/0/com.quranheals.app/cache/card.png');
    expect(toFileUrl('/tmp/a b.png')).toBe('file:///tmp/a%20b.png');
    releaseCardImages([IOS_PATH]);
    expect(state.release).toHaveBeenCalledWith(IOS_PATH);
  });
});

describe('cleanup', () => {
  it('releases every temp file and tolerates one that is already gone', () => {
    state.release.mockImplementationOnce(() => { throw new Error('missing'); });
    expect(() => releaseCardImages(['file:///1.png', 'file:///2.png'])).not.toThrow();
    expect(state.release).toHaveBeenCalledTimes(2);
  });
});
