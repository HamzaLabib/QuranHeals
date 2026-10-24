// Keeps the per-file format evidence of the first audit (structural.mjs's audit.json, in its work directory) for the
// recordings the app uses: for every listed surah, the HTTP status, size, MP3 bitrate and sample rate, the CBR / VBR
// evidence and the duration. The source registry (generate-catalog.mjs) reads it to record each source's format.
//
// Bitrate mode: an 'Info' header frame is the encoder's own CBR marker, a 'Xing' frame its VBR marker; a file with
// neither is classified from its first frame only ('first-frame'), which cannot prove CBR on its own. For the surahs with
// verified ayah timing that is backed by the boundary checks made inside the audio at the CBR byte offsets.
//
// usage: node audit/extract-formats.mjs <structural work dir> [date]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const work = process.argv[2];
const date = process.argv[3] ?? '2026-10-17';
if (!work) throw new Error('usage: node audit/extract-formats.mjs <structural work dir> [date]');
const audit = JSON.parse(fs.readFileSync(path.join(work, 'audit.json'), 'utf8'));
const results = JSON.parse(fs.readFileSync(path.join(here, '..', 'audit-results.json'), 'utf8'));

const recordings = {};
for (const reciter of results.reciters) {
  if (reciter.moshafId === null) continue;
  const rec = audit.find((r) => r.moshafId === reciter.moshafId);
  if (!rec) throw new Error(`no structural audit for moshaf ${reciter.moshafId}`);
  const files = {};
  for (const surah of reciter.surahs) {
    const f = rec.files[surah];
    if (!f) throw new Error(`moshaf ${reciter.moshafId}: no file record for surah ${surah}`);
    if (f.size !== reciter.bytes[surah]) throw new Error(`moshaf ${reciter.moshafId} surah ${surah}: ${f.size} ≠ ${reciter.bytes[surah]} bytes`);
    files[surah] = {
      status: f.status,
      bytes: f.size,
      kbps: f.bitrate ?? null,
      sampleRateHz: f.sr ?? null,
      bitrateMode: f.vbrTag === 'Xing' ? 'vbr' : 'cbr',
      bitrateEvidence: f.vbrTag === 'Xing' ? 'xing-tag' : f.vbrTag === 'Info' ? 'info-tag' : 'first-frame',
      durationMs: f.durationMs ?? null,
      rangeRequests: Boolean(f.ranges),
    };
  }
  recordings[reciter.id] = { moshafId: reciter.moshafId, server: reciter.server, files };
}
const out = path.join(here, '..', 'audit-data', `recording-formats-${date}.json`);
fs.writeFileSync(out, `${JSON.stringify({ auditedOn: date, source: 'audit/structural.mjs (first 64 KB of every file)', recordings })}\n`);
const vbr = Object.entries(recordings).flatMap(([id, r]) => Object.entries(r.files).filter(([, f]) => f.bitrateMode === 'vbr').map(([s]) => `${id} ${s}`));
console.log(`${Object.keys(recordings).length} recordings → ${path.relative(process.cwd(), out)}; VBR files: ${vbr.length ? vbr.join(', ') : 'none'}`);
