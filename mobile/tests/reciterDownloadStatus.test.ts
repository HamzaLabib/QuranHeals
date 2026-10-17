import { describe, expect, it } from 'vitest';

import { reciterDownloadStatus } from '@/audio/downloadStatus';
import { IDLE_DOWNLOAD, type DownloadState } from '@/audio/downloads';
import { getReciter, OFFLINE_DOWNLOADS_PERMITTED, timedSurahs } from '@/audio/reciters';

const maher = getReciter('maher')!;
const husary = getReciter('husary')!;
const all = (reciter = maher) => timedSurahs(reciter);
const job = (patch: Partial<DownloadState>): DownloadState => ({ ...IDLE_DOWNLOAD, reciterId: 'maher', ...patch });

describe('the Favorite Reciter download icon state', () => {
  it('downloads ship turned off (licensing): not permitted, never a check without files', () => {
    expect(OFFLINE_DOWNLOADS_PERMITTED).toBe(false);
    expect(reciterDownloadStatus({ permitted: OFFLINE_DOWNLOADS_PERMITTED, reciter: maher, stored: [], download: IDLE_DOWNLOAD })).toBe('not-permitted');
    expect(reciterDownloadStatus({ permitted: false, reciter: maher, stored: [1, 2], download: IDLE_DOWNLOAD })).toBe('not-permitted');
  });

  it('the check (complete) only when every playable surah is stored as a verified file', () => {
    expect(reciterDownloadStatus({ permitted: true, reciter: maher, stored: all(), download: IDLE_DOWNLOAD })).toBe('complete');
    expect(reciterDownloadStatus({ permitted: true, reciter: maher, stored: all().slice(1), download: IDLE_DOWNLOAD })).toBe('partial');
    // Files for surahs without verified timing never count (Husary 1 is not playable).
    expect(reciterDownloadStatus({ permitted: true, reciter: husary, stored: [1, ...all(husary).slice(1)], download: IDLE_DOWNLOAD })).toBe('partial');
    expect(reciterDownloadStatus({ permitted: true, reciter: husary, stored: all(husary), download: IDLE_DOWNLOAD })).toBe('complete');
    // Verified files already on the device are shown as such even while downloads are off.
    expect(reciterDownloadStatus({ permitted: false, reciter: maher, stored: all(), download: IDLE_DOWNLOAD })).toBe('complete');
  });

  it('downloading, paused and failed (for this reciter only)', () => {
    expect(reciterDownloadStatus({ permitted: true, reciter: maher, stored: [], download: job({ phase: 'running' }) })).toBe('downloading');
    expect(reciterDownloadStatus({ permitted: true, reciter: maher, stored: [], download: job({ phase: 'paused' }) })).toBe('paused');
    expect(reciterDownloadStatus({ permitted: true, reciter: maher, stored: [], download: job({ phase: 'error', error: 'network' }) })).toBe('error');
    expect(reciterDownloadStatus({ permitted: true, reciter: maher, stored: [], download: job({ reciterId: 'husary', phase: 'running' }) })).toBe('none');
    expect(reciterDownloadStatus({ permitted: true, reciter: maher, stored: [], download: job({ phase: 'error', error: 'not-permitted' }) })).toBe('not-permitted');
  });

  it('a reciter with nothing playable to download is unavailable', () => {
    expect(reciterDownloadStatus({ permitted: true, reciter: getReciter('rifaat')!, stored: [], download: IDLE_DOWNLOAD })).toBe('unavailable');
  });
});
