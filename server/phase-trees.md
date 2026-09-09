# Phase trees v2

The complete tree for all three paths, plus the systems they share. Supersedes
path-backbone-v2, shipping-variants, and funding-path-v1.

---

# Part 1 — How the tree works

## The three paths

| Path | Promise | Target |
| --- | --- | --- |
| **Ship an MVP** | Get a first version in front of real people and learn from what they do | 4 weeks |
| **Systemize a business** | Turn something that already works into something that runs without you in every step | 4 weeks |
| **Raise funding** | Get the story, the numbers and the plan into a shape that gets backed | 4 weeks to in-market |

A project picks exactly one at creation. Paths connect rather than compete — most projects walk
two or three of them over a year, and the tree is designed so work carries across.

## Project types

Selected at creation, drives variant content throughout.

- **Ship an MVP** — `app` · `saas` · `game` · `website` · `other`
- **Systemize a business** — `restaurant` · `service` · `retail` · `other`
- **Raise funding** — `startup_equity` · `local_community` · `loan_grant` · `other`

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

Below Verified, Nova leans on check-in narrative rather than presenting pace arithmetic with
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
| No activity or check-in, 7 days | Soft nudge. Date unchanged. |
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

**M1.2 — The core loop** · `nova-drafts` · 20m
The highest-variance milestone in the path. Everything downstream orders off it.
- `app` `saas` — the 3–5 step sequence that delivers value.
- `game` — the loop at two scales: **moment-to-moment** (seconds — what the player does over and
  over) and **session** (minutes — what makes a session feel complete). Week 2 builds
  moment-to-moment first. A game whose second-to-second action isn't fun cannot be rescued by
  content, and building it first makes that discoverable in week 2 instead of week 4.
- `website` — the visitor path: land, understand, act. Usually 3 steps.

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

**Target: four weeks to owner-independence tested.** Most of the work is documentation and
handoff that Nova can draft, which is what makes the month realistic.

**Verification is Evidence tier**, not Verified — no codebase to check. Projections show as
ranges, and Nova leans harder on the weekly check-in narrative.

## Week 1 — See it clearly

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

## Week 2 — Write it down

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

## Week 3 — Instrument and delegate

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

## Week 4 — Remove the owner

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
Deeper systemizing, or Raise funding to finance growth.

---

# Part 4 — Raise funding

**Target: four weeks to in-market.** Closing takes longer and depends on people outside the user's
control. The path promises what it can deliver — plan done, evidence gathered, route live — and
says so at week 1 rather than letting people discover it at week 4.

## Routes vs. types

The subcategory (`startup_equity` · `local_community` · `loan_grant`) is the **goal**. Routes are
the **methods**, and Nova usually stacks two or three toward the goal.

| Route | Fits | Realistic minimum |
| --- | --- | --- |
| `presale` | Anything with a deliverable | Something concrete to promise |
| `community` | Local, visible, story-driven | A story and a face |
| `merch` | Anything with a following | An audience, however small |
| `revenue` | Service, food, anything sellable now | Ability to deliver at small scale |
| `grant` | Local, sector-specific, nonprofit-adjacent | Complete plan, eligibility |
| `loan` | Has collateral, credit, or a co-signer | Plan with quoted costs |
| `equity` | Scalable, high-growth | Plan plus a demonstrable product |

Nova never presents "you don't qualify" as an endpoint. Every situation has a live route.

**Route selection inputs**, gathered conversationally at path start, never as a form: what exists
today · money available · credit position · audience · timeline · business shape.

## Evidence, cheapest first

**Nothing here is a prerequisite.** Any route is available at any time. Evidence changes how
strong the case is, and Nova's job is maximum case strength for minimum user effort.

**The default is that Nova gathers it.** The user should never be handed a research assignment
they could have paid someone to do.

**Tier 0 — Nova does it. Zero user effort.**
Comparable revenue for similar businesses nearby. Local demographics and foot traffic. Industry
cost benchmarks — food cost %, labor %, rent as a share of revenue. Equipment pricing. Competitor
pricing from public menus and sites. Break-even modeling at realistic capacity.
*Takes a plan from guessed to researched on day one, while the user watches.*

