// Audio for the cloud dashboard (Phase 4.8.2). No recording is uploaded, mirrored or published:
//   direct     (CBR, every known provider) the reviewer's browser plays the ORIGINAL file from its provider, exactly as
//              the app streams it; /audio/<key> only redirects a signed-in reviewer there. Before that, the server
//              confirms the provider still serves a file of the reviewed size (a one-byte range request).
//   decoded    (VBR) browsers cannot seek a VBR MP3 exactly, so the server fetches the original into its temporary
//              scratch space, decodes it losslessly to PCM (peaks.py --pcm) and streams that to signed-in reviewers
//              only. The copy is disposable (ephemeral disk, size-limited, least recently used removed first).
//   unavailable no known https provider: the task stays visible with the reason.
// Waveforms (derived data, not audio) are computed once from the original (size and SHA-256 checked) and kept in the
// database; a waveform of another file is never shown for a recording.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { providerOf } from '../dashboard/dashboard-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PEAKS_PY = path.join(here, '..', 'dashboard', 'peaks.py');

/**
 * Phase 4.8.3: an MP3's bitrate mode from its encoder's own header frame: "Info" (CBR) or "Xing" (VBR) in the first
 * frame, after any ID3v2 tag. No such frame: unknown (never guessed from one frame's bitrate). Not an MP3: null.
 */
export function mp3Format(buf) {
  let o = 0;
  if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'ID3') o = 10 + ((buf[6] & 0x7f) << 21 | (buf[7] & 0x7f) << 14 | (buf[8] & 0x7f) << 7 | (buf[9] & 0x7f)) + (buf[5] & 0x10 ? 10 : 0);
  for (let i = 0; o + 4 <= buf.length && i < 4096; o++, i++) if (buf[o] === 0xff && (buf[o + 1] & 0xe6) === 0xe2) break; // MPEG audio, Layer III
  if (o + 4 > buf.length || buf[o] !== 0xff) return null;
  const mpeg1 = ((buf[o + 1] >> 3) & 3) === 3;
  const mono = ((buf[o + 3] >> 6) & 3) === 3;
  const side = mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
  const tag = buf.toString('latin1', o + 4 + side, o + 8 + side);
  const kbps = (mpeg1 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[buf[o + 2] >> 4] ?? null;
  if (tag === 'Info') return { mode: 'cbr', kbps, evidence: 'the encoder\'s Info frame (CBR)' };
  if (tag === 'Xing') return { mode: 'vbr', kbps: null, evidence: 'the encoder\'s Xing frame (VBR)' };
  return { mode: null, kbps, evidence: 'no Info/Xing frame: the bitrate mode is not established' };
}

