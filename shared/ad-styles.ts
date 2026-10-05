/**
 * The shapes a story about a business can take.
 *
 * An advert is not one form. "Here is my product and why it is good" is the
 * form everybody reaches for first and the one that performs worst, because
 * it asks a stranger to care about a thing before giving them a reason to.
 * These are the forms that work, written down so Nova fills one in rather
 * than inventing a structure every time.
 *
 * Each style says four things:
 *
 *   - **what it is for** — the situation it suits, so a business picks by
 *     their circumstances rather than by which name sounds best.
 *   - **the beats, reweighted.** The beats themselves live in shared/ads.ts
 *     and do not change; what changes is how much of the runtime each gets. A
 *     founder's story spends its time on the problem; a demonstration spends
 *     it on the product. Same five beats, different film.
 *   - **what the camera is doing**, as direction for the generated plate.
 *     This is the only part the video model is asked for, and it is asked for
 *     background and movement — never the product, never text.
 *   - **what Nova must not do**, per style. The failure modes differ: a
 *     testimonial invents a customer, a transformation implies a result
 *     nobody promised. The guard belongs with the style that needs it.
 */
import type { AdBeatId } from "./ads";

export interface AdStyle {
  id: string;
  label: string;
  /** When this is the right shape, in the words a business owner would use. */
  bestFor: string;
  /**
   * Relative weight per beat. Multiplied against the base shares in
   * shared/ads.ts, so a style emphasises without having to restate the
   * sequence — and a weight of 0 removes a beat from this style entirely.
   */
  beatWeights: Partial<Record<AdBeatId, number>>;
  /**
   * Direction for the generated plate: setting and camera, and nothing else.
   *
   * This string is sent to the video model, so it holds only what the model
   * should draw. No mention of the product, the logo, the price or any text —
   * not even to say those are added later, because the model does not read
   * caveats, it reads nouns. `ad-styles-and-brand.test.ts` holds that line.
   */
  plate: string;
  /** What Nova is told to avoid for this shape specifically. */
  avoid: string;
  /** The one sentence a business reads when choosing. */
  blurb: string;
  /**
   * Draw the first frame of each clip before animating it, from the business's
   * own logo and the frame the last shot ended on.
   *
   * Costs an image generation per clip and buys the two things text-to-video
   * cannot do at any price: the logo as an object that is really in the scene,
   * and the same place persisting from one shot to the next. Off by default
   * because most adverts do not need either — a plate of hands making coffee
   * is a plate of hands making coffee — and on for the styles whose whole
   * point is a world the brand lives in.
   */
  keyframes?: boolean;
  /**
   * Where the logo belongs in that world, for the image model.
   *
   * Only read when `keyframes` is on. It is the sentence that turns a mark
   * into a place: "the building itself, its silhouette against the sky".
   */
  logoRole?: string;
}

