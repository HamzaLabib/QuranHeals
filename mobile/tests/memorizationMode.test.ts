import { describe, expect, it, vi } from 'vitest';

/**
 * Memorization Mode's pieces outside the reader: its session state (Option A), the Settings switch's stored value, the
 * Eye's and Show All / Hide All's place beside the page number on every supported width, and the guide's steps.
 */
const storage = vi.hoisted(() => ({ map: new Map<string, string>(), failing: false }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', G: 'G', Defs: 'Defs', Ellipse: 'Ellipse', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => { if (storage.failing) throw new Error('unavailable'); return storage.map.get(key) ?? null; },
    setItem: async (key: string, value: string) => { if (storage.failing) throw new Error('unavailable'); storage.map.set(key, value); },
  },
}));

const state = await import('@/memorization/memorizationState');
const preference = await import('@/memorization/memorizationModePreference');
const { placeMemorizationControls, MIN_ALL_WIDTH, ALL_MIN_FONT_SCALE } = await import('@/memorization/placement');
const { pageNumberTouchBox } = await import('@/components/MushafPageView');
const { computePageLayout, BORDER_TILES_DOWN, MIN_TILES_DOWN } = await import('@/mushaf/pageGeometry');
const { MEMORIZATION_GUIDE_STEPS, memorizationGuideNote, memorizationGuideStepFor, memorizationGuideTarget, memorizationGuideText } = await import('@/memorization/memorizationGuide');
const { memorizationLabels } = await import('@/memorization/labels');
const { isMemorizationModeAvailable } = await import('@/memorization/config');

describe('Memorization Mode session state (Option A)', () => {
  const KEYS = ['2:6', '2:7', '2:8'];
  it('entering hides every ayah of the page; off, nothing is hidden', () => {
    expect(KEYS.some((k) => state.isAyahHidden(state.MEMORIZATION_OFF, 3, k))).toBe(false);
    const on = state.enterMemorization(3);
    expect(KEYS.every((k) => state.isAyahHidden(on, 3, k))).toBe(true);
  });

  it('a tap reveals only that ayah; another tap hides it; several stay revealed together', () => {
    let s = state.enterMemorization(3);
    s = state.toggleMemorizedAyah(s, 3, '2:7');
    expect(KEYS.map((k) => state.isAyahHidden(s, 3, k))).toEqual([true, false, true]);
    s = state.toggleMemorizedAyah(s, 3, '2:6');
    expect(KEYS.map((k) => state.isAyahHidden(s, 3, k))).toEqual([false, false, true]);
    s = state.toggleMemorizedAyah(s, 3, '2:7');
    expect(KEYS.map((k) => state.isAyahHidden(s, 3, k))).toEqual([false, true, true]);
  });

  it('Show All reveals the whole page; Hide All hides it all again', () => {
    let s = state.showAllAyahs(state.enterMemorization(3), 3, KEYS);
    expect(KEYS.some((k) => state.isAyahHidden(s, 3, k))).toBe(false);
    s = state.hideAllAyahs(s, 3);
    expect(KEYS.every((k) => state.isAyahHidden(s, 3, k))).toBe(true);
  });

  it('another page: still on, that page hidden; coming back starts hidden again; the same page keeps its reveals', () => {
    let s = state.showAllAyahs(state.enterMemorization(3), 3, KEYS);
    expect(state.memorizationOnPage(s, 3)).toBe(s);
    s = state.memorizationOnPage(s, 4);
    expect(s).toMatchObject({ active: true, page: 4 });
    expect(state.isAyahHidden(s, 4, '2:30')).toBe(true);
    s = state.memorizationOnPage(s, 3);
    expect(KEYS.every((k) => state.isAyahHidden(s, 3, k))).toBe(true);
  });

  it('a peek shows its ayah only while held and never changes what is revealed; nothing applies while off', () => {
    const s = state.enterMemorization(3);
    expect(state.isAyahHidden(s, 3, '2:7', { page: 3, verseKey: '2:7' })).toBe(false);
    expect(state.isAyahHidden(s, 3, '2:6', { page: 3, verseKey: '2:7' })).toBe(true);
    expect(state.isAyahHidden(s, 3, '2:7', null)).toBe(true);
    expect(state.toggleMemorizedAyah(state.MEMORIZATION_OFF, 3, '2:7')).toBe(state.MEMORIZATION_OFF);
    expect(state.showAllAyahs(state.MEMORIZATION_OFF, 3, KEYS)).toBe(state.MEMORIZATION_OFF);
    expect(state.memorizationOnPage(state.MEMORIZATION_OFF, 9)).toBe(state.MEMORIZATION_OFF);
  });
});

