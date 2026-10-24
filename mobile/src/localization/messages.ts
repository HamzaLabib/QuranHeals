import type { AppLocale } from './locales';

/**
 * Current, user-visible mobile interface strings only. Explicitly excluded
 * (never localized here): Quran Arabic text, the Pickthall translation
 * text, technical/debug messages, verse keys, and stable internal emotion
 * keys — all of those come from verified data assets/the API, never from
 * this dictionary.
 */
export type Messages = {
  appName: string;
  home: {
    /** The tagline («شفاءٌ لما في الصدور»): shown above the emotions question, in the eyebrow style. */
    subtitle: string;
    /** «عِشْ بالقرآن»: shown under the app's name, in the subtitle style. */
    eyebrow: string;
    title: string;
    loadingTitle: string;
    loadingMessage: string;
    errorTitle: string;
    retry: string;
    disclaimer: string;
    /** The small Quran-sources line at the bottom of Home (credits required by Tanzil and Quran Foundation). */
    sourcesCredit: string;
    /** Opens /credits. */
    sourcesLink: string;
    /** Home header: the Favorites screen (Reflections and أورادي وختماتي are tabs). */
    openFavorites: string;
  };
  /**
   * The general Quran flow's single home-screen action — completely
   * separate from the 29-emotion mapping system (no emotionKey involved).
   * One tappable label, not a heading+button pair. General UI text: ar-EG
   * uses this same Standard Arabic wording, not Egyptian colloquial.
   */
  generalQuran: {
    action: string;
    loadError: string;
  };
  ayah: {
    kicker: string;
    goBack: string;
    loadingTitle: string;
    loadingMessage: string;
    errorTitle: string;
    retry: string;
    missingEmotion: string;
    genericError: string;
    historyUnresolved: string;
    historyReadFailed: string;
    historySaveFailed: string;
    share: string;
    shareAyah: string;
    anotherAyah: string;
    loadAnotherAyah: string;
    /** Heading of the collapsible "why this ayah for this feeling" section. Its body comes from the emotion–ayah mapping, never from here. */
    connectionHeading: string;
    /** Deep-links to this exact ayah on tanzil.net in the device's browser — see utils/tanzilLink.ts. */
    readInQuran: string;
    /** Accessibility label for the copy-ayah-text icon on AyahCard — the visible control is icon-only. */
    copyAyah: string;
    /** A shared ayah link that points to no real ayah. */
    invalidLink: string;
  };
  favorites: {
    title: string;
    subtitle: string;
    loadingTitle: string;
    loadingMessage: string;
    errorTitle: string;
    retry: string;
    emptyTitle: string;
    emptyMessage: string;
    unresolvedSuffix: string;
    share: string;
    shareSaved: string;
    remove: string;
    removeSaved: string;
  };
  favoriteButton: {
    save: string;
    saved: string;
    saveLabel: string;
    removeLabel: string;
  };
  /**
   * The dedicated "My Reflections" list screen — separate from the singular
   * `reflection` editor strings above (ReflectionSheet), which this screen
   * reuses unchanged rather than duplicating.
   */
  reflections: {
    title: string;
    subtitle: string;
    loadingTitle: string;
    loadingMessage: string;
    emptyTitle: string;
    emptyMessage: string;
    errorTitle: string;
    errorMessage: string;
    retry: string;
    referenceUnresolved: string;
    editedLabel: string;
    statusSavedOnDevice: string;
    statusPendingSync: string;
    statusSynced: string;
    openReflectionLabel: string;
    otherVersionBadge: string;
    recoveredBadge: string;
  };
  translation: {
    showTranslation: string;
    hideTranslation: string;
  };
  /** The Share Ayah sheet (ShareAyahSheet). The image card itself is not localized — see ShareAyahCard. */
  share: {
    title: string;
    close: string;
    preview: string;
    /** Accessibility prefix for the "2 / 3" card counter. */
    card: string;
    previousCard: string;
    nextCard: string;
    longAyahNote: string;
    format: string;
    formatStory: string;
    formatPost: string;
    formatSquare: string;
    background: string;
    themeSage: string;
    themeCream: string;
    themeDark: string;
    /** Background categories: the solid Colors themes, and the Scenery photographs. */
    backgroundColors: string;
    backgroundScenery: string;
    /** Scenery: shows a different photograph. */
    newBackground: string;
    sceneryLoadFailed: string;
    showTranslation: string;
    share: string;
    shareAllCards: string;
    saveImage: string;
    saveAllImages: string;
    /** Several cards, but this binary can only share one file at a time. */
    multipleUnavailable: string;
    copyLink: string;
    linkCopied: string;
    /** Shown after Share image / Share all cards, which copy the link automatically. */
    linkAutoCopied: string;
    copyLinkFailed: string;
    /** Why the link is separate from the image, and where to use it. */
    linkHint: string;
    preparing: string;
    saved: string;
    savedAll: string;
    saveDenied: string;
    saveBlocked: string;
    openSettings: string;
    shareUnavailable: string;
    shareFailed: string;
    saveFailed: string;
    cannotFit: string;
  };
  /** The /mushaf prototype (phase 1). Printed-page furniture (juz' title, page number) is not localized. */
  mushaf: {
    title: string;
    prototypeNote: string;
    tapHint: string;
    pageLabel: string;
    selectedAyah: string;
    clearSelection: string;
    readingStops: string;
    stopNameLabel: string;
    saveStop: string;
    stopSaved: string;
    stopNameInvalid: string;
    tooManyStops: string;
    stopSaveFailed: string;
    noStops: string;
    page: string;
    removeStop: string;
    renameStop: string;
    saveName: string;
    cancelRename: string;
    stopRenamed: string;
    stopNameTaken: string;
    offlineTitle: string;
    offlineIntro: string;
    offlineDownload: string;
    offlineResume: string;
    offlineCancel: string;
    offlineDownloading: string;
    offlineVerifying: string;
    offlineReady: string;
    offlineUpdatedFrom: string;
    offlineCheckUpdate: string;
    offlineUpToDate: string;
    offlineUpdated: string;
    offlineRemove: string;
    offlineCancelled: string;
    offlineErrorOffline: string;
    offlineErrorUnavailable: string;
    offlineErrorStorage: string;
    offlineErrorIntegrity: string;
    offlineErrorGeneric: string;
    offlineFonts: string;
    offlineFontsCount: string;
    offlineComplete: string;
    /** Automatic download (mushaf/offline/autoDownload.ts): the tab bar's indicator and the mobile-data question. */
    autoPreparing: string;
    autoReady: string;
    autoConsentCellular: string;
    autoConsentUnknown: string;
    autoDownloadNow: string;
    autoWaitForWifi: string;
    autoNotNow: string;
    offlinePause: string;
    offlineRetry: string;
    offlinePaused: string;
    offlineWaitingWifi: string;
    offlineWaitingNetwork: string;
    offlineRetrying: string;
    previousPage: string;
    nextPage: string;
    searchPage: string;
    pageNumberPlaceholder: string;
    goToPage: string;
    pageOutOfRange: string;
    /** The reading-stop (ورد) list's title; also the selector's label when no stop is active. */
    /** The reader's top-right Expand / Collapse buttons (icon-only; spoken labels). */
    enterFullScreen: string;
    exitFullScreen: string;
    wirdChoose: string;
    /** Spoken before the active stop's name. */
    wirdSelectorLabel: string;
    wirdSelectorHint: string;
    /** The selector when no stops exist: opens the save field. */
    wirdAdd: string;
    wirdNew: string;
    wirdClose: string;
    /** The 2026-10-14 navigation: Surah / juz' / Hizb selectors, the page selector, the ayah and separator popups. */
    navSurahTitle: string;
    navJuzTitle: string;
    navHizbTitle: string;
    juzSearchPlaceholder: string;
    hizbSearchPlaceholder: string;
    juzName: string;
    hizbName: string;
    divisionNoResults: string;
    openSurahs: string;
    openJuz: string;
    openHizb: string;
    openPageSelector: string;
    pageSlider: string;
    goToSelected: string;
    editPage: string;
    /** The page selector's Go button, beside the arrow while a page is typed. */
    goToPageShort: string;
    /** The first-time Mushaf guide (mushaf/mushafGuide.ts): its six steps, its buttons, its counter ({n}, {total}). */
    guideSurah: string;
    guideHizb: string;
    guidePage: string;
    guideJuz: string;
    guideAyah: string;
    guideMarker: string;
    guideNext: string;
    guideBack: string;
    guideClose: string;
    guideStart: string;
    guideStepOf: string;
    /** When the step's control is not on this page (e.g. a page with no Hizb mark). */
    guideNotOnPage: string;
    /** The reader's Help button: the guide again. */
    guideHelp: string;
    /** The last step's closing line, above Start Reading: where the guide can be opened again. */
    guideReopenHint: string;
    /** The Done bar above the iOS number pad. */
    keyboardDone: string;
    actionReflection: string;
    actionSave: string;
    actionSaved: string;
    /** The ayah popup's Copy: the ayah's verified Arabic text only, and its brief confirmation. */
    actionCopy: string;
    actionCopied: string;
    actionCopyFailed: string;
    applyToWird: string;
    searchTitle: string;
    searchByPage: string;
    searchBySurah: string;
    surahSearchPlaceholder: string;
    surahNoResults: string;
    /** The visible Go button of the page-number search. */
    goAction: string;
    /** Before a page number in lists: "Page 50". */
    pageShort: string;
    saveStopAction: string;
    confirmStop: string;
    pageNotDownloaded: string;
    pageUnavailable: string;
    renderer: string;
    rendererQpc: string;
    rendererSvg: string;
    qpcLoading: string;
    qpcUnavailable: string;
    pageLoadError: string;
  };

  /**
   * /credits: the full acknowledgments for the Quran text and the Mushaf,
   * with the official sites and terms (see docs/mushaf.md, "Authorization
   * and terms"). Source names stay as their owners publish them.
   */
  khatmDua: {
    /** Always Arabic: the screen's name. */
    title: string;
    /** Opened by URL before a verified text is approved. */
    unavailable: string;
    smaller: string;
    larger: string;
    /** The link on page 604. */
    open: string;
    back: string;
  };
  /** The four bottom tabs (app/(tabs)/_layout.tsx). */
  tabs: {
    home: string;
    /** The full emotion list (/emotions). */
    howIFeel: string;
    mushaf: string;
    myReading: string;
    reflections: string;
  };
  /** Home's first section. Placeholders: {page}, {total}, {name}. */
  continueReading: {
    title: string;
    mushaf: string;
    myReading: string;
    pageOf: string;
    activeWird: string;
    lastSaved: string;
    /** The ورد menu opened from the name (two or more Wirds): its title, and the name's screen-reader hint. */
    chooseWird: string;
    switchHint: string;
    firstTitle: string;
    firstBody: string;
  };
  /** Home's "View All" and the page of every emotion (/emotions). */
  emotionsAll: {
    viewAll: string;
    title: string;
    /** Under the title («وتطمئن القلوب»). */
    subtitle: string;
    back: string;
  };
  /** أورادي وختماتي (/my-reading). Placeholders: {page}, {total}, {percent}, {count}, {name}, {year}. */
  myReading: {
    title: string;
    /** Under the title («اقرأ وارتقِ»). */
    subtitle: string;
    back: string;
    statsTotal: string;
    statsRamadan: string;
    wirdsTitle: string;
    newWird: string;
    emptyTitle: string;
    emptyBody: string;
    pageOf: string;
    /** The saved position as a percent of the Mushaf: a position, never a count of pages read. */
    percent: string;
    /** The progress bar's spoken name. */
    positionLabel: string;
    /** Under the statistics: where the data lives, and what position and Khatma mean. */
    /** A guest: saved on this device only. */
    footnote: string;
    /** Signed in: synced across the account's devices. */
    footnoteSynced: string;
    /** Signed in: the sync line under the footnote. */
    syncSyncing: string;
    syncSynced: string;
    syncPending: string;
    khatmaCount: string;
    active: string;
    continue: string;
    rename: string;
    delete: string;
    pendingTitle: string;
    confirm: string;
    unconfirmedTitle: string;
    unconfirmedBody: string;
    recordUnconfirmed: string;
    unconfirmedConfirmTitle: string;
    unconfirmedConfirmBody: string;
    /** أورادي وختماتي's du'a button, in the App Language (the Mushaf's page-604 link is always Arabic: khatmDua.open). */
    duaEntry: string;
    historyTitle: string;
    historyEmpty: string;
    ramadanTag: string;
    nonRamadanTag: string;
    removeKhatma: string;
    removeTitle: string;
    removeBody: string;
    remove: string;
    cancel: string;
    deleteTitle: string;
    deleteBody: string;
    createTitle: string;
    renameTitle: string;
    nameLabel: string;
    startPageLabel: string;
    save: string;
    create: string;
    nameInvalid: string;
    nameTaken: string;
    pageInvalid: string;
    saveFailed: string;
    loadFailed: string;
  };
  /** Completing a Khatma (the reader's prompt and /khatma-complete). */
  khatma: {
    reachedTitle: string;
    confirm: string;
    notNow: string;
    completeTitle: string;
    completeBody: string;
    readDua: string;
    backToKhatmas: string;
    /** The completion screen: the Mushaf, at the completed ورد's new cycle (page 1). */
    backToMushaf: string;
    failed: string;
    /** Mushaf page 604, left of the ورد name, always in Standard Arabic (like the du'a link): opens this sheet's confirmation for the selected ورد when it awaits one. */
    completeAction: string;
    /** …or, when it cannot open the confirmation: a ورد that cannot be completed here, no ورد selected, or the save failing. */
    notReadyTitle: string;
    notReadyBody: string;
    noWirdTitle: string;
    noWirdBody: string;
    /** A cycle just restarted by a confirmed Khatma, nothing saved in it yet: not completable until progress is saved. */
    newCycleTitle: string;
    newCycleBody: string;
    saveFailedTitle: string;
    saveFailedBody: string;
    notReadyOk: string;
  };
  credits: {
    title: string;
    intro: string;
    tanzilName: string;
    tanzilWork: string;
    quranFoundationName: string;
    quranFoundationWork: string;
    kingFahdName: string;
    kingFahdWork: string;
    amiriName: string;
    amiriWork: string;
    mp3quranName: string;
    mp3quranWork: string;
    /** Surah Preview's main purpose (constants/quranSources.ts); shown only in builds that carry its dataset. */
    tafsirCenterName: string;
    tafsirCenterWork: string;
    website: string;
    license: string;
    terms: string;
  };
  quranFontSize: {
    decreaseLabel: string;
    increaseLabel: string;
    auto: string;
    autoLabel: string;
  };
  settings: {
    title: string;
    subtitle: string;
    openSettings: string;
    appLanguageSection: string;
    /** Emotions Language (localization/emotionsLanguage.ts) and its four choices. */
    emotionsLanguageSection: string;
    emotionsFollowApp: string;
    emotionsEnglish: string;
    emotionsArabicStandard: string;
    emotionsArabicEgyptian: string;
    /**
     * Quran Translation's only option today (localization/quranLanguage.ts, mode 'quran-text'): the Arabic Quran text
     * alone, without a translation. The setting's title is quranTranslationSection.
     */
    quranTranslationNone: string;
    /** Keep Screen Awake (mushaf/keepAwakePreference.ts): a local switch, directly below Quran Translation. */
    keepAwakeTitle: string;
    keepAwakeDescription: string;
    /** Word Meanings (mushaf/wordMeaningsVisibilityPreference.ts): a local switch, directly below Keep Screen Awake; shows or hides the Mushaf's المعاني button. */
    wordMeaningsVisibleTitle: string;
    /** Settings → Quran → Mushaf Guide (its title only): opens the Mushaf's six-step guide again, from step 1. */
    mushafGuideTitle: string;
    offlineMushafTitle: string;
    offlineMushafAvailable: string;
    offlineMushafRequired: string;
    offlineMushafDownloading: string;
    offlineMushafFailed: string;
    offlineMushafDownloadHint: string;
    quranTranslationSection: string;
    translationDisplayAlways: string;
    translationDisplayOnDemand: string;
    translationDisplayOff: string;
    translationDisplayAlwaysHint: string;
    translationDisplayOnDemandHint: string;
    translationDisplayOffHint: string;
    quranArabicNote: string;
    /** "Legal & Privacy" section: the public legal pages in the app's language (constants/legalLinks.ts). */
    legalSection: string;
    privacyPolicy: string;
    termsOfUse: string;
    accountDeletionInfo: string;
    /** Accessibility hint: the row opens a web page outside the app. */
    opensInBrowser: string;
    /** The five Settings sections, in order: App, Emotions, Quran, Support (then Account: account.sectionTitle). */
    appSection: string;
    emotionsSection: string;
    quranSection: string;
    supportSection: string;
    /** Show Translation: the stored translation preference (localization/quranTranslationPreference.ts). */
    showTranslationTitle: string;
    showTranslationDescription: string;
    /** Show Translation's dropdown (spoken name) and its two choices. */
    translationModeLabel: string;
    translationModeAlways: string;
    translationModeOnDemand: string;
  };
  /**
   * The three local reminders (notifications/): their Settings rows and the
   * notifications themselves. ar-EG uses the same Modern Standard Arabic as
   * ar (the App Language is never Egyptian Arabic).
   */
  notifications: {
    wirdReminderTitle: string;
    randomAyahTitle: string;
    emotionCheckInTitle: string;
    frequencyLabel: string;
    frequencyDaily: string;
    frequencyEvery3Days: string;
    frequencyWeekly: string;
    frequencyTwiceDaily: string;
    twiceMorning: string;
    twiceEvening: string;
    twiceSameTime: string;
    reminderTimeLabel: string;
    chooseDay: string;
    changeHint: string;
    toggleHint: string;
    timePickerConfirm: string;
    timePickerCancel: string;
    am: string;
    pm: string;
    weekday1: string;
    weekday2: string;
    weekday3: string;
    weekday4: string;
    weekday5: string;
    weekday6: string;
    weekday7: string;
    permissionRequired: string;
    permissionDeniedHint: string;
    permissionAllow: string;
    permissionOpenSettings: string;
    permissionSheetTitle: string;
    permissionSheetBody: string;
    permissionSheetPrivacy: string;
    permissionSheetConfirm: string;
    permissionSheetCancel: string;
    unsupported: string;
    scheduleError: string;
    /** The notifications (lock screen), in the App Language. */
    wirdNotificationTitle: string;
    /** The Wird Reminder without a saved position (no ورد yet, or not known): nothing invented. */
    wirdNotificationBody: string;
    /** With the ورد shown on Home ({name}, exactly as the user typed it, isolated) and its saved page ({page}). */
    wirdNotificationBodyPage: string;
    /** Arabic grammar only: a name that is an Arabic adjective («المسائي») reads «وردك {name}»; any other «ورد {name}». English: as wirdNotificationBodyPage. */
    wirdNotificationBodyPageDefinite: string;
    randomAyahNotificationTitle: string;
    /** The Random Quran Ayah's reference under the verse: {surah} its name, {chapter} its number, {ayah} the ayah's. */
    randomAyahNotificationReference: string;
    checkInNotificationTitle: string;
    checkInNotificationBody: string;
  };
  appearance: {
    sectionLabel: string;
    system: string;
    light: string;
    dark: string;
  };
  auth: {
    syncPrompt: string;
    continueWithoutAccount: string;
    continueWithApple: string;
    continueWithGoogle: string;
    signInFailed: string;
  };
  account: {
    sectionTitle: string;
    /** Shown only while auth status is still 'loading' (session restoration in progress) — never the same as notSignedIn, so a cold start never flashes a guest/sign-in prompt before restoration has actually concluded. */
    checkingSession: string;
    notSignedIn: string;
    signInWithApple: string;
    signInWithGoogle: string;
    signedIn: string;
    signOut: string;
    dangerZoneTitle: string;
    deleteAccountAction: string;
    deleteAccountActionDescription: string;
  };
  /**
   * Self-declared account-age confirmation shown before Apple/Google sign-in
   * (auth/ageConfirmation.ts). Approved wording — en and ar exactly as
   * approved; ar-EG uses the same approved Arabic.
   */
  ageConfirmation: {
    title: string;
    description: string;
    checkbox: string;
    continueButton: string;
    cancel: string;
  };
  /** The permanent account-deletion confirmation sheet — GitHub-style typed confirmation, never auto-submits. */
  deleteAccount: {
    title: string;
    description: string;
    confirmationInstruction: string;
    /** The exact word the user must type (case-sensitive for en) — never accept a partial match. */
    confirmationWord: string;
    placeholder: string;
    deleteButton: string;
    deleting: string;
    cancel: string;
    successMessage: string;
    failureMessage: string;
  };
  reflection: {
    action: string;
    writeAction: string;
    title: string;
    prompt: string;
    placeholder: string;
    guestNote: string;
    syncedNote: string;
    save: string;
    cancel: string;
    deleteAction: string;
    deleteConfirmTitle: string;
    deleteConfirmMessage: string;
    deleteConfirmCancel: string;
    deleteConfirmConfirm: string;
    deleteError: string;
    saveError: string;
    /** Other versions kept by sync when the same reflection changed on two devices (storage/reflectionConflicts.ts). */
    otherVersionsTitle: string;
    otherVersionsHint: string;
    otherVersionThisDevice: string;
    otherVersionOtherDevice: string;
    otherVersionDeletedElsewhere: string;
    useOtherVersion: string;
    addOtherVersion: string;
    copyOtherVersion: string;
    copiedOtherVersion: string;
    discardOtherVersion: string;
    discardOtherVersionTitle: string;
    discardOtherVersionMessage: string;
    otherVersionTooLong: string;
  };
  /** Asked when signing in with favorites/reflections saved on this device as a guest (see GuestDataSheet.tsx). */
  guestData: {
    title: string;
    body: string;
    add: string;
    keepSeparate: string;
  };
  /**
   * The mandatory "Sync Password" gate for synced reflections/favorites
   * (never a skip/cancel — see SyncPassphraseSheet.tsx). Reuses
   * `account.signOut` for the sheet's one way out; no `cancel` key here.
   */
  syncPassphrase: {
    createTitle: string;
    unlockTitle: string;
    createDescription: string;
    unlockDescription: string;
    createPlaceholder: string;
    unlockPlaceholder: string;
    continueLabel: string;
    confirmPassword: string;
    show: string;
    hide: string;
    lengthHint: string;
    allowedHint: string;
    mismatch: string;
    tooShort: string;
    tooLong: string;
    changeTitle: string;
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
    mustDiffer: string;
    incorrectError: string;
    changeDescription: string;
    saveError: string;
    loadError: string;
    retry: string;
    /** Forgotten-password recovery (unlock step only). */
    forgotPassword: string;
    resetTitle: string;
    resetUnrecoverable: string;
    resetCloudLoss: string;
    resetConfirm: string;
    resetBack: string;
    resetError: string;
    resetting: string;
    deleteAccountInstead: string;
    /** Fresh Apple/Google re-authentication before the reset. */
    reauthNoticeApple: string;
    reauthNoticeGoogle: string;
    reauthCancelled: string;
    reauthFailed: string;
    reauthUnavailable: string;
    verifying: string;
  };
  issueReport: {
    action: string;
    description: string;
    categoryAyahNotRelevant: string;
    categoryQuranTextDisplay: string;
    categoryTranslationIssue: string;
    categoryAppTechnicalIssue: string;
    categoryOther: string;
    emailLabel: string;
    submit: string;
    cancel: string;
    done: string;
    successMessage: string;
    failureMessage: string;
    /** The ayah screen's discreet flag action (accessibility label). */
    flagAction: string;
    /** The sheet opened from Settings: general and technical issues, no ayah attached. */
    settingsDescription: string;
    /** Above the reported ayah's reference, so the user sees what is attached. */
    aboutAyah: string;
    commentLabel: string;
    commentRequired: string;
    emailInvalid: string;
  };
  /**
   * Home's Share Feedback action and its feedback sheet:
   * sent through the issue-report endpoint as type 'feedback'. General UI
   * text: ar-EG uses the same Standard Arabic as ar.
   */
  feedback: {
    action: string;
    sheetTitle: string;
    sheetDescription: string;
    messageLabel: string;
    messageRequired: string;
    /** What is (and is never) sent with feedback. */
    privacyNote: string;
    submit: string;
    successMessage: string;
    failureMessage: string;
  };
  syncStatus: {
    savedOnDevice: string;
    syncing: string;
    synced: string;
    syncFailed: string;
  };
  /**
   * Quran audio (audio/): the Mushaf's player, Listen, the ayah screens' play button, and Settings → Favorite Reciter
   * and offline listening. Reciter names come from the reciter catalog (English or Arabic), never from here.
   * Placeholders: {surah}, {ayah}, {reciter}, {n}, {total}, {size}, {percent}, {list}, {done}.
   */
  audio: {
    playPage: string;
    play: string;
    pause: string;
    previousAyah: string;
    nextAyah: string;
    stop: string;
    expand: string;
    collapse: string;
    reciter: string;
    chooseReciter: string;
    upNext: string;
    loading: string;
    buffering: string;
    followRecitation: string;
    ayahPosition: string;
    playingOffline: string;
    ended: string;
    errorUnavailable: string;
    errorNetwork: string;
    errorMismatch: string;
    errorPlayback: string;
    retry: string;
    noticeReciterUnavailable: string;
    dismiss: string;
    coveragePartial: string;
    coverageNone: string;
    nowReciting: string;
    upNextBadge: string;
    notForThisSurah: string;
    listen: string;
    listenHint: string;
    playAyah: string;
    pauseAyah: string;
    replayAyah: string;
    ayahUnavailable: string;
    favoriteTitle: string;
    favoriteDescription: string;
    sourceNote: string;
    offlineTitle: string;
    offlineDescription: string;
    offlineNothing: string;
    offlineNotIncluded: string;
    download: string;
    pauseDownload: string;
    resumeDownload: string;
    cancelDownload: string;
    retryDownload: string;
    deleteDownload: string;
    downloadProgress: string;
    downloadPaused: string;
    downloadCancelled: string;
    downloadComplete: string;
    downloadPartial: string;
    storageTotal: string;
    storedReciter: string;
    wifiTitle: string;
    wifiBody: string;
    wifiConfirm: string;
    wifiCancel: string;
    deleteTitle: string;
    deleteBody: string;
    deleteConfirm: string;
    deleteCancel: string;
    downloadErrorNetwork: string;
    downloadErrorStorage: string;
    downloadErrorVerify: string;
    downloadErrorNotPermitted: string;
    megabytes: string;
    gigabytes: string;
    previousPage: string;
    nextPage: string;
    ayahOnly: string;
    surahProgress: string;
    stopHint: string;
    offlineNotPermitted: string;
    offlineStateNone: string;
    offlineStateDownloading: string;
    offlineStatePaused: string;
    offlineStateComplete: string;
    offlineStateError: string;
    offlineStateUnavailable: string;
    offlineManageHint: string;
    close: string;
    /** Whole-surah playback (a recording with no verified ayah timing): the surah is named, never an ayah. */
    wholeSurah: string;
    wholeSurahNote: string;
    /** Listen on an ayah inside a surah the reciter can only play whole: the choice, never an approximate start. */
    errorSurahOnly: string;
    noticeReciterSurahOnly: string;
    playWholeSurah: string;
    cancel: string;
    /** The stream is no longer the verified file (e.g. redirected to another recording). */
    errorSource: string;
    previousSurah: string;
    nextSurah: string;
    /** The whole-surah position bar: "{elapsed} of {total}". */
    surahPosition: string;
    seekBack: string;
    seekForward: string;
    wholeSurahOnly: string;
    coveragePartialWhole: string;
    /** Development builds only: a per-ayah recording on trial (audio/perAyah.ts), before its coverage line. */
    developmentPreview: string;
    /** The player's Full Surah button: this surah from its first ayah to its last, then stop. */
    fullSurah: string;
    fullSurahHint: string;
    /** Repeat Ayah: the button's spoken label is "{repeatAyah}: {setting}". */
    repeatAyah: string;
    repeatHint: string;
    repeatOff: string;
    repeatOnce: string;
    repeatTwice: string;
    repeatThrice: string;
    repeatInfinite: string;
  };
};