export const AD_STYLES: AdStyle[] = [
  {
    /*
     * The style that exists because of a specific piece of feedback: "it still
     * feels and only looks like an overlay over some random actions, and i
     * would like to get the objects like logo and wording to work with the
     * advertisement." Every other style here generates footage and composites
     * the brand on top. This one draws the brand into the world first and
     * animates that, which is why it is the only one with `keyframes` on.
     *
     * It is the right shape for a business whose idea is bigger than its
     * product — a platform, a community, a mission — where what is being sold
     * is somewhere to belong rather than a thing to buy. Those adverts are a
     * journey through a place, and a place has to persist from shot to shot or
     * it is five postcards.
     */
    id: "brand_world",
    label: "Your logo as a place",
    bestFor: "A business whose idea is bigger than any one product — a platform, a community, a mission — where the advert is a journey through a world rather than a look at a thing.",
    /* Weighted to the middle: the journey is the advert, and the journey is the product beat. */
    beatWeights: { hook: 1, problem: 0.4, product: 2.2, proof: 1.4, cta: 1 },
    plate: "One continuous camera move through a single place, with the scale of it doing the work — wide establishing light, deep space, something happening at every distance from the lens.",
    avoid: "Letting the world become the point. Every floor of it has to be somebody doing something a viewer recognises, or it is architecture with nobody in it.",
    blurb: "The brand as somewhere you walk into, shot as one journey.",
    keyframes: true,
    logoRole: "the structure itself — the building, the landmark, the silhouette on the skyline that the scene is built around, at architectural scale and made of real materials.",
  },
  {
    id: "problem_solution",
    label: "Problem and solution",
    bestFor: "A product that fixes something irritating, where the irritation is instantly recognisable.",
    beatWeights: { hook: 1, problem: 1.6, product: 1.2, proof: 0.8, cta: 1 },
    plate: "The situation the problem happens in, shot plainly. Ordinary light, ordinary room, no styling. The plate should look like somebody's actual life, because the recognition is the whole mechanism.",
    avoid: "Inventing a problem the business did not describe. If they did not say customers complain about something, this is the wrong style rather than an invitation to guess one.",
    blurb: "Name the annoyance, then show what ends it.",
  },
  {
    id: "founder_story",
    label: "Why I made this",
    bestFor: "A new business whose owner is willing to be in it, and has a reason for existing that is not commercial.",
    beatWeights: { hook: 0.8, problem: 1.8, product: 1, proof: 0.6, cta: 0.8 },
    plate: "Hands, workshop, kitchen, early mornings — the making rather than the made thing. Close, warm, slightly imperfect. No faces: a generated face is somebody's likeness, and the founder's own footage is better here anyway.",
    avoid: "Writing the founder's motivation for them. Use their words from the brief; if the brief has none, the script asks them for one line rather than composing a backstory.",
    blurb: "The reason it exists, told by the person who made it.",
  },
  {
    id: "demonstration",
    label: "Watch it work",
    bestFor: "Anything whose value is visible in a few seconds — a tool, a process, a transformation you can film.",
    beatWeights: { hook: 1, problem: 0.4, product: 2, proof: 1, cta: 1 },
    plate: "A clear working surface with room in frame for the product to be composited in, lit evenly, camera still or on a slow dolly. Deliberately uncluttered: this plate is a stage, and anything decorative competes with the thing being shown.",
    avoid: "Claiming a result that is not in the footage. A demonstration's proof is the demonstration; adding 'results in days' turns a showable fact into a claim somebody has to defend.",
    blurb: "Show the thing doing the thing.",
  },
  {
    id: "social_proof",
    label: "What people say",
    bestFor: "A business with real reviews, numbers or named customers it can quote.",
    beatWeights: { hook: 1, problem: 0.6, product: 1, proof: 2.2, cta: 1 },
    plate: "An ordinary setting, busy and unposed — a counter, a table mid-meal, a desk mid-work. Room in frame on one side, so the quote has somewhere to sit.",
    avoid: "Writing a review. Every quote must come from the brief verbatim, attributed as the business attributed it. A fabricated testimonial is the one mistake here that is also illegal.",
    blurb: "Let the people who bought it make the argument.",
  },
  {
    id: "before_after",
    label: "Before and after",
    bestFor: "A visible change — a space, a surface, a skill, a state of affairs.",
    beatWeights: { hook: 1.2, problem: 1.4, product: 1.4, proof: 1.2, cta: 0.8 },
    plate: "The same framing twice, so the cut between them carries the change. Static camera, identical angle: a moved camera makes the comparison feel staged even when it is honest.",
    avoid: "Implying a typical result from one example. If the business has not said how long it takes or how often it works, the script says 'one customer's result' rather than nothing.",
    blurb: "The change, in one cut.",
  },
  {
    id: "unboxing",
    label: "Arriving",
    bestFor: "Something posted — a product whose packaging and first impression are part of what is bought.",
    beatWeights: { hook: 1.4, problem: 0, product: 1.8, proof: 0.6, cta: 1 },
    plate: "A doorstep, a table, a parcel being picked up. Handheld, close, one continuous movement. No problem beat: nobody arriving at a parcel needs to be told they had a problem.",
    avoid: "Showing packaging the business has not sent us a photograph of. The box is the product in this style, so it comes from their own pictures or the style is not available to them yet.",
    blurb: "The moment it turns up.",
  },
];

export const AD_STYLE_IDS = AD_STYLES.map((s) => s.id);
export const adStyle = (id: string | null | undefined): AdStyle | null =>
  AD_STYLES.find((s) => s.id === id) ?? null;

/**
 * What this style needs from the business before it can be written honestly.
 *
 * Three of the six make a claim about somebody other than the business —
 * a customer who said something, a result somebody got, a parcel that arrived
 * — and an advert that invents any of those is not a worse advert, it is a
 * false statement about a third party. So a style can be unavailable, with a
 * reason, rather than being filled in with plausible fiction.
 */
export function styleRequirements(id: string): string[] {
  switch (id) {
    case "social_proof": return ["At least one real quote, review or number, with permission to use it"];
    case "before_after": return ["A photograph of the before and the after", "Whether this result is typical"];
    case "unboxing": return ["Photographs of the actual packaging"];
    case "founder_story": return ["One line from the owner about why they started"];
    case "demonstration": return ["Photographs or footage of the product being used"];
    default: return [];
  }
}

/** Styles this business can honestly run, given what they have supplied. */
export function availableStyles(has: { quotes?: boolean; beforeAfter?: boolean; packagingPhotos?: boolean; productPhotos?: boolean; founderLine?: boolean }): AdStyle[] {
  return AD_STYLES.filter((s) => {
    if (s.id === "social_proof") return !!has.quotes;
    if (s.id === "before_after") return !!has.beforeAfter;
    if (s.id === "unboxing") return !!has.packagingPhotos;
    if (s.id === "demonstration") return !!has.productPhotos;
    if (s.id === "founder_story") return !!has.founderLine;
    /* Problem and solution needs nothing but the brief, which is why it is the fallback. */
    return true;
  });
}
