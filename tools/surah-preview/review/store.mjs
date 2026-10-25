/**
 * The scholarly review log for Surah Preview's Topics (موضوعاتها): one line of JSON per human decision, appended and
 * synced to disk, never rewritten. Each entry carries the SHA-256 of the one before it (a chain), so an edited or
 * removed line is detected on the next load and no further decision is accepted until it is resolved.
 *
 * A decision is a qualified human reviewer's, made in the review dashboard: who (the reviewer's name), which Surah,
 * what (accept the current topics, accept a proposal, edit, reject, or skip), the exact text decided on (`items`) and
 * the SHA-256 of the topics as they were when reviewed (`reviewedSha`), so a decision about text that has since changed
 * is never applied (apply.mjs). Nothing else writes here: no automated check, import or script approves anything.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ACTIONS = ['accept', 'edit', 'reject', 'skip'];
export const BASES = ['current', 'proposal', 'edited'];
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The SHA-256 that identifies a list of topics (as reviewed), or of "no topics". */
export const topicsSha = (items) => sha256(JSON.stringify(items ?? null));

const isText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** Why a decision is not acceptable, or null. `record` is the Surah's review record (data.mjs). */
export function invalidDecision(decision, record) {
  const d = decision ?? {};
  if (!isText(d.reviewer, 80)) return 'A reviewer name is required.';
  if (!Number.isInteger(d.surah) || d.surah < 1 || d.surah > 114) return 'Unknown Surah.';
  if (!ACTIONS.includes(d.action)) return 'Unknown decision.';
  if (d.note !== undefined && d.note !== null && (typeof d.note !== 'string' || d.note.length > 2000)) return 'The note is too long.';
  if (d.reviewedSha !== record.currentSha) return 'The topics changed since this page was loaded: reload and review again.';
  if (d.action === 'accept') {
    if (d.basis === 'current') {
      if (!record.current) return 'There are no current topics to accept.';
      if (topicsSha(d.items) !== record.currentSha) return 'Accepted text differs from the current topics.';
    } else if (d.basis === 'proposal') {
      if (!record.proposal) return 'There is no proposal to accept.';
      if (topicsSha(d.items) !== topicsSha(record.proposal.items)) return 'Accepted text differs from the proposal.';
    } else return 'Accept needs a basis (current or proposal).';
  }
  if (d.action === 'edit') {
    if (!Array.isArray(d.items) || d.items.length === 0 || d.items.length > 40 || !d.items.every((item) => isText(item, 600))) {
      return 'An edit needs one to forty topics, each a line of text.';
    }
  }
  if ((d.action === 'reject' || d.action === 'skip') && d.items !== undefined && d.items !== null) return 'Reject and skip carry no text.';
  return null;
}

/** The review log in `dir` (created if missing). */
export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'decisions.jsonl');

  /** Every entry, after checking the chain; throws when it is broken. */
  function entries() {
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim());
    let prev = '';
    return lines.map((line, i) => {
      const entry = JSON.parse(line);
      const { hash, ...body } = entry;
      if (body.prev !== prev || sha256(JSON.stringify(body)) !== hash) {
        throw new Error(`Review log broken at line ${i + 1} (${file}): it was edited or reordered. No decision is accepted until it is restored.`);
      }
      prev = hash;
      return entry;
    });
  }

  /** The latest decision for each Surah that has one (skips included). */
  function latest() {
    const bySurah = new Map();
    for (const entry of entries()) bySurah.set(entry.surah, entry);
    return bySurah;
  }

  /** Records a decision (already checked with invalidDecision) and returns the stored entry. */
  function append(decision, now = new Date()) {
    const all = entries();
    const body = {
      seq: all.length + 1,
      at: now.toISOString(),
      reviewer: decision.reviewer.trim(),
      surah: decision.surah,
      action: decision.action,
      basis: decision.action === 'accept' ? decision.basis : decision.action === 'edit' ? 'edited' : null,
      items: decision.action === 'accept' || decision.action === 'edit' ? decision.items.map((item) => item.trim()) : null,
      reviewedSha: decision.reviewedSha,
      note: decision.note?.trim() || null,
      prev: all.at(-1)?.hash ?? '',
    };
    const entry = { ...body, hash: sha256(JSON.stringify(body)) };
    const fd = openSync(file, 'a');
    try {
      appendFileSync(fd, `${JSON.stringify(entry)}\n`, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return entry;
  }

  return { file, entries, latest, append };
}
