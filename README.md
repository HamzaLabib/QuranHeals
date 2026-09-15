# Quran Heals

**Qur'anic guidance for every emotion.**

## Quran source architecture decision

The canonical source for the immutable Quran foundation is **Tanzil Uthmani 1.1**:
`tools/quran-verification/input/quran-uthmani.txt` generates
`mobile/assets/quran/quran.sqlite`. The source contains 114 surahs and 6,236 ayahs,
with SHA-256 `6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f`.
Generation requires that exact hash and preserves every Arabic string unchanged.
All 6,236 strings must match after reading them back from SQLite.

**King Fahd remains an independent verification/reference source.** Its existing
comparison artifacts and the 2,498 remaining review cases are preserved. They do
not authorize an automatic text change or a canonical-source switch.

**Runtime Arabic now comes from local SQLite.** The backend selects the mapped
verse and supplies translation/editorial metadata and compatible Mongo IDs. The
mobile app resolves `verseKey → exact Arabic text` locally before rendering or
sharing, including saved favorites. Existing MongoDB Arabic fields and saved
snapshots remain for compatibility; no destructive migration was performed.

See the [SQLite build instructions](tools/quran-import/README.md),
[runtime migration report](docs/quran-architecture/runtime-architecture.md), and
[verification source history](tools/quran-verification/README.md).
The former MongoDB full-corpus import remains disabled; its reports are historical.

Quran Heals is a Qur'an-centered emotional support and reflection app. The core flow is intentionally simple: open the app, choose an emotion, receive one curated ayah for that emotional category, reflect, save, share, or request another ayah.

This app is for spiritual comfort and reflection. It is not medical treatment, psychotherapy, or a replacement for professional mental-health care.

## Product Concept

The home screen presents active emotions such as Sad, Anxious, Lonely, Angry, Lost, Afraid, Stressed, Hopeless, Tired, Grateful, Peaceful, and Confused. Each emotion maps to a curated set of ayahs through editorial metadata. Random selection happens only inside the selected emotion category.

## Architecture

The repository contains two independent TypeScript apps:

```text
quran-heals/
├── backend/
│   ├── src/
│   └── tests/
├── mobile/
│   ├── src/app/
│   ├── src/components/
│   ├── src/services/
│   ├── src/storage/
│   └── src/types/
├── README.md
└── .gitignore
```

The mobile app only knows the public backend API URL. MongoDB credentials and server secrets stay in the backend environment.

## Technology Stack

- Mobile: React Native, Expo, Expo Router, TypeScript
- Backend: Node.js, Express, TypeScript
- Runtime editorial/data storage: MongoDB Atlas, Mongoose
- Runtime Quran Arabic: verified local SQLite through Expo SQLite
- Testing: Vitest and Supertest for backend API tests

## Requirements

- Node.js 24+ was used during setup
- npm 11+
- Expo Go or a simulator/device for mobile testing
- MongoDB Atlas connection string for persistent backend data

## Installation

Install backend dependencies:

```bash
cd backend
npm install
```

Install mobile dependencies:

```bash
cd mobile
npm install
```

## Environment Variables

Backend environment lives in `backend/.env`.

```bash
cp backend/.env.example backend/.env
```

Set:

```text
PORT=4000
MONGODB_URI=mongodb+srv://...
NODE_ENV=development
CORS_ORIGIN=*
```

Mobile environment uses Expo public variables only:

```bash
cp mobile/.env.example mobile/.env
```

Set:

```text
EXPO_PUBLIC_API_URL=http://localhost:4000
```

For Android emulator, use `http://10.0.2.2:4000`.

## MongoDB Configuration

Create a MongoDB Atlas cluster, create a database user, allow your development IP address, and put the connection string in `backend/.env` as `MONGODB_URI`.

The backend uses Mongoose models for:

- `Emotion`: active emotion categories and presentation metadata
- `Verse`: existing runtime Arabic text copy, reference metadata, source/version, and checksum; pending separation from the immutable SQLite source
- `VerseTranslation`: translation text and translator/source/license metadata for a verse
- `EmotionVerseMapping`: editorial emotion-to-verse metadata with review status and rationale
- `Ayah`: legacy MVP collection, including another Arabic text copy, kept temporarily for compatibility and migration safety

These existing Arabic copies remain unchanged for runtime compatibility. MongoDB
is not the intended canonical owner of Quran Arabic. The
[migration checklist](docs/quran-architecture/sqlite-integration.md) covers reference validation,
API compatibility, favorites and recent history before a runtime switch.

## Database Seeding

After configuring `MONGODB_URI`, seed the development dataset:

