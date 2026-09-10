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
- The live `emotionKey` pattern is `/^[a-z][a-z_-]{1,40}$/` (widened in the
  Phase 5B backend-prep step so underscore keys like `want_to_cry` are valid).
- The approved MAIN emotions are already in `../seed/emotions.ts` with
  `active: false` (`order` 13–29). Flip `active` only once a key has at least
  one `approved` mapping. `frustrated`/`regretful` are aliases, not seed rows;
  `quran_message` is a discovery mode, not a seed row.
