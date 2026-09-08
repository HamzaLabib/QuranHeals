# Quran Heals

**Qur'anic guidance for every emotion.**

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
- Database: MongoDB Atlas, Mongoose
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
- `Verse`: canonical Arabic Qur'an verse text, reference metadata, source/version, and checksum
- `VerseTranslation`: translation text and translator/source/license metadata for a verse
- `EmotionVerseMapping`: editorial emotion-to-verse metadata with review status and rationale
- `Ayah`: legacy MVP collection kept temporarily for compatibility and migration safety

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

The foundation migration is idempotent for local/development use. It preserves the small MVP dataset as canonical `Verse` records, Pickthall `VerseTranslation` records, and separate `EmotionVerseMapping` records. Current emotion mappings are marked `development` until real editorial or scholarly review occurs.

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

- Never invent Qur'anic Arabic text.
- Never paraphrase Arabic text and present it as Qur'an.
- Never alter Qur'anic wording.
- Keep Arabic text, translations, emotion mappings, source metadata, and future commentary separate.
- Canonical `Verse` records must not contain emotion tags.
- Emotion mappings are reviewable editorial metadata and must not be treated as scholarly approved unless actually reviewed.
- Translation source and Qur'an text source must be identifiable.
- Checksums are SHA-256 over the exact stored UTF-8 text values.
- Replace or expand seed data only from trusted verified sources.

The current seed includes source metadata for Quran.com/Tanzil-style Arabic references and public-domain Pickthall translation metadata for development. Before App Store or Google Play release, perform a formal scholarly and licensing review of the full production dataset.

## Current MVP Functionality

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
