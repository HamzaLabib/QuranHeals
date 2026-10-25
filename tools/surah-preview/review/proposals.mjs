/**
 * Proposed concise Topics (موضوعاتها) for the scholarly reviewer — never shown in the app, never applied by themselves.
 * Made by fixed rules only, so a reviewer can see exactly what was done; nothing is reworded, merged or invented:
 *
 *  - 'selection' (lists of more than 10 headings): the N headings covering the most ayahs, in the source's order,
 *    N = round(items / 3) clamped to 3..7. Every proposed heading is the source's own, verbatim; the omitted ones are
 *    listed with it.
 *  - 'split' (a single sentence that enumerates topics, e.g. «بصائر ذوي التمييز» for Ash-Shura): the sentence divided
 *    at its own «، و» joints into phrases; the only change is the leading conjunction «و» dropped from each phrase (a
 *    one-word part stays joined to the phrase before it, as in the source).
 *    Everything of the sentence stays, in order; a reviewer may then choose among the phrases.
 *
 * Status of every proposal: 'pending-review'. Only a human reviewer's decision (review/store.mjs) can adopt one.
 */

export const LONG_LIST = 10;

/** The 'selection' proposal for items with ayah ranges ([{ text, range: [first, last] | null }]), or null. */
export function selectionProposal(items) {
  if (!Array.isArray(items) || items.length <= LONG_LIST) return null;
  const n = Math.min(7, Math.max(3, Math.round(items.length / 3)));
  const span = (item) => (item.range ? item.range[1] - item.range[0] + 1 : 0);
  const ranked = items.map((item, index) => ({ item, index })).sort((a, b) => span(b.item) - span(a.item) || a.index - b.index);
  const chosen = new Set(ranked.slice(0, n).map((entry) => entry.index));
  return {
    kind: 'selection',
    status: 'pending-review',
    rule: `The ${n} headings covering the most ayahs (of ${items.length}), the source's own words, in its order.`,
    items: items.filter((_, index) => chosen.has(index)).map((item) => item.text),
    omitted: items.filter((_, index) => !chosen.has(index)).map((item) => item.text),
  };
}

/** The 'split' proposal for a one-sentence list (one item), or null when it has no «، و» joints to split at. */
export function splitProposal(items) {
  if (!Array.isArray(items) || items.length !== 1) return null;
  const sentence = items[0].replace(/\.$/, '');
  // A one-word part («… بعطيّة الإِيمان، والقرآن») completes the phrase before it: joined back as the source has it.
  const parts = sentence.split(/،\s*و(?=\S)/).map((part) => part.trim()).filter(Boolean)
    .reduce((acc, part) => (acc.length && !/\s/.test(part) ? [...acc.slice(0, -1), `${acc.at(-1)}، و${part}`] : [...acc, part]), []);
  if (parts.length < 3) return null;
  return {
    kind: 'split',
    status: 'pending-review',
    rule: 'The source sentence divided at its own «، و» joints; only the leading «و» of each phrase is dropped. Nothing else changes.',
    items: parts,
    omitted: [],
  };
}
