# Making the rest of the site feel like the Codebase tab

**Status: in progress.** The kit exists and eleven screens are on it. The list
at the bottom is what is left, and it is the point of this file — a design
system half-applied is worse than none, because now there are two conventions
instead of one and no way to tell which a screen is meant to follow.

`test/unit/nova-look.test.ts` enforces the parts that can be enforced. This
file tracks the parts that cannot.

## Why the Codebase tab is the model

It is the screen this product got right, and it is worth being precise about
what "right" means, because "make it look like that" is not actionable.

**It says what the machine is doing, not that something is happening.** A code
read takes a minute or two. A spinner over that minute answers none of the four
questions a person actually has — what is it doing, how far through, how long
has it been, is it stuck — so the tab answers all four: a segment per stage,
the stage named in words ("Nova is reading it"), who started it, and the
elapsed time.

**It answers "where am I and what now" before any prose.** Three facts and one
button across the top: *Code* — which repository. *Last read* — when, and
whether this is live. *Do now* — the button. Somebody who opens it daily gets
what they came for without reading a sentence.

**It is short.** The alternative, which most of this product still does, is a
paragraph explaining the feature above a button. A paragraph is read once by
somebody new and skipped for ever by the person who lives on the screen — so
the screen is tuned for its least frequent visitor.

**The gradient means something.** Nova's colours appear on the things that are
alive: the live dot, the progress bar, the "do this next" chip. Not as
decoration. When everything is gradient, nothing is.

## The kit

`client/src/components/nova/` — import from `@/components/nova`.

| Component | For |
|---|---|
| `Working` | A wait somebody set off. Stages, the current one named, who and how long. Takes `progress` only where something genuinely counts. |
| `Loading` | A screen's own first fetch. A gradient bar and one honest line, instead of a spinner in an empty page. |
| `LiveDot` | "This is being watched." `active`, `size`, `tone`. |
| `Glance` / `GlanceStat` / `GlanceAction` | The three-fact strip and its one button. |
| `Pill` | A small state badge. `unknown` is blue and dashed, never red — "nobody checked" is a question, not a failure. |
| `Block` | A section of a long screen, ruled rather than boxed. Cards are for things that could move elsewhere. |
| `NOVA_GRADIENT` etc. | The classes. Defined once; `shared/backing.ts` holds the same colours as CSS for inline styles. |

### Rules worth keeping

- **Never invent a percentage.** `Working` draws the running stage at 60%
  because nothing knows better. Pass `progress` only when something is actually
  counted, as the build counts steps.
- **Name the stage in the words a person would use.** "Nova is reading it", not
  "PROCESSING". The stage list comes from the same constant the server reports,
  so the two cannot drift.
- **A wait that survives a refresh belongs on the server.** The build and the
  code read both read a run row rather than holding a local spinner, which is
  why reloading mid-run does not lose the wait. Anything costing real money
  should do the same — people reload after paying.

## Done

| Screen | What changed |
|---|---|
| `components/codebase-tab.tsx` | The source of the pattern; now imports it instead of defining it. |
| `components/section/nova-builds-business.tsx` | Had a hand-copied, already-diverging version. On `Working`, keeping its real step-count progress. |
| `components/section/codebase.tsx` | The path strip's read banner said "Nova is reading your code" during *all three* stages — including fetching and saving, when it was doing neither. Now the real stage. |
| `components/manager/manager-rail.tsx` | Two hand-rolled dots → `LiveDot`. |
| `components/section/live.tsx` | Sync indicator → `LiveDot` with `tone="warn"` when it has stopped getting answers. |
| `components/live-projects.tsx`, `components/sim/projection-dock.tsx` | → `LiveDot`. |
| `pages/admin-console.tsx`, `admin-reports.tsx`, `admin-surfaces.tsx`, `game-boards.tsx`, `components/roadmap-tab.tsx`, `pages/document-builder.tsx` | Bare spinners → `Loading` with what is actually being fetched. |

## Left to do

Ordered by how much the screen is worth fixing, not by how easy it is.

### 1. Long AI waits still showing only a spinner

