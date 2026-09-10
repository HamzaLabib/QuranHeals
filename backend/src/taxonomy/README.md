# `taxonomy/` — Phase 5A reference data

Design/reference code for the richer emotion navigation system. **Nothing here
is wired into the seed, the API, or any runtime path.** The live app still
serves the 12 emotions in `../seed/emotions.ts`.

| File | Purpose |
| --- | --- |
| `emotionTaxonomy.ts` | The 32 working candidates (31 emotional/spiritual + `quran_message` discovery mode): stable key, English/Arabic labels, internal `family`, alias lists, overlap notes, and a keep/merge recommendation. |
| `aliasResolver.ts` | Turns free-text ("really sad", "زعلان") into a stable emotion key via a normalized exact-match index. Seed for future fuzzy/search matching. |

Full analysis, alias strategy, mapping lifecycle, and rollout plan:
[`docs/phase-5a-emotion-taxonomy.md`](../../../docs/phase-5a-emotion-taxonomy.md).

## Rules

- `emotionKey` is the identity: stable, language-independent, never derived from
  display text. Never rename a shipped key.
- Aliases point to a main key. They never create a separate Quran mapping pool.
- Five candidate keys use `_`; the live `emotionKey` pattern
  (`/^[a-z][a-z-]{1,40}$/`) must be widened before any of them is activated —
  see the doc.
- Adding a real emotion means: add to `../seed/emotions.ts` with `active: false`,
  then flip `active` only once it has at least one `approved` mapping.
