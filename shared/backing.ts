/**
 * Backing: donation tiers, the rewards attached to them, and the merch.
 *
 * Shared so the creator's setup screen, the public checkout, the fulfillment
 * queue and the reviewer's console all read the same catalog. A reward that
 * exists in one place and not another is how a backer ends up paying for a
 * shirt nobody ever sends.
 *
 * The joke is the product. "I believe'd in them" is past tense on purpose —
 * it's a receipt for having shown up early — so the tagline is fixed platform
 * side and is not creator-editable. What the creator controls is whose logo
 * and name sit next to it, and what each rung is called.
 */

/** Goes on every piece of backer merch, unchanged. The past tense is the joke. */
export const BELIEVER_TAGLINE = "I believe'd in them";

/** The counterpart the creator wears. Sells the whole loop in one photo. */
export const CREATOR_TAGLINE = "They believed in me.";

// --- Tips ---------------------------------------------------------------
//
// The tip funds the platform, not the project, so the creator can't set it —
// they'd be choosing how much of their backer's money to give away. Modest by
// default and plainly explained at checkout, which is the only reason Ko-fi
// and GoFundMe get away with it.

export const TIP_PRESET_PERCENTS = [0, 5, 10, 15, 20] as const;
export const DEFAULT_TIP_PERCENT = 10;

// --- Digital rewards ----------------------------------------------------

export interface DigitalRewardDef {
  key: string;
  label: string;
  description: string;
  /**
   * Who actually does the work. Platform rewards are free and instant, which
   * is exactly why they belong on the cheap rungs — a $5 pledge can't survive
   * a shipping cost. Creator rewards are a promise the creator has to keep,
   * so the setup screen warns about them.
   */
  fulfilledBy: "platform" | "creator";
}

export const DIGITAL_REWARDS: DigitalRewardDef[] = [
  {
    key: "backer_wall",
    label: "Name on the backer wall",
    description: "Their name listed on the project's public page.",
    fulfilledBy: "platform",
  },
  {
    key: "believer_number",
    label: "Believer number",
    description: "Backer #0047. A low number costs you nothing and people genuinely care.",
    fulfilledBy: "platform",
  },
  {
    key: "digital_badge",
    label: "Digital badge",
    description: "A badge on their account showing they backed you, and how early.",
    fulfilledBy: "platform",
  },
  {
    key: "profile_frame",
    label: "Profile frame",
    description: "A ring around their avatar in your project's colours.",
    fulfilledBy: "platform",
  },
  {
    key: "wallpaper",
    label: "Wallpaper",
    description: "Downloadable wallpaper with your logo and the tagline.",
    fulfilledBy: "platform",
  },
  {
    key: "certificate",
    label: "Printable certificate",
    description: "A dated certificate they can actually print and pin up.",
    fulfilledBy: "platform",
  },
  {
    key: "founding_believer",
    label: "Founding believer credit",
    description: "A permanent marker on their profile naming them as an early backer.",
    fulfilledBy: "platform",
  },
  {
    key: "early_access",
    label: "Early access",
    description: "First through the door on whatever you ship next.",
    fulfilledBy: "creator",
  },
  {
    key: "video_thankyou",
    label: "Personal video thank-you",
    description: "You record and send a short personal thank-you. This one is real work — don't put it on a rung you'll regret.",
    fulfilledBy: "creator",
  },
];

export const DIGITAL_REWARD_KEYS = DIGITAL_REWARDS.map((r) => r.key);

// --- Physical merch -----------------------------------------------------

export interface MerchProductDef {
  key: string;
  label: string;
  description: string;
  /**
   * Rough landed cost in cents — item plus typical US shipping. Indicative
   * only, shown to the creator so a $15 rung doesn't quietly promise a $22
   * hoodie. Real figures come back from Printful at order time.
   */
  estimatedCostCents: number;
  /** Below this pledge the reward costs more than it earns. */
  suggestedMinCents: number;
  /**
   * Printful catalog product id. Left null deliberately: these change, and a
   * guessed id fails silently at fulfillment rather than at build time. Map
   * them from GET /api/printful/catalog once the API key is set.
   */
  printfulProductId: number | null;
}

