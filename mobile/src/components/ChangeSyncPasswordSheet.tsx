import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TouchableWithoutFeedback, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getCurrentSessionToken } from '@/auth/useAuth';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { getCloudSyncKey, type SyncKeyRecord } from '@/sync/syncApi';
import { changeSyncPassword, verifySyncPassphrase } from '@/sync/syncKeyManager';
import { useVerifiedSyncPassword } from '@/sync/useVerifiedSyncPassword';
import { canChangeSyncPassword, passwordLengthError } from '@/utils/syncPasswordValidation';
import { SyncPasswordField } from './SyncPasswordField';
import { syncPasswordStyles as styles } from './SyncPassphraseSheet';

/** Mounted only while open, so dismissal/sign-out drops all password state. */
export function ChangeSyncPasswordSheet({ onClose }: { onClose: () => void }) {
  const { locale, messages } = useAppLocale();
  const copy = messages.syncPassphrase;
  const direction = getDirectionStyle(locale);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [touched, setTouched] = useState(false);
  const [key, setKey] = useState<SyncKeyRecord | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; tokenRef.current = null; };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await getCurrentSessionToken();
        if (!token) throw new Error('Not signed in.');
        const cloudKey = await getCloudSyncKey(token);
        if (!cloudKey) throw new Error('No sync key.');
        if (active) { tokenRef.current = token; setKey(cloudKey); }
      } catch {
        if (active) setLoadFailed(true);
      }
    })();
    return () => { active = false; };
  }, [attempt]);

  const verify = useCallback((value: string) => key ? verifySyncPassphrase(key, value) : Promise.resolve(false), [key]);
  const { verified, incorrect } = useVerifiedSyncPassword(current, key ? verify : undefined);
  const canSubmit = !saving && canChangeSyncPassword(current, next, confirmation, verified);
  const lengthError = passwordLengthError(next);
  const feedback = incorrect ? copy.incorrectError
    : next && current === next ? copy.mustDiffer
    : touched && lengthError ? copy[lengthError]
    : confirmation && confirmation !== next ? copy.mismatch : null;

  const submit = async () => {
    if (!canSubmit || busy.current || !tokenRef.current) return;
    busy.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      await changeSyncPassword(tokenRef.current, current, next);
      if (mounted.current) {
        setCurrent(''); setNext(''); setConfirmation('');
        onClose();
      }
    } catch {
      if (mounted.current) {
        setSaveFailed(true);
        // Re-fetch after a conflict or uncertain network result before
        // allowing another attempt against the current cloud wrapper.
        setKey(null); setCurrent(''); setLoadFailed(false);
        setAttempt((value) => value + 1);
      }
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const close = () => { if (!busy.current) onClose(); };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.sheet}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.title, direction]}>{copy.changeTitle}</Text>
                <Text style={[styles.description, direction]}>{copy.changeDescription}</Text>
                <SyncPasswordField value={current} onChangeText={setCurrent} label={copy.currentPassword} editable={!saving} />
                <SyncPasswordField value={next} onChangeText={setNext} label={copy.newPassword}
                  onBlur={() => setTouched(true)} editable={!saving} />
                <SyncPasswordField value={confirmation} onChangeText={setConfirmation} label={copy.confirmNewPassword} editable={!saving} />
                <Text style={[styles.description, direction]}>{copy.lengthHint}{'\n'}{copy.allowedHint}</Text>
                {feedback && <Text accessibilityLiveRegion="polite" style={[styles.error, direction]}>{feedback}</Text>}
                {saveFailed && <Text accessibilityLiveRegion="polite" style={[styles.error, direction]}>{copy.saveError}</Text>}
                {loadFailed && <>
                  <Text style={[styles.error, direction]}>{copy.loadError}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={copy.retry}
                    style={styles.secondaryButton} onPress={() => { setLoadFailed(false); setAttempt((value) => value + 1); }}>
                    <Text style={styles.secondaryButtonText}>{copy.retry}</Text>
                  </Pressable>
                </>}
                <View style={[styles.actions, isRtlLocale(locale) && styles.actionsRtl]}>
                  <Pressable accessibilityRole="button" accessibilityLabel={messages.reflection.cancel}
                    disabled={saving} onPress={close} style={[styles.secondaryButton, saving && styles.disabled]}>
                    <Text style={styles.secondaryButtonText}>{messages.reflection.cancel}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={copy.changeTitle}
                    accessibilityState={{ disabled: !canSubmit, busy: saving }}
                    disabled={!canSubmit} onPress={() => void submit()} style={[styles.primaryButton, !canSubmit && styles.disabled]}>
                    <Text style={styles.primaryButtonText}>{copy.changeTitle}</Text>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </SafeAreaView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}
