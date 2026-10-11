# Smart ayah links

A shared ayah link is `https://quran-heals-api.onrender.com/ayah/<surah>/<ayah>`, for example `https://quran-heals-api.onrender.com/ayah/94/5`. It carries only the Quran reference: no user, reflection, emotion or tracking data.

## Why this host

Universal Links and Android App Links need verification files at the root of an HTTPS host, served as `application/json` with no redirects.

- The legal site (`https://quranheals.github.io/legal/`) is a GitHub Pages *project* site. Nothing is served at `https://quranheals.github.io/` or its `/.well-known/` paths (checked: 404), and GitHub Pages can't do server-side store redirects.
- The production API (Render, behind Cloudflare) already serves HTTPS with HSTS, helmet headers and a per-IP rate limit, and can serve both files with exact content types plus a validated redirect. No new service or cost.

The host appears in three places, which `mobile/tests/ayahLink.test.ts` keeps in sync: `AYAH_LINK_HOST` in `mobile/src/utils/ayahLink.ts`, `ios.associatedDomains`, and the Android intent filter in `mobile/app.json`.

If a custom domain is added later, list it alongside the current host rather than replacing it, so links already shared keep working.

## How a link behaves

| Situation | Result |
|---|---|
| App installed, link tapped in Messages, WhatsApp, Mail, Notes, Safari or Chrome | The OS opens Quran Heals at `/ayah/<s>/<a>`: the existing ayah screen, exact ayah, usual Share / Add Reflection / Favorite. Works cold or already open; no sign-in. |
| App not installed, iPhone or Android browser | `302` to the App Store or Google Play (once `APP_STORE_URL` / `PLAY_STORE_URL` are set). |
| Instagram, Facebook, Messenger, TikTok, Snapchat or LINE in-app browser | These usually load the page instead of handing the link to the OS. The server returns a small page with **Open in Quran Heals** (`quranheals://ayah/<s>/<a>`, or an Android `intent://` link that falls back to Google Play) and **Get Quran Heals**. It never shows the ayah and runs no script. |
| Desktop | The same page with the store links only. |
| Not a real ayah (`/ayah/94/9`, `/ayah/02/5`, …) | `404`. In the app, a clear "This ayah link isn't valid" message. |

No deferred deep linking: after installing, the person taps the same link again.

The server ignores query strings (`fbclid`, `igshid`, …). It never logs or caches these responses (`Cache-Control: no-store`, `Vary: User-Agent`, `X-Robots-Tag: noindex`).

## Configuration still needed

**Render (backend environment).** All of these are optional; each feature turns on when its value is set, and the startup log line `Ayah links: …` shows what is active.

| Variable | Value | Enables |
|---|---|---|
| `APPLE_TEAM_ID` | Already set for Sign in with Apple | `/.well-known/apple-app-site-association` |
| `ANDROID_APP_LINK_SHA256_FINGERPRINTS` | SHA-256 of the EAS upload/signing key (`eas credentials -p android`) **and**, after Play upload, the *App signing key* SHA-256 from Play Console → Setup → App integrity. Comma-separated. | `/.well-known/assetlinks.json` |
| `APP_STORE_URL` | The real `https://apps.apple.com/…/id<number>` page, once published | iPhone store redirect |
| `PLAY_STORE_URL` | `https://play.google.com/store/apps/details?id=com.quranheals.app`, once published | Android store redirect |

**Apple Developer.** The App ID `com.quranheals.app` needs the **Associated Domains** capability. EAS normally enables it automatically from `ios.associatedDomains` on the next iOS build; confirm it on the first build. Apple fetches the association file through its CDN, which can take time to refresh after the file changes.

After deploying, check:

```sh
curl -i https://quran-heals-api.onrender.com/.well-known/apple-app-site-association
curl -i https://quran-heals-api.onrender.com/.well-known/assetlinks.json
```

Each should return `200` and `application/json`, with no redirect. Then check Apple's cached copy at `https://app-site-association.cdn-apple.com/a/v1/quran-heals-api.onrender.com`. Use Google's tester at `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://quran-heals-api.onrender.com&relation=delegate_permission/common.handle_all_urls`.

On an Android device, run `adb shell pm get-app-links com.quranheals.app`; the host should show `verified`.

## Known platform limits

- **In-app browsers** (Instagram, Facebook, TikTok) frequently don't hand links to other apps. The fallback page's **Open in Quran Heals** button usually works there, but some versions block custom-scheme navigation; the page then suggests opening the link in Safari or Chrome. Automatic opening can't be guaranteed in these apps.
- **iOS** doesn't open a Universal Link that the person typed or pasted into Safari's address bar, or that comes from a page on the same host. If someone long-presses a link and chooses "Open in Safari", iOS remembers that choice for the domain until they choose "Open in Quran Heals" from the page's banner or long-press menu again.
- **Instagram Stories:** the image never contains a clickable link. The person adds the copied link with Instagram's own Link sticker. The app doesn't (and can't) pre-attach a sticker.
- A cold-start link opens the ayah screen with Home beneath it, so Back returns Home.
