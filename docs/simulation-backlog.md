# The simulation: what is built, and what is owed

Kept because this work has run across many sessions and several people, and
"we said we'd do that" is not a plan. Anything deferred deliberately is here
with the reason. Anything here that stops being true should be deleted rather
than ticked.

## Owed, and why it was deferred

### From a founder playing their own season, Sept 2026

Reported in one sitting while playing a quarterly solo season. Ordered as we
agreed to take them; struck through here when done rather than deleted, so the
list stays readable against what was reported.

1. ~~Growth is too fast — 6.6% of the market taken in the first quarter, and
   capacity full in period one.~~ **Done.** The unheld half of the market
   belonged to nobody; it is seated as "Everybody else" now, leaving a tenth
   genuinely free as the catalogue markets do. Free customers in that founder's
   market: 18,975 → 3,455.
2. ~~The capacity projection is not shown.~~ **Done.** The forecast bar carries
   a second marker for the room the lever actually sets, and says so.
3. ~~A market lot should say what it would do to *this* company.~~ **Done.**
   The market sends where the company stands on each axis, and a lot reads
   "quality 54 → 60" where that is known.
4. ~~Nothing ever bids against the player.~~ **Done.** Each incumbent takes a
   tenth of a chance on each lot, a little over the reserve. Measured over 56
   periods: 36% of lots contested. In-memory rather than written to `sim_bids`,
   whose `venture_id` is a foreign key to a room an incumbent does not have.
5. ~~The price has to be entered again every period.~~ **Already fixed**, by
   the read-back change — `defaultDraft` always carried it, but a solo
   founder's draft was being rebuilt from the chief executive's row alone.
   Covered by a test now, across a real period boundary.
6. ~~The unit cost Nova writes is dearer than the founder's real product.~~
   **Done.** It was unbounded against the prices in the same answer: 18, with
   segments paying 12 and 7, so two of four could never be sold to. Capped at
   70% of the cheapest segment's price, and the prompt now says what the number
   means. Existing seasons repair on read (18 → 5, 14 → 4).
7. ~~The forecast does not move when a decision changes.~~ **Done.** The
   projection endpoint cleaned the draft as `seat.role`, so a solo founder's
   price and capacity were parsed as the chief executive's and dropped. It
   splits per desk now, as filing does, and this period's demand comes back
   with the draft applied so the forecast card moves as somebody types.


### A sealed bid is invisible to the commitment meter
The desk's meter shows what the seats plan to spend against what the company
has. A sealed bid sits outside it, so a table can file a year that looks
affordable and then lose a third of its cash at the auction — which is exactly
what happened in the first season anybody played.

