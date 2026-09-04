import AsyncStorage from '@react-native-async-storage/async-storage';

const recentKey = 'quran-heals:recent-ayahs';
const maxRecentPerEmotion = 4;

type RecentAyahMap = Record<string, string[]>;

async function readRecentMap(): Promise<RecentAyahMap> {
  const raw = await AsyncStorage.getItem(recentKey);

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as RecentAyahMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function getRecentAyahIds(emotionKey: string) {
  const recent = await readRecentMap();
  return recent[emotionKey] ?? [];
}

export async function rememberAyahForEmotion(emotionKey: string, ayahId: string) {
  const recent = await readRecentMap();
  const previous = recent[emotionKey] ?? [];
  const next = [ayahId, ...previous.filter((id) => id !== ayahId)].slice(0, maxRecentPerEmotion);

  await AsyncStorage.setItem(
    recentKey,
    JSON.stringify({
      ...recent,
      [emotionKey]: next,
    }),
  );
}

