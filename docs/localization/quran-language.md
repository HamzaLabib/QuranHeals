# Language settings: App, Emotions and Quran Language

**Status (2026-10-13):** implemented and tested, not deployed. This supersedes the "three app interface locales" and "Quran Translation setting" parts of [app-locales-and-quran-translation.md](app-locales-and-quran-translation.md).

Settings has exactly three language settings, in this order, followed by Appearance, Legal & Privacy and Account:

| # | Setting | Options | Controls |
|---|---|---|---|
| 1 | **App Language — لغة التطبيق** | English (`en`), العربية (`ar`) | The whole interface: navigation, Settings, Home text, Favorites, Reflections, Mushaf controls, أورادي وختماتي, account, dialogs, accessibility labels, and headings such as "How this ayah connects". |
| 2 | **Emotions Language — لغة المشاعر** | Follow App Language (default), English, العربية الفصحى, العربية المصرية (`follow`, `en`, `ar`, `ar-EG`) | Emotion content only: the 30 emotion names (Home, View All, the ayah screen's title) and the body of "How this ayah connects". |
| 3 | **Quran Language — لغة القرآن** | The Quranic Text — النص القرآني (`quran-text`) | The primary full-Quran reading mode: today, the traditional 604-page Arabic Mushaf, unchanged. |

The Quran itself is always Arabic and is rendered exactly as before.

**Code:**
- `mobile/src/localization/locales.ts` (`APP_LANGUAGES`)
- `emotionsLanguage.ts`, `useEmotionsLanguage.tsx`
- `quranLanguage.ts`
- `useAppLocale.tsx`
- `app/settings.tsx`

## App Language

- English or Arabic only. Stored as `en` / `ar` under `quran-heals:app-locale:v1`, unchanged key.
- Default: English, as before.
- Egyptian Arabic is no longer an interface language. Its translation resources (`messages.ts`, the emotion catalog's `ar-EG` names) are kept.

## Emotions Language

**Storage:** `quran-heals:emotions-language:v1`, on the device. When nothing is stored, the default (`follow`) applies, so an explicit choice is distinguishable from the default.

**Resolution** (`resolveEmotionLocale`):
- `follow` + English app → English; `follow` + Arabic app → MSA.
- An explicit choice stays the same whatever the App Language.

**Direction:** each emotion text carries its own direction. An Arabic emotion name reads right to left in an English interface, and an English one left to right in an Arabic interface. This is per text style; React Native's global RTL setting is never changed.

**Fallbacks** (existing rules; no content invented):
- **Emotion names:** the chosen locale's name → English → a readable form of the stable key (`utils/emotionLabel.ts`). All 30 emotions have `en`, `ar` and `ar-EG` names (tested).
- **"How this ayah connects":**
  - Approved explanations exist in English and Arabic only.
  - Egyptian Arabic shows the approved Arabic (MSA) text, as it always has (`utils/ayahConnection.ts`).
  - When the chosen language has no text, the section is hidden, never shown in the other language.
  - The heading is interface text, so it follows the App Language.

**Unchanged:** emotion keys, names, mappings, explanations and order.

## Quran Language

- **Registry:** `QURAN_READING_MODES` in `quranLanguage.ts`, currently one entry: `quran-text`.
- **Storage:** the stable id (never a label) under `quran-heals:quran-language:v1`. An unknown stored id falls back to `quran-text`.
- **What is listed:** only modes that exist. No disabled options, placeholders or "coming soon" entries.
- **Scope:** no backend or database change. The Mushaf, its text, fonts, artwork, geometry, opening pages, markers, navigation, bookmark toolbar, أوراد, positions and Khatma logic are untouched.

## Show translation (the Quran Translation row is gone)

The old Settings row chose a **display mode** for the bundled English Pickthall translation: `always` (the default), `on-demand` or `off`. Only `on-demand` shows the Show translation / Hide translation button. With the row gone, a stored `always` or `off` could never be changed again; `off` would hide the translation for good.

**What the ayah screen does now** (`AYAH_SCREEN_TRANSLATION_MODE = 'on-demand'`):
- the Arabic ayah is always shown;
- **Show translation — إظهار الترجمة** reveals the Pickthall translation with its attribution, and Hide translation hides it;
- the translation is never shown automatically.

**What is preserved:**
- The stored preference is **kept, not erased**: still synced with the account, and still the Share sheet's starting choice for "show translation".
- Only one translation source exists (Pickthall), so there is no source ambiguity.

**Behaviour change for default users (`always`):** the ayah screen now opens with the Arabic alone and the Show translation button, instead of showing the translation automatically. This follows the requested Show/Hide behaviour; it needs product confirmation.

## Migration and sync

- **Stored `ar-EG` App Language** (on load, `migrateLegacyAppLanguage`):
  - Emotions Language becomes `ar-EG`, unless an Emotions Language is already stored.
  - The App Language then becomes `ar`.
  - It is idempotent and repeats safely if interrupted. Every other preference and all user data (Favorites, Reflections, أوراد, Khatmas, account, encryption) are untouched.
- **Account sync of the App Language** (`preferences.locale`) is unchanged:
  - New app versions send `en` / `ar`.
  - An `ar-EG` from an older device is applied as Arabic, with Egyptian Arabic emotions unless chosen otherwise.
  - The backend still accepts `ar-EG` from older app versions; no backend change.
- **Emotions Language and Quran Language** are device preferences (not synced), like Appearance.

## Future Quran reading languages (not implemented)

A future mode, such as English or Turkish, means:
- **Registry:** one more `QURAN_READING_MODES` entry, listed only once it exists.
- **Its own layout:** a dedicated translated reading layout showing a verified translation of the meanings as the primary content. It is not shown under the Arabic page and never drawn inside the 604-page Mushaf SVG. The Arabic Mushaf stays available unchanged.
- **Attribution:** the translator and source are identified.
- **Navigation:** logical, by Surah and Ayah. A translation's pages don't correspond to the Mushaf's 604 pages; switching modes keeps the logical location (Surah:Ayah) where possible.
- **Khatma:** أوراد and Khatmas are defined on the 604-page Arabic Mushaf. Translation-mode positions are never counted as Mushaf progress; translation-mode Khatma behaviour needs its own design.
- **Emotion screens:** whether a Quran Language should also change the primary content of emotion-based ayah screens is a separate product decision. Today they are unchanged.
