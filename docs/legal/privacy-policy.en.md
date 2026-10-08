> **DRAFT — NOT FOR PUBLICATION.** Requires final legal and product review before it is published or linked from the app or the app stores. Items marked **[TO CONFIRM]** must be completed. Prepared from the code as of October 2026 (see `docs/legal/README.md` for the data inventory behind each statement).

# Quran Heals Privacy Policy

**Effective date:** [TO CONFIRM]
**Operator ("we", "us"):** [TO CONFIRM: legal name of the person or entity that publishes Quran Heals, and postal address]
**Contact:** [TO CONFIRM: privacy contact email]

Quran Heals helps you find Quran verses that speak to how you feel, save the ones that matter to you, and write private reflections (خواطر). You can use the whole app **without an account**. An account is optional and only needed to sync your data between your own devices.

This policy explains what information the app handles, where it is kept, who can see it, and the choices you have.

## 1. Summary

- No account is needed. Without one, everything you save stays on your device.
- If you sign in (with Apple or Google), we store your account, favorites and preferences on our servers so they sync between your devices.
- **Reflections you sync are end-to-end encrypted**: they are encrypted on your device with a key protected by your sync password before they leave it, and we cannot read them.
- **Not everything is end-to-end encrypted.** Your account details, favorites, preferences and issue reports are stored in a form we can read (they are protected in transit and by our providers' security, but not end-to-end encrypted).
- We do not sell your information, show ads, or use analytics or advertising trackers.
- You can delete your account and all synced data at any time from the app.

## 2. Information stored only on your device

Whether or not you have an account, the app stores the following **on your device**:

- **Reflections (خواطر)** you write, in readable form. They are protected by your device's own security (for example your device passcode), not by an extra layer of app encryption. If the same reflection was changed on two of your devices before they synced, the version that was replaced is also kept on the device so you can review it.
- **Favorites** (saved ayahs) and a short history of recently shown ayahs, used to avoid showing you the same ayah again too soon.
- **Settings**: app language, Quran translation display, appearance (light/dark), and Quran text size.
- A cached copy of the list of emotions, so the app works offline.
- If you are signed in: your account's basic profile (an internal account ID, whether you used Apple or Google, your email address if one was provided, and when the account was created); your sign-in tokens; and, after you enter your sync password, the key that decrypts your synced reflections. Tokens and the key are kept in your device's secure storage (iOS Keychain / Android Keystore).

This information stays on your device unless you sign in and sync (section 3). Signing out does not delete reflections or favorites from your device. Deleting your account removes that account's reflections and favorites from the device you deleted it on (section 8). Uninstalling the app removes the data the app stores on that device.

## 3. Information we store if you create an account

Signing in is optional. If you sign in, we store the following on our servers:

| Information | What it contains | Readable by us? |
|---|---|---|
| Account | Sign-in provider (Apple or Google); the provider's identifier for your account; email address and whether it is verified, if the provider shares one (with Apple, this may be a private relay address); creation and update times | Yes |
| Sessions | Hashed (not reversible) sign-in tokens with their expiry, rotation and revocation times. We do **not** store your IP address or device details with sessions. | Yes (hashes only) |
| Favorites | Which ayahs you saved (by verse reference, e.g. 2:286), deletion markers, and times | Yes |
| Preferences | App language, translation display mode, translation identifier, and time of last change | Yes |
| Synced reflections | The verse reference each reflection belongs to; the reflection text **encrypted on your device**; encryption metadata; when it was created/updated; and, if the same reflection was edited on two devices before syncing, the other **encrypted** version(s) so neither is lost. For a deleted reflection, only the verse reference and deletion time. | Verse reference and times: yes. **Reflection text: no.** |
| Encrypted reflection key | Your reflection key, **encrypted with your sync password** on your device, with the values needed to unlock it (a random salt and a work-factor setting) and a one-way fingerprint | No — it cannot be unlocked without your sync password |
| Apple revocation credential (Apple accounts only) | A token from Apple, **encrypted** by us, used only to revoke Quran Heals' access to your Apple ID when you delete your account | Only by our server, for that purpose |

We never receive your Apple or Google password, and we never receive your sync password.

## 4. Sync password and end-to-end encryption of reflections

When you first sync reflections, the app asks you to create a sync password (shown in the app as "Password"). It is separate from your Apple or Google sign-in.

- Your reflections are encrypted on your device before upload, using a random key. That key is itself encrypted on your device with a key derived from your sync password. Only the encrypted forms reach our servers.
- We cannot read your synced reflections, and we cannot recover them for you.
- **If you forget your sync password**, synced reflections cannot be decrypted by anyone, including us. The app offers a reset: after you confirm your identity with Apple or Google, it deletes your encrypted reflections and encrypted key from our servers and lets you set a new password. Reflections still stored on your device are kept and are uploaded again, encrypted with the new password. Reflections that existed **only** on our servers are permanently lost.
- Anyone holding the encrypted data could try to guess your sync password. A longer, unique password makes this much harder.
- End-to-end encryption covers **reflection text only**. It does not cover your account details, favorites, preferences, verse references or timestamps of reflections, or issue reports.

## 5. Issue reports

You can report a problem from the app, with or without an account. A report contains:

- the category you choose and any comment you write;
- an email address, **only if you choose to enter one** so we can reply;
- context to help us find the problem: the verse and emotion on screen (if any), app language, translation display setting, app version, and platform (iOS, Android or web).

Reports are **not linked to your account** and never include your reflections. Because they are not linked, deleting your account does not delete them; contact us (section 11) to have a report deleted. Please do not include sensitive personal information in comments.

We keep issue reports for [TO CONFIRM: retention period, e.g. 12 months] and then delete them. [TO CONFIRM: automatic deletion is not yet implemented; see `docs/legal/README.md`.]

## 6. Information processed automatically

- **Network requests.** When the app talks to our servers (for example to load an ayah), our hosting provider processes your IP address and basic request information to deliver the response. Our servers use your IP address in memory to limit abusive traffic (for at most one hour); we do not store it in our database.
- **Error monitoring.** [TO CONFIRM: whether enabled at launch.] If enabled, our server reports technical errors to an error-monitoring service. These reports are configured to exclude request contents, user identifiers, email addresses, tokens and reflection data. The mobile app does not currently include crash reporting; if we add it, we will update this policy first.
- **App updates.** The app checks for updates through Expo's update service, which receives technical information such as the app version, platform and your IP address.
- **Links you open.** "Read in Quran" opens tanzil.net in your browser; that site's own privacy policy applies.

## 7. How we use information, and our legal bases

We use information only to:

- provide the app and, if you sign in, your account and sync (performance of a contract / providing the service you request);
- keep the service secure, prevent abuse and fix errors (our legitimate interest in a safe, working service);
- reply to an issue report when you give us an email address (your consent, which you can withdraw).

We do not use your information for advertising, profiling or automated decisions, and we do not sell or rent it.

## 8. Retention and deletion

- **Account data** (section 3) is kept until you delete your account.
- **Sessions** expire after 60 days of inactivity and are then removed automatically. Signing out ends the session on that device.
- **Deleting your account** (Settings → Account → Danger Zone → Delete Account) immediately and permanently deletes from our database your account, sessions, favorites, preferences, encrypted reflections, encrypted reflection key and Apple revocation credential. For Apple accounts we also revoke Quran Heals' access to your Apple ID. On the device you use to delete, the account's reflections and favorites are also removed; other devices are signed out but keep any copies stored on them until you uninstall the app there (or clear its data). See our account deletion page: [TO CONFIRM: URL].
- **Backups.** Deleted data may remain in our database provider's encrypted backups for up to [TO CONFIRM: backup retention period] before being overwritten.
- **Issue reports**: see section 5.

## 9. Service providers

We use these providers to run Quran Heals. They process information on our behalf and only as needed for their service:

| Provider | Purpose | Information |
|---|---|---|
| Apple (Sign in with Apple) | Optional sign-in | Your Apple sign-in, per Apple's privacy policy |
| Google (Google Sign-In) | Optional sign-in | Your Google sign-in, per Google's privacy policy |
| Render | Hosts our server | Requests to our server, including IP addresses |
| MongoDB Atlas | Hosts our database | The data in section 3 and issue reports |
| Expo (EAS Update) | Delivers app updates | App version, platform, IP address |
| Sentry [TO CONFIRM: if enabled] | Server error monitoring | Scrubbed technical error details |

[TO CONFIRM: hosting regions for Render and MongoDB Atlas, and the safeguards for international transfers if users are outside that region.]

We may disclose information if required by law, to protect the safety of users or the public, or as part of a transfer of the service, in which case this policy continues to apply.

## 10. Security

Connections between the app and our servers are encrypted (HTTPS). Sign-in tokens are stored hashed on our servers and in secure storage on your device. Synced reflections are end-to-end encrypted (section 4). No system is perfectly secure; please use a strong, unique sync password and keep your device protected.

## 11. Your rights and choices

Depending on where you live (for example under the EU/UK GDPR or California law), you may have the right to access, correct, delete or receive a copy of your personal information, to object to or restrict some processing, and to withdraw consent. You can:

- use the app without an account;
- delete your account in the app at any time;
- remove Quran Heals' access from your Apple ID or Google Account settings;
- contact us at [TO CONFIRM: privacy contact email] for any other request, including deleting an issue report. We may need to confirm you own the account before acting.

You may also complain to your local data protection authority.

## 12. Children

Quran Heals is not directed at children under [TO CONFIRM: 13, or a higher age where local law requires], and we do not knowingly create accounts for them. If you believe a child has given us personal information, contact us and we will delete it.

## 13. Changes to this policy

We will post any changes here and update the effective date. If a change materially affects how we use information you have already given us, we will tell you in the app before it takes effect.

## 14. Contact

[TO CONFIRM: operator name, address and privacy contact email]
