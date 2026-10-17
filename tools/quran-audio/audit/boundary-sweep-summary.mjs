// Full boundary sweep, step 3: classifies every boundary measured by boundary_sweep.py and writes the evidence kept in
// the repository: audit-data/boundary-sweep-<date>.json (per reciter and surah: boundaries tested and in a pause, and
// every boundary not in a pause with its measurements).
//
// Classes (the audit's pause test: the envelope within +-300 ms of the boundary falls below 0.35 x the window median):
//   pause        in a pause.
//   displaced    not in a pause, clearly inside recitation (ratio >= 0.6 at the boundary itself), with a real pause
//                (>= 150 ms) beginning or ending within 2 s: the signature of a boundary stated up to 2 s away from the
//                pause it belongs to. It is also what joining two ayahs (wasl) with a pause in a neighbouring word
//                looks like, so on its own it only marks the boundary for review (refine-results.mjs decides).
//   unconfirmed  not in a pause, and nothing that says where it should be (continuous recitation, reverberation).
//
// usage: node audit/boundary-sweep-summary.mjs <sweep.jsonl> [date]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PAUSE = 0.35;
export const DISPLACED_AT = 0.6;
export const DISPLACED_WITHIN_MS = 2000;

/** Distance (ms) from the boundary to a pause run [start, end] given relative to it (0 when it contains the boundary). */
const distance = ([a, b]) => (a > 0 ? a : b < 0 ? -b : 0);

export function classify(m) {
  if (m.near < PAUSE) return { kind: 'pause' };
  const near = m.runs.filter(([a, b]) => b - a >= 150).map((r) => ({ r, d: distance(r) })).sort((x, y) => x.d - y.d)[0];
  if (m.at >= DISPLACED_AT && near && near.d <= DISPLACED_WITHIN_MS) return { kind: 'displaced', pause: near.r };
  return { kind: 'unconfirmed', pause: near?.r ?? null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, date = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
  if (!input) throw new Error('usage: node audit/boundary-sweep-summary.mjs <sweep.jsonl> [date]');
  const lines = fs.readFileSync(input, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const errors = lines.filter((l) => l.err);
  if (errors.length) throw new Error(`${errors.length} boundaries were not measured (re-run boundary_sweep.py: it resumes)`);
  const reciters = {};
  for (const m of lines.sort((a, b) => a.s - b.s || a.a - b.a)) {
    const r = (reciters[m.id] ??= { boundaries: 0, inPause: 0, surahs: {} });
    const s = (r.surahs[m.s] ??= { boundaries: 0, inPause: 0, notInPause: [] });
    r.boundaries++; s.boundaries++;
    const c = classify(m);
    if (c.kind === 'pause') { r.inPause++; s.inPause++; continue; }
    // [ayah, stated start ms, ratio within +-300 ms, ratio at the boundary, class, nearest pause relative to it]
    s.notInPause.push([m.a, m.t, m.near, m.at, c.kind, c.pause]);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = {
    measuredOn: date,
    method: 'audit/boundary_sweep.py: +-3 s around every stated boundary, 20 ms RMS envelope smoothed over 100 ms, relative to the window median',
    classes: { pause: `< ${PAUSE} within +-300 ms`, displaced: `not in a pause, ratio at the boundary >= ${DISPLACED_AT}, a pause >= 150 ms within ${DISPLACED_WITHIN_MS} ms`, unconfirmed: 'any other boundary not in a pause' },
    notInPauseFields: ['ayah', 'startMs', 'nearRatio', 'atRatio', 'class', 'nearestPauseRelativeMs'],
    reciters,
  };
  const target = path.join(here, '..', 'audit-data', `boundary-sweep-${date}.json`);
  fs.writeFileSync(target, JSON.stringify(out) + '\n');
  for (const [id, r] of Object.entries(reciters)) console.log(`${id.padEnd(14)} ${r.boundaries} boundaries, ${(100 * r.inPause / r.boundaries).toFixed(1)}% in a pause`);
  console.log('wrote', target, fs.statSync(target).size, 'bytes');
}
