# Generated advertisements

The video model is Kling. This is what was verified against a real key, what
is still a guess, and the rule the whole feature is built on.

## The rule

**The model never draws the product.** Video models distort logos, garble text
and change a product's shape between frames, and no business will publish an
advert in which their own thing looks wrong. So:

- The generated clip is **background and motion only**.
- The product comes from the **business's own photographs**, composited in.
- Every word on screen — price, offer, call to action, legal line — is
  **rendered in code** from text we hold, never generated as pixels.

Anything that breaks this is a bug however good it looks. The failure mode is
not "ugly", it is "a company's product misrepresented in their own advert".

## What is set up now

| | |
|---|---|
| `shared/ads.ts` | Formats, durations, the beats of an ad, the cost model, the compliance checks |
| `server/kling-client.ts` | The provider: config, auth, submit, poll, stub |
| `shared/env-requirements.ts` | Declares the keys, so a boot without them names the feature |

Not built yet: the brand kit, the compositor, the script writer, captions, the
render queue, and the ledger that records what each finished ad cost.

## Verified on 2026-10-05, against the trial key

```
POST /v1/videos/text2video
  { model_name: "kling-v2-5-turbo", prompt, duration: "5",
    aspect_ratio: "9:16", mode: "std" }
→ { code: 0, data: { task_id, task_status: "submitted", created_at } }

GET /v1/videos/text2video/{task_id}
→ data.task_status: submitted → processing → succeed     (~35s for 5s of video)
→ data.task_result.videos[0] = { id, url, duration: "5.041" }
```

- Base host: `https://api-singapore.klingai.com`
- Auth: a **static bearer key**, on the **`/v1/` routes**

That last line matters. Both sets of public documentation describe auth and
routes as one choice — "the old API signs a JWT and uses `/v1/`, the new one
uses a static key and a path per model" — and this account is neither. They are
two independent axes and the client models them separately; `KLING_AUTH` and
`KLING_ROUTES` override either. Conflating them is what made the first version
of the client wrong, in a way that would have looked like a rejected key.

## The model name is the thing that will break

Five of the six names published in the documentation and in community wrappers
were **already discontinued** on a key issued the same week:

| Name | Answer |
|---|---|
| `kling-v1` | 1203 — discontinued |
| `kling-v1-6` | 1203 — discontinued |
| `kling-v2-master` | 1203 — discontinued |
| `kling-v2-1-master` | 1203 — discontinued |
| `kling-v2-1` | 1201 — model is not supported |
| **`kling-v2-5-turbo`** | **accepted** |

So `KLING_MODEL` exists, and the default is the one that worked. When a render
starts failing with a 404, read the message: Kling says which of the two it is,
and a rejected model **costs nothing**, so probing for the current name is
free. Only an accepted submission spends a unit.

## Cost, and the trial

The trial key has roughly **50 generation units** and allows **5 concurrent**
renders. One submission that is accepted is one unit; a rejection is free.

`AD_COST` in `shared/ads.ts` holds the per-second figure, the attempts-per-
finished-ad multiplier and the render overhead. `attemptsPerFinished` is 3 and
is a **guess** — it is one number in one place precisely so it can be corrected
from real data rather than hunted for. Until there is a ledger, nobody knows
the true cost of a finished ad, and that is the number the business depends on.

`duration` is a string, and only `"5"` or `"10"` — the model's clip lengths,
not the ad lengths. A thirty-second ad is composed from several clips; nothing
ever asks the model for thirty seconds.

## Developing without spending anything

`AI_STUB=1` short-circuits both submit and poll before any request is made,
with or without a key present. The stub's video URL is `stub://…` on purpose:
a plausible `https://` URL would be fetched by the next stage and produce a
silently empty advert instead of an error.

A real generation during development is a real unit. With a trial of fifty,
treat each one as a decision.
