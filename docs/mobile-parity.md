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

### Everything from this round of web work

- [ ] **The decision simulator.** "What happens if I hire twelve people?" —
  month by month on the owner's own numbers. Server-side and shared-pure
  already (`shared/simulation/decision-sim.ts`), so the phone needs the screens
  and nothing else. The engine, the baseline reader and the levers all run
  unchanged.
- [ ] **Ten Years From Now, for a real company.** The phone has the *game*
  (`mobile/app/game/`), not the version that values the project you own.
- [ ] **The customer console.** Reasonably last: it is an operator tool, and an
  operator has a laptop.

### Older gaps

- [x] ~~**The path**~~ Done, at `app/path.tsx`, and smaller than it looked: the
  phone already rendered every project's next step — `ContinuePathCard` maps the
  whole list, not just the first — it simply had nowhere to be sent to. The card
  sits behind whatever else is on the feed that day and hides itself entirely when
  the list is empty, which is right on a feed and wrong for a destination. So the
  screen reuses the same rows (two answers to "what next" would disagree within a
  week), turns the card's own heading off, and owns the empty state the card is
  right to refuse.
- [ ] **The document builder.**
- [ ] **Discover** as a destination — the phone has search and matches, not the
  combined surface the web sidebar leads with.
- [ ] **Leaderboard, contests, challenges, companies** — partially or not at
  all.

### The kit

- [x] ~~`Working`~~ Done, and in use on the codebase audit, which previously
  showed the stage as a sentence in small grey text — so a read sitting in
  "reading" for ninety seconds looked exactly like one that had stopped. Which
  segment is filled and what the wait is called come from `src/workingView.ts`,
  mirrored against `client/src/lib/working-view.ts`, and the stage labels from
  `src/auditStages.ts`, mirrored against `client/src/lib/audit-status.ts`.
- [ ] The rest of `client/src/components/nova/`: `LiveDot`, `Glance`, `Pill`,
  `Block`. Smaller than `Working` was and worth doing when a screen needs them
  rather than in advance.
- [x] ~~**No error boundary.**~~ Done. Two levels, as on the web, through
  expo-router's own convention: a layout that exports a component called
  `ErrorBoundary` gets it wrapped around that segment, so a tab screen that throws
  keeps the tab bar and one tap gets you somewhere that works, and the root layout
  is the backstop for a throw in the shell. The fallback is shared between that
  convention and the class (`ErrorScreen`), so there is one of it; the reporting
  is the web's payload to the web's endpoint. Worth knowing: a blank screen is
  worse on a phone than on the web, where there is at least a reload button —
  here the only way out was force-quitting the app.

## The rule worth keeping

A feature is not done because the web has it. Either build both, or write the
gap down here on the day — the cost of this list is one line per feature, and
the cost of not having it is discovering in six months that the phone is a
different product.
