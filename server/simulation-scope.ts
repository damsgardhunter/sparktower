/**
 * The market a season is actually playing.
 *
 * A market's regions are not a constant any more: a public season plays the
 * ten a market wrote for itself, and a company season can play the whole map
 * or one continent of it (see shared/simulation/geography.ts). Everything that
 * reads regions — the desk, the market screen, the bots, the engine — has to
 * read the same ones, and the season is the only thing that knows which.
 *
 * One function, so there is one answer. The balance inside the market still
 * comes from code, never from the stored world: segments and incumbents get
 * edited, and a season that kept a copy would play last month's game.
 */
import { nicheById } from "@shared/simulation/niches";
import { nicheForScope, type Scope } from "@shared/simulation/geography";
import type { Niche } from "@shared/simulation/types";

export const marketOf = (season: { nicheId: string; scope?: string | null }): Niche | undefined => {
  const market = nicheById(season.nicheId);
  return market ? nicheForScope(market, (season.scope ?? "home") as Scope) : undefined;
};
