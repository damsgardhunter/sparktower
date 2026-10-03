# What the phone has, and what it is missing

The mobile app is not a thin client — it has its own screens, its own kit
(`mobile/src/components/ui.tsx`, `MoreKit`, `SimKit`) and its own pure logic
with its own tests. That is why it drifts: a web feature does not appear here
by being built, and nothing fails when it doesn't.

This is the ledger. `test/unit/mobile-mirror.test.ts` already holds the parts
where the two share pure logic and must agree; everything below is the parts
where they simply do not exist.

## Fixed just now

### Three things the phone and the web had drifted on

- **Searching your connections for someone to message.** The phone had this
  before the web did, which is the drift running the other way for once — and its
  copy had quietly stopped agreeing. It matched the display name and the headline
  but not the **username**, so a handle typed from memory returned nothing, and it
  left the list in the order the server sent (by when each connection was made)
  rather than by name. Both sides now use a pure module —
  `mobile/src/connectionSearch.ts` against `client/src/lib/connection-search.ts` —
  and `mobile-mirror.test.ts` runs the two on the same rows. The one deliberate
  difference is the nameless fallback: `personName` refuses to print an email on a
  phone and says "Builder".
- **Choosing which part of a photo survives.** Both clients cut a profile photo
  to a circle and a cover to a wide band, and the phone cut the middle without
  asking. It now opens the native crop UI, at the same ratios the web's cropper
  frames (1:1 and 4:1, `mobile/src/profileCrop.ts` mirrored against
  `CROP_PRESETS`). Worth knowing: `aspect` is Android-only, so on iOS the frame is
  square whatever is asked for and a cover is cropped vertically afterwards. The
  choice of *region* is the part that matters and that part works; the shape of
  the frame does not match the web there.
- **"Is there a problem? Report it."** The web puts it in every footer. The phone
  had nothing, so the one person who could tell you a screen was broken had no way
  to. It is now a row in More and a screen at `/report-problem`, which takes a
  `?path=` so a caller can say where somebody was. Deliberately not behind a
  surface flag: a way to say "this is broken" that can itself be switched off is
  the one feature you want left on when something is. Its validator is mirrored
  too, and that mirror immediately earned itself — the phone's copy had the
  ceiling at 2,000 characters against the server's 1,000, which would have let a
  long report pass on the phone and be refused by the server for exceeding a limit
  the screen had just said it was inside.


The profile header — your cover, your face, your three numbers — was on **every
tab**, because the layout set it as the default header and only the menu
overrode it. It is the top of *Home*: it is what you see when you open the app
and it slides away as you read. Above a list of conversations it was a quarter
of the screen spent showing you yourself on the way to something else.

Worse, the header floats over the scene, and three screens left about sixteen
points of room for two hundred and twenty of header — so **Simulations, the
leaderboard and your own profile drew their first rows underneath it**, where
nobody could reach them. That was not a polish problem; it was content you
could not get to.

Both halves came from the same thing: which header a tab wears and how much
room a screen leaves for it lived in different files with nothing keeping them
in step. One list now (`mobile/src/components/header-kind.ts`), read by the
layout and by the hook that answers the spacing, with a test.

## Missing on the phone

**Audited 2026-10-01, and most of this section was wrong.** Five entries
described features the phone already had, one of them 651 lines of it. That is a
worse failure than having no list: the list's own closing rule warns about
discovering in six months that the phone is a different product, but a stale list
sends somebody to rebuild what is already there, and this one nearly did — the
decision simulator was about to be ported on the strength of a line saying "the
phone needs the screens".

What each claim turned out to be, with where the evidence is:

| Was listed as missing | Actually |
|---|---|
| The decision simulator | **Present.** `app/sim/business.tsx`, 651 lines, calling all four `decision-sim` endpoints the server offers |
| Ten Years From Now, for a real company | **Present.** Same file — it POSTs `/decision-sim/ten-years` with an allocation |
| The path (`/path` on web) | **Built just now**, `app/path.tsx` |
| Discover as a destination | **Present**, and larger than the web's: 438 lines against 118 |
| The document builder | **Partly present.** `app/project/[id]/documents/[docId].tsx` plus `manage/tools/Documents.tsx`, 553 lines against the web's 1,212 |
| Leaderboard | **Present**, `app/(tabs)/leaderboard.tsx`. The web has no `pages/leaderboard.tsx` at all, so the comparison in the old entry was to something that does not exist |
| Contests | **Partly present**, 99 lines against 188 |

### Genuinely still missing

