import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@/services/quranAsset', () => ({ openBundledQuran: async () => { throw new Error('unused in this test'); } }));

const { ApiError } = await import('@/services/api');
const { withRetry } = await import('@/services/retry');

describe('withRetry', () => {
  it('returns the result immediately on first success — no delay, no extra calls', async () => {
    const operation = vi.fn(async () => 'ok');
    await expect(withRetry(operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries a transient (network) failure and succeeds on a later attempt', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiError('network down', 'network'))
      .mockResolvedValueOnce('recovered');

    await expect(withRetry(operation)).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('gives up after a bounded number of attempts, never retrying indefinitely', async () => {
    const operation = vi.fn(async () => {
      throw new ApiError('still down', 'backend_unavailable');
    });

    await expect(withRetry(operation)).rejects.toBeInstanceOf(ApiError);
    // Bounded: an initial attempt plus a small, fixed number of retries.
    expect(operation.mock.calls.length).toBeGreaterThan(1);
    expect(operation.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('never retries a permanent 4xx (invalid_request) — fails on the very first attempt', async () => {
    const operation = vi.fn(async () => {
      throw new ApiError('bad request', 'invalid_request', 400);
    });

    await expect(withRetry(operation)).rejects.toBeInstanceOf(ApiError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('never retries a non-ApiError (e.g. a programming error)', async () => {
    const operation = vi.fn(async () => {
      throw new TypeError('boom');
    });

    await expect(withRetry(operation)).rejects.toBeInstanceOf(TypeError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries a rate-limited (429) response, since it is transient', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiError('slow down', 'rate_limited', 429))
      .mockResolvedValueOnce('ok');

    await expect(withRetry(operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
