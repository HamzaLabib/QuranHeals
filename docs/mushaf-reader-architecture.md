# Mushaf reader: 604 pages and offline QPC V1 (phase 2B plan)

> **Update (phase 2B):** the offline data infrastructure (backend Content Sync of `mushafs:2`, relay, device SQLite store, download and sync) is built: see [mushaf-offline.md](mushaf-offline.md). Fonts and the 604-page reader below are still to do.

Investigation only: nothing here is implemented yet. Findings are from **2026-10-11**, against Quran Foundation **production**, using the backend's server credentials (they never left `backend/.env`). They cover the Content Sync documentation and Developer Terms of that date.

## 1. Content Sync: `mushafs:2` (QCF V1, 1405 AH)

**Published and accessible.**
- `GET /content/api/v4/resources/sync?bootstrap=true&resources=mushafs:2&per_page=100` returns one `RESOURCE_CREATE` (sequence 540855, changed 2026-10-02T14:41Z) with `snapshot_url` `/api/v4/resources/snapshots/mushafs/2`, `unavailable_reason: null` and a `next_sync_token`.
- The backend's existing `content`-scope token is enough; no extra scope was needed.

**The snapshot** (`GET /resources/snapshots/mushafs/2`):
- Envelope: `resource_group: "mushafs"`, `resource_id: 2`, `resource_content_id: null`, `schema_version: 1`, `sync_sequence`, then `records`.
- One JSON response with **no pagination**: Brotli-compressed, chunked (no length given), `Cache-Control: no-store`.
- About **23 MB decompressed**. While investigating, one probe streamed the whole response because of a parsing bug in my scratch script; nothing was written to disk. That measured 23.2 MB of decompressed JSON in 64 s. The compressed size on the wire was not measured.
- **Records:**
  - 1 `mushaf`: `name: "QCF V1"`, `description: "King Fahd Complex Mushaf 1405 hijri print"`, `pages_count: 604`, `lines_per_page: 15`, `default_font_name: "v1"`, `mapping_mode: "reference"`, `qirat: Hafs`.
  - 604 `mushaf_page`: `page_number`, `first_verse_id`/`last_verse_id`, `first_word_id`/`last_word_id`, `verses_count`, `verse_mapping` (e.g. page 61 → `{"3": "84-91"}`), `updated_at`.
  - `mushaf_word` records, about 90,000 in all (estimated: words 1 → page 62 were 10,092 records at ~272 bytes each):
    - `id`, `mushaf_id`, `word_id`, `verse_id`, `source_verse_id`;
    - **`text`**: the QCF V1 glyph code (1 character);
    - `char_type_id` / **`char_type_name`** (`word`, `end` …);
    - **`page_number`**, **`line_number`**;
    - `position_in_verse`, `position_in_line`, **`position_in_page`**;
    - `css_class`, `css_style`.

**Everything needed to rebuild the verified layout is there:** glyph codes, page, line, word order, verse, and the ayah markers (as `char_type_name: "end"`). Two things to know:
- **Order words by `position_in_page`, never `position_in_line`.** On page 61, `position_in_line` reads `9,1,2,…,8` on line 4: the first word of a line carries the line's last number. Sorting by it would scramble 14 of the 15 lines.
- **`verse_id` is a global index** (377 = 3:84), not a verse key. It maps to `surah:ayah` with the app's own Tanzil database (`verse_index`), so `quran_core` isn't needed.

**Page 61 against our verified implementation** (compared in memory; the Quran text was not changed):

| Check | Result |
|---|---|
| Lines | 15 / 15 |
| Words per line | identical on all 15 lines |
| Glyph sequence per line (ordered by `position_in_page`) | identical, 15 / 15 lines, 135 / 135 glyphs |
| Ayah markers (`end`) | 8, at the same positions |
| Verse and position-in-verse per word | 135 / 135 |
| First ayah of every line | identical |

