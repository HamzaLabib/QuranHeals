# App locales and Quran translation preferences

This document covers two deliberately independent axes of localization in
Quran Heals: which language the **app interface** is shown in, and which
**Quran translation** (if any) is shown alongside the Arabic text. Confusing
these two has been a recurring risk in the design, so it is called out
explicitly throughout.

## The three app interface locales

Quran Heals v1 ships three interface locales:

- `en` — English (default, preserves the app's original behavior)
- `ar` — Modern Standard Arabic (MSA)
- `ar-EG` — Egyptian Arabic

Only one locale is shown at a time. The emotion picker never shows an
English name and an Arabic name on the same card simultaneously; the result
screen shows one localized label, not a language pair. `en` is LTR; `ar` and
`ar-EG` are RTL. Direction is applied at the component/style level
(`writingDirection`, `textAlign` — see `mobile/src/localization/locales.ts`),
never via React Native's global `I18nManager.forceRTL`, which requires an app
restart to take effect.

The selected locale persists across app restarts via AsyncStorage
(`quran-heals:app-locale:v1`, see `mobile/src/localization/useAppLocale.tsx`)
and is changed immediately from Settings — no restart required.

### Stable emotion keys never change

Each of the 29 canonical emotions has a permanent, internal `key` (e.g.
`peaceful`, `want_to_cry`, `closer_to_allah`) used for routing, API calls,
mapping relationships, and history/favorites storage. That key is never
translated, reformatted, or exposed to the user. Only its *display name*
changes per locale, sourced from `names: { en, ar, 'ar-EG' }` in the single
canonical catalog: `backend/src/emotions/emotionCatalog.ts`. This is why an
emotion's English display wording can change (e.g. `peaceful` → "At Peace")
without touching a single mapping, favorite, or history entry — the key is
the only thing anything else in the system depends on.

Every one of the 29 emotions also carries `descriptions: { en, ar, 'ar-EG' }`
in the same catalog. As of this document, **descriptions are data-ready but
not yet rendered anywhere in the UI** — they exist so a future screen can use
them without another backend/data migration.

### Adding a future app locale

Add one entry to `AppLocale`/`APP_LOCALES` (backend:
`backend/src/emotions/emotionCatalog.ts`; mobile:
`mobile/src/localization/locales.ts`, kept as an independent copy since
mobile and backend are separate npm packages), one dictionary in
`mobile/src/localization/messages.ts`, and one `names`/`descriptions` entry
per emotion in the catalog. No emotion key changes, no mapping changes, no
routing changes.

## Quran Arabic is always primary

The Arabic Quran text (`quran.sqlite`, Tanzil Uthmani text) is never hidden,
translated, or affected by the app interface locale or by the Quran
translation preference described below. It is always fetched from the
verified bundled SQLite asset and always rendered. This is a hard
architectural invariant, not a default that a setting can override — see
`docs/quran-architecture/runtime-architecture.md` for how Arabic is sourced.

## Quran translation preference (separate from app language)

Quran Heals currently ships exactly one verified Quran translation:
**Pickthall** (`en.pickthall.gutenberg16955`, from
`backend/assets/quran/translations.sqlite` /
`mobile/assets/quran/translations.sqlite`). No other translation (French,
Spanish, Urdu, Turkish, or otherwise) is bundled, and none is fetched from an
external API. **No AI-generated translation is used or should ever be
substituted for a verified, licensed translation dataset** — a future
translation must come from another separately verified, licensed,
verse-key-complete dataset, added the same way Pickthall was (see
`docs/quran-architecture/sqlite-integration.md`), never generated at
request time.

The translation preference is a separate setting from the app interface
locale:

```ts
type QuranTranslationPreference = {
  translationId: string;       // e.g. 'en.pickthall.gutenberg16955'
  displayMode: 'always' | 'on-demand' | 'off';
};
```

(`mobile/src/localization/quranTranslationPreference.ts`)

- **`always`** (default — preserves the app's original behavior of showing
  the translation automatically): Arabic and the English translation are
  both shown together, always.
- **`on-demand`**: Arabic is shown first. A localized "Show translation"
  button (`messages.translation.showTranslation`) reveals the translation.
  This reveal state is **local to that ayah screen** — it is not persisted
  and resets automatically whenever a different ayah loads. Only the
  `displayMode` setting itself is persisted.
- **`off`**: Arabic only. No translation, no reveal control.

In every mode, Arabic is shown. The app interface locale and the Quran
translation preference are fully independent: for example, an `ar-EG`
interface with `always` mode shows an Egyptian-Arabic UI, the Arabic Quran,
and the English Pickthall translation, all at once — this is a valid and
expected combination, not a bug.

The preference persists via AsyncStorage
(`quran-heals:quran-translation-preference:v1`) and is changed from Settings.
An old or malformed stored payload is parsed defensively
(`parseQuranTranslationPreference`) and never crashes the app — it falls back
to the default (`always` + Pickthall) field-by-field.

### Adding a future verified translation

Extend `translationId`'s valid values once a new translation has been
independently verified, licensed, and is verse-key-complete (matching the
same process used for Pickthall). This never requires redesigning the
`displayMode` architecture or the settings screen — only adding the new
translation as a selectable `translationId`.
