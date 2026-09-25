# What Nova costs to run, and what the plans charge for it

Written because the answer was a matter of opinion until somebody measured it,
and because the measurement changes what the plans should be.

## The number

**A credit costs about two cents to serve, on a working day's mix.**

Measured twice, and the second one is the better measurement. An early sample
put it near four cents. A full day of real work — 6 codebase audits, 10 games,
and roughly 310 chat and roadmap turns, about five million tokens for $7.76 —
puts it at **2.17 cents**: 358 credits charged against $7.76 of spend.

The two do not disagree. Cost per credit is not a constant; it is whatever
people happened to do that day. That is the argument for the ceilings, and the
argument against ever treating one number as settled.

The blended rate underneath both is about **$1.55 per million tokens**, input
and output as billed.

### What each action actually costs

| Action | Costs to serve | Charged | Verdict |
|---|---|---|---|
| Nova chat turn | $0.014 | 1 credit | **Profitable** — about 3x |
| Ten Years verdict | $0.003 | nothing | Free by choice, and cheap |
| Codebase audit | **$0.57** | 8 credits | **Underpriced** — about 1.8x |

Chat, which is almost all of the traffic, pays for itself comfortably. The
audit does not, and on the day measured it was 44% of every token spent.
That is the whole problem in one line: the cheap thing is priced fine and the
dear thing is priced like the cheap thing.

`COST_PER_CREDIT_USD` is still 0.04 in code. Left deliberately high until
`ai_spend` has a week of its own data — the ceilings derive from it, and a
brake set from an optimistic number is not a brake.

## What that does to the plans

Stripe takes 2.9% and thirty cents, so the price is not the revenue.

| Plan | Price | Credits | Cost if fully used | Net revenue | Margin |
|---|---|---|---|---|---|
| Starter | $7.99 | 200 | $8.00 | $7.46 | −7% |
| Builder | $16.99 | 750 | $30.00 | $16.20 | −85% |
| Pro | $29.99 | 5,000 (fair use) | $200.00 | $28.82 | −594% |

Every paid tier loses money if the customer uses what they were sold. This is
survivable only while most people spend a fraction of their allowance — which
is true today and is not a plan, because the customers who stay longest are
the ones who use the most.

What a price can actually include, at a 70% gross margin:

| Price | Credits it affords |
|---|---|
| $7.99 | 55 |
| $16.99 | 121 |
| $20.00 | 143 |
| $29.99 | 216 |

`creditsAtMargin(price, margin)` in `shared/plans.ts` is the sizing tool.

## What using it properly actually costs

The missing number in every pricing argument is how many credits it takes to
use this product the way it is meant to be used. `npm run price:model` answers
it from `CREDIT_COSTS` and three honest months of use:

| Builder | Credits a month | Cost to serve |
|---|---|---|
| Dipping in | 38 | $1.52 |
| Building properly | 197 | $7.88 |
| Leaning on it | 588 | $23.52 |

**197 credits** is the figure to price against. Below that, the customer the
product is for hits a wall partway through the month.

## What to charge

A real day of heavy use was measured: **$7.76 across every action on the site
in one day** — about 194 credits, by somebody working on the product all day.
That is the number the top of the ladder has to survive, and it changes what
the top of the ladder can be.

If anybody worked at that rate every month:

| Days a month | Cost to serve | Price needed at 70% margin |
|---|---|---|
| 10 | $77.60 | $258 |
| 15 | $116.40 | $388 |
| 22 | $170.72 | $569 |

**No consumer price supports all-day use uncapped.** So the top tier is not
priced to cover it; it is capped, and the cap is what makes the price honest.

### The ladder, with ceilings

Each cap is set so the worst case — the whole ceiling spent every day of the
month — still breaks even. Normal heavy use lands near 40% of the cap on
twenty days, which is where the margin column comes from.

| Tier | Price | Credits/mo | Cap/day | Worst month | Normal month | Margin |
|---|---|---|---|---|---|---|
| Starter | $19 | 150 | 15 | $18.00 | $4.80 | 74% |
| Builder | $39 | 300 | 31 | $37.20 | $9.92 | 74% |
| Business | $149 | 700 | 120 | $144.00 | $38.40 | 73% |

**Business moved from $89 to $149.** At $89 the cap that breaks even is 71
credits a day, which is a third of what a genuinely heavy user gets through —
so $89 either caps the customer it exists for, or loses money. $149 with a
120/day ceiling serves them properly and still cannot lose.