These are the ones that matter: minutes of machine work with nothing said about
it. Each needs a server-side run row before `Working` can be honest about it,
which is most of the job.

- [ ] `pages/document-builder.tsx` — plan and fill are both long model calls. The initial load is done; the *generation* is still a spinner.
- [ ] `pages/pm-extended-tabs.tsx` — personas, research, strategy: 16 spinners, all AI.
- [ ] `components/sim/decision-lab.tsx` — two model calls per question. **Peer session is editing this; leave it.**
- [ ] `components/sim/ten-years-from-now.tsx` — one long valuation. **Peer session is editing this.**
- [ ] `components/health-check-panel.tsx` — also the last inline gradient literal on a button.
- [ ] `components/nova-task-planner.tsx`, `components/nova-guide.tsx`

### 2. Screens whose first load is a bare spinner

Mechanical: swap for `<Loading what="…" />` and say what is being fetched. Low
risk, and it is the difference between "the app is thinking" and "reading your
roadmap".

`App.tsx` · `components/company/training-tab.tsx` · `components/game/verdict.tsx` ·
`components/investor-tools.tsx` · `components/media-gallery.tsx` ·
`components/profile-resume-panel.tsx` · `components/project-calendar.tsx` ·
`components/reputation-card.tsx` · `components/storyboard-library.tsx` ·
`components/verify-email.tsx` · `pages/admin-analytics.tsx` ·
`pages/admin-contests.tsx` · `pages/admin-promotions.tsx` · `pages/admin-safety.tsx` ·
`pages/admin-security.tsx` · `pages/backing-review.tsx` · `pages/challenge.tsx` ·
`pages/companies.tsx` · `pages/company.tsx` · `pages/invite-accept.tsx` ·
`pages/join-season.tsx` · `pages/onboarding.tsx` · `pages/project-dashboard.tsx` ·
`pages/project-manager.tsx` · `pages/public-artifact.tsx` ·
`pages/security-settings.tsx` · `pages/startup-game.tsx` · `pages/talent.tsx` ·
`pages/simulation*.tsx` (six of them)

`components/codebase-tab.tsx` keeps one deliberately: it is inside a button,
where a spinner is the right thing.

### 3. Gradient written out by hand

Six files left. Each is an inline use in a shape the constant does not cover —
a keyline, a blurred glow, a chip — so these want looking at one at a time
rather than a find-and-replace. The unit test pins the count at 6 so it can
only go down.

`components/featured-contest-card.tsx` · `components/feed-composer.tsx` ·
`components/health-check-panel.tsx` · `pages/contest-detail.tsx` ·
`pages/nova-intro.tsx` · `pages/project-create.tsx`

### 4. Wordiness and layout

Not mechanical, and not a checklist item you can tick — it is a rewrite per
screen. The test cannot catch it. The screens furthest from the Codebase tab's
brevity, worst first:

- [ ] `pages/onboarding.tsx` — paragraphs where a glance strip belongs.
- [ ] `pages/project-dashboard.tsx` — several cards saying the same thing.
- [ ] `pages/pm-extended-tabs.tsx` — every tab opens with an explanation.
- [ ] `pages/company.tsx`, `pages/talent.tsx` — intro prose above every section.

### 5. Found while doing this, not fixed

- [ ] **`e2e/capital-path.spec.ts` fails on this branch**, at
  `capital-profile-card` — the founder gets through the intake and the card
  never appears. Confirmed not to be any of this work: it fails identically
  with the UI changes reverted. It sits on `shared/capital.ts` and
  `shared/phase-trees/systemize.ts`, both of which arrived as uncommitted work
  on `pay-per-use` and went in untested. Worth someone owning before the
  funding path ships.

### 6. Not started

- [ ] The mobile app has its own kit (`mobile/src/components/ui.tsx`, `MoreKit`) and none of this. `SeasonProgress` in `mobile/src/components/sim/SimKit.tsx` is the same idea; the phone wants a `Working` of its own reading the same stage lists.
- [ ] Dark mode has not been checked on any converted screen. The tones use
  `dark:` variants; nobody has looked at them side by side.
