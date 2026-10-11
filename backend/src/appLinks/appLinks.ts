import { Router, type Request, type Response } from 'express';

import { isValidVerseKey } from '../quran/referenceKeys';

/**
 * Smart ayah links: `https://<this host>/ayah/<surah>/<ayah>`.
 *
 * - With Quran Heals installed, iOS (Universal Links) and Android (verified
 *   App Links) open the app directly; this server never sees the tap. The
 *   two verification files below are what make the OS trust the app for
 *   `/ayah/…` paths on this host.
 * - Otherwise the browser requests the link and is redirected to the App
 *   Store (iPhone/iPad) or Google Play (Android). No page ever shows the
 *   ayah, and nothing about the visitor is stored or logged: the query
 *   string (e.g. `fbclid`) is ignored and responses are never cached.
 * - Social apps' in-app browsers usually don't hand links to other apps,
 *   so they get a tiny two-button page instead of a blind redirect: "Open
 *   in Quran Heals" (the app's own `quranheals://` link) and "Get Quran
 *   Heals". No guessing whether the app is installed.
 *
 * Verification files are served only when their identifiers are
 * configured (404 otherwise), and store redirects only to configured store
 * URLs — nothing is invented.
 */

export const APP_IDENTIFIER = 'com.quranheals.app';
export const APP_SCHEME = 'quranheals';
export const AYAH_LINK_PATH_PATTERN = '/ayah/*/*';

export type AppLinksConfig = {
  /** 10-character Apple Developer Team ID (the existing APPLE_TEAM_ID), or undefined until set. */
  appleTeamId?: string;
  /** SHA-256 signing-certificate fingerprints allowed to open Android App Links. */
  androidSha256Fingerprints: readonly string[];
  /** The app's App Store page, once published. */
  appStoreUrl?: string;
  /** The app's Google Play page, once published. */
  playStoreUrl?: string;
};

export type AppLinksEnv = {
  APPLE_TEAM_ID?: string;
  ANDROID_APP_LINK_SHA256_FINGERPRINTS?: string;
  APP_STORE_URL?: string;
  PLAY_STORE_URL?: string;
};

const APPLE_TEAM_ID = /^[A-Z0-9]{10}$/;
const SHA256_FINGERPRINT = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;
const APP_STORE_URL = /^https:\/\/apps\.apple\.com\/[a-z0-9/._-]*id\d+(?:[/?][^\s]*)?$/i;
const PLAY_STORE_URL = /^https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.quranheals\.app(?:&[^\s]*)?$/;

/**
 * Reads and validates the configuration. Malformed values are reported as
 * problems (by variable name only) and left out, so a typo can never put a
 * wrong identifier into a verification file or a redirect.
 */