Needs a decision before it needs code: should a live bid reserve its money on
the meter (honest, but leaks the bid's existence to every seat), or should the
meter simply name the exposure without the amount?

### Market share reads as nothing on a world map
A company that opens in Leeds holds about 0.2% of the world market, and the
standings say so. That is true and it is useless: a team winning its own
continent reads as a rounding error.

Probably: the headline share should be share *of the regions you sell in*, with
the world share beside it. Not decided.

### The phone has not caught up
The expansion vote is the sharp one: a phone player can cast the vote (it is a
`levels` lever and `LevelsField` draws it) but never sees the region, its cost,
who voted or whether it carried — the card whose whole point is showing what
your colleagues think is web-only. The teammate and rival-company profiles have
no phone counterpart either, so nudging a seat that has not filed is web-only,
and neither is URL-addressable, so the in-app browser fallback cannot catch
them.

The new desk fields (a region's continent, whether the company is foreign
there, whether it can be entered at all), the two Past-tab cards and the
expansion vote's faces are web only. The vote itself files fine from the phone
— it is a `levels` field like the offers, and `LevelsField` already draws it —
but the card showing who voted which way is not there.
`mobile/src/components/sim/*` mirrors the maths and the drift tests keep it
honest, so this is screens rather than logic.

### Paying for a simulation
Both tiers are built end to end — the two prices, the gate at the start line,
the checkout that knows which seat it is selling, and the webhook that credits
the right balance against a ledger keyed on the Stripe session so a redelivery
cannot credit twice. A session from before the split carries no `seatKind` and
is credited as the Nova seat it was sold as.

What is still owed: nothing decrements. A seat is held, not consumed — which
is what the copy says and what the price assumes — so a company buys once and
plays for ever. That is deliberate. A refund does not take seats back, and
there is no purchase history beyond a count, though `sim_seat_purchases` has
recorded every line needed to show one.

### Nova's simulation has never met a real model
`buildSimulationPrompt` and `parseSimulationBrief` are tested hard, and the
route around them is not: no integration test calls the model. The prompt asks
for a market whose *shape* matches the business, which is exactly the kind of
judgement that needs looking at on real companies before anybody is charged
for it.

## Built, so nobody rebuilds it

- Every seat's decisions, arriving over the first five years of a season
  (`shared/simulation/responsibilities.ts`).
- Regions, the plant and the balance sheet — the "depth" phase.
- Bots that make each standing call on a seeded coin, differently per company
  and per year, and never past a purse they can pay from.
- Bidding is the chief executive's; the table watches.
- The Past tab keeps what every seat filed, the year's auctions, and where
  every company stands.
- The world: seven continents, forty regions, real populations and incomes,
  guarded and closed markets (`shared/simulation/geography.ts`).
- A company season can choose its scope (one country, one continent, the whole
  world) and seat up to fifty companies of bots.
- Two seats, priced apart and held apart. A `play` seat is $3 — a person at a
  table in one of the markets we wrote. A `nova` seat is $5 — a person at a
  table in a season Nova built from the company's own project. Neither
  substitutes for the other.
- The gate is at the start line, against the people who actually sat down, not
  against company headcount and not at creation: a company of forty never pays
  for a season five of them play, and bots are not charged for. Creating a
  season is free; Nova's build asks for one Nova seat up front because it costs
  a model call.
- The web market can withdraw a listing, which only the phone could do. Every
  refusal on that screen and on the desk now says "that year just closed" and
  refetches when the tick catches somebody mid-action, instead of going red
  about a failure that did not happen (`isYearClosing`).
- Coming back from paying for seats says so, once, and then takes it out of
  the address so a reload does not congratulate somebody twice.
- A failing Ten Years valuation backs off and stops after eight attempts. It
  used to ask once a minute for a day, which is 1,440 model calls for one
  game, and the count lives on the row so a restart does not hand it a fresh
  budget.
- `sim_ventures.state` is gone. It was written every tick — a whole engine
  Company per venture — and read by nothing; the season's world was always the
  source. `Company.teamId` went with it.
- Bot companies spend against what the market can return rather than against
  their bank balance, and keep selling through a bad year instead of going
  quiet. Every company starts with the same cash in every market and what
  that cash can earn varies fourfold, so a bot anchored to its balance spent
  like a dating app in a market returning a fifth as much. Measured over 168
  seasons, survival went from 107 to 114 and the median company ended with
  two to twelve times more cash in every market — bot rivals are opponents
  now rather than corpses.
- Opening the announced region is the whole table's: operations puts it up,
  which is its vote for, the other four vote, and a majority of the votes cast
  carries it — a tie or silence leaves the region shut (`expansionOutcome` in
  `shared/simulation/world.ts`). The desk shows every seat's face against what
  they voted, counted by the server so the screen and the engine cannot
  disagree.

## Years, quarters and months

A season has always been fourteen years, one decision each. That is the right
rhythm for learning what the levers do and it is not how anybody runs a
business: real operators decide quarterly at worst, and "we saw it in March
and moved" is a skill an annual season cannot teach.

A season now carries a cadence — yearly, quarterly or monthly — chosen when it
is created and refused rather than quietly downgraded if it is not one of the
three. Somebody who asked for a monthly season and got a yearly one has been
sold the wrong thing.

Priced as its own seat, because it is more of the product for the same people:
**$6 a seat quarterly, $10 monthly**, against $3 for a season from our markets
and $5 for one Nova writes. The cadence outranks the origin — a monthly season
is a monthly season whether Nova wrote the market or we did, and it is the
dearer thing. `SIM_DEV_FREE_SEATS=1` lets a developer start one without
paying, local only and never production, mirroring `devAdvanceOn` and logging
loudly so a season started that way is never mistaken for one somebody bought.

### The rule the arithmetic rests on

Divide the flows, keep the stocks.

A **flow** is a quantity per unit of time: salaries, interest, marketing
spend, revenue, and the thresholds those are measured against. Ask a table
four times a year and each answer covers a quarter, so each is a quarter of
the size — *including* the thresholds, or a lever costing £220,000 a year
would cost £880,000 a year in a quarterly season and every quarterly season
would be unplayable.

A **stock** is a quantity at a moment: cash, customers, capacity, brand,
quality, headcount. Those do not care how often anybody is asked.

Two places it is tempting to be lazy, both tested. **Growth compounds rather
than divides** — 8% a year is 1.94% a quarter, not 2%, which is nothing in one
period and material over fourteen years. And **a lag stays as long as it was**:
research that landed in two years still lands in two years, which is eight
quarters, not eight periods called years.

### The engine, converted

`resolveYear` is period-aware. `World.periodsPerYear` is 1, 4 or 12; the
engine derives `per = 1 / periodsPerYear` and every flow is multiplied by it
while every stock is left alone. At `per = 1` the arithmetic is exactly what
it always was, which is why all 1,440 tests passed unchanged.

What had to move, in the order the measurements found it:

- **Flows.** Fixed costs, interest, revenue, variable cost, idle cost, and
  both halves of every `lift` — threshold *and* ceiling, because `lift`
  saturates and scaling only the threshold buys the same fraction of the
  ceiling four times a year.
- **Lags.** `brandLanding`, `qualityLanding`, `staffing` and `capacityBuild`
  were scalar pipelines that emptied themselves every call, so a one-year lag
  became a one-*quarter* lag. Each now releases a period's share of what is
  waiting: same steady state, same annual throughput, exact at `per = 1`.
- **Lags measured in years.** A feature build, a region opening, a bond
  maturing, a distribution deal expiring and the niche head start are all
  multiplied by `periods`, because `world.year` now counts periods.
- **Growth.** `segmentDemand` compounds annual growth over the period
  (`(year - 1) / periods`) rather than applying it whole, four times.
- **Rates.** Churn was the clearest case: the comment says a third of a
  segment a year is the outer limit, and it was applying that per call.
  Breaches, outages, lawsuits and poaching are annual chances now too.
- **Unserved demand.** It arrives across the year instead of all on the first
  day, so a quarterly season does not take four successive bites at the same
  open pool.
- **The news.** `eventFor` is drawn once a year, on the last period of it and
  seeded on the year rather than the period. This was the single biggest
  distortion found: a monthly season met twelve scandals a year, and brand
  came out 126% above the yearly run almost entirely because of it.

Measured over one year of an identical plan, quarterly and monthly now land
within 0.7% of yearly on cash, exactly on capacity, and within a fifth on
brand. `test/unit/cadence.test.ts` holds that as a regression test.

### The clock, converted

`sim_seasons.year` counts **periods**. Everything that schedules one now goes
through two numbers that were previously the same number and are not:

- **Span** — how much simulated time the season covers, still in years
  (`totalYears`).
- **Period length** — how much *real* time one decision gets
  (`period_minutes`, renamed from `year_minutes` in `0066`; for a yearly
  season a period is a year, so every existing value keeps its meaning).

They are deliberately unhooked, because hooking them gives you either a
monthly season that runs 168 real days or one that demands a decision every
two hours. The default keeps the day people have learned and shortens the
span: `DEFAULT_YEARS` is 14 yearly, 4 quarterly, 1 monthly. Whoever creates
the season can override both — the bounds narrow with the cadence, because
the real rule is counted in decisions (`PERIODS_MIN` 4, `PERIODS_MAX` 24) and
not in years.

Fixed along the way, each of which was a genuine bug rather than a rename:

- `seasonOver(year + 1, season.totalYears)` compared a period count against a
  year count, so a four-year quarterly season would have ended three quarters
  into its first year.
- `economyFor` runs a nine-*year* business cycle off what is now a period
  counter — a monthly season would have gone through the whole cycle in nine
  months. It takes `periods` and reads the year back out.
- `season-control.ts` hard-coded `DAY_MS` when rewinding a season to force an
  early resolve, so a workshop on ten-minute periods had its start put in the
  wrong place and its next tick landed hours out. It uses `periodMsOf` now,
  which is the one place that answer lives.
- The company season form had no cadence selector at all — the cadence was
  reachable by API only. It now picks the cadence, the period length and the
  span, and the span narrows under the choice.

### News at three grains

A season that decides twelve times a year should not meet the same one event
twelve times. Each grain has its own catalogue, sized to it: yearly keeps the
structural news (regulation, a funding winter, a recall) **and its exact
existing array**, because `pick` chooses by index and appending to it would
silently change which event every running season meets. Quarterly and monthly
are new, separate, and smaller.

A market event writes its multipliers onto `World.weather` with the period
they expire, so a funding winter drawn in the first quarter is still cold in
the fourth rather than being one bad quarter out of four.

The result, over four simulated years: yearly meets 3 events, quarterly 3 + 12,
monthly 3 + 12 + 36. The first year has no news at any grain, as before.

### Four things only playing found

The unit tests and the one-year invariant were green while all four of these
were live. They only showed up when a survivor-skill table actually played a
season at each cadence and the output was read as a business.

- **A new company could not get in at quarterly or monthly.** It won 1,970
  customers in its first quarter against 60,480 in a yearly season's first
  year. The winnings from the pool scaled perfectly — 5,292 against 1,323,
  exactly a quarter — but a newcomer's first customers do not come from
  winning: they come from incumbents winning more than they can serve and the
  overflow spilling to whoever has room. Rationing the *standing unserved
  pool* by period meant the incumbents were never saturated, so nothing ever
  spilled. Unserved people are a stock, not a flow; they are not rationed now.
  Churn is the flow that refills the market, and churn is scaled.
- **Bot rivals spent a year's budget every period.** A bot's budget is a share
  of cash plus turnover, filed per decision, so a monthly season's bots spent
  twelve years of money a year and the humans played against a market of
  corpses. `botDecision` takes `periods`.
- **Service ran away.** One `lift` — the service one — was never scaled, so a
  quarter's support spend was weighed against a year's threshold and bought a
  year's ceiling. Quarterly seasons reached service 75–79 where yearly reached
  59–64. There are no unscaled `lift` calls left in `resolve.ts`.
- **Staff were worth a year of support every period**, for the same reason:
  `supportEquivalent` is an annual salary figure added to a per-period budget.

The forecast (`projected` in `forecast.ts`) was annual throughout and is now
period-aware too — otherwise a quarterly table was shown a projection
promising a year's brand for a quarter's spend.

### Seven more, found by playing each cadence to six years

The first four were found in a single season. These needed the *same* business
played to the same simulated year at all three cadences and the columns put
side by side — at which point monthly's quality went 38 → 33 → 26 → 5 while
yearly's went 35 → 54 → 89 on identical decisions.

Every one is the same mistake in a different costume: **a standing condition,
or a stock's own decay, written as a yearly figure and then applied once per
decision.**

- **`sourcing.quality: -3`** — outsourcing makes the product a few points
  worse for as long as it is outsourced. Applied per period that is −36 a
  year at monthly. This was the quality collapse.
- **`programmeYield`** paid a programme out over three *calls* against a
  window of three, so a monthly season got three years of a programme's
  benefit in three months and then nothing.
- **`sourcing.unitCost`, `auto.unitCost`, `focus.cost`** — three standing
  multipliers applied to the stored unit cost every period. Outsourcing at
  1.09 a year compounded to 2.8x a year at monthly; by year six the company
  was charging eight times its opening price just to stay level. They are
  raised to the power of `per` now, because that is what a multiplier's
  period-share is.
- **`securityNext` / `dataNext`** kept a fifth of their level per *call*.
  `0.8¹²` is 0.07, so a monthly season's security and data went to nothing
  however much was spent on them.
- **The review scar and the second shift's toll** on service, same shape.
- **`isUnlocked`** gated levers on `year >= 2` while `year` counts periods, so
  a quarterly season handed a table every lever in the game inside nine months
  and a monthly one inside three. That is not a faster game, it is the
  teaching order thrown away — and it is the single most player-visible thing
  in this list.
- **The monthly default span was one year**, which is shorter than every lag
  in the game. Twelve decisions, none of which ever paid off; a table that did
  everything right finished on brand 16. The default is two years now, and
  `cadence.test.ts` asserts no default is ever below two.

### The late game had nothing in it

Playing a full fourteen years showed the other half of what was wrong, and it
had nothing to do with cadence: **a competent table pinned quality at 100 by
year eight and brand and service by year twelve.** The last third of the
flagship season was cash piling up against stats that could not move.

The cause was that decay was a flat 4.5 points a year at every level while
gains kept coming, so once a company's gains cleared the rate it climbed to
the ceiling and parked. Two changes, and the measurement demanded both:

- **Decay is proportional to level**, measured against fifty — a company in
  the middle of the scale pays exactly what it always paid, and one at
  ninety-five pays nearly twice.
- **Gains meet headroom above the midpoint.** Decay alone was not enough and
  the numbers said so: a good table gains about twenty-one points of brand a
  year against a decay that now reaches nine, and still climbed. Below fifty
  nothing changes at all, so the whole early game is untouched; above it each
  point costs more than the last.

The season now moves both ways — brand *falls* between years eight and ten on
a plan that used to climb — and the markets differentiate instead of all
arriving at 100: drone delivery ends on quality 76, construction 68, project
management software 96.

### How it plays now

A survivor-skill table in all seven markets, at each cadence's own default
span, all solvent and none pinned:

```
yearly, 14y     cash £29.6m–£171m   brand 93–97  quality 68–96  service 56–67
quarterly, 4y   cash £2.3m–£8.0m    brand 43–72  quality 42–67  service 52–56
monthly, 2y     cash £4.1m–£6.8m    brand 22–27  quality 34–44  service 50–51
```

The finer cadences end lower because they cover fewer simulated years, which
is the trade the span defaults make. What they buy is responsiveness: on an
identical first year, quarterly finishes with 8% more customers and monthly
16% more, for the same cash to within 0.2%.

Played to the *same* six simulated years, the three now track each other
rather than diverging — quarterly and monthly both end ahead of yearly on
customers and behind on quality, which is the honest shape of deciding more
often with the same lags.

### What 336 seasons say

A survivor-skill table, twelve seeds per market per cadence, at each cadence's
default span. The seed changes the events, the incumbents' moves and every
jittered decision, so it is the closest thing to "a different table played
this market".

```
                 survived   ended richer   cash p10 / median / p90
yearly, 14y         87%          75%       varies by market (below)
quarterly, 4y      100%          29%
monthly, 2y        100%          26%
```

Per market at yearly, the spread is wide and the markets differ, which is what
you want:

```
Project management   92% survived   92% richer   £15.7m / £97.3m / £179.5m
MMOs                100%            83%           £5.6m / £81.1m / £122.9m
Podcasts            100%            75%           £0.3m / £56.3m /  £95.1m
Dating apps          83%            75%          -£0.1m / £80.6m / £146.7m
Restaurant chain     92%            67%           £1.2m / £33.8m /  £62.3m
Construction         83%            75%          -£0.5m / £37.9m /  £74.7m
Drone delivery       58%            58%          -£2.8m / £12.7m /  £36.4m
```

Three things that need a decision rather than a fix:

- **Skill barely matters.** The same 84 seasons played by the `filler` bot —
  the deliberately weak one — survived 88% and ended richer 68%, against the
  `survivor` bot's 87% and 75%. The difficulty tier built to play better is
  worth seven points of "ended richer" and *nothing* on survival. For a game
  whose purpose is teaching people how to enter a market and survive, that is
  the most important number in this document.
- **Nobody ever dies at quarterly or monthly.** 168 seasons, zero
  bankruptcies, and only a quarter of them end richer than they started. The
  finer cadences are currently "cannot lose, cannot win" — flat and safe —
  where the yearly game has a real 13% failure rate and a real spread.
- **Drone delivery is the one market that fails**, at 58%, and it fails for
  both skill levels equally.

### Making skill matter

The measurement above said the difficulty tier was worth nothing. Finding out
why took three experiments, and the first two answers were both wrong.

**A lever sensitivity sweep** — one fixed plan over ten years, one lever moved
at a time — gave the shape of it. With capacity following demand, *every*
investment lever had a negative return: no brand spend beat the baseline by
14%, no product spend by 21%, and filing nothing at all on every lever beat a
balanced plan by 12%. With capacity generous, the same levers turned positive:
five times the product budget was worth 46%, and filing nothing died 5 seasons
out of 5.

So the levers were never broken. **A company at 85% of its plant cannot use
another customer**, so money put into being more appealing buys demand it then
turns away — and both bots ran at 82–89% utilisation, because `botCapacity`
did not take the skill at all. Both were equally boxed in, so the one that
spent more simply wasted more.

Two changes, and a third that was measured and thrown away:

- **`priceLicence` (market.ts).** A segment's `referencePrice` is what it
  expects to pay for the ordinary thing, and every company was judged against
  it — so a company with quality 90 was punished for charging more than one
  with quality 30, and the only thing being good ever bought was volume. A
  company can now charge up to 18% over the reference, earned from the axes
  the segment actually cares about. Not more: at 25% the premium play won all
  seven markets and `balance.test.ts` caught it.
- **`botCapacity` takes the skill.** A survivor keeps about a third more room
  than it is using and does not wait until it is full to build, because room
  ordered now opens a year from now. On a fixed plan over ten years, room
  built generously returned £32.1m against £13.1m for room that followed
  demand — the same money, more than twice the company.
- **Letting a survivor spend like an operator was tried and reverted.** Raising
  its share of gross from 5% to 18% made it visibly better at running a
  company — brand 94 against 85, quality 93 against 89 — and worse at owning
  one: median cash fell from £70m to £33m and it began dying *more* often than
  the weak bot. The note in `bots.ts` keeps the finding where the next person
  to have the idea will read it.

Lowering the switching tolerance so a better offer pulls customers harder was
also tried. It moves the number but breaks four guard tests at once, and it is
the single deepest knob in the market — it wants its own pass, not a
drive-by.

### What it bought

```
              survivor              filler            gap
yearly        90% / 82% richer      87% / 69%         +13
quarterly    100% / 30% richer     100% / 19%         +11
monthly      100% / 25% richer     100% /  6%         +19
```

Monthly shows it most sharply — four times as many good seasons as bad play
gets — which is the right shape, because deciding twelve times a year is worth
most to somebody who knows what to do with the decisions.

`balance.test.ts` now holds this as a guard: a survivor must end richer than a
filler by more than ten points across sixteen seasons a side. It was the
absence of that test that let the tier be worth nothing for as long as it was.

### A pain-point sweep, and what it caught

Every market at every cadence, three seeds each, with a detector that flags
anything that looks wrong rather than anything that looks right: non-finite
numbers, fractional people, negative anything, markets holding more customers
than they have, costs that dwarf revenue, stats pinned at the ceiling, and
prose that names the wrong unit of time.

Four things fixed:

- **2,918 notes said "year" inside a quarterly or monthly season.** A monthly
  table read "The year was run for growth" twelve times a year. Fixed with
  `inPeriodWords` in `cadence.ts`, applied once where the report is assembled
  rather than at twenty-nine call sites.

  It is deliberately narrow. "Next year" is left alone, because the lags
  really *are* a year — room ordered now opens a year from now however often
  the table meets, and a new hire is useful in their second year. Rewriting
  "it opens next year" to "next month" would be a lie. Only the phrases that
  mean *the span just decided* are touched, and at yearly cadence the function
  returns the string it was given.
- **Fractional customers.** A report could say 14,353.5 people. My own
  `capacityBuild` change had made capacity fractional (`current + gap × per`),
  which flowed into the spill pass and out the other side as a fraction of a
  person. Rounded at source, and then guaranteed once more where customers
  become the company's, so no future pass can reintroduce it.
- **Drone delivery started every company underwater.** Starting capacity is
  the smaller of a tenth of the home region and £9m of revenue, and in a
  market where the cheap segment is most of the people the region term binds
  first: room for 38,214 customers at £25 is £955,000 of possible revenue
  against a £1.4m salary base. It lost money in year one whatever anybody
  decided. There is a floor now — a company that fills its plant can at least
  pay the five people running it, with half as much again on top. Year one
  goes from −£136k to +£522k, and the median season from £12.7m to £32.2m.
- **A flaky test.** `data-shape.test.ts > secret box` fails in the full suite
  and passes in isolation. Not mine, not investigated, worth knowing.

What the sweep says is still wrong is in the sections above and below: the
market over-service (454 flags, every one of them real) and three cases of
brand still reaching 100.

### Why the easy markets will not die, and what actually controls it

The target is about six failures in twenty. Podcasts, project management and
MMOs were at zero. Six levers were tried against that, each measured over 140
seasons, and five of them did nothing:

```
lever                          average deaths / 20
baseline                              2.0
incumbents vary by season             2.1   ← kept
starting cash × 0.62–1.12             2.1   (breaks pinned tests)
starting cash × 0.32                  2.6   (a third of the runway, +0.6 deaths)
leave-rate cap 0.35 → 0.65            2.0   (no change at all; broke 11 tests)
opening plant sized to a safety band  2.4   (broke 9 tests)
idle plant 0.08 → 0.30                2.6   (drone 10/20, but at a year-4 cliff)
contribution margin 91% → 62%         2.3
```

The last one is the most interesting failure. Survival correlates almost
perfectly with contribution margin — MMOs at 91% never died, drone at 60% died
eight times in twenty — so tightening every market to ~62% looked certain to
work. It moved the average by 0.3. **Margin predicts survival without causing
it.**

What the measurements do establish:

- **A profitable company is never in danger.** Every death in 140 seasons was
  a company that failed to get traction early and then took until year 8 to
  burn its bank. Nothing in the game can take down a business that is working,
  which is why nothing that squeezes a working business changes the count.
- **Break-even is at about a sixth of the plant.** Full-plant gross runs
  £1.5–2.4m against a £0.32m cost base, so a company only has to fill 16% of
  what it built to cover its costs. That is the number that makes failure
  nearly impossible, and it is upstream of every lever above.
- **What is special about drone delivery is its customers, not its economics.**
  Its opening price targets the cheapest of its three segments — novelty
  orderers, price sensitivity 0.75, loyalty 0.12 — so a company there serves
  people who are cheap to win and leave immediately. MMOs and project
  management open onto loyal, valuable customers. That is market content, not
  a constant.

So reaching six in twenty means one of two deliberate decisions, both of which
are bigger than a knob:

1. **Raise the cost base** so break-even needs half a plant rather than a
   sixth. This is the honest fix and it would make every other lever start
   working, because a company that dips would actually be in trouble. It also
   re-tunes every market at once and will break the guard tests that pin the
   current economics — those tests are asserting today's balance, so they
   would need re-setting against the new one rather than being worked around.
2. **Give the soft markets harder customers** — a cheaper, more fickle opening
   segment, the way drone delivery has one. Narrower, safer, per-market, and
   it keeps the markets feeling different from each other instead of
   flattening them.

**Kept from this round:** incumbents now vary by season (±5 points on each
axis, ±16% of share), so entering a market means finding out what is already
in it rather than meeting the same four companies at the same strength every
time. Tried at ±10 and ±7 and both dropped a competent team below the 5% share
floor in MMOs, which is the guard doing its job.

**Reverted:** the per-season opening climate (it breaks tests that pin a
company's opening to exactly £6m, and bought 0.1 deaths), the opening safety
band, the leave-rate cap, the idle-cost rise, and the margin change — that last
one because reshaping what all seven markets *are* is a decision worth making
deliberately, not a side effect of a failed experiment.

### Why 6/20 has not landed: every route breaks something else

The plan was overhead first, then harder opening segments, then re-set the
guards. It was followed, and it produced a genuinely useful negative result
instead of the number. Recorded here so nobody spends another day on it.

**A cost base charged on the plant kills the volume strategies.** An overhead
proportional to capacity hits exactly the plays that build capacity. Measured
in dating apps at 0.35, against the same four synthetic strategies the guard
tests use:

```
                grower   premium   cheap   local
no overhead        7.8      11.9     4.2     9.6
capacity 0.35      0.4      11.9     0.4     9.5
```

Growing and competing on price both fell by a factor of twenty. The market
still had a door, but only two ways through it.

**A flat cost base kills the margin strategies.** The obvious alternative —
charge for running a company rather than for its room — has the mirror
problem, because a low-volume high-price play cannot cover a large fixed cost:

```
                grower   premium   cheap   local
no increase        7.8      11.9     4.2     9.6
running × 1.6      0.3       0.1     0.4    10.3
running × 3.4      0.1       0.1     0.3     0.2   (deaths 8.3/20)
```

At 3.4 the failure rate finally passes six in twenty and *nothing works at
all* — 0.28% of the market to the best of four strategies.

So the two shapes of cost pressure fail in opposite directions, and neither is
a tuning problem. The reason is structural: **the strategies are fixed plans.**
They file the same decisions for fourteen years regardless of what anything
costs. A real table — and the bots — would respond to a changed cost base by
changing the plan; a fixture cannot. Until the strategies and the bots adapt
to the cost base, raising it will always look like the game breaking.

**MMOs is separately broken, and was before any of this.** At zero overhead
its best strategy reaches 5.20% revenue share against a 5% floor, held up
entirely by the cheap play; premium gets 0.1% and growing gets 0.0%. It has
been sitting two tenths of a point above its own guard, so any change at all
tips it over. Its incumbents are much stronger than any other market's
(quality 78 and 88, brand 89) while its margin is 91%, which makes it
simultaneously the hardest market to win share in and the only one where a
company cannot fail.

Softening those incumbents was tried. It fixes the share and breaks the skill
guard — weaker rivals mean weak play succeeds too, and the survivor's margin
over the filler fell below ten points. Reverted.

### What would actually work, in order

1. **Make the bots and the strategy fixtures cost-aware** before touching the
   cost base again. This is the blocker, not the constants.
2. **Rebuild MMOs' market content** — it needs incumbents that are beatable by
   more than one strategy *and* a margin that makes coasting unsafe. Both at
   once, measured against the skill guard, not one and then the other.
3. **Then** raise the cost base, with the guards re-set against the new
   economics afterwards.

### The cost base is the lever, and it is written but not wired in

Of everything tried, one thing moves the failure rate: **what it costs to keep
a plant ready, full or not.** `plantOverhead` in `decisions.ts` charges a
share of what a full plant earns at the market's own reference price.

```
PLANT_OVERHEAD    average deaths / 20
    none (today)          2.0
    0.34                  3.7
    0.45                  5.1
    0.55                  6.0   ← the target, exactly
```

At 0.55 every market kills somebody and the spread is right: drone 10/20,
project management 7, podcasts 6, restaurant 6, construction 6, dating apps 5.
MMOs is the last hold-out at 2.

**It is deliberately not wired in.** At that strength it does not only kill
weak companies, it suppresses strong ones: a competent team's share in MMOs
falls from 5% to 2.4%, a good plan stops growing before the season ends, and
fourteen guard tests fail — two of them guarding principles rather than
thresholds. That is the difference between a balance that needs re-calibrating
and one that is wrong, and the second is not worth shipping to hit a number.

One real flaw was found and is worth knowing separately: **incumbents have
never paid `fixedCosts` at all.** They run on a simplified model. That was
ignorable while the cost base was £320,000; at £1.2m it is a tax on being the
newcomer rather than a harder game. Charging them symmetrically did not on its
own fix the share collapse, so there is more to it.

The route from here, in order:

1. Overhead at ~0.35 rather than 0.55 — enough to make a bad year matter,
   not enough to flatten everybody.
2. The second half of the plan: harder opening segments in podcasts, project
   management and MMOs. Drone delivery is hard because its opening price
   targets novelty orderers — price sensitivity 0.75, loyalty 0.12, cheap to
   win and gone immediately. The soft markets open onto loyal, valuable
   customers and that is the whole difference.
3. Incumbents charged for their plants too.
4. The guard tests re-set against the new economics **afterwards**, and never
   to turn a red suite green.

### Drone delivery is not a cliff, it is a slow starve

Deaths do not happen where the intuition puts them. Across 140 seasons, *every
single death was in year 8 or later*, and drone delivery's clustered at
exactly year 8 — which looks like a scheduled event and is not one.

```
Dating apps        3/20 died   years 8, 8, 10
Drone delivery     6/20        years 8, 8, 8, 8, 10, 10
Podcasts           0/20
Project management 0/20
MMOs               0/20
```

Tracing one: the company reaches year 3 with 3,400 customers against 70,000 of
capacity, never finds traction, and bleeds. Year 8 is simply how long £6m
takes to burn at that rate. The bankruptcy is the end of the story rather than
the story.

So the real question is not "why do they die in year 8" but **why do some
seeds never get traction at all in drone delivery when podcasts, project
management and MMOs never fail once in twenty**. That is a market-content
question — the opening region, the incumbents' strength, the segment mix — and
it is the one remaining thing standing between this and a balanced set.

### A market can hold more customers than it has people — fixed

Two things were wrong and both are now right.

**Every leaver was counted twice.** `alreadyHeld` is measured after churn, so
the people who just left were in the open pool once as "not held any more" and
again as `poolForNewcomers`. `alreadyHeld + upForGrabs` therefore exceeded the
segment's population by the churn, every period, for ever.

**And a shrinking segment took nobody with it.** Holdings only grew: when the
number of people in a segment fell — the economy turns, the growth rates
differ — nothing gave.

```
            before            after
year  demand      held    ratio   held    ratio
   3  6,883,269  7,154,827  1.04   6,883,261  1.00
   6  6,552,711  7,586,738  1.16   6,552,701  1.00
  12  5,963,009  9,277,942  1.56   5,962,995  1.00
```

A segment now adds up to the people in it, to within rounding, in every year
of every market. Revenue, cash and the value a season is ranked on were all
inflated by up to half and are not any more.

A shrinking market is a real movement, so it gets its own line in the year-end
report — `leftMarket`, beside `lostTo` and `turnedAway`. "We lost four
thousand people and nobody took them" is a different sentence from losing them
to a rival, and a team that reads the second when the first is true goes and
fixes a price that was never the problem.

**It cured MMOs.** The market that could not be played — best strategy 5.20%
revenue share against a 5% floor, held up by one strategy — reaches 10.8%
once the arithmetic closes. It was choked by a market holding half again as
many customers as it had people.

`cheap` went from 0.2–0.4% of a market to 5–19%: the whole strategy was being
starved by the same bug.

### An optimiser, and the four objectives that were wrong

`shared/simulation/optimiser.ts`. Every bot until now decided one seat at a
time — `botDecision` is called once per role, with that role's levers and no
idea what the other four are doing — so five seats spent against the same cash
and none of them knew. This one solves the whole company at once: one budget,
one objective, every lever competing for the same pound, allocated a slice at
a time to whichever returns most at the margin. Because every lever in the
engine saturates, that produces the ramp a good operator has, with brand,
product and service rising together.

Getting the objective right took four tries, and each failure says something
about the game:

| objective | what it did |
|---|---|
| money | raised price ~1.5× a year, compounding to **290×** over fourteen; served 174k where the ordinary bot served 1.4m; £1.9bn, brand 30, **quality 4** |
| this year's forecast | spent **nothing** on product — and was right to, since `projected` leaves this year's shipping out because it lands next year — finishing on quality 5 |
| next year's forecast | spent to exactly the solvency constraint, every year ending on nothing: **52% survival** |
| + a year's reserve | survived more, ended poor: 62% survival, **10%** of seasons richer |
| + money in the score | 62% / 62% |

The first is the most useful finding on its own: an unconstrained optimiser
**proves** this engine still rewards gouging, and it found it in one pass.
Price is now anchored to the segment's own reference rather than to last
year's price, which makes the compounding inexpressible.

### Breadth was the real gap, and horizon was hiding inside it

Measuring what each tier actually *files* was more useful than measuring what
it achieves:

```
Levers the game offers:  72
optimal   touches  9  (13%)   →  16  (22%) after this work
survivor  touches 40  (56%)
Neither ever touched:    31
```

The optimiser was out-searching the survivor on a narrow slice and losing on
the whole game. Among the 31 neither had ever touched: **the entire finance
seat** — borrow, repay, raise, dividends, factoring, refinancing, buyback,
cost review — and **every expansion lever**. No bot in this codebase had ever
opened a second region, in any season, so companies spent fourteen years
selling into a tenth of a market. One of five seats was unexercised by any
simulation, which means every balance number in this document was produced by
tables that never borrowed a pound or entered a second market.

It now borrows and expands. Expansion is the interesting one: it takes a
majority of the five seats, so it is the one decision an optimiser can express
and five independent per-role bots structurally *cannot*.

**Breadth and horizon turned out to be the same problem.** Adding the levers
was not enough — the optimiser still refused to expand, and it was right to.
A region committed this year opens *next* year, so at the moment the next-year
forecast is taken it is an entry cost and nothing else; a one-year objective
prices it at exactly its cost. It only started expanding once the objective
credited a region that is about to open, at what it will reach when it gets
there. The levers it was missing were precisely the long-payback ones, and no
amount of widening the search reaches them without widening the horizon too.

### Cash is not the score, and measuring it that way hid two things

A weak bot appearing to end "richer" than it started, as often as a good one,
turned out to be half a measurement problem and half a real one.

**The measurement.** "Ended richer" was cash above the opening £6m, and cash is
deliberately *not* what a season ranks founders on. `valueOf` in `resolve.ts`
is: a year of what the customers pay, plus what the company owns, less what it
owes. Scored that way, over 56 seasons a side:

```
mode        median value   median cash   customers   survived
idle               £0.0m        £2.5m       1,682        55%
filler            £15.2m       £12.8m     308,232        86%
survivor          £17.1m       £21.4m     419,505        86%
optimal           £10.4m        £7.8m     176,099        91%
```

A table that never files anything ends **worthless** and dies in 45% of
seasons. The model does punish doing nothing; measuring it in cash did not
show that, because a company can bank its opening endowment while its business
rots — profitable for eight years on a position it never earned.

**And the real one.** Filler at £15.2m against survivor's £17.1m is a 12% gap
for the difference between playing badly and playing well. That is too close,
and it is the same finding as ever: this engine rewards spending weakly, so
the bot that spends least is never far behind.

**The optimiser was optimising the wrong thing.** It banked the most cash of
any tier (£30.3m at one point, against the ordinary bot's £18.8m) on half the
customers, and came *last* on the measure the game actually uses. It was
liquidating: a pound not spent scored a pound, and a pound spent had to earn
its way back. It now scores on the engine's own `value`, which moved it from
£9.6m to £12.5m on the same seeds — and it is still behind both bots on value
while surviving more than either. Cautious, not optimal.

### Three instruments tried against "doing nothing is too safe"

- **A plant overhead** cannot tell "played badly" from "never turned up",
  because both hold a plant. At 0.20 it bankrupted an idle team by year five,
  which breaks a deliberate product guarantee — *"five people join, argue
  about seats, and never come back; fourteen days later there must still be
  something there, because the one who wanders back on day twelve is the
  player worth having"*. At 0.12 the guarantee holds and the skill gradient
  inverts instead, because a cost rise always hits the spender hardest.
- **Opening the sealed segments** (the tolerance recalibration) does not touch
  it: the passive company is capacity-bound, not churn-bound. It holds exactly
  its starting plant because even a terrible company can fill it. And it still
  breaks the same three guards.
- **Scoring on value rather than cash** is the one that landed, and it fixed
  the optimiser rather than the balance.

The unresolved shape of it: **a company's opening position is profitable
enough to coast on for eight years.** Until that is false, the bot that does
least will stay close to the bot that does best, and every instrument that
makes coasting expensive makes playing expensive too.

### Does it look like a business? `npm run sim:realism`

A season can balance perfectly and still describe something nobody would
recognise. `scripts/realism-report.mjs` puts what a season produces next to
what real firms report:

```
market             gross%  op%  salary%   rev/head   growth  leader   HHI
Dating apps           92%   27%      9%      £744k      15%     36%  0.29
Drone delivery        72%  -18%     17%      £403k      20%     39%  0.30
Podcasts              90%   20%     15%      £497k      22%     36%  0.27
Restaurant chain      74%   31%      6%    £1,296k      26%     43%  0.28
Construction          76%  -58%     44%      £155k      17%     35%  0.28
Project management    87%   38%      8%    £1,140k      35%     35%  0.29
MMOs                  94%   26%     16%      £451k      22%     42%  0.30

anchors            20-80%  5-25%  15-40%  £80-400k   5-40%  15-40%  0.1-0.25
```

### Who works here: `shared/simulation/workforce.ts`

The five are the players. Everybody beneath them is the operations seat's
`headcount`, and a head was a head: one flat salary, identical in every
market, and the only thing it bought back was service.

A market now describes its own people, beside the rest of its vocabulary:

```
market              salary/head   room  product  service   who
Restaurant chain        £65,450     50%      15%      35%   chefs and kitchen staff, front of house, area managers
Drone delivery          £82,875     50%      25%      25%   pilots, mechanics, dispatchers
Podcasts                £82,450     40%      40%      20%   producers, editors, ad sales
Dating apps             £95,200     20%      40%      40%   moderators, engineers, community managers
Construction           £102,638     55%      25%      20%   site crews, structural engineers, quantity surveyors
MMOs                   £117,300     25%      45%      30%   game developers, game masters, server operations
Project management     £128,350     25%      45%      30%   engineers, customer success, infrastructure
```

Each kind says what hiring it buys — **room** (the ability to serve at all),
**product**, or **service**; nothing buys brand, because you cannot hire your
way to being known — what one costs against an ordinary salary, and roughly
what share of the payroll they are. `fixedCosts` charges the market's own
weighted rate, so "should we take somebody on" is a genuinely different
question in a kitchen from what it is in software rather than the same
arithmetic with different nouns.

**Nova writes one for a custom market**, from the same prompt that writes the
voice and the segments, and it is asked to be specific: *"Staff" is not an
answer; "dispatchers" is.* Anything missing, nonsensical or adding up to 1.4
falls back or is normalised rather than failing the market — a season that
cannot start because a model left a field out is worse than one whose people
are called operators.

The price licence came down from 12% to 9% on the back of this: a kitchen's
people cost two thirds of a studio's, and moving that moved which strategy
wins where.

### Making a plant need people: built, measured, not wired in

Each kind of person now says how many customers one of them looks after in a
year, and the numbers are derived rather than guessed — set so that revenue
per head lands at about three times the market's own wage, which puts the
salary share where real companies report it:

```
market              serves/head   opening £   rev/head   salary share
Restaurant chain         15,000         £13      £195k            34%
Podcasts                 18,000         £14      £252k            33%
Drone delivery           10,000         £25      £250k            33%
Dating apps               7,000         £40      £280k            34%
Construction                341        £900      £307k            33%
MMOs                      8,000         £45      £360k            33%
Project management        7,000         £55      £385k            33%
```

`canServe` and `staffFor` in `workforce.ts` are the two functions that turn
that into a constraint, and wiring them into `resolveYear` does exactly what
it should. Measured across all seven markets over fourteen years:

```
                     before        after
headcount                 5       16–122
revenue per head   £1.3m–£10.1m   £217k–£414k
salaries               6–16%        20–24%
profit swing          12–44%         8–16%
```

Four of the seven realism columns move from outside the real-world band to
inside it. A restaurant chain goes from £50.7m of turnover with five people
to £29m with a hundred and twenty-two.

**It is not wired in, because it breaks six balance guards.** Every strategy
fixture in the suite was written when room and people were unrelated — they
build nine hundred thousand of plant and hire twenty — so with the constraint
live they own empty buildings. Staffing the fixtures fixes four of the six and
leaves the two that matter most: no strategy wins every market, and every
strategy is viable somewhere. Competing on price is hit hardest, which is
*correct* — a low-price high-volume business is labour-intensive — and is
exactly why it needs a balance pass rather than a constant.

Three things were learned on the way and are worth not rediscovering:

- **Capping the forecast by headcount deadlocks the sizing loop.** A team
  staffs the plant it builds and builds the plant the forecast asks for, so a
  forecast that already knows the headcount can only ever say "stay the size
  you are". What understaffing costs belongs *beside* the forecast, the way
  `capacityRisk` sits beside it, not inside it.
- **A second shift is people, by definition**, and leased room comes with
  somebody in it — which is most of why leasing costs forty per cent more
  than building. The cap belongs on the plant a company built and has to
  staff itself.
- **A hard cap is too blunt.** It takes a plant to nothing the moment the
  payroll dips, which no real operation does. Understaffing should run the
  doors badly, not shut them: `UNMANNED_FLOOR` is the softer form and it
  passes two more guards than the cliff does.

The order for the pass that lands it: teach the strategy fixtures to staff
what they build, then retune for the fact that volume plays now carry a
payroll, then wire the constraint. The optimiser already sizes headcount
against capacity and is the one table that would not be blindsided.

**Nobody works at these companies.** Headcount ends at exactly five in every
market, in every season — the five people in the chairs, and not one person
hired in fourteen years:

```
market              year 14 revenue   headcount   customers per head
Restaurant chain             £50.7m           5              563,038
MMOs                         £34.6m           5              113,531
Dating apps                  £22.9m           5               84,929
Construction                  £6.4m           5                1,045
```

A restaurant chain turning over £50.7m and serving 2.8 million people with
five staff is not a business, and it is the root of several things this
document has been circling for a long time. Labour is the largest cost in
almost every real company and here it is 6–16% of revenue; that is why the
cost base is light enough to coast on, why break-even sits at a sixth of the
plant, and why every attempt to make standing still expensive had to reach
for an artificial overhead instead.

The reason nobody hires is that hiring is priced as a pure cost: `fixedCosts`
charges the salary and the only thing a head buys back is service, through
`staffing`'s `supportEquivalent`. Capacity is a free-standing number with no
people attached, so a bot that hires is simply a bot that spends more. **The
fix is to make capacity need people** — a plant can only serve what its staff
can serve. That would put labour where it belongs, make the operations seat's
hiring lever matter, and make coasting cost what coasting costs.

It is also a serious rebalance, and the history in this document is that every
cost increase lands hardest on whoever is spending. It wants its own pass,
with the bots taught to hire before the constraint arrives — note that the
optimiser already sizes headcount against capacity, so it is the one table
that would not be blindsided.

**Also worth knowing:**

- **Every market has software margins.** Construction runs a 76% gross margin
  and a restaurant chain 74%. Real construction is 10–20% and restaurants are
  labour-heavy. The markets differ in their customers and not in their
  economics.
- **Operating margins run hot where the game is winnable** (27–38% against a
  5–25% anchor) and deeply negative where it is not (−18%, −58%). There is
  very little middle.
- **Markets are more concentrated than typical** — HHI 0.27–0.30 against
  0.1–0.25, leaders on 35–43%.
- **Construction's profit swings by 44% of revenue year to year**, which is
  three times the anchor. It is the market that has been hardest all along.
- The price-spread column reads 37x in podcasts and that one is a **false
  positive**: the market spans £14 to £380 by design, so a premium entrant
  beside a mass-market incumbent is the market working, not a fault.

### Doing nothing is no longer a way to finish a season

A table that never files anything used to end more than half of seasons alive
and sometimes richer than it started, coasting on an opening position nobody
had earned. It is wound up now, in every market, every time.

The mechanism is deliberately keyed on **nobody filing**, not on spending
little — which is the distinction every cost lever failed to make. A plant
overhead cannot tell a team that played badly from one that never turned up,
because both hold a plant. `decisionsForYear` already knows who was absent, so
it marks the year `steered: false` when every seat is empty, and the engine
winds the company down from the second silent year: the plant goes, the
customers follow, and after six it is wound up altogether.

Trimming customers alone did nothing at all, which is worth recording — a
company at these sizes is capacity-bound with demand to spare, so the market
simply refilled it every year. Taking the room away is what does it.

**This replaces a deliberate guarantee** that a company nobody filed for was
still standing after fourteen years, whose rationale was that the player who
wanders back on day twelve is the one worth having. The two rules cannot both
hold: a company nobody runs for ten years cannot be both closed and
recoverable. What is kept is the half that survives the arithmetic — the
counter resets the moment anybody files, so a table that goes quiet for a
year or two and comes back finds a company that lost ground rather than one
that ended, and `season.test.ts` holds that.

### And the bots stopped changing their minds every year

Every choice in the game — positioning, pace, sourcing, how a feature is
built — was re-rolled from scratch annually, because the seed carries the
year. A bot that picks a different market position every twelve months is not
playing badly, it is not playing at all, and no lever that rewards
consistency could ever pay for it. Last year's answer stands now unless a
one-in-five roll says otherwise.

### Closing the gap: it is the best table in the codebase now

Scored on all four of the things a season is made of, 42 seasons a side:

```
mode        value     cash   customers   survived
idle        £0.0m    £3.4m          11         0%
filler      £9.9m   £10.6m     167,242        83%
survivor   £10.6m   £18.3m     198,313        86%
optimal    £15.1m   £31.1m     247,943        86%
```

Ahead on value, cash and customers; level on survival. Getting there needed
three years of rollout with a continuation that *grows* rather than a frozen
plan, a plant allowed to double rather than grow by half, cash weighted at
eight hundredths of a pound of company (at zero it spends to the last pound
for any gain at all; at a half it hoards and the business collapses to 29,000
customers), and two years of running costs held back rather than one or
three.

The route there, each step measured:

```
                                                survives   richer
one year ahead, valued on cash                     62%       57%
  + net off the debt it borrowed                   62%       62%
  + believe the engine over the forecast           62%       62%
  + a plant that grows at a plant's speed          71%       71%
  + value the position over the years left         76%       76%
  + roll two years forward, not one                81%       81%
  + a finer search (16 slices, not 10)             84%       81%
```

Tracing the deaths was worth more than any amount of searching harder. Every
season it lost looked the same: **it spent nothing at all for the first three
years**, held about a thousand customers, and bled fixed costs until it died.
It was scoring correctly every one of those years — nine customers at £740 of
margin against £700,000 of running costs is a bad year however much you spend
on it — which is exactly why the objective was the thing to fix.

Four findings, in the order they mattered:

- **Borrowed money was counted as wealth.** The score read `me.cash` and never
  subtracted `me.debt`, so drawing on the credit line was free points: it took
  a million in its first year, spent none of it, and paid interest for the
  privilege, in every season it lost.
- **It exploited the forecast.** `forecastDemand` describes itself as a sketch
  of the engine, and a search against an approximate model finds where the
  approximation is generous. In dating apps it committed £5.7m against a
  forecast of 350,000 customers, the year delivered 44,000, and it spent three
  years paying for a plant four hundred thousand seats too big. The position is
  now the smaller of what the sketch predicts and what the engine actually
  produced: the forecast can argue the company down and no longer up.
- **The plant was sized by that optimism.** Now it grows at most half as much
  again as it is already serving — a fast year for an operation and an
  absolute limit for one.
- **One year of lookahead cannot see compounding**, which is the whole game.
  Brand bought now pays by making next year's brand cheaper. Rolling a second
  year forward — holding the same plan, one more run of the engine per
  candidate — moved survival from 76% to 81% on its own, and it is the single
  largest step in the table.

It decides 16 of the game's 72 levers against the survivor's 40 and beats it
anyway, which says the other 56 are worth less than knowing what a year is
worth.

What it is worth now is what a benchmark is worth. It is deterministic, it
coordinates all five seats, and `test/unit/optimiser.test.ts` holds the
properties that make it one — same plan twice, spends only what the company
could raise, prices against the market, keeps a year of costs back, and puts
money into the product that a one-year objective never would.

### A loyal segment is not loyal, it is sealed

Found underneath the fix, and it is the next thing.

Appeal is a weighted geometric mean of scores that cannot exceed one, so the
gap between a near-perfect company and an ordinary one tops out around **0.19**.
The tolerance a rival has to beat before anybody even considers moving is
`0.06 + loyalty * 0.34` — a span of 0.06 to **0.40**.

```
segment              loyalty  tolerance   best gap   churn
Swipers                 0.15      0.111      0.125    2.4%
The recently single     0.22      0.135      0.155    3.2%
The long-haulers        0.86      0.352      0.192    0.0%
```

A segment at loyalty 0.86 is not hard to take. It is impossible: no company
that could exist can produce a gap that clears its tolerance. And even the
flightiest segment in the game only ever leaks 2.4% a year.

It went unseen because the double-count left a tenth of every segment
unclaimed, so a challenger took those instead and the door looked open. The
test that guards this — "a moat that never leaks is a wall, and a wall makes
the game unwinnable" — was passing for the wrong reason, and now measures the
mechanism it names against an appeal gap big enough to show it.

**Recalibrating the tolerance to the reachable range was tried and is not in.**
At `0.02 + loyalty * 0.13` a great company takes about 6% a year from the most
devoted segment and 14% from the most flighty, which is the door the comment
asks for. It also hands every one of the seven markets to the premium play,
because once customers can actually move, the best offer wins and being
excellent is underpriced. Four separate levers were tried against that — the
price licence, the headroom on gains above the midpoint, the tolerance itself
and the appeal exponent — and premium swept all seven at every setting.

So the order is: **make excellence cost what it is worth, then open the door.**
Not the other way round, which is what was attempted here.

### What is not done

**The long tail of "year" still says year.** The survey found roughly 200
sites outside the engine that read `year` as a year. Most are now correct by
construction — one decision row per period, one report per period, which is
what a quarterly season should have. Three groups are not, and are the next
work:

- **Year-denominated thresholds in shared, outside the engine**: `entrants.ts`
  (`year < 3`), `mergers.ts` (`year >= totalYears`), `recovery.ts`
  (`COVENANT_YEARS` counted in ticks), `criteria.ts` (`DRIFT_PER_YEAR`),
  `treasury.ts`, `finance.ts`, `projection.ts`, `assets.ts` (asset life
  decremented per tick), `challenges.ts`, `forecast.ts` (`year <= 2`). Each is
  a lag or a rate measured in years being applied per period.
- **Two unique constraints that were sized as "once a year"**:
  `sim_offers_once (from, to, year)` and `sim_recovery_once (venture, year)`.
  Under monthly cadence these become "once a month", which is a 12x behaviour
  change rather than a rename, and probably wants a decision rather than a fix.
- **The wording.** Roughly 40 client files and a dozen server strings say
  "Year N", "each year lasts", "one real day is one year of trading".
  `PERIOD_NAME` in `cadence.ts` exists for this and is used in two places.

**Past insolvency the cadences legitimately diverge**, and they should — a
quarterly table sees the hole two quarters sooner and reacts to it, which is
most of what the extra $6 a seat buys. The invariant is therefore asserted
over one year, not six. A six-year run of a plan that goes broke still shows
large gaps; that is the game working, not the arithmetic failing.

**The clock in `simulation-tick.ts` still ticks annually.** Nothing reads a
season's cadence to decide when the next deadline falls, so a quarterly season
is period-aware in the engine and still yearly on the calendar. That is the
next piece.

## Niches a company goes and finds

A market is written with three or four segments, and that is a useful lie.
Real markets have dozens, and most of them did not exist until somebody went
looking: a company notices that a slice of a segment wants something slightly
different, names it, builds for it, and for a while owns it because nobody
else is even describing those people as a group.

The marketing seat can now do that, from year five. What it finds is the
people who want what the company is *already* good at — measured against the
middle, so a company strong on quality and weak on brand finds people who care
about quality and not about brand. The advantage is earned rather than
granted: a company that is middling at everything finds a corner barely
different from the segment it came from, which is the honest outcome.

Three things the arithmetic holds, each with a test:

- **The buyers come from somewhere.** A niche is carved out of a segment that
  already exists. Opening one does not invent demand; it describes part of the
  market more precisely than anybody else.
- **Never most of a segment.** However many niches are found inside one,
  most of it stays people who were not looking for anything in particular.
- **The run at them closes.** For three years rivals are worth less to those
  people because they have a product for the segment, not for the corner of
  it somebody named. Then it is an ordinary segment that happens to suit you.

### How it lives on the world

The market is rebuilt from code every year so balance edits reach seasons
already running, which would wipe anything a season invented. So opened
niches live on the world and are composed back onto the market in
`resolveYear` — which turned out to be the one place the engine reads it
(`const { niche } = world`). Everything downstream, all forty-odd things that
walk the segment list, sees them without knowing they are new.

### What it does, measured

Traced against the same company without one: the year after opening, +25%
revenue and +8,700 customers — **and 30,077 people turned away**, because
capacity could not serve them.

That is the right answer rather than a disappointing one. Finding a niche
creates demand, and demand the operations seat has not built for is people who
tried you once and tell others. It is the marketing-and-capacity interlock the
whole game is built on, arriving at the moment a table feels cleverest.

Bots do not open niches, for the same reason they do not choose a programme or
an improvement: it costs a year of research money and commits the company to a
corner of the market for the rest of the season, which is a decision about
what this company is *for*. So the balance harness is unchanged at 68%.

### Two tables, one idea

Teams in the same season look at the same market, and the good ideas in it
are not infinite. As first built, two tables who thought of the same thing
would each be handed a private corner *and a head start against each other* —
which is the same niche twice, and nonsense to anybody who met the other team.

It is settled in two passes, and the split between them is the point.

**The arithmetic decides the same people.** Same segment, wanting the same
things within a tolerance, at about the same price — that is measurable, so
`mergeSimilar` decides it and needs nobody's opinion. It runs at the end of a
year rather than when a niche is filed, so whoever went first gets a year of
it being theirs before finding out somebody had the same idea. The first
opener keeps the naming; the other is recorded as having found the same
people; and neither has a head start on the other, though everybody else
still has to catch up.

**Nova decides the same idea.** What arithmetic cannot see is two niches a
little apart numerically and obviously the same thing to anybody reading them
— "Weekend players" and "Casual Saturday users". Only the borderline pairs are
read: ones the engine already merged need no opinion, and ones far apart on
every axis are not close calls whatever they are called. That is a handful of
short questions a season, not one a year.

It cannot run inside the engine — `resolveYear` is a pure, deterministic
function and a model call is neither — so it lives in `server/nova-niche-review.ts`
and produces exactly the shape `mergeSimilar` does. The engine cannot tell
whether a merge came from arithmetic or from judgement, which is what keeps
seasons replayable.

The rule it is built to: **being wrongly told your idea is somebody else's is
worse than being wrongly left with your own**, because the first takes
something away. So an unreadable answer, an out-of-range pair, or any
uncertainty leaves both niches alone, and the prompt says so.

### The desk shows it

A table that spent a year's research on this had nothing on screen saying what
they bought. There is now a card answering the three things they ask in order:
who these people are and how many are yours, how long the run at them lasts,
and — said plainly rather than buried — whether somebody else has turned up in
the same corner.

### Still owed on niches

- **Rivals copying a good one.** The head start fading is the timer; nothing
  yet makes an entrant or an incumbent *aim* at a niche somebody proved.
  `entrantsFor` already aims newcomers at whatever is working, so this is a
  short step from here.
- **A second niche.** One per company per season at the moment.
- **What a failed company leaves behind** — its niche, or a patent worth
  buying. Needs the failure event first.
- **The desk does not show it.** The lever is there and the choice is real,
  but nothing on the screen tells a table what their niche is doing.

## A market that notices you

The cast used to be fixed: the incumbents a market was written with, the
tables that joined, and nobody else for fourteen years. That was the biggest
thing missing from a market feeling alive. In the real world the force that
punishes a company for getting comfortable is usually not an existing rival
moving — it is somebody new arriving because the margins looked good from
outside, and the loudest signal a market sends is somebody having just entered
it and done well.

`shared/simulation/entrants.ts` watches three things: demand nobody served,
how far above cost the people here are pricing, and whether a newcomer has
just taken real share. When it adds up, somebody turns up — aimed at whatever
just worked, which is what copying a niche means.

Four rules it is built to, each of which is the reason it is not annoying:

- **They start from nothing.** No customers. Handing an entrant share would
  take it from the people playing, which makes doing well a punishment rather
  than a consequence of it.
- **At most one a year.** A market that gains three companies in a year is a
  gold rush, and a season of gold rushes is noise. One arrival is something a
  table notices, talks about and can answer.
- **Not before year three.** A table that meets a new rival in year one has
  not done anything to attract one.
- **Deterministic.** Seeded on the season and the year, so a season replays
  exactly and "where did they come from" has an answer.

Measured across the seven markets: an arrival every two or three years in an
attractive one, the first around year three to five, and none at all in a
market where nobody is doing anything. Overall survival is unchanged at 68% —
and the runaway ceilings came down, which is the point: dating apps' best
season fell from £275m to £213m and MMOs from £349m to £325m, because a
company running away with a market now attracts company.

`roomFor` scales with the market, so this is also the first piece of the
small-market answer: a £2m market Nova wrote for one business supports a
handful of companies, not a dozen.

### The rest of the living market, in the order it should come

Recorded rather than started, and this is the sequence they depend on:

1. **Weights drift as a market matures** — price sensitivity and loyalty rise
   as a market commoditises. Independent of everything else and small.
2. **Price wars** — rivals answering each other's prices rather than each
   responding to the market alone. Needs entrants first, because a price war
   between a fixed cast is just a slow slide.
3. **Niches as things companies make** — targeting one, creating one, rivals
   copying a good one. The richest idea and the deepest change: 45 places read
   the segment list assuming it never changes.
4. **Failure and what it leaves** — a company going under, and its patents or
   its niche coming up for sale. Needs entrants and niches.
5. **Quarters and months** — 4 or 12 periods a year, at $6 and $10 a seat,
   with a developer bypass. Independent of all of the above and the largest
   plumbing job: the year is the atom in about thirty places, and every rate,
   lag and threshold has to scale per period.

## Bots that make the decisions a person makes

Asked for: a difficulty above the warm body, so a table learning to enter a
market can watch somebody do it.

`BotSkill` is the setting — `filler` is what bots have always been, `survivor`
is a company actually trying — and it lives on the season, so a season for
people learning can ask for rivals worth learning from.

Three levers decided it, and all three were ones no bot had ever touched
deliberately. A bot's price was last year's number nudged twelve per cent,
which meant the most powerful lever in the game was the one nobody in a bot
company ever pulled.

- **What to charge** (`bestPrice`): share against the companies actually in
  this market, times what each customer is worth, maximised. Not a discount
  rule — against weak rivals it comes back *above* the going rate.
- **Who to aim at** (`bestSegment`): a newcomer opens with brand 8 against
  quality 38 and service 40, so it should sell to the people who care least
  about being unknown.
- **Where to sell** (`regionsWorthKeeping`): one region the chosen segment is
  concentrated in beats four the company is invisible in.

Measured over 112 seasons, filler against survivor on identical code:

| | filler | survivor |
|---|---|---|
| Survived | 71/112 (63%) | **76/112 (68%)** |
| Podcasts, median end | £25.0m | **£51.1m** |
| MMOs | £14.4m | **£24.9m** |
| Project management | £25.0m | **£31.6m** |
| Construction, survived | 3/16 | **5/16** |

Better in five markets, level in two, and nothing worse.

### Two things the measuring taught that are worth keeping

**Discounting barely works in this engine, and that is deliberate.** Appeal is
flat below the reference price: `priceScore` is capped at 1.08, so cutting
price buys almost nothing while margin falls. The comment on that cap explains
why — without it "being cheap quietly outranked being good at anything". It
does mean the price lever is one-directional, which is worth knowing before
anybody tunes it.

**A weighted geometric mean needs its exponent.** The first `fitFor` took the
product of scores raised to segment weights, which is what `appealFor` does —
correctly, because it compares companies *inside* one segment, where the
weights are identical for everyone and the bias cancels. Comparing segments
against each other it does not cancel: every score is below one, so a smaller
exponent gives a bigger number, and "best fit" was always whichever segment
demanded least. It picked the same segment for a company with brand 8 and one
with brand 90. Normalising by the sum of the weights fixes it, and a test
holds it.

### What was measured and thrown away

Each of these is the obvious idea, and each made the game worse.

**Cutting price to win a foothold**: 11 in 16 down to 5. The margin goes
before the customers arrive.

**Giving a broke company a smaller factory**: 2 in 16 down to 0, in every
band. A company with £0 opens with plant sized for a tenth of its region and
pays £289,440 a year of idle rent before selling anything, which looks exactly
like the bug that dooms it. Capacity is also the ceiling on what the company
can earn, and the salary bill underneath does not shrink with it. The dial is
left in `opening.ts` with the finding written on it.

## Where a company starts, and the finance seat that would not act

Asked for: a project should be able to open a season either level with
everybody else, or where it actually is — which for most people means no
money, no credit and no customers.

`shared/simulation/opening.ts` has the model. Four bands off how far the
project has got through its path, each changing what the first year is about:
no cash and a twenty credit score at one end, a real line and paying
customers at the other. Measured on dating apps, 16 runs each:

| Opening | Cash | Survived |
|---|---|---|
| An idea, and the work so far | £0 | 2/16 |
| Building it | £0.48m | 3/16 |
| Something people use | £1.20m | 11/16 |
| Trading | £2.10m | 12/16 |

### The finance seat would not act

A bot chief financial officer files nothing for money on purpose: borrowing
and raising are decisions, and a bot inventing a loan is a bot making one
with somebody else's company. But refusing to borrow while the company runs
out of money is also a decision, and a worse one — a company opened where a
real project is, with no cash and a bot in that seat, survived one time in
sixteen. It was not losing the argument; nobody was having it.

It now draws what the year needs and not a penny more, and raises what the
credit line will not cover — which is what an early-stage founder actually
does, since a company with no trading history has almost no credit. That
alone took the zero-cash opening from 1/16 to 12/16.

And then broke everything else. A company that can always top up cannot fail:
overall survival went from 62% to 94% and five of the seven markets became
impossible to lose, which the balance harness flagged immediately. A game you
cannot lose is a slideshow. So the rescue is gated on still being investable
— investors stop at repeated missed targets, and they do not fund a company
past its first years with nobody buying anything. That lands at 66% overall,
with the five healthy markets between 69% and 88%.

### What is still wrong with starting from nothing

The raises happen and the company still dies: traced, customers fall from
18,250 to 1,393 over ten years whatever is raised. Brand opens at zero, the
marketing a broke company can afford does not hold position against churn,
and funding only delays it. That is arguably true of real startups and it is
not a good game, and "start where you actually are" is the mode somebody
picks precisely because they want the real answer.

The lever a person would reach for and a bot will not is focus: one region,
one segment, a price that buys a foothold. Until that is worth measuring, the
honest summary is that this opening is a hard mode a mediocre player loses.

### Not built yet

- **The stance is not wired up.** `opening.ts` is modelled, measured and
  tested against nothing: no column on the season, no choice on the form, no
  route that honours it.
- **A solo founder still cannot run the table.** `sim_seats` is unique on
  (venture, user), so one person holds one seat and the rest go to bots —
  including the finance seat, which is the one that decides whether a company
  with no money survives at all. A leader filing for the seats nobody holds
  is the missing piece, and it matters most in exactly the mode above.

## What a market Nova writes actually plays like

Run against a real model, with a real project. Asked about scheduling
software for small independent vet practices, it wrote a good market: 14,400
clinics in four segments at £59–£149, seven UK regions with sensible weights,
four incumbents with knocks worth aiming at, and a voice that says "practice",
"subscription" and "appointment slots". No validation problems.

And it was unplayable. The market is worth £1.65m a year; the company opened
in it with £6m in the bank — three and a half times the entire market — and a
salary bill it could never earn back. It lost money in all fourteen years and
finished £5.7m down.

Nothing was wrong with the market. Everything absolute in the engine is tuned
to the seven written by hand, which are all worth about £400m a year: six
million in the bank, £140,000 executives, £220,000 for sixteen points of
brand. In a market a two-hundredth of that size, every lever costs more than
the company can earn, so none of them do anything at any price it can afford.

So the company scales to the market (`marketScale`, `atScale`). Less in the
bank, smaller salaries, and every threshold in the money of the market being
played. The decisions and the ratios are identical — which is the point,
because the ratios are the game. Both markets tested now survive fourteen
years near break-even instead of spiralling:

| | before | after |
|---|---|---|
| Vet scheduling (£1.65m market) | bankrupt, −£5.7m | survives, ~break-even |
| Bell-ringing apps (£1.14m market) | — | survives, profitable by year 11 |

The seven are untouched, and a test holds them there. The reference is set
just below the smallest of them so every one clamps to exactly one: at £400m
it did not, and drone delivery — already the hardest — quietly lost four per
cent of its opening bank.

### Still owed on this

- **Fractional customers.** A written market produced "7,194.5 customers" in
  a report. Cosmetic, and it gives away that nobody chose the number.
- **A written market has no balance pass.** The seven were tuned against each
  other over many seasons. A written one is one model's answer, clamped into
  range — `sim:balance` can measure one, but nothing does it automatically
  before a team plays it.
- **The route has still never been exercised end to end.** The generation and
  the play were driven from scripts against a real model; the HTTP path that
  creates the company and the season was tested with the model stubbed out.

## Two markets nearly nobody survives

Measured, not felt. `npm run sim:balance` runs the same reasonable company
many times in every market and prints what became of it. Across 24 runs each:

| Market | Survived | Median end |
|---|---|---|
| Project management | 21/24 | £23.9m |
| MMOs | 21/24 | £36.0m |
| Dating apps, Podcasts, Restaurants | 18/24 | £11–23m |
| **Drone delivery** | **11/24** | **−£0.1m** |
| **Construction** | **7/24** | **−£2.3m** |

`test/unit/balance.test.ts` passes on all seven, and is right to: every market
*can* be won and *can* be lost. A pass cannot show a distribution, which is
how two markets sat at half the survival rate of the others without anything
going red.

What is underneath it: the cost of existing is about the same everywhere by
design — five salaries and the overhead under them, because the seats are the
game. What a first year can earn against that is not. The gross profit
available at full capacity in year one runs from £0.57m to £2.36m across the
seven, and the survival rate tracks it.

Two fixes that did not work, so nobody tries them again. Giving the thin
markets more opening capacity made them **worse** — unsold plant is rent, and
a company that cannot sell what it has does not want more of it. Tuning how
hard the bots spend moved the total by one company in fifty-six, which is
noise; the constant was swept from 0.03 to 0.4 and the two markets failed at
every value.

What is left is the market content itself: drone delivery earns £15 a unit
against a £25 price, and construction sells 2,646 units a year at £900. Both
are defensible as businesses and both are thin against a flat cost base.
Changing them means editing balance that was tuned by hand against the other
five, which is a judgement about how those markets should feel rather than an
arithmetic error to correct.

## Known and deliberate

### The accounts add up, and are tested to
`pnl.capacity` used to include the plant, which `pnl.operations` already
carried — so the report's cost column charged the company twice for automating
it, running a second shift or holding stock, while the profit printed
underneath counted it once. Anyone adding up the column got a different number
from the one below it. The capacity line is now room only, the five cost lines
that were computed and never rendered (capacity, incidents, partner share,
insurance) are on the screen, and planning sits on its own signed row because
it is an effect rather than a cost. `test/unit/depth.test.ts` asserts the
identity — sales, less every line, plus planning, is the profit — so it cannot
drift again.

### A fifty-company season costs nothing to speak of, and none of them fail
Measured: `npm run sim:scale` runs fourteen years of a season at 1, 10, 25 and
50 bot companies and prints what each cost. Fifty companies × fourteen years is
about three quarters of a second of engine time in total, with the worst single
year — the one held inside a transaction — under 100ms. Going from 25 companies
to 50 costs about 1.5x the time, so the resolve is under linear in companies
and fifty is nowhere near a limit. The script exits non-zero over its budget,
so it can be a gate rather than something somebody remembers to run.

One thing it turned up that is not a performance question: at every size, every
bot company was still solvent after fourteen years. Bots never fail. Whether a
season of rivals that cannot go under is the rivalry we want to sell is a
balance question, and nobody has asked it yet.

### The meter counts a region that may never open
Operations putting the announced region up adds its cost to the table's
commitment straight away, before the vote. The table may vote it down and the
money stays. Overstating what a year might cost is the safe side of a meter
that exists to stop a company filing a year it cannot pay for, so both the web
and the phone count it that way — but it is a choice, not an oversight.
