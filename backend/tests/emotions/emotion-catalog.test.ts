import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { MongooseQuranRepository } from '../../src/services/MongooseQuranRepository';

import {
  APP_LOCALES,
  DEFAULT_APP_LOCALE,
  EMOTION_CATALOG,
  EMOTION_CATALOG_BY_KEY,
  getCanonicalEmotion,
  hasAllRequiredLocales,
  resolveEmotionLocalization,
  type AppLocale,
} from '../../src/emotions/emotionCatalog';
import { EmotionModel } from '../../src/models/Emotion';
import { seedEmotions } from '../../src/seed/emotions';

// This suite proves backend localization requirements 1-16 (see the task's
// "TEST BACKEND LOCALIZATION" list). Items 17-20 (activation-plan-level
// localization classification: missing vs. conflicting, rollback footprint
// coverage, and future-create localization) are covered in
// backend/tests/emotion-mappings/approved-mapping-activation.test.ts and
// activation-rollback.test.ts, which exercise the same catalog against real
// live-shaped fixtures. Nothing here connects to MongoDB.

const APPROVED_NAMES: Record<string, Record<AppLocale, string>> = {
  sad: { en: 'Sad', ar: 'حزين', 'ar-EG': 'زعلان' },
  anxious: { en: 'Anxious', ar: 'قَلِق', 'ar-EG': 'قلقان' },
  lonely: { en: 'Lonely', ar: 'وحيد', 'ar-EG': 'حاسس إني لوحدي' },
  angry: { en: 'Angry', ar: 'غاضب', 'ar-EG': 'غضبان' },
  lost: { en: 'Lost', ar: 'تائه', 'ar-EG': 'تايه' },
  afraid: { en: 'Afraid', ar: 'خائف', 'ar-EG': 'خايف' },
  stressed: { en: 'Stressed', ar: 'متوتر', 'ar-EG': 'متوتر' },
  hopeless: { en: 'Hopeless', ar: 'فاقد الأمل', 'ar-EG': 'فاقد الأمل' },
  tired: { en: 'Tired', ar: 'متعب', 'ar-EG': 'تعبان' },
  confused: { en: 'Confused', ar: 'حائر', 'ar-EG': 'محتار' },
  grateful: { en: 'Grateful', ar: 'ممتن', 'ar-EG': 'ممتن' },
  peaceful: { en: 'At Peace', ar: 'مطمئن', 'ar-EG': 'مطمّن' },
  want_to_cry: { en: 'I Feel Like Crying', ar: 'أريد أن أبكي', 'ar-EG': 'عايز أعيط' },
  heartbroken: { en: 'Heartbroken', ar: 'مكسور الخاطر', 'ar-EG': 'مكسور الخاطر' },
  overwhelmed: { en: 'Overwhelmed', ar: 'الأمور فوق طاقتي', 'ar-EG': 'مخنوق' },
  rejected: { en: 'Rejected', ar: 'أشعر أنني مرفوض', 'ar-EG': 'حاسس بالرفض' },
  betrayed: { en: 'Betrayed', ar: 'مخذول', 'ar-EG': 'مخذول' },
  wronged: { en: 'Wronged', ar: 'مظلوم', 'ar-EG': 'مظلوم' },
  forgiveness_struggle: { en: 'Struggling to Forgive', ar: 'لا أستطيع المسامحة', 'ar-EG': 'مش قادر أسامح' },
  guilty: { en: 'Guilty', ar: 'أشعر بالذنب', 'ar-EG': 'حاسس بالذنب' },
  repentant: { en: 'I Want to Repent', ar: 'أريد أن أتوب', 'ar-EG': 'عايز أتوب' },
  weak: { en: 'Feeling Weak', ar: 'أشعر بالضعف', 'ar-EG': 'حاسس إني ضعيف' },
  reassurance: { en: 'I Need Reassurance', ar: 'أحتاج إلى الطمأنينة', 'ar-EG': 'محتاج أطمّن' },
  patience: { en: 'I Need Patience', ar: 'أحتاج إلى الصبر', 'ar-EG': 'محتاج صبر' },
  strength: { en: 'I Need Strength', ar: 'أحتاج إلى القوة', 'ar-EG': 'محتاج قوة' },
  hopeful: { en: 'Hopeful', ar: 'لدي أمل', 'ar-EG': 'عندي أمل' },
  content: { en: 'Content', ar: 'راضٍ', 'ar-EG': 'راضي' },
  seeking_guidance: { en: 'Seeking Guidance', ar: 'أطلب الهداية', 'ar-EG': 'محتاج ربنا يرشدني' },
  closer_to_allah: { en: 'I Want to Feel Closer to Allah', ar: 'أريد أن أتقرب إلى الله', 'ar-EG': 'عايز أقرب من ربنا' },
  faith_shaken: { en: 'My Faith Feels Shaken', ar: 'إيماني مهزوز', 'ar-EG': 'إيماني مهزوز' },
};