- [x] **The admin consoles.** Every web admin page has a phone counterpart as
  of 2026-10-03. What is still open is *acting* from the support console, below,
  which is its own entry. Measured by whether the
  phone calls the route at all, which is the only reliable signal — a path
  comparison flags renames and by-design absences as gaps:

  | Web screen | Route the phone never calls | State |
  |---|---|---|
  | `/admin/revenue` | — | **done** 2026-10-01 |
  | `/admin/ai-spend` | — | **done** 2026-10-01 |
  | `/admin/console` | — | **lookup done** 2026-10-01; acting is not on the phone |
  | `/admin/problems` | — | **done** 2026-10-01; notes are on the web |
  | `/admin/security` | — | **done** 2026-10-01; reset/sign-out on the web |

  All five are on the phone. The pattern across them: the *watching* half is on
  the phone, because that is what somebody does away from a desk, and the half
  that moves money or removes a protection stays on the web. Each screen says
  which half it is rather than being quietly short of the web's.

  **Two the survey missed entirely**, found on 2026-10-03 by listing the web's
  admin pages rather than re-reading this table: `admin-contests.tsx` and
  `admin-promotions.tsx`. This table was built from a chosen five and then
  reasoned about as if it were the whole set, which is the same mistake the pill
  count made twice.

  Both built the same day, with all seven of their routes called and — the part
  that actually mattered — a row each in the More menu. A screen with no row is
  a screen nobody can reach, which is how they stayed missing after the web
  pages existed. Contests can be made and edited from the phone, unlike the
  consoles where acting stays on the web: a grant moves money and a suspension
  takes an account away, whereas a contest is a page of text with two dates on
  it, and the edit most likely to be wanted in a hurry is a date or a status.

  Eleven web admin pages, eleven on the phone, plus the phone's own backing
  console.

  **Problems** keeps the web's restraint — four states and a note, no priority
  and no assignment, because "a triage system with more moving parts than
  reports is a way of not reading them". State changes are on the phone; writing
  the note is not, since it is a paragraph for whoever picks the report up.

  **Security** leads with the one fact the route's own comment singles out —
  "power without a second factor" — as a sentence rather than a column, because
  it is the only thing here that cannot wait for a desk. Resetting a second
  factor and signing somebody out are on the web: both take a written reason,
  and taking a factor off an admin is the one action that makes the platform
  less safe while it is being used to help somebody.

  **AI spend** is built around the four questions `server/ai-spend-routes.ts`
  says a launch day asks — today against the brake, which parts are dear, who is
  spending it and had they paid, and whether the caching is working — rather
  than as a port of the web's charts. A phone is where somebody looks during a
  launch when they are not at a desk. Changing the cap and the cost per credit
  stays on the web, because the live re-costed pricing ladder is the point of
  that control and does not fit; reading the cap is the urgent half and it is
  here.

  **The support console** looks people up and shows what has already been done
  to them, which is the half a phone is for: somebody writes in, you are not at
  a desk. It does not act. `/api/admin/console/actions` reports
  `maxGrantCents`, `maxGrantPerDayCents` and `grantedTodayCents`, so acting
  includes putting money on a balance, capped per operator per day — and a
  mis-tap on a phone is a different accident from a mis-click at a desk. A grant
  is recoverable only in the sense that money can be taken off a balance after
  somebody has seen it.

- [x] **Acting from the support console**, built 2026-10-03 with exactly the
  three things this entry asked for: a confirmation that names the person and the
  amount, the per-operator daily remainder shown before the field rather than
  after the refusal, and the reason the server already requires. Undo came with
  it, because an action taken by a slipped thumb is only recoverable if the way
  back is on the same screen.

  The action catalogue is not restated on the phone.
  `/api/admin/console/actions` sends `CONSOLE_ACTION_DEFS` whole and the phone
  renders what it is given — a power over somebody who is not in the room is
  exactly the list that must not exist twice. Owner-only actions are absent for
  an admin rather than greyed out, and the ones whose subject is a project stay
  on the web, which has the project open beside them.

  Two things this turned up. The grant was sending `amountCents` where the
  handler reads `cents`, so every grant would have been refused as not-a-number
  — found by reading the handler rather than trusting the field name. And the
  per-account history had to start sending `targetId`, without which no client
  can tell that an action has already been undone.

  Each new one needs a row in the Admin group of `(tabs)/more.tsx` or it is dead
  code that typechecks, and owner-only routes need `access?.owner` on the row or
  the row is a door onto "not found". Both are held by
  [`admin-console-parity.test.ts`](../../test/unit/admin-console-parity.test.ts),
  along with the response shape — the phone cannot import the server's types, so
  every interface on it is a copy, and a copy drifts.

