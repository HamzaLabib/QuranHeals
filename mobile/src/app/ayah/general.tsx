import { AyahExperience } from '@/components/AyahExperience';

/**
 * "Need an ayah from the Quran?" — the general Quran flow. Completely
 * separate from the 29-emotion mapping system: no emotionKey, no Emotion
 * document, no EmotionVerseMapping involved anywhere in this route. Static
 * route (not a dynamic [emotion] segment) so it can never collide with a
 * real emotion key, and the mode is carried structurally via
 * `source.mode`, never inferred from any localized text.
 */
export default function GeneralQuranAyahScreen() {
  return <AyahExperience source={{ mode: 'general' }} />;
}