describe('1-2. Stable keys', () => {
  it('has exactly 30 canonical emotion keys (29 original + faith_shaken, added inactive pending its own mapping review — see batch-6-faith-shaken)', () => {
    expect(EMOTION_CATALOG).toHaveLength(30);
  });

  it('no key changed from the pre-localization seed, plus the newly added faith_shaken', () => {
    // The original 29 keys are byte-identical to seedEmotions' keys before
    // this task (spot-checked against the task's own examples, which
    // explicitly keep the key while changing only the English display
    // name). faith_shaken is the one deliberate addition.
    const keys = EMOTION_CATALOG.map((e) => e.key).sort();
    expect(keys).toEqual(
      [
        'sad', 'anxious', 'lonely', 'angry', 'lost', 'afraid', 'stressed', 'hopeless', 'tired', 'confused',
        'grateful', 'peaceful', 'want_to_cry', 'heartbroken', 'overwhelmed', 'rejected', 'betrayed', 'wronged',
        'forgiveness_struggle', 'guilty', 'repentant', 'weak', 'reassurance', 'patience', 'strength', 'hopeful',
        'content', 'seeking_guidance', 'closer_to_allah', 'faith_shaken',
      ].sort(),
    );
  });

  it('peaceful/want_to_cry/forgiveness_struggle/closer_to_allah keep their exact keys even though their English display name changed', () => {
    ['peaceful', 'want_to_cry', 'forgiveness_struggle', 'closer_to_allah'].forEach((key) => {
      expect(getCanonicalEmotion(key)?.key).toBe(key);
    });
  });
});

describe('3-8. Every emotion has all required localized names/descriptions', () => {
  it('names.en exists for all 30', () => {
    EMOTION_CATALOG.forEach((e) => expect(typeof e.names.en).toBe('string'));
  });
  it('names.ar exists for all 30', () => {
    EMOTION_CATALOG.forEach((e) => expect(typeof e.names.ar).toBe('string'));
  });
  it("names['ar-EG'] exists for all 30", () => {
    EMOTION_CATALOG.forEach((e) => expect(typeof e.names['ar-EG']).toBe('string'));
  });
  it('descriptions.en exists for all 30', () => {
    EMOTION_CATALOG.forEach((e) => expect(typeof e.descriptions.en).toBe('string'));
  });
  it('descriptions.ar exists for all 30', () => {
    EMOTION_CATALOG.forEach((e) => expect(typeof e.descriptions.ar).toBe('string'));
  });
  it("descriptions['ar-EG'] exists for all 30", () => {
    EMOTION_CATALOG.forEach((e) => expect(typeof e.descriptions['ar-EG']).toBe('string'));
  });
});