- [x] **The weekly rhythm's other half**, built 2026-10-02. The phone had the
  check-in — the act — and nothing the act was *for*. Three of the eleven rhythm
  routes were called; now it is all but the two long setup forms.

  Three new screens, each at its own frequency, linked from the week:

  | Screen | Frequency | What it is |
  |---|---|---|
  | `rhythm/goals/[id]` | set once a quarter, read weekly | The quarter's goals, with progress worked out from the weeks filed |
  | `rhythm/report/[id]` | read once a month | How the numbers moved, what slipped, and the one line about what to fix |
  | `rhythm/settings/[id]` | changed about never | The check-in day, and who gets chased |

  Why those three and not the other two. The goals are read every week, so being
  unable to see them on the phone made the check-in an act with no visible point.
  The report is all reading and short, and the month somebody wants is the one
  that just ended — so it opens on that rather than on the three days of the
  current one. The check-in day and the reminder list are *about the phone*: the
  person who wants the chasing moved to Sunday, or wants to stop being the one
  chased, is holding the device it arrives on.

  What stayed on the web is the line now drawn: the recurring jobs' own CRUD and
  choosing which numbers the project tracks. Both are long forms about the
  project's shape rather than about this week or this quarter.

  Three things worth keeping:

  **Progress is read, never recomputed.** `goalProgress` measures from the
  quarter's first recorded value to the target — a café aiming for 600 covers
  from 500 is halfway at 550, not 92% of the way — and allows about two weeks of
  slack in thirteen before calling a goal behind, because weekly numbers are
  noisy and a badge that cries "behind" in week two teaches people to ignore the
  badge. The phone renders the state it is given. A test fails if it starts doing
  its own arithmetic.

  **An empty reminder list means everyone.** That is the server's default, and a
  checkbox list that read it as "nobody" would show an unticked team and quietly
  turn reminders off for a company that had never touched the setting. The two
  states are drawn differently, and there is a way back to "everyone". Also: the
  days are numbered 0 = Monday, which is *not* `Date.getDay()`.

  **Nova's reading does not claim to be Nova's.** A reply is recomputed from the
  numbers on every save, and asking Nova replaces it with a better-written one —
  but nothing records which is stored, so after a reload the phone cannot know. It
  shows the reply and offers a closer look, rather than labelling it and being
  wrong half the time.

- [x] **Filing a contest entry**, built 2026-10-02 — and this one was missing
  from *both* clients. `POST /api/contests/:id/submit` existed and nothing called
  it: not the phone, not the web. Entering worked and then dead-ended, because
  the list route returned only `isParticipant`, so no screen could tell somebody
  who had joined from somebody who had filed — and so no screen offered to file.

  The server change is small and was the blocker: `GET /api/contests` and
  `GET /api/contests/:id` now carry the viewer's *own* entry as `submission`, and
  only their own, since entries are not public before judging. It is null until
  they have actually filed — a `{ url: null }` object reads as "has an entry" to
  anything checking truthiness, which is how the first version of the phone's
  card came to offer "Change entry" to somebody who had only joined. An
  integration test caught that.

  `submissionUrl` was also a truthiness check, so "asdf" and a thousand
  characters of pasted prose were both accepted and the judge was the one who
  found out. It is parsed now, http(s) only, and the refusals say which way the
  contest is shut: joining takes an `upcoming` contest and submitting does not,
  so somebody entered early is told they are in and may file when it opens —
  different from having missed the deadline, and the old message said neither.

  On the phone it is a sheet rather than a screen: it is a link and a sentence,
  and a contest entered on a phone is usually filed from the same place a minute
  later. The phone stops an empty box and leaves judging what a link *is* to the
  server, so there is one opinion and it is the one that answers.

  The web caught up on 2026-10-02: the same dialog, the same rules, reading the
  same server sentence through one helper. Both clients now call a route that had
  no caller at all.

  **Who else is in** is on the phone as well — the entrant count opens a list of
  names, faces, and whether each has filed. Building it turned up the reason it
  had not been built safely before: `GET /api/contests/:id/participants` takes no
  authentication and was answering with every entrant's `submissionUrl`,
  `submissionNote` and `score`, so a rival could read the work before judging. The
  route now publishes who is in and whether they filed, and nothing else; the full
  story is in [open-gaps.md](open-gaps.md).

  Held by [rhythm-and-contest-entry.test.ts](../test/unit/rhythm-and-contest-entry.test.ts)
  (17) and four new cases in
  [contests.test.ts](../test/integration/contests.test.ts). Thirteen deliberate
  breakages were tried; three got through and are fixed — each one a string that
  also appeared somewhere else in the same file, which is the failure mode this
  file's tests keep hitting.

