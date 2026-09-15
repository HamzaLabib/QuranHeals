CREATE TABLE translation_sources (
    id TEXT PRIMARY KEY,
    language TEXT NOT NULL CHECK (length(language) > 0),
    translator TEXT NOT NULL CHECK (length(translator) > 0),
    title TEXT NOT NULL CHECK (length(title) > 0),
    source_name TEXT NOT NULL CHECK (length(source_name) > 0),
    source_version TEXT,
    source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
    corpus_sha256 TEXT NOT NULL CHECK (length(corpus_sha256) = 64),
    license_note TEXT NOT NULL CHECK (length(license_note) > 0)
) STRICT;

CREATE TABLE translations (
    surah INTEGER NOT NULL CHECK (surah BETWEEN 1 AND 114),
    ayah INTEGER NOT NULL CHECK (ayah > 0),
    verse_key TEXT NOT NULL,
    translation_id TEXT NOT NULL,
    text TEXT NOT NULL CHECK (length(text) > 0),
    PRIMARY KEY (surah, ayah, translation_id),
    UNIQUE (verse_key, translation_id),
    CHECK (verse_key = CAST(surah AS TEXT) || ':' || CAST(ayah AS TEXT)),
    FOREIGN KEY (translation_id) REFERENCES translation_sources(id)
) STRICT;
