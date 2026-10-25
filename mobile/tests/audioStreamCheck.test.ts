import { describe, expect, it } from 'vitest';

import { SOURCE_REGISTRY } from '@/audio/sourceRegistry';
import { createStreamCheck, statedSize, type StreamProbe } from '@/audio/streamCheck';

const SOBHI_36 = 'https://cdn.mp3quran.net/audio/islam-sobhi/r1/036.mp3';
const SIZE = 15_707_847;

type Answer = { status: number; url?: string; redirected?: boolean; headers?: Record<string, string> } | Error;
/** A fake host: answers per method ('HEAD' | 'RANGE'), records what it was asked. */
function host(answers: { HEAD?: Answer; RANGE?: Answer }) {
  const asked: string[] = [];
  const probe: StreamProbe = async (url, method) => {
    asked.push(method);
    const answer = answers[method];
    if (!answer) throw new Error(`no ${method}`);
    if (answer instanceof Error) throw answer;
    const headers = Object.fromEntries(Object.entries(answer.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { status: answer.status, url: answer.url ?? url, redirected: answer.redirected ?? false, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } };
  };
  return { probe, asked };
}
const check = (answers: Parameters<typeof host>[0], options: { rangeRequests?: boolean } = {}, bytes: number | null = SIZE) => createStreamCheck(host(answers).probe)(SOBHI_36, bytes, options);

describe('the whole-surah stream check (fails closed)', () => {
  it('accepts the verified file: same URL, the verified size', async () => {
    expect(await check({ HEAD: { status: 200, headers: { 'Content-Length': String(SIZE) } } })).toBe('ok');
  });

  it("refuses MP3Quran's redirect to another Sheikh, however the platform reports it", async () => {
    const minshawi = 'https://cdn.mp3quran.net/audio/muhammad-minshawi/r1/036.mp3';
    expect(await check({ HEAD: { status: 200, url: minshawi, redirected: true, headers: { 'Content-Length': '9000000' } } })).toBe('redirected');
    expect(await check({ HEAD: { status: 200, url: minshawi, headers: { 'Content-Length': String(SIZE) } } })).toBe('redirected'); // even at the same size
    expect(await check({ HEAD: { status: 302, headers: { Location: minshawi } } })).toBe('redirected');
  });

  it('refuses another size', async () => {
    expect(await check({ HEAD: { status: 200, headers: { 'Content-Length': '123' } } })).toBe('size-mismatch');
  });

  it('refuses a missing file or an expired / withdrawn URL', async () => {
    for (const status of [401, 403, 404, 410]) expect(await check({ HEAD: { status } })).toBe('missing');
  });

  it('cannot verify (and so refuses) without a trustworthy size: none, a compressed body, a garbled value', async () => {
    expect(await check({ HEAD: { status: 200 } })).toBe('unverifiable');
    expect(await check({ HEAD: { status: 200, headers: { 'Content-Length': '3101', 'Content-Encoding': 'gzip' } } })).toBe('unverifiable');
    expect(await check({ HEAD: { status: 200, headers: { 'Content-Length': 'abc' } } })).toBe('unverifiable');
    expect(await check({ HEAD: { status: 200, headers: { 'Content-Length': String(SIZE) } } }, {}, null)).toBe('unverifiable'); // nothing verified to compare
  });

  it('cannot verify offline, on a timeout, or on a server error', async () => {
    expect(await check({ HEAD: new Error('Network request failed') })).toBe('unverifiable');
    expect(await check({ HEAD: Object.assign(new Error('aborted'), { name: 'AbortError' }) })).toBe('unverifiable');
    expect(await check({ HEAD: { status: 503 } })).toBe('unverifiable');
  });

  it('asks a host that refuses HEAD for two bytes, only where byte ranges are audited, and reads the size from Content-Range', async () => {
    const refusing = { HEAD: { status: 405 }, RANGE: { status: 206, headers: { 'Content-Range': `bytes 0-1/${SIZE}`, 'Content-Length': '2' } } };
    const audited = host(refusing);
    expect(await createStreamCheck(audited.probe)(SOBHI_36, SIZE, { rangeRequests: true })).toBe('ok');
    expect(audited.asked).toEqual(['HEAD', 'RANGE']);
    const unaudited = host(refusing);
    expect(await createStreamCheck(unaudited.probe)(SOBHI_36, SIZE, { rangeRequests: false })).toBe('unverifiable');
    expect(unaudited.asked).toEqual(['HEAD']);
    expect(await check({ HEAD: { status: 501 }, RANGE: { status: 206, headers: { 'Content-Range': 'bytes 0-1/99' } } }, { rangeRequests: true })).toBe('size-mismatch');
  });

  it('checks again on every load (a URL that answered correctly once can start redirecting later)', async () => {
    const h = host({ HEAD: { status: 200, headers: { 'Content-Length': String(SIZE) } } });
    const c = createStreamCheck(h.probe);
    expect(await c(SOBHI_36, SIZE)).toBe('ok');
    expect(await c(SOBHI_36, SIZE)).toBe('ok');
    expect(h.asked).toEqual(['HEAD', 'HEAD']);
    const failing = host({ HEAD: new Error('offline') });
    const f = createStreamCheck(failing.probe);
    await f(SOBHI_36, SIZE);
    await f(SOBHI_36, SIZE);
    expect(failing.asked).toEqual(['HEAD', 'HEAD']); // a failure is not remembered
  });
});

describe('the stated size of a response', () => {
  const r = (status: number, headers: Record<string, string>) => ({ status, headers: { get: (n: string) => headers[n] ?? null } });
  it("prefers Content-Range's total, which CDNs keep for ranges", () => {
    expect(statedSize(r(206, { 'content-range': 'bytes 0-1/15707847', 'content-length': '2' }))).toBe(15_707_847);
  });
  it("takes Content-Length only for a whole, unencoded body", () => {
    expect(statedSize(r(200, { 'content-length': '15707847' }))).toBe(15_707_847);
    expect(statedSize(r(200, { 'content-length': '15707847', 'content-encoding': 'identity' }))).toBe(15_707_847);
    expect(statedSize(r(200, { 'content-length': '900', 'content-encoding': 'br' }))).toBeNull();
    expect(statedSize(r(206, { 'content-length': '2' }))).toBeNull();
    expect(statedSize(r(200, {}))).toBeNull();
  });
});

describe('what the app compares with', () => {
  it('finds the verified size, length and range support of a registered stream by URL; nothing for an unlisted URL', () => {
    expect(SOURCE_REGISTRY.sourceByUrl('https://cdn.mp3quran.net/audio/maher-muaiqly/r3/018.mp3')).toMatchObject({ reciterId: 'maher', surah: 18, bytes: expect.any(Number), format: { rangeRequests: true } });
    // Sobhi 74: listed by MP3Quran, not verified (clipped opening): no size or length to compare with.
    expect(SOURCE_REGISTRY.sourceByUrl('https://cdn.mp3quran.net/audio/islam-sobhi/r1/074.mp3')).toMatchObject({ bytes: null, durationMs: null });
    expect(SOURCE_REGISTRY.sourceByUrl('https://cdn.mp3quran.net/audio/islam-sobhi/r1/037.mp3')).toBeNull();
  });
});
