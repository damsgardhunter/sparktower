# Playing a season Nova built from your project

A guide for the person sitting at the desk.

Nova reads your project and writes a market around it: the people who would buy
from you, split into segments; the regions they live in; and four companies who
already have them. You then run a company in that market for a set number of
decisions — a year each, or a quarter, or a month, depending on what you chose.

This explains how the market actually decides things, so you can plan against
it rather than guess at it. Every number here is the number the engine uses.

---

## The one paragraph that matters

**Customers are not bought. They are won, one segment at a time, from a pool.**

Each period, everybody in a segment is in one of three groups: still with their
supplier, with no supplier at all, or just left somebody. Only the last two are
available, and they are divided between companies by *appeal squared*. Your
appeal is scored separately in every segment, because every segment weighs
things differently.

So there is no spending that "gets customers". There is only being a more
appealing offer than the company they are currently with, to people you can
actually reach, with enough room to serve them when they arrive.

---

## How appeal is worked out

Four things are scored: **price, quality, brand, service**. Each is raised to
how much that segment cares about it, and then they are **multiplied together**
— not averaged.

That multiplication is the whole design. A factor a segment does not care about
contributes roughly 1 and drops out. A factor it cares about deeply can sink
the entire offer on its own, and no amount of the other three rescues it.

Two more things sit on top:

- **Reputation is a multiplier, not a fifth axis.** It runs from 0.55 to 1.0
  and multiplies everything. A company nobody trusts gets less credit for every
  claim it makes.
- **Expectations are a floor.** A segment has minimum standards. Falling below
  one costs about 2% of appeal per point short, weighted by how much that
  segment cares.

### Price has a ceiling and a trapdoor

Being cheaper helps, and stops helping at **1.08** — a shade above parity. You
cannot discount your way past a company that is simply better, because every
other axis tops out at exactly 1.

Below **60% of the going rate** it reverses: price starts reading as a warning
rather than a bargain, most sharply to the segments buying on quality and on
being looked after, who know what those cost to provide.

**And raising your price now costs you customers.** Not because the new price
is high — that is judged separately — but because putting a price up is an
event the people already paying it notice. A loyal segment forgives it; a
flighty one leaves over it.

---

## The three hard limits

Before any strategy, three things cap what is possible. Each of them is absolute.

### 1. You cannot win anyone in a region you have not opened

Reach is a ceiling, not a handicap. If you sell in one region holding 9% of the
market, 9% is the most of that market you can ever hold, however good you get.
Opening a region costs money once and costs more to run for ever.

**A region opened this period is reached only as far as your brand carries** —
`brand / 60`, with a floor of 15%. Opening a second region with a brand of 20
reaches a third of it in the first period. Expansion rewards companies that are
already known.

### 2. You keep only what you can serve

Win more than your capacity and the rest are turned away — which costs
reputation, not only revenue — and they **spill to whichever rival has room**.
Under-building does not waste an opportunity. It hands it to a competitor.

### 3. Building room takes a year, and none of it arrives in the period you ask

Ask for capacity and you get a **quarter of the increase each quarter** (a
twelfth each month), arriving from the *next* period onwards. Four quarters of
asking for the same number gets you there exactly.

Cutting is immediate, and sells the room back at **30%** of what it cost.
Building costs **10% of the market's reference price per unit**; leasing is
**40% dearer** and goes back at the end of the period.

This is the single most common way a first season goes wrong: capacity is
ordered in the period it is needed, and arrives a year late.

---

## What the spending levers actually do

| lever | effect | timing |
|---|---|---|
| Performance marketing | Raises brand | Lands immediately, gone when you stop |
| TV and billboards | Raises brand | Compounds; part lands next period |
| Sponsorship | Raises brand at 1.4× ordinary spend | Immediate, does not repeat |
| New features | Raises quality | Ships next period |
| Reliability | Raises quality **and** service | The cheapest way to move two numbers |
| Research | Raises quality | Lands a period later, more per pound |
| Support | Raises service | Immediate |
| Efficiency | Cuts unit cost permanently | Pays back over periods |

Note what is *not* on that list: none of them buy customers directly. They all
move an axis, and the axis moves appeal, and appeal wins a share of the pool.

**Marketing on a product that cannot deliver buys churn.** Quality nobody has
heard of moves nothing. This is the multiplication again: both halves have to
be there.

---

## A first season, period by period

The desk gives you more levers as the season goes on, so the shape of a season
is partly decided for you. Roughly:

- **Period 1** — price, marketing, quality, reliability, support, capacity,
  headcount, borrowing, raising.
- **Period 2** — the demand forecast, leasing room, price tiers, security,
  engineer pay.
- **Period 3** — PR, referrals, data, a feature bet, training and recruiting,
  the pace you run at.
- **Period 4** — expansion into new regions, promotions, win-backs, paying a
  dividend, focusing marketing by region and segment.
- **Period 5+** — opening a niche of your own, automation, a second shift,
  stock, payment terms, refinancing.

### Period one: pick who you are for, and build for period two

Three decisions matter more than the rest.

