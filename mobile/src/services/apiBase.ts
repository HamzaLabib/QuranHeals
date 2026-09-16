import { Platform } from 'react-native';

const fallbackApiUrl = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';

/** Shared by services/api.ts (Quran/emotions) and the auth/sync clients — one backend, one base URL rule. */
export const apiBaseUrl = (process.env.EXPO_PUBLIC_API_URL ?? fallbackApiUrl).replace(/\/$/, '');