```bash
cd backend
npm run seed
```

The legacy seed is deliberately small. After seeding, migrate the Phase 2 foundation collections:

```bash
cd backend
npm run migrate:foundation
```

The foundation migration is idempotent for local/development use. It preserves the small MVP dataset as existing `Verse` records, Pickthall `VerseTranslation` records, and separate `EmotionVerseMapping` records. This historical MongoDB migration does not generate or import the new SQLite corpus. Current emotion mappings are marked `development` until real editorial or scholarly review occurs.

To update emotion mapping metadata locally without editing Qur'an text:

```bash
cd backend
npm run mapping:upsert -- --verse=2:153 --emotion=sad --status=development --rationale="..."
```

## Starting the Backend

```bash
cd backend
npm run dev
```

Health check:

```text
GET http://localhost:4000/api/health
```

## Starting the Expo App

```bash
cd mobile
npm start
```

Then open the project in Expo Go, an emulator, or the web runner.

## API Endpoints

```text
GET /api/health
GET /api/emotions
GET /api/ayahs/random?emotion=sad
GET /api/ayahs/random?emotion=sad&exclude=ayahId1,ayahId2
GET /api/ayahs/:id
```

Successful responses use:

```json
{
  "success": true,
  "data": {}
}
```

Errors use:

```json
{
  "success": false,
  "message": "Invalid emotion."
}
```

## Testing

Backend:

```bash
cd backend
npm run typecheck
npm test
```

Mobile:

```bash
cd mobile
npm run lint
npm run typecheck
```

## Qur'an Data Integrity Rules

For immutable Quran source, generator and complete SQLite equality checks, see
[tools/quran-import/README.md](tools/quran-import/README.md).

- Never invent Qur'anic Arabic text.
- Never paraphrase Arabic text and present it as Qur'an.
- Never alter Qur'anic wording.
- Keep Arabic text, translations, emotion mappings, source metadata, and future commentary separate.
- Immutable SQLite verse records must not contain emotion tags; existing MongoDB `Verse` records also keep those tags separate.
- Preserve the pinned Tanzil strings exactly during SQLite generation, with no trimming, normalization or character substitution.
- Emotion mappings are reviewable editorial metadata and must not be treated as scholarly approved unless actually reviewed.
- Translation source and Qur'an text source must be identifiable.
- Checksums are SHA-256 over the exact stored UTF-8 text values.
- Replace or expand seed data only from trusted verified sources.

The current seed includes source metadata for Quran.com/Tanzil-style Arabic references and public-domain Pickthall translation metadata for development. Before App Store or Google Play release, perform a formal scholarly and licensing review of the full production dataset.

## Current MVP Functionality

### Historical Phase 3 source preparation (MongoDB import retired)

The complete Tanzil Uthmani 1.1 and Pickthall source exports are pinned locally in
[`backend/data/quran`](backend/data/quran/README.md). Source validation passes for
114 surahs and 6,236 verses/translations in that historical audit. Its preflight
found six existing Arabic text conflicts and five Pickthall text differences,
and reported an unchanged baseline of 16 verses, 16 translations, 43 development
mappings and 12 emotions. These are historical measurements, not a fresh database
audit. See the [Phase 3 report](backend/reports/quran-verification/summary.md).

From `backend`, `npm run validate:quran:source` checks those older pinned downloads;
`npm run validate:quran` audits MongoDB against that older full-corpus target.
Neither command validates the new SQLite foundation. `npm run import:quran`
is disabled and exits before loading or writing corpus data. The earlier report
records its Pickthall export licensing separately from the Arabic source and the
legacy seed metadata; no translations are added to the Arabic SQLite foundation.

### Existing functionality

- Backend health endpoint
- Active emotion list endpoint
- Random ayah by emotion endpoint
- Ayah lookup endpoint
- MongoDB/Mongoose models
- Development seed script
- Backend validation, rate limiting, CORS, Helmet, and error handling
- Mobile home screen with emotion cards
- Ayah screen with Arabic text, translation, reference, save, share, retry, and another ayah actions
- Local favorites with AsyncStorage
- Favorites screen
- Recent ayah history per emotion to reduce immediate repetition
- Loading and user-safe error states

## Future Roadmap

- Arabic application interface
- Additional translations and translation languages
- Tafsir
- Qur'an audio
- User accounts and cloud favorites
- Daily ayah
- Push notifications
- Emotional check-ins
- Journaling
- Search
- Sharing cards
- Dark mode polish
- Premium subscription and RevenueCat
- More emotion categories
- Admin interface for emotion tagging
