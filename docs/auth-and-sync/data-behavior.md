# Guest vs. signed-in data behavior

Quran Heals never requires an account (Part A). This table is the
authoritative summary of what is local-only vs. synced, and it must never
regress without updating this doc.

| Data | Guest | Signed in (Apple or Google) |
|---|---|---|
| 29 emotions, Quran text, translations | Always available, from `quran.sqlite`/`translations.sqlite`/MongoDB — never affected by auth. | Same. |
| Reflections (خواطر) | Stored locally only (`mobile/src/storage/ayahReflections.ts`, AsyncStorage key `quran-heals:ayah-reflections:v1`). | Stored locally **and** synced across the user's signed-in devices, encrypted client-side before upload — see `docs/auth-and-sync/reflection-privacy.md`. |
| Favorites | Stored locally only (`mobile/src/storage/favorites.ts`). | Synced across devices by stable `verseKey`, union merge — never deletes a favorite one device doesn't have (`mobile/src/sync/favoritesSync.ts`). |
| Preferences (locale, translation display mode, translation ID) | Stored locally only. | Synced: first sign-in with no stored account preference uploads local; otherwise the existing account preference is applied to the new/reconnecting device (`mobile/src/sync/preferencesSync.ts`). |
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
  `mobile/src/auth/useAuth.tsx`). Favorites/preferences propagate
  immediately on the action itself as a best-effort push in addition to
  that. There is **no** scheduled background sync while the app is fully
  backgrounded/closed (that would need a native background task, out of
  scope for this phase) — a change made offline syncs the next time the
  app is foregrounded with connectivity, not before.
