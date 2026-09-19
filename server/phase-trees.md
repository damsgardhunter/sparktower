# Phase trees v2

The complete tree for all three paths, plus the systems they share. Supersedes
path-backbone-v2, shipping-variants, and funding-path-v1.

---

# Part 1 — How the tree works

## The three paths

| Path | Promise | Target |
| --- | --- | --- |
| **Ship an MVP** | Get a first version in front of real people and learn from what they do | 4 weeks |
| **Systemize a business** | Get the money right first — how fundable you are, the route to the money, and the plan — then build a business that runs without you in every step | 3 weeks to your numbers, then your capital profile and funding route, a roadmap, and 4 weeks to owner-independence tested |
| **Run a company** | Run the business you already have with a weekly rhythm: the numbers that matter, the team's recurring work, and the next thing to fix | 3 weeks to set up, then a weekly check-in and a monthly report for as long as you run it |

There used to be a **Raise funding** path. Systemize already covered most of it, so everything it
did that Systemize didn't — the scored capital profile and what raises it, the capital map, the
route choice and the five route roadmaps, the investor tools — moved into Systemize, keeping its
`FUND.` milestone ids so finished work carried across. Its slot went to **Run a company**.
Migration `0033_fold_raise_into_systemize.sql` moved existing Raise projects onto Systemize.

A project picks exactly one at creation. Paths connect rather than compete — most projects walk
two or three of them over a year, and the tree is designed so work carries across.

## Project types

Selected at creation, drives variant content throughout.

- **Ship an MVP** — `app` · `saas` · `game` · `website` · `other`
- **Systemize a business** — `restaurant` · `service` · `retail` · `other`
- **Run a company** — `restaurant` · `service` · `retail` · `agency` · `software` · `other`

`other` triggers two setup questions from Nova: what does "done" look like for this project,
and what evidence proves a milestone is complete. Those answers select the verification tier.

## Actors

Every task declares who acts. This is the most important rule in the system.

| Actor | Meaning |
| --- | --- |
| `nova-builds` | Nova produces working output. User runs or reviews it. |
| `nova-drafts` | Nova writes or generates. User edits or approves. |
| `user-decides` | Nova presents options with reasoning. User chooses. |
| `user-does` | Only a human can do this — direction, judgment, testing, talking to people. |

**No blank text fields anywhere.** Where input is needed, Nova generates two or three options
and the user picks or edits. `user-does` appearing on something that isn't genuinely human-only
is a design error.

## Verification tiers

Completion evidence varies by type, and projection confidence has to vary with it.

| Tier | Evidence | Applies to |
| --- | --- | --- |
| **Verified** | Commit, build, deploy | `app` `saas` `game` `website` |
| **Artifact** | Published URL, timestamped file, generated document | Plans, decks, SOPs |
| **Evidence** | Dated upload, photo, signed doc, quote | `restaurant` `retail` `service` |
| **Claimed** | User marks done | Outreach, conversations, decisions |

Below Verified, Nova leans on the builder's update posts rather than presenting pace arithmetic with
more precision than it has. Hard date for Verified, range for Evidence, no projection for Claimed.

## Pace model

**Optimistic by default.** Project from the user's best recent pace, not their average. Show the
date early, even on a thin sample. Believing the user is the point.

**The date never moves backward on evidence of effort.** A task that overruns while the user is
active does not push the date out. Nova absorbs it against remaining work, notes the overrun,
and offers help. It does not punish slow work with a worse projection.

**If the user beats their own target, keep their target.** Someone tracking to Mar 2 against a
three-week goal sees Mar 2. Someone tracking past their goal sees the projection plus the lever:
here's what moves it back.

**Decay only on absence.**

| Condition | Effect |
| --- | --- |
| Active, any pace | Date holds or improves. Never regresses. |
| No activity or update post, 7 days | Soft nudge. Date unchanged. |
| 8–14 days | Pace decays gently toward pre-absence baseline. |
| 15+ days | Dormant. Re-entry recalculates fresh, no carried penalty. |