- [x] **Backers and the thank-you video**, built 2026-10-03 — Manager → Backers.
  The web tab came first because that is where the rest of the manager lives, which
  had it the wrong way round: a personal video is *recorded* on a phone, so the
  camera roll being one tap away is what the feature was for. All four fulfilment
  routes are called. No address and no email, the same as the web, because the
  route sends neither so the whole team can open it.

  The **backer's** own side of it landed the same day, on their own profile under
  "Believed in": the creator's note, a Watch that opens the video through the
  signed-in hand-off, and a Keep-a-copy that puts it in the camera roll.

  Two things differ from the web deliberately. The web plays the file in a
  `<video>` in place, which is the better way to receive something made for you;
  the phone opens it in `WebBrowser` instead, because playing it in the app means
  adding `expo-video` — a native module, so nobody could watch anything until a
  new build went out. And `/api/me/rewards` now sends `videoExt`, which the web
  has no use for: a browser reads a file's type off the response, and a camera
  roll reads it off the name, so a `.mov` saved as `.mp4` is refused by iOS.

  Closing this also closed a bug on *both* clients. The card returned null unless
  there was a listed pledge, and the list leaves out a pledge that has converted
  to equity — so a backer whose only pledge converted could not see the video
  recorded for them on either device.

- [x] **`Block` was four components**, and nothing on the phone is called `Block`
  any more (2026-10-03). The titled-section-with-an-action in `ProjectBits` is
  `ProjectSection`; the labelled block of a section screen in `manage/bits` is
  `SectionBlock`, after `client/src/components/section/block.tsx`, the web file it
  is the native side of. The web keeps both of its own — `section/block`, a
  surface primitive, and `nova/block`, a counted panel — which no longer collide
  with anything, because they are reached by different import paths in a different
  app and each phone name now says which component it is.

  The second rename looked like the expensive one and was the cheap one. Twenty-
  seven files import something from `manage/bits`; two imported the component. The
  earlier note said thirty-six importing files, which counted the module's
  importers rather than the component's.

  Renamed rather than merged, for the reason `nova/Pill` already gives about the
  three Pills: a titled section and a surface primitive are not the same kind of
  thing.

- [x] **The reward notification pointed away from the reward** (2026-10-03). It
  linked to the project's page; the video plays on the backer's profile. Fixed on
  both clients, with the phone mapping kept distinct from the bare `/profile` a
  connection request uses.

- [x] **Pills: narrower than I claimed, and now closed.** I recorded "54 call
  sites hand-picking semantic colours" as a gap. Most were not: `MoreKit`'s Pill
  takes a colour deliberately, for a tier badge or a skill or a plan name, and
  `nova/Pill` already explains why the three are not merged. The genuine drift
  was a pill showing a *state* with a locally decided colour — two in the
  backing console, then the six in the sim surface, all now carrying tones. See
  the settled entry below for the rule that replaced the count.

  The command, not a number:

  ```sh
  grep -rn '<Pill[^>]*\(color\|solid\)' mobile/app mobile/src
  ```

  Then read each one: a tier is decoration, a status is a state.

