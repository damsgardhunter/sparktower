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
import { buildCustomMarket } from "@shared/simulation/custom-market";

/** What a season is playing, whichever kind of market it is. */
export interface SeasonMarket {
  nicheId: string;
  scope?: string | null;
  /** A market Nova wrote for one company, if this is one of those. */
  customMarket?: unknown;
}

/**
 * The season's market before the map is applied.
 *
 * For the two callers that scope it themselves — the tick builds a world and
 * then re-attaches the market to it, and scoping twice would narrow a season
 * onto a continent of a continent. Everything else wants `marketOf`.
 */
export const rawMarketOf = (season: SeasonMarket): Niche | undefined => {
  if (season.customMarket) {
    const written = buildCustomMarket(season.customMarket, season.nicheId);
    if (written) return written;
    console.error(`[sim] season's written market could not be rebuilt; falling back to ${season.nicheId}`);
  }
  return nicheById(season.nicheId);
};

export const marketOf = (season: SeasonMarket): Niche | undefined => {
  /*
   * A written market wins, and is rebuilt through the same validator that
   * created it rather than trusted as stored. The row could have been written
   * by an older version of this code, or edited; the engine gets something
   * playable or it gets one of the seven.
   */
  const market = rawMarketOf(season);
  return market ? nicheForScope(market, (season.scope ?? "home") as Scope) : undefined;
};

/**
 * What to call this season's market on a screen.
 *
 * Its own name when Nova wrote it, the catalogue's when it did not, and the
 * raw id when somebody has deleted a market out from under a season — which
 * is still better than a blank.
 */
export const marketNameOf = (season: SeasonMarket): string =>
  rawMarketOf(season)?.name ?? season.nicheId;