export const MERCH_PRODUCTS: MerchProductDef[] = [
  {
    key: "sticker_pack",
    label: "Sticker pack",
    description: "Kiss-cut vinyl. The cheapest thing that still feels like a real object.",
    estimatedCostCents: 450,
    suggestedMinCents: 1500,
    printfulProductId: null,
  },
  {
    key: "believer_card",
    label: "\"I believe'd in them\" card",
    description: "A printed card with nothing on it but the tagline. Made to be handed to someone.",
    estimatedCostCents: 350,
    suggestedMinCents: 1500,
    printfulProductId: null,
  },
  {
    key: "mug",
    label: "Mug",
    description: "11oz. Logo one side, tagline the other.",
    estimatedCostCents: 1200,
    suggestedMinCents: 2500,
    printfulProductId: null,
  },
  {
    key: "pin",
    label: "Enamel pin",
    description: "Small, cheap to post, disproportionately loved.",
    estimatedCostCents: 700,
    suggestedMinCents: 2000,
    printfulProductId: null,
  },
  {
    key: "patch",
    label: "Embroidered patch",
    description: "Iron-on. Reads as earned rather than bought.",
    estimatedCostCents: 800,
    suggestedMinCents: 2000,
    printfulProductId: null,
  },
  {
    key: "shirt",
    label: "The shirt",
    description: "Tagline on the front, your logo and the date on the back.",
    estimatedCostCents: 2200,
    suggestedMinCents: 3500,
    printfulProductId: null,
  },
  {
    key: "tote",
    label: "Tote bag",
    description: "Eco cotton. Walks around advertising you for years.",
    estimatedCostCents: 1600,
    suggestedMinCents: 3000,
    printfulProductId: null,
  },
];

export const MERCH_PRODUCT_KEYS = MERCH_PRODUCTS.map((p) => p.key);

export const digitalReward = (key: string) => DIGITAL_REWARDS.find((r) => r.key === key);
export const merchProduct = (key: string) => MERCH_PRODUCTS.find((p) => p.key === key);

// --- Merch artwork config ----------------------------------------------

/** What the creator controls about how their merch looks. */
export interface MerchConfig {
  /** At least one of these must be true, or the back of the shirt is blank. */
  showLogo: boolean;
  showName: boolean;
  /** Overrides the project title on the garment when the title is unwieldy. */
  displayName: string | null;
  logoUrl: string | null;
  colorway: "black" | "white" | "heather";
  /**
   * "since March 2026" on the back. Creates a visible hierarchy between early
   * and late supporters, which is the entire point of the exercise.
   */
  showDatestamp: boolean;
  /** Products the creator has switched on, by key. */
  enabledProducts: string[];
  /** Offer the creator's own "They believed in me." shirt. */
  creatorShirt: boolean;
  /**
   * A finished back panel, supplied by the creator.
   *
   * The preview above composes logo, name and datestamp for the *creator* to
   * look at, but a print file needs those burned into one high-resolution
   * image, and there's no rasteriser on the server to do it. Until there is,
   * this is how a project with text on the back actually gets printed: the
   * creator hands over artwork that's already composed.
   */
  backArtworkUrl: string | null;
}

export const DEFAULT_MERCH_CONFIG: MerchConfig = {
  showLogo: true,
  showName: true,
  displayName: null,
  logoUrl: null,
  colorway: "black",
  showDatestamp: true,
  enabledProducts: ["sticker_pack", "shirt"],
  creatorShirt: true,
  backArtworkUrl: null,
};

/**
 * "since March 2026" — fixed at campaign start, not read from now.
 *
 * Formatted in UTC so every render agrees. Left to local time, the same
 * campaign prints "since February" on a server in Los Angeles and "since
 * March" on one in Frankfurt, and the garment is permanent.
 */
export function datestampLabel(startedAt: Date | string | null | undefined): string | null {
  if (!startedAt) return null;
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return null;
  return `since ${d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}`;
}

// --- The default ladder -------------------------------------------------
//
// Five rungs. Three leaves money on the table, eight is a menu nobody reads.
// Every name here is a placeholder in someone else's voice — the setup screen
// pushes hard on renaming them, because the naming is half the appeal.

export interface TierTemplate {
  amountCents: number;
  name: string;
  description: string;
  digitalRewards: string[];
  merchProducts: string[];
}

export const DEFAULT_TIER_TEMPLATE: TierTemplate[] = [
  {
    amountCents: 500,
    name: "Believer",
    description: "You showed up. That's the whole thing.",
    digitalRewards: ["backer_wall", "believer_number"],
    merchProducts: [],
  },
  {
    amountCents: 1500,
    name: "Certified Believer",
    description: "Stickers for your laptop and a badge for your profile.",
    digitalRewards: ["backer_wall", "believer_number", "digital_badge", "wallpaper"],
    merchProducts: ["sticker_pack"],
  },
  {
    amountCents: 3500,
    name: "The Shirt",
    description: "The shirt. Datestamped, so everyone knows how early you were.",
    digitalRewards: ["backer_wall", "believer_number", "digital_badge", "wallpaper", "certificate"],
    merchProducts: ["shirt"],
  },
  {
    amountCents: 7500,
    name: "Ride or Die",
    description: "The shirt, plus I record you a thank-you with my actual face.",
    digitalRewards: [
      "backer_wall", "believer_number", "digital_badge", "wallpaper",
      "certificate", "profile_frame", "video_thankyou",
    ],
    merchProducts: ["shirt"],
  },
  {
    amountCents: 25000,
    name: "Absolute Unit",
    description: "Founding believer. Permanent credit, and you see everything first.",
    digitalRewards: [
      "backer_wall", "believer_number", "digital_badge", "wallpaper", "certificate",
      "profile_frame", "video_thankyou", "founding_believer", "early_access",
    ],
    merchProducts: ["shirt", "pin"],
  },
];

