# Offline QPC V1 Mushaf (phase 2B)

Goal: download the complete 604-page QPC V1 Mushaf once, then read it without a connection, including after more than seven days offline. Corrections from Quran Foundation are synced whenever the device is online.

This phase is the data infrastructure only: the backend keeps the Content Sync copy; the app downloads, validates, stores and reads it. The 604-page reader and page fonts are next (see *Remaining work*).

**Basis.** Quran Foundation's Content Sync resource **`mushafs:2`** (QCF V1, King Fahd Complex 1405 AH print), used under the Developer Terms and the relay arrangement confirmed with Quran Foundation:
- Content Sync is the only path to an offline copy.
- A copy kept on the backend or a device syncs at least every 7 days when connectivity permits, and stays usable during outages.
- Quran Foundation is credited (`attribution` in the manifest; the sources line on Home and `/credits`).

Ordinary page-layout API responses are never stored offline: that path still keeps a page for at most 7 days. No QCF V2 data is used.

## Data model

| Field (Content Sync `mushaf_word`) | Use |
|---|---|
| `text` | QCF V1 glyph code, drawn only with that page's font |
| `page_number`, `line_number` | page 1–604, line 1–15 |
| **`position_in_page`** | reading order. **Never `position_in_line`**: on many lines it starts with the line's last number (page 61, line 4: `9,1,2,…,8`). |
| `verse_id` | global ayah index (1 = 1:1 … 6236 = 114:6), mapped to `surah:ayah` with the canonical surah counts and the verified Tanzil database; never trusted on its own |
| `position_in_verse` | word number within the ayah; the marker comes last |
| `char_type_name` | `word` or `end` (the ayah marker). `pause`, `sajdah` and `rub-el-hizb` are accepted as marks; the current data has none. |

The device stores each word as `[line, verseId, positionInVerse, type, glyph]` in page order, in 31 content-addressed **chunks** of 20 pages (the last holds 4).

## Backend: Content Sync and relay

Code: `backend/src/mushaf/offline/`.

- **`syncService.ts`**:
  - **First run:** bootstrap (`/resources/sync?bootstrap=true&resources=mushafs:2`), then stream the snapshot (`/resources/snapshots/mushafs/2`, one ~23 MB response, parsed record by record by `snapshotStream.ts`).
  - **Later runs:** incremental changes from the stored `next_sync_token`, following `next_page_url` within the run. Changes apply in `sequence` order:
    - `ROW_CREATE`/`ROW_UPDATE` upsert a row;
    - `ROW_DELETE` deletes one;
    - `RESOURCE_INVALIDATE` re-fetches the snapshot;
    - `RESOURCE_DELETE` withdraws the dataset;
    - `410 resync_required` bootstraps again.
  - One run at a time (single-flight).
- **`dataset.ts`:** validates and compiles. Every check must pass, or nothing is published (*Validation*). Builds the chunks and a content hash, the version: the same data always gives the same version.
- **`store.ts`** (files, no database), in `MUSHAF_SYNC_DIR`, default `backend/data/mushaf-sync/` (git-ignored):
  - `state.json`: the cursor, sequences, `currentVersion`, `lastSuccessAt`;
  - `records-<sequence>.json.gz`: the raw Content Sync rows, the faithful copy that changes apply to;
  - `versions/<version>/`: an immutable `manifest.json` and `chunks/<n>.json.gz`.
- **Safe interruption:** everything is written under a temporary name and renamed into place; `state.json` is replaced last.
  - An interrupted sync publishes nothing.
  - A synced state that **fails validation is kept but not published**: the last valid version is still served, and a later sync, or a corrected check, publishes without downloading again.
  - The last three versions are kept for downloads in progress.
- **Schedule:** with `MUSHAF_SYNC_ENABLED=true` (and the QF credentials), `server.ts` checks hourly and syncs when the last success is ≥ 24 h old. `npm run mushaf:sync` runs once by hand (`-- --report` prints the validation report). Off by default; Render is unchanged.
- **Relay** (`routes.ts`, public; reading never needs a session):
  - `GET /api/mushaf/qpc-v1/offline/manifest`: version, chunk hashes and sizes, sequences, `syncedAt`, attribution. `no-store`. 503 until a version is published.
  - `GET /api/mushaf/qpc-v1/offline/versions/:version/chunks/:index`: gzip JSON, `private, max-age=31536000, immutable`. 404 for anything not published.
- **Credentials:** they stay in the backend process (`qfContentClient.ts`, now also streaming). Logs carry categories, statuses, sequences and counts, never tokens or bodies.

## Device: SQLite store

Code: `mobile/src/mushaf/offline/`. Its own database file, **`mushaf-qpc-v1.db`**, separate from the bundled Tanzil `quran.sqlite` (which is unchanged).

