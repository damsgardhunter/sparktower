/**
 * Advertisements: what one is, what shapes it comes in, and what it costs.
 *
 * The generated video is the cheap part. What a business cannot do itself is
 * the layer around it — a script with a hook in the first two seconds, their
 * real product shown accurately, their colours and logo on every frame, the
 * same idea cut for three aspect ratios and three lengths, and captions
 * because most of it is watched with the sound off. That layer is this file
 * and the ones that render from it; the model only supplies moving pictures to
 * put behind it.
 *
 * ## The rule the whole feature is built on
 *
 * **The model never draws the product.** Video models distort logos, garble
 * text and change a product's shape between frames, and no business will
 * publish an ad where their own thing looks wrong. So the generated clip is
 * background and motion only; the product comes from the business's own
 * photographs, and every word on screen — the price, the offer, the call to
 * action, the legal line — is rendered in code from text we hold, never
 * generated as pixels.
 *
 * Anything that breaks that rule is a bug however good it looks, because the
 * failure mode is not "ugly", it is "a company's product misrepresented in
 * their own advertisement".
 */

/** Where an ad is going, which decides its shape. */
export const AD_FORMATS = [
  { id: "vertical", label: "Vertical", ratio: "9:16", width: 1080, height: 1920, where: "TikTok, Reels, Shorts" },
  { id: "square", label: "Square", ratio: "1:1", width: 1080, height: 1080, where: "Feeds" },
  { id: "wide", label: "Widescreen", ratio: "16:9", width: 1920, height: 1080, where: "YouTube, display" },
] as const;
export type AdFormatId = (typeof AD_FORMATS)[number]["id"];
export const AD_FORMAT_IDS = AD_FORMATS.map((f) => f.id) as AdFormatId[];
export const adFormat = (id: string) => AD_FORMATS.find((f) => f.id === id) ?? null;

/**
 * How long, in seconds.
 *
 * Three lengths rather than a free number: they are the three the ad networks
 * actually sell, every extra second is billed by the model, and an arbitrary
 * length is a slider somebody fiddles with instead of a decision.
 */
export const AD_DURATIONS = [6, 15, 30] as const;
export type AdDuration = (typeof AD_DURATIONS)[number];
export const isAdDuration = (v: unknown): v is AdDuration =>
  typeof v === "number" && (AD_DURATIONS as readonly number[]).includes(v);

/**
 * The beats of an ad that works, in order.
 *
 * Written down as a structure the script is filled into rather than left to
 * open-ended generation, because "write me an advert" produces a description
 * of a product and this produces an advert. Each beat carries the share of the
 * runtime it should get, which is how one script becomes a six-second cut and
 * a thirty-second one without being rewritten.
 *
 * `hook` is deliberately the largest share of a six-second ad and the smallest
 * of a thirty: at six seconds the hook is most of what there is time for, and
 * at thirty, dwelling on it is how a viewer leaves before the product appears.
 */
