// The 17 Quran Heals reciters (exactly, in the approved order) and the MP3Quran recording chosen for each.
// noRecording: a reciter with no recording in the app (reciterId / moshafId null), and why.
// reciterId / moshafId: https://www.mp3quran.net/api/v3/reciters. useTiming: whether the recording's
// https://www.mp3quran.net/api/v3/ayat_timing read (same id as the moshaf) is used at all; timingRejected says why not.
// measure: where MP3Quran's timing is not used, per-ayah files of the same recording from which refine-results.mjs
// measures timing for the MP3Quran file (audit/align_everyayah.py; the app streams only the MP3Quran file).
export const RECITERS = [
  { id: 'abdulbasit', nameEn: 'Abdul Basit Abdus Samad', nameAr: 'عبد الباسط عبد الصمد', reciterId: 51, moshafId: 53, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  { id: 'minshawi', nameEn: 'Muhammad Siddiq Al-Minshawi', nameAr: 'محمد صديق المنشاوي', reciterId: 112, moshafId: 112, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  { id: 'naina', nameEn: 'Ahmed Naeena', nameAr: 'أحمد نعينع', reciterId: 9, moshafId: 9, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  { id: 'husary', nameEn: 'Mahmoud Khalil Al-Husary', nameAr: 'محمود خليل الحصري', reciterId: 118, moshafId: 118, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  // The Hafs murattal (121) has no timing; the mujawwad's timing (122) does not match its audio (acoustic check).
  { id: 'banna', nameEn: 'Mahmoud Ali Al-Banna', nameAr: 'محمود علي البنا', reciterId: 121, moshafId: 121, style: 'murattal', riwayaLabel: 'hafs', useTiming: false, timingRejected: 'MP3Quran has no ayah timing for the Hafs murattal (121); the mujawwad timing (122) does not match its audio', measure: { reference: 'https://everyayah.com/data/mahmoud_ali_al_banna_32kbps/' } },
  { id: 'yasser-salama', nameEn: 'Yasser Mahmoud Salama', nameAr: 'ياسر محمود سلامة', reciterId: 152, moshafId: 152, style: 'murattal', riwayaLabel: 'hafs', useTiming: false, timingRejected: 'MP3Quran has no ayah timing for this recording' },
  { id: 'shuraim', nameEn: 'Saud Al-Shuraim', nameAr: 'سعود الشريم', reciterId: 31, moshafId: 31, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  { id: 'sufi', nameEn: 'Abdul Rashid Ali Sufi', nameAr: 'عبد الرشيد علي صوفي', reciterId: 64, moshafId: 258, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  // EveryAyah's Hudhaify_128kbps is cut from this recording (every ayah located in the MP3Quran file).
  { id: 'hudhaifi', nameEn: 'Ali Al-Hudhaifi', nameAr: 'علي الحذيفي', reciterId: 74, moshafId: 74, style: 'murattal', riwayaLabel: 'hafs', useTiming: false, timingRejected: 'MP3Quran timing for this recording is one ayah short in 112 surahs and misaligned with the audio', measure: { reference: 'https://everyayah.com/data/Hudhaify_128kbps/' } },
  { id: 'shatri', nameEn: 'Abu Bakr Al-Shatri', nameAr: 'أبو بكر الشاطري', reciterId: 4, moshafId: 4, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  { id: 'ajmi', nameEn: 'Ahmed Al-Ajmi', nameAr: 'أحمد العجمي', reciterId: 5, moshafId: 5, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  // The Hafs murattal (102) has no timing; the mujawwad (133) is used: MP3Quran labels it "المصحف المجود" only.
  { id: 'maher', nameEn: 'Maher Al-Muaiqly', nameAr: 'ماهر المعيقلي', reciterId: 102, moshafId: 133, style: 'mujawwad', riwayaLabel: 'unlabelled', useTiming: true },
  { id: 'basfar', nameEn: 'Abdullah Basfar', nameAr: 'عبد الله بصفر', reciterId: 60, moshafId: 60, style: 'murattal', riwayaLabel: 'hafs', useTiming: true },
  { id: 'saleh-talib', nameEn: 'Saleh Al-Talib', nameAr: 'صالح آل طالب', reciterId: 41, moshafId: 41, style: 'murattal', riwayaLabel: 'hafs', useTiming: false, timingRejected: 'MP3Quran has no ayah timing for this recording' },
  { id: 'rifaat', nameEn: 'Muhammad Rifaat', nameAr: 'محمد رفعت', reciterId: 241, moshafId: 241, style: 'murattal', riwayaLabel: 'hafs', useTiming: false, timingRejected: 'MP3Quran has no ayah timing for this recording' },
  { id: 'islam-sobhi', nameEn: 'Islam Sobhi', nameAr: 'إسلام صبحي', reciterId: 253, moshafId: 253, style: 'murattal', riwayaLabel: 'hafs', useTiming: false, timingRejected: 'MP3Quran has no ayah timing for this recording' },
  // Added 2026-10-17 (the 17th). Not on MP3Quran, EveryAyah, Quran Foundation or quranicaudio.com. Assabile has a full
  // Hafs murattal (114 surahs, 32 kbps), with no ayah timing and no published permission for use in an app.
  { id: 'ahmed-salama', nameEn: 'Ahmed Mohamed Salama', nameAr: 'أحمد محمد سلامة', reciterId: null, moshafId: null, style: 'murattal', riwayaLabel: null, useTiming: false, noRecording: 'Only recording found (Assabile, 114 surahs, Hafs murattal, 32 kbps): no ayah timing or per-ayah files exist for it, and Assabile publishes no permission for use in an app' },
];