```sql
meta(key PRIMARY KEY, value)             -- schema, version, synced_at, installed_at, last_check_at,
                                         -- applied_sequence, snapshot_sequence, word_count, attribution
pages(page PRIMARY KEY, first_verse_id, last_verse_id, chunk)
words(page, position, line, verse_id, surah, ayah, position_in_verse, kind, glyph,
      PRIMARY KEY (page, position)) WITHOUT ROWID
chunks(idx PRIMARY KEY, sha256, first_page, last_page)        -- the installed version's chunks
staged_chunks(sha256 PRIMARY KEY, idx, json, staged_at)       -- verified downloads awaiting install
```

On opening, a `PRAGMA quick_check` and a row-count check against `meta` decide between ready, empty and corrupt. A corrupt store is reset (to be downloaded again), never read.

## Download lifecycle

`offlineMushaf.download({ signal, onProgress })`, started from **Offline Mushaf → Download for offline reading** on `/mushaf`:

1. **Check:** fetch and validate the manifest (it must describe exactly 31 chunks covering pages 1–604).
   - Same version installed and healthy → *up to date*; nothing is downloaded.
2. **Plan:** only chunks whose hash differs from the installed version are needed. Chunks already staged (from an earlier, interrupted attempt) are not downloaded again.
3. **Storage:** refuse to start if free space is under about 4 × the needed bytes + 20 MB (`insufficient_storage`). A full disk during writing is reported the same way, and nothing is installed.
4. **Download:** chunk by chunk; each must match its SHA-256 (one retry) and its page range, then is **staged at once**.
   - Progress: chunks and bytes.
   - **Cancel** (between chunks) and dropped connections keep everything staged; the next attempt, even after a restart, continues with what is missing.
5. **Verify:** the whole Mushaf (new chunks plus unchanged installed pages) passes the same validation as the backend, against the device's verified Tanzil database. If it fails, the staged chunks are discarded and the installed version stays.
6. **Install:** one exclusive transaction replaces the changed chunks' pages and records the version. Readers see the old version or the new one, never a mix.

Removal (`remove()`) deletes the installed copy and any staged chunks.

## Synchronisation strategy

- **Backend → Quran Foundation:** at least daily while enabled.
- **Device → backend:** `checkForUpdate()` runs 15 s after app start when the Mushaf is installed, at most once per 24 h (`UPDATE_CHECK_MS`). *Check for updates* on `/mushaf` forces it.
  - A new version installs as above, so usually only the changed chunks are downloaded.
  - Offline or server unavailable: the result is `offline`, and nothing changes.
- **Offline for any length of time:** the installed copy stays readable. Nothing expires it or deletes it because the device has been offline for more than seven days; it updates on the next check once online. (Tested with 400 days.)
- **No session needed:** the manifest and chunks are public endpoints, and reading uses only the local database.
- `/mushaf` now reads page 61 from the offline database when installed, otherwise from the online page API as before. The existing Tanzil check runs either way, so a page that disagrees falls back to the Quran SVG page.

## Storage

| Where | Size |
|---|---|
| Backend copy (raw records + one published version, gzip) | 2.2 MB |
| Download (31 chunks, JSON) | 2.1 MB (less on the wire: gzip) |
| Device database after install | 4.7 MB (measured) |
| Page fonts (later, TTF, all 604) | 94.9 MB |

## Validation results (production `mushafs:2`, sequence 547614, 2026-10-11)