describe('Settings → Quran → Memorization Mode: the stored choice', () => {
  it('ON by default (nothing saved), its own versioned local key; only "true" / "false" are read; never throws', async () => {
    expect(preference.DEFAULT_MEMORIZATION_MODE_VISIBLE).toBe(true);
    expect(preference.MEMORIZATION_MODE_VISIBLE_STORAGE_KEY).toBe('quran-heals:memorization-mode-visible:v1');
    expect(preference.MEMORIZATION_MODE_VISIBLE_STORAGE_KEY).not.toBe('quran-heals:word-meanings-visible:v1');
    for (const raw of [null, '', 'yes', '1', '{"v":true}']) expect(preference.parseMemorizationModeVisible(raw)).toBe(true);
    // A saved choice always wins over the default: an existing reader's OFF stays OFF.
    expect(preference.parseMemorizationModeVisible('false')).toBe(false);
    storage.map.clear();
    expect(await preference.loadMemorizationModeVisible()).toBe(true);
    // Reading never saves anything (the default is never written back).
    expect(storage.map.has(preference.MEMORIZATION_MODE_VISIBLE_STORAGE_KEY)).toBe(false);
    await preference.saveMemorizationModeVisible(true);
    expect(storage.map.get(preference.MEMORIZATION_MODE_VISIBLE_STORAGE_KEY)).toBe('true');
    expect(await preference.loadMemorizationModeVisible()).toBe(true);
    await preference.saveMemorizationModeVisible(false);
    expect(await preference.loadMemorizationModeVisible()).toBe(false);
    storage.failing = true;
    expect(await preference.loadMemorizationModeVisible()).toBe(true);
    await expect(preference.saveMemorizationModeVisible(true)).resolves.toBeUndefined();
    storage.failing = false;
  });

  it('the feature itself: available in release builds too (vitest, like a release bundle, has __DEV__ false)', () => {
    expect(__DEV__).toBe(false);
    expect(isMemorizationModeAvailable()).toBe(true);
  });
});