- [x] **Push notifications**, built 2026-10-02. Before this a notification only
  existed while somebody had the app open and looked at the bell, so everything
  the bell is *for* — an invitation, an offer, a backing decision, a teammate
  blocked on your seat — reached a phone user only if they happened to come back.

  **The in-app inbox was already complete** and is untouched: the phone calls all
  three routes `server/notifications.ts` has, and there is no fourth.

  **What push added**, end to end:

  | Piece | Where |
  |---|---|
  | Which kinds earn a buzz | `PUSHABLE_KINDS` in [shared/notifications.ts](../shared/notifications.ts) |
  | Device addresses, and tickets awaiting a receipt | `push_tokens`, `push_receipts` in [shared/models/auth.ts](../shared/models/auth.ts), migration `0090` |
  | The per-person switch | `users.push_enabled` |
  | Sending, and forgetting dead addresses | [server/push.ts](../server/push.ts) |
  | The four routes | [server/push-routes.ts](../server/push-routes.ts) |
  | The hook into every emitter | one line in `notify()` |
  | Registering, permission, taps | [mobile/src/push.ts](../mobile/src/push.ts), [mobile/src/hooks/usePush.ts](../mobile/src/hooks/usePush.ts) |
  | The offer, and the switch | [mobile/src/components/PushOffer.tsx](../mobile/src/components/PushOffer.tsx) |

  Six decisions worth keeping, because each one is where this usually goes wrong:

  **A third of the kinds push, not all of them.** The test is not "is this
  interesting" but "is this worth a buzz in somebody's pocket": it needs an
  answer, it is money, or it is time-boxed. Reactions, follows and posts from
  people you follow stay in the bell. A product that pushes everything trains
  people to turn push off, and then the twenty-two that mattered stop arriving
  too. Two exclusions are deliberate and argued for in the list's own comment:
  `application_rejected` (being turned down should not arrive on a lock screen)
  and `company_powers`.

  **One hook, at the funnel.** Every one of the forty-odd emitters goes through
  `notify()`, which already filters blocks there for exactly this reason, so push
  went in beside it — a notification kind added next month is covered without
  anybody remembering to cover it.

  **The row is the record; the push is a courtesy.** Nothing in the push path may
  fail a request or roll anything back. It is not awaited, it swallows its own
  errors, and the wording is built lazily — most notifications go to people with
  no phone registered, and this path outlives the request that caused it, so work
  done for nothing is work still running afterwards.

  **The same sentence as the bell.** `notificationText` is shared, so a push is
  not a third wording of one event, and the excerpt is the second line — the
  difference between "Sam commented on your post" and knowing whether it needs
  answering now. A tap goes through `appHref`, the inbox's own tested mapping, so
  the tray and the row land in the same place.

  **Receipts are read.** This is the step that gets skipped. A push token belongs
  to an installation and a deleted app never says so — Expo reports it once, in a
  receipt, fifteen minutes later, on a different endpoint. Unread, the table
  fills with addresses reaching nobody and every send gets slower for good. So
  tickets are written down and a job behind the leader lock reads them, deletes
  the addresses Expo says are gone, and keeps the ones whose failure was about
  the *send* rather than the device.

  **Permission is asked once, in the right place.** iOS allows the dialog once; a
  "no" is permanent until somebody finds the switch in Settings, which they do
  not. So nothing is asked on launch. The offer is a card on the Notifications
  tab — the one screen where somebody can see what they would otherwise have
  missed — and the launch path only ever *checks*, then re-registers, because a
  token can be reissued and a stale one reaches nobody.

  Two switches exist and conflating them would be a trap. The OS one is
  per-install and awkward to reverse. `users.push_enabled` is the account's: it
  goes quiet without giving up the permission, survives a reinstall, and keeps
  the device rows so turning it back on needs no reinstall.

  No server dependency was added — `server/push.ts` talks to Expo over `fetch`.
  `expo-server-sdk` would be a dependency for chunking and a regex, and would not
  do the part that needs care. `PUSH_DISABLED=1` is the brake, read per send so
  it takes effect without a rebuild; the bell fills either way.

  Held by [push.test.ts](../test/integration/push.test.ts) (29),
  [push-routes.test.ts](../test/integration/push-routes.test.ts) (14) and
  [push-wiring.test.ts](../test/unit/push-wiring.test.ts) (20). Twenty-two
  deliberate breakages were tried against them; the two that got through are
  fixed and described in the commit.

  **Still to do before it reaches anybody:** a development build has to be made
  for the new native module (`expo-notifications` is not in Expo Go), and
  iOS needs its APNs key uploaded to EAS — `eas credentials`. Until a build goes
  out, the server side is live and no phone is registered, which is exactly the
  quiet no-op it should be.

- [x] **Earnings** (`mobile/app/earnings.tsx`), done 2026-10-01. Somebody paid on
  their phone could neither see what they had earned nor send the next of it to
  their bank; the web has had both all along. Both of the server's routes are
  called — `GET /api/earnings` and `PATCH /api/earnings/target`.

  The trap in this one is that `balanceCents` and `toBalanceCents` are different
  numbers, differing by exactly what the person topped up themselves. Showing the
  first under a heading about earnings credits somebody for their own deposit, so
  the screen names them separately and a test holds the two apart.

  Switching the target to `bank` is a 422 when Stripe is not connected, not
  ready, or not configured on the server at all — three different reasons, each
  with its own sentence from the server. The screen passes the server's message
  through rather than saying "couldn't change that", because the generic version
  leaves somebody with no idea which of the three to fix.

- [x] **Accepting a company invitation**, done 2026-10-01. The phone had an
  `/invite/[token]` screen already and it was the wrong one: project invites are
  a stored row read by `GET /api/invites/:token`, while a company invite is a
  *signed* token posted to `POST /api/company-invites/accept`. Different
  mechanism, so it needed its own handling, and anybody sent a company link
  simply could not act on it from a phone.

  It reads `?invite=<token>` — the web's own URL for this is
  `/companies?invite=…` — so one link a company sends works wherever it is
  opened, and a deep link lands on the screen that can accept it. There is also
  a paste field, because people paste the whole link rather than the token, and
  it takes the last part after `invite=` for that reason.

  An already-a-member accept is a 200 carrying `alreadyMember: true`, not an
  error, and the screen says "you're already in" rather than claiming a join that
  did not happen.

  This is the one write on the Companies screens, and the read-only test is now
  a list of permitted routes rather than a ban on write verbs: joining a company
  is not running one, and a verb check cannot tell the difference.

