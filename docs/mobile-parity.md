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

- [ ] **Four of the web's five missing admin consoles.** Measured by whether the
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

- [ ] **Acting from the support console**: suspend, restore, grant credit,
  issue a day pass. Wanted eventually, and wants its own change: a confirmation
  that names the person and the amount, the per-operator daily remainder shown
  before the field rather than after the refusal, and the reason the server
  already requires. The test pairs the two halves, so if the actions arrive the
  line telling people they are elsewhere fails until it goes.

  Each new one needs a row in the Admin group of `(tabs)/more.tsx` or it is dead
  code that typechecks, and owner-only routes need `access?.owner` on the row or
  the row is a door onto "not found". Both are held by
  [`admin-console-parity.test.ts`](../../test/unit/admin-console-parity.test.ts),
  along with the response shape — the phone cannot import the server's types, so
  every interface on it is a copy, and a copy drifts.

- [ ] **Push notifications do not exist.** Measured 2026-10-01, and worth stating
  carefully, because "notifications" is two different features and only one of
  them is missing.

  The **in-app inbox is complete**. The phone calls all three routes the server
  has — `GET /api/notifications`, `GET /api/notifications/unread-count`,
  `POST /api/notifications/read` — and there is no fourth. Nothing to build.

  **Push is absent end to end.** Neither `package.json` lists
  `expo-notifications` or `expo-server-sdk`, nothing in the app asks permission
  or registers a device token, there is no table to store one in, and the server
  sends nothing. The practical consequence: a notification only exists while
  somebody has the app open and looks at the bell. Everything the bell is *for* —
  an invitation, an offer, a season tick, a backing decision — reaches a phone
  user only if they happen to come back.

  The one piece of good news is the shape of the server. Every one of the 46
  emitters across 19 files goes through a single `notify()` in
  `server/notifications.ts`, and the block list is already filtered *there* for
  exactly this reason: "filtering here rather than at each of the dozen emitters
  is the whole point". Push hooks into that one function, after the block filter,
  and no emitter has to know about it.

  What it takes, in order, and none of it is subtle:

  1. `expo-notifications` in the app; ask permission at a point where the person
     has a reason to say yes, not on first launch.
  2. A table of device tokens — one person has several — with the platform and a
     last-seen, plus a migration.
  3. A route the app posts its token to, and one that forgets it on sign-out.
     A token left behind sends somebody else's notifications to a shared phone.
  4. `expo-server-sdk` in the server, sending from inside `notify()`, in batches,
     off the request path. It must not be able to fail a request: the inbox row
     is the record, and the push is a courtesy on top of it.
  5. Expo's receipts, read later, because a token goes stale silently — an
     uninstalled app returns `DeviceNotRegistered` and that token has to be
     deleted or the error rate climbs for good.
  6. A per-person switch, since the thing being added is the one way the product
     interrupts somebody.

  Steps 2–5 are the real work and step 5 is the one that gets skipped and then
  rots. **This is a feature rather than a gap-fill, so it is written down here
  rather than started** — it wants the choice made deliberately, including
  whether it comes before launch.

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

- [ ] **The Companies surface — 54 of 55 routes still have no phone caller.**
  Measured by family rather than by screen name, which is the only signal that
  separates a missing feature from a renamed one:

  | File | Routes | On the phone |
  |---|---|---|
  | `company-routes.ts` | 14 | **3 of 14** — the list, one company, and accepting an invitation, 2026-10-01 |
  | `challenge-routes.ts` | 12 | **5 of 12** — the builder's side, 2026-10-01 |
  | `company-season-routes.ts` | 11 | **the door**, via `/api/sim/join-code`, 2026-10-01 |
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

- [ ] **The rest of the rhythm** — `/api/projects/:id/rhythm` and its siblings:
  the check-in, the recurring jobs, the monthly report. The phone calls none of
  them, which the family-level survey above *missed*, because these live under
  `/api/projects` rather than `/api/companies` and that family is touched. A
  reminder that "the phone never calls this family" finds whole absences and not
  partial ones.

  It is the best next slice and probably the most useful thing left on the phone:
  a weekly check-in is a recurring task somebody does away from a desk, and it
  needs no company page to reach it — the rhythm belongs to a *project* on the
  Run path, so it hangs off `app/project/[id].tsx`, which already exists.

- [ ] **The customer console.** Nothing on the phone, and still reasonably last:
  it is an operator tool and an operator has a laptop.
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
- [ ] **Sixteen semantic pills still pick their colour by hand**, in eight
  files. Count it with the command below rather than trusting a number in this
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
- [ ] **`Block` is two different components sharing a name.** The phone's, in
  `ProjectBits`, is a titled section with an action. The web's is a surface
  primitive. Deciding which one the phone wants is the work, and it is not
  obvious — the phone may want both, under two names.

Both open items are held by
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
