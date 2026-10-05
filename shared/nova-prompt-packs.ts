/**
 * Nova's prompt packs: what she asks a new project before she plans anything.
 *
 * A first plan written from the project's title and one line of description is
 * the same plan every time — "validate the idea, build an MVP, get users" —
 * which is advice for nobody. What makes it specific is knowing three or four
 * things this kind of project turns on: for a website, who it's for and what
 * the one action on the page is; for a restaurant, covers and the shift that
 * breaks. So a pack is a small set of focused questions plus the guidance that
 * says what a good answer looks like, keyed by goal and subcategory.
 *
 * Versioned, because the questions are the product: changing them changes
 * every plan made afterwards, and the eval notes in docs/nova-evals-v1.md are
 * about a particular version. A pack that hasn't been written yet is a stub —
 * the questions fall back to the generic set, and `status` says so, so the UI
 * can offer the path for every goal and subcategory from day one.
 */
import type { ProjectGoal } from "./goals";

export const NOVA_PACK_VERSION = "v1" as const;

export interface NovaPromptPack {
  /** `${goal}:${subcategory}`, or `${goal}:*` for a goal's fallback. */
  key: string;
  version: typeof NOVA_PACK_VERSION;
  /**
   * "live" once its questions and guidance are written *and evaluated*;
   * "written" when somebody has written them and no eval has been run yet;
   * "stub" when there is no pack and the generic questions are standing in.
   *
   * The middle one was added with the three non-software ship packs below.
   * They are real questions rather than the generic set, so calling them
   * "stub" understates them — and "live" is a claim about an eval that has not
   * happened, which is the kind of label that gets believed later. `LIVE_PACKS`
   * still means evaluated, so the eval harness is unaffected.
   */
  status: "live" | "written" | "stub";
  /** What Nova asks before planning. Three or four — a form nobody finishes teaches nothing. */
  questions: { id: string; ask: string; why: string }[];
  /** What a good first plan looks like for this kind of project, in Nova's own instructions. */
  guidance: string;
  /** The shape of the first plan: the steps this kind of project genuinely starts with. */
  shape: string;
}

const GENERIC_QUESTIONS: NovaPromptPack["questions"] = [
  { id: "who", ask: "Who is this for, specifically enough that you could name three of them?", why: "A plan for everyone sequences nothing." },
  { id: "one-thing", ask: "What is the one thing it has to do well to be worth using at all?", why: "That thing is the first milestone; everything else waits behind it." },
  { id: "proof", ask: "What would show you it's working — something you could see in a week?", why: "It decides what the first steps are for, and when they're finished." },
  { id: "have", ask: "What's already built, written or agreed?", why: "A plan that starts from zero when you're at three wastes the three." },
];

const GENERIC_GUIDANCE =
  "Write the first plan as steps a person can start today, in the order they unblock each other. " +
  "Each step names the observable thing that proves it's done. No step is 'research', 'plan' or 'set up tooling' " +
  "unless the answers show that's genuinely the blocker.";

/**
 * The live pack. Ship MVP + Website is where most first projects land here, and
 * it's the one whose questions have been evaluated (docs/nova-evals-v1.md).
 */
const SHIP_WEBSITE: NovaPromptPack = {
  key: "ship_mvp:website",
  version: NOVA_PACK_VERSION,
  status: "live",
  questions: [
    { id: "visitor", ask: "Who lands on this page, and what were they doing ten seconds before?", why: "The page's first line has to meet them mid-thought, and the plan starts with that line." },
    { id: "action", ask: "What is the single action you want them to take?", why: "One action decides the page's shape; two actions make a page that gets neither." },
    { id: "proof", ask: "What proof do you have that it's worth their time — numbers, names, a demo, nothing yet?", why: "If there's no proof yet, getting the first piece is a step in the plan rather than a thing to fake." },
    { id: "live", ask: "What has to be true before you'd put it in front of a stranger?", why: "That's the definition of done for launching, and it's usually smaller than people think." },
  ],
  guidance:
    "Plan a page that can go live this week, not a site. Order the steps so the page exists and is readable before anything is optimised: " +
    "the one action first, then the words that earn it, then the proof, then the way you'll know anyone did it. " +
    "Say plainly when a step needs something they don't have yet (a domain, a screenshot, a first customer quote) and make getting it its own step.",
  shape:
    "Steps end with: the page is live at a URL a stranger can open; the single action works end to end; you can tell how many people took it.",
};

/**
 * A physical product.
 *
 * The questions are the ones a first-time maker has not been asked: what one
 * costs to make, and what somebody is buying instead today. Both are answerable
 * in a sentence and both change the whole plan.
 */
const SHIP_PHYSICAL: NovaPromptPack = {
  key: "ship_mvp:physical",
  version: NOVA_PACK_VERSION,
  status: "written",
  questions: [
    { id: "thing", ask: "What is it, and what do people use instead right now?", why: "A physical product always replaces something — even if the something is doing without. The plan has to beat that, not beat nothing." },
    { id: "make", ask: "Could you make one yourself this month, or does somebody else have to make it?", why: "Making it yourself means a prototype in days; a manufacturer means minimum orders and lead times, and the plan is a different shape." },
    { id: "cost", ask: "Roughly what do the materials for one cost — and if you don't know, say so?", why: "Unit cost decides the price and whether the business works. Not knowing is normal and makes finding out the first step rather than an assumption." },
    { id: "hands", ask: "Who are three people who would buy one, by name?", why: "Three real names is the difference between a product and an idea, and they become week four's first testers." },
  ],
  guidance:
    "Plan to get one real object made this month, not a product line. Order the steps so something exists in their hands before anything is optimised: " +
    "the rough prototype first, then the unit cost, then one made properly, then a way for a stranger to buy it. " +
    "Never write a step that assumes Nova can make, print, sew or assemble anything — Nova drafts the plan, the materials list and the words; the making is theirs. " +
    "Name lead times and minimum orders explicitly wherever a step depends on somebody else making it, because those are what slip.",
  shape:
    "Steps end with: one exists and you have held it; you know what one costs to make; a stranger could place an order; three people have used it.",
};