Above that is an agency conversation, not a plan: all-day use is $388–569 a
month at a 70% margin, and it should be sold that way or not at all.

### Why not $20

$20 of net revenue affords 143 credits at a 70% margin, and a builder using
the product properly needs about 197. A $20 plan therefore caps its own target
customer about three weeks into every month. Charging $39 and serving them
fully is better business than charging $20 and stopping them.

### Why not one time

| Builder | $30 lasts | Then |
|---|---|---|
| Dipping in | 19.7 months | −$1.52 a month, for ever |
| Building properly | 3.8 months | −$7.88 a month, for ever |
| All-day, like the measured day | **4 days** | −$7.76 a day, for ever |

A one-off payment against a recurring cost loses most on the customers who
stay longest. There is no version of this that works.

## Cutting the cost per call

Before repricing anything, the cheapest fix: **none of Nova's prompts were
cacheable, and most of them should have been.**

OpenAI caches a prompt by exact prefix, and only from about 1,024 tokens in.
The chat prompt opened with the project's own context about 390 characters in
— roughly 98 tokens, under the threshold — so **nothing cached at all**. Every
message re-bought the entire ~2,600-token instruction block at full price.
Worse, the board that context describes changes *inside* a conversation,
because Nova itself edits it, so every turn of the history was re-bought too.

Two things moved, and nothing else changed:

- **The chat prompt is now byte-identical on every call.** The tier
  conditionals that were scattered through the instructions became one `YOUR
  PLAN:` block, and the project context moved onto the live turn where it
  belongs. The only interpolation left in the system prompt is a module
  constant.
- **The audit's deep reads put the files before what changes.** The rules are
  a module constant, the area and its question are stable, the files come
  next, and the first-pass verdict and route coverage — the only things that
  move between runs — go last. Auditing the same repository twice used to
  re-buy every file at full price.

What that leaves cached, per chat turn:

| History depth | Tokens in the turn | Cached before | Cached now |
|---|---|---|---|
| 10 messages | 5,298 | 0 | 3,798 (72%) |
| 30 messages | 7,698 | 0 | 6,198 (81%) |
| 100 messages | 16,098 | 0 | 14,598 (91%) |

At a 90% discount on cached input and $1.25/M, that is about **$0.42 per
working builder per month** on chat alone, and a repeat audit of unchanged
code drops from about **$0.46 to $0.05**.

The chat call also had no `max_completion_tokens`. It has one now — set far
above any honest answer, so it only ever catches a reply that has run away.

`test/unit/prompt-caching.test.ts` holds the shape: the system prompt may not
interpolate anything that varies per request. It is exactly the property a
helpful `${project.title}` near the top would quietly destroy.

### The brake over everything

Per-account ceilings answer "can one person run up a bill". They do not answer
the question a launch day asks. Twenty free credits is **$0.80 of model spend
per signup**, so a thousand signups who all spend theirs is **$800 in a day**
against no revenue, and a week of that is $5,600.

So there is a ceiling over the whole platform, checked in `requireCredits`
alongside the per-account ones: `PLATFORM_DAILY_SPEND_USD`, $250 by default,
overridden by `AI_DAILY_SPEND_CAP_USD`. Free accounts stop at 60% of it and
paying ones run to 100% — when the day is hot, the people to stop first are
the ones who have paid nothing, not the customer halfway through the work
they are paying for. Free accounts are told Nova is back tomorrow; paying ones
get an apology and no charge.

It is memoised for a minute, so it costs one query a minute rather than one
per request. On several instances each keeps its own memo, so the true
overshoot is up to a minute of spend per instance — acceptable for a brake,
and worth knowing.

A value that cannot be parsed, or a negative one, falls back to the default:
only an explicit `0` takes the brake off.

### Caching works across users, not per user

Worth being explicit, because it changes what the prompt work is worth:
OpenAI's prompt cache is keyed on the prefix and scoped to the API key, not to
the end user. One static system prompt shared by every user is therefore
bought **once for everybody**, and the more people arrive at the same time the
better it works — a thousand users hitting the same 2,600-token preamble keep
it permanently warm.

That is why the ordering matters more at a thousand users than at one. Per
user it saves a few tenths of a cent a turn; across a launch day it is the
difference between buying the preamble once and buying it several thousand
times.