type Box = { left: number; top: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.left < b.left + b.width - 1e-6 && b.left < a.left + a.width - 1e-6 && a.top < b.top + b.height - 1e-6 && b.top < a.top + a.height - 1e-6;
const touch = (p: Box & { slopTop: number }) => ({ left: p.left, top: p.top - p.slopTop, width: p.width, height: p.height + p.slopTop });

describe('Show All / Hide All beside the page number (placement.ts); the Eye is never placed there', () => {
  // Reading areas the reader really gets: phones (the page = the area less 6 pt), and tablets (the page narrower than
  // the area: the height decides), in Normal Mode's shortest and the printed frame, and full screen's tall one.
  const CASES = [
    { name: '320-pt phone', area: 320, page: 261 }, { name: '320-pt phone, wide page', area: 320, page: 314 },
    { name: '375-pt phone', area: 375, page: 369 }, { name: '393-pt phone', area: 393, page: 387 },
    { name: '430-pt phone', area: 430, page: 424 }, { name: 'Android 412', area: 412, page: 406 },
    { name: 'iPad portrait', area: 820, page: 640 }, { name: 'iPad landscape', area: 1180, page: 470 },
    { name: 'Android tablet portrait', area: 800, page: 600 }, { name: 'Android tablet landscape', area: 1280, page: 520 },
  ] as const;
  const TILES = [MIN_TILES_DOWN, BORDER_TILES_DOWN, 34];
  // Show All / Hide All's natural width at 12 pt (both labels and padding): English and the longer Arabic.
  const ALL_WIDTHS = [118, 136];
  const fits = (room: number, allWidth: number) => Math.min(allWidth, room) >= MIN_ALL_WIDTH && Math.min(allWidth, room) >= allWidth * ALL_MIN_FONT_SCALE;

  it('the placement holds no Eye at all (the Eye is always in the top bar)', () => {
    const placed = placeMemorizationControls({ areaWidth: 393, pageWidth: 387, tilesDown: MIN_TILES_DOWN, pageTop: 0, allWidth: 118 });
    expect(Object.keys(placed).sort()).toEqual(['all', 'number']);
  });

  it.each(CASES)('$name: on the page number\'s left where it fits, else its right, inside the page, never on the number — or in the top bar', ({ area, page }) => {
    for (const tilesDown of TILES) for (const pageTop of [0, 37]) for (const allWidth of ALL_WIDTHS) {
      const placed = placeMemorizationControls({ areaWidth: area, pageWidth: page, tilesDown, pageTop, allWidth });
      const own = pageNumberTouchBox(computePageLayout(page, tilesDown));
      const pageLeft = (area - page) / 2;
      expect(placed.number).toEqual({ left: pageLeft + own.left, top: pageTop + own.top, width: own.width, height: own.height });
      const leftRoom = placed.number.left - pageLeft;
      const rightRoom = pageLeft + page - (placed.number.left + placed.number.width);
      if (fits(leftRoom, allWidth)) {
        expect(placed.all!.left + placed.all!.width).toBeCloseTo(placed.number.left, 6);
        expect(placed.all!.left).toBeGreaterThanOrEqual(pageLeft - 1e-6);
      } else if (fits(rightRoom, allWidth)) {
        expect(placed.all!.left).toBeCloseTo(placed.number.left + placed.number.width, 6);
        expect(placed.all!.left + placed.all!.width).toBeLessThanOrEqual(pageLeft + page + 1e-6);
      } else {
        expect(placed.all).toBeNull();
        continue;
      }
      const all = placed.all!;
      expect(all.width).toBeGreaterThanOrEqual(MIN_ALL_WIDTH);
      expect(all.shrunk).toBe(all.width < allWidth - 0.5);
      expect(overlaps(touch(all), touch({ ...placed.number, slopTop: own.slopTop }))).toBe(false);
      // On the number's line, as tall as its touch target: never below the page, never into the text.
      expect(all.top).toBe(placed.number.top);
      expect(all.slopTop).toBe(own.slopTop);
      expect(all.top + all.height).toBeCloseTo(pageTop + computePageLayout(page, tilesDown).page.height, 6);
    }
  });

  it('measured: full size beside the number on 375 pt and wider phones in English; shrunk on a 320-pt phone; the top bar on a short 320 × 568 page', () => {
    const at = (area: number, page: number, allWidth: number) => placeMemorizationControls({ areaWidth: area, pageWidth: page, tilesDown: MIN_TILES_DOWN, pageTop: 0, allWidth }).all;
    expect(at(375, 369, 118)).toMatchObject({ shrunk: false, width: 118 });
    expect(at(393, 387, 118)).toMatchObject({ shrunk: false });
    expect(at(320, 314, 118)?.shrunk).toBe(true);
    // The 261-pt page: 81.7 pt either side of the number, under MIN_ALL_WIDTH — the top bar.
    expect(at(320, 261, 118)).toBeNull();
  });

  it('page 604 in Normal Mode: never into إتمام الختمة or دعاء ختم القرآن (their touch targets); the top bar where neither side has room', () => {
    const problems: string[] = [];
    for (const { name, area, page } of CASES) {
      const pageLeft = (area - page) / 2;
      const rowLeft = area === page + 6 ? 0 : pageLeft;
      const rowWidth = area === page + 6 ? area : page;
      const layout = computePageLayout(page, MIN_TILES_DOWN);
      const centre = layout.pageNumber.y + layout.pageNumber.height / 2;
      for (const [completeWidth, duaWidth] of [[100, 120], [60, 60], [0.29 * rowWidth, 0.29 * rowWidth]]) {
        const obstacles = [
          { left: rowLeft + 14 - 8, top: centre - 14 - 8, width: completeWidth + 16, height: 28 + 8 },
          { left: rowLeft + rowWidth - 14 - duaWidth - 8, top: centre - 14 - 8, width: duaWidth + 16, height: 28 + 8 },
        ];
        const placed = placeMemorizationControls({ areaWidth: area, pageWidth: page, tilesDown: MIN_TILES_DOWN, pageTop: 0, allWidth: 118, obstacles });
        if (placed.all) for (const obstacle of obstacles) if (overlaps(touch(placed.all), obstacle)) problems.push(`${name} ${completeWidth}/${duaWidth}: ${JSON.stringify(touch(placed.all))} meets ${JSON.stringify(obstacle)}`);
      }
    }
    expect(problems).toEqual([]);
    // A 375-pt phone with the real-length links: no room on either side — the top bar.
    const layout = computePageLayout(369, MIN_TILES_DOWN);
    const centre = layout.pageNumber.y + layout.pageNumber.height / 2;
    const placed = placeMemorizationControls({
      areaWidth: 375, pageWidth: 369, tilesDown: MIN_TILES_DOWN, pageTop: 0, allWidth: 118,
      obstacles: [{ left: 6, top: centre - 22, width: 116, height: 36 }, { left: 375 - 14 - 108 - 8, top: centre - 22, width: 124, height: 36 }],
    });
    expect(placed.all).toBeNull();
  });
});

describe('the Memorization Mode Guide (memorizationGuide.ts)', () => {
  const EN = memorizationLabels('en').guide;
  const AR = memorizationLabels('ar').guide;

  it('seven steps in the approved order, each with English and Arabic text', () => {
    expect(MEMORIZATION_GUIDE_STEPS.map((s) => s.text)).toEqual(['enable', 'findEye', 'hide', 'reveal', 'peek', 'continueExit', 'showHideAll']);
    for (const labels of [EN, AR]) for (const step of MEMORIZATION_GUIDE_STEPS) expect(labels[step.text].length).toBeGreaterThan(20);
    expect(memorizationLabels('ar-EG' as never)).toBe(memorizationLabels('ar'));
  });

  it('steps 1 and 2 for an Eye shown by default (step 1 has its own text for a saved OFF); steps 3–7 in the owner\'s approved wording (Arabic) and its English', () => {
    expect(EN.enable).toBe('Memorization Mode is ready to use: its Eye button is shown by default. You can turn it off in Settings → Quran → Memorization Mode.');
    expect(AR.enable).toBe('وضع الحفظ جاهز للاستخدام، وزر العين ظاهر تلقائيًا. ويمكنك إيقافه من الإعدادات ← القرآن ← وضع الحفظ.');
    expect(EN.enableOff).toBe('Memorization Mode is turned off on this device. Turn it on in Settings → Quran → Memorization Mode to show its Eye button.');
    expect(AR.enableOff).toBe('وضع الحفظ متوقف على هذا الجهاز. فعّله من الإعدادات ← القرآن ← وضع الحفظ ليظهر زر العين.');
    // Never the old instruction to turn on what is already on.
    for (const text of [EN.enable, AR.enable]) expect(text).not.toMatch(/^(Turn on|فعّل)/);
    expect(EN.findEye).toBe("The Eye button is in the Mushaf's top bar.");
    expect(AR.findEye).toBe('زر العين في الشريط العلوي للمصحف.');
    // A saved OFF: step 2 keeps the original wording (the Eye appears once turned on in step 1).
    expect(EN.findEyeOff).toBe("An Eye button then appears in the Mushaf's top bar.");
    expect(AR.findEyeOff).toBe('يظهر بعد ذلك زر العين في الشريط العلوي للمصحف.');
    const first = MEMORIZATION_GUIDE_STEPS[0];
    expect(memorizationGuideText(first, true)).toBe('enable');
    expect(memorizationGuideText(first, false)).toBe('enableOff');
    expect(memorizationGuideText(MEMORIZATION_GUIDE_STEPS[1], true)).toBe('findEye');
    expect(memorizationGuideText(MEMORIZATION_GUIDE_STEPS[1], false)).toBe('findEyeOff');
    for (const step of MEMORIZATION_GUIDE_STEPS.slice(2)) for (const on of [true, false]) expect(memorizationGuideText(step, on)).toBe(step.text);
    expect(AR.hide).toBe('اضغط على العين لإخفاء نص جميع آيات الصفحة.');
    expect(EN.hide).toBe('Tap the Eye to hide all ayah text on the page.');
    expect(AR.reveal).toBe('اضغط على موضع الآية لإظهارها، واضغط عليها مرة أخرى لإخفائها. يمكنك إظهار عدة آيات معًا.');
    expect(EN.reveal).toBe("Tap an ayah's position to reveal it, then tap it again to hide it. You can reveal multiple ayahs at once.");
    expect(AR.peek).toBe('اضغط مطولًا على آية لتراها فقط حتى ترفع إصبعك.');
    expect(EN.peek).toBe('Press and hold an ayah to reveal it temporarily, until you lift your finger.');
    expect(AR.continueExit).toBe('اسحب إلى صفحة أخرى، وسيبقى وضع الحفظ مفعّلًا وتكون آيات الصفحة الجديدة مخفية. اضغط على العين الذهبية للخروج من وضع الحفظ وإظهار الصفحة كاملة.');
    expect(EN.continueExit).toBe("Swipe to another page. Memorization Mode stays active, and the new page's ayahs remain hidden. Tap the gold Eye to exit Memorization Mode and reveal the full page.");
    expect(AR.showHideAll).toBe('يظهر «إظهار الكل» و«إخفاء الكل» بجانب رقم الصفحة ما دام وضع الحفظ مفعّلًا. ويمكنك أيضًا الضغط مطولًا على العين الذهبية لإظهارهما.');
    expect(EN.showHideAll).toBe('Show All and Hide All appear beside the page number while Memorization Mode is active. You can also long-press the gold Eye to access them.');
    // Where this layout puts them in the top bar: the same step, saying so.
    expect(AR.showHideAllInBar).toBe('يظهر «إظهار الكل» و«إخفاء الكل» في الشريط العلوي ما دام وضع الحفظ مفعّلًا. ويمكنك أيضًا الضغط مطولًا على العين الذهبية لإظهارهما.');
    expect(EN.showHideAllInBar).toBe('Show All and Hide All appear in the top bar while Memorization Mode is active. You can also long-press the gold Eye to access them.');
    // Step 3 keeps its picture (the Eye, the arrow, the gold crossed-out Eye); step 1 its switch.
    expect(MEMORIZATION_GUIDE_STEPS.map((s) => s.illustration ?? null)).toEqual(['setting', null, 'eyeChange', null, null, null, null]);
  });

  it('points at the real controls: the Eye in the top bar (else a centred card with a note), an ayah for steps 4 and 5, Show All / Hide All (else the page number) for step 7', () => {
    const drawnNow = (names: string[]) => (target: string) => names.includes(target);
    const [enable, findEye, hide, reveal, peek, exit, all] = MEMORIZATION_GUIDE_STEPS;
    expect(memorizationGuideTarget(enable, drawnNow(['page', 'memorize']))).toBeNull();
    for (const step of [findEye, hide, exit]) {
      expect(memorizationGuideTarget(step, drawnNow(['page', 'memorize']))).toBe('memorize');
      expect(memorizationGuideNote(step, drawnNow(['page', 'memorize']))).toBeNull();
      // No Eye: never the page number (the Eye is not there); the card is centred and says why.
      expect(memorizationGuideTarget(step, drawnNow(['page']))).toBeNull();
      expect(memorizationGuideNote(step, drawnNow(['page']))).toBe('eyeNotShown');
      expect(memorizationGuideNote(step, drawnNow(['page']), true)).toBe('eyeUnavailable');
    }
    for (const step of [reveal, peek]) expect(memorizationGuideTarget(step, drawnNow(['page', 'ayah']))).toBe('ayah');
    expect(memorizationGuideTarget(all, drawnNow(['page', 'memorize']))).toBe('page');
    expect(memorizationGuideNote(all, drawnNow(['page', 'memorize']))).toBe('allNotShown');
    expect(memorizationGuideTarget(all, drawnNow(['page', 'memorize', 'memorizeAll']))).toBe('memorizeAll');
  });

  it('step 7 where this layout puts Show All / Hide All in the top bar: says so, and points at the Eye (its long press), never at the page number', () => {
    const drawnNow = (names: string[]) => (target: string) => names.includes(target);
    const all = MEMORIZATION_GUIDE_STEPS[6];
    expect(memorizationGuideStepFor(all, false)).toBe(all);
    const inBar = memorizationGuideStepFor(all, true);
    expect(inBar.text).toBe('showHideAllInBar');
    expect(memorizationGuideTarget(inBar, drawnNow(['page', 'memorize']))).toBe('memorize');
    expect(memorizationGuideTarget(inBar, drawnNow(['page', 'memorize', 'memorizeAll']))).toBe('memorizeAll');
    // Every other step is the same on every layout.
    for (const step of MEMORIZATION_GUIDE_STEPS.slice(0, 6)) expect(memorizationGuideStepFor(step, true)).toBe(step);
  });
});

const guide = await import('@/memorization/memorizationGuide');

describe('The Memorization Mode Guide\'s first-time showing (after a fresh install\'s Mushaf guide)', () => {
  const UNSEEN = { status: 'unseen', step: 0 } as const;
  const SEEN = { status: 'done', finished: true } as const;
  const READY = { mushafGuide: SEEN, mushafGuideVisible: false, memorizationGuideOpen: false, focused: true, pageReady: true, settingReady: true, eyeReady: true };

  it('its own versioned key; nothing saved or anything unreadable is "not queued"; a pending step out of range restarts at 1', async () => {
    expect(guide.MEMORIZATION_GUIDE_STORAGE_KEY).toBe('quran-heals:memorization-guide:v1');
    for (const raw of [null, 'x', 3, {}, { status: 'unseen' }]) expect(guide.parseMemorizationGuideProgress(raw)).toEqual({ status: 'none' });
    expect(guide.parseMemorizationGuideProgress({ status: 'done' })).toEqual({ status: 'done' });
    expect(guide.parseMemorizationGuideProgress({ status: 'pending', step: 4 })).toEqual({ status: 'pending', step: 4 });
    for (const step of [-1, 7, 1.5, '2']) expect(guide.parseMemorizationGuideProgress({ status: 'pending', step })).toEqual({ status: 'pending', step: 0 });
    storage.map.clear();
    expect(await guide.loadMemorizationGuideProgress()).toEqual({ status: 'none' });
    await guide.saveMemorizationGuideProgress({ status: 'pending', step: 2 });
    expect(await guide.loadMemorizationGuideProgress()).toEqual({ status: 'pending', step: 2 });
    await guide.saveMemorizationGuideProgress({ status: 'done' });
    expect(await guide.loadMemorizationGuideProgress()).toEqual({ status: 'done' });
    storage.map.set(guide.MEMORIZATION_GUIDE_STORAGE_KEY, '{not json');
    expect(await guide.loadMemorizationGuideProgress()).toEqual({ status: 'none' });
    storage.failing = true;
    expect(await guide.loadMemorizationGuideProgress()).toEqual({ status: 'none' });
    await expect(guide.saveMemorizationGuideProgress({ status: 'done' })).resolves.toBeUndefined();
    storage.failing = false;
  });

  it('queued only where the Mushaf guide has not been seen (a fresh install); an existing reader\'s seen guide never queues it; pending and done are kept', () => {
    expect(guide.queueMemorizationGuide(UNSEEN, { status: 'none' })).toEqual({ status: 'pending', step: 0 });
    expect(guide.queueMemorizationGuide({ status: 'unseen', step: 3 }, { status: 'none' })).toEqual({ status: 'pending', step: 0 });
    for (const seen of [SEEN, { status: 'done', finished: false } as const]) expect(guide.queueMemorizationGuide(seen, { status: 'none' })).toEqual({ status: 'none' });
    const pending = { status: 'pending', step: 5 } as const;
    expect(guide.queueMemorizationGuide(UNSEEN, pending)).toBe(pending);
    expect(guide.queueMemorizationGuide(SEEN, pending)).toBe(pending);
    const done = { status: 'done' } as const;
    expect(guide.queueMemorizationGuide(UNSEEN, done)).toBe(done);
  });

  it('due only when queued, after the Mushaf guide (seen and gone), never over another guide, with the reader focused and its page, setting and Eye ready', () => {
    expect(guide.isMemorizationGuideDue({ ...READY, progress: { status: 'pending', step: 0 } })).toBe(true);
    for (const progress of [null, { status: 'none' }, { status: 'done' }] as const) expect(guide.isMemorizationGuideDue({ ...READY, progress })).toBe(false);
    const pending = { status: 'pending', step: 0 } as const;
    expect(guide.isMemorizationGuideDue({ ...READY, progress: pending, mushafGuide: null })).toBe(false);
    expect(guide.isMemorizationGuideDue({ ...READY, progress: pending, mushafGuide: UNSEEN })).toBe(false);
    for (const key of ['mushafGuideVisible', 'memorizationGuideOpen'] as const) expect(guide.isMemorizationGuideDue({ ...READY, progress: pending, [key]: true }), key).toBe(false);
    for (const key of ['focused', 'pageReady', 'settingReady', 'eyeReady'] as const) expect(guide.isMemorizationGuideDue({ ...READY, progress: pending, [key]: false }), key).toBe(false);
    // Closed early (not finished) counts as seen, as for the Mushaf guide's own conventions.
    expect(guide.isMemorizationGuideDue({ ...READY, progress: pending, mushafGuide: { status: 'done', finished: false } })).toBe(true);
    expect(guide.MEMORIZATION_GUIDE_HANDOFF_MS).toBeGreaterThanOrEqual(400);
  });
});
