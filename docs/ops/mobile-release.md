# How the mobile app gets into the stores

**This file is the single source of truth for shipping `mobile/` to the App
Store and Google Play.** [deploy.md](deploy.md) covers the server and the web
app, which are a different system on a different host with a different release
cadence. Nothing here deploys the API; nothing there ships a binary.

**Nothing in this document has been done yet.** There is no Apple Developer
Program membership, no Play Console account, no app record in either store, and
no build has ever been uploaded. Every checkbox below is a plan. Do not tick one
until you have done the thing. The parts that are verified — what the code
does, what the config now says — are marked as such; the parts that are policy
read off Apple's and Google's own pages carry a date and a link.

## The shape of it

| | |
|---|---|
| Source | `mobile/` — Expo SDK **57.0.21**, React Native 0.86.3, expo-router, new architecture (verified in `mobile/package.json`) |
| Bundle id (iOS) | `com.sparktower.app` |
| Package (Android) | `com.sparktower.app` |
| EAS project | `f6de2c54-48d9-4f99-90f1-4f7ff3fe6f91`, owner `hunterdamsgard` |
| API it talks to | `https://sparktower.app` — the same Render service [deploy.md](deploy.md) describes |
| Build service | EAS Build (`mobile/eas.json`) |
| Submit | EAS Submit (`submit.production` in the same file) |
| Version | `expo.version` in `mobile/app.json`, bumped by hand |
| Build number / versionCode | **EAS owns these.** `cli.appVersionSource: "remote"` means the `buildNumber` and `versionCode` in `app.json` are ignored for EAS builds and the production profile increments the real ones itself |

## The one-time cost, and which of it recurs

| | Apple | Google |
|---|---|---|
| Programme | Apple Developer Program | Google Play Console |
| Fee | **$99 USD per year, recurring.** Let it lapse and the apps come off the store | **$25 USD, once.** No renewal |
| Account types | Individual or Organization | Personal or Organization |
| D-U-N-S number | **Required for Organization enrolment, not for Individual.** Free from Dun & Bradstreet, but issuing takes days to weeks, so start it before you need it. Organizations also need a work email on the company's own domain and a live website on that domain | Not required for a Personal account. An Organization account needs a D-U-N-S number too |
| Two-factor | Required on the Apple Account before enrolment | Required on the Google account |
| The catch | Apple reviews every submission, typically within a day or two | A **new Personal account cannot publish to production at all** until it clears the closed-testing gate below |

