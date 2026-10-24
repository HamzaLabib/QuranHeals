// SYNTHETIC TEST DATA for the manual-timing tool (Phase 4.6A): a WAV of tone bursts separated by silences and a
// session marked `synthetic: true`. It is not a recitation and is never evidence about any recording: the page shows
// it under a red SYNTHETIC banner, its export carries `synthetic: true`, and development/apply-review.mjs refuses it.
// The text and ayah count come from the canonical text file, so the tool's layout can be checked on a real surah.
//
// usage: node review/manual/synthetic.mjs <sessions dir> <audio dir> [--surah 98] [--key synthetic-98]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..', '..', '..');

/** Tone bursts: the k-th "ayah" is a 220+40k Hz tone; starts are known exactly (for tests only). */
export function makeSynthetic({ surah = 98, key = `synthetic-${surah}`, sampleRate = 16000, burstMs = 4000, gapMs = 1500, leadMs = 2000, tailMs = 3000 } = {}) {
  const text = new Map();
  for (const line of fs.readFileSync(path.join(repo, 'tools', 'quran-verification', 'input', 'quran-uthmani.txt'), 'utf8').split(/\r?\n/)) {
    const p = line.split('|');
    if (p.length === 3 && /^\d+$/.test(p[0])) text.set(`${p[0]}:${p[1]}`, p[2]);
  }
  const xml = fs.readFileSync(path.join(repo, 'tools', 'quran-verification', 'input', 'quran-data.xml'), 'utf8');
  const m = new RegExp(`<sura index="${surah}" ayas="(\\d+)"[^>]* name="([^"]+)" tname="([^"]+)"`).exec(xml);
  const n = Number(m[1]);
  const starts = [];
  const total = leadMs + n * burstMs + (n - 1) * gapMs + tailMs;
  const pcm = new Int16Array(Math.round((total / 1000) * sampleRate));
  for (let k = 0; k < n; k++) {
    const s0 = leadMs + k * (burstMs + gapMs);
    starts.push(s0);
    const f = 220 + 40 * k;
    for (let i = Math.round((s0 / 1000) * sampleRate); i < Math.round(((s0 + burstMs) / 1000) * sampleRate); i++) pcm[i] = Math.round(9000 * Math.sin((2 * Math.PI * f * i) / sampleRate));
  }
  const endMs = leadMs + n * burstMs + (n - 1) * gapMs;
  const wav = Buffer.alloc(44 + pcm.length * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length * 2, 40);
  Buffer.from(pcm.buffer).copy(wav, 44);
  const binMs = 5;
  const per = (sampleRate * binMs) / 1000;
  const bins = Math.floor(pcm.length / per);
  const mins = new Int8Array(bins);
  const maxs = new Int8Array(bins);
  for (let b = 0; b < bins; b++) {
    let lo = 0, hi = 0;
    for (let i = b * per; i < (b + 1) * per; i++) { if (pcm[i] < lo) lo = pcm[i]; if (pcm[i] > hi) hi = pcm[i]; }
    mins[b] = Math.round((lo / 32768) * 127); maxs[b] = Math.round((hi / 32768) * 127);
  }
  const quiet = [{ fromMs: 0, toMs: leadMs, kind: 'digital silence' }, ...starts.slice(1).map((s) => ({ fromMs: s - gapMs, toMs: s, kind: 'digital silence' })), { fromMs: endMs, toMs: total, kind: 'digital silence' }];
  const basmala = text.get('1:1');
  const words = basmala.split(' ').length;
  const ayahs = Array.from({ length: n }, (_, k) => {
    let t = text.get(`${surah}:${k + 1}`);
    if (k === 0 && surah !== 1 && surah !== 9 && t.split(' ').slice(0, words).join(' ') === basmala) t = t.split(' ').slice(words).join(' ');
    return { ayah: k + 1, text: t };
  });
  const session = {
    kind: 'manual-timing-session', version: 1, synthetic: true,
    reciterId: 'synthetic-test', reciterEn: 'SYNTHETIC TEST DATA (tones, not a recitation)', recording: 'synthetic',
    surah, surahAr: m[2], surahEn: m[3], ayahCount: n,
    url: `synthetic://${key}.wav`, bytes: wav.length, sha256: null, audioFile: `${key}.wav`,
    durationMs: Math.floor((pcm.length / sampleRate) * 1000), timeline: 'synthetic PCM',
    peaks: { binMs, min: Buffer.from(mins.buffer).toString('base64'), max: Buffer.from(maxs.buffer).toString('base64') },
    textSource: "tools/quran-verification/input/quran-uthmani.txt (Tanzil Uthmani 1.1, the app's runtime text), verbatim",
    basmala: surah !== 1 && surah !== 9 ? basmala : null, ayahs, quiet,
    evidence: {
      source: 'SYNTHETIC (no Phase 4.5 evidence)', readOnly: true, verdict: 'synthetic test data', note: 'Synthetic brackets for testing the display only.',
      starts: starts.map((s, k) => ({ ayah: k + 1, bracketMs: [Math.max(0, s - 3000), s + 3000], kind: k === 3 ? 'conflict' : k === 0 ? 'unbracketed' : 'single pause', evidence: 'synthetic', pauseCandidates: k ? [{ fromMs: s - gapMs, toMs: s, kind: 'digital silence' }] : [], pausesInBracket: k ? 1 : 0 })),
      windows: starts.map((s, k) => ({ fromMs: s, toMs: Math.min(s + 6000, total), ayahs: [k + 1, k + 1], margin: 1, confirmed: k !== 5 })),
    },
    rights: { cleared: false, id3Copyright: null, reason: 'synthetic test data: never published' },
  };
  return { session, wav, truth: { starts, endMs } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sessions, audio] = process.argv.slice(2);
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  if (!sessions || !audio) throw new Error('usage: node review/manual/synthetic.mjs <sessions dir> <audio dir> [--surah 98] [--key synthetic-98]');
  const { session, wav } = makeSynthetic({ surah: Number(opt('--surah') ?? 98), ...(opt('--key') ? { key: opt('--key') } : {}) });
  fs.mkdirSync(sessions, { recursive: true }); fs.mkdirSync(audio, { recursive: true });
  const key = session.audioFile.replace(/\.wav$/, '');
  fs.writeFileSync(path.join(sessions, `${key}.json`), JSON.stringify(session));
  fs.writeFileSync(path.join(audio, session.audioFile), wav);
  console.log(`SYNTHETIC session ${key} (${session.ayahCount} tone bursts) -> ${sessions}`);
}
