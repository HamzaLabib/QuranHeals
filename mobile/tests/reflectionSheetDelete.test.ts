import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_LOCALES } from '@/localization/locales';
import { MESSAGES } from '@/localization/messages';

// .tsx components importing react-native/lucide-react-native can't be
// rendered under this project's plain-Node vitest environment — proven by
// source-scan instead, matching the established pattern for this exact
// component (see tests/reflectionReportSeparation.test.ts).
const source = readFileSync(resolve(__dirname, '../src/components/ReflectionSheet.tsx'), 'utf-8');

describe('ReflectionSheet: Delete visibility', () => {
  it('Delete is gated on an existing (non-empty) reflection having actually loaded — never shown while creating a new one', () => {
    expect(source).toMatch(/const \[hasExistingReflection, setHasExistingReflection\] = useState\(false\)/);
    expect(source).toMatch(/setHasExistingReflection\(existing !== null\)/);
    expect(source).toMatch(/const showDelete = !isLoading && hasExistingReflection;/);
    expect(source).toMatch(/\{showDelete && \(/);
  });

  it('a brand-new reflection (no existing entry) never renders the Delete button, because hasExistingReflection starts and stays false', () => {
    // getReflection resolving to null (nothing saved yet, or a failed load)
    // is the only path that leaves hasExistingReflection at its initial
    // `false` — confirmed here structurally rather than by rendering.
    expect(source).toMatch(/const existing = await getReflection\(verseKey\)\.catch\(\(\) => null\);/);
    expect(source).toMatch(/setText\(existing\?\.text \?\? ''\);/);
  });

  it('Delete keeps the existing Cancel and Save buttons intact, grouped together, unaffected by its own presence', () => {
    expect(source).toMatch(/accessibilityLabel=\{messages\.reflection\.cancel\}/);
    expect(source).toMatch(/accessibilityLabel=\{messages\.reflection\.save\}/);
    expect(source).toMatch(/onPress=\{close\}/);
    expect(source).toMatch(/onPress=\{save\}/);
  });
});

describe('ReflectionSheet: Delete layout', () => {
  it('Delete sits outside the Cancel/Save group, which keeps sharing the remaining space (flex: 1), not three equal-width columns', () => {
    expect(source).toMatch(/<View style=\{\[styles\.actions, isRtl && styles\.actionsRtl\]\}>\s*\{showDelete && \(/);
    expect(source).toMatch(/<View style=\{\[styles\.primaryActions, isRtl && styles\.actionsRtl\]\}>/);

    const deleteButtonStyle = source.match(/deleteButton: \{[\s\S]*?\n {2}\},/)?.[0] ?? '';
    expect(deleteButtonStyle).not.toMatch(/flex: 1/); // compact, not stretched into an equal column
    const primaryActionsStyle = source.match(/primaryActions: \{[\s\S]*?\n {2}\},/)?.[0] ?? '';
    expect(primaryActionsStyle).toMatch(/flex: 1/); // Cancel+Save still share the rest of the row, as before
  });

  it('uses the existing restrained destructive palette (rust/rustSoft), not a filled red block', () => {
    const deleteButtonStyle = source.match(/deleteButton: \{[\s\S]*?\n {2}\},/)?.[0] ?? '';
    expect(deleteButtonStyle).toMatch(/borderColor: colors\.rustSoft/);
    expect(deleteButtonStyle).toMatch(/backgroundColor: colors\.surface/);
    expect(source).toMatch(/<Trash2 size=\{20\} color=\{colors\.rust\}\s*\/>/);
  });

  it('gives Delete an accessible >=44x44 touch target', () => {
    const deleteButtonStyle = source.match(/deleteButton: \{[\s\S]*?\n {2}\},/)?.[0] ?? '';
    expect(deleteButtonStyle).toMatch(/minHeight: 52/);
    expect(deleteButtonStyle).toMatch(/minWidth: 52/);
  });

  it('gives Delete its own accurate accessibility label, distinct from Cancel/Save', () => {
    expect(source).toMatch(/accessibilityLabel=\{messages\.reflection\.deleteAction\}/);
  });

  it('mirrors naturally for RTL — both the outer row (Delete vs. the group) and the inner Cancel/Save row use the same reversal', () => {
    expect(source).toMatch(/<View style=\{\[styles\.actions, isRtl && styles\.actionsRtl\]\}>/);
    expect(source).toMatch(/<View style=\{\[styles\.primaryActions, isRtl && styles\.actionsRtl\]\}>/);
  });
});

describe('ReflectionSheet: Delete confirmation dialog', () => {
  it('shows a confirmation via the platform Alert before deleting — never deletes directly on press', () => {
    expect(source).toMatch(/onPress=\{confirmDelete\}/);
    expect(source).toMatch(/Alert\.alert\(/);
  });

  it('uses the exact required title/message/cancel/confirm copy, sourced from localized messages, never hardcoded', () => {
    const confirmBlock = source.match(/const confirmDelete = \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? '';
    expect(confirmBlock).toMatch(/messages\.reflection\.deleteConfirmTitle/);
    expect(confirmBlock).toMatch(/messages\.reflection\.deleteConfirmMessage/);
    expect(confirmBlock).toMatch(/text: messages\.reflection\.deleteConfirmCancel, style: 'cancel'/);
    expect(confirmBlock).toMatch(/text: messages\.reflection\.deleteConfirmConfirm, style: 'destructive', onPress: \(\) => void performDelete\(\)/);
  });

  it('the Cancel option in the dialog never triggers performDelete — only the destructive Confirm option does', () => {
    const confirmBlock = source.match(/const confirmDelete = \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? '';
    const cancelOption = confirmBlock.match(/\{ text: messages\.reflection\.deleteConfirmCancel, style: 'cancel' \}/)?.[0] ?? '';
    expect(cancelOption).not.toMatch(/performDelete/);
  });
});

describe('ReflectionSheet: deletion implementation', () => {
  it('uses the existing empty-save/tombstone path — saveReflection(verseKey, \'\') — never a new deletion API or direct AsyncStorage access', () => {
    const deleteBlock = source.match(/const performDelete = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? '';
    expect(deleteBlock).toMatch(/await saveReflection\(verseKey, ''\);/);
    // No import of AsyncStorage and no AsyncStorage.<method>(...) call — a
    // doc comment mentioning the concept by name (explaining what is NOT
    // done) is fine and expected, so this checks actual usage, not the word.
    expect(source).not.toMatch(/from ['"]@react-native-async-storage/);
    expect(source).not.toMatch(/AsyncStorage\./);
    expect(source).not.toMatch(/deleteReflection\(|removeReflection\(|DELETE ['"`]/);
  });

  it('guards against rapid double presses by bailing out while a deletion is already in flight', () => {
    const deleteBlock = source.match(/const performDelete = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? '';
    expect(deleteBlock).toMatch(/const performDelete = async \(\) => \{\s*if \(isDeleting\) return;/);
    expect(deleteBlock).toMatch(/setIsDeleting\(true\);/);
    expect(deleteBlock).toMatch(/setIsDeleting\(false\);/);
    // The confirmation trigger itself is also guarded, so a second tap on
    // Delete while the dialog/deletion is in flight can't queue another one.
    expect(source).toMatch(/const confirmDelete = \(\) => \{\s*if \(isDeleting\) return;/);
    // The button is visually/functionally disabled while deleting, too.
    expect(source).toMatch(/disabled=\{isDeleting\}/);
    expect(source).toMatch(/accessibilityState=\{\{ disabled: isDeleting \}\}/);
  });

  it('closes the sheet only inside the success path, after the save has resolved — never in the catch/failure path', () => {
    const deleteBlock = source.match(/const performDelete = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? '';
    const tryBlock = deleteBlock.match(/try \{([\s\S]*?)\} catch/)?.[1] ?? '';
    const catchBlock = deleteBlock.match(/catch \{([\s\S]*?)\} finally/)?.[1] ?? '';
    expect(tryBlock).toMatch(/await saveReflection\(verseKey, ''\);/);
    expect(tryBlock).toMatch(/onClose\(\);/);
    expect(catchBlock).not.toMatch(/onClose\(\)/);
  });

  it('on failure, preserves the typed reflection text (never calls setText) and surfaces the dedicated error message instead', () => {
    const deleteBlock = source.match(/const performDelete = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? '';
    const catchBlock = deleteBlock.match(/catch \{([\s\S]*?)\} finally/)?.[1] ?? '';
    expect(catchBlock).not.toMatch(/setText\(/);
    expect(catchBlock).toMatch(/setDeleteFailed\(true\);/);
    expect(source).toMatch(/\{deleteFailed && <Text[^>]*>\{messages\.reflection\.deleteError\}<\/Text>\}/);
  });

  it('relies on the My Reflections screen\'s existing onClose->refresh wiring to update the list immediately (no separate refresh call needed here)', () => {
    // ReflectionSheet only ever calls the onClose prop it was given; the
    // caller (app/reflections.tsx) is what refreshes the list on close —
    // already covered by reflectionsScreen.test.ts's "refreshes the list
    // after the sheet closes" test. Confirmed here that ReflectionSheet
    // itself never bypasses that by calling something else.
    expect(source).not.toMatch(/refresh\(\)/);
    expect((source.match(/onClose\(\);/g) ?? []).length).toBeGreaterThanOrEqual(2); // save() and performDelete()'s success path
  });
});

describe('ReflectionSheet: Save/Cancel/encryption/sync/length-limit behavior is unchanged', () => {
  it('save() is byte-identical to its pre-Delete form — no new guard, no new error handling added to it', () => {
    const saveBlock = source.match(/const save = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? '';
    expect(saveBlock.replace(/\s+/g, ' ').trim()).toBe("const save = async () => { await saveReflection(verseKey, text); onClose(); };");
  });

  it('close() (Cancel) is unchanged', () => {
    expect(source).toMatch(/const close = \(\) => onClose\(\);/);
  });

  it('still enforces REFLECTION_MAX_LENGTH on the same TextInput', () => {
    expect(source).toMatch(/maxLength=\{REFLECTION_MAX_LENGTH\}/);
  });

  it('still uses keyboardShouldPersistTaps="handled" (unchanged keyboard handling)', () => {
    expect(source).toContain('keyboardShouldPersistTaps="handled"');
  });

  it('never imports or calls anything from the sync/encryption layer directly — deletion still flows through the same local-first storage module that reflectionsSync.ts syncs from', () => {
    expect(source).not.toMatch(/from ['"]@\/sync\//);
    expect(source).not.toMatch(/from ['"]@\/crypto\//);
    expect(source).toMatch(/from '@\/storage\/ayahReflections'/);
  });
});

describe('ReflectionSheet: Delete confirmation localization', () => {
  it('English matches the exact required copy', () => {
    expect(MESSAGES.en.reflection.deleteConfirmTitle).toBe('Delete reflection?');
    expect(MESSAGES.en.reflection.deleteConfirmMessage).toBe(
      'This reflection will be removed from this device and your other signed-in devices.',
    );
    expect(MESSAGES.en.reflection.deleteConfirmCancel).toBe('Cancel');
    expect(MESSAGES.en.reflection.deleteConfirmConfirm).toBe('Delete');
  });

  it('Standard Arabic matches the exact required copy', () => {
    expect(MESSAGES.ar.reflection.deleteConfirmTitle).toBe('حذف الخاطرة؟');
    expect(MESSAGES.ar.reflection.deleteConfirmMessage).toBe(
      'ستُحذف هذه الخاطرة من هذا الجهاز وأجهزتك الأخرى التي سجّلت الدخول عليها.',
    );
    expect(MESSAGES.ar.reflection.deleteConfirmCancel).toBe('إلغاء');
    expect(MESSAGES.ar.reflection.deleteConfirmConfirm).toBe('حذف');
  });

  it('Egyptian Arabic matches the exact same required copy as Standard Arabic', () => {
    expect(MESSAGES['ar-EG'].reflection.deleteConfirmTitle).toBe(MESSAGES.ar.reflection.deleteConfirmTitle);
    expect(MESSAGES['ar-EG'].reflection.deleteConfirmMessage).toBe(MESSAGES.ar.reflection.deleteConfirmMessage);
    expect(MESSAGES['ar-EG'].reflection.deleteConfirmCancel).toBe(MESSAGES.ar.reflection.deleteConfirmCancel);
    expect(MESSAGES['ar-EG'].reflection.deleteConfirmConfirm).toBe(MESSAGES.ar.reflection.deleteConfirmConfirm);
  });

  it('every locale defines the exact same reflection.* keys — none missing the new delete strings', () => {
    const keySet = (locale: (typeof APP_LOCALES)[number]) => Object.keys(MESSAGES[locale].reflection).sort();
    expect(keySet('ar')).toEqual(keySet('en'));
    expect(keySet('ar-EG')).toEqual(keySet('en'));
  });

  it('every new delete-related string in every locale is non-empty', () => {
    const keys = ['deleteAction', 'deleteConfirmTitle', 'deleteConfirmMessage', 'deleteConfirmCancel', 'deleteConfirmConfirm', 'deleteError'] as const;
    for (const locale of APP_LOCALES) {
      for (const key of keys) {
        expect(MESSAGES[locale].reflection[key].trim().length, `${locale}.reflection.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });
});
