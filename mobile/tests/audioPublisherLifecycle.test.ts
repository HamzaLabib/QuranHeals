import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The publication worker's lifecycle (tools/quran-audio/review/cloud/publisher.mjs): after stop() resolves, nothing it
 * started is still running and nothing it scheduled will start — so a database pool can be closed safely afterwards
 * (the cause of the 57P01 teardown errors). A recording fake pool: no database needed.
 */
const tools = resolve(__dirname, '../../tools/quran-audio');
const { createPublisher } = await import(pathToFileURL(join(tools, 'review/cloud/publisher.mjs')).href);

function fakes({ queryDelayMs = 0, keys = ['a', 'b'] } = {}) {
  const calls: string[] = [];
  let open = 0;
  const query = async (sql: string) => {
    open += 1;
    try {
      if (queryDelayMs) await new Promise((r) => setTimeout(r, queryDelayMs));
      calls.push(sql.trim().split(/\s+/)[0]);
      return { rows: [] };
    } finally { open -= 1; }
  };
  const pool = { query, connect: async () => { calls.push('connect'); return { query, release: () => undefined }; } };
  const store = { hasLog: () => true, load: () => ({ events: [{ hash: 'h' }] }), tasks: () => new Map(keys.map((k) => [k, {}])) };
  return { pool, store, calls, openQueries: () => open };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('publication worker: stop() leaves nothing running', () => {
  it('without stop, a notification schedules a follow-up tick (the control)', async () => {
    const f = fakes();
    const p = createPublisher({ pool: f.pool, store: f.store, audio: {}, autoStart: true });
    await p.notify('a');
    await wait(150);
    expect(f.calls).toContain('connect'); // the tick claimed jobs through a transaction
    await p.stop();
  });

  it('stop() cancels the follow-up tick a notification scheduled: no database work after it resolves', async () => {
    const f = fakes();
    const p = createPublisher({ pool: f.pool, store: f.store, audio: {}, autoStart: true });
    await p.notify('a');
    await p.stop();
    const after = f.calls.length;
    await wait(150);
    expect(f.calls.length).toBe(after);
    expect(f.calls).not.toContain('connect');
  });

  it('stop() waits for a notification still in flight (the server fires them without awaiting)', async () => {
    const f = fakes({ queryDelayMs: 80 });
    const p = createPublisher({ pool: f.pool, store: f.store, audio: {}, autoStart: true });
    void p.notify('a');
    await wait(5);
    expect(f.openQueries()).toBe(1);
    await p.stop();
    expect(f.openQueries()).toBe(0);
    expect(f.calls).toEqual(['insert']);
    await wait(150);
    expect(f.calls).toEqual(['insert']); // and its follow-up tick never started
  });

  it('stop() waits for the startup sweep that start() begins, and clears the timers', async () => {
    const f = fakes({ queryDelayMs: 20, keys: ['a', 'b', 'c'] });
    const p = createPublisher({ pool: f.pool, store: f.store, audio: {}, autoStart: true, intervalMs: 30, sweepMs: 30 });
    p.start();
    await p.stop();
    expect(f.openQueries()).toBe(0);
    const after = f.calls.length;
    await wait(150);
    expect(f.calls.length).toBe(after); // no interval tick or sweep after stop
  });
});
