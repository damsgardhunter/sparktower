# SparkTower Mobile

Native iOS and Android app, built with Expo (SDK 57 / React Native 0.86) and
Expo Router. Talks to the same Express + Postgres backend as the web app.

## What's built

32 routes — the whole web app has a native equivalent. Every endpoint they
call is verified against the live server.

| Screen | Route | Notes |
|---|---|---|
| Sign in / register | `(auth)/sign-in` | Email + native Google |
| Onboarding | `(auth)/onboarding` | Name, headline, skills, interests |
| Feed | `(tabs)/feed` | Reactions, composer, all 8 post types |
| Discover | `(tabs)/discover` | AI matches, name search, who's looking |
| Projects | `(tabs)/projects` | Your projects |
| Sprints | `(tabs)/sprints` | Queue with live position, practice launch |
| Inbox | `(tabs)/messages` | Conversations + unread badge |
| Profile | `(tabs)/profile` | Nova summary, plan, skills, experience |
| Leaderboard | `(tabs)/leaderboard` | Views, funding, Builder Index |
| Project detail | `project/[id]` | 7 tabs + milestone/phase discussion |
| New project | `project/new` | With private-project gating |
| Public page editor | `project/visibility` | 14 section toggles + private switch |
| AI storyboard | `project/storyboards` | Generator + your private library |
| Manage | `manage/[id]` | Nova dashboard, roadmap, tasks, investor |
| Mock interview | `investor/interview` | Graded, multi-turn, 4 personas |
| Pitch critique | `investor/critique` | Quoted problems and fixes |
| Résumé evaluator | `profile-builder` | Native file upload + draft review |
| Sprint dashboard | `sprint/[id]` | Phases, tasks, Nova partner chat |
| Practice sprint | `sprint/practice` | 3-idea picker |
| Other profiles | `user/[id]` | Public profile + "looking for" |
| Chat thread | `chat/[id]` | Polling, read receipts |
| Games hub | `games` | Top score per game |
| Typing Arena | `games/typing` | Lobby, live opponents, per-char feedback |
| Signal vs. Noise | `games/signal-noise` | One card at a time, 10 scenarios |
| Plans | `pricing` | Usage + plan comparison |
| More | `more` | Overflow menu |
| Not found | `+not-found` | |

**Contests** (`contests`) still exists and works via a deep link, but it's out
of the More menu — same as the web sidebar, while the page is on hold.

**Notes on the ports:**

- **Résumé upload** uses `expo-document-picker` and streams the file from its
  `file://` URI straight to storage, so a multi-megabyte PDF never gets
  base64'd into JS memory. Evaluation runs with `apply: false` first — you
  review what Nova extracted before it overwrites your profile.
- **Storyboard frames** stream from an owner-checked route, so the `<Image>`
  requests carry the Bearer token as a header rather than being public URLs.
- **Typing Arena** turns off autocorrect, autocapitalisation, and spellcheck.
  On a phone they'd silently rewrite what you typed and wreck the accuracy
  score.

**Not verified:** nothing has been run on a device or simulator. It typechecks
and bundles for both platforms, which catches import and type errors, but no
screen has been seen rendering. Expect layout adjustments on first run.

## Running it

```bash
cd mobile
npm install
npm start          # then press i (iOS sim), a (Android emulator), or w (web)
```

On a **physical phone**, install Expo Go and either scan the QR with the
system camera or use *Enter URL manually* with `exp://<your-lan-ip>:8081`. You
don't need to be signed into Expo Go — the account only powers the Projects
auto-discovery list.

The API URL resolves automatically:

- **iOS simulator** — `localhost`, works as-is
- **Android emulator** — rewritten to `10.0.2.2`, which is how the emulator
  reaches your host machine
- **Physical device** — uses the LAN IP that Expo is already serving the
  bundler from

`npm run web` runs the app through `react-native-web` in a browser. Handy for
quickly clicking through screens, but **not a substitute for a device** — the
layout engine differs, and SecureStore falls back to `localStorage`.

**Xcode version floor:** React Native 0.86 requires **Xcode ≥ 16.1**, which
itself requires **macOS ≥ 14.5**. On anything older, `pod install` fails with
"Please upgrade XCode" and there's no workaround short of upgrading. Expo Go
and the web target work regardless.

Override any time with an env var:

```bash
EXPO_PUBLIC_API_URL=https://your-deployed-api.com npm start
```

Make sure the web server is running (`npm run dev` in the repo root).

## Google sign-in

Google **blocks OAuth inside app WebViews** (`disallowed_useragent`), so the app
uses `expo-auth-session`, which opens the system browser. That requires
platform-specific OAuth client IDs.

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
create three OAuth clients:

| Type | Needs |
|---|---|
| iOS | Bundle ID `com.sparktower.app` |
| Android | Package `com.sparktower.app` + your signing SHA-1 |
| Web | Used by Expo Go during development |

Then set these — `.env` in `mobile/` for local, or EAS secrets for builds:

