// The 16 Quran Heals reciters (exactly, in the approved order) and the MP3Quran recording chosen for each.
// reciterId / moshafId: https://www.mp3quran.net/api/v3/reciters. useTiming: whether the recording's
// https://www.mp3quran.net/api/v3/ayat_timing read (same id as the moshaf) is used at all; timingRejected says why not.
export const RECITERS = [
  { id: 'abdulbasit', nameEn: 'Abdul Basit Abdus Samad', nameAr: 'عبد الباسط عبد الصمد', reciterId: 51, moshafId: 53, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  { id: 'minshawi', nameEn: 'Muhammad Siddiq Al-Minshawi', nameAr: 'محمد صديق المنشاوي', reciterId: 112, moshafId: 112, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  { id: 'naina', nameEn: 'Ahmed Naeena', nameAr: 'أحمد نعينع', reciterId: 9, moshafId: 9, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  { id: 'husary', nameEn: 'Mahmoud Khalil Al-Husary', nameAr: 'محمود خليل الحصري', reciterId: 118, moshafId: 118, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  // The Hafs murattal (121) has no timing; the mujawwad's timing (122) does not match its audio (acoustic check).
  { id: 'banna', nameEn: 'Mahmoud Ali Al-Banna', nameAr: 'محمود علي البنا', reciterId: 121, moshafId: 121, style: 'murattal', riwayaLabel: 'hafs', useTiming: false, timingRejected: 'MP3Quran has no ayah timing for the Hafs murattal (121); the mujawwad timing (122) does not match its audio' },
  { id: 'yasser-salama', nameEn: 'Yasser Mahmoud Salama', nameAr: 'ياسر محمود سلامة', reciterId: 152, moshafId: 152, style: 'murattal', riwayaLabel: 'hafs', useTiming: false, timingRejected: 'MP3Quran has no ayah timing for this recording' },
  { id: 'shuraim', nameEn: 'Saud Al-Shuraim', nameAr: 'سعود الشريم', reciterId: 31, moshafId: 31, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  { id: 'sufi', nameEn: 'Abdul Rashid Ali Sufi', nameAr: 'عبد الرشيد علي صوفي', reciterId: 64, moshafId: 258, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  { id: 'hudhaifi', nameEn: 'Ali Al-Hudhaifi', nameAr: 'علي الحذيفي', reciterId: 74, moshafId: 74, style: 'murattal', riwayaLabel: 'hafs', useTiming: false, timingRejected: 'MP3Quran timing for this recording is one ayah short in 112 surahs and misaligned with the audio' },
  { id: 'shatri', nameEn: 'Abu Bakr Al-Shatri', nameAr: 'أبو بكر الشاطري', reciterId: 4, moshafId: 4, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  { id: 'ajmi', nameEn: 'Ahmed Al-Ajmi', nameAr: 'أحمد العجمي', reciterId: 5, moshafId: 5, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  // The Hafs murattal (102) has no timing; the mujawwad (133) is used: MP3Quran labels it "المصحف المجود" only.
  { id: 'maher', nameEn: 'Maher Al-Muaiqly', nameAr: 'ماهر المعيقلي', reciterId: 102, moshafId: 133, style: 'mujawwad', riwayaLabel: 'unlabelled', useTiming: true },
  { id: 'basfar', nameEn: 'Abdullah Basfar', nameAr: 'عبد الله بصفر', reciterId: 60, moshafId: 60, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  { id: 'saleh-talib', nameEn: 'Saleh Al-Talib', nameAr: 'صالح آل طالب', reciterId: 41, moshafId: 41, style: 'murattal', riwayaLabel: 'hafs', useTiming: false, timingRejected: 'MP3Quran has no ayah timing for this recording' },
  { id: 'rifaat', nameEn: 'Muhammad Rifaat', nameAr: 'محمد رفعت', reciterId: 241, moshafId: 241, style: 'murattal', riwayaLabel: 'hafs', useTiming: false, timingRejected: 'MP3Quran has no ayah timing for this recording' },
  { id: 'islam-sobhi', nameEn: 'Islam Sobhi', nameAr: 'إسلام صبحي', reciterId: 253, moshafId: 253, style: 'murattal', riwayaLabel: 'hafs', useTiming: false, timingRejected: 'MP3Quran has no ayah timing for this recording' },
];
