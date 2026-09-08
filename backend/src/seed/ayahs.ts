import type { SeedAyah } from './types';

const quranTextSource =
  'Development seed checked against Quran.com/Tanzil Uthmani-script references; formal production verification required';
const quranComContentApiSource =
  'Quran.com Content API v4 text_uthmani, verified 2026-09-08; formal production verification required';
const translationSource = 'Marmaduke Pickthall, The Meaning of the Glorious Koran (1930), public domain';

export const seedAyahs: SeedAyah[] = [
  {
    referenceKey: '2:153',
    surahNumber: 2,
    surahNameArabic: 'البقرة',
    surahNameEnglish: 'Al-Baqarah',
    ayahNumber: 153,
    arabicText:
      'يَـٰٓأَيُّهَا ٱلَّذِينَ ءَامَنُوا۟ ٱسْتَعِينُوا۟ بِٱلصَّبْرِ وَٱلصَّلَوٰةِ ۚ إِنَّ ٱللَّهَ مَعَ ٱلصَّـٰبِرِينَ',
    englishTranslation:
      'O ye who believe! Seek help in steadfastness, and prayer. Lo! Allah is with the steadfast.',
    emotions: ['sad', 'anxious', 'stressed', 'tired'],
    quranTextSource,
    translationSource,
  },
  {
    referenceKey: '2:286',
    surahNumber: 2,
    surahNameArabic: 'البقرة',
    surahNameEnglish: 'Al-Baqarah',
    ayahNumber: 286,
    arabicText:
      'لَا يُكَلِّفُ ٱللَّهُ نَفْسًا إِلَّا وُسْعَهَا ۚ لَهَا مَا كَسَبَتْ وَعَلَيْهَا مَا ٱكْتَسَبَتْ ۗ رَبَّنَا لَا تُؤَاخِذْنَآ إِن نَّسِينَآ أَوْ أَخْطَأْنَا ۚ رَبَّنَا وَلَا تَحْمِلْ عَلَيْنَآ إِصْرًۭا كَمَا حَمَلْتَهُۥ عَلَى ٱلَّذِينَ مِن قَبْلِنَا ۚ رَبَّنَا وَلَا تُحَمِّلْنَا مَا لَا طَاقَةَ لَنَا بِهِۦ ۖ وَٱعْفُ عَنَّا وَٱغْفِرْ لَنَا وَٱرْحَمْنَآ ۚ أَنتَ مَوْلَىٰنَا فَٱنصُرْنَا عَلَى ٱلْقَوْمِ ٱلْكَـٰفِرِينَ',
    englishTranslation:
      'Allah tasketh not a soul beyond its scope. For it (is only) that which it hath earned, and against it (only) that which it hath deserved. Our Lord! Condemn us not if we forget, or miss the mark! Our Lord! Lay not on us such a burden as Thou didst lay on those before us! Our Lord! Impose not on us that which we have not the strength to bear! Pardon us, absolve us and have mercy on us, Thou, our Protector, and give us victory over the disbelieving folk.',
    emotions: ['anxious', 'stressed', 'tired', 'hopeless'],
    quranTextSource,
    translationSource,
  },
  {
    referenceKey: '3:134',
    surahNumber: 3,
    surahNameArabic: 'آل عمران',
    surahNameEnglish: "Ali 'Imran",
    ayahNumber: 134,
    arabicText:
      'ٱلَّذِينَ يُنفِقُونَ فِى ٱلسَّرَّآءِ وَٱلضَّرَّآءِ وَٱلْكَـٰظِمِينَ ٱلْغَيْظَ وَٱلْعَافِينَ عَنِ ٱلنَّاسِ ۗ وَٱللَّهُ يُحِبُّ ٱلْمُحْسِنِينَ',
    englishTranslation:
      'Those who spend (of that which Allah hath given them) in ease and in adversity, those who control their wrath and are forgiving toward mankind; Allah loveth the good;',
    emotions: ['angry'],
    quranTextSource: quranComContentApiSource,
    translationSource,
  },
  {
    referenceKey: '7:199',
    surahNumber: 7,
    surahNameArabic: 'الأعراف',
    surahNameEnglish: "Al-A'raf",
    ayahNumber: 199,
    arabicText: 'خُذِ ٱلْعَفْوَ وَأْمُرْ بِٱلْعُرْفِ وَأَعْرِضْ عَنِ ٱلْجَـٰهِلِينَ',
    englishTranslation: 'Keep to forgiveness (O Muhammad), and enjoin kindness, and turn away from the ignorant.',
    emotions: ['angry'],
    quranTextSource: quranComContentApiSource,
    translationSource,
  },
  {
    referenceKey: '9:40',
    surahNumber: 9,
    surahNameArabic: 'التوبة',
    surahNameEnglish: 'At-Tawbah',
    ayahNumber: 40,
    arabicText:
      'إِلَّا تَنصُرُوهُ فَقَدْ نَصَرَهُ ٱللَّهُ إِذْ أَخْرَجَهُ ٱلَّذِينَ كَفَرُوا۟ ثَانِىَ ٱثْنَيْنِ إِذْ هُمَا فِى ٱلْغَارِ إِذْ يَقُولُ لِصَـٰحِبِهِۦ لَا تَحْزَنْ إِنَّ ٱللَّهَ مَعَنَا ۖ فَأَنزَلَ ٱللَّهُ سَكِينَتَهُۥ عَلَيْهِ وَأَيَّدَهُۥ بِجُنُودٍ لَّمْ تَرَوْهَا وَجَعَلَ كَلِمَةَ ٱلَّذِينَ كَفَرُوا۟ ٱلسُّفْلَىٰ ۗ وَكَلِمَةُ ٱللَّهِ هِىَ ٱلْعُلْيَا ۗ وَٱللَّهُ عَزِيزٌ حَكِيمٌ',
    englishTranslation:
      "If ye help him not, still Allah helped him when those who disbelieve drove him forth, the second of two; when they two were in the cave, when he said unto his comrade: Grieve not. Lo! Allah is with us. Then Allah caused His peace of reassurance to descend upon him and supported him with hosts ye cannot see, and made the word of those who disbelieved the nethermost, while Allah's word it was that became the uppermost. Allah is Mighty, Wise.",
    emotions: ['sad', 'afraid', 'lonely'],
    quranTextSource,
    translationSource,
  },
  {
    referenceKey: '13:28',
    surahNumber: 13,
    surahNameArabic: 'الرعد',
    surahNameEnglish: "Ar-Ra'd",
    ayahNumber: 28,
    arabicText:
      'ٱلَّذِينَ ءَامَنُوا۟ وَتَطْمَئِنُّ قُلُوبُهُم بِذِكْرِ ٱللَّهِ ۗ أَلَا بِذِكْرِ ٱللَّهِ تَطْمَئِنُّ ٱلْقُلُوبُ',
    englishTranslation:
      'Who have believed and whose hearts have rest in the remembrance of Allah. Verily in the remembrance of Allah do hearts find rest!',
    emotions: ['anxious', 'stressed', 'peaceful', 'grateful'],
    quranTextSource,
    translationSource,
  },
  {
    referenceKey: '26:62',
    surahNumber: 26,
    surahNameArabic: 'الشعراء',
    surahNameEnglish: "Ash-Shu'ara",
    ayahNumber: 62,
    arabicText: 'قَالَ كَلَّآ ۖ إِنَّ مَعِىَ رَبِّى سَيَهْدِينِ',
    englishTranslation: 'He said: Nay, verily! for lo! my Lord is with me. He will guide me.',
    emotions: ['afraid', 'lost', 'confused'],
    quranTextSource,
    translationSource,
  },
  {
    referenceKey: '39:53',
    surahNumber: 39,
    surahNameArabic: 'الزمر',
    surahNameEnglish: 'Az-Zumar',
    ayahNumber: 53,
    arabicText:
      'قُلْ يَـٰعِبَادِىَ ٱلَّذِينَ أَسْرَفُوا۟ عَلَىٰٓ أَنفُسِهِمْ لَا تَقْنَطُوا۟ مِن رَّحْمَةِ ٱللَّهِ ۚ إِنَّ ٱللَّهَ يَغْفِرُ ٱلذُّنُوبَ جَمِيعًا ۚ إِنَّهُۥ هُوَ ٱلْغَفُورُ ٱلرَّحِيمُ',
    englishTranslation:
      'Say: My slaves who have been prodigal to their own hurt! Despair not of the mercy of Allah, Who forgiveth all sins. Lo! He is the Forgiving, the Merciful.',
    emotions: ['hopeless', 'sad', 'lost'],
    quranTextSource,
    translationSource,
  },
  {
    referenceKey: '41:34',
    surahNumber: 41,
    surahNameArabic: 'فصلت',
    surahNameEnglish: 'Fussilat',
    ayahNumber: 34,
    arabicText:
      'وَلَا تَسْتَوِى ٱلْحَسَنَةُ وَلَا ٱلسَّيِّئَةُ ۚ ٱدْفَعْ بِٱلَّتِى هِىَ أَحْسَنُ فَإِذَا ٱلَّذِى بَيْنَكَ وَبَيْنَهُۥ عَدَٰوَةٌ كَأَنَّهُۥ وَلِىٌّ حَمِيمٌ',
    englishTranslation:
      'The good deed and the evil deed are not alike. Repel the evil deed with one which is better, then lo! he, between whom and thee there was enmity (will become) as though he was a bosom friend.',
    emotions: ['angry'],
    quranTextSource: quranComContentApiSource,
    translationSource,
  },
  {
    referenceKey: '42:37',
    surahNumber: 42,
    surahNameArabic: 'الشورى',
    surahNameEnglish: 'Ash-Shuraa',
    ayahNumber: 37,
    arabicText:
      'وَٱلَّذِينَ يَجْتَنِبُونَ كَبَـٰٓئِرَ ٱلْإِثْمِ وَٱلْفَوَٰحِشَ وَإِذَا مَا غَضِبُوا۟ هُمْ يَغْفِرُونَ',
    englishTranslation: 'And those who shun the worst of sins and indecencies and, when they are wroth, forgive,',
    emotions: ['angry'],
    quranTextSource: quranComContentApiSource,
    translationSource,
  },
  {
    referenceKey: '65:3',
    surahNumber: 65,
    surahNameArabic: 'الطلاق',
    surahNameEnglish: 'At-Talaq',
    ayahNumber: 3,
    arabicText:
      'وَيَرْزُقْهُ مِنْ حَيْثُ لَا يَحْتَسِبُ ۚ وَمَن يَتَوَكَّلْ عَلَى ٱللَّهِ فَهُوَ حَسْبُهُۥٓ ۚ إِنَّ ٱللَّهَ بَـٰلِغُ أَمْرِهِۦ ۚ قَدْ جَعَلَ ٱللَّهُ لِكُلِّ شَىْءٍۢ قَدْرًۭا',
    englishTranslation:
      'And will provide for him from (a quarter) whence he hath no expectation. And whosoever putteth his trust in Allah, He will suffice him. Lo! Allah bringeth His command to pass. Allah hath set a measure for all things.',
    emotions: ['afraid', 'anxious', 'lost'],
    quranTextSource,
    translationSource,
  },
  {
    referenceKey: '93:3',
    surahNumber: 93,
    surahNameArabic: 'الضحى',
    surahNameEnglish: 'Ad-Duha',
    ayahNumber: 3,
    arabicText: 'مَا وَدَّعَكَ رَبُّكَ وَمَا قَلَىٰ',
    englishTranslation: 'Thy Lord hath not forsaken thee nor doth He hate thee,',
    emotions: ['lonely', 'sad', 'hopeless'],
    quranTextSource,
    translationSource,
  },
  {
    referenceKey: '93:4',
    surahNumber: 93,
    surahNameArabic: 'الضحى',
    surahNameEnglish: 'Ad-Duha',
    ayahNumber: 4,
    arabicText: 'وَلَلْآخِرَةُ خَيْرٌ لَكَ مِنَ الْأُولَىٰ',
    englishTranslation: 'And verily the latter portion will be better for thee than the former',
    emotions: ['hopeless', 'lost'],
    quranTextSource,
    translationSource,
  },
  {
    referenceKey: '93:5',
    surahNumber: 93,
    surahNameArabic: 'الضحى',
    surahNameEnglish: 'Ad-Duha',
    ayahNumber: 5,
    arabicText: 'وَلَسَوْفَ يُعْطِيكَ رَبُّكَ فَتَرْضَىٰ',
    englishTranslation: 'And verily thy Lord will give unto thee so that thou wilt be content.',
    emotions: ['grateful', 'peaceful', 'hopeless'],
    quranTextSource,
    translationSource,
  },
  {
    referenceKey: '94:5',
    surahNumber: 94,
    surahNameArabic: 'الشرح',
    surahNameEnglish: 'Ash-Sharh',
    ayahNumber: 5,
    arabicText: 'فَإِنَّ مَعَ ٱلْعُسْرِ يُسْرًا',
    englishTranslation: 'But lo! with hardship goeth ease,',
    emotions: ['sad', 'stressed', 'tired'],
    quranTextSource,
    translationSource,
  },
  {
    referenceKey: '94:6',
    surahNumber: 94,
    surahNameArabic: 'الشرح',
    surahNameEnglish: 'Ash-Sharh',
    ayahNumber: 6,
    arabicText: 'إِنَّ مَعَ ٱلْعُسْرِ يُسْرًۭا',
    englishTranslation: 'Lo! with hardship goeth ease;',
    emotions: ['sad', 'stressed', 'tired', 'peaceful'],
    quranTextSource,
    translationSource,
  },
];