/**
 * The Mushaf's ورد save button: one Arabic wording for ar and ar-EG alike (no Egyptian variant), the ورد's name as saved.
 */
const AR_APPLY_TO_WIRD = "حفظ في {name}";

/** Quran audio in English. */
const EN_AUDIO: Messages['audio'] = {
  playPage: 'Play Audio from This Page',
  play: 'Play',
  pause: 'Pause',
  previousAyah: 'Previous ayah',
  nextAyah: 'Next ayah',
  stop: 'Stop and close the player',
  expand: 'Show player',
  collapse: 'Hide player',
  reciter: 'Reciter',
  chooseReciter: 'Choose a reciter',
  upNext: 'Up next: {reciter}',
  loading: 'Loading…',
  buffering: 'Buffering…',
  followRecitation: 'Follow Along',
  ayahPosition: '{surah} · Ayah {ayah}',
  playingOffline: 'Playing from this device',
  ended: 'Playback Complete',
  errorUnavailable: '{reciter} has no verified recording of Surah {surah}. Choose another reciter.',
  errorNetwork: "The audio couldn't load. Check your connection.",
  errorMismatch: "This audio's ayah timing has changed at the source, so it can't be used until it is verified again.",
  errorPlayback: "This recording couldn't be played on this device.",
  retry: 'Try again',
  noticeReciterUnavailable: '{reciter} has no verified recording of Surah {surah}, so the current reciter continues.',
  dismiss: 'Dismiss',
  coveragePartial: '{n} of 114 surahs',
  coverageNone: 'Ayah-by-ayah playback not available',
  nowReciting: 'Reciting',
  upNextBadge: 'Up next',
  notForThisSurah: 'Not available for this surah',
  listen: 'Listen',
  listenHint: 'Recites from this ayah onward',
  playAyah: 'Play this ayah',
  pauseAyah: 'Pause',
  replayAyah: 'Play again',
  ayahUnavailable: '{reciter} has no verified recording of this surah. You can choose another Favorite Reciter in Settings.',
  favoriteTitle: 'Favorite Reciter',
  favoriteDescription: 'Recites in the Mushaf and on the ayah screens.',
  sourceNote: 'Audio Source: MP3Quran (mp3quran.net)',
  offlineTitle: 'Offline listening',
  offlineDescription: 'Download {reciter} to listen without internet: {n} surahs, about {size}.',
  offlineNothing: "{reciter} has no surahs that can play ayah by ayah, so there's nothing to download.",
  offlineNotIncluded: 'Not included (no verified recording): Surahs {list}',
  download: 'Download',
  pauseDownload: 'Pause',
  resumeDownload: 'Resume',
  cancelDownload: 'Cancel',
  retryDownload: 'Try again',
  deleteDownload: 'Delete',
  downloadProgress: '{done} of {total} surahs · {percent}%',
  downloadPaused: 'Paused · {done} of {total} surahs',
  downloadCancelled: 'Stopped · {done} of {total} surahs downloaded',
  downloadComplete: 'Downloaded: {n} surahs · {size}',
  downloadPartial: 'Partly downloaded: {done} of {total} surahs',
  storageTotal: 'Quran audio on this device: {size}',
  storedReciter: '{reciter}: {n} surahs · {size}',
  wifiTitle: 'Not on Wi-Fi',
  wifiBody: 'This download is about {size}. Wi-Fi is recommended. Download over mobile data anyway?',
  wifiConfirm: 'Download anyway',
  wifiCancel: 'Not now',
  deleteTitle: 'Delete Downloaded Audio?',
  deleteBody: "Removes {reciter}'s downloaded audio ({size}) from this device. You can download it again later.",
  deleteConfirm: 'Delete',
  deleteCancel: 'Keep',
  downloadErrorNetwork: 'The download stopped: no connection.',
  downloadErrorStorage: 'Not enough free space on this device.',
  downloadErrorVerify: "A downloaded file couldn't be verified. Try again.",
  downloadErrorNotPermitted: "Downloads aren't available for this recording.",
  megabytes: '{n} MB',
  gigabytes: '{n} GB',
  previousPage: 'Previous page',
  nextPage: 'Next page',
  ayahOnly: 'Ayah {ayah}',
  surahProgress: 'Ayah {ayah} of {total}',
  stopHint: 'Touch and hold to stop playback.',
  offlineNotPermitted: "Offline downloads aren't available yet: they are waiting for MP3Quran to confirm permission for these recordings. Audio streams as usual.",
  offlineStateNone: 'Not downloaded',
  offlineStateDownloading: 'Downloading',
  offlineStatePaused: 'Download paused',
  offlineStateComplete: 'Downloaded',
  offlineStateError: 'Download stopped',
  offlineStateUnavailable: 'Offline download not available',
  offlineManageHint: 'Shows the offline download for this reciter.',
  close: 'Close',
  wholeSurah: '{surah} · Whole surah',
  wholeSurahNote: "This recording plays as a complete surah. Ayahs aren't followed or highlighted.",
  errorSurahOnly: "{reciter}'s recording of Surah {surah} can only be played complete, from its beginning: it has no verified ayah timing, so it can't start at this ayah.",
  noticeReciterSurahOnly: "{reciter}'s recording of Surah {surah} can only be played complete, from its beginning, so the current reciter continues.",
  playWholeSurah: 'Play the whole surah',
  cancel: 'Cancel',
  errorSource: "This recording no longer matches the verified file at its source, so it isn't played.",
  previousSurah: 'Previous surah',
  nextSurah: 'Next surah',
  surahPosition: '{elapsed} of {total}',
  seekBack: 'Back 15 seconds',
  seekForward: 'Forward 15 seconds',
  wholeSurahOnly: 'Whole surah only',
  coveragePartialWhole: '{n} of 114 surahs · {m} whole only',
  developmentPreview: 'Development preview',
  fullSurah: 'Full Surah',
  fullSurahHint: 'Recites this surah from its first ayah to its last, then stops',
  repeatAyah: 'Repeat ayah',
  repeatHint: 'Changes how many times each ayah is repeated: off, once, twice, 3 times, or continuously',
  repeatOff: 'off',
  repeatOnce: 'once',
  repeatTwice: 'twice',
  repeatThrice: '3 times',
  repeatInfinite: 'continuously',
};

/** Quran audio in Arabic: one Standard Arabic wording for ar and ar-EG alike. */
const AR_AUDIO: Messages['audio'] = {
  playPage: 'تشغيل التلاوة من هذه الصفحة',
  play: 'تشغيل',
  pause: 'إيقاف مؤقت',
  previousAyah: 'الآية السابقة',
  nextAyah: 'الآية التالية',
  stop: 'إيقاف التلاوة وإغلاق المشغّل',
  expand: 'إظهار المشغّل',
  collapse: 'إخفاء المشغّل',
  reciter: 'القارئ',
  chooseReciter: 'اختر القارئ',
  upNext: 'التالي: {reciter}',
  loading: 'جارٍ التحميل…',
  buffering: 'جارٍ التحميل…',
  followRecitation: 'تتبّع التلاوة',
  ayahPosition: 'سورة {surah} · الآية {ayah}',
  playingOffline: 'يُشغَّل من الجهاز',
  ended: 'اكتملت التلاوة',
  errorUnavailable: 'لا تتوفر لدى {reciter} تلاوة موثّقة لسورة {surah}. اختر قارئًا آخر.',
  errorNetwork: 'تعذّر تحميل التلاوة. تحقّق من اتصالك بالإنترنت.',
  errorMismatch: 'تغيّر توقيت الآيات لهذه التلاوة في المصدر، فلا يمكن استخدامه حتى يُتحقَّق منه من جديد.',
  errorPlayback: 'تعذّر تشغيل هذا التسجيل على هذا الجهاز.',
  retry: 'إعادة المحاولة',
  noticeReciterUnavailable: 'لا تتوفر لدى {reciter} تلاوة موثّقة لسورة {surah}، لذا يستمر القارئ الحالي.',
  dismiss: 'إغلاق',
  coveragePartial: '{n} من ١١٤ سورة',
  coverageNone: 'التشغيل آيةً بآية غير متاح',
  nowReciting: 'يتلو الآن',
  upNextBadge: 'التالي',
  notForThisSurah: 'غير متاحة لهذه السورة',
  listen: 'استمع',
  listenHint: 'التلاوة بدءًا من هذه الآية',
  playAyah: 'تشغيل الآية',
  pauseAyah: 'إيقاف مؤقت',
  replayAyah: 'إعادة التشغيل',
  ayahUnavailable: 'لا تتوفر لدى {reciter} تلاوة موثّقة لهذه السورة. يمكنك اختيار قارئ مفضّل آخر من الإعدادات.',
  favoriteTitle: 'القارئ المفضل',
  favoriteDescription: 'يتلو في المصحف وفي صفحات الآيات.',
  sourceNote: 'التلاوات: موقع MP3Quran (mp3quran.net)',
  offlineTitle: 'الاستماع دون اتصال',
  offlineDescription: 'نزّل تلاوة {reciter} للاستماع دون إنترنت: {n} سورة، نحو {size}.',
  offlineNothing: 'لا توجد لدى {reciter} سور يمكن تشغيلها آيةً بآية، فلا يوجد ما يُنزَّل.',
  offlineNotIncluded: 'غير مشمولة (لا توجد تلاوة موثّقة): السور {list}',
  download: 'تنزيل',
  pauseDownload: 'إيقاف مؤقت',
  resumeDownload: 'استئناف',
  cancelDownload: 'إلغاء',
  retryDownload: 'إعادة المحاولة',
  deleteDownload: 'حذف',
  downloadProgress: '{done} من {total} سورة · {percent}٪',
  downloadPaused: 'متوقف مؤقتًا · {done} من {total} سورة',
  downloadCancelled: 'توقّف · نُزّلت {done} من {total} سورة',
  downloadComplete: 'تم التنزيل: {n} سورة · {size}',
  downloadPartial: 'نُزّل جزئيًا: {done} من {total} سورة',
  storageTotal: 'التلاوات المحفوظة على الجهاز: {size}',
  storedReciter: '{reciter}: {n} سورة · {size}',
  wifiTitle: 'لست متصلًا بشبكة Wi-Fi',
  wifiBody: 'حجم التنزيل نحو {size}، ويُنصح باستخدام Wi-Fi. هل تريد التنزيل عبر بيانات الجوال؟',
  wifiConfirm: 'تنزيل على أي حال',
  wifiCancel: 'ليس الآن',
  deleteTitle: 'حذف التلاوات المنزّلة؟',
  deleteBody: 'يحذف تلاوات {reciter} المنزّلة ({size}) من هذا الجهاز، ويمكنك تنزيلها مرة أخرى لاحقًا.',
  deleteConfirm: 'حذف',
  deleteCancel: 'إبقاء',
  downloadErrorNetwork: 'توقّف التنزيل: لا يوجد اتصال.',
  downloadErrorStorage: 'لا توجد مساحة كافية على هذا الجهاز.',
  downloadErrorVerify: 'تعذّر التحقق من ملف منزّل. حاول مرة أخرى.',
  downloadErrorNotPermitted: 'التنزيل غير متاح لهذا التسجيل.',
  megabytes: '{n} ميغابايت',
  gigabytes: '{n} غيغابايت',
  previousPage: 'الصفحة السابقة',
  nextPage: 'الصفحة التالية',
  ayahOnly: 'الآية {ayah}',
  surahProgress: 'الآية {ayah} من {total}',
  stopHint: 'اضغط مطولًا لإيقاف التلاوة.',
  offlineNotPermitted: 'التنزيل للاستماع دون اتصال غير متاح حاليًا، إذ ننتظر تأكيد موقع MP3Quran للإذن بهذه التسجيلات. تعمل التلاوة عبر الإنترنت كالمعتاد.',
  offlineStateNone: 'غير منزّل',
  offlineStateDownloading: 'جارٍ التنزيل',
  offlineStatePaused: 'التنزيل متوقف مؤقتًا',
  offlineStateComplete: 'تم التنزيل',
  offlineStateError: 'توقّف التنزيل',
  offlineStateUnavailable: 'التنزيل غير متاح',
  offlineManageHint: 'يعرض خيارات التنزيل لهذا القارئ.',
  close: 'إغلاق',
  wholeSurah: '{surah} · السورة كاملة',
  wholeSurahNote: 'يُشغَّل هذا التسجيل سورةً كاملة، ولا تُتابَع الآيات ولا تُظلَّل.',
  errorSurahOnly: 'تسجيل {reciter} لسورة {surah} لا يُشغَّل إلا كاملًا من بدايته، إذ لا توقيت موثّقًا لآياته، فلا يمكن البدء من هذه الآية.',
  noticeReciterSurahOnly: 'تسجيل {reciter} لسورة {surah} لا يُشغَّل إلا كاملًا من بدايته، لذا يستمر القارئ الحالي.',
  playWholeSurah: 'تشغيل السورة كاملة',
  cancel: 'إلغاء',
  errorSource: 'لم يعد هذا التسجيل مطابقًا للملف الموثّق في مصدره، لذا لا يُشغَّل.',
  previousSurah: 'السورة السابقة',
  nextSurah: 'السورة التالية',
  surahPosition: '{elapsed} من {total}',
  seekBack: 'رجوع ١٥ ثانية',
  seekForward: 'تقدّم ١٥ ثانية',
  wholeSurahOnly: 'السورة كاملة فقط',
  coveragePartialWhole: '{n} من ١١٤ سورة · {m} كاملة فقط',
  developmentPreview: 'معاينة للتطوير',
  fullSurah: 'السورة كاملة',
  fullSurahHint: 'يتلو هذه السورة من أول آية إلى آخر آية ثم يتوقف',
  repeatAyah: 'تكرار الآية',
  repeatHint: 'يغيّر عدد مرات تكرار كل آية: متوقف، مرة واحدة، مرتين، ٣ مرات، أو باستمرار',
  repeatOff: 'متوقف',
  repeatOnce: 'مرة واحدة',
  repeatTwice: 'مرتين',
  repeatThrice: '٣ مرات',
  repeatInfinite: 'باستمرار',
};

