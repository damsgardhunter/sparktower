# What this sells for, what it costs, and what a user is worth

At **2¢ a credit**. Supersedes the plan-ladder half of `ai-margins.md`, which
priced subscriptions the product no longer has.

Every price here is read from `OUTCOME_PRICE_CENTS` and `SEAT_PRICE_CENTS`.
Costs are measured where `ai-margins.md` measured them and modelled at 2¢ a
credit where it did not — each row says which, because the difference between
the two is the whole argument.

## The price list, against what it costs to serve

| Item | Price | Cost | Gross | Margin | Basis |
|---|---|---|---|---|---|
| A seat in a season | $3.00 | $0.00 | $3.00 | 100% | no model call |
| Post a challenge | $4.99 | $0.00 | $4.99 | 100% | no model call |
| A market Nova writes | $10.00 | $0.06 | $9.94 | 99% | one large call |
| A marketing scheme | $6.00 | $0.12 | $5.88 | 98% | 6 credits |
| A roadmap | $3.00 | $0.06 | $2.94 | 98% | 3 credits |
| Decision simulations | $3.00 | $0.05 | $2.95 | 98% | one call, reruns free |
| What would it take | $3.00 | $0.10 | $2.90 | 97% | 5 credits |
| A document plan | $3.00 | $0.10 | $2.90 | 97% | fills free after |
| A logo and cover | $1.00 | $0.08 | $0.92 | 92% | 2 images |
| 25 more actions | $5.00 | $0.50 | $4.50 | 90% | 25 credits |
| A codebase audit | $5.00 | **$0.57** | $4.43 | 89% | **measured** |
| A day of images | $5.00 | $0.80 | $4.20 | 84% | ~20 images — *see below* |
| Build my business | $14.99 | $2.40 | $12.59 | 84% | 40 steps, capped |
| An extra person | $6.00 | $0.00 | $6.00 | 100% | no model call |

Two things worth saying out loud.

**The codebase audit costs 28× what its credit count implies.** It is charged
8 credits and measured at $0.57 — so `CREDIT_COSTS × 2¢` says $0.16 and the
bill says $0.57. `plans.ts` is explicit that the credit number is presentation
only, and this is what that means in money. At $5 à la carte it is healthy;
inside any bundle it is the line that eats the bundle.

**The seats are the best thing on this list.** $3 and $6 for no model call at
all: the market is arithmetic, and arithmetic is free. A season that sells ten
seats is $60 of pure margin.

## What an active user pays in a month

Four groups, with a distribution that assumes most people never pay — which is
what a free allowance of 25 actions a month is for.

| | Share | Gross | Stripe | Serve | **Net** |
|---|---|---|---|---|---|
| Never pays | 60% | $0.00 | — | $0.50 | **−$0.50** |
| Dabbler — a roadmap, a simulation | 25% | $6.00 | $0.47 | $0.61 | **$4.92** |
| Builder — roadmap, 2 docs, an audit, a market, a pack | 12% | $29.00 | $1.44 | $1.89 | **$25.67** |
| Founder — the $14.99 build, 2 audits, a market, marketing, images, 4 seats | 3% | $67.99 | $3.17 | $6.02 | **$58.80** |

**Blended: $7.02 gross, $5.77 net per active user per month.**

Stripe is 2.9% + 30¢ and is charged on the *top-up*, not the purchase, because
the balance model batches it. That is worth real money at these prices: a $1
logo bought directly would net 67¢, but bought off a $20 balance it nets 92¢.

The free tier costs about **50¢ a month per active user** and it is not free to
give away. At 10,000 actives, 6,000 of whom never pay, that is **$3,000 a month
of allowance**, which the other 4,000 have to carry. They do, comfortably.

## What that is worth at scale

| Active users | Gross / mo | Net / mo | Net / yr |
|---|---|---|---|
| 100 | $702 | $577 | $6,900 |
| 500 | $3,510 | $2,887 | $34,600 |
| 1,000 | $7,020 | $5,773 | $69,300 |
| 5,000 | $35,099 | $28,866 | $346,400 |
| 10,000 | $70,197 | $57,732 | $692,800 |
| 50,000 | $350,985 | $288,661 | $3,463,900 |

*Active* means somebody who opened it that month. Registered-but-dormant costs
nothing, and should not be counted here.

**Roughly: 1,000 actives is a living. 10,000 is a company. 50,000 is a
business** — and none of it needs a price rise, only more people.

## The one thing that can lose money in a night

The image pass is $5 for 24 hours, capped at 50 images an hour.

| Images in the day | Cost | On a $5 sale |
|---|---|---|
| 20 — typical | $0.80 | $4.20 |
| 100 — heavy | $4.00 | $1.00 |
| **1,200 — the cap, sustained** | **$48.00** | **−$43.00** |

`plans.ts` already says this in its own comment: at this model's prices an
unbounded "unlimited" is the one thing on the price list that could cost more
in a night than everything else earns in a month. The hourly cap is what stops
it being unbounded; it does not stop it being negative.

Nobody makes 1,200 images by hand. A script does it by accident, and one
determined person could do it on purpose for $5. Three ways to close it, in
order of how little they cost the honest user:

1. **A daily ceiling as well as an hourly one.** 150 a day keeps every real
   user whole and caps the worst case at $6.
2. **Price the pass at what a heavy day costs** — $8–10 rather than $5.
3. **Charge per image past a threshold**, which is the honest version but adds
   a meter to the one product sold as not having one.

Recommendation: the daily ceiling. It is invisible to everybody who is not
attacking it.

## What the numbers rest on

- **2¢ a credit**, blended. The measured mix was 2.17¢ on a real working day
  and the blend is genuine, but the variance is not: a chat turn is 1.4¢ and
  an audit is 57¢. Any bundle has to be priced against the audit.
- **~4¢ an image**, `gpt-image-1` at a standard size. The one number here not
  measured in this codebase, and the one the image-pass row turns on.
- **The mix**, which is a guess. 60/25/12/3 is a reasonable shape for a
  freemium tool and nothing more — `ai_spend` has two rows in it today, so
  there is no evidence yet either way. Every figure below the price table moves
  with this and should be recomputed once a month of real traffic exists.

The price table itself does not depend on the guess. Those margins are real.