| Check | Result |
|---|---|
| Pages | 604, each 1–15 lines, never going backwards |
| Ayahs | all 6,236 in reading order, positions 1…n, one marker each as the last word, no duplicates |
| Entries | 83,665 = 77,429 words + 6,236 markers |
| Word counts vs verified Tanzil | all 6,236 match, after two documented, exact rules (below) |
| Page boundaries | 604 / 604 page starts match Tanzil's `quran-data.xml` |
| Page 61 | identical, word for word (135 / 135), to the verified Content API page; line breaks match `Reference Design.jpg` |
| Page 1 | 1:1–1:7, 7 markers, lines 9–15 |
| Page 2 | 2:1–2:5, 5 markers, lines 10–15 |
| Page 300 | 18:54–18:61, 8 markers, all 15 lines |
| Page 604 | 112:1–114:6, 15 markers, lines 3–4, 7–9, 12–15 |
| Device pipeline on the real data (the app's code, Node SQLite) | installed in 0.6 s; page 61 read back identical; a second run downloads nothing |

Run `node tools/mushaf/verify-offline-dataset.mjs http://localhost:4000`: it downloads everything through the relay as the app does.

**The two word-count rules** (anything else fails):
- **Basmala:** Tanzil's text starts the first ayah of 112 surahs (all but 1 and 9) with the basmala, while the print sets it on its own line. Those 4 words are left out of the count only when the ayah begins exactly with Tanzil's 1:1 basmala, or (95:1, 97:1) with بِّسْمِ, the same word with a shadda after the ب.
- **Joined words:** the QCF V1 layout counts two Tanzil tokens as one word in 2:181, 8:6 and 13:37 (بَعْدَ مَا) and 37:130 (إِلْ يَاسِينَ). The ayah must contain that exact pair and have exactly one word fewer. All four are in `tools/quran-verification/output/kfgqpc-comparison-report.md`.

## Surah headers and basmala

Content Sync has no records for them; they are **lines with no words**. In the data:
- All 240 empty lines lie directly before a surah's first ayah: none are anywhere else.
- **90 surahs:** 2 empty lines just before the first ayah.
- **21 surahs:** 1 empty line at the end of the previous page and 1 at the top of the new page.
- **Surah 9:** 1 line (no basmala).
- **Pages 1–2:** the text sits on lines 9–15 and 10–15 (8 and 9 empty lines above): the special opening pages.

`surahOpenings.ts` resolves the empty lines using page and ayah order and checks the result across all 604 pages: 114 headings and 112 Basmalas, including all 21 split openings. The Basmala uses the verified QPC V1 glyphs from page 1. Each Surah name uses Amiri Bold; a newly authored vector ornament sits behind it inside the existing heading row. Neither adds a line nor moves Quran text. The full SIL OFL 1.1 font notice is shipped with the app; see `mushaf.md` for source and licence findings.

## Page fonts (phase 2C)

Code: `mobile/src/mushaf/offline/fonts.ts` (download, records, updates), `fontFile.ts` (checks), `index.ts` (device storage and CDN).

- **Source:** Quran Foundation's documented CDN, `https://verses.quran.foundation/fonts/quran/hafs/v1/ttf/p{N}.ttf`.
  - Kept inside the app under the Mushaf fonts terms (active Developer Console account, credit to Quran Foundation, never offered separately).
  - Page 61's font stays bundled (`assets/mushaf/qpc-v1/p61.ttf`) and is never downloaded. The other 603 are never bundled.
- **Part of the one download.** **Download for offline reading** installs the layout, then the fonts.
  - Progress: layout by bytes, then "page fonts n / 604".
  - The panel says **"The complete Mushaf is ready for offline reading"** only when the layout is installed and all 604 fonts are verified (`status().complete`). Otherwise it shows "Page fonts n / 604" and **Continue download**.
- **Checked before use** (`checkPageFont`):
  - a well-formed TrueType file (table directory inside the file, `head` magic, 2048 units per em);
  - the family name exactly that page's (`QCF_P300` for page 300);
  - a glyph for **every glyph code the page's verified layout uses**.
  - A font for another page, a truncated body, or an error page all fail. Each download also must match its `Content-Length`, and gets two attempts.
- **Storage:** `<documents>/mushaf/qpc-v1/fonts/p{N}.ttf` (persistent). Each font is written to `p{N}.ttf.part` and moved into place; leftover `.part` files are removed before each download.
  - The `fonts` table records each font's size, SHA-256, `ETag`, `Last-Modified`, verification and check times.
- **Resume:** per font. Recorded fonts that are present at the recorded size are never downloaded again; cancelling or a dropped connection keeps everything verified so far.
- **Damage:**
  - A font whose size no longer matches its record is downloaded again on the next download.
  - **When a font is loaded** (`pageFont(page)`), its full SHA-256 is checked. A damaged file is deleted and reported as unavailable, then repaired next time.
  - `verifyFonts()` runs that check for all of them.
- **Updates:** at most every 30 days when online, one conditional request per font (`If-None-Match`, `If-Modified-Since`). `304` means unchanged; a changed font is checked and replaced the same way. A layout update that changes a page's glyph codes rechecks that page's stored font against the new codes.
- **Storage check:** before the fonts, about 2 × 160 KB per missing font + 20 MB must be free. The layout's own check also allows for the fonts on a first download.
- **Removal:** **Remove offline copy** deletes the layout and every downloaded font. A damaged database (detected on open) is reset together with its fonts.

### Results with the real fonts (2026-10-11)

The app's own code ran in Node against the local relay and the real CDN:
- **Complete Mushaf in 11 s** (layout plus 603 fonts, this PC's connection).
- **All 604 fonts valid for their page:** right name, and every real glyph code of the page covered. A neighbouring page's font is rejected.
- **94.7 MB of fonts plus 4.7 MB database.**
- **Monthly check:** 603 conditional requests, all `304`. Nothing was re-downloaded.
- Everything was deleted afterwards.

## Phase 2D: open questions and recommendations

1. **Surah headers and basmala.** All 21 split cases are resolved and checked across the complete 604-page snapshot: the prior page carries the heading, and the first empty line on the new page carries the Basmala. The original frame and font licensing are documented in `mushaf.md`.
   - surahs 4 (p. 77), 10 (208), 22 (332), 23 (342), 24 (350), 26 (367), 27 (377), 32 (415), 33 (418), 37 (446), 38 (453), 45 (499), 47 (507), 53 (526), 60 (549), 64 (556), 65 (558), 80 (585), 82 (587), 86 (591), 91 (595).
   - The heading/Basmala assignment is validated by `tests/mushafAllPages.test.ts` and `tools/mushaf-audit/audit-surah-openings.mts`.
   - In 32 more surahs the two reserved lines are the top two lines of a page.
   - The frame is original Quran Heals vector artwork; the Basmala remains the verified QPC V1 glyphs. No King Fahd page calligraphy or unverified QUL font is embedded.
2. **Pages 1 and 2.**
   - Text sits on lines 9–15 and 10–15.
   - Their marker glyph is smaller: box (9, −459) – (1916, 1310), against (2, −574) – (2546, 1785) on every other page sampled. They need their own `QCF_V1_METRICS` entry and a frame layout of their own.
   - Units per em (2048) and hhea metrics are the same on all pages.
3. **Ayah numbers beyond page 61.** The ornament is identical on every page, but number artwork differs per page. **Recommended:** draw numbers with a font inside the shared ornament (Uthmanic Hafs from QF's CDN, or Amiri), after a side-by-side check against page 61's artwork numbers. The alternative is about 5 MB of extracted number paths.
4. **Font memory.**
   - `expo-font` can't unregister a font, so each loaded page stays registered for the session (~160 KB file each, memory-mapped by the OS).
   - The reader should load only the visible page ±1 and measure on a device what a long session costs.
5. **Cache cleanup.** Implemented: `.part` cleanup, size checks, SHA-256 on load, 30-day ETag checks, and removal with the layout. Still to add: a Settings entry showing storage used and offering removal.

## Production storage on Render (investigated; nothing changed)

Today: a paid **Starter** web service in a **Hobby** workspace (`docs/backend-operations.md`), MongoDB **Atlas M0**, and a Render Cron Job already used for retention. Render's filesystem is ephemeral: a deploy or restart loses `backend/data/mushaf-sync`.

What the copy needs: **1.69 MB** of raw records (gzip) + **0.41 MB** per published version (31 gzip chunks) + a 1 KB state, so about 3 MB with three versions kept. Plus a daily incremental sync (usually a few KB).

| Option | Cost | Restarts and deploys | Daily sync | Full re-downloads |
|---|---|---|---|---|
| **A. Ephemeral disk (today's code as is)** | $0 | Copy lost; the relay answers 503 until a new bootstrap (~1 min) | In the web service | **Every deploy or restart: a 23 MB snapshot** |
| **B. Render persistent disk** on the web service, `MUSHAF_SYNC_DIR=/var/data/mushaf-sync` | 1 GB ≈ $0.25/month (Render's published $0.25/GB; check the dashboard) | Survives; daily snapshots kept 7 days; **zero-downtime deploys are disabled** (a few seconds down per deploy); one instance only | In the web service (cron jobs can't mount disks) | Only on `410 resync_required` or `RESOURCE_INVALIDATE` |
| **C. MongoDB (existing Atlas M0)**: the same store interface over one collection (state, records as one gzip document, one document per chunk) | $0 (≈3 MB of the 512 MB) | Survives; no downtime; any number of instances | In the web service, or a Render Cron Job like the retention job | Same as B |
| D. Object storage (S3, R2) | ≈ $0 at this size | Survives | Either | Same as B, but a new vendor and credentials |

**Recommendation: C, MongoDB.**
- It's the most reliable for no extra cost: no deploy downtime, nothing new to run, and it survives everything.
- The integrity rules carry over unchanged. Versions are immutable and the state pointer is written last; in MongoDB the state document is written last, or a version's documents and the pointer go in one transaction.
- The store is already isolated behind `MushafSyncStore`, so this is one new implementation, plus a dedicated least-privilege Atlas user (like the retention user) and a migration-free collection.
- It needs approval to change MongoDB and Render.

If MongoDB is off the table, choose **B**: one line of configuration and $0.25/month, at the cost of a few seconds of downtime per deploy. Avoid **A** in production: every deploy would re-download the full snapshot from Quran Foundation.

## Remaining work

1. **Page fonts:** done in phase 2C (above).
2. **The 604-page reader:** right-to-left paging, surah/juz' index, running heads per page, header and basmala lines (after the question above), medallion numbers for every ayah, and pages 1–2.
3. **Backend in production:** store the copy in MongoDB (recommended above) and enable the schedule. This phase doesn't change Render or MongoDB.
4. **Web:** the offline store targets iOS and Android. The web bundle builds (`expo-sqlite` is loaded on first use), but downloading in a browser depends on expo-sqlite's web storage and wasn't verified.