The corollary is the rule the tests hold: anything user-specific in the shared
prefix destroys this for everyone, not just for that user.

### Every answer now has a ceiling

Thirty-two of thirty-five completion call sites set no
`max_completion_tokens`, so an answer was as long as the model felt like.
The default is applied in the client — `withDefaultCeiling` in
`server/openai-client.ts`, 8,000 tokens, which is the largest any call asks
for on purpose, so it cannot truncate an answer somebody meant to get. An
explicit ceiling always wins.

Six files were building their own OpenAI client, duplicating the base-URL rule
and opting out of the ceiling — including the codebase audit, the dearest
feature in the product. They all use the shared one now, and
`test/unit/output-ceiling.test.ts` fails if a seventh appears.

### Ruled out

`AI_PRIORITY_MODEL` is unset, so `PRIORITY_TEXT_MODEL` falls back to
`TEXT_MODEL` and **every tier already uses the same model**. Pro is not being
served a dearer one; that theory was wrong.

The audit's 60,000-character-per-file cap is not the lever either. The median
source file here is 7,131 characters and the cap binds on 6% of them, so
lowering it would cost audit quality and save little.

## The codebase audit is the dearest thing in the product

Eight credits buys **seventeen model calls**: one first pass, eleven
capability areas, and the loop reads. Each area sends up to ten files at up to
60,000 characters each.

| | Input chars | Input tokens |
|---|---|---|
| Typical repository | ~1,350,000 | ~365,000 |
| Worst case | 6,600,000 | ~1,780,000 |

Eight credits is meant to cover $0.32 of cost. A typical audit is somewhere
between $0.22 and $1.82 depending on the input price, and the worst case is
several dollars. **It is underpriced by roughly 3–6x typically and far more at
the tail** — which is why it also has its own daily and monthly ceilings, and
why those matter more than the credit price.

Worth doing before repricing it: `ai_spend` now records the tokens, so one
real audit gives the true figure instead of this estimate.

## The Ten Years game was never metered

It had no `requireCredits`, no `deductCredits` and no entry in `CREDIT_COSTS`
at all, and it called `gpt-4o` directly rather than through `modelFor`, so it
ignored tier as well. Every verdict was a model call with no credit revenue
against it — which also means **game plays never appeared in the four-cent
figure**. That figure is what Nova costs per credit; the game was spending
outside it.

It is now: free once a day per person, a dollar for another, banked until
used. Free stays free because the game is how people meet the product, and a
paywall on the first taste is a bad trade.

The rules that make it fair, all tested in
`test/integration/game-plays.test.ts`:

- The play is taken *before* the model call, because two tabs polling the same
  finished game would otherwise both spend it — and given straight back if the
  model does not answer. Nobody pays a dollar for a placeholder.
- A free play is counted from what was recorded, so a failure leaves it
  intact without needing a refund at all.
- A game already valued costs the second reader nothing: the verdict is
  stored, and only the person who triggers the call spends anything.
- A game with nothing in it is written off without being valued, and without
  taking a play.

Every valuation is now written to `ai_spend` at zero credits, so what the
game costs to give away is finally a query rather than a guess.

One thing found and not changed: a valuation that keeps failing retries once a
minute for up to a day while somebody polls — up to 1,440 calls for one game.
Bounded, and only on persistent failure, but worth a lower ceiling.

## Watching it: /admin/ai-spend

Owner only, and 404 to everyone else — it names people, what they spent and
what they pay. Five screens, which are the five questions a launch day asks:

- **Today against the brake.** What has been spent, where the free cut-off is,
  where the full ceiling is, and whether either has bitten.
- **The free tier as a block.** How many people used Nova, how many used their
  whole allowance, what they cost, and what it would cost if every one of them
  used the lot. That last figure is the launch-day exposure in one number.
- **Where it goes, dearest first.** Sorted by cost rather than by how often
  something ran, because those are different lists and only one is a bill. The
  column to read is `tokensPerCall`: two actions priced the same that differ
  tenfold there are mispriced, whichever way.
- **Day by day**, with the cache rate.
- **Who is spending it**, with how far through their monthly allowance they
  are.

### Tokens were never actually being recorded

`recordTokens` existed and nothing called it. The ledger held credits and no
tokens at all — which made "what does a credit really cost" unanswerable from
the very table built to answer it.

