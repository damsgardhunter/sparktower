/**
 * The lobby's data: the markets, the room, and the clock that ticks between
 * polls.
 *
 * ## Why the room polls, and why not every second
 *
 * The room is the only screen in this app where five people look at the same
 * thing while it changes under all of them. There is no socket, and there
 * doesn't need to be: the server advances the phase *on read* (see `advance()`
 * in server/simulation-routes.ts), so polling isn't just how this screen finds
 * out what happened — it is what makes it happen. A room nobody is looking at
 * is a room whose clock isn't running, and that is fine, because there is
 * nobody to show it to.
 *
 * Two and a half seconds is the whole budget. Every second would be five
 * requests a second per room for a number the phone can work out itself, and
 * slower than that a seat someone took is theirs for long enough that a second
 * person reaches for it. So: poll on a short interval for the truth, and
 * interpolate the countdown locally in between.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { formatCountdown, remainingSeconds, seasonOver, type LiveVenture, type NichesResponse, type VentureView } from "./lobby";
import type { DeskView } from "./desk";
import type { MarketView } from "./market";
import type { OffersView } from "./offers";
import type { StandingsView } from "./standings";

/** Short enough that a claimed seat shows up before someone else reaches for it. */
export const ROOM_POLL_MS = 2_500;

/** The markets, and what each of the five seats controls. Static for a session. */
export function useNiches() {
  return useQuery({
    queryKey: ["sim-niches"],
    queryFn: () => api<NichesResponse>("/api/sim/niches"),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/**
 * The companies you already hold a seat in.
 *
 * A season is fourteen real days, so the list of rooms someone is already in
 * is the first thing the lobby has to answer — a player opening the app on
 * day six wants today's decisions, not a market picker. Polled on the room's
 * interval rather than cached, because a phase moving from `claiming` to
 * `running` changes which screen the row opens, and a row that sends somebody
 * to the wrong one is worse than no row.
 */
export function useVentures() {
  return useQuery({
    queryKey: ["sim-ventures"],
    queryFn: () => api<{ ventures: LiveVenture[] }>("/api/sim/ventures"),
    refetchInterval: ROOM_POLL_MS,
    staleTime: 0,
    retry: false,
  });
}

/**
 * The room, as it stands, re-asked every couple of seconds.
 *
 * Polling stops once the phase can't change again — a running or retired
 * venture is a final answer, and a screen that keeps asking for it is a
 * battery bill for nothing.
 */
export function useVenture(id: string | undefined) {
  return useQuery({
    queryKey: ["sim-venture", id],
    queryFn: () => api<VentureView>(`/api/sim/ventures/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const phase = query.state.data?.phase;
      return phase === "running" || phase === "retired" ? false : ROOM_POLL_MS;
    },
    // The point of this query is that it is never stale for long; React
    // Query's default window would swallow a refetch triggered by a claim.
    staleTime: 0,
    retry: false,
  });
}

/**
 * The countdown, re-anchored on every poll.
 *
 * `secondsLeft` is the server's, and `anchoredAt` is when it landed — pass
 * React Query's `dataUpdatedAt` so that a poll returning the *same* number
 * (which happens whenever two polls land inside the same server second) still
 * resets the local clock instead of letting it carry on drifting.
 *
 * The one-second tick only forces a re-render; the value itself is computed
 * from `Date.now()` at render, so a render caused by anything else — a poll, a
 * claim — shows the right number rather than the one the last tick left.
 */
export function useCountdown(secondsLeft: number | undefined, anchoredAt: number): { seconds: number; text: string } {
  const [, tick] = useState(0);

  useEffect(() => {
    if (secondsLeft == null) return;
    const timer = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, [secondsLeft == null]);

  const seconds = secondsLeft == null ? 0 : remainingSeconds({ secondsLeft, atMs: anchoredAt }, Date.now());
  return { seconds, text: formatCountdown(seconds) };
}

/**
 * The desk, re-asked on the room's interval.
 *
 * The same 2.5 seconds as the lobby, and for a weaker reason: a year is a day
 * long, so nothing here is a race the way a seat is. What it buys is that the
 * table's commitment total moves *while the five of them are arguing about
 * it* — someone in the group chat saying "fine, I'll drop brand to one" should
 * show up on four other screens within a breath, because the argument is the
 * feature. One interval across both screens also means one thing to change if
 * it turns out to be wrong.
 *
 * Polling stops on the two phases that can't move again on their own: a season
 * that hasn't started has nothing to report, and a finished one is a final
 * answer. `running` keeps asking — the year resolving underneath the screen is
 * precisely what a player wants to be told about.
 */
export function useDesk(id: string | undefined) {
  return useQuery({
    queryKey: ["sim-desk", id],
    queryFn: () => api<DeskView>(`/api/sim/ventures/${id}/desk`),
    enabled: !!id,
    refetchInterval: (query) => {
      const phase = query.state.data?.phase;
      return phase === "finished" || phase === "not_started" ? false : ROOM_POLL_MS;
    },
    staleTime: 0,
    retry: false,
  });
}

/**
 * The market, on the same interval as everything else.
 *
 * It needs the poll for a different reason than the desk does: the open
 * market's three listings are generated from the season and the year and
 * cannot move, but another team can put one of its own assets up for sale at
 * any moment, and a screen that only learned about it on a manual refresh
 * would hide the most interesting listings in the game.
 *
 * Your own bid comes back in the same payload, which is why the bid inputs on
 * the screen are seeded once per year rather than from every response — a poll
 * landing mid-keystroke must not take the number out of somebody's hands.
 */
export function useMarket(id: string | undefined) {
  return useQuery({
    queryKey: ["sim-market", id],
    queryFn: () => api<MarketView>(`/api/sim/ventures/${id}/market`),
    enabled: !!id,
    refetchInterval: ROOM_POLL_MS,
    staleTime: 0,
    retry: false,
  });
}

/**
 * Offers, on the same interval as everything else.
 *
 * This one needs the poll more than the market does, and for a reason the
 * market's doesn't have: an offer is a question put to five other people, and
 * both the asking and the answering happen on somebody else's phone. A screen
 * that only learned about an offer for the company on a manual refresh would
 * be the screen where a team found out they had been asked to sell after the
 * year had already resolved the question for them.
 *
 * Nothing here is optimistic for the same reason. An offer that looks accepted
 * and wasn't is a company somebody thinks they sold.
 */
export function useOffers(id: string | undefined) {
  return useQuery({
    queryKey: ["sim-offers", id],
    queryFn: () => api<OffersView>(`/api/sim/ventures/${id}/offers`),
    enabled: !!id,
    // A finished season is a final answer, and asking it again every couple of
    // seconds is a battery bill for a number that cannot change.
    refetchInterval: (query) => (seasonOver(query.state.data?.status) ? false : ROOM_POLL_MS),
    staleTime: 0,
    retry: false,
  });
}

/**
 * The league table.
 *
 * Polled like the rest, though it only really changes on the tick: a year is a
 * day long and the table is the same table for most of it. The interval is
 * shared with every other simulation screen rather than tuned down, because
 * one number to change is worth more than the handful of requests a slower one
 * would save — and when the tick does land, this is the screen somebody is
 * most likely to already be staring at.
 */
export function useStandings(id: string | undefined) {
  return useQuery({
    queryKey: ["sim-standings", id],
    queryFn: () => api<StandingsView>(`/api/sim/ventures/${id}/standings`),
    enabled: !!id,
    refetchInterval: (query) => (seasonOver(query.state.data?.status) ? false : ROOM_POLL_MS),
    staleTime: 0,
    retry: false,
  });
}
