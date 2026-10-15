/**
 * What the Mushaf's Copy puts on the clipboard: the ayah's verified Arabic (the device's Tanzil text, the same text
 * every ayah screen shows and the reader checks each page against), complete and with all its marks: never a
 * translation, a reference, or the page's QCF V1 glyph codes (private presentation forms that read as nothing
 * outside their page font).
 *
 * Tanzil sets the Basmala at the start of the first ayah of 112 Surahs; the Mushaf prints it on its own line, and it
 * is not part of that ayah. It is removed by the reader's own page-check rule (offline/dataset.ts expectedMushafWords):
 * an exact match of 1:1's text, or the same with the shadda of بِّسْمِ (95:1, 97:1). Al-Fatihah's 1:1 IS the Basmala and
 * At-Tawbah has none, so both are copied as they are. Checked over all 6,236 ayahs (tests/ayahCopyText.test.ts).
 */
const SHADDA = 'ّ';

export function ayahCopyText(verseKey: string, arabicText: string, basmalaText: string): string {
  const [surah, ayah] = verseKey.split(':').map(Number);
  const text = arabicText.trim();
  if (ayah !== 1 || surah === 1 || surah === 9) return text;
  const basmala = basmalaText.trim();
  for (const prefix of [basmala, basmala.slice(0, 1) + SHADDA + basmala.slice(1)]) {
    if (text.startsWith(`${prefix} `)) return text.slice(prefix.length).trim();
  }
  return text;
}
