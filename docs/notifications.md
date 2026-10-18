# Local reminders (notifications)

Three reminders, each configured on its own in Settings. Local notifications only: no push tokens, no server, no account, and no network needed.

| Reminder | Settings section | Default | Tap opens |
|---|---|---|---|
| Wird Reminder (تذكير الورد; Quran Reciting Reminder) | Quran | ON, Daily, 21:00, one reminder naming the ورد Home shows | the Mushaf on that ورد's saved page (made active); deleted or not resolvable: أورادي وختماتي |
| Random Quran Ayah (آية من القرآن) | Quran | ON, Daily, 08:00, all 6,236 verses | the Mushaf on the verse's page, that ayah selected (`/mushaf?page&ayah&at`) |
| You Deserve Peace (تستحق الطمأنينة; the Emotional Check-in) | Emotions | ON, Daily, 21:00 (Twice Daily, when chosen: 09:00 and 21:00) | `/emotions`, How I Feel — المشاعر; no emotion chosen |

## Copy (final approved wording, 2026-10-17)

In the App Language (English or Modern Standard Arabic; never Egyptian Arabic). Strings in `localization/messages.ts`, built in `content.ts`.

| Reminder | English | Arabic |
|---|---|---|
| Wird | Time for your Quran reciting. / Continue your Evening reciting from page 125. | وقت وردك القرآني / أكمل وردك المسائي من الصفحة ١٢٥. |
| Check-in | You Deserve Peace ❤️ / Whatever you're feeling, there's something in the Quran that speaks to your heart. | تستحق السكينة ❤️ / مهما كان شعورك، في القرآن ما يلامس قلبك. |
| Random Ayah | A Verse for You Today / the verse, a blank line, "Ash-Sharh · 94:5" | آية من القرآن لك اليوم / the verse, a blank line, «سورة الشرح · الآية ٥» |

**Wird Reminder body.** It names the ورد that Home's Continue Reciting shows (`wirdTarget.ts`): the active ورد, else the most recently saved one, never one chosen by the time of day. The name is shown exactly as the user saved it: the app has no built-in ورد names, so nothing is ever translated. In Arabic, a name that is an Arabic adjective («المسائي») reads «أكمل وردك المسائي…» and any other name «أكمل ورد رمضان…». A name in the other script is wrapped in Unicode first-strong isolates so the sentence keeps its order. Arabic page numbers use Arabic-Indic digits. With no ورد, an invalid page, or a failed read, the body is the generic «واصل وِردك اليوم وخصص وقتًا لقراءة القرآن.» / "Continue your Reciting and reconnect with the Quran.", and no position is invented. The ورد's name and page now appear on the lock screen; lock-screen previews follow the user's device settings.

**Keeping it current.** A local notification shows exactly what was scheduled, and no app code runs at delivery. So the provider reconciles whenever the reading data changes (a page saved, a ورد renamed, deleted or chosen, a sync applied) or the active owner does (sign-in, sign-out, the sign-in state resolved at launch), as well as at launch, on return to the app and on a language change. The Wird request's signature includes the ورد's id, name and page, so only that request is replaced, under the same identifier. While the owner is still unresolved at launch, an already-scheduled Wird reminder is left as it is. A ورد changed on another device reaches this device's reminder once this app has synced it, at the latest when the app is next opened. Until then the reminder names the last page this device knew.

Code: `mobile/src/notifications/`. The Settings row is `components/NotificationReminderRow.tsx`.

## Three separate states

- **The user's wish:** `preferences[kind].enabled`. Defaults to ON, stored in `quran-heals:notification-preferences:v1`, device-local, never synced.
- **OS permission:** `permission.status`. The app never asks at launch. It asks only after a tap in Settings: tapping "Permission required", or turning a reminder ON when the OS has never been asked. It shows a short explanation sheet first. Once the OS will no longer ask (iOS after one answer, Android 13+ after two denials), the same tap opens the device settings instead.
- **What is registered:** `states[kind]` comes from the last reconciliation: `scheduled` (with a count), `off`, `needsPermission`, `error` or `unsupported`. Settings never says a reminder is scheduled unless the OS has accepted it.

## Recurrence (`recurrence.ts`)

All times are local wall-clock times, built from calendar fields, never by adding hours.

