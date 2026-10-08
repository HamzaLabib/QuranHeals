import * as Clipboard from 'expo-clipboard';
import { Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/useAuth';
import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { getReflection, REFLECTION_MAX_LENGTH, saveReflection } from '@/storage/ayahReflections';
import { getLocalDataGeneration, subscribeToLocalDataOwner } from '@/storage/localDataOwner';
import { getConflictVersionsFor, resolveConflictVersions, type ReflectionConflictVersion } from '@/storage/reflectionConflicts';
import { notifyLocalChange } from '@/storage/localChanges';

type ReflectionSheetProps = {
  visible: boolean;
  verseKey: string | null;
  onClose: () => void;
};

/**
 * Private خواطر editor — deliberately never shows Quran Arabic/translation
 * text itself (Part C §12: must not visually compete with it) and never
 * touches Report an Issue's data path (Part I §34). The guest/signed-in
 * note is chosen truthfully from the actual auth status, never claiming
 * sync that hasn't happened (Part C §14).
 */
export function ReflectionSheet({ visible, verseKey, onClose }: ReflectionSheetProps) {
  if (!visible || !verseKey) return null;

  // Keyed by verseKey so opening the sheet for a different ayah remounts
  // this inner component with fresh state, instead of imperatively
  // resetting isLoading/text inside an effect.
  return <ReflectionSheetContent key={verseKey} verseKey={verseKey} onClose={onClose} />;
}

function ReflectionSheetContent({ verseKey, onClose }: { verseKey: string; onClose: () => void }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const { status } = useAuth();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  // Whether an existing (non-empty) reflection was loaded for this
  // verseKey — Delete is only ever shown once this is known to be true, so
  // it never appears while creating a brand-new reflection.
  const [hasExistingReflection, setHasExistingReflection] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  // Other versions sync kept for this ayah (D5). Using or adding one only
  // changes the text box; it is marked handled once that text is saved.
  const [otherVersions, setOtherVersions] = useState<ReflectionConflictVersion[]>([]);
  const [adoptedVersionIds, setAdoptedVersionIds] = useState<string[]>([]);
  const [copiedVersionId, setCopiedVersionId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // The owner whose reflection this sheet edits. If it changes (sign-out,
  // account switch) the sheet closes unsaved: text loaded for one owner must
  // never be written into another owner's partition.
  const ownerGeneration = useRef(getLocalDataGeneration());
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => subscribeToLocalDataOwner((change) => {
    if (change === 'owner') onCloseRef.current();
  }), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await getReflection(verseKey).catch(() => null);
      const versions = await getConflictVersionsFor(verseKey).catch(() => []);
      if (!cancelled) {
        setText(existing?.text ?? '');
        setHasExistingReflection(existing !== null);
        setOtherVersions(versions);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [verseKey]);

  const close = () => onClose();

  /**
   * Local persistence (storage/ayahReflections.ts) is the entire save
   * contract — this never waits on, or is affected by, cloud sync (which
   * runs separately and later; see sync/reflectionsSync.ts). A storage
   * failure (corrupt/unreadable data, a full device, etc.) must never be
   * mistaken for success: the sheet stays open, the typed text is never
   * cleared, and a clear error is shown so the user can simply press Save
   * again without retyping anything. Guarded against a second concurrent
   * tap the same way performDelete is below.
   */
  const save = async () => {
    if (isSaving || isDeleting) return;
    if (ownerGeneration.current !== getLocalDataGeneration()) return onClose();
    setIsSaving(true);
    setSaveFailed(false);
    try {
      const saved = await saveReflection(verseKey, text);
      // A version counts as handled only if its text is really in what was
      // saved — using one version and then another, or editing the adopted
      // text away, leaves the version to review. Failing to mark versions
      // handled only means they are offered again, never that text is lost.
      const handled = handledVersionIds(otherVersions, adoptedVersionIds, saved?.text ?? '');
      if (handled.length > 0) await resolveConflictVersions(handled).catch(() => undefined);
      // Saved locally: upload it now (signed in only — see storage/localChanges.ts).
      notifyLocalChange();
      onClose();
    } catch {
      setSaveFailed(true);
    } finally {
      setIsSaving(false);
    }
  };

  // Reuses the exact same storage path an empty Save already takes (see
  // saveReflection's empty-text branch in storage/ayahReflections.ts) —
  // this is what creates the durable local deletion tombstone and lets the
  // existing sync merge/conflict rules propagate the deletion. There is no
  // separate deletion API and no direct AsyncStorage access here.
  const performDelete = async () => {
    if (isDeleting || isSaving) return;
    if (ownerGeneration.current !== getLocalDataGeneration()) return onClose();
    setIsDeleting(true);
    setDeleteFailed(false);
    try {
      await saveReflection(verseKey, '');
      notifyLocalChange();
      onClose();
    } catch {
      // Keep the sheet open and the typed text intact (never cleared here)
      // so the user doesn't lose their reflection because of a transient
      // storage error.
      setDeleteFailed(true);
    } finally {
      setIsDeleting(false);
    }
  };

  const confirmDelete = () => {
    if (isDeleting || isSaving) return;
    Alert.alert(
      messages.reflection.deleteConfirmTitle,
      messages.reflection.deleteConfirmMessage,
      [
        { text: messages.reflection.deleteConfirmCancel, style: 'cancel' },
        { text: messages.reflection.deleteConfirmConfirm, style: 'destructive', onPress: () => void performDelete() },
      ],
    );
  };

  const visibleVersions = otherVersions.filter((version) => !adoptedVersionIds.includes(version.id));
  const adoptVersion = (version: ReflectionConflictVersion, nextText: string) => {
    setText(nextText);
    setAdoptedVersionIds((ids) => [...ids, version.id]);
  };
  // "Keep both": appended below the current text. Offered only when the
  // result fits, so saving never truncates either version.
  const combinedText = (version: ReflectionConflictVersion) => (text.trim() ? `${text.trim()}\n\n${version.text}` : version.text);
  const copyVersion = async (version: ReflectionConflictVersion) => {
    try {
      if (await Clipboard.setStringAsync(version.text)) setCopiedVersionId(version.id);
    } catch {
      // Best-effort, like copying an ayah.
    }
  };
  const confirmDiscardVersion = (version: ReflectionConflictVersion) => {
    Alert.alert(messages.reflection.discardOtherVersionTitle, messages.reflection.discardOtherVersionMessage, [
      { text: messages.reflection.cancel, style: 'cancel' },
      {
        text: messages.reflection.discardOtherVersion,
        style: 'destructive',
        onPress: () => {
          if (ownerGeneration.current !== getLocalDataGeneration()) return onClose();
          void resolveConflictVersions([version.id]).then(
            () => setOtherVersions((versions) => versions.filter((candidate) => candidate.id !== version.id)),
            () => undefined,
          );
        },
      },
    ]);
  };
  const versionLabel = (version: ReflectionConflictVersion) =>
    version.supersededByDeletion
      ? messages.reflection.otherVersionDeletedElsewhere
      : version.origin === 'this-device'
        ? messages.reflection.otherVersionThisDevice
        : messages.reflection.otherVersionOtherDevice;

  const note = status === 'signed-in' ? messages.reflection.syncedNote : messages.reflection.guestNote;
  const showDelete = !isLoading && hasExistingReflection;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.sheet}>
              <ScrollView
                ref={scrollRef}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.content}
                onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
                <Text style={[styles.title, direction]}>{messages.reflection.title}</Text>

                <Text style={[styles.prompt, direction]}>
                  {messages.reflection.prompt}
                </Text>

                {!isLoading && visibleVersions.length > 0 && (
                  <View style={styles.otherVersions}>
                    <Text style={[styles.otherVersionsTitle, direction]}>{messages.reflection.otherVersionsTitle}</Text>
                    <Text style={[styles.otherVersionsHint, direction]}>{messages.reflection.otherVersionsHint}</Text>
                    {visibleVersions.map((version) => {
                      const combined = combinedText(version);
                      const canAdd = combined.length <= REFLECTION_MAX_LENGTH;
                      return (
                        <View key={version.id} style={styles.otherVersion}>
                          <Text style={[styles.otherVersionLabel, direction]}>{versionLabel(version)}</Text>
                          <Text selectable style={[styles.otherVersionText, direction]}>{version.text}</Text>
                          {!canAdd && <Text style={[styles.otherVersionsHint, direction]}>{messages.reflection.otherVersionTooLong}</Text>}
                          <View style={[styles.otherVersionActions, isRtl && styles.actionsRtl]}>
                            <VersionButton label={messages.reflection.useOtherVersion} onPress={() => adoptVersion(version, version.text)} />
                            {canAdd && <VersionButton label={messages.reflection.addOtherVersion} onPress={() => adoptVersion(version, combined)} />}
                            <VersionButton
                              label={copiedVersionId === version.id ? messages.reflection.copiedOtherVersion : messages.reflection.copyOtherVersion}
                              onPress={() => void copyVersion(version)}
                            />
                            <VersionButton label={messages.reflection.discardOtherVersion} onPress={() => confirmDiscardVersion(version)} destructive />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {!isLoading && (
                  <TextInput
                    value={text}
                    onChangeText={setText}
                    onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
                    multiline
                    maxLength={REFLECTION_MAX_LENGTH}
                    placeholder={messages.reflection.placeholder}
                    placeholderTextColor={colors.placeholder}
                    style={[styles.input, direction]}
                    accessibilityLabel={messages.reflection.title}
                  />
                )}

                <Text style={[styles.note, direction]}>{note}</Text>

                {deleteFailed && (
                  <Text style={[styles.errorText, direction]}>
                    {messages.reflection.deleteError}
                  </Text>
                )}
                {saveFailed && (
                  <Text style={[styles.errorText, direction]}>
                    {messages.reflection.saveError}
                  </Text>
                )}

                <View style={[styles.actions, isRtl && styles.actionsRtl]}>
                  {showDelete && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={messages.reflection.deleteAction}
                      accessibilityState={{ disabled: isDeleting || isSaving }}
                      disabled={isDeleting || isSaving}
                      onPress={confirmDelete}
                      style={({ pressed }) => [
                        styles.deleteButton,
                        (isDeleting || isSaving) && styles.disabled,
                        pressed && styles.pressed,
                      ]}>
                      <Trash2 size={20} color={colors.danger} />
                    </Pressable>
                  )}

                  <View style={[styles.primaryActions, isRtl && styles.actionsRtl]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={messages.reflection.cancel}
                      onPress={close}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        pressed && styles.pressed,
                      ]}>
                      <Text style={styles.secondaryButtonText}>
                        {messages.reflection.cancel}
                      </Text>
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={messages.reflection.save}
                      accessibilityState={{ disabled: isSaving || isDeleting }}
                      disabled={isSaving || isDeleting}
                      onPress={save}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        (isSaving || isDeleting) && styles.disabled,
                        pressed && styles.pressed,
                      ]}>
                      <Text style={styles.primaryButtonText}>
                        {messages.reflection.save}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
            </View>
          </SafeAreaView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Adopted versions whose full text is contained in the saved reflection text. */
export function handledVersionIds(versions: ReflectionConflictVersion[], adoptedIds: string[], savedText: string): string[] {
  return versions.filter((version) => adoptedIds.includes(version.id) && savedText.includes(version.text.trim())).map((version) => version.id);
}

function VersionButton({ label, onPress, destructive }: { label: string; onPress: () => void; destructive?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.versionButton, destructive && styles.versionButtonDestructive, pressed && styles.pressed]}>
      <Text style={[styles.versionButtonText, destructive && styles.versionButtonTextDestructive]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  backdrop: {
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'flex-end',
  },
  safeArea: {
    maxHeight: '85%',
    width: '100%',
  },
  sheet: {
    backgroundColor: colors.sheetBackground,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    ...shadows.soft,
  },
  content: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
  },
  prompt: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 19,
  },
  input: {
    backgroundColor: colors.inputBackground,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    minHeight: 140,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  note: {
    color: colors.textSecondary,
    fontSize: typography.small,
    lineHeight: 17,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.small,
    fontWeight: '700',
    lineHeight: 17,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionsRtl: {
    flexDirection: 'row-reverse',
  },
  primaryActions: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  deleteButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.dangerBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 52,
    minWidth: 52,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primaryButton,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonText: {
    color: colors.onPrimaryButton,
    fontSize: typography.body,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.5,
  },
  otherVersions: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  otherVersionsTitle: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '800',
  },
  otherVersionsHint: {
    color: colors.textSecondary,
    fontSize: typography.small,
    lineHeight: 17,
  },
  otherVersion: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  otherVersionLabel: {
    color: colors.accent,
    fontSize: typography.small,
    fontWeight: '700',
  },
  otherVersionText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    lineHeight: 22,
  },
  otherVersionActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  versionButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  versionButtonDestructive: {
    borderColor: colors.dangerBorder,
  },
  versionButtonText: {
    color: colors.textPrimary,
    fontSize: typography.small,
    fontWeight: '700',
  },
  versionButtonTextDestructive: {
    color: colors.danger,
  },
  pressed: {
    opacity: 0.78,
  },
});