export const MESSAGES: Record<AppLocale, Messages> = {
  en: {
    appName: 'Quran Heals',
    home: {
      subtitle: 'Healing for What Lies Within the Hearts',
      eyebrow: 'Live by the Quran',
      title: 'How are you feeling?',
      loadingTitle: 'Loading emotions',
      loadingMessage: 'Preparing the emotion list.',
      errorTitle: 'Unable to connect',
      retry: 'Try Again',
      disclaimer: 'Quran Heals offers spiritual reflection and is not a substitute for professional care.',
      sourcesCredit: 'Quran text: Tanzil (Uthmani 1.1) · Mushaf layout and QPC V1 fonts: Quran Foundation · Mushaf typography and artwork: King Fahd Glorious Qur’an Printing Complex.',
      sourcesLink: 'Quran Sources & Credits',
      openFavorites: 'Open saved ayahs',
    },
    generalQuran: {
      action: 'A Message from the Quran',
      loadError: "We couldn't load an ayah. Please try again.",
    },
    ayah: {
      kicker: 'A selected ayah for this moment',
      goBack: 'Go back',
      loadingTitle: 'Loading ayah',
      loadingMessage: 'Finding a relevant ayah.',
      errorTitle: 'Please try again',
      retry: 'Try Again',
      missingEmotion: 'Please choose an emotion first.',
      genericError: "We couldn't load an ayah right now.",
      historyUnresolved: 'Some older history entries could not be used to prevent repeats. Your stored history has been kept.',
      historyReadFailed: 'Recent history could not be read. Your stored history has been kept.',
      historySaveFailed: 'This ayah could not be added to recent history. Your previous history has been kept.',
      share: 'Share',
      shareAyah: 'Share ayah',
      anotherAyah: 'Another Ayah',
      loadAnotherAyah: 'Load another ayah',
      connectionHeading: 'How this ayah connects',
      readInQuran: 'Read in Quran',
      copyAyah: 'Copy ayah',
      invalidLink: "This ayah link isn't valid. Please check the link and try again.",
    },
    favorites: {
      title: 'Saved Ayahs',
      subtitle: 'Favorites stored on this device.',
      loadingTitle: 'Loading favorites',
      loadingMessage: 'Opening your saved ayahs.',
      errorTitle: 'Some saved ayahs could not be opened',
      retry: 'Try Again',
      emptyTitle: 'No saved ayahs yet',
      emptyMessage: 'Save an ayah and it will appear here.',
      unresolvedSuffix: 'saved item(s) could not be resolved. Your stored entries have been kept.',
      share: 'Share',
      shareSaved: 'Share saved ayah',
      remove: 'Remove',
      removeSaved: 'Remove saved ayah',
    },
    favoriteButton: {
      save: 'Save',
      saved: 'Saved',
      saveLabel: 'Save ayah to favorites',
      removeLabel: 'Remove ayah from favorites',
    },
    reflections: {
      title: 'My Reflections',
      subtitle: 'Reflect and Contemplate on the Quran',
      loadingTitle: 'Loading reflections',
      loadingMessage: 'Opening your saved reflections.',
      emptyTitle: 'No reflections yet',
      emptyMessage: 'Open an ayah and write a reflection. It will appear here.',
      errorTitle: 'Some reflections could not be opened',
      errorMessage: 'Your reflections could not be read. Your stored data has been kept.',
      retry: 'Try Again',
      referenceUnresolved: 'This Quran reference could not be verified right now.',
      editedLabel: 'Edited',
      statusSavedOnDevice: 'Saved on device',
      statusPendingSync: 'Pending sync',
      statusSynced: 'Synced',
      openReflectionLabel: 'Open reflection for',
      otherVersionBadge: 'Another version to review',
      recoveredBadge: 'No current reflection, but another version was kept. Tap to review',
    },
    translation: {
      showTranslation: 'Show translation',
      hideTranslation: 'Hide translation',
    },
    share: {
      title: 'Share Ayah',
      close: 'Close',
      preview: 'Ayah card preview',
      card: 'Card',
      previousCard: 'Previous card',
      nextCard: 'Next card',
      longAyahNote: 'This ayah continues across several cards, in order. Share and Save always include every card, so the ayah stays complete.',
      format: 'Format',
      formatStory: 'Story',
      formatPost: 'Post',
      formatSquare: 'Square',
      background: 'Background',
      themeSage: 'Sage',
      themeCream: 'Cream',
      themeDark: 'Dark',
      backgroundColors: 'Colors',
      backgroundScenery: 'Scenery',
      newBackground: 'New Background',
      sceneryLoadFailed: "This background couldn't be loaded. Tap New Background to choose another.",
      showTranslation: 'Show translation',
      share: 'Share image',
      shareAllCards: 'Share all cards',
      saveImage: 'Save image',
      saveAllImages: 'Save all cards',
      multipleUnavailable: "This version of the app can't share several images at once. Save all cards, then share them together from Photos.",
      copyLink: 'Copy ayah link',
      linkCopied: 'Ayah link copied.',
      linkAutoCopied: 'Ayah link copied — paste it into a Story Link sticker or a message.',
      copyLinkFailed: "The link couldn't be copied. Please try again.",
      linkHint: 'The ayah link is copied automatically when you share. Paste it into your Story’s Link sticker.',
      preparing: 'Preparing image…',
      saved: 'Saved to your photos.',
      savedAll: 'All cards saved to your photos.',
      saveDenied: 'Quran Heals needs permission to add the image to your photos.',
      saveBlocked: 'Photo access is turned off for Quran Heals. You can allow it in Settings.',
      openSettings: 'Open Settings',
      shareUnavailable: "Sharing isn't available on this device.",
      shareFailed: "The image couldn't be shared. Please try again.",
      saveFailed: "The image couldn't be saved. Please try again.",
      cannotFit: "This card couldn't be prepared. Please try another format.",
    },
    mushaf: {
      title: 'Mushaf',
      prototypeNote: 'Preview — page 61 only.',
      tapHint: 'Tap an ayah to select it. Pinch to zoom; double-tap to return to the full page.',
      pageLabel: 'Mushaf page',
      selectedAyah: 'Selected ayah',
      clearSelection: 'Clear selection',
      readingStops: 'My Reciting',
      stopNameLabel: 'Reciting name (e.g., Personal or Mosque)',
      saveStop: 'Save Reciting on this page',
      stopSaved: 'Saved',
      stopNameInvalid: 'Enter a name of up to 40 characters.',
      tooManyStops: "You can't add another Reciting until you remove one.",
      stopSaveFailed: "The Reciting couldn't be saved. Please try again.",
      noStops: 'No Reciting yet.',
      page: 'Page',
      removeStop: 'Remove',
      renameStop: 'Rename',
      saveName: 'Save name',
      cancelRename: 'Cancel',
      stopRenamed: 'Name updated.',
      stopNameTaken: 'Another Reciting already uses this name.',
      offlineTitle: "Offline Mushaf",
      offlineIntro: "All 604 pages and their fonts (about 100 MB), to read without an internet connection.",
      offlineDownload: "Download for offline reading",
      offlineResume: "Continue download",
      offlineCancel: "Cancel",
      offlineDownloading: "Downloading",
      offlineVerifying: "Checking the download",
      offlineReady: "Available offline",
      offlineUpdatedFrom: "Last updated from Quran Foundation",
      offlineCheckUpdate: "Check for updates",
      offlineUpToDate: "The offline Mushaf is up to date.",
      offlineUpdated: "The offline Mushaf was updated.",
      offlineRemove: "Remove offline copy",
      offlineCancelled: "Download paused. It will continue where it stopped.",
      offlineErrorOffline: "You're offline. What was downloaded is kept; try again when you're connected.",
      offlineErrorUnavailable: "The offline Mushaf isn't available right now. Please try again later.",
      offlineErrorStorage: "There is not enough free storage on this device.",
      offlineErrorIntegrity: "The download couldn't be verified, so nothing was changed. Please try again.",
      offlineErrorGeneric: "The offline Mushaf couldn't be saved. Please try again.",
      offlineFonts: "Downloading page fonts",
      offlineFontsCount: "Page fonts",
      offlineComplete: "The complete Mushaf is ready for offline reading",
      autoPreparing: "Preparing your Mushaf for offline reading",
      autoReady: "Your Mushaf is ready for offline reading",
      autoConsentCellular: "Download the Mushaf for offline reading (about 100 MB) using mobile data?",
      autoConsentUnknown: "Download the Mushaf for offline reading now? It is about 100 MB.",
      autoDownloadNow: "Download now",
      autoWaitForWifi: "Wait for Wi-Fi",
      autoNotNow: "Not now",
      offlinePause: "Pause",
      offlineRetry: "Try again",
      offlinePaused: "Paused. What has been downloaded is kept.",
      offlineWaitingWifi: "It will download by itself on Wi-Fi.",
      offlineWaitingNetwork: "Waiting for an internet connection.",
      offlineRetrying: "It will try again by itself shortly.",
      previousPage: "Previous page",
      nextPage: "Next page",
      searchPage: 'Search: a page or a Surah',
      pageNumberPlaceholder: "Page number (1–604)",
      goToPage: "Go to page",
      pageOutOfRange: "Enter a page from 1 to 604.",
      enterFullScreen: 'Full-screen reading',
      exitFullScreen: 'Exit full-screen reading',
      wirdChoose: 'Choose a Reciting',
      wirdSelectorLabel: 'Active Reciting',
      wirdSelectorHint: 'Opens your Reciting list to switch to another.',
      wirdAdd: 'Add a Reciting',
      wirdNew: 'New Reciting on This Page',
      wirdClose: 'Close',
      navSurahTitle: "Surahs",
      navJuzTitle: "Juz'",
      navHizbTitle: "Hizb",
      juzSearchPlaceholder: "Search by juz' number (1–30)",
      hizbSearchPlaceholder: "Search by Hizb number (1–60)",
      juzName: "Juz' {n}",
      hizbName: "Hizb {n}",
      divisionNoResults: "No match for that number.",
      openSurahs: "Choose a Surah",
      openJuz: "Choose a juz'",
      openHizb: "Choose a Hizb",
      openPageSelector: "Go to a page",
      pageSlider: "Page",
      goToSelected: "Go to page {page}",
      editPage: "Type a page number",
      goToPageShort: "Go",
      guideSurah: "Tap the Surah name to choose a Surah.",
      guideHizb: "Tap the Hizb number to choose a Hizb.",
      guidePage: "Tap the page number to go to a page.",
      guideJuz: "Tap the Juz number to choose a Juz.",
      guideAyah: "Tap an ayah to see its options.",
      guideMarker: "Tap an ayah's number, then Apply, to save your Reciting position.",
      guideNext: "Next",
      guideBack: "Back",
      guideClose: "Close",
      guideStart: "Start Reading",
      guideStepOf: "{n} of {total}",
      guideNotOnPage: "Not on this page: it appears on the pages where it applies.",
      guideHelp: "Help",
      guideReopenHint: 'You can view this guide again anytime from Settings → Quran → Mushaf Guide.',
      keyboardDone: "Done",
      actionReflection: "Reflection",
      actionSave: "Save",
      actionSaved: "Saved",
      actionCopy: "Copy",
      actionCopied: "Copied",
      actionCopyFailed: "Couldn't copy the ayah. Please try again.",
      applyToWird: "Apply to {name}",
      searchTitle: 'Go to',
      searchByPage: 'Page Number',
      searchBySurah: 'Surah Name',
      surahSearchPlaceholder: 'Search the 114 Surahs',
      surahNoResults: 'No Surah matches that name.',
      goAction: 'Go',
      pageShort: 'Page',
      saveStopAction: "Save a Reciting on this page",
      confirmStop: "Save Reciting",
      pageNotDownloaded: "This page is part of the offline Mushaf. Download it to read every page.",
      pageUnavailable: "This page can't be shown right now. Please try again.",
      renderer: "Script",
      rendererQpc: "1405 Mushaf (QPC V1)",
      rendererSvg: "Quran SVG (newer print)",
      qpcLoading: "Loading the 1405 page…",
      qpcUnavailable: "The 1405 page isn't available right now, so the Quran SVG page is shown.",
      pageLoadError: "This page couldn't be displayed.",
    },
    khatmDua: {
      title: 'دعاء ختم القرآن',
      unavailable: 'This supplication is not available yet.',
      smaller: 'Smaller text',
      larger: 'Larger text',
      open: 'دعاء ختم القرآن',
      back: 'Back',
    },
    tabs: {
      home: 'Home',
      howIFeel: 'How I Feel',
      mushaf: 'Mushaf',
      myReading: 'My Reciting',
      reflections: 'Reflections',
    },
    continueReading: {
      title: 'Continue Reciting',
      mushaf: 'Mushaf',
      myReading: 'My Reciting and Khatmas',
      pageOf: 'Page {page} of {total}',
      activeWird: 'Current Reciting',
      lastSaved: 'Last saved Reciting',
      chooseWird: 'Choose a Reciting',
      switchHint: 'Opens your Reciting list to switch to another.',
      firstTitle: 'Start Reciting',
      firstBody: 'Open the Mushaf to its first page and reflect on its verses as you begin a new Reciting.',
    },
    emotionsAll: {
      viewAll: 'View All',
      title: 'How are you feeling now?',
      subtitle: 'And Hearts Find Peace',
      back: 'Back',
    },
    myReading: {
      title: 'My Reciting and Khatmas',
      subtitle: 'Recite and Rise',
      back: 'Back',
      statsTotal: 'Khatmas',
      statsRamadan: 'Ramadan Khatmas',
      wirdsTitle: 'My Reciting',
      newWird: 'New Reciting',
      emptyTitle: 'No Reciting yet',
      emptyBody: 'Create a Reciting to keep your place in the Mushaf. Each Reciting keeps its own page, progress and Khatmas.',
      pageOf: 'Page {page} of {total}',
      percent: 'Completion {percent}%',
      positionLabel: 'Completion, by the saved page in the Mushaf',
      footnote: 'Your Reciting progress and Khatmas are saved on this device only. A Reciting’s completion is based on the page you last saved, not a count of pages recited; a Khatma is counted only when you confirm it.',
      footnoteSynced: 'Your Reciting progress and Khatmas sync with your account across the devices signed in to it, and are always saved on this device first. A Reciting’s completion is based on the page you last saved, not a count of pages recited; a Khatma is counted only when you confirm it.',
      syncSyncing: 'Syncing…',
      syncSynced: 'Synced with your account',
      syncPending: 'Saved on this device. It will sync with your account when you’re online.',
      khatmaCount: 'Khatmas: {count}',
      active: 'Current',
      continue: 'Continue Reciting',
      rename: 'Rename',
      delete: 'Delete',
      pendingTitle: 'This Reciting has reached page 604.',
      confirm: 'Confirm Khatma completion',
      unconfirmedTitle: 'Saved at page 604',
      unconfirmedBody: 'This Reciting was saved at page 604, but no completed Quran reading cycle was recorded (it was saved before Khatmas were tracked, or created on page 604). Nothing has been counted.',
      recordUnconfirmed: 'I completed a Khatma with this Reciting',
      unconfirmedConfirmTitle: 'Record a completed Khatma?',
      unconfirmedConfirmBody: 'Only if you have read the whole Quran with “{name}”. It will be counted once, and the Reciting will start again from page 1.',
      duaEntry: "Quran Completion Du'a",
      historyTitle: 'Completed Khatmas',
      historyEmpty: 'Completed Khatmas will appear here.',
      ramadanTag: 'Ramadan {year} AH',
      nonRamadanTag: 'Outside Ramadan',
      removeKhatma: 'Remove',
      removeTitle: 'Remove this Khatma?',
      removeBody: 'Use this only to correct a mistake. Counts are recalculated. If “{name}” has not been saved since this Khatma, it returns to page 604 with the completion awaiting confirmation; otherwise its current page is kept.',
      remove: 'Remove',
      cancel: 'Cancel',
      deleteTitle: 'Delete “{name}”?',
      deleteBody: 'Its saved page is removed. Its completed Khatmas stay in your history and totals.',
      createTitle: 'New Reciting',
      renameTitle: 'Rename Reciting',
      nameLabel: 'Name',
      startPageLabel: 'Starting page (1–604)',
      save: 'Save',
      create: 'Create',
      nameInvalid: 'Enter a name of up to 40 characters.',
      nameTaken: 'Another Reciting already has this name.',
      pageInvalid: 'Enter a page from 1 to 604.',
      saveFailed: 'This could not be saved. Please try again.',
      loadFailed: 'Your Reciting list could not be loaded.',
    },
    khatma: {
      reachedTitle: 'Masha’Allah, you have completed the Quran',
      confirm: 'Complete the Khatma',
      notNow: 'Not now',
      completeTitle: 'May Allah accept your Khatma',
      completeBody: 'We ask Allah to make the Quran a light for your heart and an intercessor for you.',
      readDua: 'Read the Khatma Du’a',
      backToKhatmas: 'Back to My Reciting and Khatmas',
      backToMushaf: 'Back to Mushaf',
      failed: 'The Khatma could not be recorded. Please try again.',
      completeAction: 'إتمام الختمة',
      notReadyTitle: "This Reciting can't be completed here",
      notReadyBody: 'Review it in My Reciting and Khatmas. Nothing has been changed.',
      noWirdTitle: 'Select a Reciting first',
      noWirdBody: 'Choose the Reciting you have completed from the Reciting name below the page, then try again.',
      newCycleTitle: 'This Khatma is already recorded',
      newCycleBody: 'This Reciting has started a new Quran reading cycle. Save your progress as you read; you can complete the new cycle when you reach page 604 again. Nothing has been changed.',
      saveFailedTitle: 'The page could not be saved',
      saveFailedBody: 'Nothing was recorded. Please try again.',
      notReadyOk: 'OK',
    },
    credits: {
      title: 'Quran Sources & Credits',
      intro: 'Quran Heals shows the Quran from these sources, with gratitude. The Quran text is shown exactly as published, without any change.',
      tanzilName: 'Tanzil Project',
      tanzilWork: 'Quran text: Uthmani 1.1, used verbatim. Licensed under the Creative Commons Attribution 3.0 licence.',
      quranFoundationName: 'Quran Foundation',
      quranFoundationWork: 'Mushaf page layout and the QPC V1 page fonts (1405 AH Madinah Mushaf), used under Quran Foundation’s developer terms.',
      kingFahdName: 'King Fahd Glorious Qur’an Printing Complex',
      kingFahdWork: 'Original Mushaf typography and artwork: the 1405 AH Madinah Mushaf. QCF V1 fonts © King Fahd Glorious Qur’an Printing Complex. All rights reserved.',
      amiriName: 'Amiri Project Authors',
      amiriWork: 'The Amiri Bold font is used for Surah names, not Quran text. SIL Open Font License 1.1 permits embedding and commercial redistribution with software; the font may not be sold by itself. The required copyright notice and full license are bundled with the app. The decorative frame is original Quran Heals artwork.',
      mp3quranName: 'MP3Quran',
      mp3quranWork: 'Quran audio and its ayah timing, streamed from mp3quran.net and downloadable for offline listening. MP3Quran states that any visitor or developer may copy and use its material.',
      tafsirCenterName: 'Tafsir Center for Quranic Studies',
      tafsirCenterWork: 'Surah Preview’s main purpose: Al-Mukhtasar fi Tafsir al-Quran al-Karim (المختصر في تفسير القرآن الكريم), via QuranEnc.com. Makki/Madani and ayah count: Tanzil.',
      website: 'Website',
      license: 'Licence',
      terms: 'Terms of use',
    },
    quranFontSize: {
      decreaseLabel: 'Decrease Quran text size',
      increaseLabel: 'Increase Quran text size',
      auto: 'Auto',
      autoLabel: 'Reset Quran text size to automatic',
    },
    settings: {
      title: 'Settings',
      subtitle: 'Language, appearance, reminders and your account.',
      openSettings: 'Open settings',
      appLanguageSection: 'App Language',
      emotionsLanguageSection: 'Emotions Language',
      emotionsFollowApp: 'Follow App Language',
      emotionsEnglish: 'English',
      emotionsArabicStandard: 'العربية الفصحى',
      emotionsArabicEgyptian: 'العربية المصرية',
      quranTranslationNone: 'None',
      keepAwakeTitle: 'Keep Screen Awake',
      keepAwakeDescription: 'Prevent automatic screen locking while reading the Mushaf.',
      wordMeaningsVisibleTitle: 'Word Meanings',
      mushafGuideTitle: 'Mushaf Guide',
      offlineMushafTitle: 'Offline Mushaf',
      offlineMushafAvailable: 'Available Offline',
      offlineMushafRequired: 'Download Required',
      offlineMushafDownloading: 'Downloading…',
      offlineMushafFailed: 'Download Failed',
      offlineMushafDownloadHint: 'Tap to download the whole Mushaf for reading without internet.',
      quranTranslationSection: 'Quran Translation',
      translationDisplayAlways: 'Always',
      translationDisplayOnDemand: 'On demand',
      translationDisplayOff: 'Off',
      translationDisplayAlwaysHint: 'Arabic and the English translation are both shown automatically.',
      translationDisplayOnDemandHint: 'Arabic is shown first; tap to reveal the translation.',
      translationDisplayOffHint: 'Arabic only. The translation is never shown.',
      quranArabicNote: 'The Arabic Quran is always shown — this setting only affects the English translation.',
      legalSection: 'Legal & Privacy',
      privacyPolicy: 'Privacy Policy',
      termsOfUse: 'Terms of Service',
      accountDeletionInfo: 'Account & Data Deletion',
      opensInBrowser: 'Opens in your browser',
      appSection: 'App',
      emotionsSection: 'Emotions',
      quranSection: 'Quran',
      supportSection: 'Support',
      showTranslationTitle: 'Show Translation',
      showTranslationDescription: 'The English translation under each ayah.',
      translationModeLabel: 'Translation display',
      translationModeAlways: 'Always',
      translationModeOnDemand: 'On Demand',
    },
    notifications: {
      wirdReminderTitle: 'Reciting Reminder',
      randomAyahTitle: 'Random Quran Ayah',
      emotionCheckInTitle: 'You Deserve Peace',
      frequencyLabel: 'Frequency',
      frequencyDaily: 'Daily',
      frequencyEvery3Days: 'Every 3 days',
      frequencyWeekly: 'Weekly',
      frequencyTwiceDaily: 'Twice Daily',
      twiceMorning: 'Morning',
      twiceEvening: 'Evening',
      twiceSameTime: 'Choose two different times.',
      reminderTimeLabel: 'Reminder time',
      chooseDay: 'Choose day',
      changeHint: 'Opens the options to change it.',
      toggleHint: 'Turns this reminder on or off.',
      timePickerConfirm: 'Set time',
      timePickerCancel: 'Cancel',
      am: 'AM',
      pm: 'PM',
      weekday1: 'Sunday',
      weekday2: 'Monday',
      weekday3: 'Tuesday',
      weekday4: 'Wednesday',
      weekday5: 'Thursday',
      weekday6: 'Friday',
      weekday7: 'Saturday',
      permissionRequired: 'Permission required',
      permissionDeniedHint: 'Notifications are turned off for Quran Heals in your device settings.',
      permissionAllow: 'Allow notifications',
      permissionOpenSettings: 'Open device settings',
      permissionSheetTitle: 'Allow notifications?',
      permissionSheetBody: 'Allow notifications to receive reminders for your Reciting, a Quran ayah, and a moment of peace for your heart.',
      permissionSheetPrivacy: 'Reminders are scheduled on your device and work offline.',
      permissionSheetConfirm: 'Continue',
      permissionSheetCancel: 'Not now',
      unsupported: 'Reminders are available in the iPhone and Android app.',
      scheduleError: "This reminder couldn't be scheduled. It will be tried again when you return to the app.",
      wirdNotificationTitle: 'Time for your Quran reciting.',
      wirdNotificationBody: 'Continue your Reciting and reconnect with the Quran.',
      wirdNotificationBodyPage: 'Continue your {name} reciting from page {page}.',
      wirdNotificationBodyPageDefinite: 'Continue your {name} reciting from page {page}.',
      randomAyahNotificationTitle: 'A Verse for You Today',
      randomAyahNotificationReference: '{surah} · {chapter}:{ayah}',
      checkInNotificationTitle: 'You Deserve Peace ❤️',
      checkInNotificationBody: "Whatever you're feeling, there's something in the Quran that speaks to your heart.",
    },
    appearance: {
      sectionLabel: 'Appearance',
      system: 'System',
      light: 'Light',
      dark: 'Dark',
    },
    auth: {
      syncPrompt: 'Sign in to sync across devices',
      continueWithoutAccount: 'Continue without an account',
      continueWithApple: 'Continue with Apple',
      continueWithGoogle: 'Continue with Google',
      signInFailed: "We couldn't sign you in. You can try again or continue without an account.",
    },
    account: {
      sectionTitle: 'Account',
      checkingSession: 'Checking your session…',
      notSignedIn: 'Not signed in',
      signInWithApple: 'Sign in with Apple',
      signInWithGoogle: 'Sign in with Google',
      signedIn: 'Signed in',
      signOut: 'Sign out',
      dangerZoneTitle: 'Danger Zone',
      deleteAccountAction: 'Delete Account',
      deleteAccountActionDescription: 'Permanently delete your Quran Heals account and all synced data.',
    },
    ageConfirmation: {
      title: 'Before you continue',
      description: 'To create a Quran Heals account, you must be at least 16 years old and meet the minimum age required in your country.',
      checkbox: 'I confirm that I meet the minimum age requirement.',
      continueButton: 'Continue',
      cancel: 'Cancel',
    },
    deleteAccount: {
      title: 'Delete your account?',
      description:
        'This will permanently delete your Quran Heals account, synced reflections, favorites, preferences, and other account data. This action cannot be undone.',
      confirmationInstruction: 'To confirm, type DELETE below.',
      confirmationWord: 'DELETE',
      placeholder: 'Type DELETE',
      deleteButton: 'Delete my account',
      deleting: 'Deleting…',
      cancel: 'Cancel',
      successMessage: 'Your Quran Heals account has been deleted.',
      failureMessage: "We couldn't delete your account right now. Please try again.",
    },
    reflection: {
      action: 'Reflection',
      writeAction: 'Write a reflection',
      title: 'Reflections on this ayah',
      prompt: 'What feeling did this ayah leave you with?',
      placeholder: 'Write how this ayah touched your heart...',
      guestNote: 'Your reflections are saved on this device. Sign in to access them across your devices.',
      syncedNote: 'Your reflection is privately synced across your signed-in devices.',
      save: 'Save',
      cancel: 'Cancel',
      deleteAction: 'Delete reflection',
      deleteConfirmTitle: 'Delete reflection?',
      deleteConfirmMessage: 'This reflection will be removed from this device and your other signed-in devices.',
      deleteConfirmCancel: 'Cancel',
      deleteConfirmConfirm: 'Delete',
      deleteError: 'Your reflection could not be deleted. Please try again.',
      saveError: "Your reflection couldn't be saved. Please try again.",
      otherVersionsTitle: 'Another version of this reflection',
      otherVersionsHint: 'This reflection was changed on more than one device before they synced. Nothing was deleted: choose what to keep, then tap Save.',
      otherVersionThisDevice: 'Written on this device',
      otherVersionOtherDevice: 'From another device',
      otherVersionDeletedElsewhere: 'Written on this device before it was deleted on another device',
      useOtherVersion: 'Use this version',
      addOtherVersion: 'Add to my text',
      copyOtherVersion: 'Copy',
      copiedOtherVersion: 'Copied',
      discardOtherVersion: 'Discard',
      discardOtherVersionTitle: 'Discard this version?',
      discardOtherVersionMessage: 'This text will be removed from this device. This cannot be undone.',
      otherVersionTooLong: 'Too long to add to your text. Copy it instead.',
    },
    guestData: {
      title: "Add your local data to this account?",
      body: "You have favorites, reflections, or Reciting and Khatma progress saved on this device. Would you like to add them to this account? They will then sync across the devices signed in to this account.",
      add: "Add to this account",
      keepSeparate: "Keep separate",
    },
    syncPassphrase: {
      createTitle: "Set Password",
      unlockTitle: "Enter Password",
      createDescription: "Create a Password to protect and encrypt your private reflections when they sync across your devices. Quran Heals cannot recover your Password if you forget it, so choose something you can remember.",
      unlockDescription: "Enter your Password to unlock your encrypted reflections on this device.",
      createPlaceholder: "Password",
      unlockPlaceholder: "Password",
      continueLabel: "Continue",
      confirmPassword: "Confirm Password",
      show: "Show",
      hide: "Hide",
      lengthHint: "Use 8–32 characters.",
      allowedHint: "Letters, numbers, and symbols are allowed.",
      mismatch: "Passwords don’t match.",
      tooShort: "Password must be at least 8 characters.",
      tooLong: "Password cannot exceed 32 characters.",
      changeTitle: "Change Password",
      currentPassword: "Current Password",
      newPassword: "New Password",
      confirmNewPassword: "Confirm New Password",
      mustDiffer: "New Password must be different from your current Password.",
      incorrectError: "Current Password is incorrect.",
      changeDescription: "Change the Password for your encrypted synced reflections.",
      saveError: "Could not confirm the password change. Check your connection and try again. If it was saved, use your new Password.",
      loadError: "Could not load your encrypted sync key. Please try again.",
      retry: "Try again",
      forgotPassword: "Forgot Password?",
      resetTitle: "Reset encrypted reflection sync?",
      resetUnrecoverable: "Your password cannot be recovered.",
      resetCloudLoss: "Resetting will permanently delete the reflections saved to your account, unless they are also saved on this device.",
      resetConfirm: "Reset",
      resetBack: "Back",
      resetError: "The reset could not be completed. Check your connection and try again.",
      resetting: "Resetting…",
      deleteAccountInstead: "Delete my account instead",
      reauthNoticeApple: "To confirm it’s you, you’ll sign in again with the same Apple account you use for Quran Heals.",
      reauthNoticeGoogle: "To confirm it’s you, you’ll sign in again with the same Google account you use for Quran Heals.",
      reauthCancelled: "Identity verification was not completed. Nothing was reset.",
      reauthFailed: "We couldn’t confirm it’s you with the account you’re signed in with. Nothing was reset.",
      reauthUnavailable: "Identity verification isn’t available on this device. You can still sign out or delete your account.",
      verifying: "Verifying…",
    },
    issueReport: {
      action: 'Report an Issue',
      description: 'Tell us what seems wrong. Your report helps us improve Quran Heals.',
      categoryAyahNotRelevant: "Ayah doesn't feel relevant",
      categoryQuranTextDisplay: 'Quran text display issue',
      categoryTranslationIssue: 'Translation issue',
      categoryAppTechnicalIssue: 'App or technical issue',
      categoryOther: 'Other',
      emailLabel: 'Email for follow-up (optional)',
      submit: 'Submit',
      cancel: 'Cancel',
      done: 'Done',
      successMessage: 'Thank you. Your report has been received.',
      failureMessage: "We couldn't send your report. Please try again.",
      flagAction: 'Report an issue with this ayah',
      settingsDescription: "Let us know if something isn't working properly.",
      aboutAyah: 'This report includes the ayah:',
      commentLabel: 'Describe the problem...',
      commentRequired: 'Please describe the problem.',
      emailInvalid: 'Please enter a valid email address.',
    },
    feedback: {
      action: 'Share Feedback',
      sheetTitle: 'Share Feedback',
      sheetDescription: 'Share your ideas to help us improve Quran Heals.',
      messageLabel: 'Share your thoughts or suggestions...',
      messageRequired: 'Please enter your feedback.',
      privacyNote: "Please don't include sensitive personal information.",
      submit: 'Send Feedback',
      successMessage: 'Thank you for your feedback!',
      failureMessage: "Couldn't send your feedback. Please try again.",
    },
    syncStatus: {
      savedOnDevice: 'Saved on device',
      syncing: 'Syncing',
      synced: 'Synced',
      syncFailed: 'Sync failed',
    },
    audio: EN_AUDIO,
  },
  ar: {
    appName: 'Quran Heals',
    home: {
      subtitle: 'شفاءٌ لما في الصدور',
      eyebrow: 'عِشْ بالقرآن',
      title: 'بماذا تشعر الآن؟',
      loadingTitle: 'جارٍ تحميل المشاعر',
      loadingMessage: 'جارٍ إعداد قائمة المشاعر.',
      errorTitle: 'تعذّر الاتصال',
      retry: 'أعد المحاولة',
      disclaimer: 'تطبيق Quran Heals يقدّم تأملًا روحيًا، وليس بديلًا عن الرعاية المتخصصة.',
      sourcesCredit: 'نص القرآن: مشروع تنزيل (الرسم العثماني ١٫١) · تخطيط المصحف وخطوط QPC V1: Quran Foundation · خط المصحف وزخارفه: مجمع الملك فهد لطباعة المصحف الشريف.',
      sourcesLink: 'مصادر القرآن وحقوق النشر',
      openFavorites: 'فتح الآيات المحفوظة',
    },
    generalQuran: {
      action: 'رسالة من القرآن',
      loadError: 'تعذّر تحميل الآية. يُرجى المحاولة مرة أخرى.',
    },
    ayah: {
      kicker: 'آية مختارة لهذه اللحظة',
      goBack: 'رجوع',
      loadingTitle: 'جارٍ تحميل الآية',
      loadingMessage: 'جارٍ البحث عن آية مناسبة.',
      errorTitle: 'يرجى إعادة المحاولة',
      retry: 'أعد المحاولة',
      missingEmotion: 'يرجى اختيار شعور أولًا.',
      genericError: 'تعذّر تحميل آية الآن.',
      historyUnresolved: 'تعذّر استخدام بعض سجلات السجل القديمة لمنع التكرار. تم الاحتفاظ بسجلك المخزّن.',
      historyReadFailed: 'تعذّرت قراءة السجل الأخير. تم الاحتفاظ بسجلك المخزّن.',
      historySaveFailed: 'تعذّرت إضافة هذه الآية إلى السجل الأخير. تم الاحتفاظ بسجلك السابق.',
      share: 'مشاركة',
      shareAyah: 'مشاركة الآية',
      anotherAyah: 'آية أخرى',
      loadAnotherAyah: 'تحميل آية أخرى',
      connectionHeading: 'كيف ترتبط هذه الآية بشعورك',
      readInQuran: 'اقرأ الآية في المصحف',
      copyAyah: 'نسخ الآية',
      invalidLink: 'رابط الآية غير صالح. يرجى التحقق من الرابط وإعادة المحاولة.',
    },
    favorites: {
      title: 'الآيات المحفوظة',
      subtitle: 'المفضّلة المخزّنة على هذا الجهاز.',
      loadingTitle: 'جارٍ تحميل المفضّلة',
      loadingMessage: 'جارٍ فتح آياتك المحفوظة.',
      errorTitle: 'تعذّر فتح بعض الآيات المحفوظة',
      retry: 'أعد المحاولة',
      emptyTitle: 'لا توجد آيات محفوظة بعد',
      emptyMessage: 'احفظ آية وستظهر هنا.',
      unresolvedSuffix: 'من العناصر المحفوظة تعذّر فتحها. تم الاحتفاظ بسجلك المخزّن.',
      share: 'مشاركة',
      shareSaved: 'مشاركة الآية المحفوظة',
      remove: 'إزالة',
      removeSaved: 'إزالة الآية المحفوظة',
    },
    favoriteButton: {
      save: 'حفظ',
      saved: 'محفوظة',
      saveLabel: 'حفظ الآية في المفضّلة',
      removeLabel: 'إزالة الآية من المفضّلة',
    },
    reflections: {
      title: 'خواطري',
      subtitle: 'تدبّر وتفكّر مع القرآن',
      loadingTitle: 'جارٍ تحميل الخواطر',
      loadingMessage: 'جارٍ فتح خواطرك المحفوظة.',
      emptyTitle: 'لا توجد خواطر بعد',
      emptyMessage: 'افتح آية وأضف خاطرة، وستظهر هنا.',
      errorTitle: 'تعذّر فتح بعض الخواطر',
      errorMessage: 'تعذّرت قراءة خواطرك. تم الاحتفاظ ببياناتك المخزّنة.',
      retry: 'أعد المحاولة',
      referenceUnresolved: 'تعذّر التحقق من مرجع هذه الآية حاليًا.',
      editedLabel: 'آخر تعديل',
      statusSavedOnDevice: 'محفوظ على الجهاز',
      statusPendingSync: 'بانتظار التحديث',
      statusSynced: 'تم التحديث',
      openReflectionLabel: 'فتح الخاطرة الخاصة بـ',
      otherVersionBadge: 'توجد نسخة أخرى للمراجعة',
      recoveredBadge: 'لا توجد خاطرة حالية، لكن احتُفظ بنسخة أخرى. اضغط للمراجعة',
    },
    translation: {
      showTranslation: 'إظهار الترجمة',
      hideTranslation: 'إخفاء الترجمة',
    },
    share: {
      title: 'مشاركة الآية',
      close: 'إغلاق',
      preview: 'معاينة بطاقة الآية',
      card: 'البطاقة',
      previousCard: 'البطاقة السابقة',
      nextCard: 'البطاقة التالية',
      longAyahNote: 'تمتد هذه الآية على عدة بطاقات بالترتيب. تشمل المشاركة والحفظ جميع البطاقات دائمًا لتبقى الآية كاملة.',
      format: 'المقاس',
      formatStory: 'قصة',
      formatPost: 'منشور',
      formatSquare: 'مربع',
      background: 'الخلفية',
      themeSage: 'زيتوني',
      themeCream: 'كريمي',
      themeDark: 'ليلي',
      backgroundColors: 'الألوان',
      backgroundScenery: 'المناظر الطبيعية',
      newBackground: 'خلفية جديدة',
      sceneryLoadFailed: 'تعذّر تحميل هذه الخلفية. اضغط «خلفية جديدة» لاختيار غيرها.',
      showTranslation: 'إظهار الترجمة',
      share: 'مشاركة الصورة',
      shareAllCards: 'مشاركة كل البطاقات',
      saveImage: 'حفظ الصورة',
      saveAllImages: 'حفظ كل البطاقات',
      multipleUnavailable: 'لا يدعم هذا الإصدار من التطبيق مشاركة عدة صور معًا. احفظ كل البطاقات، ثم شاركها معًا من الصور.',
      copyLink: 'نسخ رابط الآية',
      linkCopied: 'تم نسخ رابط الآية.',
      linkAutoCopied: 'تم نسخ رابط الآية. ألصقه في ملصق الرابط في قصتك أو في رسالة.',
      copyLinkFailed: 'تعذّر نسخ الرابط. يرجى إعادة المحاولة.',
      linkHint: 'عند مشاركة الصورة، يُنسخ رابط الآية تلقائيًا. ألصقه في الرابط في قصتك ليتمكن الآخرون من فتحها.',
      preparing: 'جارٍ تجهيز الصورة…',
      saved: 'تم الحفظ في الصور.',
      savedAll: 'تم حفظ كل البطاقات في الصور.',
      saveDenied: 'يحتاج Quran Heals إلى إذن لإضافة الصورة إلى الصور.',
      saveBlocked: 'الوصول إلى الصور متوقف لتطبيق Quran Heals. يمكنك السماح به من الإعدادات.',
      openSettings: 'فتح الإعدادات',
      shareUnavailable: 'المشاركة غير متاحة على هذا الجهاز.',
      shareFailed: 'تعذّرت مشاركة الصورة. يرجى إعادة المحاولة.',
      saveFailed: 'تعذّر حفظ الصورة. يرجى إعادة المحاولة.',
      cannotFit: 'تعذّر تجهيز هذه البطاقة. يرجى تجربة مقاس آخر.',
    },
    mushaf: {
      title: 'المصحف',
      prototypeNote: 'نسخة تجريبية — الصفحة ٦١ فقط.',
      tapHint: 'اضغط على آية لتحديدها. باعد بين إصبعين للتكبير، واضغط مرتين للعودة إلى الصفحة كاملة.',
      pageLabel: 'صفحة المصحف',
      selectedAyah: 'الآية المحددة',
      clearSelection: 'إلغاء التحديد',
      readingStops: 'مواضع التوقف',
      stopNameLabel: 'اسم الوِرد (مثل: شخصي أو المسجد)',
      saveStop: 'حفظ موضع التوقف في هذه الصفحة',
      stopSaved: 'تم الحفظ',
      stopNameInvalid: 'أدخل اسمًا لا يزيد على ٤٠ حرفًا.',
      tooManyStops: 'لا يمكن إضافة موضع توقف آخر لكثرة المواضع المحفوظة. احذف واحدًا أولًا.',
      stopSaveFailed: 'تعذّر حفظ موضع التوقف. يرجى إعادة المحاولة.',
      noStops: 'لا توجد مواضع توقف بعد.',
      page: 'صفحة',
      removeStop: 'حذف',
      renameStop: 'تعديل الاسم',
      saveName: 'حفظ الاسم',
      cancelRename: 'إلغاء',
      stopRenamed: 'تم تحديث الاسم.',
      stopNameTaken: 'هذا الاسم مستخدم لموضع توقف آخر.',
      offlineTitle: "المصحف دون اتصال",
      offlineIntro: "صفحات المصحف الـ٦٠٤ كلها وخطوطها (حوالي ١٠٠ ميغابايت)، للقراءة دون اتصال بالإنترنت.",
      offlineDownload: "التنزيل للقراءة دون اتصال",
      offlineResume: "متابعة التنزيل",
      offlineCancel: "إلغاء",
      offlineDownloading: "جارٍ التنزيل",
      offlineVerifying: "جارٍ التحقق من التنزيل",
      offlineReady: "متاح دون اتصال",
      offlineUpdatedFrom: "آخر تحديث من Quran Foundation",
      offlineCheckUpdate: "التحقق من التحديثات",
      offlineUpToDate: "المصحف دون اتصال محدَّث.",
      offlineUpdated: "تم تحديث المصحف دون اتصال.",
      offlineRemove: "حذف النسخة دون اتصال",
      offlineCancelled: "تم إيقاف التنزيل مؤقتًا، وسيُستأنف من حيث توقف.",
      offlineErrorOffline: "لا يوجد اتصال. ما تم تنزيله محفوظ؛ حاول مرة أخرى عند الاتصال.",
      offlineErrorUnavailable: "المصحف دون اتصال غير متاح حاليًا. يُرجى المحاولة لاحقًا.",
      offlineErrorStorage: "لا توجد مساحة تخزين كافية على هذا الجهاز.",
      offlineErrorIntegrity: "تعذّر التحقق من التنزيل، لذلك لم يتغير شيء. يُرجى المحاولة مرة أخرى.",
      offlineErrorGeneric: "تعذّر حفظ المصحف دون اتصال. يُرجى المحاولة مرة أخرى.",
      offlineFonts: "جارٍ تنزيل خطوط الصفحات",
      offlineFontsCount: "خطوط الصفحات",
      offlineComplete: "المصحف كاملًا جاهز للقراءة دون اتصال",
      autoPreparing: "جارٍ تجهيز المصحف للقراءة دون اتصال",
      autoReady: "المصحف جاهز للقراءة دون اتصال",
      autoConsentCellular: "تنزيل المصحف للقراءة دون اتصال (حوالي ١٠٠ ميغابايت) باستخدام بيانات الجوال؟",
      autoConsentUnknown: "هل تريد تنزيل المصحف للقراءة دون اتصال الآن؟ حجمه حوالي ١٠٠ ميغابايت.",
      autoDownloadNow: "نزّله الآن",
      autoWaitForWifi: "انتظر شبكة Wi-Fi",
      autoNotNow: "ليس الآن",
      offlinePause: "إيقاف مؤقت",
      offlineRetry: "إعادة المحاولة",
      offlinePaused: "متوقف مؤقتًا، وما تم تنزيله محفوظ.",
      offlineWaitingWifi: "سيُنزَّل تلقائيًا عند الاتصال بشبكة Wi-Fi.",
      offlineWaitingNetwork: "في انتظار الاتصال بالإنترنت.",
      offlineRetrying: "ستُعاد المحاولة تلقائيًا بعد قليل.",
      previousPage: "الصفحة السابقة",
      nextPage: "الصفحة التالية",
      searchPage: 'البحث: صفحة أو سورة',
      pageNumberPlaceholder: "رقم الصفحة (١–٦٠٤)",
      goToPage: "انتقال إلى الصفحة",
      pageOutOfRange: "أدخل رقم صفحة من ١ إلى ٦٠٤.",
      enterFullScreen: 'القراءة بملء الشاشة',
      exitFullScreen: 'الخروج من ملء الشاشة',
      wirdChoose: 'اختر الوِرد',
      wirdSelectorLabel: 'الوِرد الحالي',
      wirdSelectorHint: 'يعرض قائمة الوِرد لتختار منها.',
      wirdAdd: 'أضف وِردًا',
      wirdNew: 'وِرد جديد في هذه الصفحة',
      wirdClose: 'إغلاق',
      navSurahTitle: "السور",
      navJuzTitle: "الأجزاء",
      navHizbTitle: "الأحزاب",
      juzSearchPlaceholder: "ابحث برقم الجزء (١–٣٠)",
      hizbSearchPlaceholder: "ابحث برقم الحزب (١–٦٠)",
      juzName: "الجزء {n}",
      hizbName: "الحزب {n}",
      divisionNoResults: "لا يوجد رقم مطابق.",
      openSurahs: "اختيار سورة",
      openJuz: "اختيار جزء",
      openHizb: "اختيار حزب",
      openPageSelector: "الانتقال إلى صفحة",
      pageSlider: "الصفحة",
      goToSelected: "الانتقال إلى الصفحة {page}",
      editPage: "اكتب رقم الصفحة",
      goToPageShort: "اذهب",
      guideSurah: "اضغط على اسم السورة للانتقال إلى سورة",
      guideHizb: "اضغط على رقم الحزب للانتقال إلى حزب",
      guidePage: "اضغط على رقم الصفحة للانتقال إلى صفحة",
      guideJuz: "اضغط على رقم الجزء للانتقال إلى جزء",
      guideAyah: "اضغط على الآية لعرض خياراتها",
      guideMarker: "اضغط على رقم الآية وقم بالتأكيد لحفظ موضع الوِرد",
      guideNext: "التالي",
      guideBack: "السابق",
      guideClose: "إغلاق",
      guideStart: "ابدأ القراءة",
      guideStepOf: "{n} من {total}",
      guideNotOnPage: "غير موجود في هذه الصفحة؛ يظهر في الصفحات التي يخصها.",
      guideHelp: "مساعدة",
      guideReopenHint: 'يمكنك عرض هذا الدليل مرة أخرى في أي وقت من الإعدادات ← القرآن ← دليل المصحف.',
      keyboardDone: "تم",
      actionReflection: "خاطرة",
      actionSave: "حفظ",
      actionSaved: "محفوظة",
      actionCopy: "نسخ",
      actionCopied: "تم النسخ",
      actionCopyFailed: "تعذّر نسخ الآية. يرجى إعادة المحاولة.",
      applyToWird: AR_APPLY_TO_WIRD,
      searchTitle: 'انتقل إلى',
      searchByPage: 'رقم الصفحة',
      searchBySurah: 'اسم السورة',
      surahSearchPlaceholder: 'ابحث في السور الـ١١٤',
      surahNoResults: 'لا توجد سورة بهذا الاسم.',
      goAction: 'انتقال',
      pageShort: 'صفحة',
      saveStopAction: "حفظ موضع توقف في هذه الصفحة",
      confirmStop: "حفظ موضع التوقف",
      pageNotDownloaded: "هذه الصفحة جزء من المصحف دون اتصال. نزّله لقراءة كل الصفحات.",
      pageUnavailable: "تعذّر عرض هذه الصفحة الآن. يُرجى المحاولة مرة أخرى.",
      renderer: "الخط",
      rendererQpc: "مصحف ١٤٠٥ (QPC V1)",
      rendererSvg: "Quran SVG (الطبعة الأحدث)",
      qpcLoading: "جارٍ تحميل صفحة مصحف ١٤٠٥…",
      qpcUnavailable: "صفحة مصحف ١٤٠٥ غير متاحة الآن، لذا تُعرض صفحة Quran SVG.",
      pageLoadError: 'تعذّر عرض هذه الصفحة.',
    },
    khatmDua: {
      title: 'دعاء ختم القرآن',
      unavailable: 'هذا الدعاء غير متاح بعد.',
      smaller: 'تصغير الخط',
      larger: 'تكبير الخط',
      open: 'دعاء ختم القرآن',
      back: 'رجوع',
    },
    tabs: {
      home: 'الرئيسية',
      howIFeel: 'مشاعري',
      mushaf: 'المصحف',
      myReading: 'الوِرد',
      reflections: 'خواطري',
    },
    continueReading: {
      title: 'متابعة التلاوة',
      mushaf: 'المصحف',
      myReading: 'الوِرد والختمات',
      pageOf: 'صفحة {page} من {total}',
      activeWird: 'الوِرد الحالي',
      lastSaved: 'آخر وِرد محفوظ',
      chooseWird: 'اختر الوِرد',
      switchHint: 'يعرض قائمة الوِرد لتختار منها.',
      firstTitle: 'ابدأ قراءتك',
      firstBody: 'افتح المصحف من صفحته الأولى، وتفكّر في آياته مع وِردٍ جديد.',
    },
    emotionsAll: {
      viewAll: 'عرض الكل',
      title: 'بماذا تشعر الآن؟',
      subtitle: 'وتطمئن القلوب',
      back: 'رجوع',
    },
    myReading: {
      title: 'الوِرد والختمات',
      subtitle: 'اقرأ وارتقِ',
      back: 'رجوع',
      statsTotal: 'الختمات',
      statsRamadan: 'ختمات رمضان',
      wirdsTitle: 'الوِرد',
      newWird: 'وِرد جديد',
      emptyTitle: 'لا يوجد وِرد بعد',
      emptyBody: 'أنشئ وِردًا لتحتفظ بموضعك في المصحف. لكل وِرد صفحته وتقدّمه وختماته.',
      pageOf: 'صفحة {page} من {total}',
      percent: 'الإنجاز {percent}٪',
      positionLabel: 'الإنجاز حسب الصفحة المحفوظة في المصحف',
      footnote: 'يُحفظ وِردك وختماتك على هذا الجهاز فقط. نسبة إنجاز الوِرد مبنية على آخر صفحة حفظتها، وليس عدد الصفحات التي تلوتها، ولا تُحتسب الختمة إلا بتأكيدك.',
      footnoteSynced: 'يُزامَن وِردك وختماتك مع حسابك بين الأجهزة المسجَّل دخولها به، وتُحفظ دائمًا على هذا الجهاز أولًا. نسبة إنجاز الوِرد مبنية على آخر صفحة حفظتها، وليس عدد الصفحات التي تلوتها، ولا تُحتسب الختمة إلا بتأكيدك.',
      syncSyncing: 'جارٍ المزامنة…',
      syncSynced: 'تمت المزامنة مع حسابك',
      syncPending: 'محفوظة على هذا الجهاز، وستُزامَن مع حسابك عند الاتصال بالإنترنت.',
      khatmaCount: 'الختمات: {count}',
      active: 'الحالي',
      continue: 'متابعة التلاوة',
      rename: 'إعادة التسمية',
      delete: 'حذف',
      pendingTitle: 'بلغ هذا الوِرد الصفحة ٦٠٤.',
      confirm: 'تأكيد إتمام الختمة',
      unconfirmedTitle: 'محفوظ عند الصفحة ٦٠٤',
      unconfirmedBody: 'حُفظ هذا الوِرد عند الصفحة ٦٠٤ دون دورة قراءة مسجّلة (قبل بدء تسجيل الختمات، أو أُنشئ على الصفحة ٦٠٤). لم يُحتسب شيء.',
      recordUnconfirmed: 'أتممت ختمة بهذا الوِرد',
      unconfirmedConfirmTitle: 'تسجيل ختمة مكتملة؟',
      unconfirmedConfirmBody: 'فقط إذا قرأت القرآن كاملًا بوِرد «{name}». ستُحتسب مرة واحدة، ويبدأ الوِرد من جديد من الصفحة ١.',
      duaEntry: 'دعاء ختم القرآن',
      historyTitle: 'الختمات المكتملة',
      historyEmpty: 'ستظهر هنا ختماتك المكتملة.',
      ramadanTag: 'رمضان {year} هـ',
      nonRamadanTag: 'خارج رمضان',
      removeKhatma: 'إزالة',
      removeTitle: 'إزالة هذه الختمة؟',
      removeBody: 'استخدم هذا لتصحيح خطأ فقط. يُعاد حساب الأعداد. إذا لم يُحفظ «{name}» منذ هذه الختمة فإنه يعود إلى الصفحة ٦٠٤ بانتظار تأكيد الختمة، وإلا فتبقى صفحته الحالية كما هي.',
      remove: 'إزالة',
      cancel: 'إلغاء',
      deleteTitle: 'حذف «{name}»؟',
      deleteBody: 'تُحذف صفحته المحفوظة، وتبقى ختماته المكتملة في سجلك وإجمالياتك.',
      createTitle: 'وِرد جديد',
      renameTitle: 'إعادة تسمية الوِرد',
      nameLabel: 'الاسم',
      startPageLabel: 'صفحة البداية (١–٦٠٤)',
      save: 'حفظ',
      create: 'إنشاء',
      nameInvalid: 'اكتب اسمًا لا يزيد على ٤٠ حرفًا.',
      nameTaken: 'يوجد وِرد آخر بهذا الاسم.',
      pageInvalid: 'اكتب رقم صفحة من ١ إلى ٦٠٤.',
      saveFailed: 'تعذّر الحفظ. يُرجى المحاولة مرة أخرى.',
      loadFailed: 'تعذّر تحميل وِردك.',
    },
    khatma: {
      reachedTitle: 'ما شاء الله، أتممت ختم القرآن',
      confirm: 'إتمام الختمة',
      notNow: 'ليس الآن',
      completeTitle: 'تقبل الله ختمتك',
      completeBody: 'نسأل الله أن يجعل القرآن نورًا لقلبك وشفيعًا لك',
      readDua: 'قراءة دعاء ختم القرآن',
      backToKhatmas: 'العودة إلى الوِرد والختمات',
      backToMushaf: 'العودة إلى المصحف',
      failed: 'تعذّر تسجيل الختمة. يُرجى المحاولة مرة أخرى.',
      completeAction: 'إتمام الختمة',
      notReadyTitle: 'لا يمكن إتمام ختمة هذا الوِرد من هنا',
      notReadyBody: 'راجِعه في الوِرد والختمات. لم يتغيّر شيء.',
      noWirdTitle: 'اختر وِردًا أولًا',
      noWirdBody: 'اختر الوِرد الذي أتممته من اسم الوِرد أسفل الصفحة، ثم حاول مرة أخرى.',
      newCycleTitle: 'سُجِّلت هذه الختمة بالفعل',
      newCycleBody: 'بدأ هذا الوِرد دورة قراءة جديدة. احفظ تقدّمك أثناء القراءة، ويمكنك إتمام الدورة الجديدة عند بلوغ الصفحة ٦٠٤ مجددًا. لم يتغيّر شيء.',
      saveFailedTitle: 'تعذّر حفظ الصفحة',
      saveFailedBody: 'لم يُسجَّل شيء. يُرجى المحاولة مرة أخرى.',
      notReadyOk: 'حسنًا',
    },
    credits: {
      title: 'مصادر القرآن وحقوق النشر',
      intro: 'يعرض Quran Heals القرآن الكريم من هذه المصادر، مع الشكر والتقدير. ويُعرض نص القرآن كما نُشر تمامًا، دون أي تغيير.',
      tanzilName: 'مشروع تنزيل (Tanzil)',
      tanzilWork: 'نص القرآن: الرسم العثماني، الإصدار ١٫١، دون أي تغيير. مرخّص بموجب رخصة المشاع الإبداعي «نَسب المُصنَّف» ٣٫٠.',
      quranFoundationName: 'Quran Foundation',
      quranFoundationWork: 'تخطيط صفحات المصحف وخطوط صفحات QPC V1 (مصحف المدينة ١٤٠٥هـ)، وفق شروط المطوّرين لدى Quran Foundation.',
      kingFahdName: 'مجمع الملك فهد لطباعة المصحف الشريف',
      kingFahdWork: 'الخط الأصلي للمصحف وزخارفه: مصحف المدينة ١٤٠٥هـ. خطوط QCF V1 © مجمع الملك فهد لطباعة المصحف الشريف. جميع الحقوق محفوظة.',
      amiriName: 'Amiri Project Authors (مؤلفو مشروع Amiri)',
      amiriWork: 'يُستخدم خط Amiri Bold لكتابة أسماء السور فقط، وليس لنص القرآن. تسمح رخصة SIL OFL 1.1 بتضمين الخط وإعادة توزيعه تجاريًا مع التطبيقات، ولا تسمح ببيع الخط منفردًا. وقد أُرفق إشعار حقوق النشر ونص الرخصة كاملًا مع التطبيق. الإطار الزخرفي تصميم أصلي من Quran Heals.',
      mp3quranName: 'MP3Quran',
      mp3quranWork: 'تلاوات القرآن الكريم وتوقيت آياتها، تُبَثّ من موقع mp3quran.net ويمكن تنزيلها للاستماع دون اتصال. وينصّ الموقع على أنه يحق لأي زائر أو مطوّر استخدام أي مادة منه.',
      tafsirCenterName: 'مركز تفسير للدراسات القرآنية',
      tafsirCenterWork: 'مقصد السورة في «عن السورة»: المختصر في تفسير القرآن الكريم (موسوعة القرآن الكريم QuranEnc.com). المكي والمدني وعدد الآيات: تنزيل.',
      website: 'الموقع',
      license: 'الرخصة',
      terms: 'شروط الاستخدام',
    },
    quranFontSize: {
      decreaseLabel: 'تصغير حجم نص القرآن',
      increaseLabel: 'تكبير حجم نص القرآن',
      auto: 'تلقائي',
      autoLabel: 'إعادة ضبط حجم نص القرآن تلقائيًا',
    },
    settings: {
      title: 'الإعدادات',
      subtitle: 'اللغة والمظهر والتذكيرات وحسابك.',
      openSettings: 'فتح الإعدادات',
      appLanguageSection: 'لغة التطبيق',
      emotionsLanguageSection: 'لغة المشاعر',
      emotionsFollowApp: 'حسب لغة التطبيق',
      emotionsEnglish: 'الإنجليزية',
      emotionsArabicStandard: 'العربية الفصحى',
      emotionsArabicEgyptian: 'العربية المصرية',
      quranTranslationNone: 'بدون ترجمة',
      keepAwakeTitle: 'إبقاء الشاشة مضاءة',
      keepAwakeDescription: 'منع قفل الشاشة تلقائيًا أثناء قراءة المصحف.',
      wordMeaningsVisibleTitle: 'معاني الكلمات',
      mushafGuideTitle: 'دليل المصحف',
      offlineMushafTitle: 'المصحف بدون إنترنت',
      offlineMushafAvailable: 'متاح بدون إنترنت',
      offlineMushafRequired: 'يحتاج إلى تحميل',
      offlineMushafDownloading: 'جارٍ التحميل',
      offlineMushafFailed: 'فشل التحميل',
      offlineMushafDownloadHint: 'اضغط لتحميل المصحف كاملًا للقراءة بدون إنترنت.',
      quranTranslationSection: 'ترجمة القرآن',
      translationDisplayAlways: 'دائمًا',
      translationDisplayOnDemand: 'عند الطلب',
      translationDisplayOff: 'إيقاف',
      translationDisplayAlwaysHint: 'يظهر النص العربي والترجمة الإنجليزية معًا تلقائيًا.',
      translationDisplayOnDemandHint: 'يظهر النص العربي أولًا، ويمكنك إظهار الترجمة متى شئت.',
      translationDisplayOffHint: 'النص العربي فقط. لن تظهر الترجمة.',
      quranArabicNote: 'يظهر القرآن بالعربية دائمًا — هذا الإعداد يؤثر فقط على الترجمة الإنجليزية.',
      legalSection: 'السياسات والشروط',
      privacyPolicy: 'سياسة الخصوصية',
      termsOfUse: 'شروط الخدمة',
      accountDeletionInfo: 'حذف الحساب والبيانات',
      opensInBrowser: 'تُفتح في المتصفح',
      appSection: 'التطبيق',
      emotionsSection: 'المشاعر',
      quranSection: 'القرآن',
      supportSection: 'الدعم',
      showTranslationTitle: 'إظهار الترجمة',
      showTranslationDescription: 'الترجمة الإنجليزية تحت كل آية.',
      translationModeLabel: 'عرض الترجمة',
      translationModeAlways: 'دائمًا',
      translationModeOnDemand: 'عند الطلب',
    },
    notifications: {
      wirdReminderTitle: 'تذكير الوِرد',
      randomAyahTitle: 'آية من القرآن',
      emotionCheckInTitle: 'تستحق الطمأنينة',
      frequencyLabel: 'التكرار',
      frequencyDaily: 'يوميًا',
      frequencyEvery3Days: 'كل ٣ أيام',
      frequencyWeekly: 'أسبوعيًا',
      frequencyTwiceDaily: 'مرتين يوميًا',
      twiceMorning: 'صباحًا',
      twiceEvening: 'مساءً',
      twiceSameTime: 'اختر وقتين مختلفين.',
      reminderTimeLabel: 'وقت التذكير',
      chooseDay: 'اختيار اليوم',
      changeHint: 'يفتح الخيارات لتغييره.',
      toggleHint: 'تشغيل هذا التذكير أو إيقافه.',
      timePickerConfirm: 'تعيين الوقت',
      timePickerCancel: 'إلغاء',
      am: 'ص',
      pm: 'م',
      weekday1: 'الأحد',
      weekday2: 'الاثنين',
      weekday3: 'الثلاثاء',
      weekday4: 'الأربعاء',
      weekday5: 'الخميس',
      weekday6: 'الجمعة',
      weekday7: 'السبت',
      permissionRequired: 'يلزم السماح بالإشعارات',
      permissionDeniedHint: 'الإشعارات متوقفة لتطبيق Quran Heals في إعدادات جهازك.',
      permissionAllow: 'السماح بالإشعارات',
      permissionOpenSettings: 'فتح إعدادات الجهاز',
      permissionSheetTitle: 'السماح بالإشعارات؟',
      permissionSheetBody: 'اسمح بالإشعارات لتصلك تذكيرات بوِردك، وآية من القرآن، ولحظة طمأنينة لقلبك.',
      permissionSheetPrivacy: 'تُجدول التذكيرات على جهازك، وتعمل دون اتصال بالإنترنت.',
      permissionSheetConfirm: 'متابعة',
      permissionSheetCancel: 'ليس الآن',
      unsupported: 'التذكيرات متاحة في تطبيق iPhone وAndroid.',
      scheduleError: 'تعذّرت جدولة هذا التذكير. ستُعاد المحاولة عند عودتك إلى التطبيق.',
      wirdNotificationTitle: 'وقت وردك القرآني',
      wirdNotificationBody: 'واصل وِردك اليوم وخصص وقتًا لقراءة القرآن.',
      wirdNotificationBodyPage: 'أكمل ورد {name} من الصفحة {page}.',
      wirdNotificationBodyPageDefinite: 'أكمل وردك {name} من الصفحة {page}.',
      randomAyahNotificationTitle: 'آية من القرآن لك اليوم',
      randomAyahNotificationReference: 'سورة {surah} · الآية {ayah}',
      checkInNotificationTitle: 'تستحق السكينة ❤️',
      checkInNotificationBody: 'مهما كان شعورك، في القرآن ما يلامس قلبك.',
    },
    appearance: {
      sectionLabel: 'المظهر',
      system: 'حسب النظام',
      light: 'وضع النهار',
      dark: 'وضع الليل',
    },
    auth: {
      syncPrompt: 'سجّل الدخول لتجد محتواك المحفوظ على أجهزتك الأخرى',
      continueWithoutAccount: 'المتابعة دون حساب',
      continueWithApple: 'المتابعة باستخدام Apple',
      continueWithGoogle: 'المتابعة باستخدام Google',
      signInFailed: 'تعذّر تسجيل الدخول. يمكنك المحاولة مرة أخرى أو المتابعة دون حساب.',
    },
    account: {
      sectionTitle: 'الحساب',
      checkingSession: 'جارٍ التحقق من تسجيل الدخول…',
      notSignedIn: 'لم يتم تسجيل الدخول',
      signInWithApple: 'تسجيل الدخول باستخدام Apple',
      signInWithGoogle: 'تسجيل الدخول باستخدام Google',
      signedIn: 'تم تسجيل الدخول',
      signOut: 'تسجيل الخروج',
      dangerZoneTitle: 'منطقة الخطر',
      deleteAccountAction: 'حذف الحساب',
      deleteAccountActionDescription: 'حذف حساب Quran Heals وجميع بياناته نهائيًا.',
    },
    ageConfirmation: {
      title: 'قبل المتابعة',
      description: 'لإنشاء حساب في قرآن يشفي، يجب ألا يقل عمرك عن ١٦ عامًا، مع مراعاة الحد الأدنى للسن في بلدك.',
      checkbox: 'أؤكد أن عمري يسمح لي بإنشاء حساب.',
      continueButton: 'متابعة',
      cancel: 'إلغاء',
    },
    // Account-deletion confirmation copy is a security/destructive-action
    // flow — intentionally byte-identical Standard Arabic in `ar` and
    // `ar-EG`, never Egyptian colloquial (matches the mandatory Sync
    // Password flow's precedent).
    deleteAccount: {
      title: 'حذف حسابك؟',
      description:
        'سيؤدي هذا إلى حذف حساب Quran Heals وخواطرك المحفوظة وآياتك المفضلة وتفضيلاتك وجميع البيانات المرتبطة بالحساب نهائيًا. لا يمكن التراجع عن هذا الإجراء.',
      confirmationInstruction: 'للتأكيد، اكتب حذف في الحقل أدناه.',
      confirmationWord: 'حذف',
      placeholder: 'اكتب حذف',
      deleteButton: 'حذف حسابي نهائيًا',
      deleting: 'جارٍ الحذف…',
      cancel: 'إلغاء',
      successMessage: 'تم حذف حسابك في Quran Heals.',
      failureMessage: 'تعذّر حذف حسابك الآن. يرجى المحاولة مرة أخرى.',
    },
    reflection: {
      action: 'خواطر',
      writeAction: 'أضف خاطرة',
      title: 'خواطر حول هذه الآية',
      prompt: 'ما الشعور الذي تركته هذه الآية في نفسك؟',
      placeholder: 'اكتب ما تركته هذه الآية في قلبك...',
      guestNote: 'تُحفظ خواطرك على هذا الجهاز. سجّل الدخول للوصول إليها عبر أجهزتك.',
      syncedNote: 'يتم تحديث خواطرك بشكل خاص بين أجهزتك التي سجّلت الدخول عليها.',
      save: 'حفظ',
      cancel: 'إلغاء',
      deleteAction: 'حذف الخاطرة',
      deleteConfirmTitle: 'حذف الخاطرة؟',
      deleteConfirmMessage: 'ستُحذف هذه الخاطرة من هذا الجهاز وأجهزتك الأخرى التي سجّلت الدخول عليها.',
      deleteConfirmCancel: 'إلغاء',
      deleteConfirmConfirm: 'حذف',
      deleteError: 'تعذّر حذف خاطرتك. يُرجى المحاولة مرة أخرى.',
      saveError: 'تعذّر حفظ خاطرتك. يُرجى المحاولة مرة أخرى.',
      otherVersionsTitle: 'نسخة أخرى من هذه الخاطرة',
      otherVersionsHint: 'عُدِّلت هذه الخاطرة على أكثر من جهاز قبل تحديثها بينها. لم يُحذف شيء: اختر ما تريد الاحتفاظ به، ثم اضغط حفظ.',
      otherVersionThisDevice: 'كُتبت على هذا الجهاز',
      otherVersionOtherDevice: 'من جهاز آخر',
      otherVersionDeletedElsewhere: 'كُتبت على هذا الجهاز قبل حذفها على جهاز آخر',
      useOtherVersion: 'استخدم هذه النسخة',
      addOtherVersion: 'أضفها إلى نصّي',
      copyOtherVersion: 'نسخ',
      copiedOtherVersion: 'تم النسخ',
      discardOtherVersion: 'تجاهل',
      discardOtherVersionTitle: 'تجاهل هذه النسخة؟',
      discardOtherVersionMessage: 'سيُزال هذا النص من هذا الجهاز، ولا يمكن التراجع عن ذلك.',
      otherVersionTooLong: 'النص أطول من أن يُضاف إلى نصّك. انسخه بدلًا من ذلك.',
    },
    guestData: {
      title: "إضافة البيانات المحفوظة على هذا الجهاز إلى هذا الحساب؟",
      body: "لديك مفضلة أو خواطر أو وِرد وختمات محفوظة على هذا الجهاز. هل تريد إضافتها إلى هذا الحساب؟ ستُزامَن بعد ذلك بين أجهزتك المسجَّل دخولها بهذا الحساب.",
      add: "إضافة إلى هذا الحساب",
      keepSeparate: "إبقاؤها منفصلة",
    },
    syncPassphrase: {
      createTitle: "إنشاء كلمة المرور",
      unlockTitle: "أدخل كلمة المرور",
      createDescription: "أنشئ كلمة مرور لحماية وتشفير خواطرك الخاصة عند تحديثها عبر أجهزتك. لا يمكن لتطبيق Quran Heals استعادة كلمة المرور إذا نسيتها، لذا اختر كلمة مرور يمكنك تذكرها.",
      unlockDescription: "أدخل كلمة المرور لفتح خواطرك المشفّرة على هذا الجهاز.",
      createPlaceholder: "كلمة المرور",
      unlockPlaceholder: "كلمة المرور",
      continueLabel: "متابعة",
      confirmPassword: "تأكيد كلمة المرور",
      show: "إظهار",
      hide: "إخفاء",
      lengthHint: "استخدم من 8 إلى 32 حرفًا.",
      allowedHint: "يمكنك استخدام الحروف والأرقام والرموز.",
      mismatch: "كلمتا المرور غير متطابقتين.",
      tooShort: "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.",
      tooLong: "لا يمكن أن تتجاوز كلمة المرور 32 حرفًا.",
      changeTitle: "تغيير كلمة المرور",
      currentPassword: "كلمة المرور الحالية",
      newPassword: "كلمة المرور الجديدة",
      confirmNewPassword: "تأكيد كلمة المرور الجديدة",
      mustDiffer: "يجب أن تكون كلمة المرور الجديدة مختلفة عن كلمة المرور الحالية.",
      incorrectError: "كلمة المرور الحالية غير صحيحة.",
      changeDescription: "غيّر كلمة المرور الخاصة بخواطرك المشفّرة المحفوظة.",
      saveError: "تعذّر تأكيد تغيير كلمة المرور. تحقق من اتصالك وحاول مرة أخرى. إذا تم حفظ التغيير، فاستخدم كلمة المرور الجديدة.",
      loadError: "تعذّر تحميل كلمة المرور. يُرجى المحاولة مرة أخرى.",
      retry: "حاول مرة أخرى",
      forgotPassword: "نسيت كلمة المرور؟",
      resetTitle: "إعادة تعيين مزامنة الخواطر المشفّرة؟",
      resetUnrecoverable: "لا يمكن استعادة كلمة المرور.",
      resetCloudLoss: "ستؤدي إعادة التعيين إلى حذف الخواطر المحفوظة في حسابك نهائيًا، إلا إذا كانت محفوظة على هذا الجهاز.",
      resetConfirm: "إعادة التعيين",
      resetBack: "رجوع",
      resetError: "تعذّر إكمال إعادة التعيين. تحقق من اتصالك وحاول مرة أخرى.",
      resetting: "جارٍ إعادة التعيين…",
      deleteAccountInstead: "حذف حسابي بدلًا من ذلك",
      reauthNoticeApple: "للتأكد من هويتك، ستسجّل الدخول مجددًا بحساب Apple نفسه الذي تستخدمه في Quran Heals.",
      reauthNoticeGoogle: "للتأكد من هويتك، ستسجّل الدخول مجددًا بحساب Google نفسه الذي تستخدمه في Quran Heals.",
      reauthCancelled: "لم يكتمل التحقق من الهوية. لم تتم إعادة تعيين أي شيء.",
      reauthFailed: "تعذّر التأكد من هويتك بالحساب الذي سجّلت الدخول به. لم تتم إعادة تعيين أي شيء.",
      reauthUnavailable: "التحقق من الهوية غير متاح على هذا الجهاز. لا يزال بإمكانك تسجيل الخروج أو حذف حسابك.",
      verifying: "جارٍ التحقق…",
    },
    issueReport: {
      action: 'الإبلاغ عن مشكلة',
      description: 'أخبرنا بالمشكلة التي لاحظتها. يساعدنا بلاغك على تحسين Quran Heals.',
      categoryAyahNotRelevant: 'الآية لا تبدو مرتبطة بالشعور',
      categoryQuranTextDisplay: 'مشكلة في عرض نص القرآن',
      categoryTranslationIssue: 'مشكلة في الترجمة',
      categoryAppTechnicalIssue: 'مشكلة تقنية في التطبيق',
      categoryOther: 'أخرى',
      emailLabel: 'البريد الإلكتروني للمتابعة (اختياري)',
      submit: 'إرسال',
      cancel: 'إلغاء',
      done: 'تم',
      successMessage: 'شكرًا لك. تم استلام بلاغك.',
      failureMessage: 'تعذّر إرسال البلاغ. يُرجى المحاولة مرة أخرى.',
      flagAction: 'الإبلاغ عن مشكلة في هذه الآية',
      settingsDescription: 'أخبرنا إذا واجهتك مشكلة في التطبيق.',
      aboutAyah: 'يتضمن هذا البلاغ الآية:',
      commentLabel: 'ما هي المشكلة؟',
      commentRequired: 'يُرجى وصف المشكلة.',
      emailInvalid: 'يُرجى إدخال بريد إلكتروني صحيح.',
    },
    feedback: {
      action: 'شاركنا رأيك',
      sheetTitle: 'شاركنا رأيك',
      sheetDescription: 'شاركنا أفكارك لنطوّر Quran Heals معًا.',
      messageLabel: 'شاركنا رأيك أو اقتراحاتك...',
      messageRequired: 'يُرجى كتابة رأيك أو اقتراحك.',
      privacyNote: 'يُرجى عدم مشاركة معلومات شخصية هامة.',
      submit: 'إرسال الملاحظات',
      successMessage: 'شكرًا لمشاركتنا رأيك!',
      failureMessage: 'تعذّر إرسال ملاحظاتك. يُرجى المحاولة مرة أخرى.',
    },
    syncStatus: {
      savedOnDevice: 'محفوظ على الجهاز',
      syncing: 'جارٍ التحديث',
      synced: 'تم التحديث',
      syncFailed: 'تعذّر التحديث',
    },
    audio: AR_AUDIO,
  },
  'ar-EG': {
    appName: 'Quran Heals',
    home: {
      subtitle: 'رسالة من القرآن لكل إحساس بتحسه',
      eyebrow: 'عِشْ بالقرآن',
      title: 'إيه إحساسك دلوقتي؟',
      loadingTitle: 'بنحمّل المشاعر',
      loadingMessage: 'بنجهّز قائمة المشاعر.',
      errorTitle: 'مش قادرين نتصل',
      retry: 'جرّب تاني',
      disclaimer: 'تطبيق Quran Heals يقدّم تأملًا روحيًا، وليس بديلًا عن الرعاية المتخصصة.',
      sourcesCredit: 'نص القرآن: مشروع تنزيل (الرسم العثماني ١٫١) · تخطيط المصحف وخطوط QPC V1: Quran Foundation · خط المصحف وزخارفه: مجمع الملك فهد لطباعة المصحف الشريف.',
      sourcesLink: 'مصادر القرآن وحقوق النشر',
      openFavorites: 'افتح الآيات المحفوظة',
    },
    // Standard Arabic, same as `ar` — general UI (Part J §47), not one of
    // the three approved Egyptian exceptions.
    generalQuran: {
      action: 'رسالة من القرآن',
      loadError: 'تعذّر تحميل الآية. يُرجى المحاولة مرة أخرى.',
    },
    // Loading/retry/error/placeholder wording while an ayah is being
    // obtained is Standard Arabic, same as `ar` — not one of the three
    // approved Egyptian exceptions (Part J §47), and consistent with
    // favorites' own loading/error/retry wording below.
    ayah: {
      kicker: 'آية مختارة لهذه اللحظة',
      goBack: 'رجوع',
      loadingTitle: 'جارٍ تحميل الآية',
      loadingMessage: 'جارٍ البحث عن آية مناسبة.',
      errorTitle: 'يرجى إعادة المحاولة',
      retry: 'أعد المحاولة',
      missingEmotion: 'يرجى اختيار شعور أولًا.',
      genericError: 'تعذّر تحميل آية الآن.',
      historyUnresolved: 'بعض السجل القديم متقدرناش نستخدمه عشان منكررش. سجلك المخزّن اتحفظ.',
      historyReadFailed: 'متقدرناش نقرا السجل الأخير. سجلك المخزّن اتحفظ.',
      historySaveFailed: 'متقدرناش نضيف الآية دي للسجل الأخير. سجلك القديم اتحفظ.',
      share: 'مشاركة',
      shareAyah: 'شارك الآية',
      anotherAyah: 'آية أخرى',
      loadAnotherAyah: 'تحميل آية أخرى',
      connectionHeading: 'كيف ترتبط هذه الآية بشعورك',
      readInQuran: 'اقرأ الآية في المصحف',
      copyAyah: 'نسخ الآية',
      invalidLink: 'رابط الآية ده مش صالح. اتأكد من الرابط وجرّب تاني.',
    },
    // Loading/error/retry/empty-state wording is Standard Arabic, same as
    // `ar` — see the doc comment on `ayah` above.
    favorites: {
      title: 'الآيات المحفوظة',
      subtitle: 'المفضّلة محفوظة على هذا الجهاز.',
      loadingTitle: 'جارٍ تحميل المفضّلة',
      loadingMessage: 'جارٍ فتح آياتك المحفوظة.',
      errorTitle: 'تعذّر فتح بعض الآيات المحفوظة',
      retry: 'أعد المحاولة',
      emptyTitle: 'لا توجد آيات محفوظة بعد',
      emptyMessage: 'احفظ آية وستظهر هنا.',
      unresolvedSuffix: 'من العناصر المحفوظة تعذّر فتحها. تم الاحتفاظ بسجلك المخزّن.',
      share: 'مشاركة',
      shareSaved: 'شارك الآية المحفوظة',
      remove: 'إزالة',
      removeSaved: 'إزالة الآية المحفوظة',
    },
    favoriteButton: {
      save: 'احفظ',
      saved: 'محفوظة',
      saveLabel: 'احفظ الآية في المفضّلة',
      removeLabel: 'إزالة الآية من المفضّلة',
    },
    // Standard Arabic, same as `ar` — general UI (Part J §47), not one of
    // the three approved Egyptian exceptions.
    reflections: {
      title: 'خواطري',
      subtitle: 'تدبّر وتفكّر مع القرآن',
      loadingTitle: 'جارٍ تحميل الخواطر',
      loadingMessage: 'جارٍ فتح خواطرك المحفوظة.',
      emptyTitle: 'لا توجد خواطر بعد',
      emptyMessage: 'افتح آية وأضف خاطرة، وستظهر هنا.',
      errorTitle: 'تعذّر فتح بعض الخواطر',
      errorMessage: 'تعذّرت قراءة خواطرك. تم الاحتفاظ ببياناتك المخزّنة.',
      retry: 'أعد المحاولة',
      referenceUnresolved: 'تعذّر التحقق من مرجع هذه الآية حاليًا.',
      editedLabel: 'آخر تعديل',
      statusSavedOnDevice: 'محفوظ على الجهاز',
      statusPendingSync: 'بانتظار التحديث',
      statusSynced: 'تم التحديث',
      openReflectionLabel: 'فتح الخاطرة الخاصة بـ',
      otherVersionBadge: 'توجد نسخة أخرى للمراجعة',
      recoveredBadge: 'لا توجد خاطرة حالية، لكن احتُفظ بنسخة أخرى. اضغط للمراجعة',
    },
    translation: {
      showTranslation: 'عرض الترجمة',
      hideTranslation: 'إخفاء الترجمة',
    },
    share: {
      title: 'مشاركة الآية',
      close: 'إغلاق',
      preview: 'معاينة بطاقة الآية',
      card: 'البطاقة',
      previousCard: 'البطاقة اللي قبلها',
      nextCard: 'البطاقة اللي بعدها',
      longAyahNote: 'الآية دي بتكمل على كذا بطاقة بالترتيب. المشاركة والحفظ دايمًا بيشملوا كل البطاقات عشان الآية تفضل كاملة.',
      format: 'المقاس',
      formatStory: 'ستوري',
      formatPost: 'بوست',
      formatSquare: 'مربع',
      background: 'الخلفية',
      themeSage: 'زيتوني',
      themeCream: 'كريمي',
      themeDark: 'ليلي',
      backgroundColors: 'الألوان',
      backgroundScenery: 'المناظر الطبيعية',
      newBackground: 'خلفية جديدة',
      sceneryLoadFailed: 'الخلفية دي ماتحمّلتش. دوس «خلفية جديدة» واختار غيرها.',
      showTranslation: 'عرض الترجمة',
      share: 'شارك الصورة',
      shareAllCards: 'شارك كل البطاقات',
      saveImage: 'احفظ الصورة',
      saveAllImages: 'احفظ كل البطاقات',
      multipleUnavailable: 'النسخة دي من التطبيق مش بتقدر تشارك كذا صورة مع بعض. احفظ كل البطاقات، وبعدين شاركهم مع بعض من الصور.',
      copyLink: 'انسخ رابط الآية',
      linkCopied: 'رابط الآية اتنسخ.',
      linkAutoCopied: 'رابط الآية اتنسخ. الصقه في الرابط في الستوري أو في رسالة.',
      copyLinkFailed: 'متقدرناش ننسخ الرابط. جرّب تاني.',
      linkHint: 'لما تشارك الصورة، رابط الآية بيتنسخ تلقائيًا. الصقه في الرابط في الستوري عشان الناس يقدروا يفتحوها.',
      preparing: 'بنجهّز الصورة…',
      saved: 'اتحفظت في الصور.',
      savedAll: 'كل البطاقات اتحفظت في الصور.',
      saveDenied: 'Quran Heals محتاج إذن عشان يضيف الصورة للصور.',
      saveBlocked: 'الوصول للصور مقفول لـ Quran Heals. تقدر تسمح بيه من الإعدادات.',
      openSettings: 'افتح الإعدادات',
      shareUnavailable: 'المشاركة مش متاحة على الجهاز ده.',
      shareFailed: 'متقدرناش نشارك الصورة. جرّب تاني.',
      saveFailed: 'متقدرناش نحفظ الصورة. جرّب تاني.',
      cannotFit: 'متقدرناش نجهّز البطاقة دي. جرّب مقاس تاني.',
    },
    mushaf: {
      title: 'المصحف',
      prototypeNote: 'نسخة تجريبية — الصفحة ٦١ بس.',
      tapHint: 'دوس على آية عشان تختارها. بعّد صباعين عن بعض عشان تكبّر، ودوس مرتين عشان ترجع للصفحة كلها.',
      pageLabel: 'صفحة المصحف',
      selectedAyah: 'الآية اللي اخترتها',
      clearSelection: 'الغي الاختيار',
      readingStops: 'أماكن الوقوف',
      stopNameLabel: 'اسم الوِرد (زي: شخصي أو المسجد)',
      saveStop: 'احفظ مكان الوقوف في الصفحة دي',
      stopSaved: 'تم الحفظ',
      stopNameInvalid: 'اكتب اسم مش أكتر من ٤٠ حرف.',
      tooManyStops: 'عندك أماكن وقوف كتير، ومينفعش تضيف تاني. امسح واحد الأول.',
      stopSaveFailed: 'متقدرناش نحفظ مكان الوقوف. جرّب تاني.',
      noStops: 'مفيش أماكن وقوف لسه.',
      page: 'صفحة',
      removeStop: 'امسح',
      renameStop: 'غيّر الاسم',
      saveName: 'احفظ الاسم',
      cancelRename: 'إلغاء',
      stopRenamed: 'الاسم اتغيّر.',
      stopNameTaken: 'الاسم ده مستخدم لمكان وقوف تاني.',
      offlineTitle: "المصحف من غير نت",
      offlineIntro: "صفحات المصحف الـ٦٠٤ كلها وخطوطها (حوالي ١٠٠ ميجا)، عشان تقرا من غير نت.",
      offlineDownload: "نزّله للقراية من غير نت",
      offlineResume: "كمّل التنزيل",
      offlineCancel: "إلغاء",
      offlineDownloading: "بيتنزّل",
      offlineVerifying: "بنتأكد من التنزيل",
      offlineReady: "متاح من غير نت",
      offlineUpdatedFrom: "آخر تحديث من Quran Foundation",
      offlineCheckUpdate: "شوف لو فيه تحديث",
      offlineUpToDate: "المصحف اللي من غير نت محدّث.",
      offlineUpdated: "المصحف اللي من غير نت اتحدّث.",
      offlineRemove: "امسح النسخة اللي من غير نت",
      offlineCancelled: "التنزيل وقف، وهيكمّل من مكان ما وقف.",
      offlineErrorOffline: "مفيش نت. اللي اتنزّل محفوظ؛ جرّب تاني لما النت يرجع.",
      offlineErrorUnavailable: "المصحف اللي من غير نت مش متاح دلوقتي. جرّب تاني بعدين.",
      offlineErrorStorage: "مفيش مساحة كفاية على الجهاز.",
      offlineErrorIntegrity: "ماقدرناش نتأكد من التنزيل، فمفيش حاجة اتغيرت. جرّب تاني.",
      offlineErrorGeneric: "ماقدرناش نحفظ المصحف اللي من غير نت. جرّب تاني.",
      offlineFonts: "بيتنزّل خطوط الصفحات",
      offlineFontsCount: "خطوط الصفحات",
      offlineComplete: "المصحف كله جاهز تقراه من غير نت",
      autoPreparing: "بنجهّز المصحف عشان تقراه من غير نت",
      autoReady: "المصحف جاهز تقراه من غير نت",
      autoConsentCellular: "تنزّل المصحف للقراية من غير نت (حوالي ١٠٠ ميجا) بباقة الموبايل؟",
      autoConsentUnknown: "تحب تنزّل المصحف للقراية من غير نت دلوقتي؟ حجمه حوالي ١٠٠ ميجا.",
      autoDownloadNow: "نزّله دلوقتي",
      autoWaitForWifi: "استنى الواي فاي",
      autoNotNow: "مش دلوقتي",
      offlinePause: "وقّف شوية",
      offlineRetry: "جرّب تاني",
      offlinePaused: "واقف، واللي اتنزّل محفوظ.",
      offlineWaitingWifi: "هيتنزّل لوحده لما تتصل بالواي فاي.",
      offlineWaitingNetwork: "مستنيين النت.",
      offlineRetrying: "هنجرّب تاني لوحدنا كمان شوية.",
      previousPage: "الصفحة اللي قبل",
      nextPage: "الصفحة اللي بعد",
      searchPage: 'دوّر على صفحة أو سورة',
      pageNumberPlaceholder: "رقم الصفحة (١–٦٠٤)",
      goToPage: "روح للصفحة",
      pageOutOfRange: "اكتب رقم صفحة من ١ لـ ٦٠٤.",
      enterFullScreen: 'اقرأ بملء الشاشة',
      exitFullScreen: 'اخرج من ملء الشاشة',
      wirdChoose: 'اختار الوِرد',
      wirdSelectorLabel: 'الوِرد الحالي',
      wirdSelectorHint: 'بيعرض قائمة الوِرد عشان تختار منها.',
      wirdAdd: 'ضيف وِرد',
      wirdNew: 'وِرد جديد في الصفحة دي',
      wirdClose: 'اقفل',
      navSurahTitle: "السور",
      navJuzTitle: "الأجزاء",
      navHizbTitle: "الأحزاب",
      juzSearchPlaceholder: "دوّر برقم الجزء (١–٣٠)",
      hizbSearchPlaceholder: "دوّر برقم الحزب (١–٦٠)",
      juzName: "الجزء {n}",
      hizbName: "الحزب {n}",
      divisionNoResults: "مفيش رقم زي ده.",
      openSurahs: "اختار سورة",
      openJuz: "اختار جزء",
      openHizb: "اختار حزب",
      openPageSelector: "روح لصفحة",
      pageSlider: "الصفحة",
      goToSelected: "روح للصفحة {page}",
      editPage: "اكتب رقم الصفحة",
      goToPageShort: "روح",
      guideSurah: "اضغط على اسم السورة للانتقال إلى سورة",
      guideHizb: "اضغط على رقم الحزب للانتقال إلى حزب",
      guidePage: "اضغط على رقم الصفحة للانتقال إلى صفحة",
      guideJuz: "اضغط على رقم الجزء للانتقال إلى جزء",
      guideAyah: "اضغط على الآية لعرض خياراتها",
      guideMarker: "اضغط على رقم الآية وقم بالتأكيد لحفظ موضع الوِرد",
      guideNext: "التالي",
      guideBack: "السابق",
      guideClose: "إغلاق",
      guideStart: "ابدأ القراءة",
      guideStepOf: "{n} من {total}",
      guideNotOnPage: "غير موجود في هذه الصفحة؛ يظهر في الصفحات التي يخصها.",
      guideHelp: "مساعدة",
      guideReopenHint: 'يمكنك عرض هذا الدليل مرة أخرى في أي وقت من الإعدادات ← القرآن ← دليل المصحف.',
      keyboardDone: "تم",
      actionReflection: "خاطرة",
      actionSave: "حفظ",
      actionSaved: "محفوظة",
      actionCopy: "نسخ",
      actionCopied: "تم النسخ",
      actionCopyFailed: "تعذّر نسخ الآية. يرجى إعادة المحاولة.",
      applyToWird: AR_APPLY_TO_WIRD,
      searchTitle: 'روح لـ',
      searchByPage: 'رقم الصفحة',
      searchBySurah: 'اسم السورة',
      surahSearchPlaceholder: 'دوّر في الـ١١٤ سورة',
      surahNoResults: 'مفيش سورة بالاسم ده.',
      goAction: 'روح',
      pageShort: 'صفحة',
      saveStopAction: "احفظ مكان وقوف في الصفحة دي",
      confirmStop: "احفظ مكان الوقوف",
      pageNotDownloaded: "الصفحة دي جزء من المصحف اللي من غير نت. نزّله عشان تقرا كل الصفحات.",
      pageUnavailable: "مش قادرين نعرض الصفحة دي دلوقتي. جرّب تاني.",
      renderer: "الخط",
      rendererQpc: "مصحف ١٤٠٥ (QPC V1)",
      rendererSvg: "Quran SVG (الطبعة الأحدث)",
      qpcLoading: "بنحمّل صفحة مصحف ١٤٠٥…",
      qpcUnavailable: "صفحة مصحف ١٤٠٥ مش متاحة دلوقتي، فبنعرض صفحة Quran SVG.",
      pageLoadError: 'متقدرناش نعرض الصفحة دي.',
    },
    khatmDua: {
      title: 'دعاء ختم القرآن',
      unavailable: 'الدعاء ده مش متاح لسه.',
      smaller: 'تصغير الخط',
      larger: 'تكبير الخط',
      open: 'دعاء ختم القرآن',
      back: 'رجوع',
    },
    // Navigation and the Khatma flow keep the approved Standard Arabic wording (as generalQuran does).
    tabs: {
      home: 'الرئيسية',
      howIFeel: 'مشاعري',
      mushaf: 'المصحف',
      myReading: 'الوِرد',
      reflections: 'خواطري',
    },
    continueReading: {
      title: 'متابعة التلاوة',
      mushaf: 'المصحف',
      myReading: 'الوِرد والختمات',
      pageOf: 'صفحة {page} من {total}',
      activeWird: 'الوِرد الحالي',
      lastSaved: 'آخر وِرد محفوظ',
      chooseWird: 'اختار الوِرد',
      switchHint: 'بيعرض قائمة الوِرد عشان تختار منها.',
      firstTitle: 'ابدأ قرايتك',
      firstBody: 'افتح المصحف من أول صفحة، واتأمّل في آياته مع وِرد جديد.',
    },
    emotionsAll: {
      viewAll: 'عرض الكل',
      title: 'بماذا تشعر الآن؟',
      subtitle: 'وتطمئن القلوب',
      back: 'رجوع',
    },
    myReading: {
      title: 'الوِرد والختمات',
      subtitle: 'اقرأ وارتقِ',
      back: 'رجوع',
      statsTotal: 'الختمات',
      statsRamadan: 'ختمات رمضان',
      wirdsTitle: 'الوِرد',
      newWird: 'وِرد جديد',
      emptyTitle: 'مفيش وِرد لسه',
      emptyBody: 'اعمل وِرد عشان تحفظ مكانك في المصحف. كل وِرد ليه صفحته وتقدّمه وختماته.',
      pageOf: 'صفحة {page} من {total}',
      percent: 'الإنجاز {percent}٪',
      positionLabel: 'الإنجاز حسب الصفحة المحفوظة في المصحف',
      footnote: 'وِردك وختماتك محفوظة على الجهاز ده بس. نسبة إنجاز الوِرد على حسب آخر صفحة حفظتها، مش عدد الصفحات اللي تلوتها، والختمة مابتتحسبش غير لما تأكدها.',
      footnoteSynced: 'وِردك وختماتك بتتزامن مع حسابك بين الأجهزة اللي داخلة عليه، وبتتحفظ على الجهاز ده الأول دايمًا. نسبة إنجاز الوِرد على حسب آخر صفحة حفظتها، مش عدد الصفحات اللي تلوتها، والختمة مابتتحسبش غير لما تأكدها.',
      syncSyncing: 'بيتزامن…',
      syncSynced: 'اتزامنت مع حسابك',
      syncPending: 'محفوظة على الجهاز ده، وهتتزامن مع حسابك لما تكون متصل بالإنترنت.',
      khatmaCount: 'الختمات: {count}',
      active: 'الحالي',
      continue: 'كمّل التلاوة',
      rename: 'غيّر الاسم',
      delete: 'امسح',
      pendingTitle: 'الوِرد ده وصل للصفحة ٦٠٤.',
      confirm: 'تأكيد إتمام الختمة',
      unconfirmedTitle: 'محفوظ عند الصفحة ٦٠٤',
      unconfirmedBody: 'الوِرد ده اتحفظ عند الصفحة ٦٠٤ من غير دورة قراية متسجّلة (قبل ما تسجيل الختمات يبدأ، أو اتعمل على الصفحة ٦٠٤). ماتحسبش حاجة.',
      recordUnconfirmed: 'ختمت ختمة بالوِرد ده',
      unconfirmedConfirmTitle: 'تسجّل ختمة مكتملة؟',
      unconfirmedConfirmBody: 'بس لو قريت القرآن كله بوِرد «{name}». هتتحسب مرة واحدة، والوِرد هيبدأ من جديد من الصفحة ١.',
      duaEntry: 'دعاء ختم القرآن',
      historyTitle: 'الختمات المكتملة',
      historyEmpty: 'ختماتك المكتملة هتظهر هنا.',
      ramadanTag: 'رمضان {year} هـ',
      nonRamadanTag: 'برّه رمضان',
      removeKhatma: 'شيل',
      removeTitle: 'تشيل الختمة دي؟',
      removeBody: 'استخدم ده بس لتصليح غلطة. الأعداد هتتحسب من جديد. لو «{name}» ماتحفظش من ساعة الختمة دي هيرجع للصفحة ٦٠٤ مستني تأكيد الختمة، وإلا صفحته الحالية هتفضل زي ما هي.',
      remove: 'شيل',
      cancel: 'إلغاء',
      deleteTitle: 'تمسح «{name}»؟',
      deleteBody: 'صفحته المحفوظة هتتمسح، وختماته المكتملة هتفضل في سجلك وإجمالياتك.',
      createTitle: 'وِرد جديد',
      renameTitle: 'غيّر اسم الوِرد',
      nameLabel: 'الاسم',
      startPageLabel: 'صفحة البداية (١–٦٠٤)',
      save: 'احفظ',
      create: 'اعمل',
      nameInvalid: 'اكتب اسم لحد ٤٠ حرف.',
      nameTaken: 'فيه وِرد تاني بنفس الاسم.',
      pageInvalid: 'اكتب رقم صفحة من ١ لـ ٦٠٤.',
      saveFailed: 'ماعرفناش نحفظ. جرّب تاني.',
      loadFailed: 'ماعرفناش نحمّل وِردك.',
    },
    khatma: {
      reachedTitle: 'ما شاء الله، أتممت ختم القرآن',
      confirm: 'إتمام الختمة',
      notNow: 'ليس الآن',
      completeTitle: 'تقبل الله ختمتك',
      completeBody: 'نسأل الله أن يجعل القرآن نورًا لقلبك وشفيعًا لك',
      readDua: 'قراءة دعاء ختم القرآن',
      backToKhatmas: 'العودة إلى الوِرد والختمات',
      backToMushaf: 'العودة إلى المصحف',
      failed: 'ماعرفناش نسجّل الختمة. جرّب تاني.',
      completeAction: 'إتمام الختمة',
      notReadyTitle: 'لا يمكن إتمام ختمة هذا الوِرد من هنا',
      notReadyBody: 'راجِعه في الوِرد والختمات. لم يتغيّر شيء.',
      noWirdTitle: 'اختر وِردًا أولًا',
      noWirdBody: 'اختر الوِرد الذي أتممته من اسم الوِرد أسفل الصفحة، ثم حاول مرة أخرى.',
      newCycleTitle: 'سُجِّلت هذه الختمة بالفعل',
      newCycleBody: 'بدأ هذا الوِرد دورة قراءة جديدة. احفظ تقدّمك أثناء القراءة، ويمكنك إتمام الدورة الجديدة عند بلوغ الصفحة ٦٠٤ مجددًا. لم يتغيّر شيء.',
      saveFailedTitle: 'تعذّر حفظ الصفحة',
      saveFailedBody: 'لم يُسجَّل شيء. يُرجى المحاولة مرة أخرى.',
      notReadyOk: 'حسنًا',
    },
    credits: {
      title: 'مصادر القرآن وحقوق النشر',
      intro: 'Quran Heals بيعرض القرآن الكريم من المصادر دي، مع كل الشكر والتقدير. ونص القرآن بيظهر زي ما اتنشر بالظبط، من غير أي تغيير.',
      tanzilName: 'مشروع تنزيل (Tanzil)',
      tanzilWork: 'نص القرآن: الرسم العثماني، الإصدار ١٫١، من غير أي تغيير. مرخّص بموجب رخصة المشاع الإبداعي «نَسب المُصنَّف» ٣٫٠.',
      quranFoundationName: 'Quran Foundation',
      quranFoundationWork: 'تخطيط صفحات المصحف وخطوط صفحات QPC V1 (مصحف المدينة ١٤٠٥هـ)، حسب شروط المطوّرين بتاعة Quran Foundation.',
      kingFahdName: 'مجمع الملك فهد لطباعة المصحف الشريف',
      kingFahdWork: 'الخط الأصلي للمصحف وزخارفه: مصحف المدينة ١٤٠٥هـ. خطوط QCF V1 © مجمع الملك فهد لطباعة المصحف الشريف. جميع الحقوق محفوظة.',
      amiriName: 'Amiri Project Authors (مؤلفو مشروع Amiri)',
      amiriWork: 'يُستخدم خط Amiri Bold لأسماء السور، وليس لنص القرآن. تسمح رخصة SIL OFL 1.1 بتضمين الخط وإعادة توزيعه تجاريًا مع التطبيقات، ولا تسمح ببيع الخط منفردًا. وقد أُرفق إشعار حقوق النشر ونص الرخصة كاملًا مع التطبيق. الإطار الزخرفي تصميم أصلي من Quran Heals.',
      mp3quranName: 'MP3Quran',
      mp3quranWork: 'تلاوات القرآن الكريم وتوقيت آياتها، تُبَثّ من موقع mp3quran.net ويمكن تنزيلها للاستماع دون اتصال. وينصّ الموقع على أنه يحق لأي زائر أو مطوّر استخدام أي مادة منه.',
      tafsirCenterName: 'مركز تفسير للدراسات القرآنية',
      tafsirCenterWork: 'مقصد السورة في «عن السورة»: المختصر في تفسير القرآن الكريم (موسوعة القرآن الكريم QuranEnc.com). المكي والمدني وعدد الآيات: تنزيل.',
      website: 'الموقع',
      license: 'الرخصة',
      terms: 'شروط الاستخدام',
    },
    quranFontSize: {
      decreaseLabel: 'تصغير حجم نص القرآن',
      increaseLabel: 'تكبير حجم نص القرآن',
      auto: 'تلقائي',
      autoLabel: 'إعادة ضبط حجم نص القرآن تلقائيًا',
    },
    settings: {
      title: 'الإعدادات',
      subtitle: 'اللغة والمظهر والتذكيرات وحسابك.',
      openSettings: 'افتح الإعدادات',
      appLanguageSection: 'لغة التطبيق',
      emotionsLanguageSection: 'لغة المشاعر',
      emotionsFollowApp: 'حسب لغة التطبيق',
      emotionsEnglish: 'الإنجليزية',
      emotionsArabicStandard: 'العربية الفصحى',
      emotionsArabicEgyptian: 'العربية المصرية',
      quranTranslationNone: 'بدون ترجمة',
      keepAwakeTitle: 'إبقاء الشاشة مضاءة',
      keepAwakeDescription: 'منع قفل الشاشة تلقائيًا أثناء قراءة المصحف.',
      wordMeaningsVisibleTitle: 'معاني الكلمات',
      mushafGuideTitle: 'دليل المصحف',
      offlineMushafTitle: 'المصحف بدون إنترنت',
      offlineMushafAvailable: 'متاح بدون إنترنت',
      offlineMushafRequired: 'يحتاج إلى تحميل',
      offlineMushafDownloading: 'جارٍ التحميل',
      offlineMushafFailed: 'فشل التحميل',
      offlineMushafDownloadHint: 'اضغط لتحميل المصحف كاملًا للقراءة بدون إنترنت.',
      quranTranslationSection: 'ترجمة القرآن',
      translationDisplayAlways: 'دائمًا',
      translationDisplayOnDemand: 'عند الطلب',
      translationDisplayOff: 'إيقاف',
      translationDisplayAlwaysHint: 'يظهر النص العربي والترجمة الإنجليزية معًا تلقائيًا.',
      translationDisplayOnDemandHint: 'يظهر النص العربي أولًا، ويمكنك إظهار الترجمة متى شئت.',
      translationDisplayOffHint: 'النص العربي فقط. لن تظهر الترجمة.',
      quranArabicNote: 'يظهر القرآن بالعربية دائمًا — هذا الإعداد يؤثر فقط على الترجمة الإنجليزية.',
      legalSection: 'السياسات والشروط',
      privacyPolicy: 'سياسة الخصوصية',
      termsOfUse: 'شروط الخدمة',
      accountDeletionInfo: 'حذف الحساب والبيانات',
      opensInBrowser: 'تُفتح في المتصفح',
      appSection: 'التطبيق',
      emotionsSection: 'المشاعر',
      quranSection: 'القرآن',
      supportSection: 'الدعم',
      showTranslationTitle: 'إظهار الترجمة',
      showTranslationDescription: 'الترجمة الإنجليزية تحت كل آية.',
      translationModeLabel: 'عرض الترجمة',
      translationModeAlways: 'دائمًا',
      translationModeOnDemand: 'عند الطلب',
    },
    notifications: {
      wirdReminderTitle: 'تذكير الوِرد',
      randomAyahTitle: 'آية من القرآن',
      emotionCheckInTitle: 'تستحق الطمأنينة',
      frequencyLabel: 'التكرار',
      frequencyDaily: 'يوميًا',
      frequencyEvery3Days: 'كل ٣ أيام',
      frequencyWeekly: 'أسبوعيًا',
      frequencyTwiceDaily: 'مرتين يوميًا',
      twiceMorning: 'صباحًا',
      twiceEvening: 'مساءً',
      twiceSameTime: 'اختر وقتين مختلفين.',
      reminderTimeLabel: 'وقت التذكير',
      chooseDay: 'اختيار اليوم',
      changeHint: 'يفتح الخيارات لتغييره.',
      toggleHint: 'تشغيل هذا التذكير أو إيقافه.',
      timePickerConfirm: 'تعيين الوقت',
      timePickerCancel: 'إلغاء',
      am: 'ص',
      pm: 'م',
      weekday1: 'الأحد',
      weekday2: 'الاثنين',
      weekday3: 'الثلاثاء',
      weekday4: 'الأربعاء',
      weekday5: 'الخميس',
      weekday6: 'الجمعة',
      weekday7: 'السبت',
      permissionRequired: 'يلزم السماح بالإشعارات',
      permissionDeniedHint: 'الإشعارات متوقفة لتطبيق Quran Heals في إعدادات جهازك.',
      permissionAllow: 'السماح بالإشعارات',
      permissionOpenSettings: 'فتح إعدادات الجهاز',
      permissionSheetTitle: 'السماح بالإشعارات؟',
      permissionSheetBody: 'اسمح بالإشعارات لتصلك تذكيرات بوِردك، وآية من القرآن، ولحظة طمأنينة لقلبك.',
      permissionSheetPrivacy: 'تُجدول التذكيرات على جهازك، وتعمل دون اتصال بالإنترنت.',
      permissionSheetConfirm: 'متابعة',
      permissionSheetCancel: 'ليس الآن',
      unsupported: 'التذكيرات متاحة في تطبيق iPhone وAndroid.',
      scheduleError: 'تعذّرت جدولة هذا التذكير. ستُعاد المحاولة عند عودتك إلى التطبيق.',
      wirdNotificationTitle: 'وقت وردك القرآني',
      wirdNotificationBody: 'واصل وِردك اليوم وخصص وقتًا لقراءة القرآن.',
      wirdNotificationBodyPage: 'أكمل ورد {name} من الصفحة {page}.',
      wirdNotificationBodyPageDefinite: 'أكمل وردك {name} من الصفحة {page}.',
      randomAyahNotificationTitle: 'آية من القرآن لك اليوم',
      randomAyahNotificationReference: 'سورة {surah} · الآية {ayah}',
      checkInNotificationTitle: 'تستحق السكينة ❤️',
      checkInNotificationBody: 'مهما كان شعورك، في القرآن ما يلامس قلبك.',
    },
    appearance: {
      sectionLabel: 'المظهر',
      system: 'حسب النظام',
      light: 'وضع النهار',
      dark: 'وضع الليل',
    },
    // ar-EG general UI uses the same Standard Arabic as `ar` for everything
    // outside the three approved Egyptian exceptions (home heading/subtitle,
    // emotion names) — see Part J §47. Account/auth/reflection/sync/issue
    // copy is all general UI, so it is intentionally byte-identical to `ar`.
    auth: {
      syncPrompt: 'سجّل الدخول لتجد محتواك المحفوظ على أجهزتك الأخرى',
      continueWithoutAccount: 'المتابعة دون حساب',
      continueWithApple: 'المتابعة باستخدام Apple',
      continueWithGoogle: 'المتابعة باستخدام Google',
      signInFailed: 'تعذّر تسجيل الدخول. يمكنك المحاولة مرة أخرى أو المتابعة دون حساب.',
    },
    account: {
      sectionTitle: 'الحساب',
      checkingSession: 'جارٍ التحقق من تسجيل الدخول…',
      notSignedIn: 'لم يتم تسجيل الدخول',
      signInWithApple: 'تسجيل الدخول باستخدام Apple',
      signInWithGoogle: 'تسجيل الدخول باستخدام Google',
      signedIn: 'تم تسجيل الدخول',
      signOut: 'تسجيل الخروج',
      dangerZoneTitle: 'منطقة الخطر',
      deleteAccountAction: 'حذف الحساب',
      deleteAccountActionDescription: 'حذف حساب Quran Heals وجميع بياناته نهائيًا.',
    },
    ageConfirmation: {
      title: 'قبل المتابعة',
      description: 'لإنشاء حساب في قرآن يشفي، يجب ألا يقل عمرك عن ١٦ عامًا، مع مراعاة الحد الأدنى للسن في بلدك.',
      checkbox: 'أؤكد أن عمري يسمح لي بإنشاء حساب.',
      continueButton: 'متابعة',
      cancel: 'إلغاء',
    },
    // Account-deletion confirmation copy is a security/destructive-action
    // flow — intentionally byte-identical Standard Arabic in `ar` and
    // `ar-EG`, never Egyptian colloquial (matches the mandatory Sync
    // Password flow's precedent).
    deleteAccount: {
      title: 'حذف حسابك؟',
      description:
        'سيؤدي هذا إلى حذف حساب Quran Heals وخواطرك المحفوظة وآياتك المفضلة وتفضيلاتك وجميع البيانات المرتبطة بالحساب نهائيًا. لا يمكن التراجع عن هذا الإجراء.',
      confirmationInstruction: 'للتأكيد، اكتب حذف في الحقل أدناه.',
      confirmationWord: 'حذف',
      placeholder: 'اكتب حذف',
      deleteButton: 'حذف حسابي نهائيًا',
      deleting: 'جارٍ الحذف…',
      cancel: 'إلغاء',
      successMessage: 'تم حذف حسابك في Quran Heals.',
      failureMessage: 'تعذّر حذف حسابك الآن. يرجى المحاولة مرة أخرى.',
    },
    reflection: {
      action: 'خواطر',
      writeAction: 'أضف خاطرة',
      title: 'خواطر حول هذه الآية',
      prompt: 'ما الشعور الذي تركته هذه الآية في نفسك؟',
      placeholder: 'اكتب ما تركته هذه الآية في قلبك...',
      guestNote: 'تُحفظ خواطرك على هذا الجهاز. سجّل الدخول للوصول إليها عبر أجهزتك.',
      syncedNote: 'يتم تحديث خواطرك بشكل خاص بين أجهزتك التي سجّلت الدخول عليها.',
      save: 'حفظ',
      cancel: 'إلغاء',
      deleteAction: 'حذف الخاطرة',
      deleteConfirmTitle: 'حذف الخاطرة؟',
      deleteConfirmMessage: 'ستُحذف هذه الخاطرة من هذا الجهاز وأجهزتك الأخرى التي سجّلت الدخول عليها.',
      deleteConfirmCancel: 'إلغاء',
      deleteConfirmConfirm: 'حذف',
      deleteError: 'تعذّر حذف خاطرتك. يُرجى المحاولة مرة أخرى.',
      saveError: 'تعذّر حفظ خاطرتك. يُرجى المحاولة مرة أخرى.',
      otherVersionsTitle: 'نسخة أخرى من هذه الخاطرة',
      otherVersionsHint: 'عُدِّلت هذه الخاطرة على أكثر من جهاز قبل تحديثها بينها. لم يُحذف شيء: اختر ما تريد الاحتفاظ به، ثم اضغط حفظ.',
      otherVersionThisDevice: 'كُتبت على هذا الجهاز',
      otherVersionOtherDevice: 'من جهاز آخر',
      otherVersionDeletedElsewhere: 'كُتبت على هذا الجهاز قبل حذفها على جهاز آخر',
      useOtherVersion: 'استخدم هذه النسخة',
      addOtherVersion: 'أضفها إلى نصّي',
      copyOtherVersion: 'نسخ',
      copiedOtherVersion: 'تم النسخ',
      discardOtherVersion: 'تجاهل',
      discardOtherVersionTitle: 'تجاهل هذه النسخة؟',
      discardOtherVersionMessage: 'سيُزال هذا النص من هذا الجهاز، ولا يمكن التراجع عن ذلك.',
      otherVersionTooLong: 'النص أطول من أن يُضاف إلى نصّك. انسخه بدلًا من ذلك.',
    },
    // Sync Password copy is a security-sensitive flow — intentionally
    // byte-identical to `ar`'s Standard Arabic (Part 9 of the mandatory
    // sync-password phase), never Egyptian colloquial.
    guestData: {
      title: "إضافة البيانات المحفوظة على هذا الجهاز إلى هذا الحساب؟",
      body: "لديك مفضلة أو خواطر أو وِرد وختمات محفوظة على هذا الجهاز. هل تريد إضافتها إلى هذا الحساب؟ ستُزامَن بعد ذلك بين أجهزتك المسجَّل دخولها بهذا الحساب.",
      add: "إضافة إلى هذا الحساب",
      keepSeparate: "إبقاؤها منفصلة",
    },
    syncPassphrase: {
      createTitle: "إنشاء كلمة المرور",
      unlockTitle: "أدخل كلمة المرور",
      createDescription: "أنشئ كلمة مرور لحماية وتشفير خواطرك الخاصة عند تحديثها عبر أجهزتك. لا يمكن لتطبيق Quran Heals استعادة كلمة المرور إذا نسيتها، لذا اختر كلمة مرور يمكنك تذكرها.",
      unlockDescription: "أدخل كلمة المرور لفتح خواطرك المشفّرة على هذا الجهاز.",
      createPlaceholder: "كلمة المرور",
      unlockPlaceholder: "كلمة المرور",
      continueLabel: "متابعة",
      confirmPassword: "تأكيد كلمة المرور",
      show: "إظهار",
      hide: "إخفاء",
      lengthHint: "استخدم من 8 إلى 32 حرفًا.",
      allowedHint: "يمكنك استخدام الحروف والأرقام والرموز.",
      mismatch: "كلمتا المرور غير متطابقتين.",
      tooShort: "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.",
      tooLong: "لا يمكن أن تتجاوز كلمة المرور 32 حرفًا.",
      changeTitle: "تغيير كلمة المرور",
      currentPassword: "كلمة المرور الحالية",
      newPassword: "كلمة المرور الجديدة",
      confirmNewPassword: "تأكيد كلمة المرور الجديدة",
      mustDiffer: "يجب أن تكون كلمة المرور الجديدة مختلفة عن كلمة المرور الحالية.",
      incorrectError: "كلمة المرور الحالية غير صحيحة.",
      changeDescription: "غيّر كلمة المرور الخاصة بخواطرك المشفّرة المحفوظة.",
      saveError: "تعذّر تأكيد تغيير كلمة المرور. تحقق من اتصالك وحاول مرة أخرى. إذا تم حفظ التغيير، فاستخدم كلمة المرور الجديدة.",
      loadError: "تعذّر تحميل كلمة المرور. يُرجى المحاولة مرة أخرى.",
      retry: "حاول مرة أخرى",
      forgotPassword: "نسيت كلمة المرور؟",
      resetTitle: "إعادة تعيين مزامنة الخواطر المشفّرة؟",
      resetUnrecoverable: "لا يمكن استعادة كلمة المرور.",
      resetCloudLoss: "ستؤدي إعادة التعيين إلى حذف الخواطر المحفوظة في حسابك نهائيًا، إلا إذا كانت محفوظة على هذا الجهاز.",
      resetConfirm: "إعادة التعيين",
      resetBack: "رجوع",
      resetError: "تعذّر إكمال إعادة التعيين. تحقق من اتصالك وحاول مرة أخرى.",
      resetting: "جارٍ إعادة التعيين…",
      deleteAccountInstead: "حذف حسابي بدلًا من ذلك",
      reauthNoticeApple: "للتأكد من هويتك، ستسجّل الدخول مجددًا بحساب Apple نفسه الذي تستخدمه في Quran Heals.",
      reauthNoticeGoogle: "للتأكد من هويتك، ستسجّل الدخول مجددًا بحساب Google نفسه الذي تستخدمه في Quran Heals.",
      reauthCancelled: "لم يكتمل التحقق من الهوية. لم تتم إعادة تعيين أي شيء.",
      reauthFailed: "تعذّر التأكد من هويتك بالحساب الذي سجّلت الدخول به. لم تتم إعادة تعيين أي شيء.",
      reauthUnavailable: "التحقق من الهوية غير متاح على هذا الجهاز. لا يزال بإمكانك تسجيل الخروج أو حذف حسابك.",
      verifying: "جارٍ التحقق…",
    },
    issueReport: {
      action: 'الإبلاغ عن مشكلة',
      description: 'أخبرنا بالمشكلة التي لاحظتها. يساعدنا بلاغك على تحسين Quran Heals.',
      categoryAyahNotRelevant: 'الآية لا تبدو مرتبطة بالشعور',
      categoryQuranTextDisplay: 'مشكلة في عرض نص القرآن',
      categoryTranslationIssue: 'مشكلة في الترجمة',
      categoryAppTechnicalIssue: 'مشكلة تقنية في التطبيق',
      categoryOther: 'أخرى',
      emailLabel: 'البريد الإلكتروني للمتابعة (اختياري)',
      submit: 'إرسال',
      cancel: 'إلغاء',
      done: 'تم',
      successMessage: 'شكرًا لك. تم استلام بلاغك.',
      failureMessage: 'تعذّر إرسال البلاغ. يُرجى المحاولة مرة أخرى.',
      flagAction: 'الإبلاغ عن مشكلة في هذه الآية',
      settingsDescription: 'أخبرنا إذا واجهتك مشكلة في التطبيق.',
      aboutAyah: 'يتضمن هذا البلاغ الآية:',
      commentLabel: 'ما هي المشكلة؟',
      commentRequired: 'يُرجى وصف المشكلة.',
      emailInvalid: 'يُرجى إدخال بريد إلكتروني صحيح.',
    },
    feedback: {
      action: 'شاركنا رأيك',
      sheetTitle: 'شاركنا رأيك',
      sheetDescription: 'شاركنا أفكارك لنطوّر Quran Heals معًا.',
      messageLabel: 'شاركنا رأيك أو اقتراحاتك...',
      messageRequired: 'يُرجى كتابة رأيك أو اقتراحك.',
      privacyNote: 'يُرجى عدم مشاركة معلومات شخصية هامة.',
      submit: 'إرسال الملاحظات',
      successMessage: 'شكرًا لمشاركتنا رأيك!',
      failureMessage: 'تعذّر إرسال ملاحظاتك. يُرجى المحاولة مرة أخرى.',
    },
    syncStatus: {
      savedOnDevice: 'محفوظ على الجهاز',
      syncing: 'جارٍ التحديث',
      synced: 'تم التحديث',
      syncFailed: 'تعذّر التحديث',
    },
    audio: AR_AUDIO,
  },
};

export function getMessages(locale: AppLocale): Messages {
  return MESSAGES[locale] ?? MESSAGES[('en' as AppLocale)];
}
