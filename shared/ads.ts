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
  { id: "hook", label: "Hook", purpose: "Stop the scroll. Two seconds, and it has to work with the sound off.", shareOf6: 0.5, shareOf30: 0.12 },
  { id: "problem", label: "Problem", purpose: "The thing the viewer recognises in themselves.", shareOf6: 0.0, shareOf30: 0.2 },
  { id: "product", label: "Product", purpose: "The real thing, shown accurately. Their photograph, never a generated likeness of it.", shareOf6: 0.33, shareOf30: 0.36 },
  { id: "proof", label: "Proof", purpose: "A number, a review, a demonstration. Something checkable.", shareOf6: 0.0, shareOf30: 0.2 },
  { id: "cta", label: "Call to action", purpose: "One action, rendered as text rather than spoken over.", shareOf6: 0.17, shareOf30: 0.12 },
] as const;
export type AdBeatId = (typeof AD_BEATS)[number]["id"];

/**
 * Which beats fit in a cut of this length, and how long each gets.
 *
 * A six-second ad that tries to carry all five beats gives each of them just
 * over a second, which is five things nobody takes in. So the short cut drops
 * problem and proof — their share is zero, and a beat with no share is not in
 * the cut — and the seconds are shared between what remains.
 *
 * Interpolated between the two authored shapes rather than authored three
 * times, so changing a beat changes every length consistently.
 */
export function beatPlan(duration: AdDuration): { id: AdBeatId; seconds: number }[] {
  const span = 30 - 6;
  const t = (duration - 6) / span;
  const weights = AD_BEATS.map((b) => ({ id: b.id, w: b.shareOf6 + (b.shareOf30 - b.shareOf6) * t }))
    .filter((b) => b.w > 0.001);
  const total = weights.reduce((sum, b) => sum + b.w, 0);
  /*
   * Rounded to whole seconds and the remainder given to the longest beat, so
   * the parts always add to the whole. A cut whose beats sum to 29 seconds is
   * a second of black at the end.
   */
  const seconds = weights.map((b) => ({ id: b.id, seconds: Math.max(1, Math.round((b.w / total) * duration)) }));
  const drift = duration - seconds.reduce((sum, b) => sum + b.seconds, 0);
  if (drift !== 0) {
    const longest = seconds.reduce((a, b) => (b.seconds > a.seconds ? b : a));
    longest.seconds += drift;
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
