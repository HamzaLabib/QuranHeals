# Pinned Tanzil source files

These are unmodified downloads from the [Tanzil Project](https://tanzil.net), retrieved on 2026-09-09. See `retrieval.json` for exact URLs, timestamps and file SHA-256 values, and `source-manifest.json` for the source convention, per-surah counts, versions and corpus checksums. Raw exports retain their provider notices.

Arabic is Tanzil Uthmani 1.1 with pause marks, sajdah signs, rub-el-hizb signs and tatweel enabled. Sequential tanweens are not enabled. Its terms require verbatim text, attribution, a Tanzil link and retention of the copyright notice. See the notice at the end of `quran-uthmani.txt` and [official download terms](https://tanzil.net/download/).

Pickthall is resource `en.pickthall`, provider update 2010-09-04. [Tanzil's translation export terms](https://tanzil.net/trans/) specify non-commercial use. Commercial redistribution rights for this export have not been verified. The MVP's `Public domain` field does not establish the rights of this particular edition.

The source metadata declares 114 surahs whose ayah counts sum to 6,236. The numbered export includes the basmala as 1:1, contains no ayah-zero records, and does not add separate numbered basmalas to the other surahs. No verse payload is trimmed, normalized, stripped or rewritten by the loader. Translation wording is preserved exactly.

The corpus hash sorts rows numerically by surah, then ayah. Each row contributes `JSON.stringify([referenceKey, exactText]) + '\n'`, including a final LF. SHA-256 hashes the resulting UTF-8 stream. Arabic and English are separate streams. Per-record hashes cover exact text only. Raw file hashes include notices and original line endings; keep the downloaded files byte-for-byte unchanged.

From `backend`:

```sh
npm run validate:quran:source
npm run import:quran
npm run validate:quran
```

`import:quran` is a read-only preflight by default. It refuses existing text conflicts, unexpected starting counts, invalid mappings, and production-like targets. Automatic database collection/index creation is disabled. Only a clean preflight plus `--write` enables a transaction. This requires a MongoDB replica set/transaction-capable deployment; there is no non-transactional fallback. Original object IDs are preserved and mappings/emotions/legacy Ayah records are never written. The write path has not been exercised because the real preflight is blocked.

Current status: **not imported**. Six MVP Arabic checksums and five MVP translation texts differ from this source. Review `../../reports/quran-verification/summary.md` and `../../reports/quran-verification/preflight.json`. The importer deliberately provides no force-overwrite option. Reconciliation needs a separately reviewed, explicit migration before importing; changing a checksum alone is not a resolution.