**Tier 1 — One afternoon. Calls and emails Nova drafts.**
Real rent quotes on two or three spaces. Supplier price sheet. Insurance quote. Permit costs from
the city. Nova writes the emails and call scripts; the user sends and dials.
*Highest score-per-hour in the system. Guessed becomes quoted.*

**Tier 2 — Something they'd enjoy doing anyway.**
For food: cook for twelve people, collect reactions on a one-page form Nova generates. That's a
dinner party, not a business operation, and it's the restaurant's version of a product demo.
Photos of the food. A one-page site with email signup that Nova builds.
*Be blunt about the value here: a loan officer or investor who tastes the food and sees a coherent
cost model is most of the way there. The food is the evidence.*

**Tier 3 — Real operation. Optional, never required.**
Catering, market stall, pop-up. Genuinely heavy — permits, health inspection, certification,
insurance. Nova presents it as one option, names the actual requirements up front, and never
positions it as something that has to happen first. Some people want this. Most don't need it.

**Credit building** runs as a parallel background thread when relevant. Slow, mostly waiting,
never blocking, its own quiet display.

## The business plan

Nova builds it. The user answers questions conversationally and makes decisions; Nova writes
every section, generates the financials, and keeps it current as evidence arrives.

**Sections:** concept · market and location · customers · competition · offering and pricing ·
operations · team · startup costs · financial projections · funding ask and use · risks

**Living document, not a milestone.** Every piece of evidence gathered anywhere in the product
updates it and re-scores it automatically. That coupling is what makes the score feel earned.

## Plan strength score

**Measures the strength of the plan. Not the odds of the business succeeding.** This has to be
visible in the product, not buried. A number that reads as a success prediction will send someone
toward their savings on an estimate no software can honestly make. The working frame: *how strong
is your case, and what would make it stronger.*

### Five sub-scores, always shown separately

**1. Completeness** — sections present and specific. Cheap to raise, and it should be.

**2. Internal consistency** — do the numbers agree. Machine-checkable, immediately useful. Nova
flags contradictions specifically: *seating 40 with 200 covers a day means 5 turns, high for dinner.*

**3. Evidence backing** — share of load-bearing assumptions with external support. Every number is
tagged guessed · researched · quoted · measured. The core of the score.

**4. Assumption risk** — Nova names the two or three assumptions that break the model if wrong by
30%. High risk isn't failure; unexamined risk is.

**5. Viability math** — break-even at achievable volume, runway before profitability, what happens
at 70% of projection.

### Bands

| Band | What it takes |
| --- | --- |
| 0–40 | Sections written |
| 40–65 | Complete, consistent, tier 0 research — most users reach this on day one |
| 65–85 | Tier 1 evidence — real quotes on the numbers the plan rests on. An afternoon of calls |
| 85+ | Tier 2 or 3 — demonstrated demand: a tasting, signups, or real sales |

**Writing better cannot move the score.** Only evidence does. The bands are set so a user who lets
Nova research and makes a few phone calls lands in the mid-eighties — quoted costs, real
comparables, honest break-even math. That is a plan you can walk into a bank with. Tier 3 is for
people who want it, not a ceiling everyone must clear.

### Presentation rules

- Always paired with the top three actions that would raise it most, with point gain for each
- Never a verdict. Always a state with a next move
- Movement is the story: 34 to 61 in three weeks
- Sub-scores visible by default; composite is a summary, not the headline
- **Never** as a probability of success, and never quiet when the viability math doesn't work

## Week 1 — Situation and foundation

**M1.1 — Situation read** · `nova-drafts` · 20m
Conversational. What exists, money, credit, audience, timeline, shape.

**M1.2 — Route stack** · `nova-drafts` → `user-decides` · 20m
Nova proposes two or three routes toward the user's goal with the case for each.

**M1.3 — Tier 0 research** · `nova-builds` · 1h, mostly unattended
Nova gathers comparables, benchmarks, demographics, competitor pricing. User watches it populate.

**M1.4 — Plan v1 generated** · `nova-builds` · 1h
Full draft from the situation read plus tier 0 research. First score appears here.

**M1.5 — Financial model** · `nova-builds` · 1h
Driver-based. User adjusts drivers; Nova handles the math.

**M1.6 — Read the score** · `nova-drafts` · 15m
Sub-scores, the top three actions, and what each is worth.

