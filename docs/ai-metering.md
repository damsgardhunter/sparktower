# AI metering: burst limits, credits, and what a failure costs

Every AI route passes through `requireCredits` in `server/entitlements.ts`. That one call is the burst limit, the credit check and the fair-use cap; nothing else has to remember to add them.

## Burst limit
- Action `ai` in `shared/moderation.ts`: **30 requests per 10 minutes per user**, hit-counted in `rate_limit_hits`, durable across instances. `requireCredits` calls `enforceRateLimit(res, userId, "ai")` first; a refusal is a 429 with `code: "rate_limited"`, the action, and `Retry-After`.
- The write floor (`write`, 240 per 10 minutes) applies on top, like every other write.
- Unlimited-credit tiers still hit the fair-use cap (`FAIR_USE_MONTHLY_CAP`), answered as 429 `fair_use_limit`.
- AI that's an optional extra on a free route (Nova's match reasons) uses `reserveOptionalAi`: the same credit check and burst limit, but a refusal skips the AI part instead of refusing the request.

## Credits
- Costs per route are in `CREDIT_COSTS` in `shared/plans.ts`. A route names its cost when it calls `requireCredits` and deducts exactly that with `storage.deductCredits` afterwards — by name, never a literal.
- A model's cost is not the user's cost: the tier's model is chosen by `modelFor(ent)`; credits are per action, whatever model ran.
- Not enough credits is a 403 `insufficient_credits` with the cost and what's left.

## What a failure costs: nothing
- The check runs before the model call; the deduction runs **after the model answered and its answer parsed**. A model error, a timeout, an empty answer or an unreadable one is never charged.
- Unreadable responses go through one parser, `parseModelJson` in `server/ai-json.ts` (fences stripped, outermost object or array found). When nothing parses it throws `ModelResponseError`, answered as **502 `model_unreadable`**.
- Chat replies are prose by design. An **empty** reply is a 502 `model_unreadable`, uncharged. Nova's `<project_update>` block is optional: it's always removed from what the user reads, and a malformed one means no update that turn, not a lost reply.
- Model errors surface as 5xx; the user is told to try again and keeps their credits.
- Model output is never defaulted to `"{}"` or `"[]"` before parsing. An empty answer then read as a valid empty result and was charged; now it takes the unreadable path like any other bad answer.

## How it's enforced
- **From the source, every run** — `test/unit/ai-metering.test.ts`, on the same route scan the audit uses (`server/route-coverage.ts`, which reads each route to its matching bracket):
  - every AI route calls `requireCredits` (or `reserveOptionalAi`);
  - the check comes before the model call; no charge comes before it, before its answer is read, or in a `catch`;
  - a route that charges inside a helper names the helper, and the helper is held to the same rule;
  - amounts are `CREDIT_COSTS` names, and a charge equals what was checked.
- **On the running app** — `test/integration/ai-metering-sweep.test.ts` calls every AI route with a model that throws, one that answers with nonsense, and one that answers with nothing: nothing is charged when the model throws or answers empty, and nothing is charged when a route answers with an error.

## The exceptions, each written down in the unit test
- `POST /api/mock-interviews/:id/finish` — the closing verdict is **free**: the interview's questions were paid for. It runs **once**; finishing again returns the stored verdict. It stays on the AI burst limit.
- `POST /api/documents/:docId/fill` — checks the estimate and charges the blocks actually filled, which can't be more.
- `POST /api/mock-interviews/:id/answer` — grading is checked up front; the follow-up question is checked and charged on its own, after it's generated.
- `POST /api/reputation/calculate` — charged (`reputationEvaluation`) only when Nova actually scored the strategic-thinking part; with no projects or a failed call that part is an estimate, and free. It used to be charged first, whatever happened.
- `POST /api/projects/:id/generate-video` — charged only when the scenes are Nova's. Unreadable scenes fall back to generic ones, shown but not billed; the response says `creditsCharged`.
- `POST /api/sprints/:id/advance` (practice sprints) — Nova's answers are an optional extra (`reserveOptionalAi`), written only for ideation and charged only once they're saved. It used to be charged up front on every phase.

## Streaming
The only streaming chat routes were unmounted Replit scaffolds and have been removed. Nova's chat is a normal request that is metered like the rest.