Re-entry is never punitive. Pace history stays visible as a record of what they did before —
evidence they can do it again.

**Recalculation log.** Every "estimated 3h, took 40m" is an event the user can scroll back
through. The history of getting faster is a stronger hook than the current number.

## Teams

- Every task has an owner. Unowned tasks count against the project, not a person.
- Project pace is throughput across owned tasks, not an average of individual multipliers.
- The 7-day absence clock runs per member for their tasks, and at project level for the project.
  A team with one member out and the rest shipping is active.
- After 7 days of member absence, their tasks move to the unowned pool rather than stalling the
  projection. Surfaced as a reassignment prompt, not a flag on the person.
- **Individual pace is private to that member. Project pace is shared.** A visible per-person
  speed number in a small team becomes a ranking.

## Adaptation layers

1. **Backbone** — phases and milestones. Authored, never generated. Same for everyone on a path.
2. **Variants** — same milestone, different task content by project type. Authored, selected by tag.
3. **Injected** — project-specific tasks Nova adds, grounded in the user's actual artifacts.
   Capped at 2–3 per phase. If Nova can't name the artifact that motivated a task, it doesn't add it.

## Dashboard

One shape across every path and phase. Content refills; structure doesn't move.

- **Pace strip** — current multiplier, verified completions, projected finish date
- **Nova panel** — what it just noticed, what it recalculated, one or two actions
- **Next action card** — one task, with what Nova already did and what's left for the user
- **Path map** — one click away, not on the default screen

The full milestone list is reachable, never the landing state. Progress within the phase stays
visible (step 4 of 7) so the user has a sense of distance without a wall of tasks.

---

# Part 2 — Ship an MVP

**Target: four weeks.** The flagship path and the one the month promise rests on.
Variant notes are inline. Anything unmarked is universal.

## Week 1 — Concept locked, project scaffolded, loop begun

**M1.1 — Product statement** · `nova-drafts` · 10m
Nova reads the setup description and generates three statements with different emphases — not
rewordings. User picks or edits.
- `game` — three pitches instead: what the player does, what makes it feel good, why they return.
  Genre named explicitly; it drives every later default.
- `website` — who it's for, what they should do on it, what happens when they do.

*Feeds the landing page, store copy, and every pitch later.*

**M1.2 — The core loops** · `nova-drafts` · 45m
The highest-variance milestone in the path. Everything downstream orders off it.

A product with one loop is a product, not a business. Every project writes **five loops**, each a
3–5 step sequence whose last step restarts its first (a sequence that ends is a funnel):

