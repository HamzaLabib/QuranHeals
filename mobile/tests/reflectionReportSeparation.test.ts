import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getMessages } from '@/localization/messages';

// .tsx components importing react-native/lucide-react-native can't be
// rendered under this project's plain-Node vitest environment — proven by
// source-scan instead, matching the established pattern (see
// tests/settings.test.ts's own doc comment).
const reflectionSheetSource = readFileSync(resolve(__dirname, '../src/components/ReflectionSheet.tsx'), 'utf-8');
const reportIssueSheetSource = readFileSync(resolve(__dirname, '../src/components/ReportIssueSheet.tsx'), 'utf-8');
const issueReportApiSource = readFileSync(resolve(__dirname, '../src/services/issueReportApi.ts'), 'utf-8');
// Reflection/Report-Issue wiring lives in the shared AyahExperience
// component now (both app/ayah/[emotion].tsx and app/ayah/general.tsx
// render it) — see AyahExperience.tsx's own doc comment.
const ayahScreenSource = readFileSync(resolve(__dirname, '../src/components/AyahExperience.tsx'), 'utf-8');

describe('Reflection (خواطر) and Report an Issue are completely separate (Part I §34/§38)', () => {
  it('ReportIssueSheet never imports the reflection storage or encryption modules', () => {
    expect(reportIssueSheetSource).not.toMatch(/from ['"]@\/storage\/ayahReflections['"]/);
    expect(reportIssueSheetSource).not.toMatch(/from ['"]@\/crypto\/reflectionEncryption['"]/);
    expect(reportIssueSheetSource).not.toMatch(/getReflection\(|saveReflection\(/);
  });

  it('ReflectionSheet never imports the issue-report API', () => {
    expect(reflectionSheetSource).not.toMatch(/from ['"]@\/services\/issueReportApi['"]/);
    expect(reflectionSheetSource).not.toMatch(/submitIssueReport\(/);
  });

  it("issueReportApi's IssueReportInput type has no field that could carry reflection content", () => {
    const typeBlock = issueReportApiSource.match(/export type IssueReportInput = \{[\s\S]*?\};/)?.[0] ?? '';
    expect(typeBlock.length).toBeGreaterThan(0);
    expect(typeBlock).not.toMatch(/reflection/i);
  });

  it('the ayah screen renders both as separate, independently-triggered actions', () => {
    expect(ayahScreenSource).toMatch(/setIsReflectionVisible\(true\)/);
    expect(ayahScreenSource).toMatch(/setIsReportVisible\(true\)/);
    expect(ayahScreenSource).toMatch(/messages\.reflection\.writeAction/);
    expect(ayahScreenSource).toMatch(/messages\.issueReport\.action/);
  });

  it('the issue report context only ever includes the documented safe fields (Part I §37), and never invents an emotionKey for general-mode ayahs', () => {
    expect(ayahScreenSource).toMatch(
      /context=\{\{[\s\S]*?verseKey: ayah\?\.verseKey,[\s\S]*?surahNumber: ayah\?\.surahNumber,[\s\S]*?ayahNumber: ayah\?\.ayahNumber,[\s\S]*?emotionKey: source\.mode === 'emotion' \? source\.emotionKey : undefined,[\s\S]*?\}\}/,
    );
    expect(ayahScreenSource).not.toMatch(/emotionKey:\s*'(random|general|quran)'/);
  });
});

describe('Shared Ayah reflection action', () => {
  it('uses the exact action copy, with Standard Arabic shared by both Arabic locales', () => {
    expect(getMessages('en').reflection.writeAction).toBe('Write a reflection');
    expect(getMessages('ar').reflection.writeAction).toBe('أضف خاطرة');
    expect(getMessages('ar-EG').reflection.writeAction).toBe('أضف خاطرة');
    expect(getMessages('ar').reflection.writeAction).toBe(getMessages('ar-EG').reflection.writeAction);
  });

  it('wires a separate accessible secondary Pressable to the existing sheet between Another Ayah and Report Issue', () => {
    const controls: string[] = ayahScreenSource.match(/<Pressable\b[\s\S]*?<\/Pressable>/g) ?? [];
    const reflection = controls.filter((control) => control.includes('messages.reflection.writeAction'));
    expect(reflection).toHaveLength(1);
    expect(reflection[0]).toContain('accessibilityRole="button"');
    expect(reflection[0]).toContain('accessibilityLabel={messages.reflection.writeAction}');
    expect(reflection[0]).toContain('onPress={() => setIsReflectionVisible(true)}');
    expect(reflection[0]).toContain('styles.secondaryButton');
    expect(reflection[0]).not.toContain('messages.issueReport.action');
    const reflectionIndex = controls.indexOf(reflection[0]);
    expect(controls[reflectionIndex - 1]).toContain('messages.ayah.anotherAyah');
    expect(controls[reflectionIndex + 1]).toContain('messages.issueReport.action');
    expect(controls[reflectionIndex + 1]).toContain('styles.tertiaryButton');
    expect(ayahScreenSource).toContain('visible={isReflectionVisible}');
    expect(ayahScreenSource.match(/<ReflectionSheet\b/g)).toHaveLength(1);
  });

  it('allows the secondary label to wrap in either direction and keeps a generous touch target', () => {
    expect(ayahScreenSource).toContain('styles.secondaryButtonText, direction, styles.reflectionButtonText');
    expect(ayahScreenSource).toMatch(/secondaryButton: \{[^}]*minHeight: 52/s);
    expect(ayahScreenSource).toMatch(/reflectionButton: \{[^}]*paddingVertical: spacing.md/s);
    expect(ayahScreenSource).toMatch(/reflectionButtonText: \{[^}]*flexShrink: 1,[^}]*textAlign: 'center'/s);
  });

  it('shares the action between both routes and passes only verseKey to the existing reflection sheet', () => {
    const emotionRoute = readFileSync(resolve(__dirname, '../src/app/ayah/[emotion].tsx'), 'utf-8');
    const generalRoute = readFileSync(resolve(__dirname, '../src/app/ayah/general.tsx'), 'utf-8');
    expect(emotionRoute).toContain("<AyahExperience source={{ mode: 'emotion', emotionKey, names }} />");
    expect(generalRoute).toContain("<AyahExperience source={{ mode: 'general' }} />");
    const sheet = ayahScreenSource.match(/<ReflectionSheet\b[\s\S]*?\/>/)?.[0];
    expect(sheet).toContain('verseKey={ayah?.verseKey ?? null}');
    expect(sheet).not.toMatch(/sourceMode|emotionKey|source\./);
    expect(reflectionSheetSource).toContain('getReflection(verseKey)');
    expect(reflectionSheetSource).toContain('saveReflection(verseKey, text)');
  });
});

describe('ReflectionSheet respects the 2,000-character maximum and truthful sync notes', () => {
  it('wires the TextInput to REFLECTION_MAX_LENGTH', () => {
    expect(reflectionSheetSource).toMatch(/maxLength=\{REFLECTION_MAX_LENGTH\}/);
  });

  it("chooses the note from the actual auth status, never hardcoding 'synced'", () => {
    expect(reflectionSheetSource).toMatch(/status === 'signed-in' \? messages\.reflection\.syncedNote : messages\.reflection\.guestNote/);
  });
});

describe('ReportIssueSheet exposes exactly the five approved categories', () => {
  it('category list matches ISSUE_REPORT_CATEGORIES semantics 1:1', () => {
    expect(reportIssueSheetSource).toMatch(/'ayah_not_relevant'/);
    expect(reportIssueSheetSource).toMatch(/'quran_text_display'/);
    expect(reportIssueSheetSource).toMatch(/'translation_issue'/);
    expect(reportIssueSheetSource).toMatch(/'app_technical_issue'/);
    expect(reportIssueSheetSource).toMatch(/'other'/);
  });

  it('disables the submit button while a request is in flight', () => {
    expect(reportIssueSheetSource).toMatch(/disabled=\{isSubmitting\}/);
    expect(reportIssueSheetSource).toMatch(/if \(isSubmitting\) return;/);
  });

  it('email is optional — trimmed to undefined when empty, never required', () => {
    expect(reportIssueSheetSource).toMatch(/email: email\.trim\(\)\.length > 0 \? email\.trim\(\) : undefined/);
  });
});
