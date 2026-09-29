# What the phone has, and what it is missing

The mobile app is not a thin client — it has its own screens, its own kit
(`mobile/src/components/ui.tsx`, `MoreKit`, `SimKit`) and its own pure logic
with its own tests. That is why it drifts: a web feature does not appear here
by being built, and nothing fails when it doesn't.

This is the ledger. `test/unit/mobile-mirror.test.ts` already holds the parts
where the two share pure logic and must agree; everything below is the parts
where they simply do not exist.

## Fixed just now

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

- [ ] **The path** (`/path` on web) — the retention loop's home. The phone has
  `manage/[id]` but no cross-project path screen.
- [ ] **The document builder.**
- [ ] **Discover** as a destination — the phone has search and matches, not the
  combined surface the web sidebar leads with.
- [ ] **Leaderboard, contests, challenges, companies** — partially or not at
  all.

### The kit

- [ ] `client/src/components/nova/` has `Working`, `Loading`, `LiveDot`,
  `Glance`, `Pill` and `Block`. The phone has the *idea* in one place —
  `SeasonProgress` in `SimKit` — and a bare `ActivityIndicator` everywhere
  else. A phone `Working` reading the same stage lists is the piece that would
  pay for itself fastest: the waits are longer on a phone, not shorter.
- [ ] **No error boundary.** The web now has one at two levels, and a render
  throw on the phone still takes the screen out with no way back and no report.
  `ErrorBoundary` is a class component with no DOM in it; the fallback needs
  rewriting in React Native, the reporting does not.

## The rule worth keeping

A feature is not done because the web has it. Either build both, or write the
gap down here on the day — the cost of this list is one line per feature, and
the cost of not having it is discovering in six months that the phone is a
different product.
