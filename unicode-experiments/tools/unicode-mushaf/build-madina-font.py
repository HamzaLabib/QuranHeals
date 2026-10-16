#!/usr/bin/env python3
"""Builds the Unicode Mushaf prototype's calligraphic font: a derivative of
DigitalKhatt Old Madina (SIL OFL 1.1, https://github.com/DigitalKhatt/oldmadinafont),
a font drawn from the Madina Mushaf in Uthman Taha's hand.

    python tools/unicode-mushaf/build-madina-font.py <oldmadina.ttf> <out.ttf>

The original font can elongate letters the calligrapher's way — a longer
letter body, not a tatweel bar — through its character-variant feature `cv01`
(up to 12 graded alternates for 493 glyphs). A feature applies to a whole run
of text, so selecting it for a word would stretch every letter of the word at
once; a calligrapher stretches one connection. This copy instead elongates the
letter *before a run of tatweels*: the reader inserts n tatweels (kashida) at
the one connection of a word it chooses (mobile/src/mushaf/unicode/words.ts,
the same legal points as kashida), and the font draws:

  letter + n × U+0640   →   the letter's n-th elongated form (cv01 alternate n,
                            clamped to its last), followed by n invisible,
                            zero-width tatweels (tatweel.null, a GDEF mark so
                            cursive attachment and kerning see the letter and
                            the next letter as neighbours)

Tatweels anywhere else (Tanzil's own carriers of dagger alef and hamza, or
after a letter without alternates) are unchanged. The text itself is never
changed: the inserted tatweels are removed again before any comparison or copy.
Also: cv03's narrower forms as stylistic set ss13 (for lines wider than the
measure; React Native selects it per word with fontVariant 'stylistic-thirteen').

Nothing else changes: same outlines, metrics and default shaping. The family is
renamed "QH Old Madina" and the modification is recorded in the name table, as
the OFL asks of modified versions. The input must be the pinned file.
"""
import hashlib
import sys

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph

PINNED_SHA256 = 'de2a8de4932726f1b346432d21449e1d9b82da898a78247d0d71303e90990656'  # oldmadina.ttf @ 4d8b53f5
LEVELS = 12
FAMILY = 'QH Old Madina'
NULL = 'tatweel.null'
NOTE = ('Modified by Quran Heals from DigitalKhatt Old Madina (https://github.com/DigitalKhatt/oldmadinafont, '
        'commit 4d8b53f5, SIL OFL 1.1): a letter followed by n tatweels takes its n-th cv01 elongation (the tatweels '
        'become invisible), and cv03 narrow forms are stylistic set ss13; outlines, metrics and default shaping unchanged.')


def alternates_of(gsub, tag):
    for record in gsub.FeatureList.FeatureRecord:
        if record.FeatureTag == tag:
            lookup = gsub.LookupList.Lookup[record.Feature.LookupListIndex[0]]
            sub = lookup.SubTable[0]
            sub = sub.ExtSubTable if lookup.LookupType == 7 else sub
            return sub.alternates
    raise SystemExit(f'no {tag}')


def add_null_glyph(font):
    order = font.getGlyphOrder()
    if NULL in order:
        return
    font.setGlyphOrder(order + [NULL])
    glyph = Glyph()
    glyph.numberOfContours = 0
    font['glyf'].glyphs[NULL] = glyph
    if hasattr(font['glyf'], 'glyphOrder'):
        font['glyf'].glyphOrder = font.getGlyphOrder()
    font['hmtx'].metrics[NULL] = (0, 0)
    font['GDEF'].table.GlyphClassDef.classDefs[NULL] = 3  # a mark: skipped by IgnoreMarks lookups (curs, kern)


def build_fea(cv01, cv03):
    keys = sorted(g for g, alts in cv01.items() if alts)
    alts = sorted({a for g in keys for a in cv01[g]})
    out = ['languagesystem DFLT dflt;', 'languagesystem arab dflt;', 'languagesystem arab ARA;']
    out.append(f'@QH_X = [{" ".join(keys)}];')
    out.append(f'@QH_ALT = [{" ".join(alts)}];')
    for level in range(1, LEVELS + 1):
        out.append(f'lookup QH_L{level} {{')
        for g in keys:
            out.append(f'  sub {g} by {cv01[g][min(level, len(cv01[g])) - 1]};')
        out.append(f'}} QH_L{level};')
    out.append('lookup QH_EXPAND {\n  lookupflag IgnoreMarks;')
    for level in range(LEVELS, 0, -1):
        out.append(f"  sub @QH_X' lookup QH_L{level} {' '.join(['uni0640'] * level)};")
    out.append('} QH_EXPAND;')
    out.append(f"lookup QH_NULLIFY {{\n  lookupflag IgnoreMarks;\n  sub @QH_ALT uni0640' by {NULL};\n}} QH_NULLIFY;")
    narrow = sorted(g for g, a in cv03.items() if a)
    out.append('lookup QH_NARROW {')
    for g in narrow:
        out.append(f'  sub {g} by {cv03[g][0]};')
    out.append('} QH_NARROW;')
    out.append('feature calt { lookup QH_EXPAND; lookup QH_NULLIFY; } calt;')
    out.append('feature ss13 { lookup QH_NARROW; } ss13;')
    return '\n'.join(out)


