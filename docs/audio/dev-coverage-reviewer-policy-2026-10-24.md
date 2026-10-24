# Development coverage and the one-reviewer policy (2026-10-24)

## Owner policy

Reviewer 2 is no longer required (owner, 2026-10-24). A recording's review is Reviewer 1's listening decisions plus
the automatic acceptance policy (auto-accept-v2), with the integrity, source, alignment, sequence and boundary checks.
The categories stay distinct everywhere: **Reviewer 1** (a person listened and confirmed or corrected), **automatic**
(accepted by policy, nobody listened), **owner override** (unverified, 88:14 Ali Jaber only), **unresolved/blocked**.

Where Reviewer 2 was a gate, and what changed:

| Place | Before | Now |
|---|---|---|
| `per-ayah/release-gate.mjs` | gate `reviewers`: every recording needs a complete Reviewer 2 | removed; `review` requires every start accepted (nothing open, very high, exceptional or disputed) |
| Development activation | only via `development/apply-review.mjs`, which reads two-reviewer exports | `development/generate-reviewed-timing.mjs` reads the dashboard (Reviewer 1 + automatic) |
| Dashboard completion | already one review (Phase 4.8.6) | unchanged; inventory rule text updated |
| `review/cloud/publication-rules.mjs` + `publisher.mjs` (not deployed) | two reviewers' agreed timing | **unchanged code, marked superseded**: must be redesigned before any use |

No Reviewer 2 record exists or was created: all 301 review logs hold Reviewer 1 (Hamza) only (301 joins, 1,998
drafts, 449 ayah submissions, 173 bulk decisions, 7 whole-recording submissions).

## Why surahs were missing in development builds

The iPad numbers were a development build. 399 surahs had complete, queue-cleared aligned timing in the review
dashboard (Phase 4.1 packages of the catalogue's own MP3Quran files) but no path into the app: `timedPreview.ts` serves
only reciters without an MP3Quran recording, `developmentTiming.ts` only the 2026-10-18 measured timing, and
`apply-review.mjs` only two-reviewer exports.

## The fix

`tools/quran-audio/development/generate-reviewed-timing.mjs` → `mobile/src/audio/generated/reviewedTiming.ts`
(report: `tools/quran-audio/audit-data/reviewed-timing-report-2026-10-24.json`). Read-only on the dashboard. A surah
is listed only if: the catalogue's MP3Quran file at the audited size; no production or measured timing; registered,
not blocked, alignment structure ok, CBR, not playback-blocked; every start accepted by Reviewer 1 or the automatic
policy (no very high, disputed, rejected, uncertain or owner-overridden start); canonical ayah count, in order,
positive lengths. Timing = Reviewer 1's confirmed time where reviewed (corrections kept), the proposed time where
accepted automatically; ayah 1 keeps the onset (plays from 0). For Banna 30, 55, 69, 89 the aligner's ayah-1 onset lay
after Reviewer 1's corrected ayah 2: Reviewer 1's own confirmed ayah-1 time (0:00.000) is used. Each surah records its
Reviewer 1 and automatic start counts.

App: `reciters.ts` loads it under `__DEV__` only (merged after the measured timing; `reviewedPreviewSurahs`), the
reciter list labels such reciters "Development preview". Release builds are unchanged (1,148 production surahs).

## Coverage (development builds, owner order)

| # | Reciter | Release | DEV before | DEV now | New: Reviewer 1 only / mixed / automatic only | Unavailable |
|---|---|---:|---:|---:|---|---|
| 1 | Minshawi | 107 | 112 | **114** | 0 / 2 / 0 | — |
| 2 | Husary | 103 | 111 | **114** | 0 / 0 / 3 | — |
| 3 | Abdul Basit | 114 | 114 | 114 | — | — |
| 4 | Banna | 1 | 1 | **114** | 39 / 3 / 71 | — |
| 5 | Sufi | 101 | 101 | **114** | 12 / 1 / 0 | — |
| 6 | Ahmed Mohamed Salama | 0 | 110 | 110 | (timed preview) | 1, 3, 6, 90: a Very High start awaits a person |
| 7 | Hudhaifi | 103 | 103 | **114** | 4 / 2 / 5 | — |
| 8 | Shuraim | 89 | 111 | **114** | 3 / 0 / 0 | — |
| 9 | Maher | 101 | 101 | **114** | 4 / 4 / 5 | — |
| 10 | Shatri | 101 | 110 | **114** | 4 / 0 / 0 | — |
| 11 | Ahmed Al-Agamy | 107 | 107 | **113** | 2 / 0 / 4 | 42: VBR |
| 12 | Ali Abdullah Jaber | — | 114 | 114 | (per-ayah preview) | — |
| 13 | Basfar | 108 | 108 | **114** | 1 / 0 / 5 | — |
| 14 | Islam Sobhi | 0 | 0 | **80** | 4 / 0 / 76 | 29 VBR; 65 Way2Quran only; 37, 39, 40, 45 no source |
| 15 | Ahmed Naina | 113 | 113 | **114** | 1 / 0 / 0 | — |
| 16 | Yasser Mahmoud Salama | 0 | 0 | **112** | 5 / 0 / 107 | 42, 48: VBR |
| 17 | Saleh Al-Talib | 0 | 0 | **32** | 7 / 0 / 25 | 24 archive.org (no permission for app use); 58 no source |

Production consideration (report only, nothing promoted): every new surah passes review, integrity, MP3Quran
permission and attribution, and fails only `devices` (no physical-device record). The cloud publisher must not be used.