- [x] **The Companies surface — built out 2026-10-03.** **41 of 52** routes
  across the six company files now have a phone caller, up from 15 the same day.
  The remaining eleven are all `company-season-routes.ts`, the training-season
  surface another session is building under `app/sim/`, and were deliberately
  left alone.

  `mobile/app/company/[id].tsx` is tabbed the way the web's page is: About (with
  the whole domain-verification flow), Team, Talent, Challenges, Scouting, Admin.

  | File | Routes | On the phone |
  |---|---|---|
  | `company-routes.ts` | 14 | **14 of 14** |
  | `challenge-routes.ts` | 12 | **8 of 12** — the sponsor's seven, plus the founder's side already there |
  | `talent-routes.ts` | 8 | **7 of 8** |
  | `scouting-routes.ts` | 4 | **4 of 4** |
  | `company-verification-routes.ts` | 3 | **3 of 3** |
  | `company-season-routes.ts` | 11 | another session's, in flight |

  Two things are worth keeping from how this was done. The rules are restated,
  never re-decided: `mobile/src/companies.ts` and `mobile/src/challenges.ts` copy
  `shared/`'s tables because Metro cannot resolve `@shared`, and their parity
  tests *execute* both copies over every role, power and action rather than
  comparing them as text. Nothing on the phone decides a permission — the shared
  helpers only grey a control out before somebody taps it, and the server checks
  the same rule again.

  And every tab is readable by anybody who can see the company, writable only
  with the power the server asks for. Hiding a tab would be stricter than the
  server and would hide a company's own candidate list from whoever was told to
  look at it.

  **My own sweep undercounted this at 36.** Five of the eleven "misses" were the
  matcher's fault: four challenge routes called through a `base` template
  variable, and one talent route whose query string put it two characters past a
  length threshold. Checked by hand before the number went in here.

  The original measurement, kept because the per-file split is still the useful
  way to look at this:

  | File | Routes | On the phone |
  |---|---|---|
  | `company-routes.ts` | 14 | **6 of 14** as of 2026-10-03 — the list, one company, accepting an invitation, and three more since |
  | `challenge-routes.ts` | 12 | **5 of 12** — the builder's side, 2026-10-01 |
  | `company-season-routes.ts` | 11 | **the door**, via `/api/sim/join-code`, 2026-10-01. The season surface is being built on the phone under its own `/api/sim/*` family, so a count against this file reads as 0 and understates it. Another session's work, in flight 2026-10-03 |
  | `talent-routes.ts` | 8 | **4 of 8** — the individual's side, 2026-10-01 |
  | `scouting-routes.ts` | 4 | no |
  | `company-verification-routes.ts` | 3 | no |
  | `feed-routes.ts` (company posts) | 3 | no |

  **Built first: being scouted** (`mobile/app/talent.tsx`). It is the slice that
  stands on its own — you do not run a company to be recruited by one — and the
  half that is actually phone-shaped: a company decides to recruit somebody at a
  desk with a track record open in front of them, and the person being recruited
  answers from wherever they are. Until now they could not. The invitation
  existed, the route existed, and the phone had no way to see or answer it.

  Being findable is a privacy control and reads as one, because the server
  defaults it off (`open: row?.open ?? false`) and nobody should be in a
  recruiting pool they did not opt into. Editing the role list is on the web.

  **Private training seasons: measured first, and the answer was one route.**
  The phone already called eleven `/api/sim/*` routes — the desk, the market,
  offers, standings, recovery, decisions, bids — so anybody *seated* in a
  company's season could play the whole thing. What it never called was
  `POST /api/sim/join-code`, which is how a member takes their seat. So a
  company could run a training season, send its members the code, and anyone
  holding a phone could not get in: a missing door with every room behind it
  already built. It is on `app/sim/index.tsx` now.

  The refusal is left as vague as the server's on purpose. That route answers a
  wrong code and a code for a company you are not in identically, because "a
  forwarded code must not confirm it works" — so the phone says the same bland
  thing rather than helpfully explaining the rule.

  The other ten routes are the company's side: buying seats, inviting, starting,
  resolving a year early, watching, the report. A desk job, except `watch` and
  `report`, which are reading and may be worth a phone later.

  **Built third: sponsored challenges, the builder's side** (`app/challenges.tsx`,
  `app/challenge/[id].tsx`): browse by state, read the brief, accept the terms,
  enter, withdraw. The company's seven routes — create, close entries, judge,
  announce — are a desk job.

  `verifiedDomain` is on every card because the server puts it there for that
  reason: "it is the one fact that tells an entrant who is actually asking — a
  name can be anything, and a domain has been checked". `prizeHeld` is shown
  rather than `prize` alone, because that is the row's real state and "the claim
  the whole escrow exists to let the page make"; when nothing is held the screen
  says so.

  `ENTRY_LIMITS` is restated on the phone, as the moderation codes are, and
  checked against `shared/challenges.ts` — a pitch one character under the floor
  is a 400 the entrant reads as "couldn't send that", so the form enforces the
  same number and says how many characters are missing before the tap.

  **Built second: the list and one company** (`app/companies.tsx`,
  `app/company/[id].tsx`). Read-only on purpose. What a phone is for here is
  knowing which companies you are in, who else is in them, and whether the one
  you lead can actually do things yet — which is the verification state, and
  `publicCompany` puts it on the wire precisely so a screen can say what is
  missing. Creating a company, editing it, managing members and running a season
  are forms with consequences and stay on the web.

  The company page reads `me.powers` rather than working the permissions out
  itself, because two implementations of a permission rule is one implementation
  and one bug — the server's own comment says it is computed there "so every tab
  reads one answer instead of restating the rule".

