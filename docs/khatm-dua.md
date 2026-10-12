# دعاء ختم القرآن (after page 604)

**Status (2026-10-12):** the screen and its navigation are built and tested. **The text is waiting for your approval of a source**, so `KHATM_DUA` (`mobile/src/mushaf/khatmDua.ts`) is `null`. Until it is set, page 604 shows no link, and the screen, opened by URL, says it is not available yet.

## What is built

- **Screen:** `/khatm-dua` (`mobile/src/app/khatm-dua.tsx`), titled دعاء ختم القرآن in every app language, with a subtitle and note in the app's language.
- **Note:** above the du'a, saying it is a traditional supplication as printed in many Mushafs, not part of the Quran, not a supplication prescribed by the Prophet ﷺ, optional, and that reading it records no khatma.
- **Text:** always right to left and centred, in the device's own Arabic system font (deliberately not the Mushaf's QPC glyphs), with no ayah markers. It is selectable, in comfortable paragraphs, and scrolls.
- **Controls:** text size smaller and larger (20–34 pt), a Back button, and the printed source shown under the du'a. Light and Dark follow the app.
- **Navigation:** a link «دعاء ختم القرآن» in the space under page 604 (Normal Mode) opens the screen. Back returns to page 604 in the reader, as you left it. Opened directly, Back opens page 604.
- **Not Quran:** the Mushaf still has 604 pages and 6,236 ayahs; the next-page arrow stays disabled on 604; nothing is a "page 605"; the du'a is not in the Quran database, search or counts.
- **Saves nothing:** no reading position, ورد, bookmark, reflection or khatma.

## The text: options for your approval

The research found a clear picture:

- **The long du'a printed at the end of many Mushafs** (it commonly begins «اللَّهُمَّ ارْحَمْنِي بِالقُرْآنِ وَاجْعَلْهُ لِي إِمَامًا وَنُورًا وَهُدًى وَرَحْمَةً…») is popularly attributed to Ibn Taymiyyah.
  - Ibn Bāz, al-Albānī and Ibn ʿUthaymīn reject that attribution, as does Bakr Abū Zayd in *جزء في مرويات دعاء ختم القرآن وحكمه داخل الصلاة وخارجها*. Ibn Bāz said the du'a is good, but its attribution to Ibn Taymiyyah is a mistake with no known source.
  - No authentic khatm du'a from the Prophet ﷺ is established; the reports are weak or fabricated (Bakr Abū Zayd).
  - The practice of Anas ibn Mālik (may Allah be pleased with him), gathering his family to make du'a at a khatm, is reported with a chain described as authentic.
- **Several versions circulate**, with differing wording and later additions, for example versions "with additions by Sheikh al-Khulayfī". Websites copy them without citing a printed source.

Because the wording varies, I have **not** chosen a text. Options:

1. **(Recommended) The traditional long du'a, transcribed from one specific printed Mushaf you choose.** For example, the Mushaf you own whose end pages you want reproduced.
   - Send clear photos of those pages and the Mushaf's title page (publisher and year).
   - I transcribe it exactly, show it to you for checking word by word, and cite that edition under the du'a.
   - The note stays: traditional, attribution unproven, optional.
2. **The same du'a from a named published book** with a printed text you approve. Bakr Abū Zayd's study discusses the reports but is not a source of the long text.
3. **A khatm du'a from a named imam of the Haramain**, from an official transcript you choose. These change from year to year and are tied to one person.

**What I need from you:** pick an option, and for 1 or 3 send the source. Nothing is shown to users until you approve the final transcription.

## Khatma completion (deferred)

The action **تسجيل ختمة مكتملة / Mark Khatma as Completed** is not built. There is no button, placeholder or stored data, as you asked: أورادي وختماتي doesn't exist yet.

When that feature is built, the action needs:

- **A khatma record:** an id, the start date, the completion date, an optional note, and the ورد or reading plan it belongs to (if any). Stored on the device first; synced with the account later, like reflections.
- **Deliberate confirmation:** a button at the end of this screen opening a confirmation ("Record this khatma as completed?") with Confirm and Cancel. Opening, reading or scrolling the du'a must never record anything (already tested).
- **Once per khatma:** a second confirmation the same day asks again; recorded completions can be undone from أورادي وختماتي.
- **Not inferred:** reaching page 604 never counts as a completion.
- **Placement:** the button goes below the du'a's source line, and only once أورادي وختماتي can show the record.
