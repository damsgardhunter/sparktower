# The simulation: what is built, and what is owed

Kept because this work has run across many sessions and several people, and
"we said we'd do that" is not a plan. Anything deferred deliberately is here
with the reason. Anything here that stops being true should be deleted rather
than ticked.

## Owed, and why it was deferred

### The table votes on where to expand
Asked for: expansion should stop being the marketing seat's unilateral call and
go to the whole table each year, with each person's profile image shown against
what they voted for.

Not built yet. The mechanism exists to copy — the chief executive's `deals`
lever has a "put it to the table" answer and the other four seats have
`dealVotes` (see `shared/simulation/levers.ts` and `dealOutcome` in
`shared/simulation/world.ts`) — so this is a new lever pair plus the avatars on
the desk, not new machinery.

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

### Fifty companies in one season has never been measured
`botTeams` allows up to fifty. A year resolves every company in one pass inside
one transaction, and nobody has run a fourteen-year season at that size. Do it
before anyone is charged for it.

### The phone has not caught up
The new desk fields (a region's continent, whether the company is foreign
there, whether it can be entered at all) and the two Past-tab cards are web
only. `mobile/src/components/sim/*` mirrors the maths and the drift tests keep
it honest, but the screens are not there.

### Paying for a simulation
Five dollars a seat is built end to end — the gate, the checkout, and the
webhook that credits the seats against a ledger keyed on the Stripe session so
a redelivery cannot credit twice.

What is still owed: nothing decrements. A season does not consume seats, a
refund does not take them back, and there is no way for a company to see what
it has bought beyond a count. Decide whether a seat is consumed by a season or
simply held before building any of that.

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