- **Daily:** every calendar day at the chosen time.
- **Weekly:** the chosen weekday (1 = Sunday … 7 = Saturday) at that time. The weekday is stored per reminder. When Weekly is first chosen it defaults to today's weekday.
- **Every 3 days:** the dates anchor, anchor + 3, anchor + 6, … counted in calendar days, at the chosen time. Choosing Every 3 days sets the anchor to today if the time is still ahead, otherwise tomorrow. Changing only the time keeps the anchor (the same days). Until 2026-10-15 the Check-in's default was Every 3 days; installs that saved it keep it, and its anchor was fixed and saved on their first launch.
- **Twice Daily (the Check-in only, listed last):** two times, Morning and Evening (09:00 and 21:00 by default), each edited on its own and never the same (a time equal to the other one is refused); they are kept apart from the single time, so switching away and back restores both.
- **DST:** a time that doesn't exist on the spring-forward day (02:30 when clocks jump 02:00 → 03:00) is delivered that day, shifted forward by the gap (03:30). A time that happens twice on the fall-back day is delivered once, at the first occurrence.
- **Time zone or clock changes:** the next reconciliation (launch or return to the app) rebuilds dated reminders in the new zone. Daily/Weekly requests repeat natively and follow the device's current local time.

## Scheduling (`scheduler.ts`)

`reconcile()` compares the desired requests with the pending ones. It cancels only what is obsolete, adds only what is missing, and leaves matching requests alone. Matching means the same identifier and the same `data.sig` (trigger, copy, language, verse, the Wird Reminder's ورد and page, payload version). It runs at launch, on every return to the foreground, after any reminder change, after an App Language change, and after any reading-data or owner change. An upgrade from payload version 1 replaces each pending request once, in place. Runs are serialized; requests that arrive during a run are merged into one more run with the newest settings.

- Identifiers: `quranheals.wird.*`, `quranheals.checkin.*`, `quranheals.ayah.*`. Nothing outside this prefix is ever cancelled.
- Wird and Check-in, Daily/Weekly: one repeating request each. The OS repeats it with no end, whether or not the app is opened.
- Check-in, Twice Daily: two repeating daily requests (`quranheals.checkin.twice.morning`, `quranheals.checkin.twice.evening`), likewise repeated by the OS with no end; they take two fixed slots and never a dated one.
- Everything else is a run of dated requests: Wird and Check-in at Every 3 days, and the Random Quran Ayah at every frequency.
  - Each Random Ayah request carries its own preselected verse. The verse for each date is stored in `quran-heals:notification-ayah-queue:v1`. It is chosen once and kept until its date passes (or the schedule drops that date), so a language change or a new time keeps the same verses. New choices avoid the last 120 verses.
- **Shared budget:** at most 60 pending (iOS allows 64 per app; 4 are left as a margin). The repeating requests take one slot each, and the dated runs share the rest, filled earliest-first across all of them (`allocateDated`), so every run reaches the same horizon and no slot is wasted.
  - With the defaults (Wird Daily, Check-in Daily, Random Ayah Daily) that is 58 dated slots: 58 days of Random Ayahs. With the Check-in Twice Daily, 57.
  - With the previous defaults (Check-in Every 3 days, still saved on older installs): 59 dated slots, about 44 days: 44 Random Ayahs and 15 Check-ins.
  - With only the Random Ayah dated (Wird and Check-in Daily or Weekly), 58 days.
  - With Random Ayah Weekly: about 4 months if Check-in stays Every 3 days, or 58 weeks if the other two are Daily or Weekly.
  - Runs are refilled at every launch and every return to the app, adding new dates only at the far end.
  - Because the horizon depends on all three settings, changing one reminder can lengthen or shorten the far end of another's run. Nothing nearer is changed.

**Limitation (operating system):** the dated runs end at their horizon if the app is not opened before then, and resume as soon as it is. There's no reliable way around this with local notifications alone:
- iOS and Android run no app code when a local notification is delivered. expo-notifications' background task runs only for remote (push) notifications.
- No OS trigger can express "every third calendar day at a local time". A repeating 72-hour interval would move the local time at every DST change, which the product rules forbid.
- A repeating request cannot change its text, so it can't carry a different verse each time.

The available alternatives all need approval, and none is guaranteed:
1. **Background refresh** (expo-background-task: BGTaskScheduler / WorkManager), a new native module. iOS decides if and when it runs, and never after the user force-quits the app. Android WorkManager is more regular but may be deferred.
2. **Remote push from a server**, which is a new backend service.
3. **A generic repeating fallback** (e.g. a daily "A message from the Quran awaits" with no verse), which would change the approved Random Ayah wording.

## Random Quran Ayah text

The body is the verse exactly as stored in the verified bundled `quran.sqlite`. Verses longer than 220 UTF-16 units become an exact prefix cut just before a space (a whole word, with all its marks), followed by " …". Nothing is normalized or retyped. A blank line and the reference follow it in the body (no subtitle, which Android does not show), from the verified local surah names: "Ash-Sharh · 94:5" in English, «سورة الشرح · الآية ٥» in Arabic. `tests/randomAyahNotification.test.ts` checks all 6,236 verses and that the database file is unchanged.

## Tap handling (`responseRouting.ts`, `useNotificationResponseRouting.ts`)

The payload holds `{ v, kind }` (v = 2 since 2026-10-17), plus `verseKey`, `surah` and `ayah` for Random Ayah, and `stopId` for a Wird Reminder that names a ورد. It never holds account data, an emotion or a reflection; the ورد's name and page are only in the visible copy. The handler:

- starts in the root layout once preferences have loaded and the root navigator exists;
- reads the tap that launched the app once, then clears it;
- receives later taps through the listener;
- handles each tap (identifier + delivery time) only once.

Handled taps are also kept (the last 50, `quran-heals:notification-handled-taps:v1`), so a launching tap reported again after a reload of the app's code isn't acted on twice.

A reminder change made before the saved settings have loaded is shown at once, then applied over the saved settings (never the defaults), saved and scheduled once they arrive. Nothing is scheduled before then.

The Wird destination is resolved at tap time against the current owner's reading stops. The ورد named by `stopId` opens on its current saved page through `openMushafFor` (the same as Home's Continue Reciting), which makes it the active ورد, so its saved ayah is marked. If that ورد was deleted, or belongs to another owner, the tap opens أورادي وختماتي. A reminder that named no ورد (generic copy, or a version 1 tap) opens the only ورد when there is exactly one, otherwise أورادي وختماتي. A tap never saves a page, completes a ورد or counts a Khatma.