**M1.7 — Positioning statement** · `nova-drafts` · 10m
The one line the deck, the page and every conversation open with. Shared milestone `SH-01`:
carried across from Ship if it exists there; otherwise Nova drafts three from the situation read
and the user picks.

## Week 2 — Evidence and materials

**M2.1 — Tier 1 outreach pack** · `nova-drafts` · 30m
Emails and call scripts for rent, suppliers, insurance, permits. Ready to send.

**M2.2 — Make the calls** · `user-does` · 2–3h
The afternoon that moves the score most.

**M2.3 — Plan updated with quotes** · `nova-builds` · auto
Guessed becomes quoted. Score moves. This is the moment the system proves itself.

**M2.4 — Assumption risk pass** · `nova-drafts` · 30m
Nova names what breaks the model and drafts the mitigation for each.

**M2.5 — Materials** · `nova-builds` · 2h
Route-dependent: deck for `equity`, application pack for `loan_grant`, campaign page and story for
`local_community`.

**M2.6 — The five hard questions** · `nova-drafts` · 30m
Generated from the actual weak spots in the numbers, not a generic list. Nova drafts answers;
user sharpens.

## Week 3 — Set up the route

**M3.1 — Showcase page** · `nova-builds` · 45m
Pulls from the plan, build progress, and check-ins automatically, so it stays current without
maintenance. For build-path users the pace history is the most compelling thing on it — a public
record of someone shipping.

**M3.2 — Route setup** · `nova-builds` · 1–2h
`presale` — founding-member pricing, gift cards, prepaid packages, deposit preorders.
`community` — campaign page, tiers, story.
`merch` — existing setup.
`revenue` — what can be sold *now*, at small scale, before the full thing exists. Catering before
the restaurant, consulting before the SaaS, paid beta before launch. Usually the fastest cash and
the best evidence, and the most overlooked option.
`grant` `loan` — application pack, submission checklist, deadline calendar.
`equity` — target list of 40–60, warm intro mapping, tiered so practice targets come first.

**M3.3 — Tier 2 evidence, if wanted** · `user-does` · variable
The tasting, the signup page, the photos.

**M3.4 — Score check before going out** · `nova-drafts` · 15m
Last chance to raise it cheaply. Nova names anything still guessed that could be quoted today.

## Week 4 — In market

**M4.1 — Launch the route** · `user-does` · 2h
Send, submit, publish, open presales.

**M4.2 — Response log** · `nova-drafts` · ongoing
Nova structures notes after every meeting, call, or rejection.

**M4.3 — Objection tracking** · `nova-drafts` · ongoing
What keeps coming up.

**M4.4 — Revise from objections** · `nova-builds` · 1–2h
Materials and plan updated. Score recalculates.

**M4.5 — Pipeline view** · `nova-drafts` · 30m

> **Past week 4 the dashboard switches from date projection to pipeline mode.** Outcomes now
> depend on third parties, and projecting a date would be dishonest. Pipeline mode tracks
> conversations, stages, and follow-ups instead — and the 7-day absence clock keeps running,
> since momentum is the thing that fails here.

## Deadline mode — `loan_grant`

Grant and loan applications have fixed dates, so this type inverts the model: Nova counts
**backward from the deadline** rather than forward from pace. Same optimism, different arithmetic.
The dashboard shows days remaining and whether current pace clears the submission date, and the
scope lever becomes which optional sections to include rather than which features to cut.

---

# Part 5 — How the paths connect

## Shared milestones

Authored once, referenced by ID. This is what makes path switching cheap — work carries over
instead of being redone.

- `SH-01` Positioning statement — Ship, Raise
- `SH-02` Pricing model — Ship, Systemize, Raise
- `SH-03` Core metric definition — all three
- `SH-04` Financial baseline — Systemize, Raise
- `SH-05` Customer list — Ship, Systemize
- `SH-06` Competitor landscape — Ship, Raise

## Typical routes through the tree

- **Idea → product → money:** Ship → Raise → Systemize
- **Existing business, owner drowning:** Systemize → Raise
- **Existing business, needs capital:** Raise → Systemize
- **No money, big idea:** Raise (plan + presales) → Ship → Systemize

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