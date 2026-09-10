# AI metering: burst limits, credits, and what a failure costs

Every AI route passes through `requireCredits` in `server/entitlements.ts`. That one call is the burst limit, the credit check and the fair-use cap; nothing else has to remember to add them.

## Burst limit
- Action `ai` in `shared/moderation.ts`: **30 requests per 10 minutes per user**, hit-counted in `rate_limit_hits`, durable across instances. `requireCredits` calls `enforceRateLimit(res, userId, "ai")` first; a refusal is a 429 with `code: "rate_limited"`, the action, and `Retry-After`.
- The write floor (`write`, 240 per 10 minutes) applies on top, like every other write.
- Unlimited-credit tiers still hit the fair-use cap (`FAIR_USE_MONTHLY_CAP`), answered as 429 `fair_use_limit`.

## Credits
- Costs per route are in `CREDIT_COSTS` in `shared/plans.ts` (task planning 4, roadmap generation, audits, investor tools, document work, path work, and so on). A route names its cost when it calls `requireCredits` and deducts exactly that with `storage.deductCredits` afterwards.
- A model's cost is not the user's cost: the tier's model is chosen by `modelFor(ent)`; credits are per action, whatever model ran.

## What a failure costs: nothing
- The check runs before the model call; the deduction runs **after the model answered and its answer parsed**. A model error, a timeout, or an unreadable response is never charged.
- Unreadable responses go through one parser, `parseModelJson` in `server/ai-json.ts` (fences stripped, outermost object or array found). When nothing parses it throws `ModelResponseError`, answered as **502 `model_unreadable`** by the route or the global handler.
- Model errors surface as 5xx from the route's own handler; the user is told to try again and keeps their credits.

## Streaming
The only streaming chat routes were unmounted Replit scaffolds and have been removed. Nova's chat is a normal request that is metered like the rest.
