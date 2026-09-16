# Nova prompt packs v1 — how the plans are judged

A prompt pack is easy to change and hard to judge. The questions it asks decide
every plan written afterwards, so changing one is a product change, and "it
reads well" is not evidence. This is the cheap harness: five inputs per live
pack, run against the real model, read by a person against a rubric.

Run it:

```
npx tsx --env-file=.env script/nova-evals-v1.ts          # readable
npx tsx --env-file=.env script/nova-evals-v1.ts --json   # machine-readable
```

Five model calls, no database writes. The cases live in the script, so the
inputs are versioned with the pack they judge.

## The rubric

Each plan is scored 1–3 on three things. A pack ships at **live** when every
case scores 2 or better on all three, and no case scores 1 anywhere.

| | 1 — no | 2 — yes | 3 — notably |
| --- | --- | --- | --- |
| **Clarity** | Steps are categories ("marketing", "design") or restate the goal | Each step is one thing a person starts and finishes | A stranger could do the step without asking what it means |
| **Specificity** | Could be pasted into any project of this kind | Uses what the builder actually said | Names their situation back to them in a way that changes the order |
| **Feasibility** | Assumes things they don't have, or a month of work before anything exists | Startable today, in an order that unblocks itself | Getting the missing thing is its own step, placed where it's needed |

## v1 · `ship_mvp:website` — live

Run 16 Sep 2026 · model `gpt-5.2` · 5/5 readable.

| Case | What it tests | Clarity | Specificity | Feasibility |
| --- | --- | --- | --- | --- |
| 1 · freelancer with proof | The straightforward case | 3 | 3 | 3 |
| 2 · no proof yet | Proof has to be earned, not faked | 3 | 3 | 3 |
| 3 · answered nothing | Every question skipped | 3 | 2 | 3 |
| 4 · two actions | Two competing actions | 3 | 2 | 2 |
| 5 · blocked on a domain | Needs something they don't have | 3 | 3 | 3 |

**Case 1.** Put the booking flow first ("everything else points to this"), then
the live URL, then the copy. Split "proof you can publish now" from "ask two
clients for testimonials" — which is exactly the distinction the `proof`
question is there to draw. Named the price question because the builder said
the page has to state what they charge.

**Case 2.** Didn't invent social proof. The plan's proof step is running it for
one postcode for a week, which is what the builder said would convince them.

**Case 3.** With no answers at all, the first step is deciding the single action
and writing it in one sentence — a reasonable move, and it says what it's
assuming. Specificity 2 rather than 3: it's a good generic studio-booking plan,
which is the honest ceiling when nothing was answered.

**Case 4 — the known weakness.** The builder wanted two actions. The pack's
guidance says one action decides the page's shape, and the plan should have
picked one and sequenced the other. Instead it planned both, with a primary and
a secondary CTA, and built the free-list flow before the page existed. Not
wrong, but it's the pack accommodating the builder rather than advising them.
**v2 candidate:** make the `action` question refuse two answers — "if you named
two, which one would you keep if you could only have one?" — and say in the
guidance that a second action is a step *after* the first one converts.

**Case 5.** The missing domain became its own step, placed fourth: the page
exists on a temporary URL first, so the work isn't blocked waiting for it.
That's the behaviour the feasibility row is asking for.

### What v1 is not

Only `ship_mvp:website` has been evaluated. Every other goal and subcategory
falls back to the generic pack (`status: "stub"`), which asks four general
questions and produces a plan that is usually reasonable and never tailored.
The route reports the pack's status, so a caller can tell which they got.

When a stub is written up into a pack, it needs its own five cases here — at
least one where the builder answers nothing, and one blocked on something they
don't have, because those are the two that separate a real pack from a prompt.
