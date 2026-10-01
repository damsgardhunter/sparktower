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
  | `/admin/problems` | `/api/admin/problem-reports` | missing |
  | `/admin/security` | `/api/admin/security` | missing |

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