export function readAppLinksConfig(environment: AppLinksEnv): { config: AppLinksConfig; problems: string[] } {
  const problems: string[] = [];
  const config: AppLinksConfig = { androidSha256Fingerprints: [] };

  const teamId = environment.APPLE_TEAM_ID?.trim();
  if (teamId) {
    if (APPLE_TEAM_ID.test(teamId)) config.appleTeamId = teamId;
    else problems.push('APPLE_TEAM_ID must be the 10-character Apple Developer Team ID.');
  }

  const fingerprints = (environment.ANDROID_APP_LINK_SHA256_FINGERPRINTS ?? '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
  for (const fingerprint of fingerprints) {
    if (SHA256_FINGERPRINT.test(fingerprint)) {
      if (!config.androidSha256Fingerprints.includes(fingerprint)) (config.androidSha256Fingerprints as string[]).push(fingerprint);
    } else {
      problems.push('ANDROID_APP_LINK_SHA256_FINGERPRINTS must be comma-separated SHA-256 fingerprints (32 colon-separated hex bytes).');
    }
  }

  const appStoreUrl = environment.APP_STORE_URL?.trim();
  if (appStoreUrl) {
    if (APP_STORE_URL.test(appStoreUrl)) config.appStoreUrl = appStoreUrl;
    else problems.push('APP_STORE_URL must be the app’s https://apps.apple.com/…/id<number> page.');
  }

  const playStoreUrl = environment.PLAY_STORE_URL?.trim();
  if (playStoreUrl) {
    if (PLAY_STORE_URL.test(playStoreUrl)) config.playStoreUrl = playStoreUrl;
    else problems.push(`PLAY_STORE_URL must be https://play.google.com/store/apps/details?id=${APP_IDENTIFIER}.`);
  }

  return { config, problems };
}

/** iOS 13+ format: only `/ayah/<surah>/<ayah>` paths open the app; `/api/…` never does. */
export function buildAppleAppSiteAssociation(teamId: string) {
  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${APP_IDENTIFIER}`],
          components: [{ '/': AYAH_LINK_PATH_PATTERN, comment: 'A single Quran ayah: /ayah/<surah>/<ayah>' }],
        },
      ],
    },
  };
}

export function buildAssetLinks(fingerprints: readonly string[]) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: APP_IDENTIFIER, sha256_cert_fingerprints: [...fingerprints] },
    },
  ];
}

/** Canonical "surah:ayah" for an exact, existing ayah; null for anything else (leading zeros, out of range, junk). */
export function parseAyahLinkParams(surah: unknown, ayah: unknown): string | null {
  if (typeof surah !== 'string' || typeof ayah !== 'string') return null;
  if (!/^[1-9]\d{0,2}$/.test(surah) || !/^[1-9]\d{0,2}$/.test(ayah)) return null;
  const verseKey = `${surah}:${ayah}`;
  return isValidVerseKey(verseKey) ? verseKey : null;
}

export type VisitorKind = 'ios' | 'android' | 'in-app-ios' | 'in-app-android' | 'other';

// Instagram, Facebook/Messenger, TikTok, Snapchat, LINE in-app browsers.
const IN_APP_BROWSER = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Messenger|musical_ly|TikTok|BytedanceWebview|Snapchat|\bLine\//i;

/** Coarse platform from the User-Agent, used only to pick a store. Never stored. */
export function classifyVisitor(userAgent: string | undefined): VisitorKind {
  const agent = userAgent ?? '';
  const isIos = /iPhone|iPad|iPod/i.test(agent);
  const isAndroid = /Android/i.test(agent);
  const inApp = IN_APP_BROWSER.test(agent);
  if (isIos) return inApp ? 'in-app-ios' : 'ios';
  if (isAndroid) return inApp ? 'in-app-android' : 'android';
  return 'other';
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * The only HTML this feature serves: the app's name and two buttons. It
 * never shows the ayah's text. Static markup, no script; values are
 * escaped even though they are digits and validated store URLs.
 */
export function renderOpenAppPage(options: { surah: string; ayah: string; visitor: VisitorKind; appStoreUrl?: string; playStoreUrl?: string }): string {
  const { surah, ayah, visitor } = options;
  const schemeUrl = `${APP_SCHEME}://ayah/${surah}/${ayah}`;
  const openUrl = visitor === 'in-app-android' || visitor === 'android'
    ? `intent://ayah/${surah}/${ayah}#Intent;scheme=${APP_SCHEME};package=${APP_IDENTIFIER};${options.playStoreUrl ? `S.browser_fallback_url=${encodeURIComponent(options.playStoreUrl)};` : ''}end`
    : schemeUrl;
  const stores: { label: string; url: string }[] = [];
  const wantsIos = visitor !== 'android' && visitor !== 'in-app-android';
  const wantsAndroid = visitor !== 'ios' && visitor !== 'in-app-ios';
  if (wantsIos && options.appStoreUrl) stores.push({ label: 'App Store', url: options.appStoreUrl });
  if (wantsAndroid && options.playStoreUrl) stores.push({ label: 'Google Play', url: options.playStoreUrl });
  const showOpen = visitor !== 'other';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Quran Heals</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F7F2EA;color:#1F2A24;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}
main{max-width:22rem;padding:2rem 1.5rem}
h1{font-size:1.5rem;margin:0 0 .25rem}
p{color:#5F6960;line-height:1.5;margin:.25rem 0 1.5rem}
a{display:block;margin:.75rem 0;padding:.9rem 1rem;border-radius:14px;font-weight:700;text-decoration:none}
.primary{background:#1F2A24;color:#FFFDF8}
.secondary{border:1px solid #E5DED2;background:#FFFDF8;color:#1F2A24}
small{display:block;color:#5F6960;margin-top:1.25rem;line-height:1.5}
</style>
</head>
<body>
<main>
<h1>Quran Heals</h1>
<p>Open this ayah in the Quran Heals app.<br><span lang="ar" dir="rtl">افتح هذه الآية في تطبيق Quran Heals.</span></p>
${showOpen ? `<a class="primary" href="${escapeHtml(openUrl)}">Open in Quran Heals · <span lang="ar" dir="rtl">افتح في التطبيق</span></a>\n` : ''}${stores.map((store) => `<a class="secondary" href="${escapeHtml(store.url)}">Get Quran Heals · ${escapeHtml(store.label)}</a>`).join('\n')}
${showOpen ? '<small>If nothing happens, open this link in Safari or Chrome.</small>' : ''}
</main>
</body>
</html>`;
}

function noStore(res: Response) {
  // Varies by User-Agent and must never be cached by a CDN or browser.
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'User-Agent');
  res.set('X-Robots-Tag', 'noindex, nofollow');
}

export function createAppLinksRouter(config: AppLinksConfig): Router {
  const router = Router();

  // Exact paths, application/json, no redirects — as Apple's CDN and
  // Android's verifier require. 404 until the identifiers are configured.
  router.get('/.well-known/apple-app-site-association', (_req: Request, res: Response) => {
    if (!config.appleTeamId) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/json').send(JSON.stringify(buildAppleAppSiteAssociation(config.appleTeamId)));
  });

  router.get('/.well-known/assetlinks.json', (_req: Request, res: Response) => {
    if (config.androidSha256Fingerprints.length === 0) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/json').send(JSON.stringify(buildAssetLinks(config.androidSha256Fingerprints)));
  });

  router.get('/ayah/:surah/:ayah', (req: Request, res: Response) => {
    noStore(res);
    const surah = req.params.surah;
    const ayah = req.params.ayah;
    if (!parseAyahLinkParams(surah, ayah)) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    const visitor = classifyVisitor(req.get('user-agent'));
    if (visitor === 'ios' && config.appStoreUrl) {
      res.redirect(302, config.appStoreUrl);
      return;
    }
    if (visitor === 'android' && config.playStoreUrl) {
      res.redirect(302, config.playStoreUrl);
      return;
    }
    res.status(200).type('html').send(renderOpenAppPage({
      surah: String(surah),
      ayah: String(ayah),
      visitor,
      appStoreUrl: config.appStoreUrl,
      playStoreUrl: config.playStoreUrl,
    }));
  });

  return router;
}
