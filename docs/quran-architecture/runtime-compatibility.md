# Runtime compatibility map (before integration)

This map was recorded before changing runtime behavior for the SQLite migration.

| Boundary | Existing behavior | Compatibility requirement |
| --- | --- | --- |
| MongoDB `Verse` | Arabic and surah/reference metadata; foundation ObjectId | Preserve data and ID; display Arabic from SQLite |
| Legacy `Ayah` | Arabic/translation/emotion snapshot, independent ObjectId | Preserve legacy lookup and selection fallback; never import text through its trimming setter |
| Emotion mappings | `verseReferenceKey`, emotion, visible statuses; random selection within emotion | Keep editorial assignments/statuses/selection unchanged |
| API | `/api/ayahs/random?emotion=&exclude=`, `/api/ayahs/:id` return full DTO with `referenceKey`, numeric reference, Arabic, translation, source labels | Keep routes, ObjectIds, exclusions and fields; expose an additive stable `verseKey` |
| Mobile API client | Returns full DTO unchanged | Resolve reference and replace Arabic/source provenance before returning to UI |
| `/ayah/[emotion]` | Route parameter is emotion key; renders/shares full `Ayah` | Keep route/UI and translation; local Arabic only |
| `AyahCard` and sharing | Render/share `arabicText` from full ayah object | Receive locally resolved full objects; no raw SQL in UI |
| Favorites | AsyncStorage `quran-heals:favorites`, array of full DTO snapshots plus `savedAt`, keyed by ObjectId | Preserve original snapshots, IDs and dates; lazy local Arabic resolution; explicit unresolved-record handling |
| Recent history | AsyncStorage `quran-heals:recent-ayahs`, emotion to four ObjectId strings | Retain ID exclusions and old history; record stable references alongside IDs going forward |
| Platforms | Expo native and static web, no SQLite reader configured | Bundle exact existing asset and support local reads on both platforms |

`referenceKey` already provides a stable reference in normal API/favorite data.
Missing keys may be derived only from consistent integer surah/ayah fields.
ObjectIds alone and Arabic text must never be used to guess references.
Unresolvable records remain stored and are reported explicitly. No MongoDB
cleanup, source change, or destructive storage migration is authorized here.