export const AD_BEATS = [
  /*
   * `maxSeconds` is on the hook and the call to action because neither of them
   * is a proportional thing. The hook's own purpose says two seconds; it is a
   * punch, and a punch held for six is a establishing shot that forgot it was
   * a hook. Interpolating its share alone produced exactly that — a fifteen
   * second advert came out as a six-second hook, a one-second problem, and a
   * one-second proof, and the one-second beats were given fifteen characters
   * of on-screen line by `lineLimit`, which is where "The old way tak"
   * came from. Length should buy more *story*, not a longer stare.
   *
   * `minSeconds` is the other half of the same fix: a beat that cannot afford
   * its minimum is dropped rather than kept at a second. A flash nobody reads
   * is worse than a beat that was never in the cut, and its seconds are worth
   * more given to a beat that has room to use them.
   */
  { id: "hook", label: "Hook", purpose: "Stop the scroll. Two seconds, and it has to work with the sound off.", share: { 6: 0.5, 15: 0.2, 30: 0.1 }, minSeconds: 2, maxSeconds: 3 },
  { id: "problem", label: "Problem", purpose: "The thing the viewer recognises in themselves.", share: { 6: 0, 15: 0.2, 30: 0.2 }, minSeconds: 3 },
  { id: "product", label: "Product", purpose: "The real thing, shown accurately. Their photograph, never a generated likeness of it.", share: { 6: 0.33, 15: 0.27, 30: 0.37 }, minSeconds: 2 },
  { id: "proof", label: "Proof", purpose: "A number, a review, a demonstration. Something checkable.", share: { 6: 0, 15: 0.2, 30: 0.2 }, minSeconds: 2 },
  /*
   * The ask gets a floor of one second rather than two, which is the only
   * place it matters: a six-second cut. Two would be right if the ask had to
   * be read like a sentence, but it is four words over a frame the viewer has
   * been looking at for five seconds, and buying that second costs it from
   * the hook — which is the beat with the least to spare and the most to do.
   */
  { id: "cta", label: "Call to action", purpose: "One action, rendered as text rather than spoken over.", share: { 6: 0.17, 15: 0.13, 30: 0.13 }, minSeconds: 1, maxSeconds: 4 },
] as const;

/** The beat that soaks up whatever rounding leaves over. */
const DRIFT_BEAT: AdBeatId = "product";

/** The three beats that are the advert. Everything else is droppable. */
const ALWAYS = new Set<AdBeatId>(["hook", "product", "cta"]);
export type AdBeatId = (typeof AD_BEATS)[number]["id"];

/**
 * Which beats fit in a cut of this length, and how long each gets.
 *
 * A six-second ad that tries to carry all five beats gives each of them just
 * over a second, which is five things nobody takes in. So the short cut drops
 * problem and proof — their share is zero, and a beat with no share is not in
 * the cut — and the seconds are shared between what remains.
 *
 * ## Why all three lengths are authored
 *
 * They used to be two, with the middle interpolated, on the reasonable-sounding
 * argument that changing a beat should change every length consistently. The
 * middle was the one nobody looked at, and it was wrong: problem and proof
 * ramp from a share of zero, so at fifteen seconds they came out at about a
 * second each while the hook — interpolating down from half of six seconds —
 * came out at five, and the rounding drift went to the longest beat, which was
 * the hook, making it six. A fifteen-second advert was a six-second stare, a
 * one-second problem and a one-second proof, and `lineLimit` gave those two
 * beats fifteen characters of on-screen line between them.
 *
 * `AD_DURATIONS` is a closed set of three, and each one is a separately priced
 * outcome. Something that is sold as three products is worth authoring three
 * times, and an interpolated middle is a shape nobody chose.
 */
