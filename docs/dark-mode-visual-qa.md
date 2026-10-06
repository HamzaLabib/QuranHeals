# Dark Mode (الوضع الليلي) — visual QA checklist

The app follows the device appearance (`userInterfaceStyle: "automatic"`). There is no in-app selector.
Requires a **new native build** (dev client / EAS), because `expo-system-ui` and the dark splash are native config.

Capture each screen on all four targets:

| | iPhone light | iPhone dark | Android light | Android dark |
|---|---|---|---|---|
| Home (emotion cards, "A Message from the Quran", headings) | ☐ | ☐ | ☐ | ☐ |
| Home loading / error / retry state | ☐ | ☐ | ☐ | ☐ |
| Ayah screen (Arabic, translation, reference, A−/A+, copy, share, favorite, reflect, "another ayah") | ☐ | ☐ | ☐ | ☐ |
| General Quran ayah screen | ☐ | ☐ | ☐ | ☐ |
| Favorites (cards, empty state, pull-to-refresh spinner) | ☐ | ☐ | ☐ | ☐ |
| Reflections (list cards, empty state, unresolved-reference note) | ☐ | ☐ | ☐ | ☐ |
| Settings (language rows, selected row, account section, sync status) | ☐ | ☐ | ☐ | ☐ |
| Sign in with Apple button (black in light, white in dark) | ☐ | ☐ | n/a | n/a |
| Sign in with Google button (light / dark Google theme, logo colors intact) | ☐ | ☐ | ☐ | ☐ |
| Reflection sheet (input, delete, save, keyboard up) | ☐ | ☐ | ☐ | ☐ |
| Sync password sheet: setup, unlock, change, forgot/reset, fresh Apple/Google re-auth message | ☐ | ☐ | ☐ | ☐ |
| Account deletion sheet (typed confirmation, destructive button, spinner, error) | ☐ | ☐ | ☐ | ☐ |
| Report issue sheet (options, inputs, success/error) | ☐ | ☐ | ☐ | ☐ |

Specifically inspect, in dark mode:

- [ ] Longest Arabic ayahs (e.g. 2:282) at the largest A+ size: Uthmani marks stay legible and the text isn't dimmed
- [ ] The translation still reads as secondary to the Arabic
- [ ] Disabled buttons (A−/A+ at their limits, Save while busy) still look disabled but readable
- [ ] Error text, the destructive red, and the danger-zone outline
- [ ] Empty states and the olive accent (section labels, the reference link, icons)
- [ ] Inputs: placeholder, typed text, border, and dark keyboard (iOS)
- [ ] Status bar shows light glyphs on dark screens and dark glyphs on light screens
- [ ] Android navigation bar area matches the screen background
- [ ] No white flash on cold start (dark splash), on push/back navigation, or when a sheet opens or closes
- [ ] Switching system appearance while the app is open updates every visible screen and any open sheet
