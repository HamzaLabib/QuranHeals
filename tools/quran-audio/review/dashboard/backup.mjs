// Backups of every review database the dashboard uses (Phase 4.8): the dashboard's own data folder, the data folder
// of each manual-timing source (the Rifaat review database, in place), the registry (generated sessions, inventory),
// the configuration and the owner's rights decisions. Audio and caches are not backed up: they can be fetched again.
//
// A snapshot is a plain copy with a manifest (size + SHA-256 of every file), checked after copying; every review log
// in it is also checked for an unbroken hash chain, so a backup of a log edited outside the tool is reported, not
// silently trusted. A restore never overwrites: it writes into an empty folder and checks every file against the
// manifest. Snapshots made by the server are named auto-*, and only those are pruned.
//
// usage (from tools/quran-audio):
//   node review/dashboard/backup.mjs --config <dashboard.config.json> [--label manual]   snapshot now
//   node review/dashboard/backup.mjs --config <cfg> --list                                list snapshots
//   node review/dashboard/backup.mjs --verify <snapshot dir>                              check a snapshot
//   node review/dashboard/backup.mjs --restore <snapshot dir> --to <empty dir>            restore and check
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCK_FILE } from '../manual/log-store.mjs';
import { verifyChain } from '../manual/manual-lib.mjs';
import { readConfig } from './dashboard-lib.mjs';

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const walk = (dir, base = dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.name !== LOCK_FILE && !e.name.endsWith('.part') && !e.name.endsWith('.jsonl.lock')) out.push(path.relative(base, p));
  }
  return out;
};

/** What a snapshot of this configuration contains: [{ name, dir }]. */
export function backupTargets(cfg) {
  const t = [{ name: 'dashboard-data', dir: cfg.dataDir }, { name: 'registry', dir: cfg.registryDir }, { name: 'rights', dir: cfg.rightsDir }];
  for (const s of cfg.sources) if (s.kind === 'manual-sessions' && s.data) t.push({ name: `source-${s.id}-data`, dir: s.data });
  return t;
}

function chainProblems(root) {
  const problems = [];
  for (const rel of walk(root).filter((f) => f.endsWith('events.jsonl'))) {
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n').filter(Boolean);
    let events;
    try { events = lines.map((l) => JSON.parse(l)); } catch { problems.push(`${rel}: unreadable line`); continue; }
    const broken = verifyChain(events);
    if (broken >= 0) problems.push(`${rel}: hash chain broken at event ${broken + 1}`);
  }
  // Phase 4.8.7: the automatic-acceptance ledger (auto-accept.mjs) is chained exactly as a review log is.
  for (const rel of walk(root).filter((f) => path.basename(f) === 'ledger.jsonl')) {
    let entries;
    try { entries = fs.readFileSync(path.join(root, rel), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { problems.push(`${rel}: unreadable line`); continue; }
    const broken = verifyChain(entries);
    if (broken >= 0) problems.push(`${rel}: hash chain broken at entry ${broken + 1}`);
  }
  return problems;
}

/** A fingerprint of the current data (size + mtime of every file), to skip snapshots when nothing changed. */
export function dataState(cfg) {
  const h = crypto.createHash('sha256');
  for (const t of backupTargets(cfg)) for (const rel of walk(t.dir).sort()) { const st = fs.statSync(path.join(t.dir, rel)); h.update(`${t.name}/${rel}:${st.size}:${st.mtimeMs}\n`); }
  return h.digest('hex');
}

export function snapshot(cfg, { label = 'manual', now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  // Two snapshots in the same second (e.g. a pre-auto-accept backup right after another) get a numbered name.
  let dir = path.join(cfg.backupDir, `${label}-${stamp}`);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(cfg.backupDir, `${label}-${stamp}-${i}`);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const t of backupTargets(cfg)) {
    for (const rel of walk(t.dir)) {
      const from = path.join(t.dir, rel);
      const to = path.join(dir, t.name, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      files.push({ path: `${t.name}/${rel.replaceAll('\\', '/')}`, bytes: fs.statSync(to).size, sha256: sha(to), from: path.resolve(from) });
    }
  }
  fs.copyFileSync(cfg.file, path.join(dir, 'dashboard.config.json'));
  files.push({ path: 'dashboard.config.json', bytes: fs.statSync(cfg.file).size, sha256: sha(cfg.file), from: cfg.file });
  const manifest = { kind: 'audio-review-backup', version: 1, createdAt: now.toISOString(), label, targets: backupTargets(cfg).map((t) => ({ name: t.name, dir: path.resolve(t.dir) })), files, chainProblems: chainProblems(dir) };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const problems = verify(dir);
  if (problems.length) throw new Error(`backup ${dir} failed its own check: ${problems.join('; ')}`);
  return { dir, files: files.length, chainProblems: manifest.chainProblems };
}

/** Problems with a snapshot (empty when every file is present with its recorded size and hash). */
export function verify(dir) {
  const mf = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mf)) return ['no manifest.json'];
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const problems = [];
  for (const f of m.files) {
    const p = path.join(dir, f.path);
    if (!fs.existsSync(p)) problems.push(`${f.path}: missing`);
    else if (fs.statSync(p).size !== f.bytes || sha(p) !== f.sha256) problems.push(`${f.path}: differs from the manifest`);
  }
  return problems;
}

/** Restores a snapshot into an EMPTY folder and checks it. Never writes into live data. */
export function restore(dir, target) {
  const problems = verify(dir);
  if (problems.length) throw new Error(`snapshot damaged: ${problems.join('; ')}`);
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`${target} is not empty: a restore never overwrites`);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const f of m.files) {
    const to = path.join(target, f.path);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(dir, f.path), to);
    if (sha(to) !== f.sha256) throw new Error(`${f.path}: restored copy differs`);
  }
  fs.copyFileSync(path.join(dir, 'manifest.json'), path.join(target, 'manifest.json'));
  return { files: m.files.length, chainProblems: chainProblems(target), targets: m.targets };
}

