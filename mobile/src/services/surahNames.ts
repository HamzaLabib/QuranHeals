/**
 * The verified English/Arabic name for all 114 Surahs, entirely local and
 * offline — no network dependency, unlike the `surahNameEnglish`/
 * `surahNameArabic` fields on a backend-fetched `Ayah`.
 *
 * This is a mobile-side copy of the exact same verified data the backend
 * already uses for every ayah's surah name fields (see
 * backend/assets/quran/surah-names.json and
 * backend/src/quran/surahMetadata.ts) — sourced from Tanzil's
 * quran-data.xml `<sura name="..." tname="...">` attributes. Reusing it here
 * rather than inventing new transliterations keeps the English spelling
 * identical to what the app has always shown, while finally making the
 * Arabic name available locally too, so any screen (including a fully
 * offline one like My Reflections) can resolve a correct Surah reference
 * from a surah number alone, without depending on the network response
 * carrying those fields.
 */
export type SurahName = {
  surahNumber: number;
  nameEnglish: string;
  nameArabic: string;
};

const SURAH_NAMES: readonly SurahName[] = [
  { surahNumber: 1, nameEnglish: 'Al-Faatiha', nameArabic: 'الفاتحة' },
  { surahNumber: 2, nameEnglish: 'Al-Baqara', nameArabic: 'البقرة' },
  { surahNumber: 3, nameEnglish: 'Aal-i-Imraan', nameArabic: 'آل عمران' },
  { surahNumber: 4, nameEnglish: 'An-Nisaa', nameArabic: 'النساء' },
  { surahNumber: 5, nameEnglish: 'Al-Maaida', nameArabic: 'المائدة' },
  { surahNumber: 6, nameEnglish: "Al-An'aam", nameArabic: 'الأنعام' },
  { surahNumber: 7, nameEnglish: "Al-A'raaf", nameArabic: 'الأعراف' },
  { surahNumber: 8, nameEnglish: 'Al-Anfaal', nameArabic: 'الأنفال' },
  { surahNumber: 9, nameEnglish: 'At-Tawba', nameArabic: 'التوبة' },
  { surahNumber: 10, nameEnglish: 'Yunus', nameArabic: 'يونس' },
  { surahNumber: 11, nameEnglish: 'Hud', nameArabic: 'هود' },
  { surahNumber: 12, nameEnglish: 'Yusuf', nameArabic: 'يوسف' },
  { surahNumber: 13, nameEnglish: "Ar-Ra'd", nameArabic: 'الرعد' },
  { surahNumber: 14, nameEnglish: 'Ibrahim', nameArabic: 'ابراهيم' },
  { surahNumber: 15, nameEnglish: 'Al-Hijr', nameArabic: 'الحجر' },
  { surahNumber: 16, nameEnglish: 'An-Nahl', nameArabic: 'النحل' },
  { surahNumber: 17, nameEnglish: 'Al-Israa', nameArabic: 'الإسراء' },
  { surahNumber: 18, nameEnglish: 'Al-Kahf', nameArabic: 'الكهف' },
  { surahNumber: 19, nameEnglish: 'Maryam', nameArabic: 'مريم' },
  { surahNumber: 20, nameEnglish: 'Taa-Haa', nameArabic: 'طه' },
  { surahNumber: 21, nameEnglish: 'Al-Anbiyaa', nameArabic: 'الأنبياء' },
  { surahNumber: 22, nameEnglish: 'Al-Hajj', nameArabic: 'الحج' },
  { surahNumber: 23, nameEnglish: 'Al-Muminoon', nameArabic: 'المؤمنون' },
  { surahNumber: 24, nameEnglish: 'An-Noor', nameArabic: 'النور' },
  { surahNumber: 25, nameEnglish: 'Al-Furqaan', nameArabic: 'الفرقان' },
  { surahNumber: 26, nameEnglish: "Ash-Shu'araa", nameArabic: 'الشعراء' },
  { surahNumber: 27, nameEnglish: 'An-Naml', nameArabic: 'النمل' },
  { surahNumber: 28, nameEnglish: 'Al-Qasas', nameArabic: 'القصص' },
  { surahNumber: 29, nameEnglish: 'Al-Ankaboot', nameArabic: 'العنكبوت' },
  { surahNumber: 30, nameEnglish: 'Ar-Room', nameArabic: 'الروم' },
  { surahNumber: 31, nameEnglish: 'Luqman', nameArabic: 'لقمان' },
  { surahNumber: 32, nameEnglish: 'As-Sajda', nameArabic: 'السجدة' },
  { surahNumber: 33, nameEnglish: 'Al-Ahzaab', nameArabic: 'الأحزاب' },
  { surahNumber: 34, nameEnglish: 'Saba', nameArabic: 'سبإ' },
  { surahNumber: 35, nameEnglish: 'Faatir', nameArabic: 'فاطر' },
  { surahNumber: 36, nameEnglish: 'Yaseen', nameArabic: 'يس' },
  { surahNumber: 37, nameEnglish: 'As-Saaffaat', nameArabic: 'الصافات' },
  { surahNumber: 38, nameEnglish: 'Saad', nameArabic: 'ص' },
  { surahNumber: 39, nameEnglish: 'Az-Zumar', nameArabic: 'الزمر' },
  { surahNumber: 40, nameEnglish: 'Al-Ghaafir', nameArabic: 'غافر' },
  { surahNumber: 41, nameEnglish: 'Fussilat', nameArabic: 'فصلت' },
  { surahNumber: 42, nameEnglish: 'Ash-Shura', nameArabic: 'الشورى' },
  { surahNumber: 43, nameEnglish: 'Az-Zukhruf', nameArabic: 'الزخرف' },
  { surahNumber: 44, nameEnglish: 'Ad-Dukhaan', nameArabic: 'الدخان' },
  { surahNumber: 45, nameEnglish: 'Al-Jaathiya', nameArabic: 'الجاثية' },
  { surahNumber: 46, nameEnglish: 'Al-Ahqaf', nameArabic: 'الأحقاف' },
  { surahNumber: 47, nameEnglish: 'Muhammad', nameArabic: 'محمد' },
  { surahNumber: 48, nameEnglish: 'Al-Fath', nameArabic: 'الفتح' },
  { surahNumber: 49, nameEnglish: 'Al-Hujuraat', nameArabic: 'الحجرات' },
  { surahNumber: 50, nameEnglish: 'Qaaf', nameArabic: 'ق' },
  { surahNumber: 51, nameEnglish: 'Adh-Dhaariyat', nameArabic: 'الذاريات' },
  { surahNumber: 52, nameEnglish: 'At-Tur', nameArabic: 'الطور' },
  { surahNumber: 53, nameEnglish: 'An-Najm', nameArabic: 'النجم' },
  { surahNumber: 54, nameEnglish: 'Al-Qamar', nameArabic: 'القمر' },
  { surahNumber: 55, nameEnglish: 'Ar-Rahmaan', nameArabic: 'الرحمن' },
  { surahNumber: 56, nameEnglish: 'Al-Waaqia', nameArabic: 'الواقعة' },
  { surahNumber: 57, nameEnglish: 'Al-Hadid', nameArabic: 'الحديد' },
  { surahNumber: 58, nameEnglish: 'Al-Mujaadila', nameArabic: 'المجادلة' },
  { surahNumber: 59, nameEnglish: 'Al-Hashr', nameArabic: 'الحشر' },
  { surahNumber: 60, nameEnglish: 'Al-Mumtahana', nameArabic: 'الممتحنة' },
  { surahNumber: 61, nameEnglish: 'As-Saff', nameArabic: 'الصف' },
  { surahNumber: 62, nameEnglish: "Al-Jumu'a", nameArabic: 'الجمعة' },
  { surahNumber: 63, nameEnglish: 'Al-Munaafiqoon', nameArabic: 'المنافقون' },
  { surahNumber: 64, nameEnglish: 'At-Taghaabun', nameArabic: 'التغابن' },
  { surahNumber: 65, nameEnglish: 'At-Talaaq', nameArabic: 'الطلاق' },
  { surahNumber: 66, nameEnglish: 'At-Tahrim', nameArabic: 'التحريم' },
  { surahNumber: 67, nameEnglish: 'Al-Mulk', nameArabic: 'الملك' },
  { surahNumber: 68, nameEnglish: 'Al-Qalam', nameArabic: 'القلم' },
  { surahNumber: 69, nameEnglish: 'Al-Haaqqa', nameArabic: 'الحاقة' },
  { surahNumber: 70, nameEnglish: "Al-Ma'aarij", nameArabic: 'المعارج' },
  { surahNumber: 71, nameEnglish: 'Nooh', nameArabic: 'نوح' },
  { surahNumber: 72, nameEnglish: 'Al-Jinn', nameArabic: 'الجن' },
  { surahNumber: 73, nameEnglish: 'Al-Muzzammil', nameArabic: 'المزمل' },
  { surahNumber: 74, nameEnglish: 'Al-Muddaththir', nameArabic: 'المدثر' },
  { surahNumber: 75, nameEnglish: 'Al-Qiyaama', nameArabic: 'القيامة' },
  { surahNumber: 76, nameEnglish: 'Al-Insaan', nameArabic: 'الانسان' },
  { surahNumber: 77, nameEnglish: 'Al-Mursalaat', nameArabic: 'المرسلات' },
  { surahNumber: 78, nameEnglish: 'An-Naba', nameArabic: 'النبإ' },
  { surahNumber: 79, nameEnglish: "An-Naazi'aat", nameArabic: 'النازعات' },
  { surahNumber: 80, nameEnglish: 'Abasa', nameArabic: 'عبس' },
  { surahNumber: 81, nameEnglish: 'At-Takwir', nameArabic: 'التكوير' },
  { surahNumber: 82, nameEnglish: 'Al-Infitaar', nameArabic: 'الإنفطار' },
  { surahNumber: 83, nameEnglish: 'Al-Mutaffifin', nameArabic: 'المطففين' },
  { surahNumber: 84, nameEnglish: 'Al-Inshiqaaq', nameArabic: 'الإنشقاق' },
  { surahNumber: 85, nameEnglish: 'Al-Burooj', nameArabic: 'البروج' },
  { surahNumber: 86, nameEnglish: 'At-Taariq', nameArabic: 'الطارق' },
  { surahNumber: 87, nameEnglish: "Al-A'laa", nameArabic: 'الأعلى' },
  { surahNumber: 88, nameEnglish: 'Al-Ghaashiya', nameArabic: 'الغاشية' },
  { surahNumber: 89, nameEnglish: 'Al-Fajr', nameArabic: 'الفجر' },
  { surahNumber: 90, nameEnglish: 'Al-Balad', nameArabic: 'البلد' },
  { surahNumber: 91, nameEnglish: 'Ash-Shams', nameArabic: 'الشمس' },
  { surahNumber: 92, nameEnglish: 'Al-Lail', nameArabic: 'الليل' },
  { surahNumber: 93, nameEnglish: 'Ad-Dhuhaa', nameArabic: 'الضحى' },
  { surahNumber: 94, nameEnglish: 'Ash-Sharh', nameArabic: 'الشرح' },
  { surahNumber: 95, nameEnglish: 'At-Tin', nameArabic: 'التين' },
  { surahNumber: 96, nameEnglish: 'Al-Alaq', nameArabic: 'العلق' },
  { surahNumber: 97, nameEnglish: 'Al-Qadr', nameArabic: 'القدر' },
  { surahNumber: 98, nameEnglish: 'Al-Bayyina', nameArabic: 'البينة' },
  { surahNumber: 99, nameEnglish: 'Az-Zalzala', nameArabic: 'الزلزلة' },
  { surahNumber: 100, nameEnglish: 'Al-Aadiyaat', nameArabic: 'العاديات' },
  { surahNumber: 101, nameEnglish: "Al-Qaari'a", nameArabic: 'القارعة' },
  { surahNumber: 102, nameEnglish: 'At-Takaathur', nameArabic: 'التكاثر' },
  { surahNumber: 103, nameEnglish: 'Al-Asr', nameArabic: 'العصر' },
  { surahNumber: 104, nameEnglish: 'Al-Humaza', nameArabic: 'الهمزة' },
  { surahNumber: 105, nameEnglish: 'Al-Fil', nameArabic: 'الفيل' },
  { surahNumber: 106, nameEnglish: 'Quraish', nameArabic: 'قريش' },
  { surahNumber: 107, nameEnglish: "Al-Maa'un", nameArabic: 'الماعون' },
  { surahNumber: 108, nameEnglish: 'Al-Kawthar', nameArabic: 'الكوثر' },
  { surahNumber: 109, nameEnglish: 'Al-Kaafiroon', nameArabic: 'الكافرون' },
  { surahNumber: 110, nameEnglish: 'An-Nasr', nameArabic: 'النصر' },
  { surahNumber: 111, nameEnglish: 'Al-Masad', nameArabic: 'المسد' },
  { surahNumber: 112, nameEnglish: 'Al-Ikhlaas', nameArabic: 'الإخلاص' },
  { surahNumber: 113, nameEnglish: 'Al-Falaq', nameArabic: 'الفلق' },
  { surahNumber: 114, nameEnglish: 'An-Naas', nameArabic: 'الناس' },
];

/** The verified English/Arabic name pair for a canonical surah number (1-114). Throws for anything else — never returns a fabricated/blank name. */
export function getSurahName(surahNumber: number): SurahName {
  const surah = SURAH_NAMES[surahNumber - 1];

  if (!surah || surah.surahNumber !== surahNumber) {
    throw new Error(`"${surahNumber}" is not a valid surah number.`);
  }

  return surah;
}

/** Exposed for tests/tooling that need to iterate every surah (e.g. verifying all 114 are present and well-formed) — never mutated by callers. */
export function getAllSurahNames(): readonly SurahName[] {
  return SURAH_NAMES;
}
