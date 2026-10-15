import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, BookOpen, BookOpenText, Pencil, Plus, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmSheet } from '@/components/ConfirmSheet';
import { SettingsHeaderButton } from '@/components/SettingsHeaderButton';
import { MushafIcon } from '@/components/MushafIcon';
import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { fill, localNumber } from '@/localization/fill';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { openMushafFor } from '@/mushaf/continueWird';
import { confirmKhatma, createWird, deleteWird, loadReadingData, removeKhatma, type KhatmaRecord, type ReadingData, type Wird } from '@/mushaf/khatmas';
import { MUSHAF_PAGE_COUNT } from '@/mushaf/mushafPage';
import { parsePageNumber } from '@/mushaf/pageNumber';
import { READING_STOP_NAME_MAX_LENGTH, ReadingStopError, renameReadingStop, subscribeToReadingData } from '@/mushaf/readingStops';
import { subscribeToLocalDataOwner } from '@/storage/localDataOwner';
import { getReadingSyncStatus, subscribeToReadingSyncStatus, type ReadingSyncStatus } from '@/sync/readingSyncState';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { formatCivilDate } from '@/utils/formatDate';
import { goBackOrHome } from '@/utils/goBackOrHome';
import { scrollBottomPadding } from '@/utils/safeAreaSpacing';

type Dialog =
  | { kind: 'create' }
  | { kind: 'rename'; wird: Wird }
  | { kind: 'delete'; wird: Wird }
  | { kind: 'confirm'; wird: Wird }
  | { kind: 'remove'; record: KhatmaRecord; name: string };

/**
 * أورادي وختماتي / My Recitations & Khatmas (/my-reading), the third tab: every ورد (reading stop) with its own page,
 * progress and Khatmas, the Khatma statistics and history, and the
 * دعاء ختم القرآن. Also opened from Home's Continue Reciting and the
 * reader's ورد list (both switch to this tab).
 *
 * Progress is the ورد's saved page (mushaf/khatmas.ts): an estimate of the
 * reading position, changed only by an explicit save. A Khatma is counted
 * only by a confirmation here or in the reader.
 */
