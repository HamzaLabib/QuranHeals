import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsHeaderButton } from '@/components/SettingsHeaderButton';
import { pageHeaderText, radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { useContentColumnStyle } from '@/layout/useWindowClass';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { cityById, cityToManualPosition, type City } from '@/qibla/cities';
import { clearManualCityId, loadManualCityId, saveManualCityId } from '@/qibla/manualCityStorage';
import { QiblaCityPicker } from '@/qibla/QiblaCityPicker';
import { QiblaCompassDial } from '@/qibla/QiblaCompassDial';
import { presentQibla, type QiblaAction } from '@/qibla/qiblaPresentation';
import { useQiblaCompass } from '@/qibla/useQiblaCompass';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { goBackOrHome } from '@/utils/goBackOrHome';
import { scrollBottomPadding } from '@/utils/safeAreaSpacing';

/** Spoken status changes wait this long, so a flickering state never floods a screen reader. */
const ANNOUNCE_DELAY_MS = 1_500;
const MAX_DIAL_SIZE = 300;

/**
 * Qibla Direction (/qibla), opened from Home's button under "A Message from the Quran" (docs/qibla.md). The compass
 * comes from useQiblaCompass (qiblaCompassController.ts and its reliability model); what each state shows comes from
 * qiblaPresentation.ts. Location is used on the device only; a chosen city is saved as its ID only.
 */
export default function QiblaScreen() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const column = useContentColumnStyle();
  const { width } = useWindowDimensions();
  const { locale, messages } = useAppLocale();
  const m = messages.qibla;
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  const { snapshot, requestPermission, retry, chooseManualPosition, chooseDevicePosition, onFrame } = useQiblaCompass();
  const view = presentQibla(snapshot, m);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // A city chosen on an earlier visit (its ID only, on this device).
  useEffect(() => {
    let cancelled = false;
    void loadManualCityId().then((id) => {
      if (cancelled || id === null) return;
      const city = cityById(id);
      if (city) chooseManualPosition(cityToManualPosition(city, locale));
    });
    return () => {
      cancelled = true;
    };
  }, [chooseManualPosition, locale]);

  // Screen readers hear the status and "lined up" when they change and settle, never every reading.
  const announced = useRef<string | null>(null);
  const spoken = view.aligned ? m.aligned : view.status?.text ?? null;
  useEffect(() => {
    if (!spoken || spoken === announced.current) return;
    const timer = setTimeout(() => {
      announced.current = spoken;
      AccessibilityInfo.announceForAccessibility(spoken);
    }, ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [spoken]);

  const onAction = (action: QiblaAction) => {
    switch (action) {
      case 'allowLocation':
        requestPermission();
        break;
      case 'openSettings':
        void Linking.openSettings().catch(() => undefined);
        break;
      case 'tryAgain':
        retry();
        break;
      case 'chooseCity':
        setPickerVisible(true);
        break;
      case 'useMyLocation':
        void clearManualCityId();
        chooseDevicePosition();
        break;
    }
  };
  const actionLabel: Record<QiblaAction, string> = {
    allowLocation: m.allowLocation,
    openSettings: m.openSettings,
    tryAgain: m.tryAgain,
    chooseCity: m.chooseCity,
    useMyLocation: m.useMyLocation,
  };
  const primary = new Set<QiblaAction>(['allowLocation', 'openSettings', 'tryAgain']);
  const onSelectCity = (city: City) => {
    setPickerVisible(false);
    void saveManualCityId(city.id);
    chooseManualPosition(cityToManualPosition(city, locale));
  };

  const dialSize = Math.min(MAX_DIAL_SIZE, width - spacing.lg * 2);
  const toneColor = { ok: colors.accent, info: colors.textSecondary, warning: colors.danger, alert: colors.danger } as const;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, column, { paddingBottom: scrollBottomPadding(insets.bottom) }]}>
        <View style={[styles.header, isRtl && styles.rowRtl]}>
          <Pressable
            testID="qibla-back"
            accessibilityRole="button"
            accessibilityLabel={messages.ayah.goBack}
            onPress={goBackOrHome}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <BackIcon size={22} color={colors.icon} />
          </Pressable>
          <Text accessibilityRole="header" style={[styles.title, direction]}>{m.title}</Text>
          <SettingsHeaderButton style={styles.iconButton} pressedStyle={styles.pressed} />
        </View>

        <View style={styles.intro}>
          <Text style={[styles.instruction, direction]}>{m.instruction}</Text>
          {view.showDial && <Text style={[styles.muted, direction]}>{m.holdFlat}</Text>}
        </View>

        {view.special && (
          <View testID="qibla-special" style={styles.card}>
            <Text style={[styles.cardBody, direction, styles.center]}>{view.special}</Text>
          </View>
        )}

        {view.showDial && snapshot.qibla?.kind === 'bearing' && (
          <View style={styles.compass}>
            <QiblaCompassDial
              size={dialSize}
              bearing={snapshot.qibla.bearing}
              needle={view.needle}
              aligned={view.aligned}
              subscribe={onFrame}
              cardinals={[m.cardinalNorth, m.cardinalEast, m.cardinalSouth, m.cardinalWest]}
              accessibilityLabel={view.accessibilitySummary}
            />
            {view.approximate && (
              <View testID="qibla-approximate" style={styles.badge}>
                <Text style={styles.badgeText}>{m.approximate}</Text>
              </View>
            )}
            {view.turnText && (
              <Text testID="qibla-turn" style={[styles.turn, view.aligned && { color: colors.accent }]}>
                {view.aligned ? m.aligned : view.turnText}
              </Text>
            )}
          </View>
        )}

        {view.status && !(view.aligned && view.status.text === m.aligned) && (
          <Text
            testID="qibla-status"
            accessibilityRole={view.status.tone === 'alert' ? 'alert' : 'text'}
            accessibilityLiveRegion="polite"
            style={[styles.status, direction, { color: toneColor[view.status.tone] }]}>
            {view.status.text}
          </Text>
        )}

        {view.notice && (
          <View testID="qibla-notice" style={styles.card}>
            {view.notice.title && <Text style={[styles.cardTitle, direction]}>{view.notice.title}</Text>}
            <Text style={[styles.cardBody, direction]}>{view.notice.body}</Text>
          </View>
        )}

        {view.bearingText && (
          <View testID="qibla-bearing" style={styles.card}>
            <Text style={[styles.muted, direction]}>{m.bearingLabel}</Text>
            <Text style={[styles.bearing, direction]}>{view.bearingText}</Text>
            <Text style={[styles.muted, direction]}>{m.bearingExplain}</Text>
          </View>
        )}

        {view.positionLine && <Text style={[styles.muted, direction]}>{view.positionLine}</Text>}

        {view.actions.length > 0 && (
          <View style={[styles.actions, isRtl && styles.rowRtl]}>
            {view.actions.map((action) => (
              <Pressable
                key={action}
                testID={`qibla-action-${action}`}
                accessibilityRole="button"
                accessibilityLabel={actionLabel[action]}
                onPress={() => onAction(action)}
                style={({ pressed }) => [primary.has(action) ? styles.primaryButton : styles.secondaryButton, pressed && styles.pressed]}>
                <Text style={primary.has(action) ? styles.primaryText : styles.secondaryText}>{actionLabel[action]}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <Pressable
            testID="qibla-help-toggle"
            accessibilityRole="button"
            accessibilityState={{ expanded: helpOpen }}
            accessibilityLabel={m.helpTitle}
            onPress={() => setHelpOpen((open) => !open)}
            style={[styles.helpHeader, isRtl && styles.rowRtl]}>
            <Text style={[styles.cardTitle, direction, styles.flex]}>{m.helpTitle}</Text>
            {helpOpen ? <ChevronUp size={20} color={colors.icon} /> : <ChevronDown size={20} color={colors.icon} />}
          </Pressable>
          {helpOpen &&
            [m.helpFigureEight, m.helpHoldFlat, m.helpAwayFromMagnets, m.helpIndoors].map((item) => (
              <Text key={item} style={[styles.cardBody, direction]}>
                {'• '}
                {item}
              </Text>
            ))}
        </View>

        <Text style={[styles.caption, direction]}>{m.caption}</Text>
      </ScrollView>
      <QiblaCityPicker visible={pickerVisible} locale={locale} messages={m} onSelect={onSelectCity} onClose={() => setPickerVisible(false)} />
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  scroll: { flex: 1 },
  content: { gap: spacing.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  rowRtl: { flexDirection: 'row-reverse' },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.full,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  title: { ...pageHeaderText(colors).title, flex: 1 },
  intro: { gap: spacing.xs },
  instruction: { color: colors.textPrimary, fontSize: typography.bodyLarge, fontWeight: '700' },
  muted: { color: colors.textSecondary, fontSize: typography.caption, lineHeight: 19 },
  compass: { alignItems: 'center', gap: spacing.md },
  badge: { backgroundColor: colors.accentSoft, borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  badgeText: { color: colors.textPrimary, fontSize: typography.caption, fontWeight: '700' },
  turn: { color: colors.textPrimary, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  status: { fontSize: typography.body, lineHeight: 22, textAlign: 'center' },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
    ...shadows.soft,
  },
  cardTitle: { color: colors.textPrimary, fontSize: typography.body, fontWeight: '700' },
  cardBody: { color: colors.textSecondary, fontSize: typography.body, lineHeight: 22 },
  center: { textAlign: 'center' },
  bearing: { color: colors.textPrimary, fontSize: 24, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  primaryButton: { alignItems: 'center', backgroundColor: colors.primaryButton, borderRadius: radii.full, justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.lg },
  primaryText: { color: colors.onPrimaryButton, fontSize: typography.body, fontWeight: '700' },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  secondaryText: { color: colors.textPrimary, fontSize: typography.body, fontWeight: '700' },
  helpHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 32 },
  flex: { flex: 1 },
  caption: { color: colors.textMuted, fontSize: typography.small, lineHeight: 17 },
  pressed: { opacity: 0.78 },
});