export function createCloudAudio({ pool, scratchDir, python = 'python3', fetchImpl = fetch, allowUrl = (u) => !!providerOf(u), maxScratchBytes = 3e9, now = () => new Date().toISOString() }) {
  fs.mkdirSync(scratchDir, { recursive: true });
  const jobs = new Map();
  const waves = new Map(); // key -> parsed waveform
  const sourceOk = new Map(); // key -> { ok, at, problem }
  const isVbr = (t) => t.format?.mode === 'vbr';
  const pcm = (t) => path.join(scratchDir, `${t.key}.wav`);
  const policy = (t) => (t.synthetic && !allowUrl(t.url) ? 'unavailable' : !allowUrl(t.url) ? 'unavailable' : isVbr(t) ? 'decoded' : 'direct');

  async function waveform(t) {
    if (t.sourceKind === 'manual-sessions') return 'embedded';
    if (waves.has(t.key)) return waves.get(t.key);
    const r = await pool.query('select json, bytes, sha256 from waveforms where key = $1', [t.key]);
    if (!r.rowCount) return null;
    const w = JSON.parse(r.rows[0].json);
    if (w.bytes !== t.bytes || (t.sha256 && w.sha256 !== t.sha256)) return null;
    waves.set(t.key, w);
    return w;
  }

  /** One-byte request: the provider still serves a file of the reviewed size (it may change or vanish). */
  async function checkSource(t) {
    try {
      const res = await fetchImpl(t.url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow' });
      const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? (res.status === 200 ? res.headers.get('content-length') : NaN));
      try { await res.body?.cancel(); } catch { /* ignore */ }
      // Phase 4.8.3: whether the host answers byte ranges (206) is recorded too: the app seeks ayah by ayah only with them.
      const s = !res.ok ? { ok: false, problem: `the provider answered HTTP ${res.status}` } : total !== t.bytes ? { ok: false, problem: `the provider now serves ${total} bytes; the reviewed recording is ${t.bytes} bytes` } : { ok: true, rangeRequests: res.status === 206 };
      sourceOk.set(t.key, { ...s, at: now() });
      return s;
    } catch (error) {
      const s = { ok: false, problem: `the provider could not be reached (${error.message})` };
      sourceOk.set(t.key, { ...s, at: now() });
      return s;
    }
  }

  /**
   * Phase 4.8.3: the SHA-256 of the provider's file, streamed (nothing is written to disk or kept), refusing anything but
   * the reviewed size. Used for recordings whose waveform the server did not draw (the Phase 4.6 manual sessions).
   */
  async function hashSource(t) {
    const res = await fetchImpl(t.url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`the provider answered HTTP ${res.status}`);
    const h = crypto.createHash('sha256');
    let n = 0;
    const head = [];
    for await (const chunk of Readable.fromWeb(res.body)) {
      n += chunk.length;
      if (n > t.bytes) throw new Error('the provider sent more than the reviewed size');
      h.update(chunk);
      if (n - chunk.length < 262144) head.push(Buffer.from(chunk));
    }
    if (n !== t.bytes) throw new Error(`the provider sent ${n} bytes; the reviewed recording is ${t.bytes} bytes`);
    return { bytes: n, sha256: h.digest('hex'), format: mp3Format(Buffer.concat(head)) };
  }

  async function download(t, job, file) {
    const res = await fetchImpl(t.url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`the provider answered HTTP ${res.status}`);
    job.total = t.bytes; job.done = 0;
    const h = crypto.createHash('sha256');
    const counter = new TransformStream({ transform(chunk, c) { job.done += chunk.byteLength; h.update(chunk); if (job.done > t.bytes) c.error(new Error('the provider sent more than the reviewed size')); else c.enqueue(chunk); } });
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(file));
    const size = fs.statSync(file).size;
    if (size !== t.bytes) throw new Error(`the provider sent ${size} bytes; the reviewed recording is ${t.bytes} bytes`);
    const sha256 = h.digest('hex');
    if (t.sha256 && sha256 !== t.sha256) throw new Error(`the provider's file (SHA-256 ${sha256.slice(0, 12)}…) is not the reviewed recording (${t.sha256.slice(0, 12)}…)`);
  }
  function run(args) {
    return new Promise((resolve, reject) => {
      const p = spawn(python, ['-I', '-X', 'utf8', PEAKS_PY, ...args], { windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('error', (e) => reject(new Error(`the waveform tool could not run (${e.message})`)));
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`the waveform tool failed (${code}): ${err.trim().split('\n').at(-1)}`))));
    });
  }
  function prune(keep) {
    const files = fs.readdirSync(scratchDir).filter((f) => f.endsWith('.wav')).map((f) => ({ f: path.join(scratchDir, f), st: fs.statSync(path.join(scratchDir, f)) })).sort((a, b) => a.st.atimeMs - b.st.atimeMs);
    let total = files.reduce((a, x) => a + x.st.size, 0);
    for (const x of files) { if (total <= maxScratchBytes) break; if (x.f === keep) continue; fs.rmSync(x.f, { force: true }); total -= x.st.size; }
  }
  const ready = async (t) => {
    const p = policy(t);
    if (p === 'unavailable') return false;
    const w = await waveform(t);
    if (!w) return false;
    if (p === 'decoded' && !fs.existsSync(pcm(t))) return false;
    return sourceOk.get(t.key)?.ok === true;
  };

  function prepare(t) {
    if (jobs.get(t.key)?.state === 'working') return jobs.get(t.key);
    const job = { state: 'working', step: 'checking the original at its provider', done: 0, total: 0, error: null };
    jobs.set(t.key, job);
    (async () => {
      const p = policy(t);
      if (p === 'unavailable') throw new Error('this recording has no reachable source: its review task stays listed');
      const s = await checkSource(t);
      if (!s.ok) throw new Error(s.problem);
      const needWave = !(await waveform(t));
      const needPcm = p === 'decoded' && !fs.existsSync(pcm(t));
      if (needWave || needPcm) {
        // The decoder chooses by extension (a mismatch decodes garbage silently): use the original's own.
        const ext = ['.mp3', '.wav', '.flac', '.ogg'].includes(path.extname(new URL(t.url).pathname).toLowerCase()) ? path.extname(new URL(t.url).pathname).toLowerCase() : '.mp3';
        const mp3 = path.join(scratchDir, `${t.key}.source${ext}`); // never the PCM copy's name
        try {
          job.step = 'reading the original from its provider (temporary; not kept)';
          await download(t, job, mp3);
          job.step = needPcm ? 'drawing the waveform and decoding the VBR file for exact seeking' : 'drawing the waveform';
          const out = path.join(scratchDir, `${t.key}.peaks.json`);
          await run([mp3, out, ...(needPcm ? ['--pcm', pcm(t)] : [])]);
          const w = JSON.parse(fs.readFileSync(out, 'utf8'));
          fs.rmSync(out, { force: true });
          if (w.bytes !== t.bytes || (t.sha256 && w.sha256 !== t.sha256)) throw new Error('the decoded file is not the reviewed recording');
          if (Math.abs(w.durationMs - t.durationMs) > Math.max(500, t.durationMs * 0.01)) throw new Error(`the file decodes to ${w.durationMs} ms, the reviewed recording is ${t.durationMs} ms: refused (unreadable or another file)`);
          if (needWave) {
            await pool.query('insert into waveforms (key, json, bytes, sha256, duration_ms) values ($1,$2,$3,$4,$5) on conflict (key) do update set json = excluded.json, bytes = excluded.bytes, sha256 = excluded.sha256, duration_ms = excluded.duration_ms, computed_at = now()',
              [t.key, JSON.stringify({ ...w, pcm: undefined }), w.bytes, w.sha256, w.durationMs]);
            waves.delete(t.key);
          }
        } finally {
          fs.rmSync(mp3, { force: true }); // the original is never kept
        }
        if (needPcm) prune(pcm(t));
      }
      job.state = 'ready'; job.step = 'ready';
    })().catch((e) => { job.state = 'error'; job.error = e.message; fs.rmSync(pcm(t) + '.part', { force: true }); });
    return job;
  }
  async function state(t) {
    if (await ready(t)) return { state: 'ready' };
    return jobs.get(t.key) ?? { state: 'not-prepared', step: policy(t) === 'unavailable' ? 'no reachable source' : 'the original is checked at its provider, and its waveform drawn, when the recording is opened' };
  }
  const info = (t) => {
    const p = policy(t);
    const s = sourceOk.get(t.key);
    return { local: p !== 'unavailable' && s?.ok !== false, how: p === 'direct' ? `streamed from the original provider (${t.provider})` : p === 'decoded' ? 'decoded on the server for exact seeking (VBR); the original stays at its provider' : null, problem: p === 'unavailable' ? 'no reachable source' : s?.ok === false ? s.problem : null, vbr: isVbr(t), policy: p };
  };
  return { policy, waveform, prepare, state, ready, info, pcmFile: pcm, checkSource, hashSource, sourceStatus: (t) => sourceOk.get(t.key) ?? null };
}
