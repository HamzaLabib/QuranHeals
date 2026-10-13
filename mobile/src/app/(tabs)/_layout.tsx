import { Tabs } from 'expo-router/tabs';

import { AppTabBar } from '@/components/AppTabBar';
import { MUSHAF_TAB_OPTIONS } from '@/mushaf/screenOptions';
import { usePalette } from '@/theme/useTheme';

/**
 * The four bottom tabs, in the approved order: Home, Mushaf, أورادي وختماتي
 * (Recitations & Khatmas, /my-reading), Reflections. Each tab's screen stays mounted when another is shown, so
 * returning to the Mushaf shows the page it was on. The tab bar shows on
 * every tab except the Mushaf (MUSHAF_TAB_OPTIONS), and returns when it is left. Favorites and Settings
 * (Home's header), the emotion list, the ayah screens, the Khatma
 * completion and the du'a open above the tabs from the root stack
 * (app/_layout.tsx). URLs are unchanged: (tabs) is
 * a group, so Home is still /, the reader /mushaf.
 */
export default function TabsLayout() {
  const colors = usePalette();
  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      // Back (the screens' arrows, Android's Back) returns to the tab shown before, ending at Home; never out of the app from a tab other than Home.
      backBehavior="history"
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}>
      <Tabs.Screen name="index" />
      {/* The Mushaf has the whole screen, in Normal Mode and full screen: no tab bar there, so the page keeps its approved size. */}
      <Tabs.Screen name="mushaf" options={MUSHAF_TAB_OPTIONS} />
      <Tabs.Screen name="my-reading" />
      <Tabs.Screen name="reflections" />
    </Tabs>
  );
}