- **Product** — what one kind of user does over and over and gets value from each time. The only
  kind that repeats: a product with several modes (SparkTower's three paths) has a product loop per
  mode, up to four.
- **Growth** — how strangers find it without the builder finding each one.
- **Retention** — why someone who used it once comes back next week.
- **Revenue** — how use turns into money, and money into more use.
- **Referral** — how a user deliberately brings in another, who can then bring in the next.

New projects start with the five as empty slots. The milestone is done when all five kinds exist and
every loop is written. The last loop of a kind can't be removed — only rewritten. Eight loops is the
cap: the four business loops and up to four product loops. Only product loops stretch the plan (a
week each past the first); the other four are what weeks 3 and 4 already budget for.

Variants:
- `app` `saas` — as above.
- `game` — product at two scales: **moment-to-moment** (seconds — what the player does over and
  over) and **session** (minutes — what makes a session feel complete). Week 2 builds
  moment-to-moment first. A game whose second-to-second action isn't fun cannot be rescued by
  content, and building it first makes that discoverable in week 2 instead of week 4.
- `website` — product is the visitor path: land, understand, act. Usually 3 steps.

**Competitive audit.** Once all five are written, Nova audits them against the products the
builder's customers already use: names the competitors, says how each runs the equivalent loop, and
scores every loop 0–100 for how likely it is to keep turning (strong 70+, competitive 45–69, weak
under 45), with the step most likely to break and the one change that would raise the score.
From the model's knowledge, not a live scan — the page says so. Stale once a loop is added or
replaced.

**Closure check.** Every codebase audit reads the written loops and reports each as `closed`,
`open` or `not-built`, stage by stage with cited files, plus the return path — the notification,
feed, link, invite or renewal that brings someone back to step one. "Closed" without a real file for
every stage and for the return path is downgraded to open. When all five kinds close, the audit
verifies M2.x — Loop closes.

**M1.3 — Scope cut** · `nova-drafts` → `user-decides` · 25m
Nova generates the full feature list the vision implies, then splits it into **in the month**
and **deferred**. Deferred goes to a visible roadmap, not a graveyard. User drags items across
the line while **the projected date recalculates live.** Scope becomes something they feel rather
than something Nova argues about.

*Done when the in-scope list projects inside the user's target date.*

**M1.4 — Stack decision** · `nova-drafts` · 5m
- `app` — native vs cross-platform. Nova names the store review timeline here, since it lands in
  week 4 and surprises people.
- `game` — engine, weighted to what the user knows and the genre from M1.1. 2D vs 3D is the bigger
  decision and gets its own choice.
- `website` — platform and hosting. Bias hard toward the fastest path to live.

*Locked for the month. Revisiting costs days.*

**M1.5 — Scaffold** · `nova-builds` · 30m
- `app` `saas` `website` — repo, framework, routing, styling baseline, deploy config. Runs locally.
- `game` — engine project with one controllable thing on screen. That's the equivalent of "it boots."

*Auto-verified on first commit.*

**M1.6 — Data model** · `nova-drafts` · 20m
Nova derives the schema from the core loop. User reviews entity names, since those leak into the
UI forever.
- `game` — game state and save structure. What persists between sessions.
- `website` — content model, if there's content. Skip if static.

**M1.7 — Loop step one** · `nova-builds` · 1–2h
First step of the core loop, running against real data.

**M1.8 — Deploy** · `nova-builds` · 30m
Deploy in week 1, not at the end. Removes deploy risk from the critical path and makes the project
feel real immediately.
- `app` — TestFlight or internal track, installed on the user's own device.
- `game` — playable build running outside the editor. Web build is usually fastest.
- `saas` `website` — live URL.

> **Week 1 checkpoint.** Running, deployed, scope locked. First pace read — earliest point the
> sample supports a projection.

## Week 2 — Core loop complete

**M2.1–n — Loop steps** · `nova-builds` · 1–3h each
One milestone per step from M1.2. Nova builds against the schema; user runs it. Broken into
1–3h units deliberately: this is the densest pace signal in the path and also the week people quit.
- `game` — one milestone per verb in the moment-to-moment loop (move, act, respond, feedback),
  then a **feel checkpoint** · `user-does`. Nova can build the mechanic; it cannot judge the feel.
  If it doesn't feel good, the milestone is iterating on feel, not moving on.

**M2.x — Loop closes** · `user-does` · 30m
User completes the full loop themselves, start to finish, without touching the database. First
moment the thing is real.

**M2.y — Persistence and auth** · `nova-builds` · 1–2h
- `game` — save/load and progression state.
- `website` — skip unless the visitor path needs accounts.

> **Week 2 checkpoint.** The product does its main thing. Build extension branch first offered
> here — see below.

## Branch — Keep building (optional)

Offered at the week 2 checkpoint and again at the end of week 3. A scoped extension with its own
milestones and its own date, not a delay button.

Some people want more product before anyone sees it. Forcing week 4 produces either a half-hearted
send or a churn. The branch keeps them inside the system with the pace model running.

**B.1 — Choose what to build** · `nova-drafts` → `user-decides` · 20m
Nova reads the deferred roadmap and the core loop, and sorts deferred items into two groups:

- **Supports the core loop** — secondary loops that make the main loop work better or happen more
  often. Sharing, saved state, notifications, search, settings the loop depends on.
- **Adjacent to the core loop** — real features that start their own sequence with their own entry
  point. Separate value, separate loop.

The test is mechanical, not a judgment call: *does this modify or enable a step already in the
confirmed loop, or does it begin its own?* Checkable, consistent between users, and Nova can
state the reason in a way that holds up.

Nova recommends from the first group. Everything stays pickable — it's their product — but the
grouping does the work quietly. Someone whose product genuinely needs more picks supporting loops.
Someone avoiding users finds themselves picking adjacent features, and seeing that labeled is
usually enough without Nova saying anything.

**Disputes are signal.** If many users move the same item from adjacent to supporting, the loop
definition in M1.2 was too narrow.

**B.2 — Set extension length** · `user-decides` · 5m
One, two, or three weeks. New projected ship date updates live as the selection changes. If the
extension passes the user's stated target, they see that as a date, not a warning.

**B.3–n — Build the selected loops** · `nova-builds` · 1–3h each
Same structure as week 2, own estimates, pace keeps reading cleanly.

**B.final — Re-offer week 4** · `user-decides` · 5m
Go to users, or extend again. No cap, no lecture. Each extension is its own dated decision, so
continuing is chosen repeatedly rather than drifted into.

**Pace behavior during an extension:** extending is activity. No decay, no penalty, 7-day clock
unaffected. Date recalculates to new scope and continues to hold or improve. Phase label reads
"build extension, week 2 of 3."

*Instrument the second and third extension. If users who extend twice tend to go dormant, week 4
is too heavy — that's the fix, not removing the branch.*

## Week 3 — Usable by someone else

**M3.1 — Empty, loading, error states** · `nova-drafts` · 1h
Nova writes them all, flags any it wasn't sure about.
- `game` — failure and edge states: death, quit mid-action, bad input, empty save.
- `website` — 404, form failure, empty search.

**M3.2 — Visual pass** · `nova-builds` · 1–2h
Nova applies a coherent pass; user picks direction from two or three options rather than
describing what they want.
- `game` — **game feel** pass, distinct from visual polish and more important: hit feedback,
  timing, transitions, audio cues. Nova implements, user judges.

**M3.3 — Onboarding** · `nova-builds` · 1h
- `app` `saas` — first thirty seconds to the loop.
- `game` — first ninety seconds, taught through play rather than text.
- `website` — what a visitor from a cold link sees and does.

**M3.4 — Landing page** · `nova-drafts` · 45m
Headline from M1.1, three lines, one action.

**M3.5 — Analytics on the loop** · `nova-builds` · 30m
Loop starts and completions visible. Powers week 4.

**M3.6 — Feedback channel** · `nova-builds` · 15m
One click to reach the builder.

**M3.7 — Pricing** · `nova-drafts` · 20m
Nova proposes three models with reasoning. Free is a valid pick, offered as one rather than
treated as avoidance.
- `app` — store constraints stated.
- `game` — premium, free-to-play, or demo-plus-paid. **Timing conflict:** free-to-play changes
  what gets built, so for that model this decision belongs in week 1. Nova should raise
  monetization at M1.1 for `game` and only defer it if the user leans premium.

## Week 4 — Real users, real signal
*Or the first week after an extension ends.*

**M4.1 — The first ten** · `nova-drafts` → `user-does` · 30m
Nova drafts the list structure and outreach message. User supplies ten actual names — `user-does`
because only they know who these people are.
- `game` — ten playtesters, sourced from the genre's communities. Nova should say plainly that
  people who don't like the genre give misleading feedback.

**M4.2 — Send** · `user-does` · 45m

**M4.3 — Watch three people use it** · `user-does` · 1–2h
No coaching. Note every hesitation. Nova provides the observation template and afterward turns
notes into a ranked friction list.
- `game` — watch silently and note where they **stop having fun**, not where they get confused.
  Different failures, different fixes; conflating them is the most common playtesting mistake.

**M4.4 — Fix the top three frictions** · `nova-builds` · 2–4h

**M4.5 — Read the signal** · `nova-drafts` · 20m
Nova pulls analytics and reports what it means rather than asking the user to interpret.
- `game` — session length, session-loop completion, and whether anyone played twice. **Playing
  twice is the signal**; everything else is secondary at this stage.

**M4.6 — Decide what's next** · `user-decides` · 15m
Continue, adjust the loop, or move to another path. Nova makes the case for each based on what
the numbers said. Deferred roadmap becomes next month's scope if continuing.

---

# Part 3 — Systemize a business

**Money first.** Starting or buying a business is mostly a money problem before it's an
operations one, so the path opens with four weeks that end in a financing plan someone could act
on, then the four operating weeks. **Target: four weeks to a financing plan, eight to
owner-independence tested.**

**Verification is Evidence tier**, not Verified — no codebase to check. Projections show as
ranges, and Nova leans harder on the weekly update posts.

### Two mechanics the money weeks add

- **Answered by tapping** (`intake` on a milestone). Money questions are asked as ranges to tap,
  never a box to fill: "$0 — starting from nothing" is the first choice, and "I don't know" is a
  real answer that the next step works out. Saving marks the step done, costs nothing, and the
  answers become the step's written answer, which Nova reads on every later step. Answers can be
  changed. `POST /api/projects/:id/path/intake`.
- **Plans** (`work: "plan"`). Nova builds a document, not code: headline figures, the tables
  behind them (sources and uses, month-by-month cash, a checklist), the reasoning with the
  arithmetic, what it assumed, what's weak, dated actions, and who to check it with. Accepting it
  writes a compact version as the answer; **Add these to my tasks** puts its actions on the board
  once (`POST /api/projects/:id/path/work/:workId/tasks`). Nova never promises approval, funding or
  success — the plan's strength is that every gap it finds has a dated step against it.

Projects that were on this path before the money weeks existed get them the next time the path
is read (`syncPathTree`), without touching anything they'd done.

## Money week 1 — Know your numbers

**F1.1 — Where you stand** · `user-decides` · tap · 5m
Cash you could put in today (from $0), free money each month, credit range (including "never
checked"), starting / buying / running, industry experience, and anything that could back a loan.

**F1.2 — How much you need** · `user-decides` · tap · 5m
How much you're looking to raise ("I don't know — work it out for me" first) and when.

**F1.3 — Startup costs and the raise** · `nova-builds` · plan · 45m
Sources and uses with realistic ranges plus working capital, and the raise that covers it. Works
the number out if they didn't know it; checks it if they did.
- `restaurant` — build-out, kitchen equipment, POS, licences (liquor), deposits, opening
  inventory, pre-opening payroll, 3–6 months of working capital.

**F1.4 — Unit economics** · `nova-builds` · plan · 45m
What one sale earns, what the month costs, break-even volume, arithmetic shown.
- `restaurant` — average check, covers by daypart, food and labour %, prime cost, occupancy,
  break-even covers.
- `service` — rate, utilisation, delivery cost, margin per client. `retail` — AOV, margin, turns.

**F1.5 — Cash flow before profit** · `nova-builds` · plan · 45m
Month by month to profit: ramp, losing months, lowest cash point, and how each is covered.

**F1.6 — Lock the base case** · `user-decides` · 10m
Cautious, likely, stretch — each with raise, break-even month and lowest cash. Every later step
uses the one picked.

## Money week 2 — Where the money comes from

**F2.1 — Your equity** · plan · 30m — the injection lenders expect, what counts, the gap and how
to close it.
**F2.2 — SBA loan readiness** · plan · 45m — 7(a) / 504 / Microloan fit, and a met / not yet /
unknown checklist against their answers.
**F2.3 — Seller financing** · plan · 30m — seller notes when buying; landlord, equipment-vendor,
franchisor and supplier financing when starting new.
**F2.4 — Investor structure** · plan · 45m — friends and family, silent partners, profit share
with a preferred return, revenue-based financing; ownership and control; securities flagged.

## Money week 3 — Become financeable

**F3.1 — Gap scan** · plan · 30m — every weakness a lender would see, ranked by what it blocks.
**F3.2 — Financeability plan** · plan · 45m — dated actions that close each gap, built for $0
and low credit: credit repair, a savings target, industry experience, a lender relationship,
proving demand smaller first (`restaurant` — pop-ups, a food truck, catering, a shared kitchen).
**F3.3 — Deal structure** · plan · 45m — buying: price from earnings, sources and uses, loan +
seller note + equity, payments and coverage. Starting: which source pays for what.

## Money week 4 — Your roadmap

**F4.1 — Pick your roadmap** · tap · 2m — 90 days (weekly), 1 year (monthly), 3 years (quarterly).
**F4.2 — Your money roadmap** · plan · 45m — at that length: what gets done, the money milestone it
reaches, and how you'll know.
**F4.3 — Take the first step** · `user-does` · 30m — the first action on it, done this week.

## Week 5 — See it clearly

**M1.1 — Time capture** · `user-does` · 10m/day
Nova prompts once daily and categorizes the response. Deliberately tiny — a full time audit is
the kind of homework that ends a path in week one.

**M1.2 — Only-me list** · `nova-drafts` · 20m
Generated from the time log: every task that currently requires the owner. User corrects.
- `restaurant` — expect open/close, ordering, scheduling, recipe consistency, vendor calls.
- `service` — expect scoping, client comms, delivery, invoicing.
- `retail` — expect buying, merchandising, inventory, staffing.

**M1.3 — Financial baseline** · `nova-drafts` · 30m
User connects an account or uploads statements; Nova reads and summarizes. No manual entry.

**M1.4 — Bottleneck ranking** · `nova-drafts` · 15m
Which only-me task costs the most, with the arithmetic shown — hours times the owner's effective
rate, plus what it blocks.

**M1.5 — Pick the first three** · `user-decides` · 10m

## Week 6 — Write it down

Nova writes; the owner corrects. This is the week that would otherwise never happen, because
nobody writes their own SOPs.

**M2.1 — Delivery SOP** · `nova-drafts` · 1h
Nova interviews the owner conversationally — voice or chat — then writes the document.
- `restaurant` — prep, service, close. Recipes as specs with quantities and timings.
- `service` — intake through delivery through handoff.
- `retail` — open, floor, restock, close, cash handling.

**M2.2 — Intake and sales SOP** · `nova-drafts` · 1h

**M2.3 — Onboarding SOP** · `nova-drafts` · 45m
What happens after someone buys, or after a new staff member starts.

**M2.4 — SOP test** · `user-does` · 1h
Someone else follows one unaided. Every question they have to ask is a gap.

**M2.5 — Close the gaps** · `nova-drafts` · 30m

## Week 7 — Instrument and delegate

**M3.1 — Operating metrics** · `nova-drafts` · 20m
Nova proposes the three to five numbers that matter for this business shape.
- `restaurant` — covers, average check, food cost %, labor %.
- `service` — utilization, realized rate, pipeline, repeat rate.
- `retail` — units per transaction, margin, sell-through, shrink.

**M3.2 — Where each number comes from** · `nova-drafts` · 20m
Source mapping. Nova pulls what it can automatically.

**M3.3 — Dashboard** · `nova-builds` · 1h

**M3.4 — Review cadence** · `user-does` · 5m
A recurring slot that exists in a calendar.

**M3.5 — Role definition** · `nova-drafts` · 30m
Built from the only-me list. What this person owns, what they decide, what escalates.

**M3.6 — Hire, contract, or automate** · `nova-drafts` → `user-decides` · 20m
Nova costs all three against the bottleneck ranking.

**M3.7 — Job post or automation spec** · `nova-drafts` · 30m

**M3.8 — First handoff** · `user-does` · variable
One process, one person, SOP attached.

## Week 8 — Remove the owner

**M4.1 — Automate the top two repetitive tasks** · `nova-builds` · 2–3h
- `restaurant` — ordering triggers, scheduling, prep lists.
- `service` — proposals, invoicing, follow-up sequences.
- `retail` — reorder points, stock alerts.

**M4.2 — Runbook for when automation breaks** · `nova-drafts` · 30m

**M4.3 — Pricing review** · `nova-drafts` · 30m
Systemizing usually surfaces that pricing hasn't moved in years.

**M4.4 — Absence test** · `user-does` · 3 days minimum
Shortened from two weeks to fit the month. The full two-week test is flagged as a follow-on, and
Nova should say the three-day version is a first proof, not the finish line.

**M4.5 — Gap list and fixes** · `nova-drafts` · 1h

**M4.6 — What's next** · `user-decides` · 10m
Deeper systemizing, the funding routes to finance growth, or Run a company to keep it on track.

---

# Funding routes — inside Systemize (formerly Part 4, Raise funding)

These phases now sit in Systemize, after its money weeks and before the roadmap week.

**Two stretches everyone walks, then a route they choose.** Week 1 is who the person is to a funder —
the capital profile and its fundability score. Week 2 is every way the money could come — the
capital map — and the choice of route: **debt, seller financing, investors, a hybrid stack, or
self-funding**. Only the chosen route's four phases appear, each a real roadmap from where the
person stands today to money in the bank. Code: `shared/phase-trees/fund.ts`, `shared/capital.ts`.

Old projects on the previous 4-week funding tree have those steps archived (`archived:retired`)
the next time the path loads: the work stays on the board, the path stops counting it.

## Week 1 — Your capital profile

All tapped, free, and read by every later step. Questions only ask what applies: business-history
details appear only if they've owned one.

- **C1.1 — Why you want to own a business** — why (income, wealth, freedom, legacy, grow and sell,
  community, passion), how (start, buy, franchise, grow), involvement, how long.
- **C1.2 — Your money today** — cash (from $0), credit (including "not sure"), household income,
  monthly debt payments, other assets.
- **C1.3 — Your experience** — years in the industry, most senior role, people managed, P&L.
- **C1.4 — Your business history** — owned before? If so: what it did (one short line — the only
  text field), industry, how long, best-year revenue, profit, people, customers, what it owned, where
  it is now. **Fill from my résumé** suggests answers from owner, founder, proprietor, self-employed
  or franchisee roles on their profile (`businessHistoryFromResume`) — never revenue or profit, which
  résumés don't carry, and nothing saved until they confirm.
- **C1.5 — Your capital goal** — amount ("work it out" first), what it buys, when, equity they'd
  give up, debt they'd take, ownership they want to keep.
- **C1.6 — Your capital profile** · plan — Nova's read, built on the score.

### The fundability score

Deterministic (`capitalProfile`), the same for the same answers, shown on the dashboard as soon as
anything is answered. Seven parts, 100 points: **cash for the raise** 20 (share of the raise from
their own cash), **credit** 20, **income against debt** 15 (penalised past 36% and 50%
debt-to-income), **assets** 10, **industry experience** 15, **business track record** 15, **a clear
goal** 5. Unanswered counts as nothing. Bands: under 40 not fundable yet, 40 early, 60 fundable with
work, 75 strong, 90 very strong. Every part below its max says what raises it.

**Route fit**, 0–100 per route, weighted from the same parts and capped by the lines people draw:
debt is capped at 15 for "no debt"; seller financing at 25 unless they're buying (and 20 with no
debt); investors at 15 for no equity or 100% ownership; self-funding at 25 for raises of $1M+ with
under half in cash. Hybrid is the average of the two strongest — never better than the best alone.
It measures how a funder would likely see them today — never the odds of approval, and Nova is told
to use these exact numbers.

## Week 2 — Your capital map

- **C2.1 — Your capital map** · plan — every route against the profile: how much it could cover, what
  it costs (interest, equity, control, time), what it asks, the fit, what would change it.
- **C2.2 — Choose your route** · tap — the bubbles show each route's fit. Saving sets
  `projects.capital_route`; the route's phases appear. Switching archives the old route's tasks
  (`archived:route-<id>`) and restores them as they were on return.

## The routes — four phases each

| Route | Phases |
| --- | --- |
| **Debt** | Get lender-ready (credit plan, personal financial statement, equity injection, collateral and guarantees, documents) · Pick the right loan (options, sizing and coverage, choose) · Build the package (plan, projections, sources and uses, request summary) · Apply and close (lender list, outreach, **apply**, compare offers, close) |
| **Seller** | Find the right business (criteria, sourcing, owner letter, screen ten) · Value it and check it (valuation, diligence list, red flags) · Structure the deal (note terms, structures, LOI, **make the offer**) · Close and take over (financing gap, transition, closing checklist, first 90 days) |
| **Investors** | Be investable (ownership math, structure, raising legally, data room) · Materials (deck, one-pager, model, use of funds) · Pipeline (investor list, warm intros, outreach, **open investment applications**) · Meetings to money (hard questions, **take the meetings**, terms, close) |
| **Hybrid** | Design the stack (stack, choose, sequence) · Equity layer (partner terms, operating agreement outline, open applications, **secure commitments**) · Debt and seller layers (loan package, seller note, coverage across the stack) · Close together (timeline, conditions, reporting) |
| **Self-funded** | Your runway (personal runway, keep an income, smallest version that earns) · Earn before you spend (presales, first offer, lean costs, **sell the first ten**) · Reinvest and grow (rules, milestones, retirement money carefully) · Build fundability as you go (business credit, books, re-check your score) |

Milestones in **bold** are `inMarket`: once one is done the dashboard switches to pipeline mode,
because outcomes depend on other people from there.

## Investment applications

The first half of investors reaching founders (`shared/investment.ts`, `server/investment-routes.ts`).
The founder writes the ask (headline, raising, smallest check, instruments, use of funds) and opens
applications under **Investors** in the project manager; a private project can't. The public page
shows **Invest in this project**; a signed-in investor applies with amount, instrument, investor
type, accredited status, a message, optional phone and LinkedIn, and consent to share their contact.
One open application per investor per project. The founder's inbox shows each with the investor's
contact and marks it reviewing, want to talk, or declined, with a private note; the investor sees the
status and can withdraw, which hides their contact again. Every screen says it plainly: an
application to talk, not an investment — no money moves through SparkTower and nothing is an offer
or sale of securities.

# Part 5 — How the paths connect

## Shared milestones

Authored once, referenced by ID. This is what makes path switching cheap — work carries over
instead of being redone.

- `SH-01` Positioning statement — Ship, Systemize
- `SH-02` Pricing model — Ship, Systemize, Run
- `SH-03` Core metric definition — all three
- `SH-04` Financial baseline — Systemize, Run
- `SH-05` Customer list — Ship, Systemize
- `SH-06` Competitor landscape — Ship, Systemize

## Typical routes through the tree

- **Idea → product → money:** Ship → Systemize (funding routes) → Run
- **Existing business, owner drowning:** Run → Systemize
- **Existing business, needs capital:** Systemize (capital profile and a route) → Run
- **Existing business, running well:** Run, for as long as it runs

Nova proposes the next path at each path's final milestone, with the case based on what actually
happened rather than a default.

## Path switching

Visible, not hidden. Carries artifacts across via shared milestone IDs. Switch rate per path is a
diagnostic: if one path bleeds users, the path content is wrong, not the users.

## Open items

- Presales infrastructure — does it exist? It's load-bearing for the no-credit cases.
- Composite score: shown at all, or sub-scores only? "My business scored 78" travels further
  than you want it to.
- Score weighting by route — a loan weights viability and evidence; a community raise weights
  story and audience.
- `other` setup questions, all three paths. Two questions each, determining verification tier and
  loop framing.
- Team task ownership on Ship — solo is drafted; multi-builder needs a claim/assign flow.
- Credit-building thread needs its own small task set and a display that suits slow waiting.
- `game` monetization timing — raise at M1.1 or split the milestone by model.

---

# Part 3b — Run a company

**For a business that already exists.** Three weeks set it up to be run from here — the five
numbers it watches and a first check-in; the team's recurring jobs, each with an owner and a
cover; and the one thing costing it most — then hand over to the rhythm that doesn't end: a
weekly check-in Nova answers, the recurring jobs on the board, and a monthly "what improved"
report. Code: `shared/phase-trees/run.ts`, `shared/company-rhythm.ts`.