The Random Ayah opens that verse in the Mushaf (`mushafRouteForAyah`, as an ayah card's reference does): its page, with the ayah selected. The `at` parameter makes a reader that is already open move there from any page; the active ورد and its saved page are unchanged. On a cold start the requested page wins over the saved one. The Mushaf and أورادي وختماتي are tabs (`router.navigate`); the emotion list is pushed. Unknown or newer payloads open the app without navigating.

While the Mushaf reader is focused, a reminder that arrives is listed in Notification Centre without a banner or sound.

## Platforms

- **Native modules added:** `expo-notifications`, `expo-localization` and `@react-native-community/datetimepicker`, plus their config plugins in `app.json`. These need a new development/preview build. Expo Go and the current installed builds cannot run them.
- **No push entitlement:** the `expo-notifications` config plugin adds the iOS `aps-environment` (Push Notifications) entitlement even for local-only use, and even when not listed. `app.config.ts`'s `withoutPushEntitlement` removes it again, so the App ID needs no Push Notifications capability.
  - It is placed first in `plugins` because a config mod added later runs earlier.
  - Checked with `npx expo config --type introspect`: the remaining entitlements are Associated Domains and Sign in with Apple.
  - Local notifications need no entitlement; the native code registers for remote push only inside `getDevicePushTokenAsync`, which the app never calls.
  - Adding remote push later means deleting this plugin.
- **Android:** three channels (one per type, importance DEFAULT, renamed with the App Language). It requests `POST_NOTIFICATIONS` on 13+. No exact-alarm permission is requested: an exact alarm is used only where the system already allows one, otherwise Doze and battery optimisation may delay delivery. Reboots are handled by expo-notifications' boot receiver. Lock-screen visibility is left to the user's device settings.
- **iOS:** alert and sound, no badge. Provisional/ephemeral authorization counts as allowed. Lock-screen previews follow the user's settings.
- **Web:** no reminders. The rows say they are available in the iPhone and Android app.