export function list(cfg) {
  if (!fs.existsSync(cfg.backupDir)) return [];
  return fs.readdirSync(cfg.backupDir).filter((d) => fs.existsSync(path.join(cfg.backupDir, d, 'manifest.json'))).sort().map((d) => {
    const m = JSON.parse(fs.readFileSync(path.join(cfg.backupDir, d, 'manifest.json'), 'utf8'));
    return { dir: path.join(cfg.backupDir, d), createdAt: m.createdAt, label: m.label, files: m.files.length, logs: m.files.filter((f) => f.path.endsWith('events.jsonl')).length };
  });
}

/** Keeps the newest `keep` automatic snapshots; never touches other snapshots. */
export function prune(cfg, keep) {
  const auto = list(cfg).filter((b) => b.label === 'auto');
  for (const b of auto.slice(0, Math.max(0, auto.length - keep))) fs.rmSync(b.dir, { recursive: true, force: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  if (opt('--verify')) {
    const p = verify(opt('--verify'));
    console.log(p.length ? `DAMAGED:\n${p.join('\n')}` : 'snapshot intact: every file matches its manifest');
    process.exit(p.length ? 1 : 0);
  } else if (opt('--restore')) {
    if (!opt('--to')) throw new Error('--restore <snapshot> --to <empty folder>');
    const r = restore(opt('--restore'), opt('--to'));
    console.log(`restored ${r.files} files into ${opt('--to')} (checked); chain problems: ${r.chainProblems.length ? r.chainProblems.join('; ') : 'none'}`);
    console.log('To put them back into use, stop the dashboard and copy each folder over its original location:');
    for (const t of r.targets) console.log(`  ${t.name}  ->  ${t.dir}`);
  } else {
    const cfg = readConfig(opt('--config') ?? 'dashboard.config.json');
    if (a.includes('--list')) for (const b of list(cfg)) console.log(`${b.createdAt}  ${b.label.padEnd(8)} ${String(b.files).padStart(5)} files, ${b.logs} review logs  ${b.dir}`);
    else { const r = snapshot(cfg, { label: opt('--label') ?? 'manual' }); console.log(`snapshot ${r.dir}: ${r.files} files, verified; chain problems: ${r.chainProblems.length ? r.chainProblems.join('; ') : 'none'}`); }
  }
}