- [x] **The weekly rhythm — the week itself** — built 2026-10-01
  (`app/rhythm/[id].tsx`), reached from `app/project/[id].tsx` and only on the
  Run path, because a `ship_mvp` project has no week to file. Filing the numbers
  and marking a recurring job done are on the phone; choosing which numbers to
  track, editing the jobs, the quarter goals and the monthly report are
  configuration and stay on the web.

  Two details that are the screen rather than decoration. The metrics are
  rendered from what the server sends, in the order it sends them — jsonb does
  not keep key order so `metricsForProject` sorts them deliberately, and a
  restaurant tracks covers where an agency does not, so this screen must never
  be the thing that decides. And an empty box files `null` rather than `0`,
  because the server keeps that difference: zero covers is a bad week, no answer
  is a week nobody counted.

- [x] **The rhythm**, finished — built 2026-10-03 as `mobile/app/rhythm/[id].tsx`,
  reached from `app/project/[id].tsx` on a Run project. It was the best next
  slice and it was: a weekly check-in is a recurring task somebody does away
  from a desk, and it needs no company page to reach it.

  The phone calls `/api/projects/:id/rhythm`, `/rhythm/checkins/:weekOf`,
  `/rhythm/checkins/:weekOf/nova` and `/rhythm/jobs/:jobId/done`.

  The quarter's goals, the settings and the monthly report followed in
  `07329442`, and the recurring jobs in `eff6c40d`: the card could tick a job
  off and not create one, which its own comment admitted, and it only appeared
  once a job existed — so the first could never be added from the phone even in
  principle. Stopping a job and deleting it are kept apart, as the web keeps
  them: a job that ran for a year and then stopped is part of the record of how
  the company was run.

  **Two routes still have no phone caller and that is correct**, not a gap:
  `GET /rhythm/jobs` and `GET /rhythm/checkins` return lists that `GET /rhythm`
  already includes, so calling them would be a second request for data in hand.
  `rhythm-jobs-on-the-phone.test.ts` pins that reasoning, because a bare
  route-coverage count reads it as a hole and somebody would rediscover it as
  one.

  Two corrections this entry earned. Its opening line said "the phone calls none
  of them" for two days after the phone started calling four of them. Then I
  reported goals, settings and the report as still web-only — true when
  measured, and another session had landed them by the time I wrote it down. An
  entry about a gap has to be closed by whoever closes the gap, and a measurement
  has a date on it.

- [x] **The customer console** — which is `admin-console.tsx`, the same screen as
  the support console above, and complete on the phone as of 2026-10-03: the
  lookup, the history, every action whose subject is a person, and undo. This
  entry and that one were the same gap counted twice.
- [x] **`LiveDot` and `Glance`** — built 2026-10-01
  (`mobile/src/components/nova/`). `Glance` is the web's own phone layout rather
  than a new design: the web is `grid-cols-1` with ruled columns only from `sm`,
  so it is already a stack at this width, and `GlanceAction`'s label is
  `sm:hidden` — visible at exactly the width the phone file is for. `LiveDot`
  keeps its ping and stops it dead when inactive, which is also where `Working`'s
  refusal of an `Animated` loop stops applying: there, the stage name and the
  elapsed time already carry the state, and here the dot is the only signal.
- [x] **One `Pill` with the web's tones** — built 2026-10-01
  (`mobile/src/components/nova/Pill.tsx`), with the web's six tones and its
  reasoning about `unknown`: dashed and blue, never red, because "nobody has
  checked" is a question and `bad` is an answer.