export default function MyReadingScreen() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { locale, messages } = useAppLocale();
  const copy = messages.myReading;
  const direction = getDirectionStyle(locale);
  const rtl = isRtlLocale(locale);
  const num = (n: number) => localNumber(locale, n);
  const BackIcon = rtl ? ArrowRight : ArrowLeft;
  const [data, setData] = useState<ReadingData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      loadReadingData()
        .then((next) => {
          if (cancelled) return;
          setData(next);
          setLoadFailed(false);
        })
        .catch(() => {
          if (!cancelled) setLoadFailed(true);
        });
    };
    reload();
    const unsubscribeData = subscribeToReadingData(reload);
    // Another account (or the guest) is now active: show its data, never the previous owner's.
    const unsubscribeOwner = subscribeToLocalDataOwner(() => {
      setData(null);
      reload();
    });
    return () => {
      cancelled = true;
      unsubscribeData();
      unsubscribeOwner();
    };
  }, []);
  const [syncStatus, setSyncStatus] = useState<ReadingSyncStatus>(getReadingSyncStatus);
  useEffect(() => subscribeToReadingSyncStatus(setSyncStatus), []);

  const close = () => {
    if (busyRef.current) return;
    setDialog(null);
    setDialogError(null);
  };

  /** Runs one dialog action at a time; a second tap while it runs does nothing. */
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setDialogError(null);
    try {
      await action();
    } catch (error) {
      const kind = error instanceof ReadingStopError ? error.kind : null;
      setDialogError(kind === 'invalid_name' ? copy.nameInvalid : kind === 'name_taken' ? copy.nameTaken : kind === 'invalid_page' ? copy.pageInvalid : copy.saveFailed);
      return;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onConfirmKhatma = (wird: Wird, acceptUnconfirmedEnd: boolean) =>
    run(async () => {
      const { record } = await confirmKhatma(wird.stop.id, wird.cycle.id, { acceptUnconfirmedEnd });
      setDialog(null);
      router.push({ pathname: '/khatma-complete', params: { id: record.id } });
    });

  const stats = data?.stats ?? { total: 0, ramadan: 0, nonRamadan: 0 };
  // An account's أوراد sync; a guest's stay on this device (data.owner: null).
  const signedIn = data !== null && data.owner !== null;
  const syncLine = syncStatus.state === 'syncing' ? copy.syncSyncing : syncStatus.state === 'synced' ? copy.syncSynced : syncStatus.state === 'pending' ? copy.syncPending : null;
  const nameOf = (record: KhatmaRecord) => data?.wirds.find((w) => w.stop.id === record.stopId)?.stop.name ?? record.stopName;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={[styles.header, rtl && styles.rowRtl]}>
        <Pressable
          testID="my-reading-back"
          accessibilityRole="button"
          accessibilityLabel={copy.back}
          onPress={goBackOrHome}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <BackIcon size={22} color={colors.icon} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" style={[styles.title, direction]}>{copy.title}</Text>
          <Text testID="my-reading-subtitle" style={[styles.subtitle, direction]}>{copy.subtitle}</Text>
        </View>
        <SettingsHeaderButton style={styles.iconButton} pressedStyle={styles.pressed} />
      </View>

      <ScrollView testID="my-reading-scroll" contentContainerStyle={[styles.content, { paddingBottom: scrollBottomPadding(insets.bottom) }]}>
        {/* Two counters, both from the confirmed records: الختمات (every Khatma, Ramadan ones included) and ختمات رمضان. */}
        <View testID="my-reading-stats" style={[styles.stats, rtl && styles.rowRtl]}>
          {([['total', copy.statsTotal, stats.total], ['ramadan', copy.statsRamadan, stats.ramadan]] as const).map(([id, label, value]) => (
            <View key={id} testID={`my-reading-stat-${id}`} style={[styles.stat, id === 'total' && styles.statTotal]}>
              <Text style={[styles.statValue, id === 'total' && styles.statValueTotal]}>{num(value)}</Text>
              <Text style={[styles.statLabel, { writingDirection: direction.writingDirection }]}>{label}</Text>
            </View>
          ))}
        </View>

        <Text testID="my-reading-footnote" style={[styles.muted, direction]}>{signedIn ? copy.footnoteSynced : copy.footnote}</Text>
        {signedIn && syncLine && (
          <Text testID="my-reading-sync" accessibilityLiveRegion="polite" style={[styles.syncLine, direction]}>{syncLine}</Text>
        )}

        <View style={[styles.sectionHeader, rtl && styles.rowRtl]}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, direction]}>{copy.wirdsTitle}</Text>
          <Pressable
            testID="my-reading-new"
            accessibilityRole="button"
            accessibilityLabel={copy.newWird}
            onPress={() => setDialog({ kind: 'create' })}
            style={({ pressed }) => [styles.newButton, rtl && styles.rowRtl, pressed && styles.pressed]}>
            <Plus size={18} color={colors.onPrimaryButton} />
            <Text style={styles.newButtonText}>{copy.newWird}</Text>
          </Pressable>
        </View>

        {loadFailed && <Text testID="my-reading-load-failed" style={[styles.muted, direction]}>{copy.loadFailed}</Text>}

        {data && data.wirds.length === 0 && (
          <View testID="my-reading-empty" style={styles.empty}>
            <BookOpen size={28} color={colors.accent} />
            <Text style={[styles.emptyTitle, styles.center]}>{copy.emptyTitle}</Text>
            <Text style={[styles.muted, styles.center]}>{copy.emptyBody}</Text>
          </View>
        )}

        {data?.wirds.map((wird) => {
          const active = wird.stop.id === data.activeStopId;
          return (
            <View key={wird.stop.id} testID={`wird-card-${wird.stop.id}`} style={[styles.card, active && styles.cardActive]}>
              <View style={[styles.cardTop, rtl && styles.rowRtl]}>
                <Text numberOfLines={2} style={[styles.wirdName, direction]}>{wird.stop.name}</Text>
                {active && <Text style={styles.activeBadge}>{copy.active}</Text>}
              </View>
              <View style={[styles.metaRow, rtl && styles.rowRtl]}>
                <Text style={[styles.meta, { writingDirection: direction.writingDirection }]}>{fill(copy.pageOf, { page: num(wird.stop.page), total: num(MUSHAF_PAGE_COUNT) })}</Text>
                <Text testID={`wird-percent-${wird.stop.id}`} style={styles.metaStrong}>{fill(copy.percent, { percent: num(wird.percent) })}</Text>
              </View>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={copy.positionLabel}
                accessibilityValue={{ min: 0, max: 100, now: wird.percent }}
                style={[styles.track, rtl && styles.trackRtl]}>
                <View style={[styles.fill, { width: `${wird.percent}%` }]} />
              </View>
              <Text testID={`wird-khatmas-${wird.stop.id}`} style={[styles.meta, direction]}>{fill(copy.khatmaCount, { count: num(wird.khatmas) })}</Text>

              {wird.status === 'pending' && (
                <View testID={`wird-pending-${wird.stop.id}`} style={styles.notice}>
                  <Text style={[styles.noticeTitle, direction]}>{copy.pendingTitle}</Text>
                  <Pressable
                    testID={`wird-confirm-${wird.stop.id}`}
                    accessibilityRole="button"
                    onPress={() => setDialog({ kind: 'confirm', wird })}
                    style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                    <Text style={styles.primaryButtonText}>{copy.confirm}</Text>
                  </Pressable>
                </View>
              )}
              {wird.status === 'unconfirmedEnd' && (
                <View testID={`wird-unconfirmed-${wird.stop.id}`} style={styles.notice}>
                  <Text style={[styles.noticeTitle, direction]}>{copy.unconfirmedTitle}</Text>
                  <Text style={[styles.muted, direction]}>{copy.unconfirmedBody}</Text>
                  <Pressable
                    testID={`wird-record-${wird.stop.id}`}
                    accessibilityRole="button"
                    onPress={() => setDialog({ kind: 'confirm', wird })}
                    style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}>
                    <Text style={styles.outlineButtonText}>{copy.recordUnconfirmed}</Text>
                  </Pressable>
                </View>
              )}

              <View style={[styles.cardActions, rtl && styles.rowRtl]}>
                <Pressable
                  testID={`wird-continue-${wird.stop.id}`}
                  accessibilityRole="button"
                  onPress={() => void openMushafFor(wird.stop)}
                  style={({ pressed }) => [styles.continueButton, rtl && styles.rowRtl, pressed && styles.pressed]}>
                  <MushafIcon size={18} color={colors.onAccentFill} />
                  <Text style={styles.continueText}>{copy.continue}</Text>
                </Pressable>
                <Pressable
                  testID={`wird-rename-${wird.stop.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${copy.rename}: ${wird.stop.name}`}
                  onPress={() => setDialog({ kind: 'rename', wird })}
                  style={({ pressed }) => [styles.smallIcon, pressed && styles.pressed]}>
                  <Pencil size={18} color={colors.icon} />
                </Pressable>
                <Pressable
                  testID={`wird-delete-${wird.stop.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${copy.delete}: ${wird.stop.name}`}
                  onPress={() => setDialog({ kind: 'delete', wird })}
                  style={({ pressed }) => [styles.smallIcon, pressed && styles.pressed]}>
                  <Trash2 size={18} color={colors.danger} />
                </Pressable>
              </View>
            </View>
          );
        })}

        {/* Always here, with or without a Khatma. Only the du'a: a pending ورد is confirmed on its own card above. */}
        <Pressable
          testID="my-reading-dua"
          accessibilityRole="button"
          accessibilityLabel={copy.duaEntry}
          onPress={() => router.push('/khatm-dua')}
          style={({ pressed }) => [styles.duaRow, rtl && styles.rowRtl, pressed && styles.pressed]}>
          <BookOpenText size={22} color={colors.accent} />
          <View style={styles.flex}>
            <Text style={[styles.duaTitle, direction]}>{copy.duaEntry}</Text>
          </View>
        </Pressable>

        <Text accessibilityRole="header" style={[styles.sectionTitle, direction]}>{copy.historyTitle}</Text>
        {data && data.records.length === 0 && <Text testID="my-reading-history-empty" style={[styles.muted, direction]}>{copy.historyEmpty}</Text>}
        {data?.records.map((record) => {
          const name = nameOf(record);
          return (
            <View key={record.id} testID={`khatma-record-${record.id}`} style={[styles.historyRow, rtl && styles.rowRtl]}>
              <View style={styles.flex}>
                {/* Aligned with the language, but read in the name's own direction (its first strong letter), as on
                    تقبل الله ختمتك: an English name keeps its punctuation in place on an Arabic screen, and vice versa. */}
                <Text testID={`khatma-name-${record.id}`} style={[styles.historyName, { textAlign: direction.textAlign }]}>{name}</Text>
                {/* The record's stored local calendar day, as on تقبل الله ختمتك: never shifted by this device's time zone. */}
                <Text testID={`khatma-date-${record.id}`} style={[styles.meta, direction]}>{formatCivilDate(record.localDate, locale)}</Text>
              </View>
              <Text style={[styles.tag, record.ramadan ? styles.tagRamadan : styles.tagOther]}>
                {record.ramadan && record.ramadanHijriYear !== null ? fill(copy.ramadanTag, { year: num(record.ramadanHijriYear) }) : copy.nonRamadanTag}
              </Text>
              <Pressable
                testID={`khatma-remove-${record.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${copy.removeKhatma}: ${name}`}
                hitSlop={8}
                onPress={() => setDialog({ kind: 'remove', record, name })}
                style={({ pressed }) => [styles.removeLink, pressed && styles.pressed]}>
                <Text style={styles.removeText}>{copy.removeKhatma}</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>

      {(dialog?.kind === 'create' || dialog?.kind === 'rename') && (
      <WirdNameSheet
        mode={dialog.kind}
        initialName={dialog?.kind === 'rename' ? dialog.wird.stop.name : ''}
        busy={busy}
        error={dialogError}
        onCancel={close}
        onSubmit={(name, pageText) =>
          void run(async () => {
            if (dialog?.kind === 'rename') await renameReadingStop(dialog.wird.stop.id, name);
            else {
              const page = pageText.trim() === '' ? 1 : parsePageNumber(pageText);
              if (page === null) throw new ReadingStopError('invalid_page');
              await createWird({ name, page });
            }
            setDialog(null);
          })
        }
      />
      )}

      <ConfirmSheet
        visible={dialog?.kind === 'delete'}
        testID="wird-delete-sheet"
        title={dialog?.kind === 'delete' ? fill(copy.deleteTitle, { name: dialog.wird.stop.name }) : ''}
        body={copy.deleteBody}
        confirmLabel={copy.delete}
        cancelLabel={copy.cancel}
        destructive
        busy={busy}
        error={dialogError}
        onCancel={close}
        onConfirm={() => void run(async () => {
          if (dialog?.kind === 'delete') await deleteWird(dialog.wird.stop.id);
          setDialog(null);
        })}
      />

      <ConfirmSheet
        visible={dialog?.kind === 'confirm'}
        testID="wird-confirm-sheet"
        title={dialog?.kind === 'confirm' && dialog.wird.status === 'unconfirmedEnd' ? copy.unconfirmedConfirmTitle : messages.khatma.reachedTitle}
        body={dialog?.kind === 'confirm' ? (dialog.wird.status === 'unconfirmedEnd' ? fill(copy.unconfirmedConfirmBody, { name: dialog.wird.stop.name }) : dialog.wird.stop.name) : ''}
        confirmLabel={messages.khatma.confirm}
        cancelLabel={messages.khatma.notNow}
        busy={busy}
        error={dialogError ? messages.khatma.failed : null}
        onCancel={close}
        onConfirm={() => {
          if (dialog?.kind === 'confirm') void onConfirmKhatma(dialog.wird, dialog.wird.status === 'unconfirmedEnd');
        }}
      />

      <ConfirmSheet
        visible={dialog?.kind === 'remove'}
        testID="khatma-remove-sheet"
        title={copy.removeTitle}
        body={dialog?.kind === 'remove' ? fill(copy.removeBody, { name: dialog.name }) : ''}
        confirmLabel={copy.remove}
        cancelLabel={copy.cancel}
        destructive
        busy={busy}
        error={dialogError}
        onCancel={close}
        onConfirm={() => void run(async () => {
          if (dialog?.kind === 'remove') await removeKhatma(dialog.record.id);
          setDialog(null);
        })}
      />
    </SafeAreaView>
  );
}

/** Name (and, for a new ورد, its starting page) for creating or renaming. Mounted only while open, so it starts from `initialName`. */
function WirdNameSheet(props: {
  mode: 'create' | 'rename';
  initialName: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (name: string, page: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const { locale, messages } = useAppLocale();
  const copy = messages.myReading;
  const direction = getDirectionStyle(locale);
  const rtl = isRtlLocale(locale);
  const [name, setName] = useState(props.initialName);
  const [page, setPage] = useState('');

  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onCancel}>
      <Pressable style={styles.backdrop} accessibilityLabel={copy.cancel} onPress={props.onCancel} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetDock} pointerEvents="box-none">
        <View testID="wird-name-sheet" style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Text accessibilityRole="header" style={[styles.sheetTitle, direction]}>{props.mode === 'rename' ? copy.renameTitle : copy.createTitle}</Text>
          <Text style={[styles.label, direction]}>{copy.nameLabel}</Text>
          <TextInput
            testID="wird-name-input"
            value={name}
            onChangeText={setName}
            maxLength={READING_STOP_NAME_MAX_LENGTH}
            autoFocus
            placeholderTextColor={colors.placeholder}
            style={[styles.input, { textAlign: rtl ? 'right' : 'left', writingDirection: direction.writingDirection }]}
          />
          {props.mode === 'create' && (
            <>
              <Text style={[styles.label, direction]}>{copy.startPageLabel}</Text>
              <TextInput
                testID="wird-page-input"
                value={page}
                onChangeText={setPage}
                keyboardType="number-pad"
                placeholder={localNumber(locale, 1)}
                placeholderTextColor={colors.placeholder}
                style={[styles.input, { textAlign: rtl ? 'right' : 'left' }]}
              />
            </>
          )}
          {props.error ? <Text accessibilityRole="alert" style={[styles.error, direction]}>{props.error}</Text> : null}
          <View style={[styles.sheetActions, rtl && styles.rowRtl]}>
            <Pressable testID="wird-name-cancel" accessibilityRole="button" onPress={props.onCancel} style={({ pressed }) => [styles.sheetSecondary, pressed && styles.pressed]}>
              <Text style={styles.sheetSecondaryText}>{copy.cancel}</Text>
            </Pressable>
            <Pressable
              testID="wird-name-submit"
              accessibilityRole="button"
              accessibilityState={{ disabled: props.busy }}
              disabled={props.busy}
              onPress={() => props.onSubmit(name, page)}
              style={({ pressed }) => [styles.sheetPrimary, props.busy && styles.busyButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>{props.mode === 'rename' ? copy.save : copy.create}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  rowRtl: { flexDirection: 'row-reverse' },
  iconButton: {
    alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.full,
    borderWidth: 1, height: 48, justifyContent: 'center', width: 48,
  },
  // The title and its subtitle (Home's subtitle style) share the header's flexible middle.
  titleBlock: { flex: 1, gap: 2 },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontSize: typography.body, lineHeight: 22 },
  content: { gap: spacing.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    alignItems: 'center', backgroundColor: colors.card, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1,
    flex: 1, gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.md, ...shadows.soft,
  },
  statTotal: { backgroundColor: colors.sageSurface, borderColor: colors.sageBorder },
  statValue: { color: colors.textPrimary, fontSize: 26, fontWeight: '800' },
  statValueTotal: { color: colors.accent },
  statLabel: { color: colors.textSecondary, fontSize: typography.small, fontWeight: '700', textAlign: 'center' },
  syncLine: { color: colors.textSecondary, fontSize: typography.caption, marginTop: -spacing.sm },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  sectionTitle: { color: colors.textPrimary, fontSize: typography.bodyLarge, fontWeight: '800' },
  newButton: {
    alignItems: 'center', backgroundColor: colors.primaryButton, borderRadius: radii.full, flexDirection: 'row',
    gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.md,
  },
  newButtonText: { color: colors.onPrimaryButton, fontSize: typography.caption, fontWeight: '800' },
  empty: {
    alignItems: 'center', backgroundColor: colors.card, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1,
    gap: spacing.sm, padding: spacing.xl,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: typography.body, fontWeight: '800' },
  center: { textAlign: 'center' },
  muted: { color: colors.textSecondary, fontSize: typography.caption, lineHeight: 20 },
  card: {
    backgroundColor: colors.card, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, gap: spacing.sm,
    padding: spacing.md, ...shadows.soft,
  },
  cardActive: { borderColor: colors.sageBorder, borderWidth: 1.5 },
  cardTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  wirdName: { color: colors.textPrimary, flex: 1, fontSize: typography.bodyLarge, fontWeight: '800' },
  activeBadge: {
    backgroundColor: colors.accentSoft, borderRadius: radii.full, color: colors.accent, fontSize: typography.small,
    fontWeight: '800', overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 2,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  meta: { color: colors.textSecondary, fontSize: typography.caption },
  metaStrong: { color: colors.accent, fontSize: typography.caption, fontWeight: '800' },
  track: { backgroundColor: colors.accentSoft, borderRadius: radii.full, flexDirection: 'row', height: 8, overflow: 'hidden' },
  // Arabic reads right to left: the bar fills from the right.
  trackRtl: { flexDirection: 'row-reverse' },
  fill: { backgroundColor: colors.accentFill, borderRadius: radii.full, height: 8 },
  notice: { backgroundColor: colors.sageSurface, borderColor: colors.sageBorder, borderRadius: radii.sm, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  noticeTitle: { color: colors.textPrimary, fontSize: typography.body, fontWeight: '800' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.primaryButton, borderRadius: radii.full, justifyContent: 'center', minHeight: 46, paddingHorizontal: spacing.md },
  primaryButtonText: { color: colors.onPrimaryButton, fontSize: typography.body, fontWeight: '800', textAlign: 'center' },
  outlineButton: {
    alignItems: 'center', backgroundColor: colors.secondaryButtonSurface, borderColor: colors.secondaryButtonBorder, borderRadius: radii.full,
    borderWidth: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: spacing.md,
  },
  outlineButtonText: { color: colors.textPrimary, fontSize: typography.caption, fontWeight: '800', textAlign: 'center' },
  cardActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  continueButton: {
    alignItems: 'center', backgroundColor: colors.accentFill, borderRadius: radii.full, flex: 1, flexDirection: 'row',
    gap: spacing.sm, justifyContent: 'center', minHeight: 46, paddingHorizontal: spacing.md,
  },
  continueText: { color: colors.onAccentFill, fontSize: typography.body, fontWeight: '800' },
  smallIcon: {
    alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.full, borderWidth: 1,
    height: 46, justifyContent: 'center', width: 46,
  },
  duaRow: {
    alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1,
    flexDirection: 'row', gap: spacing.md, padding: spacing.md,
  },
  flex: { flex: 1, gap: 2 },
  duaTitle: { color: colors.textPrimary, fontSize: typography.bodyLarge, fontWeight: '800' },
  historyRow: {
    alignItems: 'center', backgroundColor: colors.card, borderColor: colors.border, borderRadius: radii.sm, borderWidth: 1,
    flexDirection: 'row', gap: spacing.sm, padding: spacing.md,
  },
  historyName: { color: colors.textPrimary, fontSize: typography.body, fontWeight: '700' },
  tag: { borderRadius: radii.full, fontSize: typography.small, fontWeight: '800', overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagRamadan: { backgroundColor: colors.accentSoft, color: colors.accent },
  tagOther: { backgroundColor: colors.surface, color: colors.textSecondary },
  removeLink: { minHeight: 32, justifyContent: 'center' },
  removeText: { color: colors.danger, fontSize: typography.small, fontWeight: '700', textDecorationLine: 'underline' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheetDock: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.sheetBackground, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.xl,
  },
  sheetTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', marginBottom: spacing.sm },
  label: { color: colors.textSecondary, fontSize: typography.caption, fontWeight: '700' },
  input: {
    backgroundColor: colors.fieldBackground, borderColor: colors.fieldBorder, borderRadius: radii.sm, borderWidth: 1,
    color: colors.textPrimary, fontSize: typography.body, minHeight: 48, paddingHorizontal: spacing.md,
  },
  error: { color: colors.danger, fontSize: typography.caption },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  sheetSecondary: {
    alignItems: 'center', backgroundColor: colors.secondaryButtonSurface, borderColor: colors.secondaryButtonBorder, borderRadius: radii.full,
    borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 50,
  },
  sheetSecondaryText: { color: colors.textPrimary, fontSize: typography.body, fontWeight: '700' },
  sheetPrimary: { alignItems: 'center', backgroundColor: colors.primaryButton, borderRadius: radii.full, flex: 1, justifyContent: 'center', minHeight: 50 },
  busyButton: { opacity: 0.6 },
  pressed: { opacity: 0.75 },
});