Sources, read 2026-09-17:
[Apple enrolment](https://developer.apple.com/support/enrollment/),
[Play testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465).

### Choosing Individual vs Organization, once, because it is not reversible in practice

An Individual/Personal account ships under **your legal name** — that is the
seller name buyers see on the store listing. An Organization account ships
under the company name, and needs the legal entity, the D-U-N-S number, the
domain email and the website first. Apple does let you migrate later, but it is
a support ticket and a re-verification, not a setting. Decide before you enrol.

For Google the choice matters more than cosmetics: **Organization accounts are
exempt from the 12-tester gate; Personal accounts created on or after 13
November 2023 are not.** If forming an entity was going to happen anyway, doing
it before opening the Play account saves fourteen days of wall-clock time.

## The Google Play closed-testing gate — the thing that decides your launch date

This is the single largest schedule risk in this document, and most guides you
will find are out of date about it.

**The rule:** an app published from a **Personal** Play Console account created
on or after **13 November 2023** must run a **closed test** with **at least 12
testers, opted in continuously for at least 14 days**, before the account can
apply for production access.

- **12, not 20.** Google reduced the minimum from 20 to 12 in December 2024.
  Any guide still saying 20 was written before that and is wrong.
- **Continuously.** The 14 days are per-tester and uninterrupted. A tester who
  opts in, drops out on day 9 and rejoins does not have 14 continuous days —
  their clock restarted. You need 12 people who are *simultaneously* past day
  14 on the day you apply.
- **12 distinct Google accounts, on real devices.** Emulators, duplicate
  accounts and one person's four addresses do not count.
- **Organization accounts are exempt**, as are Personal accounts created before
  13 November 2023.
- After the 14 days you **apply for production access** from the Play Console
  dashboard and answer three questions — how you ran the test and how testers
  engaged, what the app is and who it is for, and what you changed in response
  to feedback. Google says review is typically within seven days. It can be
  refused, and a refusal costs another round.

**What this means for planning.** From a standing start on a new Personal
account, Android is roughly *three weeks* to production: a day or two to get a
build uploaded and a closed track open, fourteen days of testing that cannot be
compressed, then up to seven days of review. iOS, with no equivalent gate, is
days. So: **open the Play account and start the closed test first**, before the
iOS work, and let the fourteen days run in the background.

Recruit more than twelve. Testers go quiet, change phones, and uninstall.
Fifteen to twenty opted in gives you twelve still standing on day fourteen.

- [ ] Decide Personal vs Organization (see above), and if Organization, start
      the D-U-N-S application today — it gates both stores.
- [ ] Open the Play Console account ($25).
- [ ] Create the app, upload a build to the **internal** track, confirm it
      installs and signs in against production.
- [ ] Open a **closed** track, create the tester list, send the opt-in link.
- [ ] Write down the date the twelfth tester opted in. That date plus 14 days is
      the earliest you can apply for production. Put it in a calendar.
- [ ] On that date, apply for production access.

## What a first submission needs, in both stores

Neither store will accept a first build without a complete listing. Gather
these before you build, because a rejected submission costs a review cycle.

| | App Store | Google Play |
|---|---|---|
| Privacy policy URL | **Required.** `https://sparktower.app/privacy` | **Required**, and must be reachable from the listing *and* from inside the app |
| Terms | Not required by Apple, but linked from the listing is normal. `https://sparktower.app/terms` | Same |
| Account deletion | **Required** for any app with accounts (guideline 5.1.1(v)). **Already built** — Settings → delete account, `mobile/app/settings.tsx` → `POST /api/account/delete` (`server/account-routes.ts:44`). Apple also wants a *web* deletion path documented in App Review notes | Play requires an in-app path and a **web URL** where an account can be requested deleted. The in-app path exists; the web URL is an open question below |
| Privacy questionnaire | **App Privacy** in App Store Connect | **Data safety** form in Play Console |
| Screenshots | **At least one 6.9-inch iPhone screenshot** (1320×2868, 1290×2796 or 1260×2736, portrait). Because `ios.supportsTablet` is now `false`, **no iPad screenshots are required** | Phone screenshots (min 2, 16:9 or 9:16, each side 320–3840px), a 512×512 icon, and a 1024×500 feature graphic |
| Listing copy | Name, subtitle, promotional text, description, keywords, support URL, marketing URL | Short description (80 chars), full description (4000), app category, contact details |
| Content rating | Age rating questionnaire | IARC content rating questionnaire |
| Export compliance | Answered in config already: `ITSAppUsesNonExemptEncryption: false` in `app.json`. The app uses HTTPS and the system Keychain and nothing else, which is the standard exemption | n/a |
| Demo account | **Provide one.** App Review cannot sign up, verify an email and build a project inside a 10-minute review. Put a working email/password and a short "do this, then this" in App Review notes | Same, in the "App access" section |

Screenshot sizes read 2026-09-17 from
[Apple's screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

## What the app actually collects, and who else sees it

Copy this into App Store Connect's **App Privacy** questionnaire and Play
Console's **Data safety** form. Every row was read out of the code; the file is
named so you can check it rather than believe it. Nothing here is inferred from
a dependency list.

### Collected and transmitted

| Data | What exactly | Where in the code | Linked to the account? | Used for tracking? | Purpose |
|---|---|---|---|---|---|
| Email address | Sign-up, sign-in, password reset, invites, mentions. Stored in the clear, deliberately — it is a lookup key (`server/pii.ts`) | `mobile/src/auth/AuthContext.tsx`, `server/mobile-auth.ts` | Yes | No | App functionality, account management |
| Name | First and last name on the account and profile | `mobile/app/profile/edit.tsx`, `server/profile-routes.ts` | Yes | No | App functionality |
| User ID | The account id, and a device-local visitor id the app mints itself (`sparktower.visitorId` in SecureStore) | `mobile/src/api/client.ts` (`visitHeaders`) | Yes | No | App functionality, analytics |
| Photos / profile image | A profile picture, chosen with the system document picker | `mobile/src/components/profilePhoto.ts` | Yes | No | App functionality |
| Other user content | Posts, comments, direct messages, project content, sprint messages, live-chat messages, feedback | `mobile/src/components/Composer.tsx`, `server/feed-routes.ts`, `server/account-data.ts` (the export lists every table) | Yes | No | App functionality |
| Files uploaded by the user | Any document attached to a project — presigned PUT straight to cloud storage | `mobile/src/api/client.ts` (`uploadFile`) → `POST /api/uploads/request-url`, `server/replit_integrations/object_storage/routes.ts` | Yes | No | App functionality |
| Product interaction | Every API write, plus explicit page-view and Explore/promotion events. Stored as `activity_events`: event name, path, HTTP method, status, duration, referrer, **user agent**, visitor id, session id (`shared/schema.ts:1405`) | `mobile/src/explore.ts` (`POST /api/track`), `server/analytics.ts` | Yes (and to a visitor id when signed out) | No | Analytics, app functionality |
| Authentication tokens | Access and refresh tokens in the iOS Keychain / Android Keystore, never in plain storage | `mobile/src/api/client.ts` (`expo-secure-store`) | Yes | No | App functionality |
| Device name | `"<device name> · ios 18.5"` sent as the session label so you can see and revoke sessions | `mobile/src/api/client.ts` (`deviceLabel`) | Yes | No | Security, app functionality |
| Install attribution | The deep link that first opened the app, query string and all, capped at 500 chars, kept until sign-up | `mobile/src/api/attribution.ts` | Yes, at sign-up | No | Analytics |
| Payment info | **Not collected by the app.** Stripe's own hosted pages take card details in the system browser; the app never sees them | `mobile/src/components/manage/BackingSummary.tsx` | — | — | — |
| Physical address | Only for merch fulfilment, and only where the web collects it. Sealed at rest with AES-256-GCM (`server/pii.ts`) | `server/printful.ts` | Yes | No | App functionality (shipping) |

### Explicitly *not* collected

Worth stating, because the forms ask: no precise or coarse **location**, no
**contacts**, no **camera or microphone**, no **health or fitness** data, no
**advertising identifier**, no **crash SDK**. The app requests no runtime
permissions at all — the document picker and the in-app browser are system UI
that needs none. Nothing in the app tracks users across other companies' apps
or websites, so **App Tracking Transparency does not apply** and
`NSPrivacyTracking` is `false` in `app.json`.

### Third parties that receive some of it

| Who | What reaches them | Why | Where |
|---|---|---|---|
| **Render** | Everything — they host the API and the database | The app's backend | [deploy.md](deploy.md) |
| **Google Cloud Storage** | Every uploaded file | Uploads must not live on the container disk, which is wiped on deploy | `server/replit_integrations/object_storage/`, `@google-cloud/storage` |
| **Google (Sign-In)** | The OAuth exchange; Google returns an id token with email and name | Google sign-in. The browser is the system browser, not a WebView — Google rejects WebView OAuth | `mobile/src/auth/AuthContext.tsx`, `server/mobile-auth.ts:311` |
| **Stripe** | Name, email, card details (entered on Stripe's page, never in the app), and shipping address for merch | Subscriptions, backing, payouts | `server/stripeClient.ts` |
| **OpenAI** | Project content and the text of Nova conversations | Nova, the AI project partner | `server/openai-client.ts`, `server/nova-assist-routes.ts` |
| **Resend** | Email address and message body | Verification, invites, password resets, notifications | `server/email.ts` |
| **Printful** | Recipient name and shipping address | Printing and shipping backer merch | `server/printful.ts` |
| **Whatever `ERROR_WEBHOOK_URL` points at** | Route *pattern*, status, error, stack, account id. Deliberately never the request body, headers, cookies, query string or raw URL | Error alerting | `server/error-reporting.ts` |

**Answer both forms as "data is collected and linked to the user, and is not
used for tracking."** Both stores let you say data is deletable on request:
say yes, and point at the in-app deletion that already exists.

## The config, and what was wrong with it

Changed on 2026-09-17; each of these was a real defect for a store build, not a
preference.

| What | Was | Now | Why |
|---|---|---|---|
| `extra.apiUrl` | `http://localhost:5001` | `https://sparktower.app` | A release build with that default is an app that cannot reach anything. `localhost` on a phone is the phone |
| API host, belt and braces | one place | three | Every `eas.json` build profile now sets `EXPO_PUBLIC_API_URL` explicitly, and `resolveApiUrl()` in `mobile/src/api/client.ts` refuses a loopback host in a `NODE_ENV=production` bundle, falling back to production and logging why |
| `android.edgeToEdgeEnabled` | `true` | **removed** | SDK 57 no longer honours it — Android 16 makes edge-to-edge mandatory. `@expo/prebuild-config`'s edge-to-edge plugin prints a warning telling you to delete the key. Verified in `node_modules/@expo/prebuild-config/build/plugins/unversioned/edge-to-edge/withEdgeToEdge.js` |
| `ios.supportsTablet` | `true` | `false` | See below |
| `ios.privacyManifests` | absent | present | Apple requires a privacy manifest for required-reason API use |
| `android.blockedPermissions` | absent | `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` | See below |
| `expo-secure-store` plugin | bare string | `{ "faceIDPermission": false }` | Its config plugin otherwise writes a default `NSFaceIDUsageDescription` into Info.plist. The app never calls `requireAuthentication`, so that string advertises a capability it does not have and invites a reviewer question |

### `supportsTablet: false` — the call, and the reason

**There is no iPad layout in this codebase.** The only uses of
`useWindowDimensions` are `ProjectPageTabs.tsx` and `NovaIntro.tsx`, and both
size a single element rather than choosing a layout; there is no breakpoint, no
split view, no `isTablet`, and the widest constraint anywhere is a 320pt text
block. The design is one column under a bottom tab bar. On a 13-inch iPad that
renders as a phone screen stretched across a tablet — legible, but visibly
unconsidered.

`supportsTablet: true` means **Apple reviews the app on an iPad** and rejects
iPad layouts that look broken, and it means App Store Connect demands 13-inch
iPad screenshots of that same layout. `false` ships an iPhone app that still
runs on iPad in compatibility mode, where nobody expects a tablet design.

For v1 that is the right trade. Turn it back on when there is a layout worth
reviewing — it is one line, and adding iPad support later is an ordinary
update, not a new app.

### The privacy manifest, and why only two entries

Apple requires a `PrivacyInfo.xcprivacy` declaring a reason for each
"required reason API" the binary uses. Dependencies ship their own
(`expo-constants`, `expo-file-system`, React Native core all have one in
`node_modules` — checked); what was missing was the app target's.

Declared, both matching what React Native's own manifest declares because that
is what is actually in the binary:

- `NSPrivacyAccessedAPICategoryFileTimestamp` → `C617.1` (files inside the
  app's own container)
- `NSPrivacyAccessedAPICategoryUserDefaults` → `CA92.1` (the app's own
  UserDefaults)

Deliberately **not** declared, because the app does not use them: disk space,
system boot time, active keyboards. `expo-secure-store` uses the Keychain,
which is not a required-reason API. Inventing declarations is not harmless —
they become part of the nutrition label Apple publishes.

`NSPrivacyCollectedDataTypes` is filled in to match the table above. It must
stay consistent with the App Privacy answers in App Store Connect; if you
change one, change both.

### The Android permissions, and the one thing to verify on a device

`expo-file-system` (pulled in by `expo` itself) declares
`READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` with
`maxSdkVersion="32"` — verified in
`node_modules/expo/node_modules/expo-file-system/android/src/main/AndroidManifest.xml`.
This app never touches shared external storage: files arrive through the
Storage Access Framework (`expo-document-picker`), which grants per-file
access and needs no permission, and uploads stream from the app's own cache
directory. Both are now in `blockedPermissions`, so the merged manifest asks
for neither and the Play listing does not show a storage permission nobody can
explain.

- [ ] **Verify on an Android 12 (API 32) or older device** — that is the only
      range where those permissions would have applied — that picking a file
      and uploading it still works. If it does not, remove
      `WRITE_EXTERNAL_STORAGE` from the block list first, then
      `READ_EXTERNAL_STORAGE`, and note here which one was needed.

## Building

```sh
cd mobile
npm install -g eas-cli          # not a project dependency; nothing here pins it
eas login                       # the Expo account that owns the project: hunterdamsgard
eas whoami                      # confirm before anything that costs a build minute

# Non-secret public values the bundle needs. EAS Build does NOT read your local
# mobile/.env — it is gitignored, so it never reaches the build machine.
eas env:create --name EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID     --value '…' --environment production
eas env:create --name EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID --value '…' --environment production
eas env:create --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID     --value '…' --environment production

eas build --profile preview    --platform all    # install on your own devices first
eas build --profile production --platform ios
eas build --profile production --platform android
```

**Do not skip `preview`.** It is the same code and the same production API as
the store build, installable on your own phone, and it is where you find out
that sign-in is broken — rather than finding out from App Review four days
later.

**The Google OAuth client ids are the loud failure mode.** They are read from
`EXPO_PUBLIC_*` variables at bundle time (`mobile/src/auth/AuthContext.tsx`),
and `mobile/.env` is gitignored and therefore invisible to EAS. If they are not
set as EAS environment variables, the store build ships with Google sign-in
**silently turned off** — `GOOGLE_CONFIGURED` is false, the button does not
appear, and nothing in the build log says so. Check the preview build's sign-in
screen before you spend a production build on it.

The first iOS build asks to create a distribution certificate and provisioning
profile; say yes and let EAS manage them. The first Android build asks to
generate an upload keystore; say yes, and understand what you just accepted —
**that keystore is the app's identity forever.** Lose it and you cannot update
the app under the same package name. EAS stores it; back it up anyway
(`eas credentials`), somewhere that is not this laptop.

## Submitting

```sh
cd mobile
eas submit --profile production --platform ios
eas submit --profile production --platform android
```

`submit.production` in `eas.json` is scaffolded and **every value in it is a
placeholder**. The comments in that file say where each one comes from. Fill
them before the first submit; the commands above will fail loudly on each one
until you do, which is the intended behaviour.

Order of operations, because some values do not exist until earlier steps are
done:

1. App Store Connect → **My Apps → +** → create the app record with bundle id
   `com.sparktower.app`. Only now does `ascAppId` exist (App Information →
   General Information → Apple ID, a 10-digit number).
2. Play Console → **Create app** with package `com.sparktower.app`. The first
   upload must go to a testing track.
3. Fill the listing, the privacy questionnaires and the screenshots. Both
   stores block submission on an incomplete listing.
4. Build, then submit.
5. iOS: the binary appears in TestFlight first. Test it there, then submit for
   review from App Store Connect, with the demo account in the review notes.

## Rolling a release back

This is the part that is least like the server, and the part most worth reading
before you need it. **There is no rollback.** A shipped binary is on people's
phones and stays there.

| | What you can actually do |
|---|---|
| **iOS, before release** | If the version is "Pending Developer Release", just do not release it. If it is in review, **Reject this build** in App Store Connect and submit a new one |
| **iOS, after release** | **Remove from Sale** (App Store Connect → Pricing and Availability) stops new downloads within hours. It does not remove the app from anyone who has it. The only real fix is a new build through a new review — use **Expedited Review** (App Store Connect → Contact Us) for a genuine breakage; it is a favour, not a lever, so do not spend it twice |
| **Android, before rollout completes** | If you used a staged rollout, **Halt rollout** in the Play Console. Everyone not yet upgraded stays on the previous version |
| **Android, after full rollout** | You cannot re-publish an older `versionCode` — Play refuses lower version codes permanently. Ship a new build with a higher code containing the old code. **Halt rollout** on the bad release first so it stops spreading while you build |
| **The fastest fix, both stores, no review** | **The surface kill switch.** `https://sparktower.app/admin/surfaces` turns a feature off server-side and reaches every client within ten seconds ([deploy.md](deploy.md) — "Rolling back"). A broken feature in a shipped binary is a *server* problem if the server can switch it off, and that path takes minutes instead of days. Reach for it first |
| **A bad API change** | Roll the API back on Render. Every shipped app version talks to the same API, so an API rollback affects every installed build at once — including versions of the app you can no longer change. Treat the API contract as permanent from the day version 1.0.0 ships |

**Always stagger the Android rollout.** Start at 10–20%, watch, then go to
100%. It is the only undo either store gives you.

## Release log

Nothing has shipped. First entry goes here.

| Date | Version | Build | Platform | Notes |
|---|---|---|---|---|
| | | | | |

## Open questions — things nobody has confirmed

Written down rather than guessed at.

- [ ] **`expo-splash-screen` is not installed, so the `splash` block in
      `app.json` does nothing.** Verified: the package is absent from
      `mobile/package.json` and from `expo`'s own bundled dependencies, and
      `@expo/prebuild-config` in SDK 57 contains no splash plugin at all — the
      legacy top-level key is no longer read by anything. A store build will
      show a default blank launch screen, which is not a rejection but is a bad
      first impression. Fix before the first build:
      `npx expo install expo-splash-screen`, then move the settings into the
      plugin: `["expo-splash-screen", { "image": "./assets/splash-icon.png",
      "backgroundColor": "#FFFFFF", "imageWidth": 200 }]`. Left undone here
      because `mobile/package.json` was outside this change's scope.
- [ ] **The adaptive-icon layers are 512×512, where Expo now wants 1024×1024.**
      Checked, and the rest is fine: `icon.png` is 1024×1024 **with no alpha
      channel**, which is the one that would have failed the upload outright.
      512 still builds and still looks right on a phone; regenerate at 1024 if
      it looks soft on a large launcher. Re-run the check any time the art
      changes:

      ```sh
      cd mobile && node scripts/check-store-assets.mjs
      ```

      It reads the PNG headers directly, has no dependencies, and exits
      non-zero, so it can go in CI. It checks dimensions and alpha — not
      whether the art keeps clear of the adaptive icon's safe circle, which
      still needs eyes on it.
- [ ] **Universal links are not configured.** Invite links
      (`https://sparktower.app/invite/<token>`) will open a browser, not the
      app, and `src/api/attribution.ts` only ever sees the custom
      `sparktower://` scheme. Fixing it needs `ios.associatedDomains` plus an
      `apple-app-site-association` file and an `assetlinks.json` served from
      the web app — a server change, so it was left out. Decide whether v1
      ships without it.
- [ ] **`channel` is set on every build profile but `expo-updates` is not
      installed.** So there are no over-the-air updates: every fix is a store
      round trip. That may be the intended choice — OTA updates have their own
      review rules — but it is currently an accident rather than a decision.
- [ ] **Does the `/privacy` page satisfy Play's Data safety requirement?** Play
      wants the policy to cover what the *app* collects, name the third parties
      above, and state the retention and deletion path. The page is being
      written separately; check it against the table in this document before
      submitting, and keep the two in sync.
- [ ] **Is there a web URL where an account deletion can be requested?** Play
      requires one *in addition to* the in-app path, reachable without
      installing the app. The in-app route exists
      (`mobile/app/settings.tsx` → `POST /api/account/delete`); the web-facing
      equivalent has not been checked.
- [ ] **Who is the App Review demo account, and does it have data?** A brand
      new empty account shows a reviewer an empty app. Create one with a
      project, a couple of posts and a sprint, and keep it alive — a demo
      account that fails email verification reads as a broken app.
- [ ] **What does the paywall do on iOS?** Apple's guideline 3.1.1 requires
      in-app purchase for digital content and forbids steering users to
      external payment. This is being changed separately
      (`mobile/app/pricing.tsx`, `mobile/src/components/more/UpgradeCard.tsx`);
      confirm what it ended up doing before submitting, because it is the most
      common reason an app like this is rejected.
- [ ] **Android file attach on API ≤ 32** — the `blockedPermissions` check
      above. Untested, because it needs a real old device or emulator image.
- [ ] **Who holds the Android upload keystore backup, and where?** EAS has it;
      "EAS has it" is not a backup strategy. Losing it means never updating
      this package name again.