- [x] **The pills, settled 2026-10-03 — by rule rather than by count.**

  This entry's number was wrong three times: "54 call sites", then "sixteen in
  eight", then "nineteen in eleven". Each count was taken honestly and was stale
  within a day, because the sim surface was growing underneath it. The count was
  never the thing.

  The thing is the *shape*. A pill whose colour is chosen by a condition is
  answering "what does green mean here" at the call site, and that question gets
  answered once, in `PILL_TONE`. An unconditional colour is a different thing
  and stays: `MoreKit`'s Pill takes a colour deliberately, for a tier, a plan
  name, a figure or a kind — decoration keyed to something that is not a state.

  There were five conditional-colour pills left, plus one unconditional
  "Already open" that was plainly a state. All six now use `nova/Pill`'s tones,
  and `nova-kit-parity.test.ts` holds the rule: **no file may decide a pill's
  colour with a conditional.** That cannot go stale, which a number can.

  Three files hold both kinds, because they show figures and states side by
  side, and import the tone one as `Pill as StatePill` so a reader can tell at
  the call site which question is being answered. Count it with the command below rather than trusting a number in this
  file; the first survey of this said "twenty, in nine files" and was wrong in
  both halves, because it read the first few lines of a grep and then only
  examined the files it had already noticed. `leaderboard`, `admin/backing`,
  `more/UpgradeCard`, `sim/OffersKit` and `sim/StandingsKit` were never looked
  at.

  ```
  grep -rn "<Pill" mobile/src mobile/app | grep -E "colors\.(success|warning|danger|info|textSecondary)"
  ```

  Seventeen now carry a tone: twelve in the five files where *every* `<Pill>` was
  semantic, so one import swap converted the lot — `admin/surfaces`,
  `admin/analytics`, `admin/safety`, `investor/interview`, `sim/index` — and four
  more in `admin/reports`, where all four turned out to be states once read: what
  was reported, why, what was done, and whether the author is suspended.

  `sim/[id]` was looked at and deliberately left: of its three pills, one is a
  state and two are tinted with *brand* colours (`primary`, `novaEmerald`) for a
  venture's niche and its product. Those are decoration keyed to something that
  is not a severity, and the web's tone set has no brand tone — so converting
  them would flatten them to `neutral`, which is a downgrade rather than parity.

  The rest are in files with mixed usage — `DeskKit` (6 of 15 semantic),
  `MarketKit` (3 of 4), `admin/reports` (3 of 4), `sim/[id]` (1 of 3) — where
  swapping the import changes every pill in the file, including the ones that
  legitimately take an arbitrary colour. A first attempt did exactly that and
  broke four files; it was reverted. Those need a decision per call site, and
  `DeskKit` and `MarketKit` are in a directory somebody is usually working in.

  Six of the sixteen sit in `DeskKit` and `MarketKit`, in a directory somebody
  is usually working in; the rest are spread one or two at a time across five
  files nobody has read yet for this.

  `MoreKit`'s and `profile/kit`'s pills are **not** going away: they take a
  colour or a variant for a tier badge or a post type — decoration keyed to
  something that is not a state. The nova one is for states and is the only one
  that should carry a severity. Merging all three would mean deciding a tier and
  a severity are the same kind of thing.
- [x] **`Block` was two different components sharing a name** — four, in fact.
  Closed 2026-10-03: the phone's two are now `ProjectSection` and `SectionBlock`.
  It turned out the phone wanted both, under two names, which is what the open
  question here had guessed.

The items here are held by
[`nova-kit-parity.test.ts`](../../test/unit/nova-kit-parity.test.ts): anything
the web exports and the phone lacks must carry a written reason, a reason for
something since built fails, and a reason for something the web has dropped
fails too — so the list cannot rot in either direction.

### Measured, and both now closed

Both "partly present" rows were compared feature by feature rather than by length,
and in both cases the line difference turned out to be density with exactly one
real gap behind it.

**The document builder**: twenty-seven of the web's twenty-eight capabilities were
already on the phone — adding and deleting blocks and pages, chapter dividers, the
accent colour, running headers, footers, page numbers, columns, filling one block
or all, retrying failed fills, the fill quote, the overflow warning, tightening,
the layout report, the page count, replanning with feedback, publishing to a
folder, opening the PDF. The twenty-eighth was **undo**, and it was the one that
mattered: a restructure is a model call that can drop a section the builder wrote,
so the phone had shipped the destructive half of that pair and not the recovery.
Built. One thing is deliberately different and should stay that way: the phone
opens the *saved* PDF rather than the live render, because
`/api/documents/:id/pdf` needs a session a browser tab does not carry.

**Contests**: the phone had the communities list, join and leave, and the featured
card — and never asked for `/api/contests` at all, so a contest somebody had
actually opened was invisible on the phone and could not be entered from it. Built:
the open contests, the entry count against any cap, the prize, and Enter.

The lesson for the next row like these: a line count cannot settle a half-ported
screen, and it is also not evidence of one. Compare the endpoints each side calls
and the actions each side offers — an afternoon, against the week a port would
have cost.

## The rule worth keeping

A feature is not done because the web has it. Either build both, or write the
gap down here on the day — the cost of this list is one line per feature, and
the cost of not having it is discovering in six months that the phone is a
different product.

And the other half, learned the hard way above: **cross a line off on the day
too.** An entry that is wrong is not merely out of date, it is an instruction to
do work that has already been done, and it is believed precisely because it is
written down. If a claim here cannot be checked in a minute, it should say where
the evidence is — a file and a line count — so the next person can tell whether
it is still true without reading the whole app.
