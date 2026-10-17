const { AndroidConfig, withAndroidStyles } = require('expo/config-plugins');

/** The app theme's TextView style: AppCompat's own (its android:textViewStyle), plus useBoundsForWidth below. */
const ADVANCE_WIDTH_TEXT_VIEW_STYLE = { name: 'QuranHealsTextView', parent: 'Widget.AppCompat.TextView' };

/**
 * Android 16+ TextView (and Android 15 where a platform flag enables it) lays out and aligns text by its glyphs'
 * bounding box when the app targets SDK 35 or later (TextView.USE_BOUNDS_FOR_WIDTH). The QCF V1 page fonts store
 * ink-less points far outside some glyphs (page 61 line 1 «عَلَىٰٓ»: one point 0.97 em past its advance), and the
 * box includes them, so the Mushaf's centred Android glyph copies (QpcV1PageText androidInk) were drawn by half their
 * overhang to the right: «عَلَىٰٓ» 0.5 em, over «أُنزِلَ» (Android 17 emulators, 2026-10-16). React Native measures
 * text by advances and never sets this, so every TextView keeps the advance-based layout of Android 14 and earlier,
 * through the app theme's TextView style (identical to AppCompat's otherwise).
 *
 * Its own file, listed in app.json `plugins`, so the fingerprint runtime version tracks it (@expo/fingerprint hashes
 * plugin files; a plugin written inline in app.config.ts left the runtime version unchanged). Android only.
 */
const withAdvanceWidthText = (config) =>
  withAndroidStyles(config, (mod) => {
    let styles = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
      add: true,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      name: 'android:textViewStyle',
      value: `@style/${ADVANCE_WIDTH_TEXT_VIEW_STYLE.name}`,
    });
    styles = AndroidConfig.Styles.assignStylesValue(styles, {
      add: true,
      parent: ADVANCE_WIDTH_TEXT_VIEW_STYLE,
      name: 'android:useBoundsForWidth',
      value: 'false',
      targetApi: '35',
    });
    mod.modResults = styles;
    return mod;
  });

module.exports = withAdvanceWidthText;
