# Surah Preview (عن السورة) data

The Mushaf reader's **Surah Preview / عن السورة** sheet (`mobile/src/surahPreview/`) shows, for a Surah beginning on the
page: its name; Makki/Madani, number of ayahs and Surah number; its main purpose (مقصد السورة); its main themes
(موضوعاتها). Development builds only (`bundledDataset.ts`), until the sources' terms allow a release.

## Pipeline

```
node tools/surah-preview/import.mjs [--cache <dir>] [--update-lock]   # writes mobile/assets/surah-preview/surah-preview.json (git-ignored)
node tools/surah-preview/validate.mjs [--file <dataset.json>]         # checks it and prints coverage
```

- `import.mjs` fetches the 114 QuranEnc pages (or reads cached copies), extracts «من مقاصد السورة» verbatim, and checks
  each against `source.lock.json` (SHA-256 per Surah): any change stops the import until reviewed (`--update-lock`).
  It merges `reviewed-content.json` when that file exists (see below).
- `validate.mjs` checks: 114 unique Surahs in order; ayah counts and Makki/Madani against Tanzil's raw
  `backend/data/quran/quran-data.xml` (6,236 ayahs); the Arabic purposes against the lock; each section's text present
  exactly when its status is not `unavailable`; `quoted` only for the Mukhtasar purpose; every cited source listed; no
  placeholder text.

## Sources

| Section | Source | Status |
|---|---|---|
| مقصد السورة (Arabic) | «المختصر في التفسير», مركز تفسير للدراسات القرآنية — «من مقاصد السورة», via https://quranenc.com/ar/browse/arabic_mokhtasar/{n} | **quoted**, 114/114, re-verified against the live pages 2026-10-24 |
| Makki/Madani, ayah count | Tanzil `quran-data.xml` (pinned sha256 in `backend/assets/quran/surah-names.json`) | 114/114; 43 Surahs listed for scholarly review in `classification-review.json` |
| موضوعاتها (Arabic) | — | **unavailable**, 0/114 (see below) |
| English purpose / themes | — | **unavailable**, 0/114 (see below) |

### Why the themes and the English are not included

- The Mukhtasar has no «موضوعات السورة» section, and QuranEnc's English Mukhtasar objectives were withdrawn (they follow
  an older Arabic edition).
- The one complete Arabic source found, الدرر السنية «موسوعة التفسير» (https://dorar.net/tafseer/{n}, «موضوعات السورة»,
  114/114), forbids it: «الموسوعات حالياً غير قابلة للتنزيل وإنما هي للبحث والتصفح من خلال الموقع فقط، ولا يسمح بنسخها
  واستخدامها سواء على جهاز خاص أو أقراص» (https://dorar.net/feedback); its API terms forbid bulk download, storage and
  republishing (https://dorar.net/api-services/terms).
- English: Quran.com / Quran Foundation's chapter info (Sayyid Abul Ala Maududi, Tafhim al-Qur'an; themes in 109/114) may
  be displayed live from the API but not bundled: «Prepackaged content … does not itself authorize distributing a
  prepackaged database or build-time bundle of QF Content» (https://api-docs.quran.foundation/legal/developer-terms/).
- Nothing was paraphrased, summarised or translated to fill the gap: the sheet says «غير متاحة بعد» / "Not available yet".

### Permissions still open

- Tafsir Center (المختصر): «جميع الحقوق محفوظة»; written permission for in-app use not obtained (info@tafsir.net).
- QuranEnc terms (re-publishing translations unchanged, credited, versioned, kept up to date): whether they cover the
  Arabic tafsir's objective lines inside an app is unconfirmed.

## Adding reviewed content — `reviewed-content.json`

Absent until a source is approved for use. Shape:

```json
{
  "sources": [{ "id": "…", "title": "…", "publisher": "…", "url": "…", "retrieved": "YYYY-MM-DD", "permission": "…" }],
  "surahs": {
    "18": { "themesAr": { "items": ["…"], "status": "pending-review", "sources": ["…"] } }
  }
}
```

Sections: `themesAr`, `themesEn` (`items`), `purposeEn` (`text`). Status `approved` (a qualified reviewer approved it) or
`pending-review` (shown in development builds marked «قيد المراجعة العلمية»). Every section must cite a listed source;
the import refuses anything else, and nothing here may claim `quoted`.