Our verified layout came from the per-page Content API and passed `verify-qpc-v1-page.mjs` (the 15 reference line breaks, the 8 markers, Tanzil word counts). So the snapshot reproduces the verified page exactly.

**Open questions in the data** (for Quran Foundation, §5):
- `resource_content_id` is `null` for `mushafs:2` but 382 for `mushafs:1`.
- `mapping_mode: "reference"`.
- `first_word_id`/`last_word_id` span a much wider range than the page's word count (page 61: 65750–68341 for 135 words).
- Surah-header and basmala lines aren't represented by any record type (expected: lines with no words).

## 2. What the Developer Terms allow (quoted 2026-10-11)

**Layout data offline: allowed, but only through Content Sync.**
- "Cache or store QF Content longer than 1 week unless it is obtained and maintained through the Content Sync APIs."
- "If a content resource is available through Content Sync, Content Sync is the only permitted path for obtaining and maintaining an offline copy … do not build an offline copy from regular API responses."
- "perform a next sync at least every 7 days when connectivity to QF permits and apply all available changes. This ongoing obligation applies to copies kept on a backend or an offline device."
- "If connectivity to QF is unavailable for longer than seven days, the Application may continue using its previously synced Content Sync copy."

So a Content Sync copy may stay on the device and be read offline **beyond seven days**, as long as it is synced at least every 7 days whenever the device is online.

Now that `mushafs:2` is a Content Sync resource, the current per-page API path (24 h on the backend, ≤ 7 days on the device, then deleted) remains fine for online use. It must never become an offline store.

Limits that still apply:
- **No prepackaged layout:** "The Content Sync storage exception does not itself authorize distributing a prepackaged database or build-time bundle of QF Content." Every install must obtain its copy by syncing, not from data inside the app binary.
- **Derived data counts:** "Derived Materials that include or permit reconstruction of QF Content remain subject to the same restrictions." A processed layout table is still QF content.
- **Serving from our own backend is fine:** "Serving QF Content from a Developer-controlled backend within the Application's end-user experience is not, by itself, redistribution."