// --- Money --------------------------------------------------------------

/** Platform's cut of the pledge itself, separate from the optional tip. */
export const PLATFORM_FEE_PERCENT = 10;

export const MIN_PLEDGE_CENTS = 100;
/** Above this, Stripe Checkout wants more identity than we want to ask for. */
export const MAX_PLEDGE_CENTS = 1_000_000;

/** Days a pledge can sit unreleased before the backer's choice kicks in. */
export const REFUND_WINDOW_DAYS = 90;

/**
 * What happens to a pledge the creator never earns out.
 *
 * Chosen by the backer at checkout, because it's their money and the honest
 * version of this question converts better than hiding it.
 */
export const UNCLAIMED_PREFERENCES = ["refund", "donate_platform"] as const;
export type UnclaimedPreference = (typeof UNCLAIMED_PREFERENCES)[number];
export const DEFAULT_UNCLAIMED_PREFERENCE: UnclaimedPreference = "refund";

export function platformFeeCents(amountCents: number): number {
  return Math.round(amountCents * (PLATFORM_FEE_PERCENT / 100));
}

/** What the creator actually receives on release. Tips never reach them. */
export function creatorPayoutCents(amountCents: number): number {
  return amountCents - platformFeeCents(amountCents);
}

// --- Backer badges ------------------------------------------------------
//
// The badge is the reward that costs nothing to make and gets carried around
// the platform forever, so it does more work than anything that ships. Its
// level is read off the amount rather than the tier, because tiers get renamed
// and deleted while a badge someone is displaying has to keep meaning what it
// meant on the day they earned it.

export interface BadgeLevelDef {
  key: string;
  label: string;
  minCents: number;
  /** Drives both the generated artwork and the frame around it. */
  metal: string;
  hex: string;
  accentHex: string;
}

export const BADGE_LEVELS: BadgeLevelDef[] = [
  { key: "bronze",   label: "Bronze",   minCents: 500,   metal: "warm antique bronze",    hex: "#a8672a", accentHex: "#e0a15e" },
  { key: "silver",   label: "Silver",   minCents: 1500,  metal: "brushed sterling silver", hex: "#9aa3ad", accentHex: "#dfe6ee" },
  { key: "gold",     label: "Gold",     minCents: 3500,  metal: "polished 18-carat gold",  hex: "#c9962a", accentHex: "#f5d371" },
  { key: "platinum", label: "Platinum", minCents: 7500,  metal: "iridescent platinum",     hex: "#8f9bb3", accentHex: "#d7e2f5" },
];

export type BadgeLevelKey = (typeof BADGE_LEVELS)[number]["key"];

/** The highest level an amount clears. Never returns null above the minimum. */
export function badgeLevelForAmount(amountCents: number): BadgeLevelDef {
  const earned = [...BADGE_LEVELS].reverse().find((l) => amountCents >= l.minCents);
  return earned ?? BADGE_LEVELS[0];
}

export const badgeLevel = (key: string) => BADGE_LEVELS.find((l) => l.key === key);

/** How many badges someone can pin across their profile. */
export const MAX_SHOWCASE_BADGES = 5;

/** Believer numbers read as #0047, not #47. Ordinal scarcity is the point. */
export function formatBelieverNumber(n: number): string {
  return `#${String(n).padStart(4, "0")}`;
}

/**
 * The tier a pledge buys: the most expensive rung it clears.
 *
 * Matching on amount rather than on the tier the backer clicked means someone
 * who types a custom $40 still gets the $35 shirt, which is what they expect
 * and what they'd otherwise write in to complain about.
 */
export function tierForAmount<T extends { amountCents: number }>(
  tiers: T[], amountCents: number,
): T | null {
  const eligible = tiers
    .filter((t) => t.amountCents <= amountCents)
    .sort((a, b) => b.amountCents - a.amountCents);
  return eligible[0] ?? null;
}

/** True when a tier promises something that has to physically ship. */
export function tierNeedsShipping(tier: { merchProducts: string[] | null }): boolean {
  return (tier.merchProducts?.length ?? 0) > 0;
}