export function beatPlan(
  duration: AdDuration,
  /**
   * A style's emphasis, multiplied against the base shares. A weight of 0
   * removes the beat — "Arriving" has no problem beat, because nobody opening
   * a parcel needs telling they had a problem.
   */
  styleWeights?: Partial<Record<AdBeatId, number>>,
): { id: AdBeatId; seconds: number }[] {
  const weights = AD_BEATS.map((b) => ({
    id: b.id as AdBeatId,
    w: b.share[duration] * (styleWeights?.[b.id] ?? 1),
  }))
    .filter((b) => b.w > 0.001);
  const limits = new Map(AD_BEATS.map((b) => [b.id as AdBeatId, b]));

  /*
   * Beats that cannot afford their minimum are dropped, cheapest first, and
   * the share they were holding goes back into the pool for the rest. Done as
   * a loop because dropping one raises everybody else's share, which can lift
   * a second beat over its own minimum — a single pass would drop both.
   */
  let kept = weights.slice();
  for (;;) {
    const total = kept.reduce((sum, b) => sum + b.w, 0);
    const short = kept
      .map((b) => ({ b, want: limits.get(b.id)!.minSeconds, got: (b.w / total) * duration }))
      .filter((x) => x.got < x.want && !ALWAYS.has(x.b.id))
      .sort((a, b) => a.got - b.got);
    /*
     * Only problem and proof are ever dropped, which is what the short cut was
     * always meant to drop. The other three are the advert: no hook is not an
     * advert, no ask is a film, and no product beat is six seconds that never
     * show the thing being sold.
     *
     * Protecting the product beat is not a nicety. At six seconds its share
     * works out at 1.98 seconds against a two-second minimum, so a rule that
     * only protected the hook and the ask dropped it over two hundredths of a
     * second — and a six-second advert came out as a three-second hook
     * followed by three seconds of call to action.
     */
    if (!short.length || kept.length <= 2) break;
    kept = kept.filter((b) => b !== short[0].b);
  }

  const total = kept.reduce((sum, b) => sum + b.w, 0);
  /*
   * Each beat gets its share, held to its own floor and ceiling. The ceiling
   * is what stops a long advert from simply staring at the hook for longer.
   */
  const seconds = kept.map((b) => {
    const limit = limits.get(b.id)!;
    const want = Math.round((b.w / total) * duration);
    const ceiling = (limit as { maxSeconds?: number }).maxSeconds ?? duration;
    return { id: b.id, seconds: Math.min(ceiling, Math.max(limit.minSeconds, want)) };
  });

  /*
   * The remainder, so the parts always add to the whole — a cut whose beats
   * sum to twenty-nine seconds is a second of black at the end.
   *
   * It goes to the product beat rather than to the longest, which is the
   * other half of the six-second-hook bug: the hook was the longest beat, so
   * every rounding error made it longer still. The product beat is the one
   * that can always use more time and the one a viewer came to see; where a
   * style has dropped it, the longest remaining beat under its ceiling takes
   * it instead.
   */
  let drift = duration - seconds.reduce((sum, b) => sum + b.seconds, 0);
  while (drift !== 0) {
    const room = (b: { id: AdBeatId; seconds: number }) => {
      const ceiling = (limits.get(b.id) as { maxSeconds?: number }).maxSeconds ?? duration;
      return drift > 0 ? ceiling - b.seconds : b.seconds - limits.get(b.id)!.minSeconds;
    };
    const candidates = seconds.filter((b) => room(b) > 0);
    if (!candidates.length) break;
    const target = candidates.find((b) => b.id === DRIFT_BEAT)
      ?? candidates.reduce((a, b) => (b.seconds > a.seconds ? b : a));
    const step = drift > 0 ? Math.min(drift, room(target)) : -Math.min(-drift, room(target));
    target.seconds += step;
    drift -= step;
  }
  return seconds;
}

/**
 * What a render costs us, before anything is charged for it.
 *
 * Video is billed by the second of output and a usable ad takes several
 * attempts, so the thing that matters commercially is the cost of a *finished*
 * ad rather than of one clip. `ATTEMPTS_PER_FINISHED` is the honest multiplier
 * and starts at three; it is a guess until there is real data, and it is
 * written here as one number so it can be corrected from the ledger rather
 * than hunted for across the codebase.
 *
 * The per-second figure is deliberately not a constant for a named model: the
 * provider publishes its own prices and changes them, so this is the number we
 * believe today and `docs/ops/ad-rendering.md` says where to check it.
 */
export const AD_COST = {
  /** What the provider charges per second of generated video, in cents. */
  centsPerSecond: 7,
  /** Clips generated, on average, per clip actually used. A guess until the ledger says otherwise. */
  attemptsPerFinished: 3,
  /** Rendering, captioning and compositing happen on our own machines. */
  renderOverheadCents: 2,
} as const;