```
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...
```

And on the **server**, so it accepts tokens from those clients:

```
GOOGLE_IOS_CLIENT_ID=...
GOOGLE_ANDROID_CLIENT_ID=...
```

Until these exist the Google button hides itself and email sign-in works.

Also set `MOBILE_TOKEN_SECRET` on the server. It falls back to `SESSION_SECRET`,
which boots fine but means one leaked secret compromises both auth systems.

## How auth works

The web app uses cookie sessions. A native client can't — there's no shared
cookie jar with the API origin and `sameSite` blocks it. So mobile uses:

- **Access token** — HS256 JWT, 15 minute lifetime, sent as `Authorization: Bearer`
- **Refresh token** — 60 days, rotated on every use, only its SHA-256 hash is stored

`attachBearerUser` in [`server/mobile-auth.ts`](../server/mobile-auth.ts) runs
before the routes and populates `req.user` from a Bearer token, so **every
existing `isAuthenticated` route works for mobile with no changes**.

The API client retries once through a refresh on any 401, and shares a single
in-flight refresh across concurrent requests — without that, five parallel
queries on a stale token would trigger five rotations and log the user out.

Tokens live in SecureStore (iOS Keychain / Android Keystore), not AsyncStorage.

## Shipping to the stores

I can't do these — they need your accounts and manual submission.

**Before you can build:**

1. [Apple Developer Program](https://developer.apple.com/programs/) — $99/year
2. [Google Play Console](https://play.google.com/console) — $25 one-time
3. `npm install -g eas-cli && eas login && eas build:configure`

**Then:**

```bash
eas build --platform ios --profile production
eas build --platform android --profile production
eas submit --platform ios
eas submit --platform android
```

**Both stores also require:**

- App icon (1024×1024, no transparency) — the current `assets/icon.png` is
  Expo's placeholder and **will be rejected**
- Screenshots at each required device size
- A hosted privacy policy URL
- Data-collection disclosure — Apple's App Privacy questions and Google's Data
  Safety form. You collect email, name, profile content, and uploads, so answer
  accordingly
- Age rating questionnaire

**Worth knowing:** because the app takes payment for subscriptions, Apple will
expect in-app purchase for digital content sold to iOS users rather than your
Stripe checkout (Guideline 3.1.1). Stripe is fine for the web app, but the iOS
build likely needs StoreKit for plan upgrades, or to remove upgrade flows from
iOS entirely. That's a real design decision, not a config flag — worth settling
before you build for the App Store.

## Where to add screens

Expo Router is file-based: a file in `app/` becomes a route.

```
app/
  _layout.tsx           providers + auth gate
  index.tsx             redirects into the tabs
  +not-found.tsx
  (auth)/               sign-in, onboarding
  (tabs)/               feed, discover, projects, sprints, messages,
                        profile, leaderboard (hidden from the bar)
  project/[id].tsx      public social page
  project/new.tsx
  project/visibility.tsx     public-page section toggles
  project/storyboards.tsx    AI storyboard generator + library
  manage/[id].tsx       Nova dashboard, roadmap, tasks, investor
  investor/interview.tsx     graded mock investor interview
  investor/critique.tsx      pitch critique
  profile-builder.tsx   résumé upload + Nova evaluation
  sprint/[id].tsx       sprint dashboard
  sprint/practice.tsx
  user/[id].tsx         other builders' profiles
  chat/[id].tsx
  games/index.tsx  games/typing.tsx  games/signal-noise.tsx
  contests.tsx  pricing.tsx  more.tsx
src/
  api/client.ts         fetch wrapper, tokens, refresh, uploadFile()
  auth/AuthContext.tsx  session state, Google sign-in
  hooks/useEntitlements.ts
  components/ui.tsx     Screen, Card, Btn, Chip, Field, Segments, …
  components/Composer.tsx    feed post composer
  components/Discussion.tsx  milestone / phase comment threads
  projectSections.ts    public-page section config (mirrors shared/)
  theme.ts              colors, spacing, type scale
```

Project-scoped routes all take the project id as `?id=`, so
`router.push("/project/visibility?id=" + projectId)`.

Add a screen by creating the file and navigating with
`router.push("/your-route")`. Build it out of `components/ui.tsx` primitives
rather than raw `StyleSheet` — that's what keeps 32 screens looking like one
app.

The tab bar holds six items, which is the practical maximum before labels
truncate on small phones. Anything else goes in `more.tsx`.

**Note on shared code:** the web app's `@shared/*` modules can't be imported
here — Metro doesn't resolve that alias, and `shared/schema.ts` pulls in
Drizzle, which shouldn't ship in an app bundle. Three things are restated and
need to stay in sync with their web counterparts:

| Native | Mirrors |
|---|---|
| `src/components/Composer.tsx` | `shared/feed.ts` post types |
| `src/projectSections.ts` | `shared/project-sections.ts` |
| `src/theme.ts` | `client/src/index.css` palette |
