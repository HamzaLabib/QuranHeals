// Phase 4.8.8: the opening rule (owner, 2026-10-23). A complete surah recording plays its opening ayah from the very
// start of the file: the EFFECTIVE start of ayah 1 is exactly 0 ms, whatever a proposal, an alignment, a production
// timing or a reviewer placed. Nothing else moves (ayah 2 onwards keep their times) and the audio is never changed.
//
// The original first timestamp is not thrown away: it is the ayah-1 ONSET, where its words begin after any
// isti'adha, Basmala, introduction or silence. Highlighting may use it (the app's introEndMs); playback never does.
//
// Everything here is computed from a session's own content, so stored sessions and review logs are never rewritten
// and replay exactly as recorded. Exceptions are reported, never hidden:
//   excluded      the recording does not begin at the surah's opening (an excerpt, a partial file, or an alignment
//                 that found no ayah 1): the rule is not applied and the recording is flagged;
//   out-of-scope  a production boundary check that does not list ayah 1 (the app already plays it from 0);
//   exceptions    an applied opening whose onset is uncertain or was flagged (aligner collapse, production sweep,
//                 Phase 4.5 evidence) or whose ayah 1 begins late (introductory material): listed for the owner.
// Synthetic practice data is not a recitation: the rule never applies to it.

export const OPENING_RULE = {
  id: 'opening-zero-v1', decidedBy: 'owner', decidedOn: '2026-10-23', startMs: 0,
  rule: 'the opening ayah of every complete surah recording plays from 0:00.000; later ayah starts are unchanged; the original first timestamp is kept as the ayah-1 onset (highlighting only)',
};
/** An onset at or after this is reported as introductory material that ayah-1 highlighting must respect. */
export const LEAD_IN_MS = 1000;

const fmt = (ms) => { const s = ms / 1000; const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`; };
const runCovers = (run, ayah) => { const xs = String(run).split(/[-,–]/).map(Number).filter(Number.isFinite); return xs.length === 2 ? ayah >= xs[0] && ayah <= xs[1] : xs.includes(ayah); };

/**
 * The opening of one session: { rule, startMs: 0, applies, status: 'applied' | 'excluded' | 'out-of-scope', reason,
 * onsetMs (the original first timestamp, or null), introMs ([from, to] or null), exceptions: [{ kind, text }] }.
 */
export function openingOf(session) {
  const p = session?.proposal ?? null;
  const onsetMs = Number.isFinite(p?.starts?.[1]) ? p.starts[1] : null;
  const base = { rule: OPENING_RULE.id, startMs: OPENING_RULE.startMs, onsetMs, introMs: Array.isArray(p?.intro) ? p.intro : null, exceptions: [] };
  const scope = Array.isArray(session?.scope) && session.scope.length ? session.scope : null;
  if (session?.synthetic === true) return { ...base, applies: false, status: 'excluded', reason: 'synthetic practice data (not a recitation)' };
  if (scope && !scope.includes(1)) return { ...base, applies: false, status: 'out-of-scope', reason: 'ayah 1 is not part of this check (the app already plays it from 0:00.000)' };
  const c = p?.completeness ?? null;
  if (session?.excerpt || session?.partial) return { ...base, applies: false, status: 'excluded', reason: `the recording is ${session.excerpt ? 'an excerpt' : 'partial'}: it does not begin at the surah's opening` };
  if (c?.missing_in_alignment?.includes(1)) return { ...base, applies: false, status: 'excluded', reason: 'the alignment found no ayah 1: the recording may not begin at the surah\'s opening' };
  const ex = [];
  if ((c?.collapsed_runs ?? []).some((run) => runCovers(run, 1))) ex.push({ kind: 'onset-uncertain', text: 'the aligner collapsed ayah 1: where its words begin is uncertain (highlighting only; playback starts at 0:00.000)' });
  const b1 = (p?.boundaries ?? []).find((b) => b.ayah === 1);
  const flags = (b1?.flags ?? []).filter((f) => f !== 'opening');
  if (flags.length || b1?.priority === 1 || b1?.priority === 2) ex.push({ kind: 'flagged', text: `ayah 1 was flagged (${[...flags, ...(b1?.check ? [b1.check] : [])].join(', ') || `priority ${b1.priority}`}): still open as reported; the opening rule changes only where playback starts` });
  const e45 = session?.evidence?.starts?.find((s) => s.ayah === 1);
  if (e45 && e45.kind !== 'single pause') ex.push({ kind: 'evidence', text: `Phase 4.5 evidence for ayah 1: ${e45.kind}` });
  if (onsetMs != null && onsetMs >= LEAD_IN_MS) ex.push({ kind: 'lead-in', text: `ayah 1 is heard from ${fmt(onsetMs)}${base.introMs ? ` after an introduction (${fmt(base.introMs[0])}–${fmt(base.introMs[1])})` : ''}: highlighting should start there` });
  return { ...base, applies: true, status: 'applied', reason: `ayah 1 plays from ${fmt(0)} (${OPENING_RULE.id})`, exceptions: ex };
}

/** The effective start of `key` under the rule: 0 for the opening ayah of a recording it applies to, else `ms`. */
export const effectiveStartMs = (session, key, ms, opening = openingOf(session)) => (String(key) === '1' && opening.applies ? OPENING_RULE.startMs : ms);

/**
 * The session as every review page is served it (local dashboard, manual server, cloud): `opening` added and, when the
 * rule applies, ayah 1 proposed at 0 with its original first timestamp kept as `proposal.openingOnsetMs` (and as
 * `onsetMs` on the ayah-1 boundary). The stored session, which review logs replay against, is never changed.
 */
export function effectiveSession(session) {
  const opening = openingOf(session);
  if (!opening.applies || !session.proposal) return { ...session, opening };
  const p = session.proposal;
  return { ...session, opening, proposal: { ...p, starts: { ...p.starts, 1: OPENING_RULE.startMs }, boundaries: (p.boundaries ?? []).map((b) => (b.ayah === 1 ? { ...b, ms: OPENING_RULE.startMs, onsetMs: b.ms } : b)), openingOnsetMs: opening.onsetMs } };
}

/** A one-line description for risk reasons and lists. */
export function openingReason(o) {
  if (!o.applies) return o.reason;
  const notes = o.exceptions.filter((x) => x.kind !== 'lead-in').map((x) => x.text);
  return `opening: plays from 0:00.000 (${OPENING_RULE.id})${o.onsetMs > 0 ? `; ayah 1 heard from ${fmt(o.onsetMs)}` : ''}${notes.length ? `; exception: ${notes.join('; ')}` : ''}`;
}