def main(src, out):
    raw = open(src, 'rb').read()
    if hashlib.sha256(raw).hexdigest() != PINNED_SHA256:
        raise SystemExit('oldmadina.ttf does not match its pinned SHA-256')
    font = TTFont(src, recalcTimestamp=False)  # reproducible: the same input always gives the same bytes
    cmap = font.getBestCmap()
    if font.getGlyphName(font.getGlyphID(cmap[0x0640])) != 'uni0640':
        tat = cmap[0x0640]
    else:
        tat = 'uni0640'
    gsub = font['GSUB'].table
    cv01 = alternates_of(gsub, 'cv01')
    cv03 = alternates_of(gsub, 'cv03')
    add_null_glyph(font)
    fea = build_fea(cv01, cv03).replace('uni0640', tat)

    # Compile the new lookups on a copy, then append them (and their features) to the original GSUB, after all its
    # own lookups, so they act on the shaped positional forms.
    work = TTFont(src)
    add_null_glyph(work)
    del work['GSUB']
    addOpenTypeFeaturesFromString(work, fea, tables=['GSUB'])
    new = work['GSUB'].table
    offset = len(gsub.LookupList.Lookup)
    for lookup in new.LookupList.Lookup:
        for st in lookup.SubTable:
            sub = st.ExtSubTable if lookup.LookupType == 7 else st
            for rec in getattr(sub, 'SubstLookupRecord', None) or []:  # format 3 (coverage-based) rules
                rec.LookupListIndex += offset
            for rule_set in (getattr(sub, 'ChainSubRuleSet', None) or []) + (getattr(sub, 'ChainSubClassSet', None) or []):
                if rule_set is None:
                    continue
                for rule in (getattr(rule_set, 'ChainSubRule', None) or []) + (getattr(rule_set, 'ChainSubClassRule', None) or []):
                    for rec in rule.SubstLookupRecord:
                        rec.LookupListIndex += offset
        gsub.LookupList.Lookup.append(lookup)
    gsub.LookupList.LookupCount = len(gsub.LookupList.Lookup)

    added_records = []
    for record in new.FeatureList.FeatureRecord:
        record.Feature.LookupListIndex = [i + offset for i in record.Feature.LookupListIndex]
        record.Feature.LookupCount = len(record.Feature.LookupListIndex)
        if record.FeatureTag in [r.FeatureTag for r in added_records]:
            continue
        added_records.append(record)
    # calt: append our lookups to the font's own calt feature(s); ss13: a new feature.
    records = list(gsub.FeatureList.FeatureRecord)
    for rec in added_records:
        if rec.FeatureTag == 'calt':
            for own in records:
                if own.FeatureTag == 'calt':
                    own.Feature.LookupListIndex = list(own.Feature.LookupListIndex) + list(rec.Feature.LookupListIndex)
                    own.Feature.LookupCount = len(own.Feature.LookupListIndex)
    extra = [rec for rec in added_records if rec.FeatureTag != 'calt']
    start = len(records)
    records.extend(extra)
    order = sorted(range(len(records)), key=lambda i: (records[i].FeatureTag, i))
    remap = {old: new_index for new_index, old in enumerate(order)}
    gsub.FeatureList.FeatureRecord = [records[i] for i in order]
    gsub.FeatureList.FeatureCount = len(order)
    for script in gsub.ScriptList.ScriptRecord:
        for ls in [script.Script.DefaultLangSys] + [r.LangSys for r in script.Script.LangSysRecord]:
            if ls is None:
                continue
            ls.FeatureIndex = sorted(remap[i] for i in list(ls.FeatureIndex) + list(range(start, len(records))))
            ls.FeatureCount = len(ls.FeatureIndex)

    name = font['name']
    for record in list(name.names):
        if record.nameID in (1, 16):
            name.setName(FAMILY, record.nameID, record.platformID, record.platEncID, record.langID)
        elif record.nameID == 4:
            name.setName(f'{FAMILY} Regular', 4, record.platformID, record.platEncID, record.langID)
        elif record.nameID == 6:
            name.setName('QHOldMadina-Regular', 6, record.platformID, record.platEncID, record.langID)
        elif record.nameID == 3:
            name.setName(f'{FAMILY} Regular; QH derivative of DigitalKhatt Old Madina V01', 3, record.platformID, record.platEncID, record.langID)
    name.setName(NOTE, 10, 3, 1, 0x409)
    if 'DSIG' in font:
        del font['DSIG']  # the signature no longer matches a modified file
    font.save(out)
    print(f'{out}: {sum(1 for a in cv01.values() if a)} letters elongate before tatweels (levels 1-{LEVELS}); {len(cv03)} narrow forms as ss13')


if __name__ == '__main__':
    main(*sys.argv[1:3])