**Fonts: allowed separately, indefinitely.**
- "A Developer may cache or bundle font files and Mushaf images obtained through QF APIs or documented CDN URLs … distributed only as an integrated part of the Application … may not be offered separately to others", with credit to Quran Foundation (on Home and in the app's Quran Sources & Credits page).
- The font guide adds that fonts can be corrected, so caches need a refresh or invalidation strategy, and says not to load all 604 fonts upfront. A user-chosen one-time download is not "loading upfront", but loading should still be per visible page.

**Still outstanding:** written confirmation from the King Fahd Glorious Qur'an Printing Complex for the QCF V1 fonts (their copyright). This predates this plan.

## 3. Sizes and storage

| Item | Size | Notes |
|---|---|---|
| QCF V1 fonts, TTF (all 604) | **94.9 MB** | 27–177 KB each, mean 157 KB. iOS and Android need TTF. All 604 present on `verses.quran.foundation/fonts/quran/hafs/v1/ttf/p{N}.ttf`. |
| QCF V1 fonts, WOFF2 | 47.9 MB | Web only. |
| Layout snapshot (download) | ≈ 23 MB JSON decompressed; much less on the wire (Brotli) | One response. |
| Layout on the device (SQLite) | ≈ 5–8 MB (estimate) | About 90k word rows × ~40 B plus an index on `(page_number, position_in_page)`. |
| Medallion ornament | ~4 KB | One shared path (§4). |

The font CDN sends `ETag`, `Last-Modified` and `Accept-Ranges: bytes`.

Budget: about **110 MB** for the complete offline Mushaf. Check free space before starting.

## 4. Proposed architecture

### Layout: one Content Sync copy, relayed by our backend
The client secret can't go on devices: it's a server credential, and the app talks only to our backend. So:

1. **Backend sync job.** Bootstrap `mushafs:2` → fetch the snapshot → store it → run incremental sync with `next_sync_token` at least daily (well inside 7 days).
   - Apply `ROW_*` changes in `sequence` order.
   - Re-fetch the snapshot on `RESOURCE_INVALIDATE`.
   - Re-bootstrap on `410 resync_required`.
   - Storage location: a file or SQLite on the backend, or a new MongoDB collection. MongoDB needs separate approval.
2. **App API.**
   - `GET /api/mushaf/qpc-v1/sync?since=<sequence>` returns the full copy once, compressed and verified, or only the changes since `sequence`, plus the current sequence.
   - The current per-page endpoint stays for online use and for page 61.
3. **Device.**
   - A separate SQLite file (`mushaf-qpc-v1.sqlite`, apart from `quran.sqlite`), with tables `mushaf_page`, `mushaf_word` and `sync_state(sequence, synced_at)`.
   - Read pages from it with no network.
   - Sync whenever online and it is ≥ 24 h since the last sync, so it stays inside the 7-day rule.
   - Keep using the copy indefinitely while offline.
   - Every page still passes the existing Tanzil check (`checkAgainstTanzil`: ayahs, word counts, one marker per ayah) before it is drawn; a page that fails falls back.

**This relay design is the one point to confirm with Quran Foundation first** (§5, Q2). The terms say Content Sync copies "kept on a backend or an offline device" must sync every 7 days, but not whether a device copy obtained *from our backend's Content Sync copy* counts as "obtained and maintained through the Content Sync APIs".

### Fonts: on demand, plus an optional full download
- **Storage:** each page font in `FileSystem.documentDirectory/mushaf/qpc-v1/p{N}.ttf` (persistent, not the OS cache), downloaded from QF's documented CDN.
  - Write to `p{N}.ttf.part`, then rename.
  - Verify the size against `Content-Length` and check that the file is a TrueType file that loads.
  - Keep `p61.ttf` bundled.
- **On demand:** the visible page and its two neighbours.
- **"Download the whole Mushaf" (≈ 95 MB):**
  - Opt-in, Wi-Fi-only by default, with progress and a free-space check.
  - 4 files at a time.
  - **Resumable per file:** finished files are skipped, a half-finished one resumes with `Range` (the CDN accepts byte ranges) or restarts. Each file is ≤ 177 KB.
- **Corrections:** store each file's `ETag`. Roughly monthly when online, send a conditional request (`If-None-Match`) and replace on change.
- **Loading:** `expo-font` `loadAsync` per page as pages are shown, never all 604 at once. Registered fonts stay registered for the session (iOS and Android can't unregister), which is acceptable at ~157 KB each.

### Reader
- **Pages:** a horizontal list of 604 pages that renders only the current page ±1, with right-to-left order (page 1 at the right; swiping left to right goes forward, like a printed Mushaf).
  - A `FlatList` with `inverted` works with today's build.
  - `react-native-pager-view` would need a new native build.
- **Indexing:**
  - Page → ayah range: `mushaf_page.verse_mapping`.
  - Surah → page and juz' → page: computed from those ranges with the app's own Tanzil surah/juz' data (`JUZ_STARTS` in `mushafPage.ts`).
  - Running heads (surah, juz') come from each page's first ayah, as on page 61.
- **Memory:** at most 3 pages mounted, about 150 glyph views each, and only those pages' fonts loaded.
- **Today's expiry behaviour** stays for the online path. A page outside the synced copy, or failing its check, falls back to the online per-page API (≤ 7 days), then to the Quran SVG page.
  - The Quran SVG fallback is bundled for page 61 only; bundling all 604 SVG pages would be about 200 MB.
  - **Offline**, the fallback for other pages is a message, unless SVG pages are downloaded too.

### Decorative assets on every page
- **Border, headings, paper:** reused unchanged on every page (vector, built once).
- **Medallions:**
  - **Ornament:** the Quran SVG ornament path is **byte-identical** on pages 1, 2, 61, 300 and 604 (all checked), so one bundled ornament serves the whole Mushaf.
  - **Numbers:** the number drawings are *not* reusable (the same number is a different path on every page), so they can't come from page 61. Options:
    1. Draw numbers with a font inside the shared ornament: Uthmanic Hafs (QF's documented CDN, covered by the font terms), or Amiri. One small font covers all 6,236 ayahs. **Recommended**, after a side-by-side check against page 61's artwork numbers.
    2. Extract all 6,236 number paths from the quran-svg pages at build time (≈ 5 MB): exact artwork, but heavy.
  - **Placement:** the QCF V1 marker glyph has the same box (2, −574 → 2546, 1785) on pages 61, 300 and 604, one per ayah. **Pages 1–2 use a different, smaller marker** (9, −459 → 1916, 1310) and need their own metrics, as their layout differs anyway. A dev script should confirm the box across all 604 fonts once they are downloaded.
- **Surah headers and basmala lines** (not on page 61): Content Sync has no records for them, so `surahOpenings.ts` derives their slots from empty lines and ayah order. The Basmala uses QPC V1 glyphs; Surah names use Amiri Bold with an original Quran Heals SVG frame. No publisher calligraphy or unverified QUL font is extracted. See current licensing findings in `mushaf.md`; Quran Foundation question 5 remains useful for any officially licensed matching assets.

## 5. Questions for Quran Foundation

Channel: **developers@quran.com**, the contact named in the Developer Terms. Send from the account that owns the Developer Console app ("Quran Heals", server client) and include the client ID, not the secret.

1. **`mushafs:2` for offline apps.** Is the QCF V1 (1405 AH) Content Sync resource officially supported for offline mobile use? We see it published (RESOURCE_CREATE 2026-10-02) with `resource_content_id: null` and `mapping_mode: "reference"`. Does that mean anything for how it may be used or attributed?
2. **Backend relay.** Our server client credentials can't be embedded in a mobile app. May our backend keep the Content Sync copy (syncing at least daily) and pass the snapshot and changes to our own app's devices? Each device would store the copy offline indefinitely and apply changes at least every 7 days when connected. Does that count as "obtained and maintained through the Content Sync APIs" for the device copy? If not, is there a supported device-side flow?
3. **Word order.** Please confirm that `position_in_page` gives the reading order within a line. On page 61 `position_in_line` reads 9, 1, 2, …, 8 on line 4.
4. **`first_word_id` / `last_word_id`.** What do these refer to in `mushafs:2` (page 61: 65750–68341 for 135 words)?
5. **Surah headers and basmala.** How are header and basmala lines represented for QCF V1 pages? Are matching header or basmala fonts or images available through a documented CDN under the Mushaf fonts terms?
6. **Font corrections.** Is the `ETag` / `Last-Modified` on `verses.quran.foundation` the intended signal for corrected font files, and is a roughly monthly check acceptable?
7. **Volume.** Are there rate limits or guidance for snapshot downloads? Our design fetches the snapshot once per backend sync, never per device.
8. **If any of the above isn't permitted:** what written offline licence, including a paid one, would allow indefinite offline reading of all 604 QCF V1 pages in a free app?

Separately, ask the **King Fahd Glorious Qur'an Printing Complex** for written confirmation covering the QCF V1 fonts.

## 6. Recommended phases

1. **2B-0 (now):** send the questions in §5. Run the device checklist (`docs/mushaf-device-testing.md`) on page 61.
2. **2B-1, after QF confirms Q1–Q2:**
   - Backend Content Sync job and storage for `mushafs:2` (MongoDB or Render changes need approval).
   - A sync endpoint for the app, with tests on synthetic data only.
3. **2B-2:** the device SQLite store and sync, with the Tanzil check per page and the online per-page API as a fallback.
4. **2B-3:** on-demand fonts, then the optional full download (resumable, `ETag` refresh), and a storage screen to delete them.
5. **2B-4:** the 604-page RTL reader, surah/juz' index and medallion numbers (option 1). Surah headers and basmala follow Q5.

Each step keeps page 61, the appearance presets and the Quran SVG fallback working.
