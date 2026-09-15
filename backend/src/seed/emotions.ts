import { EMOTION_CATALOG } from '../emotions/emotionCatalog';
import type { SeedEmotion } from './types';

/**
 * Legacy flat view of the canonical emotion catalog (`../emotions/
 * emotionCatalog.ts`), for `seed.ts`'s pre-existing dev-seed write path
 * (which still writes the flat `name`/`arabicName`/`description` shape to
 * MongoDB's `Emotion` collection) and for any other code still typed
 * against `SeedEmotion`/`EmotionEntity`'s flat shape. The catalog is the
 * single source of truth for the 29 keys/names/descriptions — this is a
 * derived, read-only projection, never a second copy to keep in sync by
 * hand. `name`/`arabicName`/`description` map to the catalog's `en`/`ar`
 * locale text respectively.
 */
export const seedEmotions: SeedEmotion[] = EMOTION_CATALOG.map((emotion) => ({
  key: emotion.key,
  name: emotion.names.en,
  arabicName: emotion.names.ar,
  description: emotion.descriptions.en,
  icon: emotion.icon,
  order: emotion.order,
  active: emotion.active,
}));
