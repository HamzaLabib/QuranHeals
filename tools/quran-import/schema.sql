CREATE TABLE verses (
    surah INTEGER NOT NULL CHECK (surah BETWEEN 1 AND 114),
    ayah INTEGER NOT NULL CHECK (ayah > 0),
    verse_key TEXT NOT NULL,
    arabic_text TEXT NOT NULL CHECK (length(arabic_text) > 0),
    PRIMARY KEY (surah, ayah),
    UNIQUE (verse_key),
    CHECK (verse_key = CAST(surah AS TEXT) || ':' || CAST(ayah AS TEXT))
) STRICT;
