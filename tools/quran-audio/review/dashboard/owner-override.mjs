// Owner override (owner, 2026-10-24: Ali Abdullah Jaber 88:14). The owner may take one start out of the review queue
// WITHOUT it being verified: an owner-authorized, UNVERIFIED acceptance. It is not a review, not an automatic
// acceptance and not verification: nobody listened, and the voice identity and the text were not confirmed.
//
// It is written to its own append-only, hash-chained ledger (<dataDir>/_owner-override/ledger.jsonl), never into a
// review log or the automatic-acceptance ledger, so the review counts, the two-reviewer verification, the export and
// the publication rules are unchanged. The dashboard counts it apart (ownerOverride) and never writes a
// reciter-completed milestone for it; release-gate.mjs blocks any recording that has one.
//
// An override is tied to the exact package (proposal fingerprint), audio (sha256) and per-ayah file it was authorized on: if
// either changes, it no longer applies. It never applies to a very high risk start, and a reviewer's own judgement
// (a rejection, now or in its history; uncertain; edited; unresolvable; being resolved) always wins.
//
// usage (from tools/quran-audio):
//   node review/dashboard/owner-override.mjs --config <cfg> --key <recording key> --ayah <n> --authorized-by <owner>
//        --instruction <the owner's words> [--evidence <file.json>] [--apply]       dry run without --apply
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { veryHighOf } from '../manual/very-high.mjs';
import { humanBlock, openLedger } from './auto-accept.mjs';

export const OVERRIDE_DIR = '_owner-override';
export const overrideFile = (dataDir) => path.join(dataDir, OVERRIDE_DIR, 'ledger.jsonl');
export const overrideIdentity = (e) => (e.type === 'owner-override' ? `${e.key}|${e.ayah}|${e.fingerprint}|${e.audioSha256}|${e.file?.sha256 ?? null}` : null);
/** A per-ayah recording's own file for the start (null for a whole-surah recording). */
// Found by its name (SSSAAA.mp3): the list starts with the Basmala file only where the surah has one.
const fileOf = (session, ayah) => { const f = (session?.proposal?.perAyah?.files ?? []).find((x) => Number(String(x.name).slice(3, 6)) === ayah); return f ? { name: f.name, bytes: f.bytes, sha256: f.sha256 } : null; };
/** The ledger (auto-accept.mjs openLedger), with forKey over owner overrides (openLedger's own index is of acceptances). */
export function openOverrides(file, opts = {}) {
  const l = openLedger(file, { ...opts, identity: overrideIdentity });
  return { ...l, get problem() { return l.problem; }, forKey: (key) => l.entries().filter((e) => e.type === 'owner-override' && e.key === key) };
}

/** Why an override cannot apply to this start now, or null. */
export function overrideBlock(session, state, ayah) {
  if (!session?.proposal) return 'no proposal: nothing to tie the override to';
  if (veryHighOf(session, state).starts.has(ayah) || veryHighOf(session, state).recording.length) return 'very high risk: an owner override never applies';
  return humanBlock(session, state, String(ayah));
}

/** The overrides that still apply (Map ayah key -> entry): same package and audio, and nothing above blocks them. */
export function effectiveOverrides(session, state, entries) {
  const out = new Map();
  for (const e of entries) {
    if (e.type !== 'owner-override') continue;
    if (e.fingerprint !== (session?.proposal?.fingerprint ?? null) || e.audioSha256 !== (session?.sha256 ?? null) || (e.file?.sha256 ?? null) !== (fileOf(session, e.ayah)?.sha256 ?? null)) continue;
    if (overrideBlock(session, state, e.ayah)) continue;
    out.set(String(e.ayah), e);
  }
  return out;
}

/** The ledger entry for one start. Every flag says what it is NOT. */
export function overrideEntry({ task, session, ayah, authorizedBy, authorizedOn, instruction, evidence = null }) {
  const risk = session.proposal?.perAyah?.risk?.[ayah] ?? null;
  return {
    type: 'owner-override', key: task.key, reciterId: task.reciterId, surah: task.surah, reviewType: task.reviewType, ayah,
    tier: task.risk[ayah - 1]?.[0] ?? null, reason: task.risk[ayah - 1]?.[1] ?? null,
    fingerprint: session.proposal?.fingerprint ?? null, proposedMs: session.proposal?.starts?.[ayah] ?? null,
    packageSha256: session.provenance?.packageSha256 ?? null, audioSha256: session.sha256 ?? null, file: fileOf(session, ayah),
    authorizedBy, authorizedOn, instruction,
    verified: false, listened: false, identityConfirmed: false, textConfirmed: false, releaseBlocked: true,
    // Every automated concern still on the file (none is resolved by the override), with its tier.
    openConcerns: (risk?.severity?.codes ?? []).filter((x) => !x.resolved).map((x) => ({ code: x.code, tier: x.tier, label: x.label, why: x.why })),
    evidence,
    note: 'owner-authorized, UNVERIFIED acceptance: taken out of the review queue on the owner\'s instruction; nobody listened, the reciter identity and the text were not confirmed; not a review, not an automatic acceptance, not verification; blocked from public release until the concerns are resolved',
  };
}

// ---------------------------------------------------------------- command line

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  for (const k of ['--config', '--key', '--ayah', '--authorized-by', '--instruction']) if (!opt(k)) throw new Error(`missing ${k}`);
  const { readConfig } = await import('./dashboard-lib.mjs');
  const { createLogStore } = await import('../manual/log-store.mjs');
  const { snapshot, verify } = await import('./backup.mjs');
  const cfg = readConfig(opt('--config'));
  if (cfg.raw.readOnly) throw new Error(`read-only since ${cfg.raw.readOnly.since}: nothing is written here`);
  const inv = JSON.parse(fs.readFileSync(path.join(cfg.registryDir, 'inventory.json'), 'utf8'));
  const task = inv.tasks.find((t) => t.key === opt('--key'));
  if (!task) throw new Error(`${opt('--key')}: not in the registry`);
  const ayah = Number(opt('--ayah'));
  const { session, state } = createLogStore({ locate: (k) => (k === task.key ? task : null) }).load(task.key);
  const why = overrideBlock(session, state, ayah);
  if (why) throw new Error(`${task.key} ayah ${ayah}: ${why}`);
  const ledger = openOverrides(overrideFile(cfg.dataDir));
  if (ledger.problem) throw new Error(ledger.problem);
  const entry = overrideEntry({ task, session, ayah, authorizedBy: opt('--authorized-by'), authorizedOn: new Date().toISOString().slice(0, 10), instruction: opt('--instruction'), evidence: opt('--evidence') ? JSON.parse(fs.readFileSync(opt('--evidence'), 'utf8')) : null });
  const known = ledger.entries().find((e) => overrideIdentity(e) === overrideIdentity(entry));
  if (known) console.log(`already recorded (seq ${known.seq}, ${known.at}): nothing written, no backup taken`);
  else if (!a.includes('--apply')) { console.log(JSON.stringify(entry, null, 1)); console.log('dry run (add --apply)'); }
  else {
    const b = snapshot(cfg, { label: 'pre-owner-override' });
    const v = verify(b.dir);
    if (v.length || b.chainProblems.length) throw new Error(`backup ${b.dir} did not verify; nothing written: ${[...v, ...b.chainProblems].join('; ')}`);
    const written = ledger.append([entry]);
    console.log(written.length ? `written: seq ${written[0].seq} (backup ${b.dir})` : `already recorded: nothing written (backup ${b.dir})`);
  }
}
