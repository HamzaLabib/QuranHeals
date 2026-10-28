# Guest vs. signed-in data behavior

Quran Heals never requires an account (Part A). This table is the
authoritative summary of what is local-only vs. synced, and it must never
regress without updating this doc.

| Data | Guest | Signed in (Apple or Google) |
|---|---|---|
| 30 emotions, Quran text, translations | Always available, from `quran.sqlite`/`translations.sqlite`/MongoDB — never affected by auth. | Same. |
| Reflections (خواطر) | Stored locally only (`mobile/src/storage/ayahReflections.ts`, AsyncStorage key `quran-heals:ayah-reflections:v1`). | Stored locally **and** synced across the user's signed-in devices, encrypted client-side before upload — see `docs/auth-and-sync/reflection-privacy.md`. |
| Favorites | Stored locally only (`mobile/src/storage/favorites.ts`). | Synced across devices by stable `verseKey`, last-write-wins per ayah with durable deletion markers (tombstones), so a removal is never undone by a stale copy and a later re-add replaces the removal. Each add, removal or re-add is uploaded immediately with this device's own change time (`pushFavoriteChange`); the full sync (`syncFavorites`) uploads anything still pending and downloads other devices' changes (`mobile/src/sync/favoritesSync.ts`). |
| Settings: App Language, Quran Language, Emotions Language, Show Translation (display mode, translation ID, and since 2026-10-27 the dropdown's kept choice), Appearance, Quran font size; since 2026-10-27 also Favorite Reciter, Keep Screen Awake, Word Meanings, Memorization Mode, the three reminders' settings, and each guide's completion | Stored locally only. | Synced with the account **field by field**, each setting with its own change time, so two devices changing two different settings never undo each other; the same setting changed on two devices: the later change wins (`mobile/src/sync/preferenceFields.ts`, `preferencesSync.ts`; server: `backend/src/services/preferencesMerge.ts`). Only a change the user makes **while signed in to that account** is uploaded (`preferencesSyncState.ts`, per account). Signing in downloads the account's settings and applies them; it never uploads the guest's settings or another account's, and a setting the account has never stored is left as it is on the device (a default is never uploaded or applied). Offline changes stay pending and are uploaded at the next sync. The settings added on 2026-10-27 were device settings before: on the first launch of that version, the account signed in across the update takes the choices actually saved on that device, below any change made since (`sync/devicePreferencesClaim.ts`); a guest's or a later sign-in's device values are never claimed. Reminders: only their settings sync — each device keeps its own OS notification permission (asked only from the user's tap in Settings) and schedules locally; there are no push tokens. Keep Screen Awake still holds the screen only while the reader is focused and the app active. A guide's completion only moves forward (the Mushaf guide never goes from finished back to closed); a step in progress stays on the device. |
| Device-only: OS notification permission and the reminders actually scheduled, offline Mushaf and recitation downloads, a guide's step in progress | Stored locally only. | **Still stored locally only, on purpose**: they describe this device. |
| Last browsed Mushaf page | Stored locally only (`mobile/src/mushaf/lastBrowsedPage.ts`), so browsing survives an app restart. | **Same — never synced, never part of an account.** Browsing never moves a ورد; only an explicit save does. On opening, the more recent of the last browse and the active ورد's last save wins. |
| Reading stops (أورادي), their progress and completed Khatmas | Stored locally only, in the guest partition (`mobile/src/mushaf/readingStops.ts`, `khatmas.ts`; see `docs/khatma.md`). | Stored locally in the account's own partition **and synced across the account's devices through the authenticated account** (like favorites; not end-to-end encrypted, no Sync Password; see `docs/auth-and-sync/reading-sync.md`). Guest ورد and Khatmas move in only through "Add to this account"; account deletion removes them from this device and from the server. |
| Recently chosen emotions (Home's four cards) | Device-local, guest partition (`mobile/src/storage/recentEmotions.ts`); never uploaded. | The account's own partition, and since 2026-10-27 **merged across the account's devices**: one entry per emotion (its latest use), most recent first, at most 12 (`preferencesSync.ts`; server: `preferencesMerge.ts`). A choice made while signed in is uploaded right away; removed with the account. |
| Recent-ayah 10-minute non-repeat history | Device-local, always (`mobile/src/storage/recentAyahHistory.ts`). | **Still device-local — never synced, on purpose** (Part F §27). Two devices can show the same ayah for the same emotion independently. |
| Issue reports | Submitted directly to the backend (`POST /api/issues`), intentionally, with or without an account. | Same — no account data is auto-attached (Part I §37). |

## Sign-out (Part H §32)

Signing out:

- Ends the authenticated session (clears the session token and the cached,
  unwrapped reflection master key from Secure Store).
- Does **not** delete local reflections, favorites, or preferences — they
  remain fully usable exactly as a guest's would.
- Does **not** touch `quran.sqlite`, `translations.sqlite`, or MongoDB.

## Offline behavior (Part H §33)

- Reading Quran content, existing local reflections, favorites, and
  settings all work fully offline, signed in or not.
- A signed-in user's local edits (a new reflection, a new favorite, a
  changed preference) always save locally immediately — cloud sync is
  layered on top, never a blocker. A reflection is marked `pending` in
  local storage (`syncState`) until the next successful sync run applies
  it.
- A full sync (`runFullSync`) runs automatically: once on cold start (if
  already signed in), and again every time the app returns to the
  foreground while signed in (`AppState` listener in
  `mobile/src/auth/useAuth.tsx`). Favorites and synced settings propagate
  immediately on the action itself as a best-effort push in addition to
  that; a failed push stays pending on the device and the next full sync
  sends it. There is **no** scheduled background sync while the app is fully
  backgrounded/closed (that would need a native background task, out of
  scope for this phase) — a change made offline syncs the next time the
  app is foregrounded with connectivity, not before.