The join was missing because the two halves live apart: the client knows what
an answer cost and nothing about who asked, and the route knows who asked and
never sees the usage. `beginSpend` closes it with an `AsyncLocalStorage`, set
when the credits are charged, read by the client wrapper when the answer comes
back. Nothing else had to change, and no call site had to learn about billing.

Known limit: one ledger row per charge, so a request that charges once and
then makes several calls — the codebase audit makes seventeen — records the
last one's usage. The single-call actions that are almost all of the traffic
are exact.

`cached_tokens` is recorded too, which is what makes the prompt ordering
checkable rather than believable: if the shared prefix ever stops being
shared, the cache rate on that screen falls and somebody can see it.

## What is not fixed

**The allowances.** A daily ceiling cannot make a plan profitable whose
monthly promise is already underwater. Pro's fair-use cap of 5,000 credits is
$200 of cost against $28.82 of revenue; even the daily cap of 120 comes to
$144 a month if somebody takes all of it. The allowances need to come down, or
the prices need to go up, or the cost per credit needs to fall.

`test/unit/ai-ceilings.test.ts` asserts the gap exists, so nobody discovers it
twice. When the allowances are reset, that test should start failing and be
rewritten as the opposite claim.

## The ladder at two cents

At the measured rate, everything gets cheaper for everybody. Each tier is
still sized so the builder it is aimed at is never capped, and so a month
spent entirely at the daily ceiling still cannot lose money.

| Tier | Price | Credits/mo | Cap/day | Worst month | Profit on its user | Margin |
|---|---|---|---|---|---|---|
| Starter | **$12** | 297 | 18 | $10.80 | $10.59 | 93% |
| Builder | **$25** | 644 | 39 | $23.40 | $20.04 | 84% |
| Business | **$59** | 1,551 | 94 | $56.40 | $45.23 | 79% |

Against the four-cent ladder: Starter −37%, Builder −36%, Business −60%. The
top tier falls hardest because it was the one carrying all the risk.

A month of use costs $0.76 dipping in, $3.94 building properly, $11.76
leaning on it hard. Those are the numbers the prices have to clear, and at
$25 the Builder tier clears its own user eight times over.

## Nova should remember the codebase, not re-read it

The single biggest remaining saving, and it is an architecture change rather
than a price.

A codebase audit re-reads the whole repository every time. On the day
measured, six of them were 2.19M tokens and $3.40 — 44% of the day. Almost
none of that repository had changed between runs.

If a re-audit read only what changed since the last one:

| Files changed | Cost per re-audit | Six of them |
|---|---|---|
| 5–10% | $0.085 | $0.51 |
| 20% | $0.113 | $0.68 |
| 100% (first run) | $0.566 | $3.40 |

A normal day changes 5–20% of files, so **six re-audits go from $3.40 to about
$0.68.** There is a floor — the area questions, route coverage and test
inventory are carried every time — so call it 15% of a full read at best.

The prompt caching already in place helps the same problem from the other
side: on a re-read, the files that did not change are served from the
provider's cache. The two do not stack much, because they are both removing
the same tokens, but either one alone is worth about a fifth of an audit.

What it needs: the audit's findings stored per repository with a content hash
per file, and the deep reads sent only the files whose hash moved plus
whatever the last verdict said was unresolved. `code_audit_runs` already
exists to hang it from.

## Still to do on the cost side

The prompt ordering is done and the ceilings are in. What is left, in the
order it is likely to be worth something:

- **Confirm the four cents.** It was measured before any of this. `ai_spend`
  now records real tokens and the share served from cache, so a day of
  ordinary traffic replaces the estimate — and every price below depends on
  it. Nothing else here should be decided first.
- **The audit makes seventeen model calls.** A first pass, eleven capability
  areas, and the loop reads. Several areas send overlapping files, and the
  first pass reads what the deep reads then read again. That is duplicated
  spend rather than merely uncached spend, and caching does not remove it.
- **Context length.** `MEMORY_MESSAGE_LIMIT.full` is 100 prior messages on
  every chat turn for the top tier. Caching makes that far cheaper than it
  was — the history is now inside the stable prefix — but a hundred messages
  is still a hundred messages the first time through.

### Ruled out, so nobody re-checks it

`AI_PRIORITY_MODEL` is unset, so `PRIORITY_TEXT_MODEL` falls back to
`TEXT_MODEL`: **every tier already uses the same model**. Pro is not being
served a dearer one. This document previously said otherwise, which was wrong.

