# Unicode Mushaf — production migration plan

**Status:** plan only. Unicode is **not** the production default; nothing here has been switched on. Prerequisites:
the licensing blockers (`licensing.md`) and the physical-device checklist (`device-testing-checklist.md`) must pass first.

## 0. Starting point (verified 2026-10-15)

- The Unicode renderer reproduces QCF V1's 604 page boundaries exactly, and every line break on pages 3–604 after one
  documented correction (13:37); pages 1–2 have the same line breaks in their own block.
- Every ayah number sits on the same page as its QCF V1 medallion (6,236/6,236), and page starts match the reader's
  navigation (604/604).
- In a release bundle the prototype is folded away entirely (`__DEV__` gate); production behaves as QCF V1 only.

## 1. Bundle the permitted fonts for offline use

> **Updated with the visual candidates (visual-candidates.md):** the recommended rendering is **candidate C, QH Old
> Madina** (OFL). It is bundled like any app asset (2.59 MB TTF; subsetting to the glyphs the Quran text and the
> elongation rule reach should shrink it substantially), needs no download and no KFGQPC font licence. Amiri Quran
> stays for the two fallback words (11:41, 12:11). The KFGQPC row below applies only if candidate A or the first
> prototype were kept.

| Font | How | Size | Condition |
|---|---|---|---|
| KFGQPC HAFS Uthmanic Script v18 | Add `{ file: "UthmanicHafs1Ver18.ttf", url: <QF CDN>, bytes: 242368, sha256: a0636e68… }` to a lock file restored by `scripts/restore-mushaf-fonts.mjs` (the same git-ignored, hash-pinned pipeline as `p61.ttf`, run by `postinstall`/`prestart`/CI/`eas-build-pre-install`); load with `require()` in `useFonts` like `QPC_V1_FONTS` | 242 KB | KFGQPC confirmation (BLOCKER); QF credit; never committed |
| Amiri Quran | Move `@expo-google-fonts/amiri-quran` from devDependencies to dependencies; it is only the fallback for 2 words, so it can load lazily | 136 KB | OFL notice in credits |

Result: Unicode pages work offline from the first launch, with no 100 MB QCF download.

## 2. Remove development-only dependencies and controls

- Replace the dev-only `require` in `app/(tabs)/mushaf.tsx` with a normal import behind a renderer setting (§6). The
  development chips (**QCF / Uni**, **KF / Amiri**, **✓**) stay `__DEV__`-only; **Tajweed Colors · ألوان التجويد**
  moves to Settings → Quran (`settings.ts` keys renamed to the production `quran-heals:…:v1` scheme; decide whether it
  syncs, which would need a backend preference field — out of scope until approved).
- Drop the Amiri **width table** (`amiriWordWidths.ts`, 1.1 MB) if Amiri is only the fallback: the two fallback words'
  widths are already in `hafsWordWidths.ts`. Keep Amiri as a selectable font only if approved.
- Keep `diagnostics.ts` and the ✓ mode `__DEV__`-only.

## 3. App size and performance

| Item | Today (source) | Production target |
|---|---|---|
| Layout table | 151 KB | same, or a JSON asset read on demand |
| KFGQPC widths | 593 KB | ~350 KB with base-36 numbers; or a JSON asset |
| Tajweed rules | 397 KB | loaded only when Tajweed Colors is ON (a JSON asset read on first use) |
| Fonts | — | +378 KB (KFGQPC + Amiri) |

- Move the three tables from TypeScript modules to `assets/mushaf/unicode/*.json`, read with expo-asset and
  expo-file-system on first use. This keeps them out of the JavaScript bundle and app start-up.
- Targets, measured on the S22 Ultra and an iPhone: first page within 300 ms of opening the tab (font bundled); page
  turn without dropped frames; layout < 5 ms per page (0.2 ms on desktop today).
- Optionally remove the QCF offline download UI for new users (it saves them ~100 MB) once Unicode is the default.

## 4. iOS and Android consistency

- Both fonts have identical hhea and OS/2 typo metrics, so iOS's TextKit rule (which explains the QCF 0.376 em iPhone
  offset exactly) predicts **no** offset for them. Confirm on devices with the ✓ mode.
- Already in place: `includeFontPadding: false`, the font's own line box, `allowFontScaling={false}`, clip instead of
  ellipsis, ink room around every word, colour boundaries only between whole letters.
- If a device shows a constant baseline offset, add a per-OS correction constant (as `qcfV1DrawnLineShiftEm`), measured
  from device screenshots, never from `onTextLayout` alone.

## 5. Tablets and responsive layout

- The Unicode page uses the production `fitMushafPage`/Taller frame, so it scales to any width (checked at 820 pt on
  web).
- iPad: the app runs in iPhone compatibility mode (`ios.supportsTablet` unset). Native iPad support is an app-wide
  decision (every screen, store screenshots) and is out of scope for this migration.
- Android tablets: portrait, responsive; test one in the checklist.

## 6. Keep QCF V1 as the emergency fallback

- Add `MUSHAF_RENDERER_DEFAULT: 'qcf-v1' | 'unicode'` (a constant shipped by EAS Update) and a user-visible
  Settings → Quran → **Mushaf script**: *Madina (Unicode)* / *Classic (QCF)*.
- Per page, fall back automatically: Unicode (font loaded and the integrity check passed) → QCF V1 (offline data or
  page 61) → the existing "page unavailable" message. Never draw a page that fails its check.
- Keep the QCF code, the offline download, the relay and the tests unchanged for at least two releases after the switch.

## 7. No loss of ورد, Khatma, saved ayahs or reading position

No data migration is needed, because nothing stored depends on the renderer:

| Data | Stored as | Why it carries over |
|---|---|---|
| ورد (reading stops) | `page` + optional `ayahKey` (`readingStops.ts`) | same 604 pages; every ayah number on the same page (tested); the gold medallion uses the same `wirdAyahOnPage` |
| Khatma cycles and records | stop/cycle ids, page 604 rules (`khatmas.ts`) | page-based, renderer-independent |
| Favorites, reflections, shares | `verseKey` + verified text | the text comes from SQLite in both renderers |
| Last browsed page | page number | same pages |
| Sync payloads | unchanged | no backend or schema change |

Release gates: the existing reading-sync, Khatma and favorites suites pass; a migration test opens every saved ورد page
in both renderers and checks the same page and gold ayah.

## 8. Immediate rollback

- **Server-free, minutes:** publish an EAS Update setting `MUSHAF_RENDERER_DEFAULT = 'qcf-v1'` (or roll back the update
  with `eas update:rollback`). Because no data was migrated, rolling back loses nothing.
- **Per user:** Settings → Quran → Mushaf script → Classic (QCF).
- **Automatic:** any page whose font fails to load or whose text check fails is drawn by QCF V1 (§6).

## 9. Rollout sequence

1. Internal: development builds on the checklist devices (both fonts, Tajweed ON/OFF), results recorded.
2. Preview build (`eas build --profile preview`) with Unicode default for testers; QCF selectable.
3. Production with the default still QCF and the Unicode option visible ("beta") for one release.
4. Switch the default to Unicode by EAS Update when crash-free and with no rendering reports; keep QCF selectable.
