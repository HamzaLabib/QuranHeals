# دعاء ختم القرآن (after page 604)

**Status (2026-10-13):** the screen, its navigation and the owner-approved text are built and tested. Page 604 shows the link «دعاء ختم القرآن». Physical-device checks are pending.

## What is built

- **Screen:** `/khatm-dua` (`mobile/src/app/khatm-dua.tsx`), titled دعاء ختم القرآن in every app language, with a subtitle and note in the app's language.
- **Note:** above the du'a, saying it is a traditional supplication as printed in many Mushafs, not part of the Quran, not a supplication prescribed by the Prophet ﷺ, optional, and that reading it records no khatma.
- **Text:** always right to left and right-aligned (the title alone is centred), in the device's own Arabic system font (deliberately not the Mushaf's QPC glyphs), with no ayah markers. It is selectable, in comfortable paragraphs, and scrolls.
- **Title:** «دُعَاءُ خَتْمِ الْقُرْآنِ», centred on the screen (a spacer balances the Back button), with room for its vowel marks.
- **Controls:** text size smaller and larger (20–34 pt; line height 1.9 × size, wider spacing between paragraphs) and a Back button. Light and Dark follow the app. VoiceOver reads the du'a as Arabic (`accessibilityLanguage="ar"`) in every app language.
- **Navigation:** a link «دعاء ختم القرآن» in the space under page 604 (Normal Mode) opens the screen. Back returns to page 604 in the reader, as you left it. Opened directly, Back opens page 604.
- **Not Quran:** the Mushaf still has 604 pages and 6,236 ayahs; the next-page arrow stays disabled on 604; nothing is a "page 605"; the du'a is not in the Quran database, search or counts.
- **Saves nothing:** no reading position, ورد, bookmark, reflection or khatma.

## The text (approved 2026-10-13)

This is the **approved traditional Mushaf du'a**: the wording printed at the end of Mushafs, approved word for word by the owner, with its title «دُعَاءُ خَتْمِ الْقُرْآنِ» and 12 paragraphs. It is **not a verbatim reproduction of any one hadith narration**. Where a paragraph draws on a hadith, it keeps the traditional Mushaf wording, not the wording of a particular narration.

- **Stored in** `mobile/src/mushaf/khatmDua.ts` (`KHATM_DUA`: the title and one string per paragraph).
- **Reference:** `mobile/tests/fixtures/khatmDuaApproved.txt` holds the approved text exactly as supplied (UTF-8, LF line endings pinned in `.gitattributes`). `mobile/tests/khatmDua.test.ts` compares the app text with it character by character and pins the reference's SHA-256, so neither can change unnoticed.
- **Never edit, correct or normalize it**, and never replace it with a hadith narration's wording, without the owner's approval.
- **What it is:** a compilation. Some paragraphs come from prophetic supplications (for example Muslim 2720, Tirmidhī 3502), one is Quranic (البقرة ٢:٢٠١, in ordinary spelling), and others are traditional wording. The on-screen note says it is not Quran (though it includes supplications from the Quran and the Sunnah), and that no wording is prescribed by the Prophet ﷺ for a khatm. It is never presented as one hadith.
- **No source line:** the approved text names no printed edition, so the screen shows none.

**Intentional differences from the hadith narrations** (confirmed by the owner on 2026-10-13: keep the traditional Mushaf wording; do not "correct" them):

| Paragraph | Approved Mushaf wording (kept) | Narration's wording (not used) |
|---|---|---|
| 9 | «مَا تَحُولُ بِهِ بَيْنَنَا وَبَيْنَ مَعْصِيَتِكَ» | «مَا يَحُولُ بَيْنَنَا وَبَيْنَ مَعَاصِيكَ» (Tirmidhī 3502) |
| 9 | «مَا تُبَلِّغُنَا بِهَا جَنَّتَكَ» | «بِهِ» (Tirmidhī 3502) |
| 9 | «مَصَائِبَ الدُّنْيَا» | «مُصِيبَاتِ الدُّنْيَا» (Tirmidhī 3502) |
| 3 | «دِينِي» | «دِينِيَ» (Muslim 2720) |

Background research (kept for reference): the long du'a is popularly attributed to Ibn Taymiyyah. Ibn Bāz, al-Albānī, Ibn ʿUthaymīn and Bakr Abū Zayd reject that attribution. No authentic khatm du'a from the Prophet ﷺ is established. Anas ibn Mālik's practice of gathering his family for du'a at a khatm is reported authentically.

## Khatma completion (built 2026-10-13, see `docs/khatma.md`)

The du'a screen stays optional and records nothing by being opened, read or scrolled. Opened from أورادي وختماتي for a ورد whose completion is pending (`/khatm-dua?wird=<id>`), it also shows **تأكيد إتمام الختمة**, a separate, deliberate tap, shown below the du'a (it also works without a text, under the not-available note). It opens from three places: page 604, the permanent row in أورادي وختماتي, and «قراءة دعاء ختم القرآن» on the completion screen. Back now reads «رجوع»/"Back" (it returns to wherever it was opened from; opened directly, to page 604 as before).

The original plan, kept for reference:

When that feature is built, the action needs:

- **A khatma record:** an id, the start date, the completion date, an optional note, and the ورد or reading plan it belongs to (if any). Stored on the device first; synced with the account later, like reflections.
- **Deliberate confirmation:** a button at the end of this screen opening a confirmation ("Record this khatma as completed?") with Confirm and Cancel. Opening, reading or scrolling the du'a must never record anything (already tested).
- **Once per khatma:** a second confirmation the same day asks again; recorded completions can be undone from أورادي وختماتي.
- **Not inferred:** reaching page 604 never counts as a completion.
- **Placement:** the button goes below the du'a's source line, and only once أورادي وختماتي can show the record.
