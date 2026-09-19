/**
 * What each market looks like.
 *
 * Seven markets that play completely differently were rendering as one screen
 * seven times: same card, same grey, same three segment boxes. The only thing
 * distinguishing dating apps from construction was the words in them, and words
 * at a glance are not a distinguishing thing — a player scrolling the picker
 * saw a list of identical rectangles and had to read every one to tell them
 * apart.
 *
 * So each gets an accent and a mark. Not decoration: it is the thing that makes
 * "I am in the drone market" a fact you can see from the header of every screen
 * for a fortnight, and it is what makes the picker a choice between seven
 * places rather than seven paragraphs.
 *
 * ## Why this lives on the client
 *
 * It is the only part of a market that has no bearing on how it plays. The
 * engine must never be able to read it — a niche with a `colour` field is a
 * niche somebody will eventually branch on — and the server has no business
 * sending a hex code down the wire when the market ids are already there.
 *
 * Colours are declared as Tailwind class strings rather than raw hex so they
 * follow the theme, and each is picked for legibility on both grounds rather
 * than for being the most obvious association. Restaurants are not red.
 */
import {
  Heart, Package, Mic, UtensilsCrossed, HardHat, KanbanSquare, Swords,
  type LucideIcon,
} from "lucide-react";

export interface MarketLook {
  Icon: LucideIcon;
  /** Tints a header or a card edge. */
  tint: string;
  /** The mark itself, on the tint. */
  ink: string;
  /**
   * The strategic shape of the market, in one line.
   *
   * Deliberately not a restatement of the premise, which is printed two
   * centimetres below it — a band that repeats the sentence under it is worse
   * than an empty band, because the reader spends a moment working out whether
   * they missed something.
   *
   * What goes here is the arithmetic a player would otherwise only discover by
   * reading three segment boxes and doing a division: what one head in the
   * small rich segment is worth against one in the big poor one, which is the
   * single number that decides how a market is played.
   *
   * These are claims about real figures in shared/simulation/niches.ts and are
   * checked against them in test/unit/voice.test.ts. A line here that quietly
   * stops being true is worse than no line, because it is the first thing
   * anybody reads about the market and they will plan around it.
   */
  shape: string;
}

const LOOKS: Record<string, MarketLook> = {
  dating_apps: {
    Icon: Heart,
    tint: "bg-rose-500/10 border-rose-500/30",
    ink: "text-rose-600 dark:text-rose-400",
    shape: "A long-hauler pays four times a swiper, and does not leave",
  },
  drone_delivery: {
    Icon: Package,
    tint: "bg-sky-500/10 border-sky-500/30",
    ink: "text-sky-600 dark:text-sky-400",
    shape: "A clinic pays twenty-eight times a novelty order, and never switches",
  },
  podcasts: {
    Icon: Mic,
    tint: "bg-violet-500/10 border-violet-500/30",
    ink: "text-violet-600 dark:text-violet-400",
    shape: "One superfan is worth twenty-seven chart-hoppers",
  },
  restaurant_chain: {
    Icon: UtensilsCrossed,
    tint: "bg-amber-500/10 border-amber-500/30",
    ink: "text-amber-600 dark:text-amber-400",
    shape: "A Friday family is worth three lunches and comes back for a decade",
  },
  construction: {
    Icon: HardHat,
    tint: "bg-orange-500/10 border-orange-500/30",
    ink: "text-orange-600 dark:text-orange-400",
    shape: "One public job is worth fifteen kitchens",
  },
  project_saas: {
    Icon: KanbanSquare,
    tint: "bg-teal-500/10 border-teal-500/30",
    ink: "text-teal-600 dark:text-teal-400",
    shape: "The biggest pot is startups, and they leave the week you win them",
  },
  mmos: {
    Icon: Swords,
    tint: "bg-indigo-500/10 border-indigo-500/30",
    ink: "text-indigo-600 dark:text-indigo-400",
    shape: "Launch tourists are half the market and gone by Christmas",
  },
};

/**
 * A fallback that is deliberately plain rather than clever.
 *
 * A market added to the engine and not to this file should look unstyled and
 * obviously so, not get a colour picked by hashing its id — which would look
 * finished and never get fixed.
 */
const PLAIN: MarketLook = {
  Icon: Package,
  tint: "bg-muted border-border",
  ink: "text-muted-foreground",
  shape: "",
};

export const lookOf = (nicheId: string): MarketLook => LOOKS[nicheId] ?? PLAIN;