**Declare a segment.** Positioning makes you meaningfully more appealing to the
people you declare for and slightly less to everyone else. In a market where
appeal is squared, "slightly better to everybody" loses to "clearly the right
answer for somebody". Pick the segment whose weightings you can actually
satisfy — look at what it weighs, not at how big it is.

**Set a price you can defend.** Not the lowest: the ceiling on being cheap is
1.08, and below 60% of the reference price you start losing the quality-led
segments outright. Price near the reference of the segment you declared for.

**Order capacity for period two, not for period one.** Nothing you order now
opens now. Work out what you expect to win *next* period and order that.

Spend on one axis properly rather than three axes thinly. The geometric mean
punishes a weak factor far more than it rewards a strong one, so find the axis
your declared segment weighs highest and fix that first.

### Period two: forecast, and mean it

The demand forecast arrives and it is worth real money. Within **10%** saves
about **2% of revenue** in things bought at the right volume. Out by more than
**20%** costs up to **8%**. Forecast what your *appeal* will win, not what you
hope.

This is also when price tiers arrive. They are optional. A single list price is
a perfectly good answer, and a tier is only worth setting where a segment's
going rate is genuinely different — a tier priced past what a segment will pay
stops loyalty protecting you at all.

### Periods three and four: compound something

Brand compounds; performance marketing does not. Research pays more per pound
than features but lands a period later. If your company is stable, this is when
to take the slower option — it is the only window where being behind on purpose
pays back before the season ends.

Expansion arrives in period four, and remember the ramp: a new region is
reached as far as your brand carries. Expanding on a weak brand buys rent and
very little else.

### Later: own something nobody else has

Opening a niche finds a group of customers inside a segment who want what you
are already good at. They pay a little more and are harder to shift, and for a
while nobody else is even describing them as a group — but it costs a period's
marketing, and you keep them only while you are the only one who fits.

---

## The market: five lots a period

Five things come up each period, sealed bids, highest over the reserve takes it
and pays what they bid. What they cost is scaled to your market, so a startup
market's lots are priced for a startup.

**The rivals bid too** — each incumbent takes about a one-in-ten chance on each
lot, a little over the reserve. Roughly a third of lots are contested. A bid
*at* the reserve wins only when nobody else turns up.

Each lot says what it would make *your* company — "quality 54 → 60" — rather
than what it adds in the abstract. A lot that adds room is worth knowing about
for a second reason: room from an asset is not built, so it does not wait a
year the way ordered capacity does. It counts from the moment the auction
settles.

---

## Money, and knowing when you are in trouble

**Fixed costs** are one executive salary per officer, scaled to the market's
size, multiplied by how much of the market you sell in. A company selling in
one region pays a smaller fixed bill than the same company selling everywhere —
40% of it is owed wherever you sell, and the rest scales with reach.

**You are "in trouble"** when cash plus remaining credit falls below 75% of a
year of costs, and "strained" below 150%. These are measured against *your*
costs at *your* market's scale, so a small company is not judged against a
corporation's payroll.

If you get there, the options in order of what they cost you: sell an asset
(you lose what it was doing, and a rival probably buys it), take rescue money
(a third of the company at a bad price). A seat can be dissolved at a full
table to stop a salary — that does nothing in a solo company, where one person
draws one salary however many desks they hold, so it is not offered.

---

## If you are playing solo

A solo season is one chair. You hold all five desks, every lever is yours, and
the company pays **one** executive salary rather than five — a startup is not
asked to carry $700,000 of officers it does not employ.

Levers that only mean something with colleagues are not shown: splitting a
budget between seats, setting each seat's targets, a bonus pot, overruling or
replacing a seat. You are not managing a team; you are running a business.

Everything else in this guide applies unchanged.

---

## The five mistakes a first season makes

1. **Ordering capacity in the period it is needed.** It arrives a year later.
   Order against next period's demand.
2. **Spreading spend across every axis.** The geometric mean rewards fixing
   your worst weighted factor, not nudging all four.
3. **Marketing a product that cannot deliver.** You buy people who try you and
   leave, and they cost reputation on the way out.
4. **Expanding on a weak brand.** A new region is reached as far as the brand
   carries. Below a brand of about 20 you are buying rent.
5. **Undercutting to win.** Cheap caps out at 1.08 and turns into a warning
   below 60% of the going rate. You cannot discount past a better company.

---

## Where these numbers live

Nothing here is advice invented for the guide. If you want to check any of it:

- Appeal, reach, churn and the customer pool — `shared/simulation/market.ts`
- Capacity, the build lag — `shared/simulation/lag.ts`
- Build and lease costs, the forecast bonus, the budget split —
  `shared/simulation/responsibilities.ts`
- What arrives in which period — `UNLOCKS` in the same file
- Salaries, fixed costs, a year of costs — `shared/simulation/decisions.ts`
- Distress thresholds and the way out — `shared/simulation/recovery.ts`
- The market's lots, reserves and the rivals' bidding —
  `shared/simulation/assets.ts`
- How a market Nova writes is validated — `shared/simulation/custom-market.ts`