describe('9-11. String/uniqueness integrity', () => {
  it('every localized string (names + descriptions, all 3 locales) is non-empty', () => {
    EMOTION_CATALOG.forEach((e) => {
      APP_LOCALES.forEach((locale) => {
        expect(e.names[locale].trim().length, `${e.key}.names.${locale}`).toBeGreaterThan(0);
        expect(e.descriptions[locale].trim().length, `${e.key}.descriptions.${locale}`).toBeGreaterThan(0);
      });
    });
  });

  it('no duplicate keys', () => {
    const keys = EMOTION_CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('no duplicate order values', () => {
    const orders = EMOTION_CATALOG.map((e) => e.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe('Exact approved emotion names (Section 4)', () => {
  it('every one of the 30 emotions uses the exact approved en/ar/ar-EG names — no improvisation', () => {
    const mismatches: string[] = [];
    Object.entries(APPROVED_NAMES).forEach(([key, expected]) => {
      const actual = getCanonicalEmotion(key);
      if (!actual) {
        mismatches.push(`${key}: missing from catalog`);
        return;
      }
      APP_LOCALES.forEach((locale) => {
        if (actual.names[locale] !== expected[locale]) {
          mismatches.push(`${key}.${locale}: expected "${expected[locale]}", got "${actual.names[locale]}"`);
        }
      });
    });
    expect(mismatches, mismatches.join('\n')).toEqual([]);
    expect(Object.keys(APPROVED_NAMES)).toHaveLength(30);
  });

  it('faith_shaken has an inactive seed default; live activation is a separate transactional operation', () => {
    expect(getCanonicalEmotion('faith_shaken')?.active).toBe(false);
  });
});

describe('12-14. Legacy conversion, precedence, and safe fallback', () => {
  it('12. a legacy live emotion shape (flat name/arabicName/description only) still converts to a full localized DTO via the catalog', () => {
    const legacyLive = { key: 'sad', name: 'Sad', arabicName: 'حزين', description: 'legacy text' };
    const { names, descriptions } = resolveEmotionLocalization(legacyLive);
    expect(hasAllRequiredLocales(names)).toBe(true);
    expect(hasAllRequiredLocales(descriptions)).toBe(true);
    expect(names).toEqual(getCanonicalEmotion('sad')!.names);
  });

  it('13. canonical localized data takes precedence over deprecated flat fields when both are present', () => {
    const liveWithBoth = {
      key: 'sad',
      name: 'STALE LEGACY NAME',
      arabicName: 'اسم قديم',
      names: getCanonicalEmotion('sad')!.names,
      descriptions: getCanonicalEmotion('sad')!.descriptions,
    };
    const { names } = resolveEmotionLocalization(liveWithBoth);
    expect(names.en).not.toBe('STALE LEGACY NAME');
    expect(names).toEqual(getCanonicalEmotion('sad')!.names);
  });

  it('14. an unknown emotion key (not in the catalog, no localized data) fails safely — never borrows another emotion\'s text', () => {
    const unknownLive = { key: 'totally_unknown_key', name: 'Mystery', arabicName: 'غامض', description: 'unknown' };
    const { names, descriptions } = resolveEmotionLocalization(unknownLive);
    expect(names.en).toBe('Mystery');
    expect(names.ar).toBe('غامض');
    expect(names['ar-EG']).toBe('غامض'); // same-document fallback, never another emotion's ar-EG text
    expect(descriptions.en).toBe('unknown');
    // Never equal to any OTHER real emotion's actual localized text.
    EMOTION_CATALOG.forEach((e) => {
      if (e.key === 'totally_unknown_key') return;
      expect(names.en).not.toBe(e.names.en);
    });
  });

  it('hasAllRequiredLocales rejects a partially-populated map and undefined/null', () => {
    expect(hasAllRequiredLocales(undefined)).toBe(false);
    expect(hasAllRequiredLocales(null)).toBe(false);
    expect(hasAllRequiredLocales({ en: 'x', ar: 'y' } as never)).toBe(false); // missing ar-EG
    expect(hasAllRequiredLocales({ en: 'x', ar: 'y', 'ar-EG': '' } as never)).toBe(false); // empty string
    expect(hasAllRequiredLocales({ en: 'x', ar: 'y', 'ar-EG': 'z' })).toBe(true);
  });
});

describe('15. DTO localized maps serialize as ordinary JSON objects', () => {
  it('resolveEmotionLocalization output survives JSON.stringify/parse as a plain object with the exact same keys/values', () => {
    const { names, descriptions } = resolveEmotionLocalization(getCanonicalEmotion('sad')!);
    const roundTripped = JSON.parse(JSON.stringify({ names, descriptions }));
    expect(roundTripped.names).toEqual(names);
    expect(roundTripped.descriptions).toEqual(descriptions);
    expect(roundTripped.names).not.toBeInstanceOf(Map);
    expect(Object.getPrototypeOf(roundTripped.names)).toBe(Object.prototype);
  });

  it('a constructed (offline, no DB) Mongoose Emotion document serializes names/descriptions as plain objects via toObject/toJSON, never a Map instance', () => {
    const canonical = getCanonicalEmotion('want_to_cry')!;
    const doc = new EmotionModel({
      key: canonical.key,
      names: canonical.names,
      descriptions: canonical.descriptions,
      icon: canonical.icon,
      order: canonical.order,
      active: canonical.active,
    });

    const asObject = doc.toObject();
    const asJson = doc.toJSON();

    [asObject.names, asJson.names, asObject.descriptions, asJson.descriptions].forEach((value) => {
      expect(value).not.toBeInstanceOf(Map);
      expect(typeof value).toBe('object');
      expect(value).toEqual(canonical.names.en === value.en ? canonical.names : canonical.descriptions);
    });

    // Round-trips through JSON.stringify cleanly (the actual DTO wire format).
    const wire = JSON.parse(JSON.stringify(asJson));
    expect(wire.names).toEqual(canonical.names);
    expect(wire.descriptions).toEqual(canonical.descriptions);
  });

  it('a legacy-shaped document (no names/descriptions at all) is still schema-valid — required-field relaxation confirmed offline, no DB connection', () => {
    const doc = new EmotionModel({
      key: 'sad',
      name: 'Sad',
      arabicName: 'حزين',
      description: 'legacy',
      icon: 'cloud-rain',
      order: 1,
      active: true,
    });
    const validationError = doc.validateSync();
    expect(validationError).toBeUndefined();
  });

  it('a names/descriptions map missing a required locale fails schema validation (offline)', () => {
    const doc = new EmotionModel({
      key: 'sad',
      names: { en: 'Sad', ar: 'حزين' }, // ar-EG missing
      descriptions: getCanonicalEmotion('sad')!.descriptions,
      icon: 'cloud-rain',
      order: 1,
      active: true,
    });
    const validationError = doc.validateSync();
    expect(validationError).toBeDefined();
    expect(validationError?.errors.names).toBeDefined();
  });

  it('a names map with a non-string value fails schema validation (offline)', () => {
    const doc = new EmotionModel({
      key: 'sad',
      names: { en: 'Sad', ar: 'حزين', 'ar-EG': 12345 as never },
      descriptions: getCanonicalEmotion('sad')!.descriptions,
      icon: 'cloud-rain',
      order: 1,
      active: true,
    });
    const validationError = doc.validateSync();
    expect(validationError?.errors.names).toBeDefined();
  });
});

describe('16. Existing mapping relationships are unchanged by localization', () => {
  it('the emotion key set consumed by mapping/taxonomy code (seedEmotions) exactly matches the catalog key set', () => {
    expect(seedEmotions.map((e) => e.key).sort()).toEqual(EMOTION_CATALOG.map((e) => e.key).sort());
  });

  it('active/order/icon are unaffected by localization — still the single source of truth for the taxonomy structure', () => {
    EMOTION_CATALOG.forEach((canonical) => {
      const legacy = seedEmotions.find((e) => e.key === canonical.key)!;
      expect(legacy.active).toBe(canonical.active);
      expect(legacy.order).toBe(canonical.order);
      expect(legacy.icon).toBe(canonical.icon);
    });
  });
});

describe('Catalog lookup helpers', () => {
  it('getCanonicalEmotion / EMOTION_CATALOG_BY_KEY agree and return undefined for an unknown key', () => {
    expect(getCanonicalEmotion('sad')).toBe(EMOTION_CATALOG_BY_KEY.get('sad'));
    expect(getCanonicalEmotion('not-a-real-key')).toBeUndefined();
  });

  it('DEFAULT_APP_LOCALE is "en", preserving current app behavior', () => {
    expect(DEFAULT_APP_LOCALE).toBe('en');
  });
});

const DISPLAY_ORDER = 'sad anxious stressed overwhelmed afraid angry lonely heartbroken want_to_cry tired lost confused hopeless weak rejected betrayed wronged forgiveness_struggle guilty repentant faith_shaken reassurance patience strength hopeful peaceful grateful content seeking_guidance closer_to_allah'.split(' ');

describe('canonical card presentation', () => {
  it('has the exact requested order and unique positions 1 through 30', () => {
    const sorted = [...EMOTION_CATALOG].sort((a, b) => a.order - b.order);
    expect(sorted.map(row => row.key)).toEqual(DISPLAY_ORDER);
    expect(sorted.map(row => row.order)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(getCanonicalEmotion('seeking_guidance')?.names).toEqual({ en: 'Seeking Guidance', ar: 'أطلب الهداية', 'ar-EG': 'محتاج ربنا يرشدني' });
  });

  it('serves canonical order and the Egyptian guidance correction over stale database presentation without modifying documents', async () => {
    const stored = EMOTION_CATALOG.map((row, index) => ({ ...row, _id: new Types.ObjectId(), active: true, order: index + 1,
      names: row.key === 'seeking_guidance' ? { ...row.names, 'ar-EG': 'عايز ربنا يهديني' } : row.names,
    }));
    const before = JSON.stringify(stored);
    const find = vi.spyOn(EmotionModel, 'find').mockReturnValue({ sort: () => ({ lean: async () => stored }) } as never);
    try {
      const result = await new MongooseQuranRepository().listActiveEmotions();
      expect(find).toHaveBeenCalledWith({ active: true });
      expect(result.map(row => row.key)).toEqual(DISPLAY_ORDER);
      for (const row of result) {
        const original = stored.find(item => item.key === row.key)!;
        expect(row.active).toBe(original.active);
        expect(row.icon).toBe(original.icon);
        expect(row.descriptions).toEqual(original.descriptions);
        expect(row.names).toEqual(row.key === 'seeking_guidance'
          ? { ...original.names, 'ar-EG': 'محتاج ربنا يرشدني' } : original.names);
      }
      expect(JSON.stringify(stored)).toBe(before);
    } finally { find.mockRestore(); }
  });
});
