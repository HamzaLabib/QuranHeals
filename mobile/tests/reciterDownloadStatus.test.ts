import { describe, expect, it } from 'vitest';

import { reciterDownloadStatus } from '@/audio/downloadStatus';
import { IDLE_DOWNLOAD, type DownloadState } from '@/audio/downloads';
import { downloadableSurahs, getReciter, OFFLINE_DOWNLOADS_PERMITTED, timedSurahs } from '@/audio/reciters';

const maher = getReciter('maher')!;
const all = (reciter = maher) => timedSurahs(reciter);
const job = (patch: Partial<DownloadState>): DownloadState => ({ ...IDLE_DOWNLOAD, reciterId: 'maher', ...patch });

describe('the Favorite Reciter download icon state', () => {
  it('downloads ship turned on (owner decision, 2026-10-24): nothing stored is "none", never a check without files', () => {
    expect(OFFLINE_DOWNLOADS_PERMITTED).toBe(true);
    expect(reciterDownloadStatus({ permitted: OFFLINE_DOWNLOADS_PERMITTED, reciter: maher, stored: [], download: IDLE_DOWNLOAD })).toBe('none');
  });

  it('with the switch turned off again: not permitted, never a check without files', () => {
    expect(reciterDownloadStatus({ permitted: false, reciter: maher, stored: [], download: IDLE_DOWNLOAD })).toBe('not-permitted');
    expect(reciterDownloadStatus({ permitted: false, reciter: maher, stored: [1, 2], download: IDLE_DOWNLOAD })).toBe('not-permitted');
  });

  it('the check (complete) only when every playable surah is stored as a verified file', () => {
    expect(reciterDownloadStatus({ permitted: true, reciter: maher, stored: all(), download: IDLE_DOWNLOAD })).toBe('complete');
    expect(reciterDownloadStatus({ permitted: true, reciter: maher, stored: all().slice(1), download: IDLE_DOWNLOAD })).toBe('partial');
    // Files for surahs without verified timing never count (Islam Sobhi 17 is not playable).
    const sobhi = getReciter('islam-sobhi')!;
    const storable = downloadableSurahs(sobhi);
    expect(reciterDownloadStatus({ permitted: true, reciter: sobhi, stored: [17, ...storable.slice(1)], download: IDLE_DOWNLOAD })).toBe('partial');
    expect(reciterDownloadStatus({ permitted: true, reciter: sobhi, stored: storable, download: IDLE_DOWNLOAD })).toBe('complete');
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

  it('a reciter with nothing to download is unavailable: streaming-only timed previews and per-ayah recordings', () => {
    for (const id of ['ahmed-salama', 'jaber']) expect(reciterDownloadStatus({ permitted: true, reciter: getReciter(id)!, stored: [], download: IDLE_DOWNLOAD }), id).toBe('unavailable'); // playable, but nothing storable
  });
});