/** What one finished cut of this length is expected to cost us, in cents. */
export function expectedCostCents(duration: AdDuration, formats: number = 1): number {
  const generated = duration * AD_COST.centsPerSecond * AD_COST.attemptsPerFinished;
  /*
   * Formats are re-cuts of the same generated footage, not re-generations —
   * that is the whole reason to generate once and compose per format. They
   * cost the overhead again and the model nothing.
   */
  return Math.round(generated + AD_COST.renderOverheadCents * formats);
}

/**
 * What a finished advert costs the person who asked for it, per second.
 *
 * Priced on the seconds of *finished cut*, not the seconds generated, because
 * the finished cut is the thing somebody bought and the only number they can
 * check. The two are a long way apart: clips have a five-second floor, so a
 * six-second advert needs fifteen seconds generated across three plates and a
 * thirty-second one needs forty. That is why the margin is thin at six
 * seconds and good at thirty, and why the thirty-second price is the best
 * value of the three rather than the worst.
 *
 * It only holds at one generation per plate. At `AD_COST.attemptsPerFinished`
 * — three — every length is underwater: a thirty-second advert would cost 632
 * cents to make and sell for 600. So a render generates each plate once, and
 * trying again is a new render at the full price. A re-roll included in the
 * price is a re-roll somebody presses until they like it, paid for by us.
 */
export const AD_PRICE = {
  /** Cents per second of finished advert. */
  centsPerSecond: 20,
} as const;

/** The priced outcome for a length, so the charge comes off the price list. */
export const adOutcome = (duration: AdDuration): "advert6" | "advert15" | "advert30" =>
  (`advert${duration}` as "advert6" | "advert15" | "advert30");

/** What this length is charged, in cents. */
export const adPriceCents = (duration: AdDuration): number => duration * AD_PRICE.centsPerSecond;

/**
 * What a render is expected to cost us, worked out from the plan rather than
 * guessed at from the duration.
 *
 * `expectedCostCents` above answers a different question — what a finished ad
 * costs on average including re-rolls — and is the number to quote when
 * deciding a price. This one is for a specific render whose plates are already
 * planned, so it can be compared against what was charged and the real margin
 * read off the ledger instead of estimated.
 */
export const plateCostCents = (plateSeconds: number[]): number =>
  Math.round(plateSeconds.reduce((n, s) => n + s, 0) * AD_COST.centsPerSecond + AD_COST.renderOverheadCents);

/** Statuses a render goes through. `failed` is terminal; a caller may retry into a new render. */
export const AD_RENDER_STATUSES = ["queued", "generating", "composing", "ready", "failed"] as const;
export type AdRenderStatus = (typeof AD_RENDER_STATUSES)[number];
export const isTerminalRenderStatus = (s: AdRenderStatus) => s === "ready" || s === "failed";

/**
 * What has to be true before an ad may be published, and who it protects.
 *
 * Not a disclaimer. Each of these is a rule an ad network enforces or a law
 * somebody can be sued under, and the platform is where they are cheapest to
 * get right — a business running its first advert does not know them and
 * should not have to.
 */
export const AD_COMPLIANCE_CHECKS = [
  { id: "ai_disclosure", label: "Marked as AI-generated", why: "The major ad platforms now require synthetic media to be declared, and declaring it is cheaper than being caught not declaring it." },
  { id: "licensed_audio", label: "Music is licensed for advertising", why: "A track that is fine on a personal video is a claim on a commercial one. Only music cleared for ads goes in." },
  { id: "no_real_likeness", label: "No real person's likeness without consent", why: "A generated face that resembles a real person is their likeness being used to sell something, and they did not agree to it." },
  { id: "claims_supported", label: "Every claim on screen is one the business can support", why: "\"Best in town\" and \"clinically proven\" are different sentences in law. The second needs evidence on file." },
] as const;
export type AdComplianceCheckId = (typeof AD_COMPLIANCE_CHECKS)[number]["id"];
export const AD_COMPLIANCE_IDS = AD_COMPLIANCE_CHECKS.map((c) => c.id) as AdComplianceCheckId[];
