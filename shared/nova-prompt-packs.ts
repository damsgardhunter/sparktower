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
  /** "live" once its questions and guidance are written and evaluated; "stub" until then. */
  status: "live" | "stub";
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

const PACKS: NovaPromptPack[] = [SHIP_WEBSITE];

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
