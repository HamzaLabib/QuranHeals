import type { StreamCheck } from './engine';

type Probe = { status: number; url?: string; redirected?: boolean; headers: { get(name: string): string | null } };
export type StreamProbe = (url: string, method: 'HEAD' | 'RANGE') => Promise<Probe>;

/**
 * The size a response states for the whole file, or null when it states none that can be trusted: Content-Range's
 * total ("bytes 0-1/15707847") first; else Content-Length, but only for a whole, unencoded body (a compressed or
 * partial body's length is not the file's size).
 */
export function statedSize(response: Probe): number | null {
  const range = /\/(\d+)\s*$/.exec(response.headers.get('content-range') ?? '');
  if (range) return Number(range[1]);
  const encoding = (response.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
  if (response.status !== 200 || (encoding !== '' && encoding !== 'identity')) return null;
  const length = Number(response.headers.get('content-length'));
  return Number.isInteger(length) && length > 0 ? length : null;
}

/**
 * The stream check a whole-surah source must pass before it plays: its URL must still answer with the verified file.
 * It fails closed: anything short of a positive answer refuses the stream (the engine then tries the next verified
 * source of the same reciter, or stops with an error). It is not the proof of identity (that is the approved review:
 * listening, catalogue, size); it guards against the file having changed since, together with the duration check the
 * engine makes once the file is loaded.
 *  - 'redirected': the final URL is another file (MP3Quran sends a missing surah to another Sheikh: 2026-10-18, Islam
 *    Sobhi 037 → muhammad-minshawi/r1/037.mp3), or a 3xx answer;
 *  - 'missing': 404 / 410, or 401 / 403 (an expired or withdrawn URL);
 *  - 'size-mismatch': a trustworthy size that is not the verified one;
 *  - 'unverifiable': no answer (offline, a timeout), another status, or no trustworthy size;
 *  - 'ok': same URL, the verified size.
 * Every load is checked again (nothing is remembered): a URL that answered correctly once can start redirecting later.
 * A host that refuses HEAD (405 / 501) is asked for two bytes instead (a Range request), only where `rangeRequests`
 * says the host answers byte ranges (else React Native would download the whole file to read its headers).
 */
export function createStreamCheck(probe: StreamProbe): (uri: string, bytes: number | null, options?: { rangeRequests?: boolean }) => Promise<StreamCheck> {
  return async (uri, bytes, options = {}) => {
    if (bytes === null) return 'unverifiable';
    const ask = async (method: 'HEAD' | 'RANGE'): Promise<Probe | null> => probe(uri, method).catch(() => null);
    let response = await ask('HEAD');
    if (response && (response.status === 405 || response.status === 501) && options.rangeRequests) response = await ask('RANGE');
    if (!response) return 'unverifiable';
    if (response.redirected || (response.url && response.url !== uri) || (response.status >= 300 && response.status < 400)) return 'redirected';
    if ([401, 403, 404, 410].includes(response.status)) return 'missing';
    if (response.status !== 200 && response.status !== 206) return 'unverifiable';
    const size = statedSize(response);
    if (size === null) return 'unverifiable';
    if (size !== bytes) return 'size-mismatch';
    return 'ok';
  };
}