/**
 * Food or drink.
 *
 * The one pack where a legal question comes before a product question. Where
 * it is made decides what may be sold and to whom, and getting that wrong is
 * not a setback — it is the end of the business.
 */
const SHIP_FOOD: NovaPromptPack = {
  key: "ship_mvp:food",
  version: NOVA_PACK_VERSION,
  status: "written",
  questions: [
    { id: "dish", ask: "What is it, and when would somebody eat it?", why: "The occasion prices the product. The same jar is a weekday staple or a gift, and those are different businesses." },
    { id: "kitchen", ask: "Where would you make it — your own kitchen, a hired commercial one, or somebody else's factory?", why: "This decides what you may legally sell and to whom, before it decides anything practical. It is the first real constraint." },
    { id: "where", ask: "Where would the first ones be sold — a market, a shop, online, to friends?", why: "Each route has a different cut, a different label requirement and a different first step." },
    { id: "scale", ask: "How many could you make in one go without it ruining your week?", why: "Batch size is the honest limit on a food business, and planning past it is how people burn out in month two." },
  ],
  guidance:
    "Plan to sell one, for money, to somebody who is not a friend, this month. " +
    "Put the rules first: say plainly what the person's kitchen choice allows them to sell and what it does not, and if the answer depends on where they live, make finding out a step rather than guessing. " +
    "Cost it per serving including packaging and waste before any step about pricing — food margins are thinner than people expect and the arithmetic is the plan's most useful output. " +
    "Allergens and a label belong in the first month, not in a later 'compliance' phase. " +
    "Never write a step that assumes Nova can cook, package or deliver anything.",
  shape:
    "Steps end with: you have made it twice the same way; you know the cost of one serving; a label exists that could legally go on it; somebody who is not a friend has paid for one.",
};

/**
 * A YouTube channel.
 *
 * The hardest one to plan honestly, because the obvious plan — buy a camera,
 * film ten videos, grow — is the one that fails. What matters in month one is
 * whether they can hold a cadence and whether anybody watches to the end.
 */
const SHIP_CHANNEL: NovaPromptPack = {
  key: "ship_mvp:channel",
  version: NOVA_PACK_VERSION,
  status: "written",
  questions: [
    { id: "who", ask: "Who is this for, and what do they get out of one video?", why: "A channel without an answer to this makes videos for nobody. It is also the sentence that goes on the channel page." },
    { id: "hours", ask: "Realistically, how many hours a week can you give this?", why: "Cadence is the whole product in month one, and a cadence set above someone's real hours is the thing that ends channels." },
    { id: "kit", ask: "What would you film and edit on, using only what you already own?", why: "A channel waiting on equipment does not start. Nearly always the honest answer is a phone, and that is enough." },
    { id: "earn", ask: "If this worked, how would it eventually make money — sponsors, affiliate, your own product, ads?", why: "It changes what gets filmed from the first episode, even though it pays nothing for months." },
  ],
  guidance:
    "Plan the first month as a cadence, not a launch. The first video should be published publicly in week one, deliberately before it is good — the first one never is, and having it behind them is worth more than having it right. " +
    "Order the steps so publishing happens repeatedly: set up and one test video, then titles, then the cadence itself, one milestone per episode. " +
    "Treat titles and thumbnails as part of the product rather than promotion, because they decide whether anything gets watched. " +
    "Measure average view duration and returning viewers, and say plainly that subscriber count and total views are the numbers that feel like progress and are not. " +
    "Never write a step that assumes Nova can film, edit, record audio or appear on camera. Nova writes titles, scripts, descriptions and plans; the filming is theirs. " +
    "Do not plan around ad revenue: name what each earning route actually requires before it pays anything.",
  shape:
    "Steps end with: the channel exists and one video is public; you have published on your chosen cadence more than once; you know your average view duration; somebody came back for a second video.",
};

const PACKS: NovaPromptPack[] = [SHIP_WEBSITE, SHIP_PHYSICAL, SHIP_FOOD, SHIP_CHANNEL];

/** A goal's fallback, used until that goal and subcategory has a pack of its own. */
function stubFor(goal: ProjectGoal, subcategory: string): NovaPromptPack {
  return {
    key: `${goal}:${subcategory}`,
    version: NOVA_PACK_VERSION,
    status: "stub",
    questions: GENERIC_QUESTIONS,
    guidance: GENERIC_GUIDANCE,
    shape: "Steps end with something a person outside the project could look at and agree is done.",
  };
}

/**
 * The pack for this project: its own, else the goal's fallback. Never null —
 * a builder on a subcategory nobody has written for still gets a first plan,
 * from the generic questions, and the caller can see it was a stub.
 */
export function packFor(goal: string | null | undefined, subcategory: string | null | undefined): NovaPromptPack {
  const g = (goal ?? "ship_mvp") as ProjectGoal;
  const sub = subcategory ?? "other";
  return PACKS.find((p) => p.key === `${g}:${sub}`) ?? stubFor(g, sub);
}

/** Every written pack, for the eval harness and for showing what's covered. */
export const LIVE_PACKS = PACKS.filter((p) => p.status === "live");
